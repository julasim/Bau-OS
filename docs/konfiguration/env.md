# Umgebungsvariablen (.env)

Alle Einstellungen werden über eine `.env`-Datei im Projekt-Root gesteuert. Bau-OS lädt diese automatisch beim Start via `dotenv`.

## Übersicht

| Variable | Pflicht | Standardwert | Beschreibung |
|---|---|---|---|
| `BOT_TOKEN` | Ja | — | Telegram Bot Token von [@BotFather](https://t.me/BotFather) |
| `VAULT_PATH` | Ja | — | Absoluter Pfad zum Obsidian Vault |
| `OLLAMA_BASE_URL` | Nein | `http://localhost:11434/v1` | Basis-URL der Ollama-API |
| `OLLAMA_MODEL` | Nein | `qwen2.5:7b` | Standard-Modell für den Haupt-Agenten |
| `OLLAMA_FAST_MODEL` | Nein | Wert von `OLLAMA_MODEL` | Schnelles Modell für einfache Aufgaben |
| `OLLAMA_SUBAGENT_MODEL` | Nein | Wert von `OLLAMA_MODEL` | Modell für Sub-Agenten |

## Pflicht-Variablen

### BOT_TOKEN

Das Telegram Bot Token erhältst du vom [@BotFather](https://t.me/BotFather). Ohne dieses Token kann der Bot nicht starten.

```bash
BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

::: warning Sicherheitshinweis
Das Bot Token ist ein Geheimnis. Teile es nicht öffentlich und committe die `.env`-Datei niemals in ein Git-Repository. Die `.gitignore` schließt `.env` bereits aus.
:::

### VAULT_PATH

Der absolute Pfad zu deinem Obsidian Vault. Hier speichert Bau-OS Agent-Dateien, Tagesberichte und Erinnerungen.

```bash
# Windows
VAULT_PATH=C:\Users\max\Documents\MeinVault

# macOS / Linux
VAULT_PATH=/home/max/MeinVault
```

::: tip
Der Vault muss bereits existieren. Bau-OS erstellt die Unterordner `Agents/` und `Inbox/` automatisch beim ersten Start.
:::

## LLM-Konfiguration

### OLLAMA_BASE_URL

Die Basis-URL der Ollama-API. Nur ändern, wenn Ollama auf einem anderen Rechner oder Port läuft.

```bash
# Standard (lokal)
OLLAMA_BASE_URL=http://localhost:11434/v1

# Remote-Server
OLLAMA_BASE_URL=http://192.168.1.50:11434/v1
```

### OLLAMA_MODEL

Das Haupt-Modell, das für alle Agenten verwendet wird. Muss in Ollama bereits heruntergeladen sein.

```bash
OLLAMA_MODEL=qwen2.5:7b
```

### OLLAMA_FAST_MODEL

Ein optionales schnelleres Modell für einfache Aufgaben wie Zusammenfassungen oder kurze Antworten. Wird über den `/fast`-Befehl aktiviert.

```bash
OLLAMA_FAST_MODEL=qwen2.5:3b
```

Wenn nicht gesetzt, wird das Standardmodell (`OLLAMA_MODEL`) verwendet.

### OLLAMA_SUBAGENT_MODEL

Das Modell, das für Sub-Agenten verwendet wird. Kann ein leichteres Modell sein, um Ressourcen zu sparen.

```bash
OLLAMA_SUBAGENT_MODEL=qwen2.5:3b
```

## Web-API & Sicherheit

| Variable | Pflicht | Standardwert | Beschreibung |
|---|---|---|---|
| `JWT_SECRET` | Nein | — | Secret fuer JWT-Token-Signierung. Wenn gesetzt, wird die Web-API aktiviert |
| `API_PORT` | Nein | `3000` | Port der Web-API |
| `CORS_ORIGINS` | Nein | `*` (alle) | Erlaubte CORS-Origins, komma-getrennt |

### JWT_SECRET

Aktiviert die Web-API mit JWT-Authentifizierung. Ohne diese Variable ist die Web-API deaktiviert.

```bash
# Sicheres Secret generieren:
openssl rand -hex 32

JWT_SECRET=dein_sicheres_secret_hier
```

### CORS_ORIGINS

Beschraenkt Cross-Origin-Anfragen auf bestimmte Domains. Wenn nicht gesetzt, sind alle Origins erlaubt (`*`).

```bash
# Nur bestimmte Origins erlauben:
CORS_ORIGINS=https://bauos.example.com,http://localhost:5173

# Alle Origins erlauben (Standard, wenn nicht gesetzt):
# CORS_ORIGINS wird weggelassen
```

::: warning Produktionsumgebung
In der Produktion sollte `CORS_ORIGINS` auf die tatsaechliche Domain beschraenkt werden, um CSRF-Angriffe zu verhindern.
:::

## Beispiel .env

Eine vollständige `.env`-Datei sieht so aus:

```bash
# Pflicht
BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAULT_PATH=/home/max/ObsidianVault

# Optional — LLM
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_FAST_MODEL=qwen2.5:3b
OLLAMA_SUBAGENT_MODEL=qwen2.5:3b

# Optional — Web-API
JWT_SECRET=dein_sicheres_secret
API_PORT=3000
CORS_ORIGINS=https://bauos.example.com
```

## Fest konfigurierte Werte

Die folgenden Werte sind in `src/config.ts` definiert und nicht über Umgebungsvariablen änderbar:

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_TOOL_ROUNDS` | `5` | Max. Iterationen im Agentic Loop |
| `MAX_SPAWN_DEPTH` | `2` | Max. Tiefe für Sub-Agent-Erzeugung |
| `MAX_HISTORY_CHARS` | `60000` | Pruning-Grenze für den Message-Buffer |
| `COMPACT_THRESHOLD` | `8000` | Ab dieser Länge wird das Tageslog komprimiert |
| `KEEP_RECENT_LOGS` | `5` | Anzahl der letzten Log-Einträge die erhalten bleiben |
| `HISTORY_LOAD_LIMIT` | `10` | Gesprächseinträge die beim Start geladen werden |
| `TIMEZONE` | `Europe/Vienna` | Zeitzone für alle Datums-Operationen |
| `LOCALE` | `de-AT` | Locale für Formatierungen |
| `LANGUAGE` | `Deutsch` | Sprache für LLM-Antworten |
| `VAULT_LOGS_DIR` | `MEMORY_LOGS` | Ordnername fuer Tageslog-Dateien |

### Sicherheits-Konstanten

| Konstante | Wert | Beschreibung |
|---|---|---|
| Rate Limit (Login) | 5 Versuche / 15 Min | Brute-Force-Schutz fuer `/api/auth/login` |
| Shell-Allowlist | ~40 Befehle | Nur erlaubte Befehle via `befehl_ausfuehren` |
| Path-Traversal-Schutz | `safePath()` | Validiert Pfade gegen Vault-Grenze |
| Sandbox (Dynamic Tools) | kein `fetch` | Netzwerkzugriff in dynamischen Tools deaktiviert |
| Env-Var-Filter (Shell) | PATH, HOME, USER, LANG | Shell-Scripts bekommen keine Secrets |

::: tip Werte anpassen
Um diese Werte zu ändern, bearbeite `src/config.ts` direkt und starte den Bot neu. Ein Rebuild ist nach Änderungen nötig (`npm run build`).
:::
