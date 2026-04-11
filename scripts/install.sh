#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Installations-Script
# Getestet auf: Ubuntu 24.04 LTS
#
# Verwendung:
#   curl -fsSL https://raw.githubusercontent.com/julasim/Bau-OS/main/scripts/install.sh | bash
#   oder:
#   chmod +x scripts/install.sh && sudo bash scripts/install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

# UTF-8 für Umlaute (muss vor allem anderen gesetzt werden)
export LANG=de_AT.UTF-8
export LC_ALL=de_AT.UTF-8
export LANGUAGE=de_AT.UTF-8

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────────────────
readonly INSTALL_DIR_DEFAULT="/opt/bau-os"
readonly WORKSPACE_DIR_DEFAULT="/opt/bau-os-workspace"
readonly SERVICE_USER="bauos"
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
  echo -e "  ${CYAN}KI-Assistent für die Baubranche${NC}"
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

# Menü-Auswahl (Ausgabe auf stderr, Ergebnis auf stdout)
# read von /dev/tty für curl|bash Kompatibilität
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

# Eingabe mit Validierung (nicht leer)
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

# Eingabe mit Default-Wert
ask_default() {
  local prompt="$1"
  local default="$2"
  local var
  read -rp "  $prompt [$default]: " var < /dev/tty
  echo "${var:-$default}"
}

