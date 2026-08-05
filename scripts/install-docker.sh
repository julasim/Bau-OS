#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO Docker-Installations-Script
# Installiert PATIO als Docker-Compose-Stack: postgres + app.
#
# Verwendung:
#   curl -fsSL https://raw.githubusercontent.com/julasim/patio/main/scripts/install-docker.sh | bash
#   oder:
#   bash scripts/install-docker.sh
#
# WAS SICH GEGENUEBER FRUEHER GEAENDERT HAT:
#   Das Script sprach von vier Services (postgres, ollama, app, caddy) und
#   rief `docker compose pull postgres ollama caddy` auf. In der
#   docker-compose.yml stehen nur noch zwei: `ollama` ist mit AP0 entfallen,
#   `caddy` gibt es nur im Standalone-File (docker/docker-compose.standalone.yml,
#   fuer Kunden-Installationen ueber install-customer.sh). TLS und Routing
#   uebernimmt hier der gemeinsame Edge-Proxy ueber das externe Docker-Netz
#   `proxy` — die App veroeffentlicht selbst KEINEN Host-Port.
#
#   Ausserdem wurden BOT_TOKEN und OLLAMA_* abgefragt und in die .env
#   geschrieben, DATABASE_URL dagegen nirgends. Beides ist korrigiert.
# ─────────────────────────────────────────────────────────────────────────────

set -e

export LANG=de_AT.UTF-8
export LC_ALL=de_AT.UTF-8
export LANGUAGE=de_AT.UTF-8

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────────────────
readonly INSTALL_DIR_DEFAULT="/opt/patio"
readonly WORKSPACE_DIR_DEFAULT="/opt/patio-workspace"
readonly REPO_URL="https://github.com/julasim/patio.git"

# ─────────────────────────────────────────────────────────────────────────────
# Farben & Formatierung
# ─────────────────────────────────────────────────────────────────────────────
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly BLUE='\033[1;34m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# Hilfsfunktionen
# ─────────────────────────────────────────────────────────────────────────────
ok()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  !${NC} $1"; }
err()   { echo -e "${RED}  ✗${NC} $1"; exit 1; }

print_logo() {
  echo ""
  echo -e "${CYAN}              /\\${NC}"
  echo -e "${CYAN}            /    \\${NC}"
  echo -e "${CYAN}          /  ${BLUE}.---.${CYAN}  \\          ${DIM}__|__${NC}"
  echo -e "${CYAN}        /  ${BLUE}/ o o \\${CYAN}  \\        ${DIM}|     |${NC}"
  echo -e "${CYAN}       |  ${BLUE}( \\_|_/ )${CYAN}  |  ${DIM}----+     |${NC}"
  echo -e "${CYAN}       |   ${BLUE}\\ === /${CYAN}   |       ${DIM}|     |${NC}"
  echo -e "${CYAN}        \\   ${BLUE}'---'${CYAN}   /        ${DIM}|_____|${NC}"
  echo -e "${CYAN}          \\       /         ${DIM}|   |${NC}"
  echo -e "${CYAN}            \\   /           ${DIM}|   |${NC}"
  echo -e "${CYAN}              \\/${NC}"
  echo ""
  echo -e "${BLUE}  ██████╗  █████╗ ██╗   ██╗      ██████╗ ███████╗${NC}"
  echo -e "${BLUE}  ██╔══██╗██╔══██╗██║   ██║     ██╔═══██╗██╔════╝${NC}"
  echo -e "${BLUE}  ██████╔╝███████║██║   ██║     ██║   ██║███████╗${NC}"
  echo -e "${BLUE}  ██╔══██╗██╔══██║██║   ██║     ██║   ██║╚════██║${NC}"
  echo -e "${BLUE}  ██████╔╝██║  ██║╚██████╔╝     ╚██████╔╝███████║${NC}"
  echo -e "${BLUE}  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝       ╚═════╝ ╚══════╝${NC}"
  echo ""
  echo -e "  ${CYAN}Bürosoftware für Architektur- und Planungsbüros${NC}  ${DIM}[Docker]${NC}"
  echo -e "  ${DIM}────────────────────────────────────────────────${NC}"
  echo ""
}

print_header() {
  echo ""
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║${NC}  $1"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
}

