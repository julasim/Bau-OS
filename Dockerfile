# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Docker Image
# Enthält: Node.js 20 LTS + Ollama + PostgreSQL 16 + pgvector (alles in einem)
# ─────────────────────────────────────────────────────────────────────────────

FROM ubuntu:24.04

# Kein interaktiver apt-get
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=de_AT.UTF-8
ENV LC_ALL=de_AT.UTF-8

# System-Pakete + Build-Tools + PostgreSQL 16
#  - python3/make/g++: native Node-Module (bcrypt, pdf-parse)
#  - zstd:            Ollama-Installer braucht es für Extraktion
#  - postgresql-16 + postgresql-server-dev-16: DB + Header für pgvector-Build
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    locales \
    python3 \
    make \
    g++ \
    zstd \
    postgresql-16 \
    postgresql-contrib-16 \
    postgresql-server-dev-16 \
    && locale-gen de_AT.UTF-8 2>/dev/null || locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

# pgvector aus Source bauen (keine verlässliche Ubuntu-Package in 24.04)
RUN cd /tmp \
    && git clone --depth 1 --branch v0.7.4 https://github.com/pgvector/pgvector.git \
    && cd pgvector \
    && make \
    && make install \
    && cd / \
    && rm -rf /tmp/pgvector

# Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Ollama
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /opt/bau-os

# Abhängigkeiten installieren (native Module werden hier kompiliert)
COPY package*.json ./
RUN npm ci

# Quellcode kopieren + bauen
COPY . .
RUN npm run build:all \
    && npm prune --omit=dev \
    && chmod +x scripts/docker-entrypoint.sh

# Web-UI Port
EXPOSE 3000

CMD ["bash", "scripts/docker-entrypoint.sh"]