# Warte bis Service aktiv ist (max. 15 Sekunden)
wait_for_service() {
  local service="$1"
  local max_wait=15
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if systemctl is-active --quiet "$service"; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Pfad-Validierung (nur sichere Zeichen)
validate_path() {
  local path="$1"
  if [[ "$path" =~ ^[a-zA-Z0-9/._-]+$ ]]; then
    return 0
  fi
  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Root-Check
# ─────────────────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausführen: sudo bash scripts/install.sh"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Hauptprogramm
# ─────────────────────────────────────────────────────────────────────────────
print_logo
print_header "Bau-OS Installation"

echo "Dieses Script installiert Bau-OS vollautomatisch auf Ubuntu 24.04."
echo "Du wirst nach wenigen Werten gefragt."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 1: Konfiguration abfragen (alles VOR der Installation)
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
INSTALL_DIR=$(ask_default "Installationsverzeichnis" "$INSTALL_DIR_DEFAULT")
WORKSPACE_DIR=$(ask_default "Workspace-Verzeichnis" "$WORKSPACE_DIR_DEFAULT")

# Pfade validieren
if ! validate_path "$INSTALL_DIR"; then
  err "Ungültiger Installationspfad: $INSTALL_DIR (nur a-z, 0-9, /, ., _, - erlaubt)"
fi
if ! validate_path "$WORKSPACE_DIR"; then
  err "Ungültiger Workspace-Pfad: $WORKSPACE_DIR (nur a-z, 0-9, /, ., _, - erlaubt)"
fi

# ── Web-Oberfläche (Admin-Login) ──────────────────────────────────────────────
echo -e "  ${BOLD}Web-Oberfläche${NC}"
info "Erstelle den ersten Admin-Benutzer für die Web-Oberfläche."
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
# SCHRITT 2: System-Pakete
# ═════════════════════════════════════════════════════════════════════════════
step "System aktualisieren..."
apt-get update -y >/dev/null 2>&1 && apt-get upgrade -y >/dev/null 2>&1
ok "System aktualisiert"

step "Pakete installieren (git, curl, locales)..."
apt-get install -y git curl locales >/dev/null 2>&1
ok "Pakete installiert"

step "Zeichensatz / Umlaute einrichten (UTF-8)..."
locale-gen de_AT.UTF-8 >/dev/null 2>&1 || locale-gen en_US.UTF-8 >/dev/null 2>&1
update-locale LANG=de_AT.UTF-8 LC_ALL=de_AT.UTF-8 2>/dev/null || true
ok "UTF-8 Locale aktiv (Umlaute werden korrekt dargestellt)"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 3: Node.js 20
# ═════════════════════════════════════════════════════════════════════════════
step "Node.js 20 LTS installieren..."
if ! command -v node &> /dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
  ok "Node.js $(node --version) installiert"
else
  ok "Node.js $(node --version) bereits vorhanden"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 4: Ollama
# ═════════════════════════════════════════════════════════════════════════════
step "Ollama installieren..."
if ! command -v ollama &> /dev/null; then
  curl -fsSL https://ollama.ai/install.sh | sh
  ok "Ollama installiert"
else
  ok "Ollama bereits vorhanden"
fi

systemctl enable ollama --quiet 2>/dev/null || true
systemctl start ollama 2>/dev/null || true
sleep 3
ok "Ollama Service gestartet"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 5: Bau-OS klonen und bauen (VOR useradd — verhindert skel-Konflikt)
# ═════════════════════════════════════════════════════════════════════════════
step "Bau-OS installieren..."
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Verzeichnis existiert bereits — führe Update durch"
  cd "$INSTALL_DIR"
  git pull
elif [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  # Verzeichnis existiert aber ist kein git repo (z.B. von useradd -m aus vorigem Versuch)
  warn "Verzeichnis $INSTALL_DIR existiert aber ist kein Git-Repo — wird bereinigt"
  rm -rf "$INSTALL_DIR"
  if ! git clone "$REPO_URL" "$INSTALL_DIR" 2>&1; then
    echo ""
    err "git clone fehlgeschlagen. Ist das Repo auf GitHub auf 'public' gestellt?"
  fi
  cd "$INSTALL_DIR"
else
  if ! git clone "$REPO_URL" "$INSTALL_DIR" 2>&1; then
    echo ""
    err "git clone fehlgeschlagen. Ist das Repo auf GitHub auf 'public' gestellt?"
  fi
  cd "$INSTALL_DIR"
fi
npm install --loglevel=error
npm run build:all
npm prune --omit=dev --loglevel=error
ok "Bau-OS gebaut (Backend + Web-Oberfläche)"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 6: Service-Benutzer (NACH git clone — kein -m Flag)
# ═════════════════════════════════════════════════════════════════════════════
step "Service-Benutzer anlegen ($SERVICE_USER)..."
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/bash -d "$INSTALL_DIR" -M "$SERVICE_USER"
  ok "Benutzer '$SERVICE_USER' erstellt"
else
  ok "Benutzer '$SERVICE_USER' bereits vorhanden"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 7: LLM-Modell vorbereiten
# ═════════════════════════════════════════════════════════════════════════════
if [ "$LLM_MODE" = "cloud" ]; then
  step "Ollama Cloud einrichten..."
  info "Melde dich mit deinem Ollama-Konto an (ollama.com)."
  info "Es wird ein Link angezeigt — öffne ihn im Browser/Handy."
  echo ""

  # Hilfsfunktion: Ollama Cloud-Verbindung testen
  _test_ollama_cloud() {
    su -s /bin/bash "$SERVICE_USER" -c "ollama ls" 2>/dev/null | grep -qi "cloud" && return 0
    # Alternativ: einfacher API-Aufruf
    su -s /bin/bash "$SERVICE_USER" -c "ollama ls" 2>/dev/null | grep -qv "Error" && return 0
    return 1
  }

  # Hilfsfunktion: Login durchführen und auf Browser-Bestätigung warten
  _do_ollama_signin() {
    echo ""
    info "Es wird ein Link angezeigt — öffne ihn im Browser oder Handy."
    info "Melde dich mit deinem Ollama-Konto an (ollama.com)."
    echo ""
    su -s /bin/bash "$SERVICE_USER" -c "ollama signin" < /dev/tty || true
    echo ""
    echo -e "  ${YELLOW}→${NC} Sobald du dich im Browser angemeldet hast, drücke Enter um fortzufahren."
    read -r < /dev/tty
  }

  # ollama signin als Service-User ausführen (Token muss für bauos zugänglich sein)
  _do_ollama_signin

  # Verbindung verifizieren
  if _test_ollama_cloud; then
    ok "Cloud-Verbindung erfolgreich ($OLLAMA_MODEL)"
  else
    echo ""
    warn "Ollama Cloud-Verbindung konnte nicht bestätigt werden"
    FAIL_CHOICE=$(select_option "Was möchtest du tun?" \
      "Auf lokales Modell umstellen (wird heruntergeladen)" \
      "Installation abbrechen" \
      "Login erneut versuchen")

    case "$FAIL_CHOICE" in
      1)
        echo ""
        info "Wechsle zu lokalem Modell..."
        LLM_MODE="local"
        info "Verfügbare: qwen2.5:7b (~4.3GB), llama3.1:8b (~4.7GB), qwen2.5:3b (~2GB)"
        OLLAMA_MODEL=$(ask_default "Modell" "qwen2.5:3b")
        step "LLM-Modell herunterladen ($OLLAMA_MODEL)..."
        warn "Das kann einige Minuten dauern..."
        ollama pull "$OLLAMA_MODEL"
        ok "Modell '$OLLAMA_MODEL' bereit"
        ;;
      2)
        echo ""
        info "Installation wurde abgebrochen."
        info "Ollama Login nachholen: su -s /bin/bash $SERVICE_USER -c 'ollama signin'"
        exit 0
        ;;
      3)
        echo ""
        info "Erneuter Login-Versuch..."
        _do_ollama_signin
        if _test_ollama_cloud; then
          ok "Cloud-Verbindung erfolgreich"
        else
          warn "Verbindung erneut fehlgeschlagen."
          info "Manuell nachholen: su -s /bin/bash $SERVICE_USER -c 'ollama signin'"
          info "Installation wird trotzdem fortgesetzt."
        fi
        ;;
    esac
  fi
