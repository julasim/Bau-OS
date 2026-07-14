# ─────────────────────────────────────────────────────────────────────────────
# PATIO App-Container — nur Node.js + unser Code.
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

WORKDIR /opt/patio

# Dependencies zuerst (bessere Layer-Caches)
COPY package*.json ./
RUN npm ci

# Quellcode kopieren + bauen (Backend-TS + Vue-Frontend)
COPY . .
RUN npm run build:all \
    && cp -r src/db/migrations dist/db/migrations \
    && cp -r src/emails dist/emails \
    && npm prune --omit=dev

RUN mkdir -p /opt/patio/logs /opt/patio/data /opt/patio/tools \
    && chown -R node:node /opt/patio

USER node

EXPOSE 3000

# Healthcheck — App sollte auf /api/status antworten.
# Port 3000 ist im Container fix — API_PORT aus .env ist nur das Host-Mapping.
# WICHTIG: kein -f (fail on HTTP >=400) — /api/status liefert 401 wenn
# JWT gesetzt ist. 401 bedeutet "Server laeuft und antwortet korrekt",
# der Healthcheck soll nur auf Connection-Failure (exit != 0) reagieren.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sS -o /dev/null "http://localhost:3000/api/status" || exit 1

# Node startet direkt — die App kuemmert sich selbst um DB-Migrationen,
# wartet wenn noetig auf Postgres, respektiert DB_AUTO_MIGRATE aus .env.
CMD ["node", "dist/index.js"]
