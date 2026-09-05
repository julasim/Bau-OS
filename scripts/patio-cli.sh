#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# patio — Verwaltungswerkzeug für den Firmenserver
#
# Nach der Einrichtung verfügbar als:  patio <befehl>
#
# Diese Fassung spricht den DOCKER-STACK an. Die vorherige arbeitete
# durchgehend mit `systemctl patio` und `systemctl postgresql` — beides gibt es
# auf dem Firmenserver nicht mehr, dort läuft alles als Compose-Stack
# (postgres + app + caddy).
#
# Bewusst NICHT übernommen: `patio user add`. Es schrieb Konten direkt in
# data/users.json — am Datenbank-Konto vorbei, mit eigenem bcrypt-Aufruf und
# ohne die Passwortregeln der Anwendung. Benutzerverwaltung läuft über die
# Weboberfläche unter /admin/users.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/patio}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/opt/patio-workspace}"
BACKUP_DIR="${BACKUP_DIR:-/mnt/patio-backup}"
APP="patio-app"
DB="patio-postgres"
PROXY="patio-caddy"

readonly GRUEN='\033[0;32m' GELB='\033[1;33m' ROT='\033[0;31m'
readonly FETT='\033[1m' MATT='\033[2m' AUS='\033[0m'

dc() { (cd "$INSTALL_DIR" && docker compose "$@"); }

braucht_root() {
  if [ "$EUID" -ne 0 ]; then
    echo -e "  ${ROT}✗${AUS} Dieser Befehl braucht root:  sudo patio $*"
    exit 1
  fi
}

laeuft() { docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$1"; }

zustandszeile() {
  local name="$1" beschriftung="$2"
  if laeuft "$name"; then
    local gesundheit
    gesundheit=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}—{{end}}' "$name" 2>/dev/null)
    echo -e "  ${GRUEN}●${AUS} ${FETT}${beschriftung}${AUS}  läuft ${MATT}(${gesundheit})${AUS}"
  else
    echo -e "  ${ROT}●${AUS} ${FETT}${beschriftung}${AUS}  gestoppt"
  fi
}

# ── Befehle ──────────────────────────────────────────────────────────────────

befehl_status() {
  echo
  zustandszeile "$DB"    "Datenbank"
  zustandszeile "$APP"   "PATIO"
  zustandszeile "$PROXY" "Zugang (HTTPS)"
  echo

  # Welcher Stand laeuft hier? Die Datei schreibt `update-offline.sh` nach
  # jedem erfolgreichen Einspielen und nimmt sie beim Rueckweg zurueck.
  # Ohne sie war das auf dem Server nicht feststellbar: docker-compose.yml
  # zeigt auf `patio-app:latest`, und diese Marke sieht vor und nach einem
  # Rueckweg gleich aus.
  if [ -f "$INSTALL_DIR/VERSION" ]; then
    echo -e "  ${MATT}Stand: $(cat "$INSTALL_DIR/VERSION")${AUS}"
  else
    echo -e "  ${MATT}Stand: unbekannt (vor dem 28.08.2026 eingespielt)${AUS}"
  fi
  echo

  if laeuft "$APP"; then
    if docker exec "$APP" curl -fsS -o /dev/null http://localhost:3000/api/health 2>/dev/null; then
      echo -e "  ${GRUEN}✓${AUS} Der Dienst antwortet."
    else
      echo -e "  ${ROT}✗${AUS} Der Container läuft, aber der Dienst antwortet nicht."
      echo -e "     ${MATT}patio logs${AUS} zeigt warum."
    fi
  fi

  # Wann lief die Sicherung zuletzt? Auf einem Server, der der einzige
  # Ausfallpunkt ist, gehört das auf die erste Bildschirmseite.
  echo
  if [ -d "$BACKUP_DIR/taeglich" ]; then
    local letzte
    letzte=$(find "$BACKUP_DIR/taeglich" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
             | while read -r d; do [ -f "$d/VOLLSTAENDIG" ] && echo "$d"; done | sort | tail -1)
    if [ -n "$letzte" ]; then
      local alter=$(( ($(date +%s) - $(stat -c %Y "$letzte")) / 3600 ))
      if [ "$alter" -gt 30 ]; then
        echo -e "  ${GELB}!${AUS} Letzte vollständige Sicherung vor ${alter} Stunden — das ist zu lang."
      else
        echo -e "  ${GRUEN}✓${AUS} Letzte Sicherung: $(basename "$letzte") ${MATT}(vor ${alter} h)${AUS}"
      fi
    else
      echo -e "  ${ROT}✗${AUS} Keine vollständige Sicherung gefunden."
    fi
  else
    echo -e "  ${GELB}!${AUS} Sicherungsplatte nicht eingehängt oder nicht eingerichtet."
  fi

  if [ -f "$INSTALL_DIR/logs/SICHERUNG-FEHLGESCHLAGEN" ]; then
    echo -e "  ${ROT}✗${AUS} $(cat "$INSTALL_DIR/logs/SICHERUNG-FEHLGESCHLAGEN")"
  fi
  echo
}

