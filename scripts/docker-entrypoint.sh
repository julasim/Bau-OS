#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Docker Entrypoint
# Startet PostgreSQL → Ollama → Bau-OS (Node.js) im gleichen Container.
# ─────────────────────────────────────────────────────────────────────────────

set -e

PGDATA=/var/lib/postgresql/16/main

# ═══════════════════════════════════════════════════════════════════════════════
# 1. PostgreSQL: Cluster initialisieren falls leer
# ═══════════════════════════════════════════════════════════════════════════════
# Wenn Volume frisch gemountet ist, hat Docker die Image-Daten hineinkopiert.
# Bei Bind-Mount oder leerem Named Volume ist das Verzeichnis aber leer → initdb.
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[bau-os] Initialisiere PostgreSQL-Cluster..."
  mkdir -p "$PGDATA"
  chown -R postgres:postgres /var/lib/postgresql /etc/postgresql /var/log/postgresql /var/run/postgresql
  su - postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA --locale=C.UTF-8 --encoding=UTF8 --auth-local=peer --auth-host=scram-sha-256" >/dev/null
fi

# Permissions sicherstellen (Volume könnte von anderem User kommen)
chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════════════════════
# 2. PostgreSQL starten
# ═══════════════════════════════════════════════════════════════════════════════
echo "[bau-os] Starte PostgreSQL..."
pg_ctlcluster 16 main start || {
  echo "[bau-os] pg_ctlcluster fehlgeschlagen, versuche direkten Start..."
  su - postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /var/log/postgresql/postgresql-16-main.log start"
}

# Warten bis bereit
for i in $(seq 1 30); do
  if su - postgres -c "psql -c 'SELECT 1'" >/dev/null 2>&1; then
    echo "[bau-os] PostgreSQL bereit"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[bau-os] FEHLER: PostgreSQL antwortet nicht"
    exit 1
  fi
  sleep 1
done

# ═══════════════════════════════════════════════════════════════════════════════
# 3. DB + User + Extensions einrichten (idempotent)
# ═══════════════════════════════════════════════════════════════════════════════
echo "[bau-os] Richte Datenbank ein..."

# bauos-User (Superuser, damit CREATE EXTENSION klappt)
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='bauos'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE USER bauos WITH PASSWORD 'bauos' SUPERUSER;\"" >/dev/null

# bauos-Datenbank
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='bauos'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE DATABASE bauos OWNER bauos;\"" >/dev/null

# Extensions (vector, uuid-ossp, pg_trgm, unaccent)
su - postgres -c "psql -d bauos -c \"
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS \\\"uuid-ossp\\\";
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS unaccent;
\"" >/dev/null

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Migrationen ausführen (alphabetisch: 001 → 002 → …)
# ═══════════════════════════════════════════════════════════════════════════════
MIGRATIONS_DIR=/opt/bau-os/src/db/migrations
if [ -d "$MIGRATIONS_DIR" ]; then
  echo "[bau-os] Führe Migrationen aus..."
  for migration in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$migration" ] || continue
    echo "[bau-os]   → $(basename "$migration")"
    PGPASSWORD=bauos psql -h localhost -U bauos -d bauos -f "$migration" >/dev/null 2>&1 || {
      echo "[bau-os]     (Teilfehler ignoriert — Idempotenz)"
    }
  done
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Ollama starten
# ═══════════════════════════════════════════════════════════════════════════════
echo "[bau-os] Starte Ollama..."
ollama serve &

echo "[bau-os] Warte auf Ollama..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "[bau-os] Ollama bereit"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[bau-os] Warnung: Ollama antwortet nicht — starte trotzdem"
  fi
  sleep 1
done

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Bau-OS starten (exec → Signale gehen direkt an Node)
# ═══════════════════════════════════════════════════════════════════════════════
echo "[bau-os] Starte Bau-OS..."
exec node dist/index.js
