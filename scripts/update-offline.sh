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

# ── Den alten Stand beiseitelegen — der Rueckweg braucht mehr als das Image ──
#
# Abschnitt 6 setzte bisher nur `patio-app:latest` auf das vorige Image zurueck.
# Compose-Datei, docker/, deploy/ und die Skripte waren zu diesem Zeitpunkt aber
# laengst ersetzt. Wenn die neue Compose-Datei etwas voraussetzt, das die alte
# Fassung nicht mitbringt — eine neue Pflicht-Env, ein neuer Mount —, startet
# auch das zurueckgesetzte Image nicht. Uebrig bliebe genau der halb
# aktualisierte Rechner, den die Vorpruefung verhindern soll.
BEISEITE="$INSTALL_DIR/.vorher"
MARKER="$INSTALL_DIR/.update-laeuft"

# ── Wurde ein frueherer Anlauf mitten im Ersetzen abgebrochen? ───────────────
#
# Der Marker entsteht unten, unmittelbar vor dem ersten Ersetzen, und wird
# erst entfernt, wenn das Verzeichnis wieder in einem GANZEN Zustand ist —
# nach bestandener Gesundheitspruefung oder nach vollzogenem Rueckweg.
#
# Liegt er beim Start noch da, ist das Installationsverzeichnis halb
# aktualisiert, und `.vorher` ist die EINZIGE gute Kopie des alten Stands.
# Sie jetzt mit `rm -rf` zu ueberschreiben hiesse: der Rueckweg dieses Anlaufs
# wuerde den halb aktualisierten Stand als „vorher" zurueckspielen und dabei
# Erfolg melden. Deshalb bleibt `.vorher` in diesem Fall unangetastet — auch
# die Image-Kennung darin, denn `patio-app:latest` zeigt nach dem `docker
# load` des abgebrochenen Anlaufs bereits auf das NEUE Image.
if [ -f "$MARKER" ]; then
  MARKER_LAG=true
  log "WARNUNG: Ein frueherer Update-Anlauf wurde mitten im Ersetzen abgebrochen"
  log "         (Marke $MARKER vom $(cat "$MARKER" 2>/dev/null || echo '?'))."
  log "         Der Stand unter $BEISEITE bleibt deshalb ERHALTEN und gilt"
  log "         weiter als Rueckweg — samt der dort vermerkten Image-Kennung."
  # Fehlt `.vorher`, hat der Marker nichts mehr zu schuetzen — er wuerde sonst
  # jedes kuenftige Update an derselben Stelle abbrechen, und der Ratschlag
  # „Sicherung einspielen" fuehrt aus dieser Sackgasse nicht heraus:
  # `restore.sh` fasst weder Marker noch `.vorher` an. Also: melden, Marke
  # loeschen, normal weitermachen — mit dem Hinweis, dass es diesmal keinen
  # automatischen Rueckweg auf den vorigen Stand gibt.
  if [ ! -d "$BEISEITE" ]; then
    log "         ABER: $BEISEITE fehlt (von Hand geloescht?). Es gibt damit"
    log "         keinen automatischen Rueckweg auf den vorigen Stand."
    log "         Der Rueckweg dieses Laufs ist die Sicherung, die gleich"
    log "         gezogen wird. Die Marke wird zurueckgesetzt."
    rm -f "$MARKER"
    MARKER_LAG=false
  fi
else
  MARKER_LAG=false
  rm -rf "${BEISEITE:?}"
  mkdir -p "$BEISEITE"
  for teil in docker-compose.yml .env.example VERSION docker deploy scripts; do
    # Vollstaendiges `if` statt `[ … ] && cp`: eine AND-Liste, deren Test in der
    # letzten Iteration fehlschlaegt, wuerde den Status der Schleife auf 1 setzen
    # — unter `set -e` ein Abbruch mitten im Update, ohne erkennbaren Grund.
    if [ -e "$INSTALL_DIR/$teil" ]; then
      cp -a "$INSTALL_DIR/$teil" "$BEISEITE/"
    fi
  done
  # Die Image-Kennung gehoert MIT beiseite: sie wurde oben gelesen, solange
  # `patio-app:latest` noch auf das alte Image zeigte. Ein zweiter Anlauf kann
  # sie nicht mehr selbst ermitteln — nach dem `docker load` zeigt die Marke
  # auf das neue.
  if [ -n "$VORHER_ID" ]; then
    printf '%s\n' "$VORHER_ID" > "$BEISEITE/IMAGE_ID"
  fi
  log "Voriger Stand liegt unter $BEISEITE"
fi

