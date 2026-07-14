# Konfigurationsreferenz

Alle Konstanten aus `src/config.ts`. Werte mit `.env`-Spalte können über Umgebungsvariablen überschrieben werden.

## LLM

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `OPENAI_API_KEY` | — | `OPENAI_API_KEY` | OpenAI API-Key. Wenn gesetzt, wird OpenAI statt Ollama verwendet |
| `OPENAI_ENABLED` | `false` | — | Automatisch `true` wenn `OPENAI_API_KEY` gesetzt |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | `OLLAMA_BASE_URL` | URL der Ollama-API (OpenAI-kompatibel) |
| `MAIN_MODEL` | `gpt-4o-mini` / `qwen2.5:7b` | `OLLAMA_MODEL` | Standard-LLM-Modell für den Main-Agent |
| `FAST_MODEL` | = `MAIN_MODEL` | `OLLAMA_FAST_MODEL` | Modell im Fast-Modus (`/fast`) |
| `SUBAGENT_MODEL` | = `MAIN_MODEL` | `OLLAMA_SUBAGENT_MODEL` | Modell für Sub-Agenten |
| `VISION_MODEL` | `gpt-4o` / = `MAIN_MODEL` | `VISION_MODEL` | Modell für Bildanalyse |
| `MAX_TOOL_ROUNDS` | `100` | `MAX_TOOL_ROUNDS` | Maximale Iterationen im Agentic Loop |

::: tip Modell zur Laufzeit wechseln
Mit `/model <name>` kann das Modell im laufenden Betrieb gewechselt werden, ohne `.env` zu ändern oder den Bot neu zu starten.
:::

::: tip OpenAI vs. Ollama
Der Standardwert für `MAIN_MODEL` hängt vom Backend ab: `gpt-4o-mini` wenn `OPENAI_API_KEY` gesetzt ist, sonst `qwen2.5:7b`.
:::

### Beispiel `.env`

```env
# Ollama-Modus
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_FAST_MODEL=qwen2.5:7b
OLLAMA_SUBAGENT_MODEL=qwen2.5:7b

# OpenAI-Modus (überschreibt Ollama-Einstellungen)
# OPENAI_API_KEY=sk-...
```

## Agenten

| Konstante | Standardwert | Beschreibung |
|---|---|---|
| `AGENTS` | `[{ name: "Main", protected: true }]` | Vordefinierte Agenten-Liste |
| `PROTECTED_AGENTS` | `["Main"]` | Agenten die nicht gelöscht werden können |
| `MAX_SPAWN_DEPTH` | `2` | Maximale Verschachtelungstiefe für Sub-Agenten |

::: warning Spawn-Tiefe
Sub-Agenten können weitere Sub-Agenten spawnen — aber nur bis zur Tiefe 2. Ein Agent der von einem Sub-Agent gespawnt wurde, kann **keine weiteren** Sub-Agenten starten. Dies verhindert Endlosschleifen.
:::

### Agent-Konfiguration

```typescript
export const AGENTS = [
  {
    name: "Main",           // Anzeigename
    model: MAIN_MODEL,      // LLM-Modell
    protected: true,        // Löschgeschützt
    description: "Haupt-Agent"
  },
];
```

Weitere Agenten werden zur Laufzeit via `agent_erstellen` erzeugt und im Workspace unter `Agents/<name>/` gespeichert.

## Gedächtnis

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_HISTORY_CHARS` | `60.000` | Pruning-Grenze für den Message-Buffer im Agentic Loop |
| `COMPACT_THRESHOLD` | `8.000` | Tageslog-Größe (Zeichen) ab der automatisch komprimiert wird |
| `KEEP_RECENT_LOGS` | `5` | Letzte N Log-Einträge bleiben bei Compaction immer erhalten |
| `HISTORY_LOAD_LIMIT` | `10` | Anzahl Gesprächseinträge die beim Start geladen werden |

### Wie das Gedächtnis funktioniert

```
Nachricht eingehend
       │
       ▼
