# Dateistruktur

Vollständige Referenz aller Module im `src/`-Verzeichnis. Alle TypeScript-Dateien liegen unter `bau-os/src/`.

## Übersicht

```
src/
├── index.ts              Einstiegspunkt & Boot-Sequenz
├── bot.ts                Telegram Bot (grammY)
├── config.ts             Zentrale Konfiguration & Konstanten
├── queue.ts              Per-Chat FIFO Session-Queue
├── format.ts             Markdown → Telegram HTML
├── logger.ts             Logging (pino)
├── heartbeat.ts          Cron-Heartbeat für Agenten
├── tools.ts              Dynamic Tools (tools/ Verzeichnis)
├── mcp.ts                MCP-Client (stdio Child-Prozesse)
├── web.ts                Web-Suche & SSRF-Schutz
├── llm/
│   ├── client.ts         OpenAI-SDK Client (OpenAI oder Ollama)
│   ├── tools.ts          Tool-Definitionen aggregiert
│   ├── executor.ts       Tool-Router → handlers/
│   ├── runtime.ts        Agentic Loop (MAX_TOOL_ROUNDS=100)
│   ├── compaction.ts     Tageslog-Komprimierung
│   ├── setup.ts          Setup-Wizard (Ersteinrichtung)
│   ├── actions.ts        Action-Detection & Retry-Logik
│   ├── context.ts        Request-Context (reply-Fn, Tiefe)
│   ├── whitelist.ts      Tool-Whitelist für System-Prompt
│   └── handlers/
│       ├── index.ts      Re-Export aller Handler
│       ├── types.ts      HandlerMap Interface
│       ├── notes.ts      Notizen (5 Tools)
│       ├── tasks.ts      Aufgaben (3 Tools)
│       ├── termine.ts    Termine (3 Tools)
│       ├── files.ts      Dateien (11 Tools)
│       ├── projects.ts   Projekte (5 Tools)
│       ├── team.ts       Team (3 Tools)
│       ├── agents.ts     Agenten (9 Tools)
│       ├── system.ts     System (2 Tools)
│       ├── web.ts        Web (4 Tools)
│       ├── dyntools.ts   Dynamische Tools (3 Tools)
│       ├── mcp.ts        MCP (3 Tools)
│       └── chats.ts      Chat (1 Tool)
├── workspace/
│   ├── index.ts          Re-Export der Workspace-Module
│   ├── helpers.ts        safePath & Pfad-Utilities
│   ├── notes.ts          Notizen-Filesystem
│   ├── tasks.ts          Aufgaben-Filesystem
│   ├── termine.ts        Termine-Filesystem
│   ├── files.ts          Datei-Metadaten
│   ├── fileops.ts        Glob, Grep, Read, Write, Edit
│   ├── search.ts         Keyword-Textsuche (System-Dateien)
│   ├── projects.ts       Projekte-Filesystem
│   ├── team.ts           Team-Filesystem
│   ├── agents.ts         Agent-Workspace-Verwaltung
│   ├── extractor.ts      PDF/DOCX Text-Extraktion
│   ├── pdf.ts            PDF-Erstellung
│   └── docx.ts           DOCX-Erstellung
├── data/
│   ├── index.ts          Factory (DB oder FS je nach DATABASE_URL)
│   ├── types.ts          Interfaces (Task, Note, Termin, Project, ...)
│   ├── db-notes.ts       Notizen → PostgreSQL
│   ├── db-tasks.ts       Aufgaben → PostgreSQL
│   ├── db-termine.ts     Termine → PostgreSQL
│   ├── db-projects.ts    Projekte → PostgreSQL
│   ├── db-files.ts       Dateien → PostgreSQL
│   ├── db-team.ts        Team → PostgreSQL
│   ├── fs-notes.ts       Notizen → Markdown-Dateien
│   ├── fs-tasks.ts       Aufgaben → Markdown-Dateien
│   ├── fs-termine.ts     Termine → Markdown-Dateien
│   ├── fs-projects.ts    Projekte → Markdown-Dateien
│   ├── fs-team.ts        Team → Markdown-Dateien
│   ├── fs-chat.ts        Chat-Historie → JSONL (cap: 10k Zeilen)
│   └── fs-agent-logs.ts  Agent-Logs → JSONL (cap: 5k Zeilen)
├── db/
│   ├── client.ts         PostgreSQL Connection Pool
│   ├── migrate.ts        SQL-Migrations-Runner
│   ├── embeddings.ts     Auto-Embedding (OpenAI / nomic-embed-text)
│   ├── semantic-search.ts Vector-, Hybrid- und Text-Suche
│   ├── supabase.ts       Supabase Realtime Client
│   ├── index.ts          Re-Export DB-Funktionen
│   └── migrations/
│       ├── 001_init.sql
│       ├── 002_chat_sessions.sql
│       ├── 003_db_only_storage.sql
│       ├── 004_project_stammdaten.sql
│       ├── 005_fix_files_project_fk.sql
│       └── 006_projects_name_unique.sql
├── api/
│   ├── server.ts         Hono API-Server (CORS, Security-Headers)
│   ├── auth.ts           JWT-Middleware
│   ├── events.ts         SSE Event-Emitter
│   ├── realtime-bridge.ts Supabase Realtime → Bot
│   └── routes/
│       ├── notes.ts
│       ├── tasks.ts
│       ├── termine.ts
│       ├── projects.ts
│       ├── files.ts
│       ├── team.ts
│       ├── agents.ts
│       ├── agent-logs.ts
│       ├── chat.ts
│       ├── search.ts
│       ├── dashboard.ts
│       ├── settings.ts
│       └── events.ts
└── commands/
    └── system.ts         16 Slash-Commands
```

