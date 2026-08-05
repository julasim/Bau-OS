#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO Kunden-Installer (Docker-basiert)
#
# Verwendung (einmaliger Befehl für den Kunden):
#   curl -fsSL https://raw.githubusercontent.com/julasim/patio/main/patio/scripts/install-customer.sh | bash
#
# Setzt voraus:
#   - Ubuntu 22.04 / 24.04 LTS
#   - Root-Zugriff (sudo)
#   - Ports 80 + 443 offen (Firewall)
#   - Domain-Eintrag bereits gesetzt (z.B. buero.patio.at → Server-IP)
#
# Nutzt docker/docker-compose.standalone.yml: postgres + app + caddy, also
# mit eigenem Reverse-Proxy statt des gemeinsamen Edge-Proxys.
#
# Telegram-Bot-Token, OpenAI-Key und Ollama-Modell werden nicht mehr
# abgefragt — mit dem Umbau zum Firmenserver (AP0) sind Bot und LLM-Laufzeit
# ersatzlos entfallen, kein Code liest diese Werte noch.
# ─────────────────────────────────────────────────────────────────────────────

set -e

export LANG=de_AT.UTF-8 LC_ALL=de_AT.UTF-8 LANGUAGE=de_AT.UTF-8

readonly REPO_URL="https://github.com/julasim/patio.git"
readonly INSTALL_DIR="/opt/patio"
readonly WORKSPACE_DIR="/opt/patio-workspace"

# ── Farben ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BLUE='\033[1;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  !${NC} $1"; }
err()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }
step() { echo ""; echo -e "${YELLOW}▶${NC} ${BOLD}$1${NC}"; }
info() { echo -e "${DIM}   $1${NC}"; }

ask_required() {
  local prompt="$1" var
  while true; do
    read -rp "  $prompt: " var < /dev/tty
    [ -n "$var" ] && echo "$var" && return
    echo -e "  ${RED}Darf nicht leer sein.${NC}" >&2
  done
}

ask_default() {
  local prompt="$1" default="$2" var
  read -rp "  $prompt [$default]: " var < /dev/tty
  echo "${var:-$default}"
}

# ── Logo ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLUE}  ██████╗  █████╗ ██╗   ██╗      ██████╗ ███████╗${NC}"
echo -e "${BLUE}  ██╔══██╗██╔══██╗██║   ██║     ██╔═══██╗██╔════╝${NC}"
echo -e "${BLUE}  ██████╔╝███████║██║   ██║     ██║   ██║███████╗${NC}"
echo -e "${BLUE}  ██╔══██╗██╔══██║██║   ██║     ██║   ██║╚════██║${NC}"
echo -e "${BLUE}  ██████╔╝██║  ██║╚██████╔╝     ╚██████╔╝███████║${NC}"
echo -e "${BLUE}  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝       ╚═════╝ ╚══════╝${NC}"
echo ""
echo -e "  ${CYAN}Bürosoftware für Architektur- und Planungsbüros${NC}"
echo -e "  ${DIM}────────────────────────────────────────────────────────${NC}"
echo ""

# ── Root-Check ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Bitte als root ausführen: sudo bash $0"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 1: Konfiguration abfragen
# ═════════════════════════════════════════════════════════════════════════════
echo -e "${BOLD}── Konfiguration${NC}"
echo ""

echo -e "  ${BOLD}Domain${NC}"
info "Deine zugewiesene PATIO Domain (z.B. meinbuero.patio.at)"
info "Die Domain muss bereits auf diese Server-IP zeigen!"
echo ""
CADDY_DOMAIN=$(ask_required "Domain (z.B. meinbuero.patio.at)")
CADDY_EMAIL=$(ask_required "E-Mail für SSL-Zertifikat")
echo ""

echo -e "  ${BOLD}Web-Oberfläche (Admin-Login)${NC}"
echo ""
WEB_USER=$(ask_default "Admin Benutzername" "admin")
while true; do
  read -rsp "  Admin Passwort: " WEB_PASS < /dev/tty; echo ""
  [ -z "$WEB_PASS" ] && echo -e "  ${RED}Darf nicht leer sein.${NC}" && continue
  read -rsp "  Passwort wiederholen: " WEB_PASS2 < /dev/tty; echo ""
  [ "$WEB_PASS" = "$WEB_PASS2" ] && break
  echo -e "  ${RED}Passwörter stimmen nicht überein.${NC}"
