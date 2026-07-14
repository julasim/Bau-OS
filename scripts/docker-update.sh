#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO Docker Update
# Pull + Rebuild + Restart — in einem Command.
#
# Verwendung:
#   bash /opt/patio/scripts/docker-update.sh
#   oder (via curl):
#   curl -fsSL https://raw.githubusercontent.com/julasim/patio/main/scripts/docker-update.sh | bash
# ─────────────────────────────────────────────────────────────────────────────

set -e

readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

INSTALL_DIR="${PATIO_DIR:-/opt/patio}"

# ─────────────────────────────────────────────────────────────────────────────
# 1. Pruefungen
# ─────────────────────────────────────────────────────────────────────────────

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo -e "${RED}✗ Kein Git-Repository in $INSTALL_DIR${NC}"
  echo -e "  Setze PATIO_DIR wenn die Installation anderswo liegt:"
  echo -e "    ${CYAN}PATIO_DIR=/pfad/zu/patio bash docker-update.sh${NC}"
  exit 1
fi

if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  echo -e "${RED}✗ Kein docker-compose.yml in $INSTALL_DIR — dieses Script ist fuer Docker-Installationen${NC}"
  echo -e "  Fuer systemd-Installationen: ${CYAN}sudo patio update${NC}"
  exit 1
fi

cd "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

# Sicherstellen, dass das Skript selbst ausfuehrbar ist
# (Git auf Windows/OneDrive verliert gelegentlich das Exec-Bit)
chmod +x "$INSTALL_DIR/scripts/docker-update.sh" 2>/dev/null || true

# Beim ersten Lauf einen praktischen Alias ablegen (idempotent, silent bei Fehlschlag)
if [ ! -L /usr/local/bin/patio-update ] && [ -w /usr/local/bin ] 2>/dev/null; then
  ln -sf "$INSTALL_DIR/scripts/docker-update.sh" /usr/local/bin/patio-update 2>/dev/null || true
fi

echo -e "${CYAN}──────────────────────────────────────${NC}"
echo -e "${CYAN}  PATIO Docker Update${NC}"
echo -e "${CYAN}──────────────────────────────────────${NC}"
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# 2. Aktueller Stand
# ─────────────────────────────────────────────────────────────────────────────

OLD_COMMIT=$(git rev-parse --short HEAD)
OLD_MSG=$(git log -1 --pretty=format:"%s")
echo -e "  Aktuell: ${YELLOW}${OLD_COMMIT}${NC} — ${OLD_MSG}"

# ─────────────────────────────────────────────────────────────────────────────
# 3. Lokale Aenderungen verwerfen (package-lock, CRLF-Umschreibungen etc.)
# ─────────────────────────────────────────────────────────────────────────────

DIRTY_FILES=$(git diff --name-only 2>/dev/null || true)
if [ -n "$DIRTY_FILES" ]; then
  echo -e "  ${YELLOW}▶ Lokale Aenderungen zuruecksetzen:${NC}"
  echo "$DIRTY_FILES" | while read -r f; do echo -e "    ↻ $f"; done
  git checkout -- . 2>/dev/null || true
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Git Pull
# ─────────────────────────────────────────────────────────────────────────────

echo -e "  ${GREEN}▶ git pull ...${NC}"
git pull --ff-only

NEW_COMMIT=$(git rev-parse --short HEAD)
NEW_MSG=$(git log -1 --pretty=format:"%s")

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo -e "  ${YELLOW}⚡ Bereits auf dem neuesten Stand (${NEW_COMMIT})${NC}"
  echo ""
  read -rp "  Trotzdem Container neu bauen? [j/N]: " confirm
  if [[ ! "$confirm" =~ ^[jJ]$ ]]; then
    echo -e "${GREEN}✓ Kein Update noetig${NC}"
    exit 0
  fi
else
  echo -e "  ${GREEN}▶ Neue Commits:${NC}"
  git log --oneline "${OLD_COMMIT}..${NEW_COMMIT}" | while read -r line; do
    echo -e "    ${GREEN}+${NC} $line"
  done
  echo ""
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Docker: Offizielle Images pullen (postgres/ollama/caddy), App rebuilden
# ─────────────────────────────────────────────────────────────────────────────

echo -e "  ${GREEN}▶ docker compose pull postgres ollama caddy ...${NC}"
if ! docker compose pull postgres ollama caddy; then
  echo -e "  ${YELLOW}⚠ Pull fehlgeschlagen (Offline? Registry down?) — fahre mit lokalen Images fort${NC}"
fi

echo -e "  ${GREEN}▶ docker compose up -d --build app ...${NC}"
docker compose up -d --build app

# caddy und ollama nur starten wenn sie down sind (kein unnoetiger Restart)
docker compose up -d postgres ollama caddy

# ─────────────────────────────────────────────────────────────────────────────
# 6. Health-Check (einfach: laeuft der Container?)
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${GREEN}▶ Warte auf Container-Start ...${NC}"
for i in $(seq 1 20); do
  if docker compose ps --format json 2>/dev/null | grep -q '"State":"running"'; then
    break
  fi
  sleep 1
done

echo ""
echo -e "${CYAN}──────────────────────────────────────${NC}"

if docker compose ps --format json 2>/dev/null | grep -q '"State":"running"'; then
  echo -e "  ${GREEN}✓ Update erfolgreich!${NC}"
  echo -e "  ${YELLOW}${OLD_COMMIT}${NC} → ${GREEN}${NEW_COMMIT}${NC} — ${NEW_MSG}"
  echo ""
  echo -e "  Logs anzeigen: ${CYAN}docker compose logs -f${NC}"
else
  echo -e "  ${RED}✗ Container laeuft nicht!${NC}"
  echo ""
  docker compose logs --tail=20
fi

echo -e "${CYAN}──────────────────────────────────────${NC}"