┌──────────────────┐
│ Tageslog laden   │ ← Letzte HISTORY_LOAD_LIMIT Einträge
│ (MEMORY_LOGS/)   │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Agentic Loop     │ ← Läuft max. MAX_TOOL_ROUNDS Runden
│ (Messages)       │
└──────┬───────────┘
       │
       ▼ Wenn Messages > MAX_HISTORY_CHARS
┌──────────────────┐
│ Pruning          │ ← Ältere Messages werden entfernt
└──────┬───────────┘
       │
       ▼ Wenn Tageslog > COMPACT_THRESHOLD
┌──────────────────┐
│ Compaction       │ ← LLM fasst alte Einträge zusammen
│ (hintergrund)    │   Letzte KEEP_RECENT_LOGS bleiben
└──────────────────┘
```

## Workspace / Obsidian

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `WORKSPACE_PATH` | — (Pflicht) | `WORKSPACE_PATH` / `VAULT_PATH` | Absoluter Pfad zum Workspace |
| `WORKSPACE_INBOX` | `"Inbox"` | — | Ordnername für Notizen |
| `WORKSPACE_AGENTS_DIR` | `"Agents"` | — | Ordnername für Agent-Workspaces |
| `WORKSPACE_LOGS_DIR` | `"MEMORY_LOGS"` | — | Ordnername für Tageslog-Dateien |

### Workspace-Limits

| Konstante | Wert | Beschreibung |
|---|---|---|
| `WS_MAX_FILE_CHARS` | `20.000` | Maximale Zeichen pro Workspace-Datei (Truncation) |
| `WS_MAX_TOTAL_CHARS` | `150.000` | Maximales Gesamtbudget für den System-Prompt |
| `KEPT_TOOL_MESSAGES` | `8` | Tool-Messages beim Pruning behalten |
| `TOOL_PRUNE_MAX_CHARS` | `4.000` | Tool-Ergebnisse beim Pruning kürzen |

### Abgeleitete Pfad-Funktionen

| Funktion | Ergebnis |
|---|---|
| `agentsPath()` | `WORKSPACE_PATH/Agents` |
| `agentPath(name)` | `WORKSPACE_PATH/Agents/<name>` |
| `logsPath(name)` | `WORKSPACE_PATH/Agents/<name>/MEMORY_LOGS` |

### Workspace-Struktur

```
WORKSPACE_PATH/
├── Inbox/                    # Notizen (notiz_speichern)
├── Projekte/                 # Projektordner
├── Agents/
│   └── Main/                 # Haupt-Agent
│       ├── IDENTITY.md
│       ├── SOUL.md
│       ├── BOOT.md
│       ├── USER.md
│       ├── TOOLS.md
│       ├── AGENTS.md
│       ├── MEMORY.md
│       ├── HEARTBEAT.md
│       ├── BOOTSTRAP.md      # Wird nach erstem Gespräch gelöscht
│       └── MEMORY_LOGS/
│           ├── 2026-05-10.md
│           └── 2026-05-11.md
└── Exports/                  # Session-Exporte (/export)
```

## Timeouts

| Konstante | Wert | Beschreibung |
|---|---|---|
| `TYPING_INTERVAL_MS` | `4.000` ms | Telegram-Typing-Indikator Wiederholungsintervall |
| `FETCH_TIMEOUT_MS` | `30.000` ms | Web-Fetch Timeout |
| `VM_TIMEOUT_MS` | `10.000` ms | `code_ausfuehren` Sandbox-Timeout |
| `HTTP_REQUEST_TIMEOUT_MS` | `15.000` ms | `http_anfrage` Tool-Timeout |
| `DYNAMIC_TOOL_TIMEOUT_MS` | `30.000` ms | Dynamische Tools (`run.js` / `run.sh`) |
| `COMMAND_TIMEOUT_SEC` | `15` s | `befehl_ausfuehren` Standard-Timeout |
| `COMMAND_TIMEOUT_MAX_SEC` | `60` s | `befehl_ausfuehren` Maximum |

## Output-Limits

| Konstante | Wert | Beschreibung |
|---|---|---|
| `TOOL_OUTPUT_MAX_CHARS` | `8.000` | Tool-Output Truncation (executor, tools, mcp) |
| `HTTP_RESPONSE_MAX_CHARS` | `6.000` | `http_anfrage` Antwort-Truncation |
| `CODE_OUTPUT_MAX_CHARS` | `4.000` | `code_ausfuehren` Output-Truncation |
| `MESSAGE_PREVIEW_LENGTH` | `80` | Log-Preview von User-Nachrichten |
| `COMMAND_BUFFER_SIZE` | `1 MB` | `exec()` maxBuffer |

## Web-Suche & Cache

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_RESPONSE_BYTES` | `5.000.000` (5 MB) | Maximale Download-Größe beim Web-Fetch |
| `WEB_CACHE_TTL_MS` | `900.000` (15 min) | Cache-Lebensdauer für Web-Ergebnisse |
| `WEB_CACHE_MAX` | `200` | Maximale Einträge im Web-Cache |
| `WEB_MAX_RETRIES` | `2` | Maximale Wiederholungsversuche bei Web-Anfragen |

