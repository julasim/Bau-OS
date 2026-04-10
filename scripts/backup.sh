#!/bin/bash
# ============================================================
# Bau-OS Backup — Vault + .env + data/ + tools/
# Taeglich via Cron ausfuehren, 7-Tage-Rotation
# ============================================================
set -euo pipefail

INSTALL_DIR="${1:-/opt/bau-os}"
VAULT_DIR="${2:-/opt/bau-os-vault}"
BACKUP_DIR="${3:-/opt/bau-os-backups}"
RETENTION_DAYS=7

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/bau-os-backup-${TIMESTAMP}.tar.gz"

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

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

# PostgreSQL Dump (wenn Docker laeuft)
DB_DUMP_FILE="${BACKUP_DIR}/bau-os-db-${TIMESTAMP}.sql.gz"
if command -v docker &>/dev/null && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "bau-os-db"; then
  echo "[$(date)] PostgreSQL Dump erstellen..."
  docker exec bau-os-db pg_dump -U "${POSTGRES_USER:-bauos}" "${POSTGRES_DB:-bauos}" | gzip > "$DB_DUMP_FILE" 2>/dev/null
  if [ -f "$DB_DUMP_FILE" ] && [ -s "$DB_DUMP_FILE" ]; then
    DB_SIZE=$(du -h "$DB_DUMP_FILE" | cut -f1)
    echo "[$(date)] DB-Dump erstellt: ${DB_DUMP_FILE} (${DB_SIZE})"
  else
    rm -f "$DB_DUMP_FILE"
    echo "[$(date)] WARNUNG: DB-Dump fehlgeschlagen (Container laeuft nicht?)"
  fi
fi

# Rotation: Backups aelter als RETENTION_DAYS loeschen
DELETED=$(find "$BACKUP_DIR" -name "bau-os-backup-*.tar.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
DELETED_DB=$(find "$BACKUP_DIR" -name "bau-os-db-*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print 2>/dev/null | wc -l)
DELETED=$((DELETED + DELETED_DB))

echo "[$(date)] Backup erstellt: ${BACKUP_FILE} (${BACKUP_SIZE})"
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] ${DELETED} alte Backups geloescht (aelter als ${RETENTION_DAYS} Tage)"
fi
