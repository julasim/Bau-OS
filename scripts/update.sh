#!/bin/bash
# Bau-OS Update Script
# Verwendung: sudo bash scripts/update.sh

set -e

INSTALL_DIR="${1:-/opt/bau-os}"
SERVICE_USER="bauos"

echo "▶ Bau-OS aktualisieren ($INSTALL_DIR)..."

cd "$INSTALL_DIR"

# git pull als Service-User (verhindert "dubious ownership" Fehler wenn root ausführt)
su -s /bin/bash "$SERVICE_USER" -c "cd $INSTALL_DIR && git pull"

npm install --loglevel=error
npm run build:all
npm prune --omit=dev --loglevel=error

# CLI-Tool aktualisieren
cp "$INSTALL_DIR/scripts/bau-os-cli.sh" /usr/local/bin/bau-os
chmod +x /usr/local/bin/bau-os

systemctl restart bau-os

echo "✓ Update abgeschlossen"
systemctl status bau-os --no-pager -l
