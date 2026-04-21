# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS App-Container — nur Node.js + unser Code.
# PostgreSQL, Ollama und Caddy laufen jeweils als separate Container
# (offizielle Images — siehe docker-compose.yml).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Build-Tools fuer native Node-Module (bcrypt, pdf-parse) + curl fuer Healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/bau-os

# Dependencies zuerst (bessere Layer-Caches)
COPY package*.json ./
RUN npm ci

# Quellcode kopieren + bauen (Backend-TS + Vue-Frontend)
COPY . .
RUN npm run build:all \
    && npm prune --omit=dev

EXPOSE 3000

# Healthcheck — App sollte auf /api/status antworten (ok oder auth-required)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://localhost:${API_PORT:-3000}/api/status" > /dev/null || exit 1

# Node startet direkt — die App kuemmert sich selbst um DB-Migrationen,
# wartet wenn noetig auf Postgres, respektiert DB_AUTO_MIGRATE aus .env.
CMD ["node", "dist/index.js"]