done
echo ""

# ── Zusammenfassung ───────────────────────────────────────────────────────────
echo -e "${BOLD}── Zusammenfassung${NC}"
echo ""
info "Domain:    https://${CADDY_DOMAIN}"
info "Admin:     ${WEB_USER}"
info "Services:  postgres + app + caddy (Docker Compose, standalone)"
echo ""
read -rp "  Installation starten? [j/N]: " CONFIRM < /dev/tty
[[ ! "$CONFIRM" =~ ^[jJ]$ ]] && echo "Abgebrochen." && exit 0

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 2: Docker installieren
# ═════════════════════════════════════════════════════════════════════════════
step "System aktualisieren..."
apt-get update -y >/dev/null 2>&1
apt-get install -y curl git locales >/dev/null 2>&1
locale-gen de_AT.UTF-8 >/dev/null 2>&1 || locale-gen en_US.UTF-8 >/dev/null 2>&1
ok "System bereit"

step "Docker installieren..."
if command -v docker &>/dev/null; then
  ok "Docker bereits installiert ($(docker --version | cut -d' ' -f3 | tr -d ','))"
else
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  ok "Docker installiert"
fi

# Docker Compose v2 prüfen
if ! docker compose version &>/dev/null; then
  apt-get install -y docker-compose-plugin >/dev/null 2>&1
fi
ok "Docker Compose $(docker compose version --short) bereit"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 3: PATIO klonen
# ═════════════════════════════════════════════════════════════════════════════
step "PATIO herunterladen..."
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Bereits installiert — führe Update durch"
  git -C "$INSTALL_DIR" pull --quiet
else
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi
ok "PATIO geladen"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 4: Workspace + Daten-Verzeichnisse anlegen
# ═════════════════════════════════════════════════════════════════════════════
step "Verzeichnisse anlegen..."
mkdir -p "$WORKSPACE_DIR"
mkdir -p "$INSTALL_DIR/logs" "$INSTALL_DIR/data" "$INSTALL_DIR/tools"
ok "Verzeichnisse erstellt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 5: Admin-User + JWT Secret
# ═════════════════════════════════════════════════════════════════════════════
step "Admin-Benutzer einrichten..."

JWT_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# bcrypt-Hash via Node.js (falls vorhanden) oder Python3
if command -v node &>/dev/null; then
  # Installiere bcrypt temporär falls nötig
  cd "$INSTALL_DIR" && npm install --loglevel=error --no-save 2>/dev/null || true
  PASS_HASH=$(node -e "const b=require('bcrypt');b.hash(process.argv[1],10).then(h=>process.stdout.write(h))" "$WEB_PASS" 2>/dev/null || echo "")
fi

# Fallback: Python3 bcrypt
if [ -z "$PASS_HASH" ]; then
  pip3 install bcrypt -q 2>/dev/null || true
  PASS_HASH=$(python3 -c "import bcrypt,sys; print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt()).decode())" "$WEB_PASS" 2>/dev/null || echo "")
fi

if [ -z "$PASS_HASH" ] || [[ "$PASS_HASH" == PLAIN:* ]]; then
  err "Fehler: bcrypt konnte nicht installiert werden. Bitte Node.js oder Python3 mit bcrypt-Paket installieren und erneut versuchen."
fi

cat > "$INSTALL_DIR/data/users.json" << USERSEOF
[{"username":"$WEB_USER","passwordHash":"$PASS_HASH","role":"admin","createdAt":"$(date +%Y-%m-%d)"}]
USERSEOF
chmod 600 "$INSTALL_DIR/data/users.json"
ok "Admin '${WEB_USER}' erstellt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 6: .env erstellen
# ═════════════════════════════════════════════════════════════════════════════
step ".env konfigurieren..."
cd "$INSTALL_DIR"

cat > .env << ENVEOF
# PATIO Konfiguration — generiert von install-customer.sh
# Alle verfügbaren Schlüssel mit Erklärung: .env.example

# Domain + SSL (nur für den standalone-Caddy in docker/)
CADDY_DOMAIN=${CADDY_DOMAIN}
CADDY_EMAIL=${CADDY_EMAIL}

