#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO — Auslieferungspaket auf dem Firmenserver einspielen
#
# LAEUFT AUF DEM SERVER. Braucht kein Internet — das ist der ganze Zweck.
#
# Aufruf:
#   sudo bash /opt/patio/scripts/update-offline.sh patio-0.2.0.tar.gz
#
# Ablauf:
#   1. Pruefsumme kontrollieren
#   2. SICHERUNG ausloesen (nicht verhandelbar, siehe unten)
#   3. Image laden, Konfiguration und Skripte aktualisieren
#   4. Stack neu starten, Gesundheit pruefen
#   5. Bei Fehlschlag zurueck auf das vorige Image
#
# WARUM DIE SICHERUNG PFLICHT IST: Datenbank-Migrationen laufen nur vorwaerts.
# Der Rueckweg auf das alte Image holt das Schema NICHT zurueck. Ein Update,
# das migriert, ist damit praktisch einbahnig — die Sicherung davor ist der
# einzige echte Rueckweg.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/patio}"
APP_CONTAINER="${APP_CONTAINER:-patio-app}"
SKIP_BACKUP="${SKIP_BACKUP:-false}"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fehl() { echo "FEHLER: $*" >&2; exit 1; }

PAKET="${1:-}"
[ -n "$PAKET" ] || fehl "Aufruf: $0 <paket.tar.gz>"
[ -f "$PAKET" ] || fehl "Paket nicht gefunden: $PAKET"

command -v docker >/dev/null || fehl "docker nicht gefunden."

# Ziel VOR dem ersten Handgriff pruefen. Ohne das laedt das Skript erst das
# Image (dauert und veraendert den Docker-Bestand) und scheitert dann beim
# Kopieren — der Rechner bliebe halb aktualisiert zurueck.
[ -d "$INSTALL_DIR" ]         || fehl "Installationsverzeichnis nicht gefunden: $INSTALL_DIR
       Anderer Pfad? Dann INSTALL_DIR=<pfad> $0 $PAKET"
[ -d "$INSTALL_DIR/scripts" ] || fehl "$INSTALL_DIR/scripts fehlt — ist das wirklich eine PATIO-Installation?"
[ -f "$INSTALL_DIR/.env" ]    || fehl "$INSTALL_DIR/.env fehlt. Ohne Konfiguration startet der Dienst nicht.
       Bei einer Erstinstallation zuerst .env.example kopieren und ausfuellen."
[ -w "$INSTALL_DIR" ]         || fehl "Keine Schreibrechte auf $INSTALL_DIR — mit sudo aufrufen."

# ── 1. Pruefsumme ────────────────────────────────────────────────────────────
if [ "${OHNE_PRUEFSUMME:-false}" = "true" ]; then
  log "WARNUNG: Pruefsumme uebersprungen (OHNE_PRUEFSUMME=true)."
elif [ -f "${PAKET}.sha256" ]; then
  log "Pruefsumme kontrollieren..."
  # Nur den Dateinamen vergleichen, nicht den Pfad vom Baurechner.
  ERWARTET=$(awk '{print $1}' "${PAKET}.sha256")
  TATSAECHLICH=$(sha256sum "$PAKET" | awk '{print $1}')
  [ "$ERWARTET" = "$TATSAECHLICH" ] \
    || fehl "Pruefsumme stimmt nicht — das Paket ist auf dem Weg beschaedigt worden."
  log "Pruefsumme in Ordnung."
else
  # Frueher stand hier nur eine Warnung. Das Paket kommt auf einem USB-Stick
  # ueber den Flur; die Pruefsumme ist die EINZIGE Kontrolle, die einen
  # beschaedigten Transport bemerkt. Sie optional zu halten schaltete sie
  # genau dann ab, wenn jemand die Datei vergessen hat.
  #
  # Der Schaden faellt sonst erst spaeter auf — `docker load` bricht ab,
  # nachdem die Sicherung gelaufen ist und Dateien schon ersetzt sind.
  fehl "Keine Pruefsummen-Datei neben dem Paket: ${PAKET}.sha256

       Sie entsteht beim Bauen automatisch und gehoert mit auf den Stick.
       Ohne sie laesst sich nicht feststellen, ob das Paket den Transport
       unbeschaedigt ueberstanden hat.

       Nachtraeglich pruefen laesst sie sich nicht — sie muss vom Baurechner
       kommen. Bewusst ohne Kontrolle einspielen:
         OHNE_PRUEFSUMME=true $0 $PAKET"
fi

# ── 2. Auspacken ─────────────────────────────────────────────────────────────
ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT
tar -xzf "$PAKET" -C "$ARBEIT"
[ -f "$ARBEIT/image.tar.gz" ] || fehl "Kein Image im Paket."

echo
cat "$ARBEIT/PAKET.txt" 2>/dev/null || true
echo

