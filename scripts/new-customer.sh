#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS — Neuen Kunden onboarden (SIMA-Seite)
#
# Erstellt einen DNS-A-Record via Cloudflare API und gibt dem Kunden
# den fertigen Installations-Befehl.
#
# Voraussetzungen:
#   - Cloudflare API Token mit "Zone:DNS:Edit" Berechtigung
#   - CLOUDFLARE_TOKEN in ~/.bauos-admin oder als Umgebungsvariable
#   - CLOUDFLARE_ZONE_ID der Zone (z.B. bau-os.at)
#   - curl + jq installiert
#
# Verwendung:
#   bash scripts/new-customer.sh
#   bash scripts/new-customer.sh meinbuero 1.2.3.4
# ─────────────────────────────────────────────────────────────────────────────

set -e

# ── Konfiguration ─────────────────────────────────────────────────────────────
readonly BASE_DOMAIN="bau-os.at"          # Deine Domain — hier anpassen
readonly ADMIN_CONFIG="$HOME/.bauos-admin"

# Farben
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
err()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }
info() { echo -e "${DIM}   $1${NC}"; }

# ── Konfiguration laden ───────────────────────────────────────────────────────
if [ -f "$ADMIN_CONFIG" ]; then
  # shellcheck source=/dev/null
  source "$ADMIN_CONFIG"
fi

# Pflicht-Variablen prüfen / abfragen
if [ -z "${CLOUDFLARE_TOKEN:-}" ]; then
  echo -e "${BOLD}Cloudflare API Token${NC}"
  info "Erstelle unter: dash.cloudflare.com → Profil → API Tokens"
  info "Benötigte Berechtigung: Zone → DNS → Edit (nur für ${BASE_DOMAIN})"
  echo ""
  read -rp "  Cloudflare Token: " CLOUDFLARE_TOKEN
  echo ""
fi

if [ -z "${CLOUDFLARE_ZONE_ID:-}" ]; then
  echo -e "${BOLD}Cloudflare Zone ID${NC}"
  info "Zu finden auf der Übersichtsseite der Zone ${BASE_DOMAIN} → rechte Spalte"
  echo ""
  read -rp "  Zone ID: " CLOUDFLARE_ZONE_ID
  echo ""
fi

# Config speichern (optional)
if [ ! -f "$ADMIN_CONFIG" ]; then
  read -rp "  Konfiguration für nächstes Mal speichern? [j/N]: " SAVE_CONF
  if [[ "$SAVE_CONF" =~ ^[jJ]$ ]]; then
    cat > "$ADMIN_CONFIG" << CONFEOF
CLOUDFLARE_TOKEN="${CLOUDFLARE_TOKEN}"
CLOUDFLARE_ZONE_ID="${CLOUDFLARE_ZONE_ID}"
CONFEOF
    chmod 600 "$ADMIN_CONFIG"
    ok "Gespeichert in $ADMIN_CONFIG"
  fi
fi

# ── Kunden-Daten abfragen ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}── Neuer Kunde${NC}"
echo ""

# Argumente oder interaktiv
if [ -n "${1:-}" ]; then
  SUBDOMAIN="$1"
else
  read -rp "  Subdomain (nur Büroname, z.B. 'meinbuero'): " SUBDOMAIN
fi

# Validierung: nur Buchstaben, Zahlen, Bindestriche
if [[ ! "$SUBDOMAIN" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$ ]]; then
  err "Ungültige Subdomain: nur Kleinbuchstaben, Zahlen und Bindestriche erlaubt"
fi

FULL_DOMAIN="${SUBDOMAIN}.${BASE_DOMAIN}"

if [ -n "${2:-}" ]; then
  SERVER_IP="$2"
else
  read -rp "  Server-IP des Kunden: " SERVER_IP
fi

# IP validieren
if [[ ! "$SERVER_IP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
  err "Ungültige IP-Adresse: $SERVER_IP"
fi

echo ""
echo -e "  DNS-Eintrag: ${BOLD}${FULL_DOMAIN}${NC} → ${SERVER_IP}"
echo ""
read -rp "  DNS-Eintrag erstellen? [j/N]: " CONFIRM
[[ ! "$CONFIRM" =~ ^[jJ]$ ]] && echo "Abgebrochen." && exit 0

# ── Prüfen ob Subdomain bereits existiert ────────────────────────────────────
echo ""
info "Prüfe bestehende DNS-Einträge..."

EXISTING=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=A&name=${FULL_DOMAIN}" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
  -H "Content-Type: application/json")

RECORD_ID=$(echo "$EXISTING" | jq -r '.result[0].id // empty')

if [ -n "$RECORD_ID" ]; then
  # Update bestehenden Eintrag
  RESULT=$(curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
    -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${FULL_DOMAIN}\",\"content\":\"${SERVER_IP}\",\"ttl\":300,\"proxied\":false}")
  ACTION="aktualisiert"
else
  # Neuen Eintrag erstellen
  RESULT=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${FULL_DOMAIN}\",\"content\":\"${SERVER_IP}\",\"ttl\":300,\"proxied\":false}")
  ACTION="erstellt"
fi

SUCCESS=$(echo "$RESULT" | jq -r '.success')
if [ "$SUCCESS" != "true" ]; then
  echo ""
  err "Cloudflare API Fehler: $(echo "$RESULT" | jq -r '.errors[0].message // "Unbekannter Fehler"')"
fi

ok "DNS-Eintrag ${ACTION}: ${FULL_DOMAIN} → ${SERVER_IP}"

# ── Ausgabe für den Kunden ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║${NC}  Für den Kunden senden:"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Zugewiesene Domain:${NC} https://${FULL_DOMAIN}"
echo ""
echo -e "  ${BOLD}Installations-Befehl (auf dem Server als root ausführen):${NC}"
echo ""
echo -e "  ${GREEN}curl -fsSL https://raw.githubusercontent.com/julasim/Bau-OS/main/bau-os/scripts/install-customer.sh | sudo bash${NC}"
echo ""
echo -e "  ${BOLD}Hinweis für den Kunden:${NC}"
echo    "    - Ubuntu 22.04 oder 24.04 LTS wird vorausgesetzt"
echo    "    - Ports 80 und 443 müssen in der Firewall offen sein"
echo    "    - Der Bot Token kommt von @BotFather auf Telegram"
echo    "    - Die Domain ${FULL_DOMAIN} ist bereits eingerichtet"
echo ""
info "DNS-Ausbreitung kann 1-5 Minuten dauern."
info "SSL-Zertifikat wird automatisch beim ersten Aufruf geholt."
echo ""