else
  step "LLM-Modell herunterladen ($OLLAMA_MODEL)..."
  warn "Das kann je nach Internetverbindung einige Minuten dauern..."
  ollama pull "$OLLAMA_MODEL"
  ok "Modell '$OLLAMA_MODEL' bereit"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 8: Verzeichnisse + Berechtigungen
# ═════════════════════════════════════════════════════════════════════════════
step "Verzeichnisse anlegen und Berechtigungen setzen..."

# Workspace-Verzeichnis
mkdir -p "$WORKSPACE_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$WORKSPACE_DIR"
info "Workspace: $WORKSPACE_DIR"

# Logs + Tools Ordner erstellen (VOR chown)
mkdir -p "$INSTALL_DIR/logs"
mkdir -p "$INSTALL_DIR/tools"

# Alle Berechtigungen setzen
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
info "Installationsverzeichnis: $INSTALL_DIR"

ok "Berechtigungen gesetzt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 9: Web-Admin + JWT vorbereiten
# ═════════════════════════════════════════════════════════════════════════════
step "Web-Admin einrichten..."

# JWT Secret generieren
JWT_SECRET=$(openssl rand -hex 32)

# Passwort hashen (bcrypt via Node.js — Modul ist nach npm install verfügbar)
PASS_HASH=$(node -e "const b=require('bcrypt'); b.hash(process.argv[1],10).then(h=>console.log(h))" "$WEB_PASS")

# data/ Ordner + users.json
mkdir -p "$INSTALL_DIR/data"
cat > "$INSTALL_DIR/data/users.json" << USERSEOF
[{"username":"$WEB_USER","passwordHash":"$PASS_HASH","role":"admin","createdAt":"$(date +%Y-%m-%d)"}]
USERSEOF
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/data"
chmod 600 "$INSTALL_DIR/data/users.json"
ok "Admin-User '$WEB_USER' erstellt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 10: .env erstellen (immer BOT_TOKEN prüfen)
# ═════════════════════════════════════════════════════════════════════════════
step ".env konfigurieren..."
if [ -f "$INSTALL_DIR/.env" ]; then
  # .env existiert — prüfen ob BOT_TOKEN gesetzt ist
  EXISTING_TOKEN=$(grep -oP '^BOT_TOKEN=\K.+' "$INSTALL_DIR/.env" 2>/dev/null || true)
  if [ -z "$EXISTING_TOKEN" ]; then
    warn ".env existiert, aber BOT_TOKEN ist leer — wird aktualisiert"
    sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$BOT_TOKEN|" "$INSTALL_DIR/.env"
    sed -i "s|^OLLAMA_MODEL=.*|OLLAMA_MODEL=$OLLAMA_MODEL|" "$INSTALL_DIR/.env"
    ok ".env aktualisiert (Token + Modell)"
  else
    warn ".env bereits vorhanden mit Token — übersprungen"
    info "Modell manuell ändern: nano $INSTALL_DIR/.env"
  fi
  # JWT_SECRET immer setzen/aktualisieren
  if grep -q '^JWT_SECRET=' "$INSTALL_DIR/.env"; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|" "$INSTALL_DIR/.env"
  else
    echo "JWT_SECRET=$JWT_SECRET" >> "$INSTALL_DIR/.env"
  fi
  if ! grep -q '^API_PORT=' "$INSTALL_DIR/.env"; then
    echo "API_PORT=$API_PORT" >> "$INSTALL_DIR/.env"
  fi