# Aktuelles Image merken — das ist der Rueckweg. Ueber die Image-ID, nicht
# ueber die Marke: `docker load` haengt `patio-app:latest` gleich an das neue
# Image um, die Marke zeigte danach ins Falsche.
VORHER_ID=$(docker images --no-trunc --format '{{.ID}}' patio-app:latest 2>/dev/null | head -1)
[ -n "$VORHER_ID" ] && log "Voriges Image gemerkt: ${VORHER_ID:0:19}"

# ── Welcher Stand laeuft hier eigentlich? ────────────────────────────────────
#
# Bis hierher liess sich das auf dem Server nicht beantworten: `patio status`
# zeigt die Dienste, die API kennt keine Version, und docker-compose.yml zeigt
# auf `patio-app:latest` — nach einem Rueckweg zeigt diese Marke wieder aufs
# alte Image und sieht dabei genauso aus.
#
# Deshalb eine Datei, die den eingespielten Stand festhaelt. Die vorige wird
# vorher weggelegt: traegt das Update nicht und Abschnitt 6 setzt zurueck,
# muss auch die Datei zurueck, sonst behauptet sie eine Version, die nicht
# laeuft.
PAKET_VERSION=$(awk '/^Version:/ {print $2; exit}' "$ARBEIT/PAKET.txt" 2>/dev/null || true)
VERSION_DATEI="$INSTALL_DIR/VERSION"
VORHER_VERSION=""
[ -f "$VERSION_DATEI" ] && VORHER_VERSION=$(cat "$VERSION_DATEI")

# ── 3. Sicherung ─────────────────────────────────────────────────────────────
if [ "$SKIP_BACKUP" != "true" ]; then
  log "Sicherung vor dem Update..."
  bash "$INSTALL_DIR/scripts/backup.sh" \
    || fehl "Die Sicherung ist fehlgeschlagen. Update abgebrochen — ohne
       Rueckweg wird hier nichts angefasst. Ursache pruefen:
         journalctl -u patio-backup -n 50
       Bewusst umgehen: SKIP_BACKUP=true $0 $PAKET"
  log "Sicherung liegt."
else
  log "WARNUNG: Sicherung uebersprungen (SKIP_BACKUP=true)."
fi

# ── 4. Einspielen ────────────────────────────────────────────────────────────
log "Image laden..."
gunzip -c "$ARBEIT/image.tar.gz" | docker load

# Basis-Images (postgres, caddy, alpine). Seit sie im Paket liegen, kommt eine
# Erstinstallation ohne Internet aus — vorher scheiterte `docker compose up`
# beim Versuch, sie zu ziehen. Aeltere Pakete haben die Datei nicht; das ist
# kein Fehler, dort waren sie schon auf dem Rechner.
if [ -f "$ARBEIT/basis-images.tar.gz" ]; then
  log "Basis-Images laden..."
  gunzip -c "$ARBEIT/basis-images.tar.gz" | docker load
else
  log "HINWEIS: Paket ohne Basis-Images (aeltere Fassung) — es wird das
       genommen, was auf diesem Rechner liegt."
fi

log "Konfiguration und Skripte aktualisieren..."
# .env wird NICHT angefasst — dort stehen die Geheimnisse dieser Installation.
cp "$ARBEIT/dabei/docker-compose.yml" "$INSTALL_DIR/"
cp "$ARBEIT/dabei/.env.example" "$INSTALL_DIR/"

# `docker/` und `deploy/` ERSETZEN, nicht mischen.
#
# `cp -r` legt nur obendrauf: was eine neue Fassung nicht mehr mitliefert,
# bleibt auf dem Server liegen — auf unbestimmte Zeit, weil dort nie jemand
# aufraeumt. So standen dort zuletzt `docker-compose.vps.yml` und eine zweite
# `.env.example` aus der VPS-Aera. Wer im Stoerfall nachsieht, welche
# Compose-Datei gilt, findet die falsche zuerst.
#
# Beide Verzeichnisse kommen vollstaendig aus dem Paket und tragen nichts,
# was auf dem Server entsteht — anders als `.env`, `logs/` oder `data/`, die
# hier bewusst nicht angefasst werden.
for verzeichnis in docker deploy; do
  # ${…:?} statt $…: waere INSTALL_DIR leer, hiesse die Zeile sonst
  # `rm -rf /docker` — und das Skript laeuft mit sudo. Die Zuweisung oben
  # setzt zwar einen Vorgabewert, aber ein ausdrueckliches INSTALL_DIR=""
  # kaeme daran vorbei.
  rm -rf "${INSTALL_DIR:?}/$verzeichnis"
  cp -r "$ARBEIT/dabei/$verzeichnis" "$INSTALL_DIR/"
done

