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

# ── Farben ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; exit 1; }
step()  { echo -e "\n${YELLOW}▶${NC} ${BOLD}$1${NC}"; }
info()  { echo -e "  ${BLUE}→${NC} $1"; }

ask() {
  local prompt="$1"
  local var
  while true; do
    read -rp "  $prompt: " var
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
  read -rp "  $prompt [$default]: " var
  echo "${var:-$default}"
}

# ── Root-Check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausführen: sudo bash scripts/install.sh"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        Bau-OS Installation           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
echo "Dieses Script installiert Bau-OS vollautomatisch auf Ubuntu 24.04."
echo "Du wirst nur nach wenigen Werten gefragt."
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 1: Konfiguration abfragen (alles VOR der Installation)
# ─────────────────────────────────────────────────────────────────────────────
echo -e "${BOLD}── Konfiguration ────────────────────────────────────────────────────────────${NC}"
echo ""

# Telegram Bot Token
echo -e "  ${BOLD}Telegram Bot Token${NC}"
info "Erstelle einen Bot via @BotFather in Telegram → /newbot"
BOT_TOKEN=$(ask "Bot Token")

echo ""

# LLM-Modus: Cloud oder Lokal
echo -e "  ${BOLD}LLM-Modus${NC}"
info "Cloud: kein lokaler RAM nötig, benötigt Ollama-Konto (ollama.com)"
info "Lokal: Modell wird heruntergeladen, braucht mind. 8 GB RAM"
echo ""
echo "  [1] Cloud  (empfohlen — kimi-k2.5, gemma4, qwen3 etc.)"
echo "  [2] Lokal  (qwen2.5:7b, llama3.1:8b etc.)"
echo ""
while true; do
  read -rp "  Auswahl [1/2]: " LLM_CHOICE
  case "$LLM_CHOICE" in
    1) LLM_MODE="cloud"; break ;;
    2) LLM_MODE="local"; break ;;
    *) echo -e "  ${RED}Bitte 1 oder 2 eingeben.${NC}" ;;
  esac
done

if [ "$LLM_MODE" = "cloud" ]; then
  echo ""
  echo "  Verfügbare Cloud-Modelle: kimi-k2.5:cloud, gemma4:cloud, qwen3-next:cloud"
  OLLAMA_MODEL=$(ask_default "Modell" "kimi-k2.5:cloud")
else
  echo ""
  echo "  Verfügbare lokale Modelle: qwen2.5:7b (~4.3GB), llama3.1:8b (~4.7GB), qwen2.5:3b (~2GB)"
  OLLAMA_MODEL=$(ask_default "Modell" "qwen2.5:7b")
fi

echo ""

# Installationspfade (Defaults anzeigen, änderbar)
INSTALL_DIR=$(ask_default "Installationsverzeichnis" "/opt/bau-os")
VAULT_DIR=$(ask_default "Vault-Verzeichnis" "/opt/bau-os-vault")
SERVICE_USER="bauos"

echo ""
echo -e "${BOLD}── Zusammenfassung ──────────────────────────────────────────────────────────${NC}"
echo ""
info "Bot Token:    ${BOT_TOKEN:0:8}...${BOT_TOKEN: -4}"
info "LLM-Modus:    $LLM_MODE ($OLLAMA_MODEL)"
info "Install-Pfad: $INSTALL_DIR"
info "Vault-Pfad:   $VAULT_DIR"
echo ""
read -rp "  Installation starten? [j/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[jJ]$ ]]; then
  echo "Abgebrochen."
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 2: System-Pakete
# ─────────────────────────────────────────────────────────────────────────────
step "System aktualisieren..."
apt-get update -qq && apt-get upgrade -y -qq
ok "System aktualisiert"

step "Pakete installieren (git, curl)..."
apt-get install -y git curl -qq
ok "Pakete installiert"

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 3: Node.js 20
# ─────────────────────────────────────────────────────────────────────────────
step "Node.js 20 LTS installieren..."
if ! command -v node &> /dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
  apt-get install -y nodejs -qq
  ok "Node.js $(node --version) installiert"
else
  ok "Node.js $(node --version) bereits vorhanden"
fi

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 4: Ollama
# ─────────────────────────────────────────────────────────────────────────────
step "Ollama installieren..."
if ! command -v ollama &> /dev/null; then
  curl -fsSL https://ollama.ai/install.sh | sh
  ok "Ollama installiert"
else
  ok "Ollama bereits vorhanden"
fi

