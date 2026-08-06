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
#   konfiguration.tar.gz → .env, data/, tools/
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
  STAND=$(find "$BACKUP_DIR"/{taeglich,woechentlich,monatlich} -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
          | while read -r d; do [ -f "$d/VOLLSTAENDIG" ] && echo "$d"; done \
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
if [ "$APP_LIEF" = "true" ]; then
  log "Dienst starten..."
  docker start "$APP_CONTAINER" >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$APP_CONTAINER" curl -fsS -o /dev/null http://localhost:3000/api/health 2>/dev/null && break
    sleep 1
  done
fi

DAUER=$(( $(date +%s) - BEGINN ))

echo
echo "════════════════════════════════════════════════════════"
echo "Ruecksicherung abgeschlossen in ${DAUER} Sekunden"
echo "  (= $((DAUER / 60)) Minuten $((DAUER % 60)) Sekunden)"
echo "════════════════════════════════════════════════════════"
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
