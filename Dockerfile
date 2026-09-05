# ─────────────────────────────────────────────────────────────────────────────
# PATIO App-Container — nur Node.js + unser Code.
# PostgreSQL und Caddy laufen jeweils als separate Container (offizielle
# Images — siehe docker-compose.yml). Insgesamt drei Container; einen
# Ollama-Container gibt es seit dem Ausbau der KI-Laufzeit nicht mehr.
#
# Multi-Stage: Build-Tools (python3/make/g++) leben NUR im builder-Stage und
# landen NICHT im finalen Image. Das Runtime-Image enthaelt nur Node 24 + curl
# (Healthcheck) + die geprunten Prod-node_modules + dist/. bcrypt (nativ) wird
# im builder gebaut und mitkopiert — gleiches Base-Image = gleiche ABI.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Build-Tools nur hier (fuer native Module: bcrypt, pdf-parse)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/patio

# Dependencies zuerst (bessere Layer-Caches)
COPY package*.json ./
RUN npm ci

# Quellcode kopieren + bauen (Backend-TS + Vue-Frontend), dann devDeps entfernen.
# Das build-Skript in package.json kopiert src/db/migrations selbst nach dist/ —
# ein hier zusaetzlich stehendes `cp -r` lief gegen ein BEREITS EXISTIERENDES
# Ziel und legte dadurch dist/db/migrations/migrations/ an.
# (src/emails ist mit dem Ausbau des Mailversands entfallen.)
#
# Was NICHT im Bau-Kontext landet, steht in .dockerignore — insbesondere
# release/ mit den gespeicherten Images.
COPY . .
RUN npm run build:all \
    && npm prune --omit=dev

# ── Stage 2: Runtime (schlank) ───────────────────────────────────────────────
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# ── PDF-Ausgabe: LibreOffice ────────────────────────────────────────────────
#
# PATIO wandelt Word-Exporte ueber `soffice --convert-to pdf` in PDF um — aus
# GENAU DERSELBEN Vorlage, die auch die .docx erzeugt. Eine PDF-Bibliothek
# waere ein zweites Layoutsystem, das irgendwann anders aussieht als der
# Word-Export.
#
# Das kostet rund 350 MB im Image, und der Firmenserver wird ueber
# Datentraeger aktualisiert (scripts/release-offline.sh) — die Last traegt
# jedes Update mit. Deshalb `libreoffice-writer` statt des ganzen Pakets und
# `--no-install-recommends`.
#
# Abschaltbar: `docker compose build --build-arg MIT_PDF=nein app`. Dann
# antwortet der PDF-Weg mit 503 und einem Satz in Klartext; der Word-Export
# bleibt vollstaendig.
ARG MIT_PDF=ja

# Nur curl (Healthcheck) + ca-certificates — KEINE Build-Tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && if [ "$MIT_PDF" = "ja" ]; then \
         apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu-core; \
       fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/patio

# Geprunte Prod-node_modules (inkl. gebautem bcrypt) + Build-Output aus dem builder.
COPY --from=builder /opt/patio/node_modules ./node_modules
COPY --from=builder /opt/patio/dist ./dist
COPY --from=builder /opt/patio/package.json ./package.json

RUN mkdir -p /opt/patio/logs /opt/patio/data \
    && chown -R node:node /opt/patio

USER node

EXPOSE 3000

# Healthcheck gegen /api/health (src/api/server.ts) — bewusst ohne Auth und
# ohne Rate-Limit registriert, liefert immer 200.
# Vorher stand hier /api/status: diese Route existiert nirgends, Hono
# antwortete mit 404. Zusammen mit dem fehlenden -f (curl beendet sich bei
# JEDER HTTP-Antwort mit 0) war das faktisch nur ein TCP-Check — ein Prozess
# ohne funktionierende Routen galt als healthy.
# Jetzt mit -f: alles >=400 laesst curl mit != 0 enden — und das hat seit dem
# 31.08.2026 echte Wirkung. `/api/health` fragt die Datenbank wirklich (mit
# 3 s Zeitlimit, src/api/server.ts) und antwortet bei einem Ausfall mit 503.
# Der Container geht dann auf „unhealthy"; ein Neustart folgt daraus NICHT
# (Docker startet nur bei einem Exit neu), aber Monitoring, `patio status` und
# der Update-Rueckweg sehen es.
#
# Die 3000 hier ist FEST verdrahtet, `API_PORT` aus der .env aber nicht: der
# Dienst hoert auf API_PORT (src/config.ts). Wer den Wert aendert, macht den
# Container dauerhaft „unhealthy" und schneidet Caddy ab (docker/Caddyfile
# zeigt ebenfalls auf app:3000). Ein Host-Mapping gibt es nicht — der
# App-Dienst hat bewusst kein `ports:`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS -o /dev/null "http://localhost:3000/api/health" || exit 1

# Node startet direkt — die App kuemmert sich selbst um DB-Migrationen,
# wartet wenn noetig auf Postgres, respektiert DB_AUTO_MIGRATE aus .env.
CMD ["node", "dist/index.js"]