systemctl enable ollama --quiet
systemctl start ollama
sleep 3
ok "Ollama Service gestartet"

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 5: LLM-Modell vorbereiten
# ─────────────────────────────────────────────────────────────────────────────
if [ "$LLM_MODE" = "cloud" ]; then
  step "Ollama Cloud einrichten..."
  info "Melde dich mit deinem Ollama-Konto an (ollama.com):"
  echo ""
  if ! ollama signin; then
    echo ""
    warn "Ollama Login fehlgeschlagen"
    echo ""
    echo "  Was möchtest du tun?"
    echo ""
    echo "  [1] Auf lokales Modell umstellen (wird heruntergeladen)"
    echo "  [2] Installation abbrechen"
    echo "  [3] Login erneut versuchen"
    echo ""
    while true; do
      read -rp "  Auswahl [1/2/3]: " LOGIN_FAIL_CHOICE
      case "$LOGIN_FAIL_CHOICE" in
        1)
          echo ""
          info "Wechsle zu lokalem Modell..."
          LLM_MODE="local"
          # Lokales Standardmodell verwenden
          OLLAMA_MODEL="qwen2.5:7b"
          info "Lokales Modell: $OLLAMA_MODEL"
          step "LLM-Modell herunterladen ($OLLAMA_MODEL)..."
          warn "Das kann je nach Internetverbindung einige Minuten dauern..."
          ollama pull "$OLLAMA_MODEL"
          ok "Modell '$OLLAMA_MODEL' bereit"
          break
          ;;
        2)
          echo ""
          info "Installation wurde abgebrochen"
          exit 0
          ;;
        3)
          echo ""
          info "Erneuter Login-Versuch..."
          if ollama signin; then
            ok "Login erfolgreich"
            ok "Cloud-Modus konfiguriert ($OLLAMA_MODEL)"
            break
          fi
          echo ""
          warn "Login erneut fehlgeschlagen"
          ;;
        *)
          echo -e "  ${RED}Bitte 1, 2 oder 3 eingeben.${NC}"
          ;;
      esac
    done
  else
    ok "Cloud-Modus konfiguriert ($OLLAMA_MODEL)"
  fi
else
  step "LLM-Modell herunterladen ($OLLAMA_MODEL)..."
  warn "Das kann je nach Internetverbindung einige Minuten dauern..."
  ollama pull "$OLLAMA_MODEL"
  ok "Modell '$OLLAMA_MODEL' bereit"
fi

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 6: Service-Benutzer
# ─────────────────────────────────────────────────────────────────────────────
step "Service-Benutzer anlegen ($SERVICE_USER)..."
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/bash -d "$INSTALL_DIR" -m "$SERVICE_USER"
  ok "Benutzer '$SERVICE_USER' erstellt"
else
  ok "Benutzer '$SERVICE_USER' bereits vorhanden"
fi

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 7: Bau-OS klonen und bauen
# ─────────────────────────────────────────────────────────────────────────────
step "Bau-OS installieren..."
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Verzeichnis existiert bereits — führe Update durch"
  cd "$INSTALL_DIR"
  git pull
else
  git clone https://github.com/julasim/Bau-OS.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
npm install --omit=dev --silent
npm run build
ok "Bau-OS gebaut"

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 8: Verzeichnisse + Berechtigungen
# ─────────────────────────────────────────────────────────────────────────────
step "Verzeichnisse anlegen und Berechtigungen setzen..."

# Vault
mkdir -p "$VAULT_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$VAULT_DIR"
info "Vault: $VAULT_DIR"

# Logs-Ordner VOR chown erstellen (sonst gehört er root)
mkdir -p "$INSTALL_DIR/logs"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/.env" 2>/dev/null || true
info "Installationsverzeichnis: $INSTALL_DIR"

ok "Berechtigungen gesetzt"

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 9: .env erstellen
# ─────────────────────────────────────────────────────────────────────────────
step ".env konfigurieren..."
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" << ENVEOF
BOT_TOKEN=$BOT_TOKEN
VAULT_PATH=$VAULT_DIR
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=$OLLAMA_MODEL
ENVEOF
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  ok ".env erstellt"
else
  warn ".env bereits vorhanden — übersprungen (bestehende Konfiguration bleibt erhalten)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# SCHRITT 10: systemd Service
# ─────────────────────────────────────────────────────────────────────────────
step "systemd Service installieren..."

# Pfade + Vault in Service-Datei eintragen
sed \
  "s|/opt/bau-os-vault|$VAULT_DIR|g; \
   s|/opt/bau-os|$INSTALL_DIR|g; \
   s|User=bauos|User=$SERVICE_USER|g" \
  "$INSTALL_DIR/bau-os.service" > /etc/systemd/system/bau-os.service

systemctl daemon-reload
systemctl enable bau-os --quiet
systemctl start bau-os
sleep 3

if systemctl is-active --quiet bau-os; then
  ok "Bau-OS Service läuft"
else
  echo ""
  warn "Service konnte nicht gestartet werden. Logs:"
  journalctl -u bau-os -n 15 --no-pager
  echo ""
  err "Installation fehlgeschlagen. Siehe Logs oben."
fi

# ─────────────────────────────────────────────────────────────────────────────
# FERTIG
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     ✓  Installation abgeschlossen!  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}▸ Öffne deinen Telegram Bot und schreibe 'Hallo'${NC}"
echo    "    Der Setup-Wizard führt dich durch die Einrichtung."
echo ""
echo    "Nützliche Befehle:"
echo    "  systemctl status bau-os        → Status prüfen"
echo    "  journalctl -u bau-os -f        → Live-Logs"
echo    "  systemctl restart bau-os       → Neustart"
echo    "  bash $INSTALL_DIR/scripts/update.sh  → Update einspielen"
echo ""
