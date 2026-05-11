# Schnellstart

In 5 Minuten zum laufenden Bot — lokal auf deinem Rechner.

## Voraussetzungen

- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **Telegram Bot Token** — von [@BotFather](https://t.me/BotFather)
- **Entweder:** Ollama (lokal) — [ollama.ai](https://ollama.ai/)
- **Oder:** OpenAI API Key — [platform.openai.com](https://platform.openai.com/)

---

## Option A — Lokal mit Ollama (Datensouveränität)

Keine Daten verlassen deinen Rechner. Erfordert mindestens 8 GB RAM für ein 7B-Modell.

```bash
# 1. Ollama + Modell
# macOS/Linux: curl -fsSL https://ollama.ai/install.sh | sh
# Windows: Download von ollama.ai
ollama pull qwen2.5:7b

# 2. Projekt klonen
git clone <repository-url>
cd bau-os
npm install

# 3. .env erstellen
cat > .env << 'EOF'
BOT_TOKEN=7123...:AAH...
WORKSPACE_PATH=/pfad/zum/vault
OLLAMA_BASE_URL=http://localhost:11434/v1
EOF

# 4. Starten
npm run dev
```

---

## Option B — Cloud mit OpenAI (einfacher, höhere Qualität)

Kein Ollama nötig. Anfragen gehen an die OpenAI API.

```bash
# 1. Projekt klonen
git clone <repository-url>
cd bau-os
npm install

# 2. .env erstellen
cat > .env << 'EOF'
BOT_TOKEN=7123...:AAH...
WORKSPACE_PATH=/pfad/zum/vault
OPENAI_API_KEY=sk-...
EOF

# 3. Starten
npm run dev
```

---

## Web-UI aktivieren (optional)

Zusätzlich zur Telegram-Schnittstelle gibt es eine Browser-Oberfläche (Vue 3).

```bash
# In .env ergänzen:
JWT_SECRET=$(openssl rand -hex 32)
API_PORT=3000

# API + Frontend starten:
npm run dev        # Backend (Bot + API)
npm run dev:web    # Frontend (separates Terminal)

# Dann: http://localhost:3000
```

---

## Erste Nachricht

Öffne Telegram, suche deinen Bot und schreibe:

> Hallo!

Der Setup-Wizard startet automatisch und führt dich durch 6 kurze Fragen:
1. Name des Assistenten
2. Emoji
3. Charakter/Vibe
4. Für was für ein Unternehmen
5. Dein Name
6. Name des Unternehmens

Danach ist der Bot sofort einsatzbereit.

## Was jetzt?

- Schreibe "Erstelle eine Notiz: Meeting morgen um 10 Uhr"
- Schreibe "Welche Termine habe ich heute?"
- Tippe `/hilfe` für alle Befehle
- Lies [Konzepte](/konzepte/architektur) um zu verstehen wie alles zusammenhängt

::: tip Produktion
Für den Einsatz auf einem Server lies das [Deployment-Playbook](/betrieb/voraussetzungen) oder nutze den Ein-Befehl-Installer: `sudo bash scripts/install.sh`.
:::