## Dateisuche

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_FILE_SCAN` | `1.000` | Maximale Dateien bei `walkDir` |
| `SEARCH_MAX_RESULTS` | `10` | Maximale Treffer bei `searchWorkspace` |
| `SEARCH_LINE_MAX` | `100` | Maximale Zeilenlänge bei Suchergebnissen |
| `EXTRACT_MAX_CHARS` | `50.000` | Maximale Zeichen bei Dokument-Extraktion |

## Logging

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_LOG_LINES` | `500` | Maximale Zeilen in `logs/bot.log` (Rotation) |
| `LOG_DEFAULT_LINES` | `20` | `/logs` Standard-Anzahl angezeigter Zeilen |
| `LOG_MAX_DISPLAY_LINES` | `50` | `/logs` Maximum |
| `LOG_DISPLAY_MAX_CHARS` | `3.800` | `/logs` Output-Limit (Zeichen) |

### JSONL-Log-Rotation

Die maschinenlesbare JSONL-Logdatei (`bot.jsonl`) wird größenbasiert rotiert — bei Überschreitung wird `bot.jsonl → bot.jsonl.1 → bot.jsonl.2` usw. Das verhindert volles Filesystem auf Langzeit-Installationen.

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `LOG_JSONL_MAX_BYTES` | `5.242.880` (5 MB) | `LOG_JSONL_MAX_BYTES` | Max. Dateigröße vor Rotation |
| `LOG_JSONL_KEEP_FILES` | `5` | `LOG_JSONL_KEEP_FILES` | Anzahl rotierter Dateien die behalten werden |

## Embeddings

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `EMBEDDING_MODEL` | `text-embedding-3-small` / `nomic-embed-text` | `EMBEDDING_MODEL` | Embedding-Modell (OpenAI oder Ollama) |
| `EMBEDDING_DIMENSIONS` | `1536` / `768` | `EMBEDDING_DIMENSIONS` | Vektor-Dimensionen (je nach Backend) |
| `EMBEDDING_BATCH_SIZE` | `5` | — | Parallele Embedding-Anfragen |

::: tip OpenAI vs. Ollama
- OpenAI-Modus: `text-embedding-3-small` mit 1536 Dimensionen
- Ollama-Modus: `nomic-embed-text` mit 768 Dimensionen

Das Embedding-Modell ist in das Datenbankschema eingebrannt — ein Wechsel erfordert eine neue Migration.
:::