# Ab der naechsten Zeile ist das Verzeichnis nicht mehr in einem ganzen
# Zustand. Der Marker haelt das fest — fuer den Fall, dass genau hier der
# Strom ausfaellt oder jemand Strg+C drueckt.
date --iso-8601=seconds > "$MARKER"

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
# `--force-recreate` fuer Caddy, und zwar aus einem Grund, der sonst still
# durchrutscht: `rm -rf docker/ && cp -r` legt eine NEUE Inode an, waehrend die
# Compose-Datei die Datei einzeln einhaengt (./docker/Caddyfile:/etc/caddy/...).
# Der laufende Container haelt die alte Inode weiter fest, und `up -d` erzeugt
# ihn nicht neu, weil sich an seiner Dienstdefinition nichts geaendert hat.
# Ein Update, das einen Routing-Pfad korrigiert, waere also eingespielt und
# trotzdem wirkungslos — ohne jede Meldung.
if ! docker compose up -d; then
  log "Der Stack liess sich nicht starten — weiter zum Rueckweg."
fi
if ! docker compose up -d --force-recreate caddy; then
  log "Caddy liess sich nicht neu erzeugen — weiter zum Rueckweg."
fi

# ── Lebt Caddy nach dem Neuerzeugen noch? ───────────────────────────────────
#
# Diese Pruefung ist NEU noetig, weil der Caddyfile jetzt sofort wirksam wird.
# Vorher hielt der Container die alte Inode fest; ein fehlerhafter Caddyfile im
# Paket blieb dadurch folgenlos. Jetzt kann er den EINZIGEN Zugangsweg der
# Arbeitsplaetze lahmlegen — und die Gesundheitspruefung unten wuerde es nicht
# merken: Sie fragt die App per `docker exec` container-intern, also am Proxy
# vorbei, und meldete „Update erfolgreich", waehrend im Buero niemand mehr
# hineinkommt.
#
# `caddy` hat bewusst keinen Healthcheck in der Compose-Datei; geprueft wird
# deshalb hier, und zwar auf das, was wirklich zaehlt: Steht der Container nach
# ein paar Sekunden noch, oder kreiselt er in der Neustartschleife
# (`restart: always`), weil der Caddyfile nicht geparst werden konnte?
sleep 5
CADDY_STATUS=$(docker inspect -f '{{.State.Status}}' patio-caddy 2>/dev/null || echo "fehlt")
CADDY_NEUSTARTS=$(docker inspect -f '{{.RestartCount}}' patio-caddy 2>/dev/null || echo 0)
if [ "$CADDY_STATUS" != "running" ] || [ "${CADDY_NEUSTARTS:-0}" -gt 2 ]; then
  log "WARNUNG: Der Proxy laeuft nicht sauber (Status: $CADDY_STATUS, Neustarts: $CADDY_NEUSTARTS)."
  log "         Haeufigste Ursache: ein fehlerhafter Caddyfile im Paket."
  docker compose logs --tail 20 caddy || true
  # Kein `fehl` an dieser Stelle: Der Rueckweg unten spielt den vorigen
  # Caddyfile zurueck und erzeugt den Proxy erneut — das ist die richtige
  # Antwort, nicht ein Abbruch mit halb aktualisiertem Proxy.
  #
  # Gemerkt wird es in CADDY_KAPUTT und NICHT in GESUND: Die Warteschleife
  # unten setzt GESUND ohnehin neu, ein hier gesetztes `false` waere also
  # wirkungslos.
  CADDY_KAPUTT=true
else
  CADDY_KAPUTT=false
fi

# ── systemd-Einheiten nachziehen ─────────────────────────────────────────────
#
# Bis hierher wurden sie NUR bei der Erstinstallation eingespielt. Das Update
# ersetzte `deploy/` im Installationsverzeichnis, kopierte aber nichts nach
# /etc/systemd/system — eine geaenderte Sicherungs-Einheit wurde also nie
# wirksam, und niemand merkte es, weil die alte weiterlief.
#
# Jeder Handgriff hier ist gegen `set -e` abgeschirmt. Grund: Dieser Block
# laeuft NACH dem Ersetzen der Dateien und VOR der Gesundheitspruefung — ein
# harter Abbruch hier hinterliesse den halb aktualisierten Rechner OHNE
# Rueckweg, und der naechste Anlauf wuerde mit seinem `rm -rf .vorher` auch
# noch den beiseitegelegten Vorher-Stand ueberschreiben. Eine nicht
# aktualisierte systemd-Einheit ist ein Schoenheitsfehler; ein Update ohne
# Rueckweg ist keiner.
if [ -d "$INSTALL_DIR/deploy" ]; then
  EINHEITEN_NEU=false
  for einheit in patio-backup.service patio-backup.timer patio-backup-fehler@.service; do
    quelle="$INSTALL_DIR/deploy/$einheit"
    ziel="/etc/systemd/system/$einheit"
    [ -f "$quelle" ] || continue
    if ! cmp -s "$quelle" "$ziel" 2>/dev/null; then
      if cp "$quelle" "$ziel" 2>/dev/null; then
        EINHEITEN_NEU=true
        log "systemd-Einheit aktualisiert: $einheit"
      else
        log "WARNUNG: $einheit liess sich nicht nach /etc/systemd/system kopieren."
      fi
    fi
  done
  if [ "$EINHEITEN_NEU" = "true" ]; then
    systemctl daemon-reload 2>/dev/null \
      || log "WARNUNG: systemctl daemon-reload fehlgeschlagen — Einheiten greifen erst nach einem Neustart."
    log "systemd neu eingelesen. Der Timer-Zustand bleibt unveraendert."
  fi
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

