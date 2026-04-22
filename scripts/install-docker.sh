#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Docker-Installations-Script
# Installiert Bau-OS als Docker-Compose-Stack (postgres + ollama + app + caddy)
#
# Verwendung:
#   curl -fsSL https://raw.githubusercontent.com/julasim/Bau-OS/main/scripts/install-docker.sh | bash
#   oder:
#   bash scripts/install-docker.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

export LANG=de_AT.UTF-8
export LC_ALL=de_AT.UTF-8
export LANGUAGE=de_AT.UTF-8

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────────────────
readonly INSTALL_DIR_DEFAULT="/opt/bau-os"
readonly WORKSPACE_DIR_DEFAULT="/opt/bau-os-workspace"
readonly REPO_URL="https://github.com/julasim/Bau-OS.git"

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
  echo -e "  ${CYAN}KI-Assistent für die Baubranche${NC}  ${DIM}[Docker]${NC}"
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
print_header "Bau-OS Installation (Docker)"

echo "Dieses Script installiert Bau-OS als Docker-Compose-Stack."
echo "4 Services: postgres (pgvector), ollama, app (Bau-OS), caddy (Reverse-Proxy + HTTPS)."
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

# ── Telegram Bot Token ────────────────────────────────────────────────────────
echo -e "  ${BOLD}Telegram Bot Token${NC}"
info "Erstelle einen Bot via @BotFather in Telegram → /newbot"
echo ""
BOT_TOKEN=$(ask_required "Bot Token")
echo ""

# ── LLM-Modus ────────────────────────────────────────────────────────────────
echo -e "  ${BOLD}LLM-Modus${NC}"
info "Cloud: kein lokaler RAM nötig, benötigt Ollama-Konto (ollama.com)"
info "Lokal: Modell wird heruntergeladen, braucht mind. 8 GB RAM"
LLM_CHOICE=$(select_option "Auswahl" \
  "Cloud  (empfohlen — kimi-k2.5, gemma4, qwen3 etc.)" \
  "Lokal  (qwen2.5:7b, llama3.1:8b etc.)")

if [ "$LLM_CHOICE" -eq 1 ]; then
  LLM_MODE="cloud"
  echo ""
  info "Verfügbare Cloud-Modelle: kimi-k2.5:cloud, gemma4:cloud, qwen3-next:cloud"
  OLLAMA_MODEL=$(ask_default "Modell" "kimi-k2.5:cloud")
else
  LLM_MODE="local"
  echo ""
  info "Verfügbare lokale Modelle: qwen2.5:7b (~4.3GB), llama3.1:8b (~4.7GB), qwen2.5:3b (~2GB)"
  OLLAMA_MODEL=$(ask_default "Modell" "qwen2.5:7b")
fi

echo ""

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
info "Bot Token:    ${BOT_TOKEN:0:8}...${BOT_TOKEN: -4}"
info "LLM-Modus:    $LLM_MODE ($OLLAMA_MODEL)"
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
step "Bau-OS Repository klonen..."
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
touch "$INSTALL_DIR/.chat_id"
ok "Verzeichnisse erstellt"

# Kurzform für docker compose mit Projekt-Pfaden
dc() {
  docker compose -f "$INSTALL_DIR/docker-compose.yml" --project-directory "$INSTALL_DIR" "$@"
}

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 5: Docker-Image bauen
# ═════════════════════════════════════════════════════════════════════════════
step "Docker-Images vorbereiten..."
info "4 Services: postgres (pgvector), ollama, app (Bau-OS), caddy."
info "Offizielle Images werden gezogen, nur 'app' lokal gebaut."
echo ""

# .env erstellen — Service-Namen aus docker-compose.yml als Hostnames.
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
cat > "$INSTALL_DIR/.env" << ENVEOF
# Bau-OS Konfiguration (generiert von install-docker.sh)
BOT_TOKEN=$BOT_TOKEN
WORKSPACE_PATH=/workspace
WORKSPACE_HOST_DIR=$WORKSPACE_DIR
OLLAMA_MODEL=$OLLAMA_MODEL
JWT_SECRET=$JWT_SECRET

# PostgreSQL — Container 'postgres' im compose-Netzwerk.
# DATABASE_URL wird von docker-compose.yml automatisch aus diesen
# drei Variablen zusammengesetzt (siehe services.app.environment).
# Nur relevant wenn du die App mal OHNE Docker laufen laesst — dann
# musst du DATABASE_URL=postgres://bauos:<PW>@localhost:5432/bauos
# zusaetzlich setzen.
POSTGRES_USER=bauos
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=bauos

