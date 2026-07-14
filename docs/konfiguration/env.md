# Umgebungsvariablen (.env)

Alle Einstellungen werden über eine `.env`-Datei im Projekt-Root gesteuert. PATIO lädt diese automatisch beim Start via `dotenv`.

## Übersicht

| Variable | Pflicht | Standardwert | Beschreibung |
|---|---|---|---|
| `BOT_TOKEN` | Ja | — | Telegram Bot Token von [@BotFather](https://t.me/BotFather) |
| `WORKSPACE_PATH` | Ja | — | Absoluter Pfad zum Obsidian Vault (alias: `VAULT_PATH`) |
| `OPENAI_API_KEY` | Nein | — | OpenAI API Key — wenn gesetzt, wird OpenAI statt Ollama verwendet |
| `OLLAMA_BASE_URL` | Nein | `http://localhost:11434/v1` | Basis-URL der Ollama-API |
| `OLLAMA_MODEL` | Nein | `qwen2.5:7b` | Standard-Modell für den Haupt-Agenten |
| `OLLAMA_FAST_MODEL` | Nein | Wert von `OLLAMA_MODEL` | Schnelles Modell (via `/fast`) |
| `OLLAMA_SUBAGENT_MODEL` | Nein | Wert von `OLLAMA_MODEL` | Modell für Sub-Agenten |
| `DATABASE_URL` | Nein | — | PostgreSQL-Verbindungsstring — aktiviert DB-Modus |
| `JWT_SECRET` | Nein | — | Secret für JWT-Signierung — aktiviert Web-API |
| `ALLOWED_CHAT_IDS` | Nein | — | Komma-getrennte Telegram-Chat-IDs (leer = Auto-Owner) |

## Pflicht-Variablen

### BOT_TOKEN

Das Telegram Bot Token erhältst du vom [@BotFather](https://t.me/BotFather).

```bash
BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

::: warning Sicherheitshinweis
Das Bot Token ist ein Geheimnis. Committe die `.env`-Datei niemals in ein Git-Repository. Die `.gitignore` schließt `.env` bereits aus.
:::

### WORKSPACE_PATH

Der absolute Pfad zum Obsidian Vault. Alternativ auch als `VAULT_PATH` (Legacy-Alias).

```bash
# Windows
WORKSPACE_PATH=C:\Users\max\Documents\MeinVault

# macOS / Linux
WORKSPACE_PATH=/home/max/MeinVault
```

::: tip
Der Vault muss bereits existieren. PATIO erstellt `Agents/`, `Inbox/` und `Logs/` automatisch.
:::

## LLM-Konfiguration

PATIO unterstützt zwei LLM-Backends: **OpenAI** (Cloud) und **Ollama** (lokal). Die Wahl erfolgt automatisch anhand des `OPENAI_API_KEY`.

### OPENAI_API_KEY

Wenn gesetzt, verwendet PATIO OpenAI statt Ollama. Empfohlen für höchste Antwortqualität.

```bash
OPENAI_API_KEY=sk-...
```

| Variable | OpenAI-Modus | Ollama-Modus |
|---|---|---|
| Haupt-Modell | `gpt-4o` | `qwen2.5:7b` |
| Fast-Modell | `gpt-4o-mini` | `qwen2.5:3b` |
| Embedding | `text-embedding-3-small` (1536 dims) | `nomic-embed-text` (768 dims) |

### OLLAMA_BASE_URL

Nur relevant im Ollama-Modus. Ändern wenn Ollama auf einem anderen Rechner läuft.

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
```

### OLLAMA_MODEL / OLLAMA_FAST_MODEL / OLLAMA_SUBAGENT_MODEL

```bash
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_FAST_MODEL=qwen2.5:3b
OLLAMA_SUBAGENT_MODEL=qwen2.5:3b
```

## Datenbank (PostgreSQL)

### DATABASE_URL

Aktiviert den PostgreSQL-Modus. Ohne diese Variable läuft PATIO im reinen Filesystem-Modus.

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/patio
```

Beim Start wird automatisch geprüft ob die DB erreichbar ist. Wenn nicht, beendet sich der Prozess mit Exit-Code 1.

### DB_AUTO_MIGRATE

Steuert ob SQL-Migrations beim Start automatisch ausgeführt werden.

```bash
DB_AUTO_MIGRATE=true   # Standard
DB_AUTO_MIGRATE=false  # Nur für Produktionsumgebungen empfohlen
```

### Supabase (optional)

Für Supabase Realtime und Storage:

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...   # Optional — für Admin-Operationen
```

### Embeddings

Nur relevant wenn `pgvector` installiert ist:

```bash
EMBEDDING_MODEL=text-embedding-3-small   # Standard bei OpenAI
EMBEDDING_DIMENSIONS=1536                # Muss zum Modell passen
```

::: warning Modellwechsel
Wenn du das Embedding-Modell änderst, muss das Schema per Migration angepasst werden (andere Dimension). PATIO warnt beim Start wenn Konfiguration und Schema nicht übereinstimmen.
:::

## Zugriffskontrolle

### ALLOWED_CHAT_IDS

Optionale Whitelist für Telegram-Chat-IDs. Wenn leer, gilt der **Auto-Owner-Mechanismus**: Die erste Chat-ID die eine Nachricht sendet, wird als Owner gespeichert — alle anderen werden danach ignoriert.

```bash
# Explizite Whitelist (mehrere IDs komma-getrennt)
ALLOWED_CHAT_IDS=123456789,987654321

# Nicht gesetzt → Auto-Owner-Modus (empfohlen für Single-User)
```

Eigene Chat-ID herausfinden: `/whoami` im Bot.

## Web-API & Sicherheit

| Variable | Pflicht | Standardwert | Beschreibung |
|---|---|---|---|
| `JWT_SECRET` | Nein | — | Aktiviert Web-API mit JWT-Auth |
| `API_PORT` | Nein | `3000` | Port der Hono-API |
| `CORS_ORIGINS` | Nein | `http://localhost:3000` | Erlaubte CORS-Origins, komma-getrennt |
| `MAX_UPLOAD_MB` | Nein | `50` | Maximale Datei-Upload-Größe |

### JWT_SECRET

```bash
# Sicheres Secret generieren:
openssl rand -hex 32

JWT_SECRET=dein_sicheres_secret_hier
```

Wenn nicht gesetzt, ist die Web-API vollständig deaktiviert.

## Vollständige Beispiel-.env

```bash
# === Pflicht ===
BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WORKSPACE_PATH=/home/patio/vault

# === LLM — OpenAI (empfohlen) ===
OPENAI_API_KEY=sk-...

# === LLM — Ollama (Alternative, lokal) ===
# OLLAMA_BASE_URL=http://localhost:11434/v1
# OLLAMA_MODEL=qwen2.5:14b
# OLLAMA_FAST_MODEL=qwen2.5:3b
# OLLAMA_SUBAGENT_MODEL=qwen2.5:3b

# === Datenbank (optional) ===
DATABASE_URL=postgresql://patio:password@localhost:5432/patio
# DB_AUTO_MIGRATE=true

# === Web-API (optional) ===
JWT_SECRET=abc123...
API_PORT=3000
CORS_ORIGINS=https://patio.example.com

# === Sicherheit ===
ALLOWED_CHAT_IDS=123456789
MAX_UPLOAD_MB=50
```

## Fest konfigurierte Werte

Definiert in `src/config.ts`, nur durch Quellcode-Änderung anpassbar:

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_TOOL_ROUNDS` | `100` | Max. Iterationen im Agentic Loop |
| `MAX_SPAWN_DEPTH` | `2` | Max. Tiefe für Sub-Agent-Erzeugung |
| `MAX_HISTORY_CHARS` | `60.000` | Pruning-Grenze für den Message-Buffer |
| `COMPACT_THRESHOLD` | `8.000` | Ab dieser Länge wird das Tageslog komprimiert |
| `KEEP_RECENT_LOGS` | `5` | Anzahl der letzten Log-Einträge die erhalten bleiben |
| `HISTORY_LOAD_LIMIT` | `10` | Gesprächseinträge die beim Start geladen werden |
| `TIMEZONE` | `Europe/Vienna` | Zeitzone für alle Datums-Operationen |
| `LOCALE` | `de-AT` | Locale für Formatierungen |
| `LANGUAGE` | `Deutsch` | Sprache für LLM-Antworten |

::: tip Werte anpassen
Um diese Werte zu ändern, bearbeite `src/config.ts` direkt und starte den Bot neu. Ein Rebuild ist nötig (`npm run build`).
:::
