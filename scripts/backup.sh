#!/bin/bash
# ============================================================
# PATIO Backup — Vault + .env + data/ + tools/ + PostgreSQL
# Taeglich via Cron ausfuehren, 14-Tage-Rotation by default
# ============================================================
#
# WICHTIG: Wenn .env (mit JWT_SECRET) und der DB-Dump getrennt verloren
# gehen, sind verschluesselte Bot-Tokens nicht mehr lesbar — der
# JWT_SECRET ist der Master-Key fuer AES-256-GCM (siehe src/api/crypto.ts).
# Beide IMMER zusammen sichern. .env steckt im Tarball (siehe unten).
#
# Bei Restore: Tarball + DB-Dump aus DEM SELBEN Tag verwenden — sonst
# kann es zu Schema-Drift zwischen .env-erwarteten Migrationen und
# tatsaechlich gefahrenen kommen.
# ============================================================
set -euo pipefail

INSTALL_DIR="${1:-/opt/patio}"
VAULT_DIR="${2:-/opt/patio-vault}"
BACKUP_DIR="${3:-/opt/patio-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Container-Name: in der aktuellen docker-compose.yml ist es
# patio-postgres. Aelter Versionen hatten "patio-db" — beide werden
# durchprobiert, damit das Script auch auf Legacy-Installationen laeuft.
DB_CONTAINER="${DB_CONTAINER:-patio-postgres}"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/patio-backup-${TIMESTAMP}.tar.gz"
DB_DUMP_FILE="${BACKUP_DIR}/patio-db-${TIMESTAMP}.sql.gz"

# Backup-Verzeichnis erstellen
mkdir -p "$BACKUP_DIR"

# Pruefen ob Vault existiert
if [ ! -d "$VAULT_DIR" ]; then
  echo "[$(date)] FEHLER: Vault-Verzeichnis nicht gefunden: $VAULT_DIR"
  exit 1
fi

# Backup erstellen: Vault + .env + data/ + tools/
echo "[$(date)] Starte Backup..."

tar -czf "$BACKUP_FILE" \
  -C "$(dirname "$VAULT_DIR")" "$(basename "$VAULT_DIR")" \
  -C "$INSTALL_DIR" .env data/ tools/ 2>/dev/null || {
  # Fallback: Nur Vault + .env wenn data/ oder tools/ nicht existiert
  tar -czf "$BACKUP_FILE" \
    -C "$(dirname "$VAULT_DIR")" "$(basename "$VAULT_DIR")" \
    -C "$INSTALL_DIR" .env 2>/dev/null || true
}

# Pruefen ob Backup erstellt wurde
if [ ! -f "$BACKUP_FILE" ]; then
  echo "[$(date)] FEHLER: Backup konnte nicht erstellt werden"
  exit 1
fi

# Permissions: nur root lesbar — Tarball enthaelt .env mit Secrets.
chmod 600 "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

# PostgreSQL Dump (wenn Docker laeuft)
# Container-Name probieren: zuerst patio-postgres, dann legacy patio-db.
ACTUAL_DB_CONTAINER=""
if command -v docker &>/dev/null; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${DB_CONTAINER}$"; then
    ACTUAL_DB_CONTAINER="$DB_CONTAINER"
  elif docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^patio-db$"; then
    ACTUAL_DB_CONTAINER="patio-db"
  fi
fi

if [ -n "$ACTUAL_DB_CONTAINER" ]; then
  echo "[$(date)] PostgreSQL Dump erstellen aus Container '${ACTUAL_DB_CONTAINER}'..."
  # --clean --if-exists --no-owner --no-privileges fuer einen restoreablen Dump,
  # der ohne Permission-Wackeleien direkt eingespielt werden kann.
  if docker exec "$ACTUAL_DB_CONTAINER" pg_dump \
    -U "${POSTGRES_USER:-patio}" \
    --clean --if-exists --no-owner --no-privileges \
    "${POSTGRES_DB:-patio}" 2>/dev/null | gzip > "$DB_DUMP_FILE"; then
    if [ -s "$DB_DUMP_FILE" ]; then
      chmod 600 "$DB_DUMP_FILE"
      DB_SIZE=$(du -h "$DB_DUMP_FILE" | cut -f1)
      echo "[$(date)] DB-Dump erstellt: ${DB_DUMP_FILE} (${DB_SIZE})"
    else
      rm -f "$DB_DUMP_FILE"
      echo "[$(date)] WARNUNG: DB-Dump leer — pg_dump hat nichts geliefert"
    fi
  else
    rm -f "$DB_DUMP_FILE"
    echo "[$(date)] WARNUNG: DB-Dump fehlgeschlagen"
  fi
else
  echo "[$(date)] HINWEIS: Kein laufender Postgres-Container gefunden — DB-Dump uebersprungen"
fi

# Rotation: Backups aelter als RETENTION_DAYS loeschen.
DELETED=$(find "$BACKUP_DIR" -name "patio-backup-*.tar.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
DELETED_DB=$(find "$BACKUP_DIR" -name "patio-db-*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print 2>/dev/null | wc -l)
DELETED=$((DELETED + DELETED_DB))

echo "[$(date)] Backup erstellt: ${BACKUP_FILE} (${BACKUP_SIZE})"
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] ${DELETED} alte Backup-Dateien geloescht (aelter als ${RETENTION_DAYS} Tage)"
fi