---

## Einstiegspunkt

### `src/index.ts`

Boot-Sequenz in dieser Reihenfolge:

1. `.env` laden
2. Bei gesetztem `DATABASE_URL`: Postgres-Healthcheck + pgvector-Prüfung + optionale Auto-Migration (`DB_AUTO_MIGRATE`, Standard: an)
3. Telegram Bot erstellen
4. Heartbeat starten (proaktive geplante Pings)
5. MCP-Clients aus `mcp.json` initialisieren
6. Bot starten
7. Hono API + Supabase Realtime Bridge starten (wenn `JWT_SECRET` gesetzt)

SIGTERM/SIGINT lösen graceful shutdown von Bot, MCP und DB aus. Fehlt `WORKSPACE_PATH` oder `BOT_TOKEN`, wirft der Prozess beim Start. Ist `DATABASE_URL` gesetzt aber die DB nicht erreichbar, beendet sich der Prozess mit Exit-Code 1.

---

## Bot & Queue

### `src/bot.ts`

grammY-Bot-Instanz. Registriert alle Telegram-Handler (Nachrichten, Fotos, Dokumente, Sprachnachrichten, Callbacks) und alle Slash-Commands. Leitet eingehende Nachrichten an die Session-Queue weiter.

### `src/queue.ts`

Per-Chat FIFO-Queue. Stellt sicher dass Nachrichten eines einzelnen Chats sequenziell verarbeitet werden — neue Nachrichten warten bis die laufende Verarbeitung abgeschlossen ist.

---

## Konfiguration

### `src/config.ts`

Zentrale Datei für alle Tunables:

- Modell-Namen (`MAIN_MODEL`, `FAST_MODEL`, `SUBAGENT_MODEL`, `VISION_MODEL`)
- Prompt/History-Budgets (`HISTORY_LOAD_LIMIT`, `MAX_PROMPT_TOKENS`)
- **`MAX_TOOL_ROUNDS = 100`** — Sicherheitsnetz für den Agentic Loop (kleine Ollama-Modelle rufen Tools sequenziell auf statt gebatcht)
- Timeouts, Output-Limits, Rate-Limits, Upload-Caps
- `DB_ENABLED` — true wenn `DATABASE_URL` gesetzt
- `WORKSPACE_PATH` (Alias: `VAULT_PATH`)

Der Laufzeit-Modell-Override via `setRuntimeMainModel` gilt nur für den Main-Agent.

---

## Hilfsdienste

### `src/format.ts`

Konvertiert Markdown in Telegram-kompatibles HTML. Behandelt fett, kursiv, Code, Links und Listen.

### `src/logger.ts`

pino-basiertes Logging mit strukturierten JSON-Ausgaben.

### `src/heartbeat.ts`

Cron-Heartbeat für Agenten. Liest `HEARTBEAT.md` jedes Agenten und plant Cron-Jobs. Wird live aktualisiert wenn `agent_datei_schreiben` mit `HEARTBEAT.md` aufgerufen wird — kein Neustart nötig.

### `src/web.ts`

Web-Suche (DuckDuckGo, Google News), Webseiten-Fetch mit Content-Extraktion und SSRF-Schutz (blockiert localhost, 10.x.x.x, 192.168.x.x, 172.16-31.x.x, 169.254.x.x).

---

## LLM-Schicht

### `src/llm/client.ts`

