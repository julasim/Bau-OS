# Architektur

PATIO besteht aus fünf Schichten: **Telegram** (Interface), **Web-API + Frontend** (Browser-Interface), **Agent Runtime** (Logik), **LLM** (Intelligenz) und **Datenschicht** (Speicher — Filesystem oder PostgreSQL).

## Datenfluss

```
[Telegram Bot (grammY)]       [Vue 3 Frontend]
        |                            |
        v                            v
[Session Queue]            [Hono HTTP-API + JWT]
  serialisiert pro                   |
  Chat-ID                            |
        |                            |
        +------------ + ------------+
                       |
                       v
          [processAgent / processMessage]
           Agent-Runtime (src/llm/runtime.ts)
                       |
          ┌────────────┼────────────┐
          v            v            v
     [Built-in    [Dynamic      [MCP Tools
      Tools]       Tools]        (stdio)]
      src/llm/     tools/        mcp.json
      handlers/    *.json+*.js
          |
          v
   [OpenAI SDK Client]
   OpenAI oder Ollama-Endpunkt
          |
          v
   [Data Layer — src/data/index.ts]
   ┌──────────────┬──────────────┐
   v              v              v
[PostgreSQL]  [Filesystem]   [Chat-Log]
 db-*.ts       fs-*.ts       immer FS
 src/db/       workspace/    (JSONL)
```

### Ablauf einer Telegram-Nachricht

1. **Telegram** empfängt die Nachricht, Bot prüft Zugriffskontrolle (Auto-Owner / ALLOWED_CHAT_IDS)
2. **Session Queue** reiht sie ein — eine Nachricht pro Chat-ID gleichzeitig
3. **Agent Runtime** lädt den Workspace (MD-Dateien) als System-Prompt + letzte N Gesprächseinträge
4. **Action Detection** prüft ob die Anfrage eine Aktion ist — falls ja, wird `antworten` in Runde 1 gefiltert
5. **LLM** generiert Tool-Aufrufe in einem Agentic Loop (bis zu `MAX_TOOL_ROUNDS`)
6. **Tools** führen Aktionen aus (Notiz speichern, Termin anlegen, Semantische Suche, etc.)
7. **Antwort** via `antworten`-Tool zurück an Telegram

## Modulstruktur

```
src/
|-- index.ts              Einstiegspunkt — DB-Init, Bot, Heartbeat, API
|-- bot.ts                Telegram-Bot: Commands, Nachrichten-Routing, Upload-Handler
|-- config.ts             Zentrale Konfiguration (Konstanten + Pfade)
|-- format.ts             Markdown → Telegram HTML Konverter
|-- queue.ts              Message-Serialisierung pro Chat-ID
|-- logger.ts             File-Logging (bot.log, max 500 Zeilen)
|-- heartbeat.ts          Cron-basierte periodische Agent-Runs
|-- tools.ts              Dynamic Tools: laden, erstellen, löschen
|-- mcp.ts                MCP-Server: stdio-Transport, Tool-Proxy, Reconnect
|-- web.ts                webseite_lesen-Tool mit SSRF-Schutz
|-- commands/
|   +-- system.ts         Alle /slash-Commands
|-- llm/
|   |-- client.ts         OpenAI-Client, Model-State, buildDateLine()
|   |-- tools.ts          Tool-Definitionen aggregiert (built-in + dynamic + MCP)
|   |-- handlers/         Handler-Module je Domäne (notes, tasks, agents, ...)
|   |-- executor.ts       Tool-Ausführung (Router)
|   |-- runtime.ts        Agent-Loop: processAgent(), processBtw()
|   |-- compaction.ts     Log-Komprimierung (runCompaction, compactNow)
|   |-- actions.ts        Action-Detection, TOOL_SKIP_CORRECTION, Retry-Logik
|   |-- whitelist.ts      Tool-Whitelist für System-Prompt
|   +-- setup.ts          Setup-Wizard + State
|-- workspace/
|   |-- helpers.ts        safePath(), atomicWriteSync(), Frontmatter-Utils
|   |-- notes.ts          Notizen-CRUD (FS)
|   |-- tasks.ts          Aufgaben-CRUD (FS)
|   |-- termine.ts        Termine-CRUD (FS)
|   |-- projects.ts       Projekte (FS)
|   |-- files.ts          Datei-Operationen (FS)
|   |-- search.ts         Vault-Volltextsuche
|   |-- agents.ts         Agent-Workspace: laden, Compaction-Lock, History-Parser
|   +-- index.ts          Barrel Re-Exports
|-- data/
|   |-- index.ts          Factory: wählt DB- oder FS-Implementierung
|   |-- types.ts          Shared Interfaces (Task, Termin, Note, Project, ...)
|   |-- db-notes.ts       Notes → PostgreSQL
|   |-- db-tasks.ts       Tasks → PostgreSQL
|   |-- db-termine.ts     Termine → PostgreSQL
|   |-- db-team.ts        Team → PostgreSQL
|   |-- db-files.ts       Files → PostgreSQL (bytea)
|   |-- db-projects.ts    Projects → PostgreSQL
|   |-- fs-notes.ts       Notes → Markdown-Filesystem
|   |-- fs-tasks.ts       Tasks → JSONL-Filesystem
|   |-- fs-chat.ts        Chat-History → JSONL (immer FS, cap: 10k Zeilen)
|   +-- fs-agent-logs.ts  Agent-Logs → JSONL (immer FS, cap: 5k Zeilen)
|-- db/
|   |-- client.ts         PostgreSQL-Pool (postgres.js)
|   |-- migrate.ts        SQL-Migrations-Runner (idempotent)
|   |-- embeddings.ts     Auto-Embed beim Speichern (OpenAI / nomic-embed-text)
|   |-- semantic-search.ts Vector-, Hybrid- und Text-Suche
|   +-- migrations/       NNN_name.sql Migrations-Dateien
+-- api/
    |-- server.ts         Hono HTTP-Server, CORS, Security-Headers, JWT-Auth
    |-- auth.ts           JWT-Middleware, Login-Rate-Limit
    |-- realtime-bridge.ts Supabase Realtime → Bot-Notifications
    +-- routes/
        |-- notes.ts      REST: /notes
        |-- tasks.ts      REST: /tasks
        |-- termine.ts    REST: /termine
        |-- projects.ts   REST: /projects
        |-- files.ts      REST: /files (Upload + Download)
        |-- team.ts       REST: /team
        |-- agents.ts     REST: /agents
        |-- chat.ts       SSE: /chat (Agentic Loop im Browser)
        |-- search.ts     REST: /search
        |-- dashboard.ts  REST: /dashboard
        +-- settings.ts   REST: /settings (Passwort ändern)

web/                      Vue 3 + Pinia + Vue Router (separates Vite-Projekt)
tools/                    Dynamic Tools (je Ordner: tool.json + run.js/run.sh)
```