print_section() {
  echo ""
  echo -e "${BOLD}── $1${NC}"
  echo ""
}

step() {
  echo ""
  echo -e "${YELLOW}▶${NC} ${BOLD}$1${NC}"
}

info() {
  echo -e "${DIM}   $1${NC}"
}

select_option() {
  local prompt="$1"
  shift
  local options=("$@")
  local choice

  echo "" >&2
  for i in "${!options[@]}"; do
    echo -e "  [$((i + 1))] ${options[$i]}" >&2
  done
  echo "" >&2

  while true; do
    read -rp "  $prompt: " choice < /dev/tty
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#options[@]}" ]; then
      echo "$choice"
      return
    fi
    echo -e "  ${RED}Ungültige Eingabe. Bitte 1-${#options[@]} eingeben.${NC}" >&2
  done
}

ask_required() {
  local prompt="$1"
  local var
  while true; do
    read -rp "  $prompt: " var < /dev/tty
    if [ -n "$var" ]; then
      echo "$var"
      return
    fi
    echo -e "  ${RED}Darf nicht leer sein. Bitte erneut eingeben.${NC}" >&2
  done
}

ask_default() {
  local prompt="$1"
  local default="$2"
  local var
  read -rp "  $prompt [$default]: " var < /dev/tty
  echo "${var:-$default}"
}

validate_path() {
  local path="$1"
  if [[ "$path" =~ ^[a-zA-Z0-9/._-]+$ ]]; then
    return 0
  fi
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Docker prüfen
# ─────────────────────────────────────────────────────────────────────────────
check_docker() {
  if ! command -v docker &>/dev/null; then
    err "Docker nicht gefunden. Installiere Docker: https://docs.docker.com/engine/install/"
  fi

  if ! docker compose version &>/dev/null; then
    err "Docker Compose v2 nicht gefunden. Installiere Docker Desktop oder das compose Plugin."
  fi

  if ! docker info &>/dev/null; then
    err "Docker-Daemon läuft nicht oder fehlende Berechtigung. Starte Docker oder füge deinen User zur docker-Gruppe hinzu: sudo usermod -aG docker \$USER"
  fi

  ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) + Compose $(docker compose version --short) gefunden"
}

# ─────────────────────────────────────────────────────────────────────────────
# Hauptprogramm
# ─────────────────────────────────────────────────────────────────────────────
print_logo
print_header "PATIO Installation (Docker)"

echo "Dieses Script installiert PATIO als Docker-Compose-Stack."
echo "2 Services: postgres (Datenbank) und app (Web-API + Weboberfläche)."
echo "TLS und Domain-Routing übernimmt der gemeinsame Edge-Proxy (/opt/proxy)."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 1: Docker prüfen
# ═════════════════════════════════════════════════════════════════════════════
print_section "Voraussetzungen"
check_docker

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 2: Konfiguration abfragen
# ═════════════════════════════════════════════════════════════════════════════
print_section "Konfiguration"

# ── Installationspfade ────────────────────────────────────────────────────────
INSTALL_DIR=$(ask_default "Installationsverzeichnis (Repo + docker-compose.yml)" "$INSTALL_DIR_DEFAULT")
WORKSPACE_DIR=$(ask_default "Workspace-Verzeichnis (Benutzerdaten)" "$WORKSPACE_DIR_DEFAULT")

if ! validate_path "$INSTALL_DIR"; then
  err "Ungültiger Installationspfad: $INSTALL_DIR"
fi
if ! validate_path "$WORKSPACE_DIR"; then
  err "Ungültiger Workspace-Pfad: $WORKSPACE_DIR"
fi

# ── Web-Oberfläche ────────────────────────────────────────────────────────────
echo -e "  ${BOLD}Web-Oberfläche${NC}"
info "Erstelle den ersten Admin-Benutzer."
echo ""
WEB_USER=$(ask_default "Admin Benutzername" "admin")
while true; do
  read -rsp "  Admin Passwort: " WEB_PASS < /dev/tty
  echo ""
  if [ -n "$WEB_PASS" ]; then
    read -rsp "  Passwort wiederholen: " WEB_PASS2 < /dev/tty
    echo ""
    if [ "$WEB_PASS" = "$WEB_PASS2" ]; then
      break
    fi
    echo -e "  ${RED}Passwörter stimmen nicht überein. Erneut eingeben.${NC}"
  else
    echo -e "  ${RED}Passwort darf nicht leer sein.${NC}"
  fi