OpenAI SDK Client. Verbindet mit OpenAI direkt wenn `OPENAI_API_KEY` gesetzt ist, sonst mit Ollama via dem OpenAI-kompatiblen Endpoint (`OLLAMA_BASE_URL`, Standard: `http://localhost:11434/v1`).

### `src/llm/tools.ts`

Aggregiert alle Tool-Definitionen (Schemas) aus den Handlern zu einem einzigen `TOOLS`-Array das in jeder LLM-Runde übergeben wird. Enthält auch das spezielle `antworten`-Schema.

### `src/llm/executor.ts`

Tool-Router. Empfängt Tool-Aufrufe vom LLM und delegiert sie an den passenden Handler aus `handlers/`. Kein großer Switch-Case — nutzt eine Map von Handler-Funktionen.

### `src/llm/runtime.ts`

Agentic Loop. Kernlogik für die Verarbeitung einer Nachricht:

1. Agent-Workspace-Kontext + letzte N Konversationseinträge laden (`HISTORY_LOAD_LIMIT`)
2. Action-Detection (`actions.ts`): wenn der Nutzer klar eine Aktion angefordert hat, wird `antworten` in Runde 1 herausgefiltert — damit ruft das Modell zuerst ein echtes Tool auf
3. Loop bis zu `MAX_TOOL_ROUNDS = 100` mit `tool_choice: "required"`, Tool-Aufrufe via `executor.ts` ausführen, bis das Modell `antworten` aufruft
4. Runde an das Konversations-Log anhängen; Kompaktierung ausführen wenn `shouldCompact()` true zurückgibt

### `src/llm/compaction.ts`

Komprimiert den Tageslog eines Agenten wenn er eine Schwellengröße überschreitet. Fasst ältere Einträge zusammen um den Prompt-Kontext klein zu halten.

### `src/llm/actions.ts`

Action-Detection-Logik. Erkennt ob eine Nutzer-Nachricht klar eine Aktion anfordert (z.B. "speicher das", "erstell eine Aufgabe") und implementiert die Retry-Logik wenn ein Tool-Aufruf fehlschlägt.

### `src/llm/context.ts`

Request-Context-Verwaltung. Hält die reply-Funktion, aktuelle Spawn-Tiefe und die processAgent-Funktion für den laufenden Request vor — ermöglicht Handlern den Zugriff auf diese Funktionen ohne sie durch alle Ebenen durchreichen zu müssen.

### `src/llm/whitelist.ts`

Definiert welche Tools im System-Prompt erwähnt werden. Verhindert dass der Agent Tools aufruft die für seinen aktuellen Kontext nicht relevant sind.

### `src/llm/setup.ts`

Interaktiver Setup-Wizard für die Ersteinrichtung. Führt durch `.env`-Konfiguration und Workspace-Initialisierung.

---

## LLM Handlers (`src/llm/handlers/`)

14 Dateien. Jede Datei exportiert Schemas (OpenAI Tool-Definitionen) und Handlers (Implementierungen). Der Executor mappt Tool-Namen auf diese Handler-Funktionen.

| Datei | Tools | Beschreibung |
|---|---|---|
| `index.ts` | — | Re-Export aller Schemas und Handler |
| `types.ts` | — | `HandlerMap` Interface (Tool-Name → async Funktion) |
| `notes.ts` | 5 | notiz_speichern, notizen_auflisten, notiz_lesen, notiz_loeschen, notiz_bearbeiten |
| `tasks.ts` | 3 | aufgabe_speichern, aufgaben_auflisten, aufgabe_erledigen |
| `termine.ts` | 3 | termin_speichern, termine_auflisten, termin_loeschen |
| `files.ts` | 11 | datei_lesen, datei_erstellen, ordner_auflisten, vault_suchen, semantisch_suchen, datei_bearbeiten, dateien_suchen, regex_suchen, pdf_erstellen, docx_erstellen, datei_senden |
| `projects.ts` | 5 | projekte_auflisten, projekt_info, projekt_anlegen, projekt_aktualisieren, projekt_loeschen |
| `team.ts` | 3 | team_auflisten, team_anlegen, team_entfernen |
| `agents.ts` | 9 | memory_speichern, agent_verlauf, agent_aktiv, agent_spawnen_async, agent_spawnen, agent_erstellen, agenten_auflisten, agent_datei_lesen, agent_datei_schreiben |
| `system.ts` | 2 | befehl_ausfuehren, code_ausfuehren |
| `web.ts` | 4 | http_anfrage, web_suchen, nachrichten_suchen, webseite_lesen |
| `dyntools.ts` | 3 | tool_erstellen, tools_auflisten, tool_loeschen |
| `mcp.ts` | 3 | mcp_server_auflisten, mcp_server_verbinden, mcp_server_trennen |
| `chats.ts` | 1 | chat_suchen |

