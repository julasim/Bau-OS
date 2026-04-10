#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Update Script
# Verwendung: sudo bash scripts/update.sh
#             oder direkt auf dem Server: sudo bash /opt/bau-os/scripts/update.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Farben
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

INSTALL_DIR="${1:-/opt/bau-os}"

# ─────────────────────────────────────────────────────────────────────────────
# Prüfungen
# ─────────────────────────────────────────────────────────────────────────────

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo -e "${RED}✗ Kein Git-Repository in $INSTALL_DIR${NC}"
  exit 1
fi

cd "$INSTALL_DIR"

# Git safe.directory setzen (verhindert "dubious ownership" Fehler)
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

echo -e "${CYAN}──────────────────────────────────────${NC}"
echo -e "${CYAN}  Bau-OS Update${NC}"
echo -e "${CYAN}──────────────────────────────────────${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 1. Aktuellen Stand anzeigen
# ─────────────────────────────────────────────────────────────────────────────

OLD_COMMIT=$(git rev-parse --short HEAD)
OLD_MSG=$(git log -1 --pretty=format:"%s")
echo -e "  Aktuell: ${YELLOW}${OLD_COMMIT}${NC} — ${OLD_MSG}"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Lokale Änderungen bereinigen (package-lock.json etc.)
# ─────────────────────────────────────────────────────────────────────────────

DIRTY_FILES=$(git diff --name-only 2>/dev/null || true)
if [ -n "$DIRTY_FILES" ]; then
  echo -e "  ${YELLOW}▶ Lokale Änderungen zurücksetzen:${NC}"
  echo "$DIRTY_FILES" | while read -r f; do
    echo -e "    ↻ $f"
  done
  git checkout -- . 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Git Pull
# ─────────────────────────────────────────────────────────────────────────────

echo -e "  ${GREEN}▶ git pull ...${NC}"
PULL_OUTPUT=$(git pull 2>&1)

NEW_COMMIT=$(git rev-parse --short HEAD)
NEW_MSG=$(git log -1 --pretty=format:"%s")

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo -e "  ${YELLOW}⚡ Bereits auf dem neuesten Stand (${NEW_COMMIT})${NC}"
  echo ""
  echo -e "${GREEN}✓ Kein Update nötig${NC}"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Zeigen was sich geändert hat
# ─────────────────────────────────────────────────────────────────────────────

echo -e "  ${GREEN}▶ Neue Commits:${NC}"
git log --oneline "${OLD_COMMIT}..${NEW_COMMIT}" | while read -r line; do
  echo -e "    ${GREEN}+${NC} $line"
done
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 5. Dependencies + Build
# ─────────────────────────────────────────────────────────────────────────────

echo -e "  ${GREEN}▶ npm install ...${NC}"
npm install --loglevel=error 2>&1 | tail -3

echo -e "  ${GREEN}▶ npm run build ...${NC}"
npm run build 2>&1 | tail -3

# ─────────────────────────────────────────────────────────────────────────────
# 6. tools/ Ordner sicherstellen (für systemd ReadWritePaths)
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR/tools"

# ─────────────────────────────────────────────────────────────────────────────
# 7. CLI aktualisieren (falls vorhanden)
# ─────────────────────────────────────────────────────────────────────────────

if [ -f "$INSTALL_DIR/scripts/bau-os-cli.sh" ]; then
  cp "$INSTALL_DIR/scripts/bau-os-cli.sh" /usr/local/bin/bau-os 2>/dev/null || true
  chmod +x /usr/local/bin/bau-os 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. Service neustarten
# ─────────────────────────────────────────────────────────────────────────────

echo -e "  ${GREEN}▶ Service neustarten ...${NC}"
systemctl restart bau-os 2>/dev/null || true

# Warten bis Service läuft
for i in $(seq 1 10); do
  if systemctl is-active --quiet bau-os 2>/dev/null; then
    break
  fi
  sleep 1
done

echo ""
echo -e "${CYAN}──────────────────────────────────────${NC}"

if systemctl is-active --quiet bau-os 2>/dev/null; then
  echo -e "  ${GREEN}✓ Update erfolgreich!${NC}"
  echo -e "  ${YELLOW}${OLD_COMMIT}${NC} → ${GREEN}${NEW_COMMIT}${NC} — ${NEW_MSG}"
else
  echo -e "  ${RED}✗ Service startet nicht!${NC}"
  echo ""
  journalctl -u bau-os -n 15 --no-pager
fi

echo -e "${CYAN}──────────────────────────────────────${NC}"