# Die Skripte per `mv` ersetzen, NICHT per `cp` — dieses Skript ist selbst
# eines davon.
#
# `cp` schneidet die vorhandene Datei ab und schreibt in DIESELBE Inode.
# Bash liest ein Skript aber nicht auf einmal ein, sondern byteweise weiter,
# waehrend es laeuft. Wird die Datei unter ihm ausgetauscht, liest es an
# seinem alten Byte-Versatz im NEUEN Inhalt weiter — und fuehrt Bruchstuecke
# aus. Das sah so aus:
#     $'\220═════\n  echo Update': command not found
#
# `mv` legt dagegen nur einen neuen Verzeichniseintrag an (rename). Die alte
# Inode bleibt bestehen, solange dieses Skript sie offen hat, und laeuft
# unveraendert zu Ende. Das neue Skript gilt ab dem naechsten Aufruf.
for neu in "$ARBEIT/dabei/scripts/"*.sh; do
  ziel="$INSTALL_DIR/scripts/$(basename "$neu")"
  cp "$neu" "$ziel.neu"
  chmod +x "$ziel.neu"
  mv -f "$ziel.neu" "$ziel"
done

log "Stack neu starten..."
cd "$INSTALL_DIR"

# ── Warum hier kein nacktes `docker compose up -d` steht ─────────────────────
#
# Das Skript laeuft unter `set -euo pipefail`. Scheitert der Start — fehlendes
# Basis-Image, belegter Port 80/443, volle Platte, kaputte .env —, bricht das
# Skript SOFORT ab. Abschnitt 5 (Gesundheitspruefung) und Abschnitt 6
# (Rueckweg auf das vorige Image) liefen dann nie.
#
# Und zwar nachdem `docker load` bereits gelaufen ist und Compose-Datei,
# docker/, deploy/ sowie alle Skripte ersetzt sind: genau der halb
# aktualisierte Rechner, den die Vorpruefung oben verhindern soll.
#
# Deshalb den Fehlschlag auffangen und in den Rueckweg laufen lassen. Die
# Ausgabe von Compose bleibt sichtbar, sie steht meist schon in der Meldung.
if ! docker compose up -d; then
  log "Der Stack liess sich nicht starten — weiter zum Rueckweg."
fi

# ── 5. Gesundheit pruefen ────────────────────────────────────────────────────
log "Auf den Dienst warten..."
GESUND=false
for _ in $(seq 1 60); do
  if docker exec "$APP_CONTAINER" curl -fsS -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
    GESUND=true
    break
  fi
  sleep 2
done

if [ "$GESUND" = "true" ]; then
  # Erst jetzt festschreiben — vor der Gesundheitspruefung waere es eine
  # Behauptung ueber einen Dienst, der vielleicht gar nicht laeuft.
  if [ -n "$PAKET_VERSION" ]; then
    printf '%s\n' "$PAKET_VERSION" > "$VERSION_DATEI"
    log "Stand vermerkt: $PAKET_VERSION (in $VERSION_DATEI)"
  fi
  echo
  echo "════════════════════════════════════════════════════════"
  echo "Update erfolgreich — der Dienst antwortet."
  echo "════════════════════════════════════════════════════════"
  docker compose ps
  echo
  echo "Jetzt von einem Arbeitsplatz aus anmelden und ein Projekt oeffnen."
  exit 0
fi

# ── 6. Rueckweg ──────────────────────────────────────────────────────────────
echo
log "Der Dienst antwortet nicht. Letzte Protokollzeilen:"
docker compose logs --tail 30 app || true

if [ -n "$VORHER_ID" ]; then
  log "Zurueck auf das vorige Image..."
  docker tag "$VORHER_ID" patio-app:latest
  # Die Versionsdatei mit zuruecknehmen — sonst weist sie auf einen Stand,
  # der hier gerade NICHT laeuft, und das ist schlimmer als keine Angabe.
  if [ -n "$VORHER_VERSION" ]; then
    printf '%s\n' "$VORHER_VERSION" > "$VERSION_DATEI"
  else
    rm -f "$VERSION_DATEI"
  fi
  docker compose up -d app
  for _ in $(seq 1 30); do
    docker exec "$APP_CONTAINER" curl -fsS -o /dev/null http://localhost:3000/api/health 2>/dev/null && {
      echo
      echo "Zurueckgesetzt — der Dienst laeuft wieder mit dem vorigen Stand."
      echo
      echo "ACHTUNG: Falls das neue Image bereits Migrationen angewendet hat,"
      echo "ist das SCHEMA weiterhin auf dem neuen Stand — Migrationen laufen"
      echo "nur vorwaerts. Wenn die alte Fassung damit nicht zurechtkommt, die"
      echo "Sicherung von vorhin einspielen:"
      echo "  sudo bash $INSTALL_DIR/scripts/restore.sh"
      exit 1
    }
    sleep 2
  done
fi

fehl "Der Dienst laeuft weder mit dem neuen noch mit dem vorigen Image.
       Jetzt die Sicherung einspielen:
         sudo bash $INSTALL_DIR/scripts/restore.sh"