## Datenbank

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `DATABASE_URL` | — | `DATABASE_URL` | PostgreSQL-Connection-String. Aktiviert DB-Modus |
| `DB_ENABLED` | `false` | — | Automatisch `true` wenn `DATABASE_URL` gesetzt |
| `DB_AUTO_MIGRATE` | `true` | `DB_AUTO_MIGRATE` | Migrations beim Start automatisch ausführen |
| `SUPABASE_URL` | — | `SUPABASE_URL` | Supabase-Projekt-URL (optional) |
| `SUPABASE_ANON_KEY` | — | `SUPABASE_ANON_KEY` | Supabase Anon-Key (optional) |
| `SUPABASE_SERVICE_KEY` | — | `SUPABASE_SERVICE_KEY` | Supabase Service-Key (optional) |
| `SUPABASE_ENABLED` | `false` | — | Automatisch `true` wenn URL + Anon-Key gesetzt |
| `AUDIT_RETENTION_DAYS` | `365` | `AUDIT_RETENTION_DAYS` | Aufbewahrungsdauer für Audit-Einträge in Tagen. `0` = nie löschen |

::: warning Auto-Migrate in Produktion
`DB_AUTO_MIGRATE=true` ist praktisch für Entwicklung. In Produktionssystemen mit CI/CD-Pipeline empfiehlt sich `DB_AUTO_MIGRATE=false` und explizites Ausführen von `npm run db:migrate`.
:::

## Web-API & Sicherheit

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `JWT_SECRET` | — | `JWT_SECRET` | Secret für JWT-Signierung. Aktiviert die Web-API |
| `API_PORT` | `3000` | `API_PORT` | Port der Hono Web-API |
| `API_ENABLED` | `false` | — | Automatisch `true` wenn `JWT_SECRET` gesetzt |
| `APP_URL` | leer | `APP_URL` | Öffentliche Base-URL (z.B. `https://app.patio.at`). Leer = Host aus Request-Header |
| `JWT_SECRET_OK` | `false` | — | Automatisch `true` wenn `JWT_SECRET` mindestens 32 Zeichen lang ist |

### Rate-Limiting

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `RATE_LIMIT_ATTEMPTS` | `5` | — | Maximale Login-Versuche pro IP (Login-Throttle) |
| `RATE_LIMIT_WINDOW_MS` | `900.000` (15 min) | — | Zeitfenster für Login-Rate-Limiting |
| `API_RATE_LIMIT_REQUESTS` | `600` | `API_RATE_LIMIT_REQUESTS` | Anfragen pro Minute pro IP (globaler API-Throttle) |
| `API_RATE_LIMIT_WINDOW_MS` | `60.000` (1 min) | `API_RATE_LIMIT_WINDOW_MS` | Zeitfenster für globales Rate-Limiting |

### Upload-Limits

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `MAX_UPLOAD_MB` | `50` | `MAX_UPLOAD_MB` | Maximale Dateigröße für Uploads |
| `MAX_UPLOAD_BYTES` | `52.428.800` | — | Berechnet aus `MAX_UPLOAD_MB` |

### Sandbox & Shell-Sicherheit

| Einstellung | Beschreibung |
|---|---|
| Shell-Allowlist | ~40 erlaubte Befehle (ls, cat, grep, curl, git, npm, etc.) |
| Env-Var-Filter | Shell-Scripts bekommen nur: PATH, HOME, USER, LANG, SHELL, TERM, WORKSPACE_PATH |
| Dynamic Tool Sandbox | Kein `fetch`, kein `require`, kein `process` — nur Math, Date, JSON, etc. |
| Path-Traversal-Schutz | `safePath()` validiert alle Pfade gegen Workspace-Grenze |

## Microsoft Graph (Outlook-Kalender-Sync)

Optionale Integration mit Microsoft/Outlook-Kalender. Erfordert eine Azure App-Registrierung.

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `MS_CLIENT_ID` | leer | `MS_CLIENT_ID` | Azure App Client-ID |
| `MS_CLIENT_SECRET` | leer | `MS_CLIENT_SECRET` | Azure App Client-Secret |
| `MS_TENANT_ID` | `"common"` | `MS_TENANT_ID` | Azure Tenant-ID. `"common"` für Multi-Tenant |
| `MS_REDIRECT_URI` | leer | `MS_REDIRECT_URI` | Redirect-URI (muss exakt mit Azure-Eintrag übereinstimmen) |
| `MS_GRAPH_ENABLED` | `false` | — | Automatisch `true` wenn Client-ID und Secret gesetzt |

