#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO — Ruecksicherung
#
# Aufruf:
#   sudo bash /opt/patio/scripts/restore.sh /mnt/patio-backup/taeglich/20260806-030000
#
# Ohne Argument wird der juengste Tagesstand genommen:
#   sudo bash /opt/patio/scripts/restore.sh
#
# Was zurueckgespielt wird — genau das, was backup.sh ablegt:
#   datenbank.sql.gz     → in den laufenden Postgres-Container
#   dokumente.tar.gz     → /opt/patio-workspace
#   konfiguration.tar.gz → .env, data/
#   caddy-daten.tar.gz   → Volume mit dem privaten CA-Schluessel
#
# ZEITMESSUNG: Das Skript misst und meldet die Dauer. Diese Zahl gehoert ins
# Betriebshandbuch — sie ist die Antwort auf die einzige Frage, die im
# Ernstfall gestellt wird: "Wie lange stehen wir?"
#
# WARNUNG: Bestehende Daten werden ueberschrieben. Vorher sichern.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/patio}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/patio-workspace}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/patio-backup}"
DB_CONTAINER="${DB_CONTAINER:-patio-postgres}"
APP_CONTAINER="${APP_CONTAINER:-patio-app}"
CADDY_VOLUME="${CADDY_VOLUME:-patio_caddy_data}"
POSTGRES_USER="${POSTGRES_USER:-patio}"
POSTGRES_DB="${POSTGRES_DB:-patio}"

# Ohne Rueckfrage durchlaufen (fuer die geprobte Ruecksicherung).
ASSUME_YES="${ASSUME_YES:-false}"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fehl() { echo "FEHLER: $*" >&2; exit 1; }