# Caddy Reverse-Proxy — Domain leer = nur HTTP auf Port 80
# Sobald eine Domain gesetzt ist, holt Caddy automatisch ein Let's
# Encrypt Zertifikat (Port 80 + 443 muessen vom Internet erreichbar sein).
# Beispiel: CADDY_DOMAIN=bauos.meine-firma.at
CADDY_DOMAIN=
CADDY_EMAIL=admin@example.com

# App-Port INNERHALB des app-Containers. Caddy proxyt von 80/443
# darauf — hier aendern bringt nichts, weil Caddyfile fest auf
# app:3000 zeigt. Nur fuer Bare-Metal-Betrieb (ohne Docker) relevant.
API_PORT=3000
ENVEOF
chmod 600 "$INSTALL_DIR/.env"

# Offizielle Images ziehen, dann App bauen
dc pull postgres ollama caddy < /dev/null || warn "Pull für Standard-Images fehlgeschlagen — versuche trotzdem weiter"
dc build app < /dev/null || err "App-Image konnte nicht gebaut werden. Siehe Fehler oben."
ok "Images bereit"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 6: Admin-User anlegen
# ═════════════════════════════════════════════════════════════════════════════
step "Web-Admin einrichten..."

# Sicherstellen dass das App-Image existiert — sonst schlaegt docker run
# mit einer irrefuehrenden "image not found" Meldung fehl
if ! docker image inspect bau-os-app:latest >/dev/null 2>&1; then
  err "Image bau-os-app:latest nicht gefunden. Build fehlgeschlagen? Pruefe: docker compose build app"
fi

# Passwort via gebautem Image hashen
# < /dev/null verhindert dass docker stdin vom Script (curl|bash) frisst
set +e
BCRYPT_OUTPUT=$(docker run --rm bau-os-app:latest \
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
# SCHRITT 7: LLM-Modell vorbereiten
# ═════════════════════════════════════════════════════════════════════════════
# Ollama-Service einmal hochziehen (bleibt dann laufen), damit 'signin' und
# 'pull' ihn direkt erreichen. Postgres brauchen wir hier noch nicht.
dc up -d ollama < /dev/null || err "Ollama-Container konnte nicht gestartet werden"

# Kurz warten bis Ollama API antwortet
for i in $(seq 1 30); do
  if dc exec -T ollama ollama list >/dev/null 2>&1; then break; fi
  sleep 1
done

if [ "$LLM_MODE" = "cloud" ]; then
  step "Ollama Cloud einrichten..."
  info "Es wird ein Link angezeigt — öffne ihn im Browser oder Handy."
  info "Melde dich mit deinem Ollama-Konto an (ollama.com)."
  echo ""

  dc exec ollama ollama signin < /dev/tty || true

  echo ""
  echo -e "  ${YELLOW}→${NC} Sobald du dich im Browser angemeldet hast, drücke Enter."
  read -r < /dev/tty

  CLOUD_TEST=$(dc exec -T ollama ollama list 2>&1 < /dev/null || true)
  if echo "$CLOUD_TEST" | grep -qi "error\|unauthorized\|failed"; then
    warn "Ollama Cloud-Verbindung konnte nicht bestätigt werden"
    FAIL_CHOICE=$(select_option "Was möchtest du tun?" \
      "Auf lokales Modell umstellen (wird heruntergeladen)" \
      "Installation abbrechen" \
      "Trotzdem fortfahren (Login später nachholen)")

    case "$FAIL_CHOICE" in
      1)
        echo ""
        LLM_MODE="local"
        info "Verfügbare: qwen2.5:7b (~4.3GB), llama3.1:8b (~4.7GB), qwen2.5:3b (~2GB)"
        OLLAMA_MODEL=$(ask_default "Modell" "qwen2.5:3b")
        step "Modell herunterladen ($OLLAMA_MODEL)..."
        dc exec -T ollama ollama pull "$OLLAMA_MODEL" < /dev/null \
          || err "Modell-Download fehlgeschlagen"
        sed -i "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=$OLLAMA_MODEL|" "$INSTALL_DIR/.env"
        ok "Modell '$OLLAMA_MODEL' bereit"
        ;;
      2)
        echo "Abgebrochen."
        info "Login nachholen: docker compose exec ollama ollama signin"
        exit 0
        ;;
      3)
        warn "Installation wird fortgesetzt ohne Cloud-Bestätigung"
        info "Login nachholen: docker compose exec ollama ollama signin"
        ;;
    esac
  else
    ok "Cloud-Verbindung erfolgreich ($OLLAMA_MODEL)"
  fi