# ── Nur der Proxy kaputt? Dann NUR den Proxy zuruecknehmen ──────────────────
#
# Ein Tippfehler in einer Zeile des Caddyfile darf kein Downgrade der
# Anwendung ausloesen. Der grosse Rueckweg unten taggt `patio-app:latest` auf
# das vorige Image zurueck — und das laeuft dann gegen ein Schema, das die
# neue Fassung bereits VORWAERTS migriert hat. Aus einem Einzeiler in der
# Proxy-Konfiguration wuerde so ein Fall fuer die Ruecksicherung.
#
# Antwortet die App also einwandfrei und hakt es nur am Proxy, wird genau das
# zurueckgenommen, was den Schaden verursacht hat: `docker/` aus `.vorher`,
# danach den Proxy erneut erzeugen.
if [ "$GESUND" = "true" ] && [ "$CADDY_KAPUTT" = "true" ]; then
  echo
  log "Die Anwendung antwortet, aber der Proxy kam mit der neuen Konfiguration"
  log "nicht hoch. Es wird NUR die Proxy-Konfiguration zurueckgenommen — das"
  log "Programm-Abbild bleibt auf dem neuen Stand, denn seine Migrationen sind"
  log "bereits angewendet und laufen nur vorwaerts."
  if [ -d "$BEISEITE/docker" ]; then
    rm -rf "${INSTALL_DIR:?}/docker"
    cp -a "$BEISEITE/docker" "$INSTALL_DIR/"
    log "Vorige Proxy-Konfiguration zurueckgespielt."
  fi
  docker compose up -d --force-recreate caddy || log "Caddy liess sich nicht neu erzeugen."
  sleep 5
  if [ "$(docker inspect -f '{{.State.Status}}' patio-caddy 2>/dev/null || echo fehlt)" = "running" ]; then
    # Die ANWENDUNG ist auf dem neuen Stand — nur der Proxy laeuft mit der
    # vorigen Konfiguration. Die Versionsdatei muss das sagen, sonst behauptet
    # `patio status` einen Stand, der nicht laeuft, und das naechste Update
    # rechnet mit der falschen Ausgangslage.
    if [ -n "$PAKET_VERSION" ]; then
      printf '%s
' "$PAKET_VERSION" > "$VERSION_DATEI"
      log "Stand vermerkt: $PAKET_VERSION (die Anwendung ist aktualisiert)."
    fi
    rm -f "$MARKER"
    echo
    echo "════════════════════════════════════════════════════════"
    echo "Die Anwendung ist aktualisiert, der Proxy laeuft wieder mit der"
    echo "VORIGEN Konfiguration."
    echo "════════════════════════════════════════════════════════"
    echo
    echo "Der Caddyfile aus dem Paket ist fehlerhaft — er liegt zum Vergleich"
    echo "unter $BEISEITE/docker/Caddyfile (der alte, laufende Stand)."
    echo "Bitte beim Paketbau nachsehen: docker/Caddyfile."
    exit 1
  fi
  log "Auch mit der vorigen Konfiguration kommt der Proxy nicht hoch —"
  log "weiter zum vollstaendigen Rueckweg."
fi

# Der Proxy zaehlt mit: Eine App, die intern antwortet, waehrend der einzige
# Zugangsweg der Arbeitsplaetze tot ist, ist KEIN gelungenes Update.
if [ "$GESUND" = "true" ] && [ "$CADDY_KAPUTT" != "true" ]; then
  # Erst jetzt festschreiben — vor der Gesundheitspruefung waere es eine
  # Behauptung ueber einen Dienst, der vielleicht gar nicht laeuft.
  if [ -n "$PAKET_VERSION" ]; then
    printf '%s\n' "$PAKET_VERSION" > "$VERSION_DATEI"
    log "Stand vermerkt: $PAKET_VERSION (in $VERSION_DATEI)"
  fi
  # Das Verzeichnis ist wieder in einem ganzen Zustand - die Abbruch-Marke
  # kann weg. `.vorher` bleibt bewusst liegen: es ist der Rueckweg von Hand,
  # falls sich der neue Stand erst im Betrieb als untauglich erweist.
  rm -f "$MARKER"
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
if [ "$CADDY_KAPUTT" = "true" ]; then
  log "Der Proxy kam mit der neuen Konfiguration nicht hoch. Letzte Protokollzeilen:"