---

## Workspace-Modul (`src/workspace/`)

Filesystem-Implementierungen für den Obsidian-Workspace. Dieses Modul wurde in v0.6.0 von `vault/` nach `workspace/` umbenannt.

### `src/workspace/helpers.ts`

`safePath()` — löst einen relativen Pfad gegen `WORKSPACE_PATH` auf und stellt sicher dass er nicht außerhalb des Workspace liegt (Path-Traversal-Schutz).

### `src/workspace/fileops.ts`

Low-Level Dateioperationen: `globFiles`, `grepFiles`, `readFile`, `createFile`, `editFile`. Diese Funktionen werden von `handlers/files.ts` aufgerufen.

### `src/workspace/search.ts`

Keyword-Textsuche in System-Dateien (Agent-Configs, nicht User-Content).

### `src/workspace/agents.ts`

Agent-Workspace-Verwaltung: `createAgentWorkspace`, `listAgents`, `getAgentPath`, `isProtectedAgent`, `readAgentFile`, `writeAgentFile`, `appendAgentMemory`, `loadAgentHistory`.

### `src/workspace/extractor.ts`

Extrahiert Text aus PDF- und DOCX-Dateien. Wird von `datei_lesen` verwendet wenn eine Dokumentdatei geöffnet wird.

### `src/workspace/pdf.ts`

Erstellt PDF-Dateien mit Titel und Textinhalt. Speichert unter `Exports/` im Workspace.

### `src/workspace/docx.ts`

Erstellt Word-Dateien (.docx) mit Titel und Textinhalt. Speichert unter `Exports/` im Workspace.

---

## Data Layer (`src/data/`)

Einzige Import-Oberfläche für alle Persistenz-Operationen. `index.ts` wählt beim Start je nach `DB_ENABLED` zwischen DB- und FS-Implementierung. **Nie direkt aus `db-*` oder `fs-*` importieren.**

### `src/data/index.ts`

Factory-Datei. Exportiert alle Repositories (`taskRepo`, `terminRepo`, `noteRepo`, `projectRepo`, `teamRepo`, `fileRepo`, `chatRepo`, `agentLogRepo`) getypt durch Interfaces aus `types.ts`.

**Chat-Historie und Agent-Logs verwenden immer FS** (JSONL-Dateien) — unabhängig vom DB-Modus. Diese Dateien sind einfach zu tail/grep und der Bot muss auch ohne DB funktionieren.

### `src/data/types.ts`

TypeScript-Interfaces für alle persistierten Entities: `Task`, `Note`, `Termin`, `Project`, `TeamMember`, `FileRecord`, `ChatMessage`, `AgentLogEntry` und die dazugehörigen Repository-Interfaces.

### DB-Implementierungen (PostgreSQL)

| Datei | Entity |
|---|---|
| `db-notes.ts` | Notizen |
| `db-tasks.ts` | Aufgaben |
| `db-termine.ts` | Termine |
| `db-projects.ts` | Projekte (inkl. Stammdaten aus Migration 004) |
| `db-files.ts` | Dateien (mit Blob-Speicherung) |
| `db-team.ts` | Team-Mitglieder |

### FS-Implementierungen (Markdown/JSONL)

| Datei | Entity | Format |
|---|---|---|
| `fs-notes.ts` | Notizen | Markdown-Dateien |
| `fs-tasks.ts` | Aufgaben | Markdown-Dateien |
| `fs-termine.ts` | Termine | Markdown-Dateien |
| `fs-projects.ts` | Projekte | Markdown-Dateien |
| `fs-team.ts` | Team-Mitglieder | Markdown-Dateien |
| `fs-chat.ts` | Chat-Historie | JSONL (cap: 10.000 Zeilen) |
| `fs-agent-logs.ts` | Agent-Logs | JSONL (cap: 5.000 Zeilen) |

---

## Datenbank-Module (`src/db/`)

### `src/db/client.ts`

PostgreSQL Connection Pool via `postgres` npm-Paket. Konfiguriert via `DATABASE_URL`.

### `src/db/migrate.ts`

SQL-Migrations-Runner. Liest nummerierte `.sql`-Dateien aus `migrations/` und führt fehlende Migrationen in Reihenfolge aus. Wird beim Start automatisch ausgeführt wenn `DB_AUTO_MIGRATE=true` (Standard).

### `src/db/embeddings.ts`

