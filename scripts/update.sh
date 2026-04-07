#!/bin/bash
# Bau-OS Update Script
# Verwendung: sudo bash scripts/update.sh

set -e

INSTALL_DIR="${1:-/opt/bau-os}"

echo "▶ Bau-OS aktualisieren ($INSTALL_DIR)..."

cd "$INSTALL_DIR"
git pull
npm install --production
npm run build
systemctl restart bau-os

echo "✓ Update abgeschlossen"
systemctl status bau-os --no-pager -l