else
  log "Der Dienst antwortet nicht. Letzte Protokollzeilen:"
fi
docker compose logs --tail 30 app || true

# Die Image-Kennung bevorzugt aus `.vorher/IMAGE_ID`: Im zweiten Anlauf nach
# einem Abbruch zeigt `patio-app:latest` laengst auf das NEUE Image - die beim
# ERSTEN Anlauf beiseitegelegte Kennung ist dann die einzig richtige.
#
# Fehlt die Datei, obwohl der Marker lag, gab es beim ersten Anlauf GAR KEIN
# voriges Image — der Fall einer gescheiterten ERSTinstallation. Dann waere
# `VORHER_ID` aus `docker images` das NEUE Image, und der Rueckweg wuerde es
# als „voriges" zuruecktaggen und Erfolg melden. Die Kennung wird deshalb
# ausdruecklich verworfen: Es gibt hier nichts, wohin man zurueck koennte.
if [ -f "$BEISEITE/IMAGE_ID" ]; then
  VORHER_ID=$(cat "$BEISEITE/IMAGE_ID")
elif [ "$MARKER_LAG" = "true" ]; then
  log "Kein voriges Image vermerkt — der abgebrochene Anlauf hatte keines"
  log "(gescheiterte Erstinstallation). Es gibt keinen Weg zurueck auf ein"
  log "frueheres Image."
  VORHER_ID=""
fi
if [ -n "$VORHER_ID" ]; then
  log "Zurueck auf das vorige Image..."
  docker tag "$VORHER_ID" patio-app:latest

  # Und zurueck auf die vorige Konfiguration. Ohne diesen Schritt liefe das
  # alte Image gegen die NEUE Compose-Datei — und scheiterte womoeglich am
  # selben Punkt wie das neue.
  #
  # ACHTUNG, `scripts/` ist hier BEWUSST ausgenommen: dieses Skript laeuft
  # selbst aus diesem Verzeichnis. Ein `cp` darueber schneidet die Datei ab,
  # die bash gerade zeilenweise liest — sie fuehrt dann Bruchstueck-Kommandos
  # aus (die Begruendung steht ausfuehrlich beim Einspielen weiter oben). Die
  # Skripte des vorigen Stands bleiben unter $BEISEITE/scripts liegen und
  # koennen nach dem Lauf von Hand zurueckgeholt werden; der Hinweis dazu steht
  # in der Abschlussmeldung.
  if [ -d "$BEISEITE" ]; then
    for teil in docker-compose.yml .env.example docker deploy; do
      if [ -e "$BEISEITE/$teil" ]; then
        rm -rf "${INSTALL_DIR:?}/$teil"
        cp -a "$BEISEITE/$teil" "$INSTALL_DIR/"
      fi
    done
    log "Vorige Compose-Datei, docker/ und deploy/ zurueckgespielt."
    log "Die vorigen Skripte liegen unter $BEISEITE/scripts — sie werden NICHT"
    log "automatisch zurueckgespielt, weil dieses Skript selbst dazugehoert."
  fi
  # Die Versionsdatei mit zuruecknehmen — sonst weist sie auf einen Stand,
  # der hier gerade NICHT laeuft, und das ist schlimmer als keine Angabe.
  if [ -n "$VORHER_VERSION" ]; then
    printf '%s\n' "$VORHER_VERSION" > "$VERSION_DATEI"
  else
    rm -f "$VERSION_DATEI"
  fi
  docker compose up -d app || log "App liess sich nicht starten — Pruefung unten sagt mehr."
  # Caddy auch im Rueckweg neu erzeugen: docker/ wurde gerade zurueckgespielt,
  # der laufende Container haelt aber noch den Caddyfile des NEUEN Standes fest
  # (dieselbe Inode-Falle wie beim Einspielen, nur rueckwaerts).
  docker compose up -d --force-recreate caddy || log "Caddy liess sich nicht neu erzeugen."
  # Die Dateien sind wieder auf dem alten Stand - der Rueckweg ist vollzogen,
  # die Abbruch-Marke kann weg. Ob der alte Dienst antwortet, prueft die
  # Schleife darunter; fuer die Frage "sind die Dateien ganz?" ist das egal.
  rm -f "$MARKER"
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