befehl_logs() {
  if [ "${1:-}" = "-f" ] || [ "${1:-}" = "live" ]; then
    echo -e "\n  ${FETT}Laufende Ausgabe${AUS} ${MATT}(Strg+C beendet)${AUS}\n"
    dc logs -f app
  else
    echo -e "\n  ${FETT}Letzte ${1:-50} Zeilen${AUS}\n"
    dc logs --tail "${1:-50}" app
  fi
}

befehl_start()   { braucht_root start;   echo; dc up -d;             sleep 3; befehl_status; }
befehl_stop()    { braucht_root stop;    echo; dc stop;              sleep 1; befehl_status; }
# `up -d --force-recreate` statt `restart`. Das ist kein Feinschliff:
# `docker compose restart` startet die vorhandenen Container neu und liest die
# `.env` dabei NICHT neu ein. Wer eine Einstellung aendert und danach den
# naheliegenden Befehl benutzt, arbeitet also weiter mit den alten Werten —
# ohne Hinweis. Dieselbe Falle steht im Server-Playbook.
#
# Nur `app` und `caddy`, NICHT `postgres` — aus zwei Gruenden:
#   1. `--force-recreate` ENTFERNT die Container und legt neue an; deren
#      stdout-Historie (`docker compose logs`) ist danach weg. Bei der App
#      verschmerzbar (logs/patio.jsonl haelt alles), bei Postgres waere es
#      zusaetzlich eine unnoetige Datenbank-Unterbrechung.
#   2. Die POSTGRES_*-Werte aus der .env uebernimmt Postgres ohnehin nur bei
#      LEEREM Datenverzeichnis — ein Neuerzeugen aendert daran nichts.
# Wer Caddys bisherige Protokollzeilen braucht, zieht sie VOR dem Neustart
# mit `patio logs`.
befehl_restart() { braucht_root restart; echo; dc up -d --force-recreate app caddy; sleep 3; befehl_status; }

befehl_update() {
  braucht_root update
  local paket="${1:-}"
  if [ -z "$paket" ]; then
    echo
    echo -e "  ${FETT}Aufruf:${AUS} sudo patio update <paket.tar.gz>"
    echo
    echo "  Das Paket entsteht auf dem Entwicklungsrechner mit"
    echo "  scripts/release-offline.sh und kommt per USB-Stick hierher."
    echo "  Auf diesem Rechner wird nie gebaut — er hat kein Internet."
    echo
    local gefunden
    gefunden=$(find "$INSTALL_DIR" -maxdepth 1 -name 'patio-*.tar.gz' 2>/dev/null | sort | tail -3)
    [ -n "$gefunden" ] && { echo "  Hier liegen bereits:"; echo "$gefunden" | sed 's|^|    |'; echo; }
    return 1
  fi
  bash "$INSTALL_DIR/scripts/update-offline.sh" "$paket"
}

befehl_sicherung() {
  braucht_root sicherung
  echo
  bash "$INSTALL_DIR/scripts/backup.sh"
}

befehl_ruecksicherung() {
  braucht_root ruecksicherung
  echo
  bash "$INSTALL_DIR/scripts/restore.sh" "${1:-}"
}

befehl_db() {
  echo
  if ! laeuft "$DB"; then
    echo -e "  ${ROT}✗${AUS} Die Datenbank läuft nicht."
    return 1
  fi
  # Direkt gegen _migrations. Hier stand ein Aufruf von
  # `node dist/scripts/db-migrate.js` — den Pfad gibt es nicht: tsconfig.json
  # baut nur src/**/*, scripts/ landet nie in dist/. Der Zweig scheiterte
  # also immer und fiel still auf die naechste Zeile zurueck.
  echo -e "  ${FETT}Migrationen:${AUS}\n"
  docker exec "$DB" psql -U "${POSTGRES_USER:-patio}" -d "${POSTGRES_DB:-patio}" -tAc \
    "SELECT count(*) || ' angewendet, zuletzt: ' || max(name) FROM _migrations" 2>/dev/null \
    | sed 's/^/    /' \
    || echo -e "  ${GELB}!${AUS} Migrationsstand nicht abrufbar."
  echo
  echo -e "  ${MATT}Direkte Abfrage:  docker exec -it $DB psql -U patio -d patio${AUS}"
  echo
}

