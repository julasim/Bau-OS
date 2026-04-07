#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Installations-Script
# Getestet auf: Ubuntu 24.04 LTS
#
# Verwendung:
#   curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
#   oder:
#   chmod +x scripts/install.sh && ./scripts/install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Abbruch bei Fehler

# ── Farben ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }
step() { echo -e "\n${YELLOW}▶${NC} $1"; }

# ── Variablen ─────────────────────────────────────────────────────────────────
INSTALL_DIR="/opt/bau-os"
VAULT_DIR="/opt/bau-os-vault"
SERVICE_USER="bauos"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"

# ── Root-Check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausführen: sudo bash scripts/install.sh"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        Bau-OS Installation           ║"
echo "╚══════════════════════════════════════╝"

# ── 1. System aktualisieren ───────────────────────────────────────────────────
step "System aktualisieren..."
apt-get update -qq && apt-get upgrade -y -qq
ok "System aktualisiert"

# ── 2. Node.js 20 installieren ────────────────────────────────────────────────
step "Node.js 20 LTS installieren..."
if ! command -v node &> /dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node --version) installiert"
else
  ok "Node.js $(node --version) bereits vorhanden"
fi

# ── 3. Git installieren ───────────────────────────────────────────────────────
step "Git installieren..."
apt-get install -y git curl
ok "Git $(git --version | awk '{print $3}') installiert"

# ── 4. Ollama installieren ────────────────────────────────────────────────────
step "Ollama installieren..."
if ! command -v ollama &> /dev/null; then
  curl -fsSL https://ollama.ai/install.sh | sh
  ok "Ollama installiert"
else
  ok "Ollama bereits vorhanden"
fi

# Ollama als systemd Service starten
systemctl enable ollama --quiet
systemctl start ollama
sleep 2
ok "Ollama Service gestartet"

# ── 5. LLM-Modell herunterladen ───────────────────────────────────────────────
step "LLM-Modell herunterladen ($OLLAMA_MODEL)..."
warn "Das kann je nach Internetverbindung einige Minuten dauern..."
ollama pull "$OLLAMA_MODEL"
ok "Modell '$OLLAMA_MODEL' bereit"

# ── 6. Benutzer anlegen ───────────────────────────────────────────────────────
step "Service-Benutzer anlegen ($SERVICE_USER)..."
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/bash -d /opt/bau-os -m "$SERVICE_USER"
  ok "Benutzer '$SERVICE_USER' erstellt"
else
  ok "Benutzer '$SERVICE_USER' bereits vorhanden"
fi

# ── 7. Bau-OS installieren ────────────────────────────────────────────────────
step "Bau-OS installieren..."
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Verzeichnis existiert — update statt install"
  cd "$INSTALL_DIR"
  git pull
else
  # Passe die URL an wenn du ein privates Repo verwendest
  git clone https://github.com/YOUR_USER/bau-os.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
npm install --production
npm run build
ok "Bau-OS gebaut"

# ── 8. Vault-Verzeichnis anlegen ──────────────────────────────────────────────
step "Vault-Verzeichnis anlegen..."
mkdir -p "$VAULT_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$VAULT_DIR"
ok "Vault-Verzeichnis: $VAULT_DIR"

# ── 9. Berechtigungen setzen ──────────────────────────────────────────────────
step "Berechtigungen setzen..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/logs"
ok "Berechtigungen gesetzt"

# ── 10. .env konfigurieren ────────────────────────────────────────────────────
step ".env konfigurieren..."
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo ""
  echo "Bitte folgende Werte eingeben:"
  read -p "  Telegram Bot Token (von @BotFather): " BOT_TOKEN
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
  warn ".env bereits vorhanden — übersprungen"
fi

# ── 11. systemd Service installieren ─────────────────────────────────────────
step "systemd Service installieren..."
# Pfade in der Service-Datei anpassen
sed "s|/opt/bau-os|$INSTALL_DIR|g; s|User=bauos|User=$SERVICE_USER|g" \
  "$INSTALL_DIR/bau-os.service" > /etc/systemd/system/bau-os.service

systemctl daemon-reload
systemctl enable bau-os
systemctl start bau-os
sleep 2

if systemctl is-active --quiet bau-os; then
  ok "Bau-OS Service läuft"
else
  err "Service konnte nicht gestartet werden. Logs: journalctl -u bau-os -n 20"
fi

# ── Fertig ────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════╗"
echo "║      Installation abgeschlossen!    ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Nächste Schritte:"
echo "  1. Öffne deinen Telegram Bot und schreibe 'Hallo'"
echo "  2. Der Setup-Wizard führt dich durch die Einrichtung"
echo ""
echo "Nützliche Befehle:"
echo "  systemctl status bau-os        → Status prüfen"
echo "  journalctl -u bau-os -f        → Live-Logs"
echo "  systemctl restart bau-os       → Neustart"
echo ""
