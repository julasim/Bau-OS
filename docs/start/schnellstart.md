# Schnellstart

In 5 Minuten zum laufenden Bot — lokal auf deinem Rechner.

## Voraussetzungen

- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **Ollama** — [ollama.ai](https://ollama.ai/) (lokales LLM)
- **Telegram Bot Token** — von [@BotFather](https://t.me/BotFather)

## 1. Ollama starten und Modell laden

```bash
# Ollama installieren (falls noch nicht)
# macOS/Linux: curl -fsSL https://ollama.ai/install.sh | sh
# Windows: Download von ollama.ai

# Modell herunterladen
ollama pull qwen2.5:7b
```

## 2. Repository klonen

```bash
git clone https://github.com/your-repo/bau-os.git
cd bau-os
npm install
```

## 3. Setup ausführen

```bash
npm run setup
```

Der Installer fragt nach:
1. **BOT_TOKEN** — Dein Telegram Bot Token (von @BotFather)
2. **VAULT_PATH** — Wo der Obsidian Vault gespeichert wird
3. **OLLAMA_BASE_URL** — Standard: `http://localhost:11434/v1`
4. **OLLAMA_MODEL** — Standard: `qwen2.5:7b`

## 4. Bot starten

```bash
# Entwicklung (mit Auto-Reload)
npm run dev

# Oder Produktion
npm run build
npm start
```

## 5. Erste Nachricht

Öffne Telegram, suche deinen Bot und schreibe:

> Hallo!

Der Setup-Wizard startet automatisch und führt dich durch 6 kurze Fragen:
1. Name des Assistenten
2. Emoji
3. Charakter/Vibe
4. Für was für ein Unternehmen
5. Dein Name
6. Name des Unternehmens

Danach ist der Bot einsatzbereit.

## Was jetzt?

- Schreibe "Erstelle eine Notiz: Meeting morgen um 10 Uhr"
- Schreibe "Welche Termine habe ich heute?"
- Tippe `/hilfe` für alle Befehle
- Lies [Konzepte](/konzepte/architektur) um zu verstehen wie alles zusammenhängt

::: tip Produktion
Für den Einsatz auf einem Server lies das [Deployment-Playbook](/betrieb/voraussetzungen).
:::
