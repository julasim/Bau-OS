# ─────────────────────────────────────────────────────────────────────────────
# Bau-OS Docker Image
# Enthält: Node.js 20 LTS + Ollama (alles in einem Container)
# ─────────────────────────────────────────────────────────────────────────────

FROM ubuntu:24.04

# Kein interaktiver apt-get
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=de_AT.UTF-8
ENV LC_ALL=de_AT.UTF-8

# System-Pakete + Build-Tools (nötig für native Module: bcrypt, pdf-parse)
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    locales \
    python3 \
    make \
    g++ \
    && locale-gen de_AT.UTF-8 2>/dev/null || locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

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