::: tip Azure-Setup
Redirect-URI muss in Azure registriert sein: `<APP_URL>/api/auth/microsoft/callback`. Benötigte API-Berechtigungen: `Calendars.ReadWrite`, `User.Read`, `offline_access`.
:::

## SMTP / E-Mail

Wird für den Versand von Login-Codes (2FA) per E-Mail benötigt. Ohne `SMTP_HOST` werden Codes im Server-Log ausgegeben (nur Entwicklung).

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `SMTP_HOST` | leer | `SMTP_HOST` | SMTP-Server-Hostname |
| `SMTP_PORT` | `587` | `SMTP_PORT` | SMTP-Port (587 mit STARTTLS, 465 mit SSL) |
| `SMTP_USER` | leer | `SMTP_USER` | SMTP-Benutzername |
| `SMTP_PASS` | leer | `SMTP_PASS` | SMTP-Passwort |
| `SMTP_FROM` | `PATIO <noreply@patio.local>` | `SMTP_FROM` | Absenderadresse |
| `SMTP_SECURE` | `"auto"` | `SMTP_SECURE` | TLS-Modus: `"auto"`, `"true"` (SSL), `"false"` (STARTTLS) |
| `SMTP_ENABLED` | `false` | — | Automatisch `true` wenn `SMTP_HOST` gesetzt |

## Dokument-Verzeichnisse

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `DAILY_NOTES_DIR` | `"Daily"` | `DAILY_NOTES_DIR` | Ordnername für Daily Notes im Workspace |
| `TEMPLATES_DIR` | `"Templates"` | `TEMPLATES_DIR` | Ordnername für Vorlagen im Workspace |
| `ATTACHMENTS_DIR` | `"Attachments"` | `ATTACHMENTS_DIR` | Ordnername für Anhänge im Workspace |

## Telegram-Zugriffskontrolle

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `ALLOWED_CHAT_IDS` | leer (kein Schutz) | `ALLOWED_CHAT_IDS` | Kommagetrennte Chat-IDs. Leer = kein Schutz |

```env
# Nur bestimmte Nutzer zulassen
ALLOWED_CHAT_IDS=123456789,987654321
```

## System

| Konstante | Wert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `TIMEZONE` | `"Europe/Vienna"` | — | Zeitzone für Cron-Jobs und Timestamps |
| `LOCALE` | `"de-AT"` | — | Locale für Datums- und Zeitformatierung |
| `LANGUAGE` | `"Deutsch"` | — | Sprache des Assistenten |
| `CHAT_ID_FILE` | `<cwd>/.chat_id` | — | Pfad zur Chat-ID-Datei |
| `LOG_FILE` | `<cwd>/logs/bot.log` | — | Pfad zur Bot-Logdatei |

### Graceful Shutdown

PATIO reagiert auf `SIGTERM` und `SIGINT` mit sauberem Herunterfahren:
1. Telegram-Bot stoppen
2. Alle MCP-Server trennen (`disconnectAll()`)
3. Prozess beenden

### Pflicht-Umgebungsvariablen

```env
# Beide sind Pflicht — ohne sie startet der Bot nicht
BOT_TOKEN=<telegram-bot-token>
WORKSPACE_PATH=/pfad/zum/workspace
```

::: warning Fehlende Variablen
Wenn `BOT_TOKEN` oder `WORKSPACE_PATH` fehlen, wirft `src/index.ts` sofort einen Fehler und der Bot startet nicht. Wenn `DATABASE_URL` gesetzt ist, aber die Datenbank nicht erreichbar ist, beendet sich der Prozess mit Exit-Code 1 — es gibt keinen stillen Fallback auf Filesystem.
:::