else
  cat > "$INSTALL_DIR/.env" << 'ENVHEADER'
# Bau-OS Konfiguration (generiert von install.sh)
ENVHEADER
  cat >> "$INSTALL_DIR/.env" << ENVEOF
BOT_TOKEN=$BOT_TOKEN
WORKSPACE_PATH=$WORKSPACE_DIR
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=$OLLAMA_MODEL
JWT_SECRET=$JWT_SECRET
API_PORT=$API_PORT
ENVEOF
  ok ".env erstellt"
fi

chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 11: CLI-Tool installieren
# ═════════════════════════════════════════════════════════════════════════════
step "bau-os CLI installieren..."
cp "$INSTALL_DIR/scripts/bau-os-cli.sh" /usr/local/bin/bau-os
chmod +x /usr/local/bin/bau-os

# Pfade im CLI auf tatsächliche Installationspfade anpassen
sed -i "s|INSTALL_DIR=\"/opt/bau-os\"|INSTALL_DIR=\"$INSTALL_DIR\"|" /usr/local/bin/bau-os
sed -i "s|WORKSPACE_DIR=\"/opt/bau-os-workspace\"|WORKSPACE_DIR=\"$WORKSPACE_DIR\"|" /usr/local/bin/bau-os
sed -i "s|SERVICE_USER=\"bauos\"|SERVICE_USER=\"$SERVICE_USER\"|" /usr/local/bin/bau-os

ok "CLI verfügbar: 'bau-os' oder 'sudo bau-os'"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 12: systemd Service
# ═════════════════════════════════════════════════════════════════════════════
step "systemd Service installieren..."

# Pfade in der Service-Datei anpassen (Workspace-Pfad ZUERST, da er den kürzeren enthält)
sed \
  "s|/opt/bau-os-workspace|$WORKSPACE_DIR|g; \
   s|/opt/bau-os|$INSTALL_DIR|g; \
   s|User=bauos|User=$SERVICE_USER|g" \
  "$INSTALL_DIR/bau-os.service" > /etc/systemd/system/bau-os.service

systemctl daemon-reload
systemctl enable bau-os --quiet 2>/dev/null || true

# Eventuell laufenden Service stoppen vor Neustart
systemctl stop bau-os 2>/dev/null || true
systemctl start bau-os

# Aktiv warten statt festes sleep (max 15 Sekunden)
if wait_for_service "bau-os"; then
  ok "Bau-OS Service läuft"
else
  echo ""
  warn "Service konnte nicht gestartet werden. Logs:"
  echo ""
  journalctl -u bau-os -n 20 --no-pager
  echo ""
  err "Installation fehlgeschlagen. Siehe Logs oben."
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
echo -e "  ${GREEN}▸${NC} Web-Oberfläche: ${BOLD}http://<server-ip>:${API_PORT}${NC}"
echo    "    Login: ${WEB_USER} / (dein gewähltes Passwort)"
echo ""
echo -e "  ${BOLD}CLI-Befehle:${NC}"
echo    "    bau-os                   → Interaktives Menü"
echo    "    bau-os status            → Status"
echo    "    bau-os logs              → Logs anzeigen"
echo    "    bau-os logs live         → Live-Logs"
echo    "    sudo bau-os restart      → Neustart"
echo    "    sudo bau-os update       → Update einspielen"
echo    "    sudo bau-os user add     → Neuen Web-User anlegen"
echo ""