# Workspace — Host-Verzeichnis; im Container liegt es unter /workspace
# (WORKSPACE_PATH setzt die compose-Datei selbst).
WORKSPACE_HOST_DIR=${WORKSPACE_DIR}

# Pflicht für den Web-Login — ohne Secret bricht der Dienst beim Start ab.
JWT_SECRET=${JWT_SECRET}
# Eigener Schlüssel für die Feld-Verschlüsselung (sonst Rückfall auf JWT_SECRET).
ENCRYPTION_KEY=${ENCRYPTION_KEY}
API_PORT=3000

# Datenbank — Container 'postgres' im compose-Netzwerk.
#
# DATABASE_URL steht hier BEWUSST nicht: docker-compose.standalone.yml setzt
# sie im Block services.app.environment aus diesen drei Variablen zusammen,
# und 'environment' schlägt 'env_file'. Ein Wert hier hätte keine Wirkung.
POSTGRES_USER=patio
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=patio

# ── SMTP: Pflicht für den Login ──
# Der Login verschickt 6-stellige Codes per E-Mail. Ohne SMTP_HOST landet der
# Code nur im Container-Log — dann kann sich niemand anmelden.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=PATIO <noreply@${CADDY_DOMAIN}>
ENVEOF

chmod 600 .env
ok ".env erstellt"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 7: Docker Stack starten
# ═════════════════════════════════════════════════════════════════════════════
step "PATIO starten (Docker)..."
cd "$INSTALL_DIR"

# Standalone Compose (mit eingebautem Caddy)
COMPOSE_FILE="$INSTALL_DIR/docker/docker-compose.standalone.yml"

docker compose -f "$COMPOSE_FILE" pull --quiet 2>/dev/null || true
docker compose -f "$COMPOSE_FILE" build --quiet
docker compose -f "$COMPOSE_FILE" up -d

# Warten bis App bereit
info "Warte auf Datenbankstart..."
sleep 10

# Migration ausführen
docker compose -f "$COMPOSE_FILE" exec -T app npm run db:migrate 2>/dev/null && ok "Datenbank migriert" || warn "Migration konnte nicht ausgeführt werden — beim nächsten Start automatisch"

ok "PATIO läuft"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 8: Update-Script installieren
# ═════════════════════════════════════════════════════════════════════════════
step "Update-Befehl einrichten..."
cat > /usr/local/bin/patio-update << 'UPDATEEOF'
#!/bin/bash
INSTALL_DIR="/opt/patio"
COMPOSE_FILE="$INSTALL_DIR/docker/docker-compose.standalone.yml"
echo "▶ PATIO Update..."
git -C "$INSTALL_DIR" pull
docker compose -f "$COMPOSE_FILE" build app
docker compose -f "$COMPOSE_FILE" up -d
docker compose -f "$COMPOSE_FILE" exec -T app npm run db:migrate 2>/dev/null || true
echo "✓ Update abgeschlossen"
UPDATEEOF
chmod +x /usr/local/bin/patio-update
ok "Update-Befehl: patio-update"

# ═════════════════════════════════════════════════════════════════════════════
# FERTIG
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║${NC}  Installation abgeschlossen!"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}▸${NC} Dashboard:  ${BOLD}https://${CADDY_DOMAIN}${NC}"
echo    "    Login: ${WEB_USER} / (dein Passwort)"
echo ""
echo -e "  ${YELLOW}▸${NC} ${BOLD}Noch offen: SMTP eintragen.${NC}"
echo    "    Der Login schickt 6-stellige Codes per E-Mail. Solange SMTP_HOST in"
echo    "    ${INSTALL_DIR}/.env leer ist, steht der Code nur im Log:"
echo    "      docker compose -f $COMPOSE_FILE logs app"
echo    "    Nach dem Eintragen:"
echo    "      docker compose -f $COMPOSE_FILE up -d --force-recreate app"
echo ""
echo -e "  ${GREEN}▸${NC} SSL-Zertifikat wird automatisch von Let's Encrypt geholt."
echo    "    Das kann beim ersten Aufruf 1-2 Minuten dauern."
echo ""
echo -e "  ${BOLD}Verwaltung:${NC}"
echo    "    patio-update              → Update einspielen"
echo    "    docker compose -f $COMPOSE_FILE logs -f  → Logs"
echo ""
