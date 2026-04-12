#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Deinstallation
# Entfernt Bau-OS sauber vom System
#
# Verwendung:
#   sudo bash scripts/uninstall.sh
#   oder (remote):
#   curl -fsSL https://raw.githubusercontent.com/julasim/Bau-OS/main/scripts/uninstall.sh | sudo bash
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Konfiguration (gleiche Defaults wie install.sh) ─────────
INSTALL_DIR="/opt/bau-os"
WORKSPACE_DIR="/opt/bau-os-workspace"
SERVICE_USER="bauos"
SERVICE_NAME="bau-os"

# ── Farben ───────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  !${NC} $1"; }
err()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }
info() { echo -e "${DIM}   $1${NC}"; }

# ── Root-Check ───────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausfuehren: sudo bash scripts/uninstall.sh"
fi

# ── Pfade erkennen (falls nicht Standard) ────────────────────
if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
  _dir=$(grep -oP '^WorkingDirectory=\K.+' /etc/systemd/system/$SERVICE_NAME.service 2>/dev/null || true)
  [ -n "$_dir" ] && INSTALL_DIR="$_dir"
  _user=$(grep -oP '^User=\K.+' /etc/systemd/system/$SERVICE_NAME.service 2>/dev/null || true)
  [ -n "$_user" ] && SERVICE_USER="$_user"
fi

if [ -f "$INSTALL_DIR/.env" ]; then
  _ws=$(grep -oP '^WORKSPACE_PATH=\K.+' "$INSTALL_DIR/.env" 2>/dev/null || true)
  [ -n "$_ws" ] && WORKSPACE_DIR="$_ws"
fi

# ── Logo ─────────────────────────────────────────────────────
echo ""
echo -e "${RED}  ██████╗  █████╗ ██╗   ██╗      ██████╗ ███████╗${NC}"
echo -e "${RED}  ██╔══██╗██╔══██╗██║   ██║     ██╔═══██╗██╔════╝${NC}"
echo -e "${RED}  ██████╔╝███████║██║   ██║     ██║   ██║███████╗${NC}"
echo -e "${RED}  ██╔══██╗██╔══██║██║   ██║     ██║   ██║╚════██║${NC}"
echo -e "${RED}  ██████╔╝██║  ██║╚██████╔╝     ╚██████╔╝███████║${NC}"
echo -e "${RED}  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝       ╚═════╝ ╚══════╝${NC}"
echo ""
echo -e "  ${RED}Deinstallation${NC}"
echo -e "  ${DIM}────────────────────────────────────────────────${NC}"
echo ""

# ── Zusammenfassung was entfernt wird ────────────────────────
echo -e "${BOLD}Folgendes wird entfernt:${NC}"
echo ""
[ -f "/etc/systemd/system/$SERVICE_NAME.service" ] && info "systemd Service: $SERVICE_NAME"
[ -f "/usr/local/bin/bau-os" ]                     && info "CLI Tool: /usr/local/bin/bau-os"
[ -d "$INSTALL_DIR" ]                               && info "Installation: $INSTALL_DIR"
id "$SERVICE_USER" &>/dev/null 2>&1                 && info "Benutzer: $SERVICE_USER"
echo ""

if [ -d "$WORKSPACE_DIR" ]; then
  echo -e "${YELLOW}  Workspace: $WORKSPACE_DIR${NC}"
  info "Enthaelt deine Notizen, Aufgaben und Agenten-Daten"
  echo ""
fi

# ── Bestaetigungen ───────────────────────────────────────────
read -rp "  Bau-OS wirklich deinstallieren? [j/N]: " CONFIRM < /dev/tty
if [[ ! "$CONFIRM" =~ ^[jJ]$ ]]; then
  echo "Abgebrochen."; exit 0
fi

DELETE_WORKSPACE="n"
if [ -d "$WORKSPACE_DIR" ]; then
  echo ""
  echo -e "  ${YELLOW}${BOLD}Workspace auch loeschen?${NC}"
  info "ACHTUNG: Alle Notizen, Aufgaben und Agenten-Daten gehen verloren!"
  read -rp "  Workspace loeschen? [j/N]: " DELETE_WORKSPACE < /dev/tty
fi

echo ""

# ═════════════════════════════════════════════════════════════
# 1. Service stoppen + entfernen
# ═════════════════════════════════════════════════════════════
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo -e "${YELLOW}▶${NC} ${BOLD}Service stoppen...${NC}"
  systemctl stop "$SERVICE_NAME"
  ok "Service gestoppt"
fi

if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
  systemctl disable "$SERVICE_NAME" --quiet 2>/dev/null || true
  rm -f "/etc/systemd/system/$SERVICE_NAME.service"
  systemctl daemon-reload
  ok "systemd Service entfernt"
fi

# ═════════════════════════════════════════════════════════════
# 2. CLI Tool entfernen
# ═════════════════════════════════════════════════════════════
if [ -f "/usr/local/bin/bau-os" ]; then
  rm -f "/usr/local/bin/bau-os"
  ok "CLI Tool entfernt"
fi

# ═════════════════════════════════════════════════════════════
# 3. Installationsverzeichnis entfernen
# ═════════════════════════════════════════════════════════════
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  ok "Installation entfernt: $INSTALL_DIR"
fi

# ═════════════════════════════════════════════════════════════
# 4. Workspace (nur auf Wunsch)
# ═════════════════════════════════════════════════════════════
if [[ "$DELETE_WORKSPACE" =~ ^[jJ]$ ]] && [ -d "$WORKSPACE_DIR" ]; then
  rm -rf "$WORKSPACE_DIR"
  ok "Workspace entfernt: $WORKSPACE_DIR"
elif [ -d "$WORKSPACE_DIR" ]; then
  warn "Workspace beibehalten: $WORKSPACE_DIR"
fi

# ═════════════════════════════════════════════════════════════
# 5. Service-Benutzer entfernen
# ═════════════════════════════════════════════════════════════
if id "$SERVICE_USER" &>/dev/null 2>&1; then
  userdel "$SERVICE_USER" 2>/dev/null || true
  ok "Benutzer '$SERVICE_USER' entfernt"
fi

# ═════════════════════════════════════════════════════════════
# Hinweis: Ollama + Node.js bleiben installiert
# ═════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bau-OS wurde deinstalliert.${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
info "Ollama und Node.js wurden NICHT entfernt."
info "Falls gewuenscht:"
info "  Ollama:  sudo rm /usr/local/bin/ollama && sudo userdel ollama"
info "  Node.js: sudo apt remove nodejs"
echo ""
