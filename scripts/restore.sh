#!/bin/bash
# ============================================================
# Bau-OS Restore — Tarball + DB-Dump zurueckspielen
# ============================================================
#
# Aufruf:
#   sudo bash scripts/restore.sh \
#     /opt/bau-os-backups/bau-os-backup-20260420-030000.tar.gz \
#     /opt/bau-os-backups/bau-os-db-20260420-030000.sql.gz
#
# Schritt 1: Tarball entpacken (Vault + .env + data/ + tools/)
# Schritt 2: Postgres-Dump in laufenden Container einspielen
# Schritt 3: bau-os-app Container neu starten
#
# WICHTIGE REGELN:
#   - Tarball + DB-Dump aus DEM SELBEN Tag verwenden. Sonst kann es zu
#     Schema-Drift kommen.
#   - VOR Restore: aktuellen Stand sichern (`bash scripts/backup.sh`).
#   - Bei Restore wird die existierende DB GELOESCHT (DROP + CREATE).
#
# Restore prueft NICHT, ob die DB schon mit Daten gefuellt ist —
# der Operator entscheidet bewusst.
# ============================================================
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Aufruf: $0 <backup-tarball> [db-dump]"
  echo ""
  echo "Beispiel:"
  echo "  sudo bash $0 \\"
  echo "    /opt/bau-os-backups/bau-os-backup-20260420-030000.tar.gz \\"
  echo "    /opt/bau-os-backups/bau-os-db-20260420-030000.sql.gz"
  exit 1
fi

TARBALL="$1"
DB_DUMP="${2:-}"

INSTALL_DIR="${INSTALL_DIR:-/opt/bau-os}"
VAULT_DIR="${VAULT_DIR:-/opt/bau-os-vault}"
DB_CONTAINER="${DB_CONTAINER:-bauos-postgres}"
APP_CONTAINER="${APP_CONTAINER:-bauos-app}"

if [ ! -f "$TARBALL" ]; then
  echo "FEHLER: Backup-Tarball nicht gefunden: $TARBALL"
  exit 1
fi

# DB-Dump-Auto-Detection: wenn nicht uebergeben, vom Tarball-Namen ableiten.
if [ -z "$DB_DUMP" ]; then
  GUESS="${TARBALL/bau-os-backup-/bau-os-db-}"
  GUESS="${GUESS%.tar.gz}.sql.gz"
  if [ -f "$GUESS" ]; then
    DB_DUMP="$GUESS"
    echo "[$(date)] DB-Dump automatisch erkannt: $DB_DUMP"
  fi
fi

# ── Bestaetigung ────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "Bau-OS Restore"
echo "============================================================"
echo "Tarball:   $TARBALL"
echo "DB-Dump:   ${DB_DUMP:-<keiner>}"
echo "Install:   $INSTALL_DIR"
echo "Vault:     $VAULT_DIR"
echo ""
echo "WARNUNG: Bestehende Daten werden ueberschrieben."
read -p "Fortfahren? (yes/no) " -r
if [ "$REPLY" != "yes" ]; then
  echo "Abgebrochen."
  exit 0
fi

# ── Schritt 1: Tarball entpacken ────────────────────────────────────────────
echo "[$(date)] Tarball entpacken..."
# tar wurde mit "-C $(dirname $VAULT_DIR) basename" + "-C $INSTALL_DIR .env data/ tools/"
# erstellt. Beim Restore landen die zwei Sets in / (root), damit /opt/bau-os/.env
# und /opt/bau-os-vault wieder am richtigen Platz sind.
tar -xzf "$TARBALL" -C / 2>&1 | tail -10

# Permissions auf .env wieder absichern (sonst lesbar fuer alle).
if [ -f "$INSTALL_DIR/.env" ]; then
  chmod 600 "$INSTALL_DIR/.env"
fi

# ── Schritt 2: Postgres restoren ────────────────────────────────────────────
if [ -n "$DB_DUMP" ]; then
  if [ ! -f "$DB_DUMP" ]; then
    echo "FEHLER: DB-Dump nicht gefunden: $DB_DUMP"
    exit 1
  fi

  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${DB_CONTAINER}$"; then
    echo "FEHLER: Postgres-Container '${DB_CONTAINER}' laeuft nicht."
    echo "Erst Bau-OS hochfahren, dann Restore wiederholen:"
    echo "  cd $INSTALL_DIR && docker compose up -d bauos-postgres"
    exit 1
  fi

  echo "[$(date)] Postgres-Dump einspielen..."
  # Der Dump wurde mit --clean --if-exists erstellt — DROP + CREATE ist
  # schon enthalten. Wir piepen ihn entpackt direkt in psql.
  if gunzip -c "$DB_DUMP" | docker exec -i "$DB_CONTAINER" psql \
    -U "${POSTGRES_USER:-bauos}" \
    -d "${POSTGRES_DB:-bauos}" \
    -v ON_ERROR_STOP=1 -q 2>&1 | tail -20; then
    echo "[$(date)] DB-Restore abgeschlossen"
  else
    echo "FEHLER: DB-Restore fehlgeschlagen"
    exit 1
  fi
fi

# ── Schritt 3: App neu starten ──────────────────────────────────────────────
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${APP_CONTAINER}$"; then
  echo "[$(date)] App-Container '${APP_CONTAINER}' neu starten..."
  docker restart "$APP_CONTAINER" >/dev/null
fi

echo ""
echo "============================================================"
echo "Restore erfolgreich."
echo "============================================================"
echo "Naechste Schritte:"
echo "  1. Login pruefen: https://<host>/login"
echo "  2. Admin-User-Liste pruefen: /admin/users"
echo "  3. Audit-Log pruefen: /admin/audit (sollte 'login.success' zeigen)"
echo ""
