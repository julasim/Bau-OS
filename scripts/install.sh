#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PATIO Installations-Script (bare metal, systemd)
# Getestet auf: Ubuntu 24.04 LTS
#
# Verwendung:
#   curl -fsSL https://raw.githubusercontent.com/julasim/patio/main/scripts/install.sh | bash
#   oder:
#   chmod +x scripts/install.sh && sudo bash scripts/install.sh
#
# WAS DIESES SKRIPT EINRICHTET:
#   Node.js 24 · PostgreSQL (Datenbank, Rolle, Extensions) · PATIO-Build ·
#   Service-Benutzer · .env · systemd-Unit · CLI-Werkzeug `patio`
#
# WAS ES NICHT MEHR TUT:
#   Telegram-Bot-Token abfragen und Ollama installieren. Beides ist mit dem
#   Umbau zum Firmenserver (AP0) ersatzlos entfallen; kein Code liest
#   BOT_TOKEN oder OLLAMA_* noch. Stattdessen wird jetzt die Datenbank
#   eingerichtet — ohne DATABASE_URL bricht src/index.ts den Start hart ab.
# ─────────────────────────────────────────────────────────────────────────────

set -e

# UTF-8 für Umlaute (muss vor allem anderen gesetzt werden)
export LANG=de_AT.UTF-8
export LC_ALL=de_AT.UTF-8
export LANGUAGE=de_AT.UTF-8

# ─────────────────────────────────────────────────────────────────────────────
# Konfiguration
# ─────────────────────────────────────────────────────────────────────────────
readonly INSTALL_DIR_DEFAULT="/opt/patio"
readonly WORKSPACE_DIR_DEFAULT="/opt/patio-workspace"
readonly SERVICE_USER="patio"
readonly REPO_URL="https://github.com/julasim/patio.git"

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
  echo -e "  ${CYAN}Bürosoftware für Architektur- und Planungsbüros${NC}"
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
print_header "PATIO Installation"

echo "Dieses Script installiert PATIO vollautomatisch auf Ubuntu 24.04."
echo "Du wirst nach wenigen Werten gefragt."
echo ""

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 1: Konfiguration abfragen (alles VOR der Installation)
# ═════════════════════════════════════════════════════════════════════════════
print_section "Konfiguration"

# ── Datenbank ─────────────────────────────────────────────────────────────────
# PATIO laeuft ausschliesslich gegen PostgreSQL. Ohne DATABASE_URL beendet
# sich der Dienst beim Start mit Exit-Code 1 (src/index.ts).
echo -e "  ${BOLD}Datenbank (PostgreSQL)${NC}"
info "PATIO speichert Projekte, Notizen, Aufgaben, Termine und Team in Postgres."
info "Ohne Datenbank startet der Dienst nicht."
DB_CHOICE=$(select_option "Auswahl" \
  "PostgreSQL auf diesem Server installieren und einrichten (empfohlen)" \
  "Vorhandene Datenbank nutzen (Connection-String eingeben)")

DB_NAME="patio"
DB_USER="patio"
DB_PASS=""
DATABASE_URL=""

if [ "$DB_CHOICE" -eq 1 ]; then
  DB_MODE="local"
  # Passwort wird erzeugt statt erfragt: es landet nur in der .env und im
  # Connection-String, niemand muss es sich merken. Hex = keine Zeichen, die
  # in SQL oder in der URL escaped werden muessten.
  DB_PASS=$(openssl rand -hex 16)
  info "Datenbank '$DB_NAME', Rolle '$DB_USER', Passwort wird erzeugt."