Automatische Embedding-Generierung. Wählt je nach Konfiguration:
- OpenAI `text-embedding-3-small` (1536 Dimensionen) wenn `OPENAI_API_KEY` gesetzt
- Ollama `nomic-embed-text` (768 Dimensionen) sonst

Die Dimension ist im Schema festgelegt — ein Modellwechsel erfordert eine neue Migration.

### `src/db/semantic-search.ts`

Vektor-, Hybrid- und Text-Suche via pgvector. Drei Varianten: reine Vektorsuche, hybride Suche (Vektor + Volltext), und reine Textsuche als Fallback wenn pgvector fehlt.

### `src/db/supabase.ts`

Supabase Realtime Client für die Realtime-Bridge.

### `src/db/migrations/`

6 SQL-Dateien, in dieser Reihenfolge angewendet:

| Migration | Inhalt |
|---|---|
| `001_init.sql` | Basistabellen (notes, tasks, termine, projects, files, team) + pgvector-Extension |
| `002_chat_sessions.sql` | Chat-Sessions und Nachrichten-Tabellen |
| `003_db_only_storage.sql` | File-Blob-Speicherung in DB |
| `004_project_stammdaten.sql` | Strukturierte Stammdaten-Spalten für Projekte (projektnummer, bauherr, standort, projektart, nutzung, phase, start_date, end_date) |
| `005_fix_files_project_fk.sql` | FK-Constraint-Fix für files → projects |
| `006_projects_name_unique.sql` | Unique-Index auf projects.name |

---

## Web API (`src/api/`)

### `src/api/server.ts`

Hono HTTP-Server. Port via `API_PORT` (Standard: 3000). Konfiguriert CORS, Security-Headers und alle API-Routen. Wird nur gestartet wenn `JWT_SECRET` gesetzt ist.

### `src/api/auth.ts`

JWT-Middleware für alle API-Routen. User-Records liegen in `data/users.json`.

### `src/api/events.ts`

Server-Sent Events (SSE) Emitter für Live-Updates im Web-Frontend.

### `src/api/realtime-bridge.ts`

Verbindet Supabase Realtime mit dem Bot. Ermöglicht Echtzeit-Benachrichtigungen aus der DB.

### `src/api/routes/`

13 Route-Dateien die die Tool-Oberfläche des Bots als HTTP-API spiegeln:

| Datei | Routen |
|---|---|
| `notes.ts` | CRUD für Notizen |
| `tasks.ts` | CRUD für Aufgaben |
| `termine.ts` | CRUD für Termine |
| `projects.ts` | CRUD für Projekte |
| `files.ts` | Upload, Download, Suche |
| `team.ts` | CRUD für Team-Mitglieder |
| `agents.ts` | Agent-Verwaltung |
| `agent-logs.ts` | Agent-Log-Abfragen |
| `chat.ts` | Chat-Historie, Suche, Streaming |
| `search.ts` | Semantische Suche, Reindex |
| `dashboard.ts` | Aggregierte Übersichts-Daten |
| `settings.ts` | Konfiguration, Modell-Auswahl |
| `events.ts` | SSE-Endpoint für Live-Updates |

---

## Commands (`src/commands/`)

### `src/commands/system.ts`

Implementierung aller 16 Slash-Commands die in `bot.ts` registriert werden:

`/start` `/hilfe` `/commands` `/status` `/kontext` `/kompakt` `/neu` `/whoami` `/agents` `/export` `/model` `/fast` `/sprache` `/heute` `/config` `/restart` `/logs [n]`

Speziell: `/btw <message>` — direkter LLM-Roundtrip ohne Tools und ohne Konversations-Log. Nützlich für One-off-Fragen die den Agenten-Kontext nicht beeinflussen sollen.

---

## Dynamic Tools (`src/tools.ts`)

Lädt und verwaltet dynamische Tools aus dem `tools/`-Verzeichnis. Jedes Unterverzeichnis enthält:
- `tool.json` — OpenAI-Tool-Schema (Name, Beschreibung, Parameter)
- `run.js` — Node.js-Script (erhält `args`-Objekt, gibt String zurück)
- oder `run.sh` — Shell-Script (Parameter als Umgebungsvariablen)

Exportiert `createTool`, `deleteTool`, `listDynamicTools` und stellt die geladenen Schemas für den LLM zur Verfügung.

---

## MCP-Client (`src/mcp.ts`)

MCP (Model Context Protocol) Client. Startet externe MCP-Server als stdio-Kindprozesse gemäß `mcp.json`. Ihre Tools werden mit dem Servernamen präfixiert und proxied. Ermöglicht Anbindung externer Systeme (z.B. GitHub, Dateisystem, Datenbanken, APIs) ohne Code-Änderungen.