STAND="${1:-}"
if [ -z "$STAND" ]; then
  # NUR Staende mit der Marke VOLLSTAENDIG. backup.sh schreibt sie erst, wenn
  # die Selbstpruefung bestanden ist. Ohne diese Einschraenkung waere hier der
  # juengste Stand genommen worden — und das kann ausgerechnet der sein, der
  # gerade wegen eines unvollstaendigen Dumps fehlgeschlagen ist, oder einer,
  # den ein Stromausfall mittendrin abgeschnitten hat.
  # Erst pruefen, WELCHE der drei Kategorien-Verzeichnisse existieren — und
  # zwar ausdruecklich, nicht per Brace-Expansion direkt in `find`:
  #
  # `find a b c` endet mit Exit 1, sobald EINER der Pfade fehlt (das
  # 2>/dev/null verdeckt nur den Text, nicht den Exit-Code). Unter
  # `set -euo pipefail` riss das die ganze Zuweisung mit, und das Skript starb
  # WORTLOS — noch vor der Fehlermeldung, die genau fuer diesen Fall gebaut
  # wurde. Getroffen hat es ausgerechnet den haeufigsten Bedienfehler im
  # Ernstfall: Sicherungsplatte nicht oder falsch eingehaengt. Im Prüfstand
  # nachgestellt am 30.08.2026: RC=1, null Zeilen Ausgabe.
  KANDIDATEN=()
  for kategorie in taeglich woechentlich monatlich; do
    [ -d "$BACKUP_DIR/$kategorie" ] && KANDIDATEN+=("$BACKUP_DIR/$kategorie")
  done
  [ ${#KANDIDATEN[@]} -gt 0 ] || fehl "Unter $BACKUP_DIR liegt keine Sicherungsstruktur
       (weder taeglich/ noch woechentlich/ noch monatlich/).
       Ist die Sicherungsplatte eingehaengt? Pruefen mit:
         lsblk -f   und   ls -la $BACKUP_DIR"
  # `if` statt `[ … ] && echo` im Schleifenkoerper: eine while-Schleife endet
  # mit dem Status ihres LETZTEN Durchlaufs. Ist der letzte Ordner einer ohne
  # Marke (ein `.UNVOLLSTAENDIG` sortiert alphabetisch dahinter), endete die
  # Schleife mit 1 — und pipefail + set -e toeteten das Skript wortlos.
  STAND=$(find "${KANDIDATEN[@]}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
          | while read -r d; do if [ -f "$d/VOLLSTAENDIG" ]; then echo "$d"; fi; done \
          | sort | tail -1)
  [ -n "$STAND" ] || fehl "Kein vollstaendiger Sicherungsstand gefunden unter $BACKUP_DIR.
       Vorhandene Staende ohne Marke VOLLSTAENDIG sind unbrauchbar — pruefen mit:
         ls -la $BACKUP_DIR/taeglich/"
  log "Juengster vollstaendiger Stand: $STAND"
fi
[ -d "$STAND" ] || fehl "Sicherungsstand nicht gefunden: $STAND"
[ -f "$STAND/datenbank.sql.gz" ] || fehl "Kein Datenbank-Dump in $STAND"

# Bei ausdruecklich angegebenem Stand nur warnen, nicht abbrechen — der
# Operator kann Gruende haben, einen unvollstaendigen Stand anzusehen.
if [ ! -f "$STAND/VOLLSTAENDIG" ]; then
  log "WARNUNG: Dieser Stand traegt KEINE Marke VOLLSTAENDIG."
  log "         Entweder ist die Selbstpruefung fehlgeschlagen oder die"
  log "         Sicherung wurde mittendrin abgebrochen. Inhalt pruefen!"
fi

# ── Pruefsummen zuerst ───────────────────────────────────────────────────────
# Eine beschaedigte Sicherung soll VOR dem Loeschen der bestehenden Daten
# auffallen, nicht mittendrin.
if [ -f "$STAND/pruefsummen.sha256" ]; then
  log "Pruefsummen kontrollieren..."
  ( cd "$STAND" && sha256sum -c pruefsummen.sha256 --quiet ) \
    || fehl "Pruefsummen stimmen nicht — die Sicherung ist beschaedigt."
  log "Pruefsummen in Ordnung."
else
  log "WARNUNG: keine Pruefsummen-Datei — Sicherung stammt aus einer aelteren Fassung."
fi

echo
echo "════════════════════════════════════════════════════════"
echo "PATIO — Ruecksicherung"
echo "════════════════════════════════════════════════════════"
echo "Stand:        $STAND"
echo "Datum:        $(date -r "$STAND" '+%d.%m.%Y %H:%M' 2>/dev/null || echo unbekannt)"
echo "Ziel-DB:      $DB_CONTAINER / $POSTGRES_DB"
echo "Dokumente:    $WORKSPACE_DIR"
echo
echo "Bestehende Daten werden ueberschrieben."
if [ "$ASSUME_YES" != "true" ]; then
  read -r -p "Fortfahren? (ja/nein) " antwort
  [ "$antwort" = "ja" ] || { echo "Abgebrochen."; exit 0; }
fi

BEGINN=$(date +%s)

# ── 1. Dienst anhalten ───────────────────────────────────────────────────────
# Sonst schreibt die laufende App waehrend des Einspielens weiter.
if docker ps --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  log "Dienst anhalten..."
  docker stop "$APP_CONTAINER" >/dev/null
  APP_LIEF=true
else
  APP_LIEF=false
fi

# ── 2. Datenbank ─────────────────────────────────────────────────────────────
docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER" \
  || fehl "Postgres-Container laeuft nicht: $DB_CONTAINER — erst 'docker compose up -d postgres'"

log "Datenbank einspielen..."
gunzip -c "$STAND/datenbank.sql.gz" \
  | docker exec -i "$DB_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q \
  || fehl "Einspielen der Datenbank fehlgeschlagen."

# ── 3. Dokumente ─────────────────────────────────────────────────────────────
#
# Der bisherige Stand wird BEISEITE GELEGT, nicht ueberschrieben.
#
# Warum: `tar -xzf` in ein bestehendes Verzeichnis ist ein Verschmelzen, kein
# Zuruecksetzen. Dateien, die NACH der Sicherung entstanden sind, bleiben
# liegen. Ergebnis waere eine Mischung: die Datenbank steht auf dem Stand der
# Sicherung (der Dump raeumt mit --clean auf), die Dateien auf Sicherung PLUS
# Gegenwart. Wer eine Ruecksicherung macht, glaubt einen Zeitpunkt zu bekommen
# und bekaeme zwei.
#
# Besonders unangenehm beim Verschluesselungstrojaner: dessen Dateien tragen
# neue Namen und ueberlebten das Verschmelzen unbeschadet.
#
# Beiseitelegen statt loeschen, weil eine Ruecksicherung oft unter Zeitdruck
# passiert: so ist nichts unwiederbringlich weg.
STEMPEL=$(date +%Y%m%d-%H%M%S)
BEISEITE="${WORKSPACE_DIR}.vor-ruecksicherung-${STEMPEL}"

if [ -d "$WORKSPACE_DIR" ]; then
  # Platz pruefen: kurzzeitig liegen beide Staende auf der Platte.
  BRAUCHT=$(du -sk "$WORKSPACE_DIR" 2>/dev/null | cut -f1)
  FREI=$(df -k --output=avail "$WORKSPACE_DIR" | tail -1)
  if [ "${FREI:-0}" -lt "${BRAUCHT:-0}" ]; then
    fehl "Zu wenig Platz. Der bisherige Stand ($(( BRAUCHT / 1024 )) MB) soll beiseite
       gelegt werden, frei sind nur $(( FREI / 1024 )) MB. Erst Platz schaffen
       (aeltere Staende unter $BACKUP_DIR), dann erneut versuchen."
  fi

  if mountpoint -q "$WORKSPACE_DIR" 2>/dev/null; then
    # Eigener Datentraeger (plausibel, sobald die Dokumente auf eine zweite
    # Platte wandern). Das Verzeichnis selbst laesst sich dann nicht
    # umbenennen — `mv` scheitert mit "Device or resource busy". Deshalb den
    # INHALT beiseite legen, und zwar innerhalb desselben Datentraegers:
    # das ist ein Umbenennen und damit sofort fertig, statt Gigabytes ueber
    # eine Dateisystemgrenze zu kopieren.
    BEISEITE="$WORKSPACE_DIR/.vor-ruecksicherung-${STEMPEL}"
    log "Eigener Datentraeger erkannt — Inhalt beiseite legen: $BEISEITE"
    mkdir -p "$BEISEITE"
    find "$WORKSPACE_DIR" -mindepth 1 -maxdepth 1 \
         ! -name ".vor-ruecksicherung-${STEMPEL}" -exec mv -t "$BEISEITE" {} +
  else
    log "Bisherigen Stand beiseite legen: $BEISEITE"
    mv "$WORKSPACE_DIR" "$BEISEITE"
  fi
fi

log "Dokumente einspielen..."
tar -xzf "$STAND/dokumente.tar.gz" -C "$(dirname "$WORKSPACE_DIR")"
[ -d "$WORKSPACE_DIR" ] || fehl "Der Tarball hat $WORKSPACE_DIR nicht angelegt.
       Der bisherige Stand liegt unversehrt unter $BEISEITE — zurueckbenennen:
         mv '$BEISEITE' '$WORKSPACE_DIR'"

# Der Container laeuft als node = uid 1000. Ohne das kann der Dienst nach der
# Ruecksicherung nicht schreiben — und der Fehler zeigt sich woanders.
chown -R 1000:1000 "$WORKSPACE_DIR"

# ── 4. Konfiguration ─────────────────────────────────────────────────────────
if [ -f "$STAND/konfiguration.tar.gz" ]; then
  log "Konfiguration einspielen..."
  tar -xzf "$STAND/konfiguration.tar.gz" -C "$INSTALL_DIR"
  [ -f "$INSTALL_DIR/.env" ] && chmod 600 "$INSTALL_DIR/.env"
fi

# ── 5. CA-Schluessel ─────────────────────────────────────────────────────────
# Ohne diesen Schritt erzeugt Caddy eine NEUE Zertifizierungsstelle, und jeder
# Arbeitsplatz zeigt wieder eine Warnung.
if [ -f "$STAND/caddy-daten.tar.gz" ]; then
  log "CA-Schluessel einspielen..."
  docker volume create "$CADDY_VOLUME" >/dev/null
  docker run --rm -v "$CADDY_VOLUME":/ziel -v "$STAND":/quelle:ro alpine:latest \
    sh -c 'rm -rf /ziel/* && tar -xzf /quelle/caddy-daten.tar.gz -C /ziel'
else
  log "WARNUNG: kein CA-Schluessel in der Sicherung. Caddy erzeugt eine neue"
  log "         Zertifizierungsstelle — das neue Wurzelzertifikat muss dann auf"
  log "         JEDEN Arbeitsplatz. Siehe docs/betrieb/zertifikat.md."
fi

# ── 6. Dienst wieder starten ─────────────────────────────────────────────────
#
# Caddy MUSS mit, sobald der CA-Schluessel zurueckgespielt wurde: das Volume
# wurde unter dem laufenden Container ausgetauscht, er arbeitet sonst mit dem
# alten Zustand weiter. Das faellt erst am Arbeitsplatz auf — dort steht dann
# weiterhin eine Zertifikatswarnung, obwohl der Schluessel wieder da ist, und
# Schritt 1 der Pruefliste unten schlaegt ohne erkennbaren Grund fehl.
# ── Warum der App-Container NICHT neu erzeugt wird ──────────────────────────
#
# Caddy MUSS neu erzeugt werden (das CA-Volume wurde unter ihm ausgetauscht).
# Die App ausdruecklich NICHT, solange ihr Container noch existiert:
#
# `docker compose up -d --force-recreate app` baut die Umgebung aus der
# Compose-Datei neu auf — und dort steht
# `DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:...`.
# Die Werte kaemen aus der `.env`, die Schritt 4 GERADE aus der Sicherung
# zurueckgespielt hat.
#
# Im dokumentierten Ernstfall — Ersatzgeraet — ist das genau der falsche Wert:
# `install-server.sh` hat dort ein frisches Zufallspasswort erzeugt und
# Postgres damit initialisiert; der pg_dump enthaelt keine Rollen-Passwoerter,
# das Rollenpasswort bleibt also das NEUE. Die zurueckgespielte `.env` traegt
# das ALTE (sie muss zurueck, wegen ENCRYPTION_KEY). Ein neu erzeugter
# App-Container verbindet damit gegen die falsche Zugangsdaten und meldet
# `password authentication failed` — waehrend der bestehende Container mit
# seiner Erzeugungs-Umgebung problemlos weiterlaeuft.
#
# `docker start` behaelt diese Umgebung. Nur wenn es gar keinen Container gibt
# (Neuaufbau), bleibt `up -d app` — dann existiert auch keine andere Wahl.
log "Dienst und Proxy starten..."
if docker ps -a --format '{{.Names}}' | grep -qx "$APP_CONTAINER"; then
  docker start "$APP_CONTAINER" >/dev/null 2>&1 || true
elif [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  log "Kein App-Container vorhanden — er wird aus der Compose-Datei erzeugt."
  log "ACHTUNG: Stimmt POSTGRES_PASSWORD in der zurueckgespielten .env nicht"
  log "         mit dem Datenbank-Volume ueberein, kommt der Dienst nicht"
  log "         hinein. Siehe docs/betrieb/troubleshooting.md."
  ( cd "$INSTALL_DIR" && docker compose up -d app >/dev/null 2>&1 ) || true
fi
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  ( cd "$INSTALL_DIR" && docker compose up -d --force-recreate caddy >/dev/null 2>&1 ) || true
fi

# ── 7. Und zwar IMMER pruefen, ob der Dienst wirklich hochkommt ──────────────
#
# Bisher lief dieser Abschnitt nur, wenn die App vorher lief. Beim Totalausfall
# — dem Regelfall fuer eine Ruecksicherung — lief sie gerade NICHT, und das
# Skript meldete „abgeschlossen", ohne den Dienst je gesehen zu haben. Die
# Dauer, die es danach ausgibt, waere dann die Dauer bis zu einer Behauptung.
GESUND=false
for _ in $(seq 1 60); do
  if docker exec "$APP_CONTAINER" curl -fsS -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
    GESUND=true
    break
  fi
  sleep 1
done

DAUER=$(( $(date +%s) - BEGINN ))

echo
echo "════════════════════════════════════════════════════════"
if [ "$GESUND" = "true" ]; then
  echo "Ruecksicherung abgeschlossen in ${DAUER} Sekunden — der Dienst antwortet."
else
  echo "Ruecksicherung eingespielt in ${DAUER} Sekunden — ABER DER DIENST"
  echo "ANTWORTET NICHT. Die Daten liegen zurueck, der Betrieb steht noch."
fi
echo "  (= $((DAUER / 60)) Minuten $((DAUER % 60)) Sekunden)"
echo "════════════════════════════════════════════════════════"
if [ "$GESUND" != "true" ]; then
  echo
  echo "Zuerst nachsehen:"
  echo "  cd $INSTALL_DIR && docker compose ps"
  echo "  cd $INSTALL_DIR && docker compose logs --tail 50 app"
fi
echo
echo "Diese Dauer gehoert ins Betriebshandbuch — sie ist die Antwort auf"
echo "\"wie lange stehen wir?\"."
echo
echo "Jetzt pruefen:"
echo "  1. Anmelden an https://\${PATIO_HOSTNAME}/ — ohne Zertifikatswarnung"
echo "  2. Ein Projekt oeffnen, eine Datei herunterladen"
echo "  3. Pruefprotokoll ansehen: /admin/audit"
echo
if [ -d "$BEISEITE" ]; then
  echo "Der Stand VOR der Ruecksicherung liegt unter:"
  echo "  $BEISEITE"
  echo
  echo "Dort stehen auch die Dateien, die nach der Sicherung entstanden sind —"
  echo "sie fehlen jetzt bewusst im wiederhergestellten Stand. Was gebraucht"
  echo "wird, von Hand herueberholen. Erst danach loeschen:"
  echo "  sudo rm -rf '$BEISEITE'"
  echo
fi

# Der Exit-Code sagt dasselbe wie die Meldung. Wer die Ruecksicherung aus
# einem anderen Skript oder einer Probe heraus faehrt, soll nicht den
# Bildschirmtext parsen muessen.
[ "$GESUND" = "true" ] || exit 1
exit 0