else
  DB_MODE="extern"
  echo ""
  info "Format: postgres://BENUTZER:PASSWORT@HOST:5432/DATENBANK"
  info "Die Datenbank braucht uuid-ossp, pg_trgm und unaccent (postgresql-contrib)."
  info "pgvector wird NICHT mehr benötigt — PATIO kennt seit AP0 keine Embeddings."
  while true; do
    DATABASE_URL=$(ask_required "DATABASE_URL")
    if [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
      break
    fi
    echo -e "  ${RED}Das sieht nicht nach einem Connection-String aus (postgres://…).${NC}"
  done
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
if [ "$DB_MODE" = "local" ]; then
  info "Datenbank:    lokal (PostgreSQL wird installiert, DB '$DB_NAME')"
else
  # Passwort im Connection-String nicht mit ausgeben.
  info "Datenbank:    extern ($(echo "$DATABASE_URL" | sed -E 's#(://[^:/@]+):[^@]*@#\1:****@#'))"
fi
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
# SCHRITT 3: Node.js 24
#
# package.json fordert "engines": { "node": ">=24" }, .nvmrc sagt 24 und das
# Dockerfile baut auf node:24-bookworm-slim. Hier stand bis zum Umbau
# Node.js 20 — der Build waere auf einer frischen Maschine schiefgegangen.
# ═════════════════════════════════════════════════════════════════════════════
readonly NODE_MAJOR=24
step "Node.js $NODE_MAJOR installieren..."
if ! command -v node &> /dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt $NODE_MAJOR ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1
  apt-get install -y nodejs >/dev/null 2>&1
  command -v node &>/dev/null || err "Node.js konnte nicht installiert werden."
  ok "Node.js $(node --version) installiert"
else
  ok "Node.js $(node --version) bereits vorhanden"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 4: PostgreSQL
#
# Ersetzt den frueheren Ollama-Schritt. Die systemd-Unit (patio.service)
# deklariert bereits `After=postgresql.service` — nur installiert hat die
# Datenbank bislang niemand.
#
# Wichtig: die Extensions muessen als Superuser angelegt werden — die
# App-Rolle darf `CREATE EXTENSION` nicht. Deshalb hier vorab, analog zu
# docker/init/00_extensions.sql beim Container-Setup.
#
# Gebraucht werden nur uuid-ossp, pg_trgm und unaccent; alle drei kommen aus
# postgresql-contrib. pgvector ist NICHT mehr noetig — PATIO kennt seit AP0
# keine Embeddings, und im internetlosen Buero waere das Paket ohnehin nicht
# zu beschaffen.
# ═════════════════════════════════════════════════════════════════════════════
if [ "$DB_MODE" = "local" ]; then
  step "PostgreSQL installieren..."
  if ! command -v psql &> /dev/null; then
    apt-get install -y postgresql postgresql-contrib >/dev/null 2>&1
    ok "PostgreSQL installiert"
  else
    ok "PostgreSQL bereits vorhanden"
  fi

  systemctl enable postgresql --quiet 2>/dev/null || true
  systemctl start postgresql 2>/dev/null || true

  step "Datenbank einrichten ($DB_NAME)..."
  PSQL="su -s /bin/bash postgres -c"

  if $PSQL "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
    $PSQL "psql -q -c \"ALTER ROLE \\\"$DB_USER\\\" WITH LOGIN PASSWORD '$DB_PASS'\"" >/dev/null
    ok "Rolle '$DB_USER' vorhanden — Passwort aktualisiert"
  else
    $PSQL "psql -q -c \"CREATE ROLE \\\"$DB_USER\\\" WITH LOGIN PASSWORD '$DB_PASS'\"" >/dev/null
    ok "Rolle '$DB_USER' angelegt"
  fi

  if $PSQL "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$DB_NAME'\"" | grep -q 1; then
    ok "Datenbank '$DB_NAME' vorhanden"
  else
    $PSQL "createdb -O '$DB_USER' '$DB_NAME'" || err "Datenbank '$DB_NAME' konnte nicht angelegt werden."
    ok "Datenbank '$DB_NAME' angelegt"
  fi

  # ON_ERROR_STOP=1: ohne diese Extensions scheitert Migration 001, und der
  # Dienst kaeme dann erst beim allerersten Start nicht hoch — mit einem
  # Fehler, den hier niemand mehr sieht.
  if ! $PSQL "psql -v ON_ERROR_STOP=1 -q -d '$DB_NAME' \
        -c 'CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"' \
        -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm' \
        -c 'CREATE EXTENSION IF NOT EXISTS unaccent'"; then
    echo ""
    err "Extensions konnten nicht angelegt werden. Meist fehlt postgresql-contrib:
       sudo apt-get install postgresql-contrib
     Danach dieses Script erneut ausführen."
  fi
  ok "Extensions bereit (uuid-ossp, pg_trgm, unaccent)"

  DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
else
  step "Datenbank..."
  ok "Vorhandene Datenbank wird genutzt — nichts zu installieren"
fi

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 5: PATIO klonen und bauen (VOR useradd — verhindert skel-Konflikt)
# ═════════════════════════════════════════════════════════════════════════════
step "PATIO installieren..."
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
ok "PATIO gebaut (Backend + Web-Oberfläche)"

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

# SCHRITT 7 (LLM-Modell herunterladen) ist ersatzlos entfallen — seit AP0 gibt
# es weder LLM-Laufzeit noch Embeddings. Die Datenbank steht bereits (Schritt 4).

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
# SCHRITT 9: Web-Admin + Secrets vorbereiten
# ═════════════════════════════════════════════════════════════════════════════
step "Web-Admin einrichten..."

# JWT Secret generieren (64 Hex-Zeichen — deutlich ueber der 32-Zeichen-Grenze,
# unter der src/index.ts den Production-Start verweigert).
JWT_SECRET=$(openssl rand -hex 32)
# Eigener Schluessel fuer die Feld-Verschluesselung. Bei einer Neuinstallation
# gefahrlos: es gibt noch nichts, was umgeschluesselt werden muesste. Ohne ihn
# haengt die Verschluesselung am JWT_SECRET und ueberlebt keine Rotation.
ENCRYPTION_KEY=$(openssl rand -hex 32)

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
# SCHRITT 10: .env erstellen
#
# Pflichtfelder sind WORKSPACE_PATH, DATABASE_URL und JWT_SECRET — fehlt eines,
# beendet sich der Dienst beim Start. Frueher wurde hier BOT_TOKEN geprueft und
# DATABASE_URL gar nicht geschrieben; die Installation konnte damit gar nicht
# hochkommen.
#
# Eine bestehende .env wird NICHT ueberschrieben: dort koennen SMTP-Zugaenge,
# ein ENCRYPTION_KEY und ein bereits benutztes JWT_SECRET stehen. Ein neues
# JWT_SECRET wuerde nicht nur alle Sitzungen entwerten, sondern (solange kein
# eigener ENCRYPTION_KEY gesetzt ist) auch die verschluesselten Felder
# unlesbar machen. Ergaenzt wird nur, was fehlt.
# ═════════════════════════════════════════════════════════════════════════════
step ".env konfigurieren..."

# Setzt einen Schluessel nur, wenn er noch nicht (mit Wert) in der .env steht.
#
# Bewusst KEIN `sed -i "s|^KEY=.*|KEY=$value|"`: im Ersetzungstext sind "&"
# und der Trenner "|" Sonderzeichen. Ein Passwort mit "&" waere dabei still
# verfaelscht worden — genau die Sorte Fehler, die erst Wochen spaeter als
# "Login geht nicht" auffaellt. Stattdessen: leere Zeile entfernen, Wert
# woertlich anhaengen.
env_set_if_missing() {
  local key="$1" value="$2"
  if grep -qE "^${key}=.+" "$INSTALL_DIR/.env" 2>/dev/null; then
    return 1
  fi
  grep -vE "^${key}=" "$INSTALL_DIR/.env" > "$INSTALL_DIR/.env.tmp" 2>/dev/null || true
  mv "$INSTALL_DIR/.env.tmp" "$INSTALL_DIR/.env"
  printf '%s=%s\n' "$key" "$value" >> "$INSTALL_DIR/.env"
  return 0
}

if [ -f "$INSTALL_DIR/.env" ]; then
  warn ".env bereits vorhanden — nur fehlende Pflichtwerte werden ergänzt"
  env_set_if_missing WORKSPACE_PATH "$WORKSPACE_DIR" && info "WORKSPACE_PATH ergänzt"
  env_set_if_missing DATABASE_URL   "$DATABASE_URL"  && info "DATABASE_URL ergänzt"
  env_set_if_missing JWT_SECRET     "$JWT_SECRET"    && info "JWT_SECRET ergänzt"
  env_set_if_missing ENCRYPTION_KEY "$ENCRYPTION_KEY" && info "ENCRYPTION_KEY ergänzt"
  env_set_if_missing API_PORT       "$API_PORT"      && info "API_PORT ergänzt"
  ok ".env geprüft"
else
  cat > "$INSTALL_DIR/.env" << ENVEOF
# PATIO Konfiguration (generiert von install.sh)
# Alle verfügbaren Schlüssel mit Erklärung: .env.example

# ── Pflicht: ohne diese drei bricht der Dienst beim Start ab ──
WORKSPACE_PATH=$WORKSPACE_DIR
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET

# Eigener Schlüssel für die Feld-Verschlüsselung (statt Rückfall auf JWT_SECRET)
ENCRYPTION_KEY=$ENCRYPTION_KEY

API_PORT=$API_PORT

# ── SMTP: Pflicht für den Login ──
# Der Login verschickt 6-stellige Codes per E-Mail. Ohne SMTP_HOST landet der
# Code nur im Server-Log — im Dauerbetrieb kann sich damit niemand anmelden.
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=PATIO <noreply@patio.local>
ENVEOF
  ok ".env erstellt"
fi

chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
chmod 600 "$INSTALL_DIR/.env"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 11: CLI-Tool installieren
# ═════════════════════════════════════════════════════════════════════════════
step "patio CLI installieren..."
cp "$INSTALL_DIR/scripts/patio-cli.sh" /usr/local/bin/patio
chmod +x /usr/local/bin/patio

# Pfade im CLI auf tatsächliche Installationspfade anpassen
sed -i "s|INSTALL_DIR=\"/opt/patio\"|INSTALL_DIR=\"$INSTALL_DIR\"|" /usr/local/bin/patio
sed -i "s|WORKSPACE_DIR=\"/opt/patio-workspace\"|WORKSPACE_DIR=\"$WORKSPACE_DIR\"|" /usr/local/bin/patio
sed -i "s|SERVICE_USER=\"patio\"|SERVICE_USER=\"$SERVICE_USER\"|" /usr/local/bin/patio

ok "CLI verfügbar: 'patio' oder 'sudo patio'"

# ═════════════════════════════════════════════════════════════════════════════
# SCHRITT 12: systemd Service
# ═════════════════════════════════════════════════════════════════════════════
step "systemd Service installieren..."

# Pfade in der Service-Datei anpassen (Workspace-Pfad ZUERST, da er den kürzeren enthält)
sed \
  "s|/opt/patio-workspace|$WORKSPACE_DIR|g; \
   s|/opt/patio|$INSTALL_DIR|g; \
   s|User=patio|User=$SERVICE_USER|g" \
  "$INSTALL_DIR/patio.service" > /etc/systemd/system/patio.service

systemctl daemon-reload
systemctl enable patio --quiet 2>/dev/null || true

# Eventuell laufenden Service stoppen vor Neustart
systemctl stop patio 2>/dev/null || true
systemctl start patio

# Aktiv warten statt festes sleep (max 15 Sekunden)
if wait_for_service "patio"; then
  ok "PATIO Service läuft"
else
  echo ""
  warn "Service konnte nicht gestartet werden. Logs:"
  echo ""
  journalctl -u patio -n 20 --no-pager
  echo ""
  err "Installation fehlgeschlagen. Siehe Logs oben."
fi

# ═════════════════════════════════════════════════════════════════════════════
# FERTIG
# ═════════════════════════════════════════════════════════════════════════════
echo ""
print_header "Installation abgeschlossen!"
echo ""
echo -e "  ${GREEN}▸${NC} Web-Oberfläche: ${BOLD}http://<server-ip>:${API_PORT}${NC}"
echo    "    Login: ${WEB_USER} / (dein gewähltes Passwort)"
echo ""
echo -e "  ${YELLOW}▸${NC} ${BOLD}Noch offen: SMTP eintragen.${NC}"
echo    "    Der Login schickt 6-stellige Codes per E-Mail. Solange SMTP_HOST in"
echo    "    ${INSTALL_DIR}/.env leer ist, steht der Code nur im Log:"
echo    "      sudo patio logs"
echo    "    Nach dem Eintragen: sudo patio restart"
echo ""
echo -e "  ${BOLD}CLI-Befehle:${NC}"
echo    "    patio                   → Interaktives Menü"
echo    "    patio status            → Status"
echo    "    patio db                → Datenbank + Migrationsstand"
echo    "    patio logs              → Logs anzeigen"
echo    "    patio logs live         → Live-Logs"
echo    "    sudo patio restart      → Neustart"
echo    "    sudo patio update       → Update einspielen"
echo    "    sudo patio user add     → Neuen Web-User anlegen"
echo ""