else
  step "Modell herunterladen ($OLLAMA_MODEL)..."
  warn "Das kann je nach Internetverbindung einige Minuten dauern..."

  dc exec -T ollama ollama pull "$OLLAMA_MODEL" < /dev/null \
    || err "Modell-Download fehlgeschlagen. Prüfe deine Internetverbindung."

  ok "Modell '$OLLAMA_MODEL' bereit"
fi

# Embedding-Modell IMMER lokal (auch bei Cloud-LLM):
# Cloud-Modelle bringen Embeddings nicht verlaesslich mit, nomic-embed-text
# ist klein (~270 MB), laeuft auf jeder CPU und spart Cloud-Credits.
step "Embedding-Modell herunterladen (nomic-embed-text)..."
dc exec -T ollama ollama pull nomic-embed-text < /dev/null \
  || warn "Embedding-Modell konnte nicht geladen werden — semantische Suche bleibt vorerst aus"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 8: Container starten
# ═════════════════════════════════════════════════════════════════════════════
step "Bau-OS Container starten..."
dc up -d

# Health-Check: Caddy proxt auf Port 80 nach app:3000 — egal welcher HTTP-Code.
# Timeout 180s: Postgres-Init + Extensions + Migrations + App-Start + Caddy-Start
# koennen beim allerersten Boot auf langsamen VPS zusammen ueber eine Minute dauern.
echo ""
info "Warte auf Bau-OS... (erster Start kann bis zu 3 Minuten dauern —"
info "Postgres init, Migrations, Ollama-Start, Caddy binden)"
for i in $(seq 1 180); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ]; then
    ok "Bau-OS läuft (HTTP $HTTP_CODE via Caddy, nach ${i}s)"
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
    err "Container konnten nicht gestartet werden. Siehe Logs oben — typische Ursachen: Postgres-Init haengt, Ollama-Modell-Download blockiert, Port 80 belegt."
  fi
  sleep 1
done

# ═════════════════════════════════════════════════════════════════════════════
# bau-os-update Shortcut installieren
# ═════════════════════════════════════════════════════════════════════════════
if [ -f "$INSTALL_DIR/scripts/docker-update.sh" ]; then
  # Exec-Bit auf das Zielskript (git unter Windows/OneDrive verliert es oefter)
  chmod +x "$INSTALL_DIR/scripts/docker-update.sh" 2>/dev/null || true
  ln -sf "$INSTALL_DIR/scripts/docker-update.sh" /usr/local/bin/bau-os-update 2>/dev/null || true
fi

# ═════════════════════════════════════════════════════════════════════════════
# FERTIG
# ═════════════════════════════════════════════════════════════════════════════
echo ""
print_header "Installation abgeschlossen!"
echo ""
echo -e "  ${GREEN}▸${NC} Öffne deinen Telegram Bot und schreibe ${BOLD}'Hallo'${NC}"
echo    "    Der Setup-Wizard führt dich durch die Einrichtung."
echo ""
echo -e "  ${GREEN}▸${NC} Web-Oberfläche: ${BOLD}http://<server-ip>${NC} (Port 80 via Caddy)"
echo    "    Login: ${WEB_USER} / (dein gewähltes Passwort)"
echo ""
echo -e "  ${GREEN}▸${NC} HTTPS aktivieren: Setze ${BOLD}CADDY_DOMAIN=deine.domain.at${NC} in der .env"
echo -e "    und führe ${GREEN}docker compose up -d caddy${NC} aus — Let's Encrypt läuft automatisch."
echo ""
echo -e "  ${BOLD}Update:${NC}"
echo -e "    ${GREEN}bau-os-update${NC}                  → Pull + Rebuild + Restart"
echo ""
echo -e "  ${BOLD}Docker-Befehle${NC} (in $INSTALL_DIR):"
echo    "    docker compose logs -f                    → alle Logs"
echo    "    docker compose logs -f app                → nur Bau-OS"
echo    "    docker compose logs -f ollama             → nur LLM"
echo    "    docker compose restart app                → Bau-OS neu starten"
echo    "    docker compose down                       → alles stoppen"
echo    "    docker compose exec app bash              → Shell in Bau-OS"
echo    "    docker compose exec ollama ollama list    → Modelle auflisten"
echo ""