## Stack

| Komponente | Technologie |
|---|---|
| **Bot Framework** | grammY (TypeScript) |
| **Runtime** | Node.js 22+, tsx watch (dev), tsc (prod) |
| **LLM** | OpenAI API **oder** Ollama (lokal) — automatische Wahl via `OPENAI_API_KEY` |
| **Web-API** | Hono (TypeScript-first, kompakt) |
| **Frontend** | Vue 3 + Pinia + Vue Router (optional) |
| **Datenbank** | PostgreSQL + pgvector (optional) — ohne DB: Filesystem-Modus |
| **Realtime** | Supabase Realtime (optional) |
| **Brain / Workspace** | Obsidian-kompatibler Vault (plain .md) |
| **Scheduling** | node-cron (Europe/Vienna) |
| **Deployment** | Hetzner VPS pro Kunde (EU, DSGVO) |

## Design-Prinzipien

### Zwei Modi, eine Codebasis

PATIO läuft in zwei Datenmodi — die Auswahl erfolgt automatisch beim Start:

- **Filesystem-Modus** (Standard): Alle Daten als Markdown/JSONL im Workspace. Kein extra Dienst nötig, alles mit dem Texteditor bearbeitbar.
- **Datenbank-Modus** (`DATABASE_URL` gesetzt): PostgreSQL für strukturierte Daten, mit optionalem `pgvector` für semantische Suche. Chat-History und Agent-Logs bleiben immer im Filesystem (leicht per `grep`).

Der Datenzugriff erfolgt **ausschließlich** über `src/data/index.ts` — nie direkt aus den `db-*`- oder `fs-*`-Implementierungen heraus.

### Verhalten in Dateien, nicht in Code

Der Code injiziert nur das heutige Datum. Alles andere — Sprache, Ton, Stil, Regeln, Tool-Konventionen — kommt aus den Agent-MD-Dateien (`SOUL.md`, `BOOT.md`, `MEMORY.md`, etc.). Änderungen am Verhalten erfordern keinen Code-Eingriff und keinen Neustart.

### Tool-System: drei Quellen

Jede LLM-Runde bekommt Tools aus drei Quellen gleichzeitig:

1. **Built-in Tools** (`src/llm/handlers/`) — statisch im Code definiert, immer verfügbar
2. **Dynamic Tools** (`tools/`) — jeder Unterordner ist ein Tool; Änderungen sind sofort wirksam
3. **MCP Tools** (`mcp.json`) — externe MCP-Server als stdio-Kindprozesse; Tools werden automatisch mit Server-Prefix versehen

### Agentic Loop mit Halluzinations-Schutz

Das Modell kann keine Antwort direkt ausgeben — es muss das `antworten`-Tool aufrufen. Bei erkannten Aktions-Anfragen wird `antworten` in Runde 1 herausgefiltert, damit das Modell nicht behaupten kann, eine Aktion ausgeführt zu haben ohne es wirklich getan zu haben. Ignoriert das Modell `tool_choice: "required"`, gibt es bis zu `MAX_TOOL_SKIP_RETRIES` Retries mit verstärktem Korrektions-Prompt.

### Pro Kunde eine Instanz

Keine geteilte Infrastruktur. Jeder Kunde bekommt einen eigenen Server, eigenen Workspace, eigene Konfiguration. Vollständige Datenisolation.