done
echo ""

# ── Zusammenfassung ───────────────────────────────────────────────────────────
print_section "Zusammenfassung"
info "Services:     postgres + app (Docker Compose)"
info "Web-Admin:    $WEB_USER"
info "Install-Pfad: $INSTALL_DIR"
info "Workspace:    $WORKSPACE_DIR"
echo ""
read -rp "  Installation starten? [j/N]: " CONFIRM < /dev/tty
if [[ ! "$CONFIRM" =~ ^[jJ]$ ]]; then
  echo "Abgebrochen."
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 3: Repo klonen
# ═════════════════════════════════════════════════════════════════════════════
step "PATIO Repository klonen..."
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Verzeichnis existiert bereits — führe Update durch"
  cd "$INSTALL_DIR"
  git pull
elif [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  warn "Verzeichnis $INSTALL_DIR existiert aber ist kein Git-Repo — wird bereinigt"
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR" || err "git clone fehlgeschlagen. Ist das Repo öffentlich auf GitHub?"
  cd "$INSTALL_DIR"
else
  git clone "$REPO_URL" "$INSTALL_DIR" || err "git clone fehlgeschlagen. Ist das Repo öffentlich auf GitHub?"
  cd "$INSTALL_DIR"
fi
ok "Repository bereit: $INSTALL_DIR"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 4: Verzeichnisse anlegen
# ═════════════════════════════════════════════════════════════════════════════
step "Verzeichnisse anlegen..."
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/tools"
mkdir -p "$INSTALL_DIR/data"
# `.chat_id` war ein Telegram-Artefakt und wird hier nicht mehr angelegt —
# patio.service hat es bereits aus seinen ReadWritePaths entfernt.
ok "Verzeichnisse erstellt"

# Das Proxy-Netz stellt der zentrale Edge-Proxy bereit; docker-compose.yml
# deklariert es als `external: true`. Fehlt es, verweigert Compose den Start
# mit "network proxy declared as external, but could not be found".
if ! docker network inspect proxy >/dev/null 2>&1; then
  docker network create proxy >/dev/null
  ok "Docker-Netz 'proxy' angelegt"
else
  ok "Docker-Netz 'proxy' vorhanden"
fi

# Kurzform für docker compose mit Projekt-Pfaden
dc() {
  docker compose -f "$INSTALL_DIR/docker-compose.yml" --project-directory "$INSTALL_DIR" "$@"
}

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 5: Docker-Image bauen
# ═════════════════════════════════════════════════════════════════════════════
step "Docker-Images vorbereiten..."
info "2 Services: postgres (Datenbank) und app (PATIO)."
info "Das Postgres-Image wird gezogen, 'app' lokal gebaut."
echo ""

# .env erstellen — Service-Namen aus docker-compose.yml als Hostnames.
JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
cat > "$INSTALL_DIR/.env" << ENVEOF
# PATIO Konfiguration (generiert von install-docker.sh)
# Alle verfügbaren Schlüssel mit Erklärung: .env.example

WORKSPACE_PATH=/workspace
WORKSPACE_HOST_DIR=$WORKSPACE_DIR

# Pflicht für den Web-Login — ohne Secret bricht der Dienst beim Start ab.
JWT_SECRET=$JWT_SECRET
# Eigener Schlüssel für die Feld-Verschlüsselung (sonst Rückfall auf JWT_SECRET).
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_PORT=3000

# PostgreSQL — Container 'postgres' im compose-Netzwerk.
#
# DATABASE_URL steht hier BEWUSST nicht: docker-compose.yml setzt sie im
# Block services.app.environment aus den drei Variablen unten zusammen, und
# `environment` schlägt `env_file`. Ein Wert hier hätte also keine Wirkung.
# Wer die App ohne Docker betreibt, setzt stattdessen direkt
#   DATABASE_URL=postgres://patio:<PASSWORT>@localhost:5432/patio
POSTGRES_USER=patio
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=patio

# ── SMTP: Pflicht für den Login ──
# Der Login verschickt 6-stellige Codes per E-Mail. Ohne SMTP_HOST landet der
# Code nur im Container-Log (docker compose logs app).
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=PATIO <noreply@patio.local>
ENVEOF
chmod 600 "$INSTALL_DIR/.env"

# Nur postgres ziehen. `dc pull postgres ollama caddy` brach hier ab, weil
# Compose die beiden nicht mehr existierenden Service-Namen zurueckweist.
dc pull postgres < /dev/null || warn "Pull für das Postgres-Image fehlgeschlagen — versuche trotzdem weiter"
dc build app < /dev/null || err "App-Image konnte nicht gebaut werden. Siehe Fehler oben."
ok "Images bereit"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 6: Admin-User anlegen
# ═════════════════════════════════════════════════════════════════════════════
step "Web-Admin einrichten..."

# Sicherstellen dass das App-Image existiert — sonst schlaegt docker run
# mit einer irrefuehrenden "image not found" Meldung fehl
if ! docker image inspect patio-app:latest >/dev/null 2>&1; then
  err "Image patio-app:latest nicht gefunden. Build fehlgeschlagen? Pruefe: docker compose build app"
fi

# Passwort via gebautem Image hashen
# < /dev/null verhindert dass docker stdin vom Script (curl|bash) frisst
set +e
BCRYPT_OUTPUT=$(docker run --rm patio-app:latest \
  node -e "require('bcrypt').hash(process.argv[1],10).then(h=>console.log(h)).catch(e=>{console.error('ERR:'+e.message);process.exit(1)})" \
  "$WEB_PASS" < /dev/null 2>&1)
BCRYPT_CODE=$?
set -e

if [ $BCRYPT_CODE -ne 0 ]; then
  echo ""
  warn "bcrypt-Container lieferte Exit-Code $BCRYPT_CODE. Ausgabe:"
  echo "$BCRYPT_OUTPUT"
  err "Passwort-Hash konnte nicht erstellt werden."
fi

# Hash aus letzter Zeile extrahieren (und evtl. \r entfernen)
PASS_HASH=$(echo "$BCRYPT_OUTPUT" | tail -1 | tr -d '\r\n')

# Validieren: bcrypt-Hash beginnt mit $2[aby]$ und ist 60 Zeichen
if [ ${#PASS_HASH} -ne 60 ] || [[ ! "$PASS_HASH" =~ ^\$2[aby]\$ ]]; then
  echo ""
  warn "Ungueltiger Hash (Laenge ${#PASS_HASH}). Volle Ausgabe:"
  echo "$BCRYPT_OUTPUT"
  err "Passwort-Hash ungueltig. Docker-Image defekt?"
fi

cat > "$INSTALL_DIR/data/users.json" << USERSEOF
[{"username":"$WEB_USER","passwordHash":"$PASS_HASH","role":"admin","createdAt":"$(date +%Y-%m-%d)"}]
USERSEOF
chmod 600 "$INSTALL_DIR/data/users.json"
ok "Admin-User '$WEB_USER' erstellt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 7: Container starten
# ═════════════════════════════════════════════════════════════════════════════
step "Container starten..."
dc up -d < /dev/null || err "Container konnten nicht gestartet werden. Siehe Fehler oben."

# Health-Check GEGEN DEN CONTAINER, nicht gegen den Host.
#
# Frueher wurde hier `curl http://localhost:80` geprueft — das setzte den
# caddy-Service voraus, den es in dieser compose-Datei nicht gibt. Die App
# veroeffentlicht bewusst keinen Host-Port (`expose: 3000`), erreichbar ist
# sie nur ueber das Proxy-Netz. Der Check laeuft deshalb im app-Container
# gegen /api/health — den einzigen Endpunkt ohne Auth und Rate-Limit.
#
# node:http statt fetch: keine Abhaengigkeit von globalem fetch, und der
# Exit-Code ist eindeutig.
echo ""
info "Warte auf PATIO... (erster Start kann einige Minuten dauern —"
info "Postgres-Init, Migrationen, App-Start)"
HEALTH_JS='require("http").get("http://127.0.0.1:3000/api/health",r=>process.exit(r.statusCode===200?0:1)).on("error",()=>process.exit(1))'
for i in $(seq 1 180); do
  if dc exec -T app node -e "$HEALTH_JS" < /dev/null >/dev/null 2>&1; then
    ok "PATIO läuft (Health-Check grün nach ${i}s)"
    break
  fi
  # Alle 30s ein Lebenszeichen ausgeben, damit der User sieht dass noch gewartet wird
  if [ $((i % 30)) -eq 0 ]; then
    info "... noch nicht bereit (${i}s) — pruefe Services:"
    dc ps --format "table {{.Service}}\t{{.Status}}" 2>/dev/null | tail -n +2 | while read -r line; do
      info "   $line"
    done
  fi
  if [ "$i" -eq 180 ]; then
    echo ""
    warn "Health-Check nach 180s fehlgeschlagen. Logs (letzte 30 Zeilen pro Service):"
    echo ""
    dc logs --tail 30
    echo ""
    err "PATIO ist nicht hochgekommen. Siehe Logs oben — typische Ursachen:
       Postgres-Init haengt, DATABASE_URL/JWT_SECRET fehlt in der .env,
       oder das Docker-Netz 'proxy' existiert nicht."
  fi
  sleep 1
done

# SCHRITT 8 (LLM-Modelle und Embedding-Modell ziehen) ist ersatzlos entfallen.
# Seit AP0 gibt es weder LLM-Laufzeit noch Embeddings — und auf einem
# Firmenserver ohne Internet waren die `ollama pull`-Aufrufe ohnehin nicht
# durchfuehrbar.

# ═════════════════════════════════════════════════════════════════════════════
# patio-update Shortcut installieren
# ═════════════════════════════════════════════════════════════════════════════
if [ -f "$INSTALL_DIR/scripts/docker-update.sh" ]; then
  # Exec-Bit auf das Zielskript (git unter Windows/OneDrive verliert es oefter)
  chmod +x "$INSTALL_DIR/scripts/docker-update.sh" 2>/dev/null || true
  ln -sf "$INSTALL_DIR/scripts/docker-update.sh" /usr/local/bin/patio-update 2>/dev/null || true
fi

# ═════════════════════════════════════════════════════════════════════════════
# FERTIG
# ═════════════════════════════════════════════════════════════════════════════
echo ""
print_header "Installation abgeschlossen!"
echo ""
echo -e "  ${YELLOW}▸${NC} ${BOLD}Noch offen: Eintrag im Edge-Proxy.${NC}"
echo    "    Die App veröffentlicht keinen Host-Port — erreichbar wird sie erst"
echo    "    über den gemeinsamen Edge-Proxy. Dort in der Caddyfile ergänzen:"
echo ""
echo    "      patio.meine-firma.at {"
echo    "          encode gzip zstd"
echo    "          @stream path /api/events*"
echo    "          reverse_proxy @stream app:3000 { flush_interval -1 }"
echo    "          reverse_proxy app:3000"
echo    "      }"
echo ""
echo    "    Danach: docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile"
echo    "    Login: ${WEB_USER} / (dein gewähltes Passwort)"
echo ""
echo -e "  ${YELLOW}▸${NC} ${BOLD}Noch offen: SMTP eintragen.${NC}"
echo    "    Der Login schickt 6-stellige Codes per E-Mail. Solange SMTP_HOST in"
echo    "    ${INSTALL_DIR}/.env leer ist, steht der Code nur im Log."
echo    "    Nach dem Eintragen: docker compose up -d --force-recreate app"
echo    "    (ein blosses 'restart' liest die .env nicht neu ein)"
echo ""
echo -e "  ${BOLD}Update:${NC}"
echo -e "    ${GREEN}patio-update${NC}                  → Pull + Rebuild + Restart"
echo ""
echo -e "  ${BOLD}Docker-Befehle${NC} (in $INSTALL_DIR):"
echo    "    docker compose logs -f                    → alle Logs"
echo    "    docker compose logs -f app                → nur PATIO"
echo    "    docker compose restart app                → PATIO neu starten"
echo    "    docker compose down                       → alles stoppen"
echo    "    docker compose exec app bash              → Shell in PATIO"
echo    "    docker compose exec app npm run db:status → Migrationsstand"
echo ""
