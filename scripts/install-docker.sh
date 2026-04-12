#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Docker-Installations-Script
# Installiert Bau-OS als Docker-Container (alles in einem: App + Ollama)
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
readonly REPO_URL="https://github.com/julasim/Obsidian-OS.git"

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

echo "Dieses Script installiert Bau-OS als Docker-Container."
echo "Alles läuft in einem Container: App + Ollama."
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
API_PORT=$(ask_default "Web-Port" "3000")
echo ""

# ── Zusammenfassung ───────────────────────────────────────────────────────────
print_section "Zusammenfassung"
info "Bot Token:    ${BOT_TOKEN:0:8}...${BOT_TOKEN: -4}"
info "LLM-Modus:    $LLM_MODE ($OLLAMA_MODEL)"
info "Web-Admin:    $WEB_USER (Port $API_PORT)"
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
step "Docker-Image bauen (das dauert beim ersten Mal einige Minuten)..."
info "Lädt Ubuntu 24.04 + Node.js 20 + Ollama herunter und kompiliert den Code."
echo ""

# .env erstellen (WORKSPACE_HOST_DIR für docker-compose Volume-Mount)
JWT_SECRET=$(openssl rand -hex 32)
cat > "$INSTALL_DIR/.env" << ENVEOF
# Bau-OS Konfiguration (generiert von install-docker.sh)
BOT_TOKEN=$BOT_TOKEN
WORKSPACE_PATH=$WORKSPACE_DIR
WORKSPACE_HOST_DIR=$WORKSPACE_DIR
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=$OLLAMA_MODEL
JWT_SECRET=$JWT_SECRET
API_PORT=$API_PORT
ENVEOF
chmod 600 "$INSTALL_DIR/.env"

dc build || err "Docker-Image konnte nicht gebaut werden. Siehe Fehler oben."
ok "Docker-Image gebaut"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 6: Admin-User anlegen
# ═════════════════════════════════════════════════════════════════════════════
step "Web-Admin einrichten..."

# Passwort via gebautem Image hashen (kein Node.js auf Host nötig)
PASS_HASH=$(dc run --rm --no-deps bau-os \
  node -e "const b=require('bcrypt'); b.hash(process.argv[1],10).then(h=>console.log(h))" \
  "$WEB_PASS" 2>&1 | tail -1)

# Validieren: bcrypt-Hash beginnt immer mit $2b$ und ist 60 Zeichen lang
if [ ${#PASS_HASH} -ne 60 ] || [[ ! "$PASS_HASH" =~ ^\$2[aby]\$ ]]; then
  err "Passwort-Hash konnte nicht erstellt werden. Docker-Image defekt?"
fi

cat > "$INSTALL_DIR/data/users.json" << USERSEOF
[{"username":"$WEB_USER","passwordHash":"$PASS_HASH","role":"admin","createdAt":"$(date +%Y-%m-%d)"}]
USERSEOF
chmod 600 "$INSTALL_DIR/data/users.json"
ok "Admin-User '$WEB_USER' erstellt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 7: LLM-Modell vorbereiten
# ═════════════════════════════════════════════════════════════════════════════
if [ "$LLM_MODE" = "cloud" ]; then
  step "Ollama Cloud einrichten..."
  info "Es wird ein Link angezeigt — öffne ihn im Browser oder Handy."
  info "Melde dich mit deinem Ollama-Konto an (ollama.com)."
  echo ""

  # Ollama signin im temporären Container (Credentials landen im Volume)
  dc run --rm bau-os bash -c "ollama serve & sleep 5 && ollama signin" < /dev/tty || true

  echo ""
  echo -e "  ${YELLOW}→${NC} Sobald du dich im Browser angemeldet hast, drücke Enter."
  read -r < /dev/tty

  # Verbindung testen
  CLOUD_TEST=$(dc run --rm bau-os bash -c "ollama serve & sleep 5 && ollama ls 2>&1" || true)
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
        dc run --rm bau-os bash -c "ollama serve & sleep 5 && ollama pull \"$OLLAMA_MODEL\"" \
          || err "Modell-Download fehlgeschlagen"
        # .env aktualisieren
        sed -i "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=$OLLAMA_MODEL|" "$INSTALL_DIR/.env"
        ok "Modell '$OLLAMA_MODEL' bereit"
        ;;
      2)
        echo "Abgebrochen."
        info "Login nachholen: docker exec -it bau-os bash -c 'ollama signin'"
        exit 0
        ;;
      3)
        warn "Installation wird fortgesetzt ohne Cloud-Bestätigung"
        info "Login nachholen: docker exec -it bau-os bash -c 'ollama signin'"
        ;;
    esac
  else
    ok "Cloud-Verbindung erfolgreich ($OLLAMA_MODEL)"
  fi
else
  step "Modell herunterladen ($OLLAMA_MODEL)..."
  warn "Das kann je nach Internetverbindung einige Minuten dauern..."

  dc run --rm bau-os bash -c "ollama serve & sleep 5 && ollama pull \"$OLLAMA_MODEL\"" \
    || err "Modell-Download fehlgeschlagen. Prüfe deine Internetverbindung."

  ok "Modell '$OLLAMA_MODEL' bereit"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 8: Container starten
# ═════════════════════════════════════════════════════════════════════════════
step "Bau-OS Container starten..."
dc up -d

# Health-Check (max. 30 Sekunden)
echo ""
info "Warte auf Bau-OS..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$API_PORT/api/status" >/dev/null 2>&1; then
    ok "Bau-OS läuft"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo ""
    warn "Health-Check fehlgeschlagen. Logs:"
    echo ""
    dc logs --tail 30
    echo ""
    err "Container konnte nicht gestartet werden. Siehe Logs oben."
  fi
  sleep 1
done

# ═════════════════════════════════════════════════════════════════════════════
# FERTIG
# ═════════════════════════════════════════════════════════════════════════════
echo ""
print_header "Installation abgeschlossen!"
echo ""
echo -e "  ${GREEN}▸${NC} Öffne deinen Telegram Bot und schreibe ${BOLD}'Hallo'${NC}"
echo    "    Der Setup-Wizard führt dich durch die Einrichtung."
echo ""
echo -e "  ${GREEN}▸${NC} Web-Oberfläche: ${BOLD}http://<server-ip>:${API_PORT}${NC}"
echo    "    Login: ${WEB_USER} / (dein gewähltes Passwort)"
echo ""
echo -e "  ${BOLD}Docker-Befehle:${NC}"
echo    "    cd $INSTALL_DIR"
echo    "    docker compose logs -f          → Live-Logs"
echo    "    docker compose restart          → Neustart"
echo    "    docker compose down             → Stoppen"
echo    "    docker compose up -d --build    → Update (nach git pull)"
echo    "    docker exec -it bau-os bash     → Shell im Container"
echo ""
