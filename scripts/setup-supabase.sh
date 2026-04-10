#!/bin/bash
# ============================================================
# Bau-OS — Supabase Self-Hosted Setup
# Klont das offizielle supabase/supabase Docker-Setup,
# generiert sichere Secrets und startet alle Services.
#
# Aufruf: bash scripts/setup-supabase.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SUPABASE_DIR="$PROJECT_DIR/docker/supabase"

# ── Farben ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[FEHLER]${NC} $1"; exit 1; }

# ── Voraussetzungen pruefen ───────────────────────────────────
info "Pruefe Voraussetzungen..."

command -v git >/dev/null 2>&1    || error "git nicht gefunden. Bitte installieren."
command -v docker >/dev/null 2>&1 || error "docker nicht gefunden. Bitte installieren: https://docs.docker.com/get-docker/"

# Docker Compose (v2 Plugin oder standalone)
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  error "docker compose nicht gefunden. Bitte Docker Compose installieren."
fi

ok "git, docker, $COMPOSE vorhanden"

# ── Supabase Repository klonen/updaten ────────────────────────
if [ -d "$SUPABASE_DIR/.git" ]; then
  info "Supabase Docker-Setup existiert bereits — aktualisiere..."
  cd "$SUPABASE_DIR"
  git pull --quiet
  ok "Aktualisiert"
else
  info "Klone offizielles Supabase Docker-Setup..."
  # Sparse Checkout: nur docker/ Verzeichnis
  git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/supabase/supabase.git "$SUPABASE_DIR.tmp" 2>/dev/null

  cd "$SUPABASE_DIR.tmp"
  git sparse-checkout set docker

  # docker/ Inhalt nach supabase/ verschieben
  mkdir -p "$SUPABASE_DIR"
  cp -r docker/* "$SUPABASE_DIR/"
  cp -r docker/.env.example "$SUPABASE_DIR/" 2>/dev/null || true
  cd "$PROJECT_DIR"
  rm -rf "$SUPABASE_DIR.tmp"

  ok "Supabase Docker-Setup geklont nach docker/supabase/"
fi

cd "$SUPABASE_DIR"

# ── Secrets generieren ────────────────────────────────────────
gen_secret()  { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | xxd -p | tr -d '\n'; }
gen_base64()  { openssl rand -base64 "$1" 2>/dev/null || head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

if [ ! -f ".env" ]; then
  info "Generiere .env mit sicheren Secrets..."
  cp .env.example .env

  POSTGRES_PW=$(gen_secret 24)
  JWT_SEC=$(gen_secret 32)
  SECRET_BASE=$(gen_base64 48)
  VAULT_KEY=$(gen_secret 16)
  DASHBOARD_PW=$(gen_secret 16)
  META_CRYPTO=$(gen_secret 16)

  # Secrets in .env einsetzen (sed-kompatibel fuer Linux + macOS)
  sed_inplace() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "$@"
    else
      sed -i "$@"
    fi
  }

  sed_inplace "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PW|" .env
  sed_inplace "s|JWT_SECRET=.*|JWT_SECRET=$JWT_SEC|" .env
  sed_inplace "s|SECRET_KEY_BASE=.*|SECRET_KEY_BASE=$SECRET_BASE|" .env
  sed_inplace "s|VAULT_ENC_KEY=.*|VAULT_ENC_KEY=$VAULT_KEY|" .env
  sed_inplace "s|DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=$DASHBOARD_PW|" .env
  sed_inplace "s|PG_META_CRYPTO_KEY=.*|PG_META_CRYPTO_KEY=$META_CRYPTO|" .env 2>/dev/null || true

  # ANON_KEY und SERVICE_ROLE_KEY werden vom offiziellen Setup
  # ueber JWT generiert — die .env.example hat bereits Defaults.
  # Fuer Produktion sollten diese mit dem JWT_SECRET neu generiert werden.

  ok ".env erstellt mit generierten Secrets"
  echo ""
  echo -e "  ${GREEN}PostgreSQL Passwort:${NC}  $POSTGRES_PW"
  echo -e "  ${GREEN}Dashboard Passwort:${NC}   $DASHBOARD_PW"
  echo -e "  ${GREEN}Dashboard User:${NC}       supabase (Standard)"
  echo ""
  warn "Speichere diese Passwoerter sicher ab!"
  echo ""
else
  ok ".env existiert bereits — ueberspringe Secret-Generierung"
fi

# ── pgvector Extension sicherstellen ──────────────────────────
# Das offizielle supabase/postgres Image hat pgvector bereits vorinstalliert.
# Wir fuegen trotzdem unsere Extensions in ein Init-Script ein.
if [ -d "volumes/db/init" ] || mkdir -p "volumes/db/init" 2>/dev/null; then
  cat > "volumes/db/init/99_bauos_extensions.sql" << 'EOSQL'
-- Bau-OS: Zusaetzliche Extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
EOSQL
  ok "pgvector + pg_trgm + unaccent Extensions konfiguriert"
fi

# ── Docker Images pullen ──────────────────────────────────────
echo ""
info "Lade Docker Images herunter (kann einige Minuten dauern)..."
$COMPOSE pull 2>&1 | tail -5
ok "Images heruntergeladen"

# ── Services starten ──────────────────────────────────────────
echo ""
info "Starte Supabase Services..."
$COMPOSE up -d 2>&1 | tail -5

# ── Warten bis DB bereit ist ──────────────────────────────────
info "Warte auf PostgreSQL..."
for i in $(seq 1 30); do
  if $COMPOSE exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    ok "PostgreSQL ist bereit"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    error "PostgreSQL Start-Timeout (60s). Pruefe: $COMPOSE logs db"
  fi
done

# ── Status anzeigen ───────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Supabase Self-Hosted laeuft!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Studio:${NC}     http://localhost:8000"
echo -e "  ${BLUE}API:${NC}        http://localhost:8000/rest/v1"
echo -e "  ${BLUE}Realtime:${NC}   ws://localhost:8000/realtime/v1"
echo -e "  ${BLUE}Storage:${NC}    http://localhost:8000/storage/v1"
echo -e "  ${BLUE}PostgreSQL:${NC} localhost:5432"
echo ""

# ── DATABASE_URL fuer Bau-OS .env ausgeben ────────────────────
POSTGRES_PW=$(grep "^POSTGRES_PASSWORD=" .env | cut -d'=' -f2-)
SUPABASE_ANON=$(grep "^ANON_KEY=" .env | cut -d'=' -f2-)
SUPABASE_SERVICE=$(grep "^SERVICE_ROLE_KEY=" .env | cut -d'=' -f2-)

echo -e "  ${YELLOW}Fuege diese Zeilen in deine Bau-OS .env ein:${NC}"
echo ""
echo "  DATABASE_URL=postgres://postgres:${POSTGRES_PW}@localhost:5432/postgres"
echo "  SUPABASE_URL=http://localhost:8000"
echo "  SUPABASE_ANON_KEY=${SUPABASE_ANON}"
echo "  SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE}"
echo ""
echo -e "  ${BLUE}Dann: npm run db:migrate${NC}"
echo ""