befehl_env() {
  braucht_root env
  echo
  echo -e "  ${FETT}Konfiguration${AUS} ${MATT}($INSTALL_DIR/.env)${AUS}\n"
  # Geheimnisse nicht ausgeben — nur, ob sie gesetzt sind.
  while IFS='=' read -r schluessel wert; do
    case "$schluessel" in
      ''|\#*) continue ;;
      *SECRET*|*PASSWORD*|*KEY*)
        if [ -n "$wert" ]; then
          echo -e "    ${schluessel}=${MATT}<gesetzt, ${#wert} Zeichen>${AUS}"
        else
          echo -e "    ${schluessel}=${ROT}<LEER>${AUS}"
        fi ;;
      *) echo "    ${schluessel}=${wert}" ;;
    esac
  done < "$INSTALL_DIR/.env"
  echo
}

# Der Dokumentenordner — was davon ueblich bleibt.
#
# Bis zum 29.08.2026 war dieser Ordner die Samba-Freigabe „Dokumente": jeder
# konnte ihn im Explorer einbinden, und `vfs objects = recycle` legte darin
# einen Papierkorb je Person an. Beides ist entfallen.
#
# Was der Ordner heute ist: ein interner Ablageort, den nur der Dienst sieht.
# Er SCHREIBT dort nichts hinein — was in PATIO hochgeladen wird, liegt in der
# Datenbank. Gelesen wird nur noch fuer Alt-Datensaetze aus der Vault-Zeit,
# deren Inhalt nicht in der Datenbank steht.
#
# Die Eigentuemer-Pruefung bleibt trotzdem sinnvoll: gehoert der Ordner nicht
# uid 1000, bekommt der Dienst beim Nachlesen EACCES — und der Fehler zeigt
# sich als fehlgeschlagener Download an ganz anderer Stelle.
befehl_dokumente() {
  echo
  echo -e "  ${FETT}Dokumente${AUS} ${MATT}($WORKSPACE_DIR)${AUS}\n"
  echo "    Belegt:   $(du -sh "$WORKSPACE_DIR" 2>/dev/null | cut -f1)"
  echo "    Ordner:   $(find "$WORKSPACE_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l) ${MATT}(Altbestand)${AUS}"
  echo "    Eigentümer: $(stat -c '%u:%g' "$WORKSPACE_DIR" 2>/dev/null)  ${MATT}(muss 1000:1000 sein)${AUS}"
  local besitzer
  besitzer=$(stat -c '%u' "$WORKSPACE_DIR" 2>/dev/null)
  if [ "$besitzer" != "1000" ]; then
    echo
    echo -e "  ${ROT}✗${AUS} Falscher Eigentümer. Der Dienst läuft im Container als uid 1000"
    echo -e "     und kann alte Datensätze so nicht mehr lesen. Beheben:"
    echo -e "       ${FETT}sudo chown -R 1000:1000 $WORKSPACE_DIR${AUS}"
  fi
  echo
}

befehl_hilfe() {
  cat <<'HILFE'

  patio — Verwaltung des Firmenservers

  ANSEHEN
    patio status              Zustand aller Dienste, Sicherung, Erreichbarkeit
    patio logs [n]            letzte n Zeilen (Vorgabe 50)
    patio logs -f             laufende Ausgabe
    patio db                  Datenbank und Migrationsstand
    patio env                 Konfiguration (Geheimnisse bleiben verdeckt)
    patio dokumente           Dokumentenordner, Belegung, Rechte

  STEUERN                     (brauchen sudo)
    patio start | stop
    patio restart             Container neu erzeugen — liest auch die .env neu
    patio update <paket>      Auslieferungspaket einspielen
    patio sicherung           Sicherung jetzt ausführen
    patio ruecksicherung [stand]

  Benutzerverwaltung läuft über die Weboberfläche: /admin/users

HILFE
}

case "${1:-status}" in
  status)                     befehl_status ;;
  logs)                       befehl_logs "${2:-}" ;;
  start)                      befehl_start ;;
  stop)                       befehl_stop ;;
  restart)                    befehl_restart ;;
  update)                     befehl_update "${2:-}" ;;
  sicherung|backup)           befehl_sicherung ;;
  ruecksicherung|restore)     befehl_ruecksicherung "${2:-}" ;;
  db|datenbank)               befehl_db ;;
  env|config)                 befehl_env ;;
  dokumente|workspace)        befehl_dokumente ;;
  help|hilfe|--help|-h)       befehl_hilfe ;;
  *)
    echo -e "\n  ${ROT}Unbekannter Befehl:${AUS} $1"
    befehl_hilfe
    exit 1 ;;
esac
