# Dateistruktur

Vollständige Referenz aller Module im `src/`-Verzeichnis. Alle TypeScript-Dateien liegen unter `bau-os/src/`.

## Übersicht

```
src/
├── index.ts              — Einstiegspunkt & Boot-Sequenz
├── bot.ts                — Telegram Bot (grammY) + Message Handler
├── bot-manager.ts        — Multi-Bot-Verwaltung (per-org Bots)
├── config.ts             — Alle Konstanten und Umgebungsvariablen
├── queue.ts              — Per-Chat FIFO-Queue
├── format.ts             — Markdown → Telegram HTML
├── logger.ts             — Logging-Utilities (pino)
├── heartbeat.ts          — Proaktive geplante Agenten-Nachrichten
├── tools.ts              — Dynamische Tools (tools/-Verzeichnis)
├── mcp.ts                — MCP-Client-Manager (stdio Child-Prozesse)
├── web.ts                — Web-Suche, Webseiten-Fetch, SSRF-Schutz
├── notifications.ts      — Telegram-Benachrichtigungen (Zuweisung, Termin, Meeting)
├── maintenance.ts        — Wartungs-Utilities
├── llm/
│   ├── client.ts         — OpenAI-SDK-Client (OpenAI oder Ollama)
│   ├── tools.ts          — Tool-Array-Zusammenstellung für LLM-Calls
│   ├── executor.ts       — Tool-Ausführung + Handler-Routing
│   ├── runtime.ts        — Haupt-Loop (bis zu MAX_TOOL_ROUNDS=100)
│   ├── compaction.ts     — Kontext-Komprimierung (Tageslog)
│   ├── setup.ts          — System-Prompt-Aufbau
│   ├── actions.ts        — Action-Detection + Halluzinations-Schutz
│   ├── context.ts        — Request-Context (reply-Fn, Tiefe, processAgent)
│   ├── user-context.ts   — AsyncLocalStorage für User-Scope
│   ├── whitelist.ts      — Tool-Whitelist pro Agent
│   └── handlers/         — 17 Handler-Dateien
│       ├── index.ts      — Re-Export aller Handler
│       ├── types.ts      — HandlerMap Interface
│       ├── notes.ts      — Notizen (5 Tools)
│       ├── tasks.ts      — Aufgaben (3 Tools)
│       ├── termine.ts    — Termine (3 Tools)
│       ├── files.ts      — Dateien (11 Tools)
│       ├── projects.ts   — Projekte (5 Tools)
│       ├── team.ts       — Team + Firmen (10 Tools)
│       ├── bautagebuch.ts — Bautagebuch (3 Tools)
│       ├── meetings.ts   — Meetings/Protokolle (3 Tools)
│       ├── time-entries.ts — Stundenerfassung (3 Tools)
│       ├── agents.ts     — Agenten (9 Tools)
│       ├── system.ts     — System (2 Tools)
│       ├── web.ts        — Web (4 Tools)
│       ├── dyntools.ts   — Dynamische Tools (3 Tools)
│       ├── mcp.ts        — MCP (3 Tools)
│       └── chats.ts      — Chat (1 Tool)
├── workspace/            — Filesystem-Implementierungen
│   ├── index.ts          — Re-Export der Workspace-Module
│   ├── helpers.ts        — safePath & Pfad-Utilities (Path-Traversal-Schutz)
│   ├── notes.ts          — Notizen-Filesystem
│   ├── tasks.ts          — Aufgaben-Filesystem
│   ├── termine.ts        — Termine-Filesystem
│   ├── files.ts          — Datei-Metadaten
│   ├── fileops.ts        — Glob, Grep, Read, Write, Edit
│   ├── search.ts         — Keyword-Textsuche (System-Dateien)
│   ├── projects.ts       — Projekte-Filesystem
│   ├── team.ts           — Team-Filesystem
│   ├── agents.ts         — Agent-Workspace-Verwaltung
│   ├── extractor.ts      — PDF/DOCX Text-Extraktion
│   ├── pdf.ts            — PDF-Erstellung (speichert unter Exports/)
│   └── docx.ts           — DOCX-Erstellung (speichert unter Exports/)
├── data/                 — Repository-Abstraktionsschicht
│   ├── index.ts          — Factory: DB oder FS je nach DATABASE_URL
│   ├── types.ts          — Interfaces für alle Repositories und Entities
│   ├── access.ts         — User-Scope, ACL-Prüfungen
│   ├── db-notes.ts       — Notizen → PostgreSQL
│   ├── db-tasks.ts       — Aufgaben → PostgreSQL
│   ├── db-termine.ts     — Termine → PostgreSQL
│   ├── db-projects.ts    — Projekte → PostgreSQL (inkl. Stammdaten)
│   ├── db-files.ts       — Dateien → PostgreSQL (mit Blob-Speicherung)
│   ├── db-team.ts        — Team-Mitglieder + Firmen → PostgreSQL
│   ├── db-chat.ts        — Chat-Sessions + Nachrichten → PostgreSQL
│   ├── db-bautagebuch.ts — Bautagebuch → PostgreSQL
│   ├── db-meetings.ts    — Meetings/Protokolle → PostgreSQL
│   ├── db-time-entries.ts — Stundenerfassung → PostgreSQL
│   ├── db-audit.ts       — Audit-Log → PostgreSQL
│   ├── db-branding.ts    — Org-Branding → PostgreSQL
│   ├── db-microsoft.ts   — Microsoft-Account-Verknüpfung → PostgreSQL
│   ├── db-templates.ts   — Vorlagen → PostgreSQL
│   ├── db-export-templates.ts — Export-Vorlagen → PostgreSQL
│   ├── db-project-modules.ts — Projekt-Module → PostgreSQL
│   ├── db-custom-modules.ts  — Benutzerdefinierte Module → PostgreSQL
│   ├── db-custom-placeholders.ts — Platzhalter → PostgreSQL
│   ├── db-ui-preferences.ts — UI-Präferenzen → PostgreSQL
│   ├── fs-notes.ts       — Notizen → Markdown-Dateien
│   ├── fs-tasks.ts       — Aufgaben → Markdown-Dateien
│   ├── fs-termine.ts     — Termine → Markdown-Dateien
│   ├── fs-projects.ts    — Projekte → Markdown-Dateien
│   ├── fs-team.ts        — Team → Markdown-Dateien
│   ├── fs-chat.ts        — Chat-Historie → JSONL (cap: 10.000 Zeilen)
│   └── fs-agent-logs.ts  — Agent-Logs → JSONL (cap: 5.000 Zeilen)
├── db/                   — Datenbankschicht
│   ├── client.ts         — postgres.js Connection Pool
│   ├── migrate.ts        — SQL-Migrations-Runner
│   ├── embeddings.ts     — Embedding-Generierung (OpenAI oder Ollama)
│   ├── semantic-search.ts — Vektor-, Hybrid- und Text-Suche (pgvector)
│   ├── supabase.ts       — Supabase Realtime Client
│   ├── index.ts          — Re-Export DB-Funktionen
│   └── migrations/       — 33 SQL-Dateien (001–033)
├── api/                  — Hono HTTP API
│   ├── server.ts         — Hono-App, Auth-Middleware, CORS, Security-Headers
│   ├── auth.ts           — JWT, User-Management, Auth-Middleware
│   ├── events.ts         — SSE Event-Emitter für Live-Updates
│   ├── realtime-bridge.ts — Supabase Realtime → Bot
│   └── routes/           — 26 Route-Dateien
│       ├── notes.ts, tasks.ts, termine.ts, projects.ts
│       ├── files.ts, team.ts, agents.ts, agent-logs.ts
│       ├── chat.ts, search.ts, dashboard.ts, settings.ts
│       ├── bautagebuch.ts, meetings.ts, time-entries.ts
│       ├── companies.ts, templates.ts, export-templates.ts
│       ├── project-modules.ts, ui-preferences.ts
│       ├── auth-2fa.ts, auth-microsoft.ts, webhooks-microsoft.ts
│       ├── admin-users.ts, branding.ts, events.ts
├── commands/
│   └── system.ts         — Telegram-Slash-Commands
├── emails/               — E-Mail-Templates und -Versand
├── export/               — Export-Logik (PDF, DOCX aus Templates)
└── sync/                 — Microsoft Calendar / Outlook Sync
```

---

## Einstiegspunkt

### `src/index.ts`

Boot-Sequenz in dieser Reihenfolge:

1. `.env` laden
2. Bei gesetztem `DATABASE_URL`: Postgres-Healthcheck + pgvector-Prüfung + optionale Auto-Migration (`DB_AUTO_MIGRATE`, Standard: an)
3. Telegram Bot erstellen
4. Heartbeat starten (proaktive geplante Agenten-Pings)
5. MCP-Clients aus `mcp.json` initialisieren
6. Bot starten
7. Hono API + Supabase Realtime Bridge starten (wenn `JWT_SECRET` gesetzt)

SIGTERM/SIGINT lösen graceful shutdown von Bot, MCP und DB aus. Fehlt `WORKSPACE_PATH` oder `BOT_TOKEN`, wirft der Prozess beim Start. Ist `DATABASE_URL` gesetzt aber die DB nicht erreichbar, beendet sich der Prozess mit Exit-Code 1 — es gibt keinen stillen FS-Fallback.

---

## Bot & Queue

### `src/bot.ts`

grammY-Bot-Instanz. Registriert alle Telegram-Handler (Nachrichten, Fotos, Dokumente, Sprachnachrichten, Callbacks) und alle Slash-Commands. Leitet eingehende Nachrichten an die Session-Queue weiter.

### `src/bot-manager.ts`

Verwaltung mehrerer Bot-Instanzen (Multi-Tenant / per-Organisation). Ermöglicht dass verschiedene Organisationen eigene Telegram-Bot-Tokens verwenden.

### `src/queue.ts`

Per-Chat FIFO-Queue. Stellt sicher dass Nachrichten eines einzelnen Chats sequenziell verarbeitet werden — neue Nachrichten warten bis die laufende Verarbeitung abgeschlossen ist.

---

## Konfiguration

### `src/config.ts`

Zentrale Datei für alle Tunables:

- Modell-Namen (`MAIN_MODEL`, `FAST_MODEL`, `SUBAGENT_MODEL`, `VISION_MODEL`)
- Prompt/History-Budgets (`HISTORY_LOAD_LIMIT`, `MAX_PROMPT_TOKENS`)
- **`MAX_TOOL_ROUNDS = 100`** — Sicherheitsnetz für den Agentic Loop. Kleine Ollama-Modelle rufen Tools oft sequenziell statt gebatcht auf, wodurch jeder Schritt eine eigene Runde zählt. Das ist ein Sicherheitsnetz, kein Budget.
- Timeouts (`COMMAND_TIMEOUT_SEC`, `VM_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`)
- Output-Limits (`TOOL_OUTPUT_MAX_CHARS`, `CODE_OUTPUT_MAX_CHARS`, `HTTP_RESPONSE_MAX_CHARS`)
- Upload-Cap (`MAX_UPLOAD_MB`, Standard: 50)
- `DB_ENABLED` — true wenn `DATABASE_URL` gesetzt
- `WORKSPACE_PATH` (Alias: `VAULT_PATH`)

Der Laufzeit-Modell-Override via `setRuntimeMainModel` gilt nur für den Main-Agent; alle anderen Agenten verwenden immer ihr konfiguriertes Modell.

---

## Hilfsdienste

### `src/format.ts`

Konvertiert Markdown in Telegram-kompatibles HTML. Behandelt fett, kursiv, Code, Links und Listen.

### `src/logger.ts`

pino-basiertes Logging mit strukturierten JSON-Ausgaben.

### `src/heartbeat.ts`

Cron-Heartbeat für Agenten. Liest `HEARTBEAT.md` jedes Agenten und plant Cron-Jobs. Wird live aktualisiert wenn `agent_datei_schreiben` mit `HEARTBEAT.md` aufgerufen wird — kein Neustart nötig.

### `src/web.ts`

Web-Suche (DuckDuckGo), News-Suche (Google News, Region Österreich), Webseiten-Fetch mit Content-Extraktion. SSRF-Schutz blockiert: localhost, 10.x.x.x, 192.168.x.x, 172.16–31.x.x, 169.254.x.x.

### `src/notifications.ts`

Sendet Telegram-Benachrichtigungen an Team-Mitglieder: Aufgaben-Zuweisung (`aufgabe_speichern`), Termin-Einladung (`termin_speichern`), Meeting-Einladung (`meeting_anlegen`). Löst User-IDs aus Member-IDs auf.

---

## LLM-Schicht

### `src/llm/client.ts`

OpenAI SDK Client. Verbindet mit **OpenAI direkt** wenn `OPENAI_API_KEY` gesetzt ist, sonst mit **Ollama** via dem OpenAI-kompatiblen Endpoint (`OLLAMA_BASE_URL`, Standard: `http://localhost:11434/v1`). Der gleiche Code funktioniert für beide Backends.

### `src/llm/tools.ts`

Aggregiert alle Tool-Schemas aus den Handlern zu einem einzigen `TOOLS`-Array das in jeder LLM-Runde übergeben wird. Enthält auch das spezielle `antworten`-Schema (der Terminator). Importiert aus: `noteSchemas`, `taskSchemas`, `terminSchemas`, `fileSchemas`, `projectSchemas`, `teamSchemas`, `bautagebuchSchemas`, `meetingSchemas`, `timeEntrySchemas`, `agentSchemas`, `systemSchemas`, `webSchemas`, `dyntoolSchemas`, `mcpSchemas`, `chatSchemas`.

### `src/llm/executor.ts`

Tool-Router. Empfängt Tool-Aufrufe vom LLM und delegiert sie an den passenden Handler aus `handlers/`. Keine große Switch-Case-Kette — nutzt eine Map von Handler-Funktionen die zur Laufzeit zusammengeführt werden.

### `src/llm/runtime.ts`

Agentic Loop. Kernlogik für die Verarbeitung einer Nachricht:

1. Agent-Workspace-Kontext + letzte N Konversationseinträge laden (`HISTORY_LOAD_LIMIT`)
2. Action-Detection (`actions.ts`): wenn der Nutzer klar eine Aktion angefordert hat, wird `antworten` in Runde 1 herausgefiltert — damit ruft das Modell zuerst ein echtes Tool auf statt eine Fake-Bestätigung zu liefern
3. Loop bis zu `MAX_TOOL_ROUNDS = 100` mit `tool_choice: "required"`: Tool-Aufrufe via `executor.ts` ausführen, bis das Modell `antworten` aufruft
4. Runde an das Konversations-Log anhängen; Kompaktierung ausführen wenn `shouldCompact()` true zurückgibt

### `src/llm/compaction.ts`

Komprimiert den Tageslog eines Agenten wenn er eine Schwellengröße überschreitet. Fasst ältere Einträge zusammen um den Prompt-Kontext klein zu halten.

### `src/llm/actions.ts`

Action-Detection-Logik. Erkennt ob eine Nutzer-Nachricht klar eine Aktion anfordert (z.B. "speicher das", "erstell eine Aufgabe") und filtert in diesem Fall `antworten` aus Runde 1 heraus. Verhindert dass das Modell einen Tool-Aufruf halluziniert ohne ihn auszuführen.

### `src/llm/context.ts`

Request-Context-Verwaltung. Hält die reply-Funktion, aktuelle Spawn-Tiefe und die processAgent-Funktion für den laufenden Request vor. Ermöglicht Handlern den Zugriff auf diese Laufzeit-Objekte ohne sie durch alle Ebenen durchreichen zu müssen.

### `src/llm/user-context.ts`

AsyncLocalStorage für den User-Kontext. Propagiert den eingeloggten User (`userId`, `role`, sichtbare Projekte) durch den gesamten LLM-Call-Stack — wichtig für Multi-User-Scoping in den Handlern. `getCurrentUserCtx()` liefert null wenn kein User-Kontext vorhanden (z.B. Heartbeat).

### `src/llm/whitelist.ts`

Definiert welche Tools im System-Prompt erwähnt werden. Verhindert dass der Agent Tools aufruft die für seinen aktuellen Kontext nicht relevant sind.

### `src/llm/setup.ts`

Baut den System-Prompt für jeden LLM-Call auf. Kombiniert Agent-Workspace-Dateien (SOUL.md, BOOT.md, IDENTITY.md, MEMORY.md etc.) mit dem Tool-Kontext.

---

## LLM Handlers (`src/llm/handlers/`)

17 Handler-Dateien. Jede Datei exportiert Schemas (OpenAI Tool-Definitionen) und Handlers (Implementierungen). Der Executor mappt Tool-Namen auf diese Handler-Funktionen.

| Datei | Tools | Beschreibung |
|---|---|---|
| `index.ts` | — | Re-Export aller Schemas und Handler |
| `types.ts` | — | `HandlerMap` Interface (Tool-Name → async Funktion) |
| `notes.ts` | 5 | `notiz_speichern`, `notizen_auflisten`, `notiz_lesen`, `notiz_loeschen`, `notiz_bearbeiten` |
| `tasks.ts` | 3 | `aufgabe_speichern`, `aufgaben_auflisten`, `aufgabe_erledigen` |
| `termine.ts` | 3 | `termin_speichern`, `termine_auflisten`, `termin_loeschen` |
| `files.ts` | 11 | `datei_lesen`, `datei_erstellen`, `ordner_auflisten`, `vault_suchen`, `semantisch_suchen`, `datei_bearbeiten`, `dateien_suchen`, `regex_suchen`, `pdf_erstellen`, `docx_erstellen`, `datei_senden` |
| `projects.ts` | 5 | `projekte_auflisten`, `projekt_info`, `projekt_anlegen`, `projekt_aktualisieren`, `projekt_loeschen` |
| `team.ts` | 10 | `team_auflisten`, `team_anlegen`, `team_aktualisieren`, `team_zuordnen`, `team_entfernen_aus_projekt`, `team_projektrolle_setzen`, `team_log_eintrag`, `team_entfernen`, `firma_auflisten`, `firma_anlegen` |
| `bautagebuch.ts` | 3 | `bautagebuch_eintrag`, `bautagebuch_woche`, `bautagebuch_lesen` |
| `meetings.ts` | 3 | `meeting_anlegen`, `meetings_auflisten`, `meeting_lesen` |
| `time-entries.ts` | 3 | `stunden_eintragen`, `stunden_woche`, `stunden_summe` |
| `agents.ts` | 9 | `memory_speichern`, `agent_verlauf`, `agent_aktiv`, `agent_spawnen_async`, `agent_spawnen`, `agent_erstellen`, `agenten_auflisten`, `agent_datei_lesen`, `agent_datei_schreiben` |
| `system.ts` | 2 | `befehl_ausfuehren`, `code_ausfuehren` |
| `web.ts` | 4 | `http_anfrage`, `web_suchen`, `nachrichten_suchen`, `webseite_lesen` |
| `dyntools.ts` | 3 | `tool_erstellen`, `tools_auflisten`, `tool_loeschen` |
| `mcp.ts` | 3 | `mcp_server_auflisten`, `mcp_server_verbinden`, `mcp_server_trennen` |
| `chats.ts` | 1 | `chat_suchen` |

---

## Workspace-Modul (`src/workspace/`)

Filesystem-Implementierungen für den Obsidian-Workspace. Die Schnittstellen sind kompatibel mit den DB-Repositories im `data/`-Modul.

### `src/workspace/helpers.ts`

`safePath()` — löst einen relativen Pfad gegen `WORKSPACE_PATH` auf und stellt sicher dass er nicht außerhalb des Workspace liegt (Path-Traversal-Schutz).

### `src/workspace/fileops.ts`

Low-Level Dateioperationen: `globFiles`, `grepFiles`, `readFile`, `createFile`, `editFile`. Direkt von `handlers/files.ts` aufgerufen.

### `src/workspace/search.ts`

Keyword-Textsuche in System-Dateien (Agent-Configs — nicht User-Content). Wird von `vault_suchen` und `regex_suchen` verwendet.

### `src/workspace/agents.ts`

Agent-Workspace-Verwaltung: `createAgentWorkspace`, `listAgents`, `getAgentPath`, `isProtectedAgent`, `readAgentFile`, `writeAgentFile`, `appendAgentMemory`, `loadAgentHistory`.

### `src/workspace/extractor.ts`

Extrahiert Text aus PDF- und DOCX-Dateien (via `pdf-parse`, `mammoth`). Wird von `datei_lesen` verwendet wenn eine Dokumentdatei geöffnet wird.

### `src/workspace/pdf.ts`

Erstellt PDF-Dateien mit Titel und Textinhalt. Speichert unter `Exports/` im Workspace.

### `src/workspace/docx.ts`

Erstellt Word-Dateien (.docx) mit Titel und Textinhalt. Speichert unter `Exports/` im Workspace.

---

## Data Layer (`src/data/`)

Einzige Import-Oberfläche für alle Persistenz-Operationen. **Nie direkt aus `db-*` oder `fs-*` importieren** — immer nur über `src/data/index.ts`.

### Dual-Backend-Ansatz

`src/data/index.ts` wählt beim Start je nach `DB_ENABLED` (true wenn `DATABASE_URL` gesetzt) zwischen zwei Implementierungen:

- **`db-*` Dateien** — PostgreSQL via `postgres.js`. Voller Funktionsumfang: Embeddings, semantische Suche, Multi-User-Scoping, Blob-Speicherung, strukturierte Stammdaten.
- **`fs-*` Dateien** — Markdown/JSONL-Dateien im Workspace. Einfacher, ohne Infrastruktur-Abhängigkeit. Kein Multi-User, keine Embeddings, keine strukturierten Stammdaten.

**Chat-Historie und Agent-Logs verwenden immer FS** (JSONL-Dateien) — unabhängig vom DB-Modus. Diese Dateien sind einfach zu tail/grep und der Bot muss auch ohne DB funktionieren.

### `src/data/types.ts`

TypeScript-Interfaces für alle persistierten Entities und Repository-Interfaces: `Task`, `Note`, `Termin`, `Project`, `ProjectInfo`, `TeamMember`, `FileEntry`, `ChatMessage`, `AgentLogEntry`, `BautagebuchEntry`, `MeetingEntry`, `TimeEntry` u.v.m.

### `src/data/access.ts`

User-Scope und ACL-Prüfungen. `getVisibleProjectIds(ctx)` liefert die für einen User sichtbaren Projekt-IDs; `canSeeProjectByName(ctx, name)` prüft Einzelzugriff. Wird in allen Handlern für Multi-User-Scoping verwendet.

### DB-Implementierungen (PostgreSQL)

| Datei | Entity |
|---|---|
| `db-notes.ts` | Notizen |
| `db-tasks.ts` | Aufgaben |
| `db-termine.ts` | Termine |
| `db-projects.ts` | Projekte (inkl. Stammdaten: Projektnummer, Bauherr, Standort, Projektart, Nutzung, Phase) |
| `db-files.ts` | Dateien (mit Blob-Speicherung und Embedding-Trigger) |
| `db-team.ts` | Team-Mitglieder + Firmen (M:N Projekt-Zuordnungen, Kontakt-Log) |
| `db-chat.ts` | Chat-Sessions + Nachrichten |
| `db-bautagebuch.ts` | Bautagebuch-Einträge |
| `db-meetings.ts` | Meetings + Action Items |
| `db-time-entries.ts` | Stundenerfassung |
| `db-audit.ts` | Audit-Log |
| `db-branding.ts` | Org-Branding |
| `db-microsoft.ts` | Microsoft-Account-Verknüpfung |
| `db-templates.ts` | Vorlagen |
| `db-export-templates.ts` | Export-Vorlagen |
| `db-project-modules.ts` | Projekt-Module |
| `db-custom-modules.ts` | Benutzerdefinierte Module |
| `db-custom-placeholders.ts` | Platzhalter |
| `db-ui-preferences.ts` | UI-Präferenzen |

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

PostgreSQL Connection Pool via `postgres` npm-Paket. Konfiguriert via `DATABASE_URL`. Wird beim Start health-gecheckt — bei Verbindungsfehler beendet sich der Prozess mit Exit-Code 1.

### `src/db/migrate.ts`

SQL-Migrations-Runner. Liest nummerierte `.sql`-Dateien aus `migrations/` und führt fehlende Migrationen in Reihenfolge aus. Wird beim Start automatisch ausgeführt wenn `DB_AUTO_MIGRATE=true` (Standard). Manuell via `npm run db:migrate`.

### `src/db/embeddings.ts`

Automatische Embedding-Generierung. Wählt je nach Konfiguration:
- OpenAI `text-embedding-3-small` (1536 Dimensionen) wenn `OPENAI_API_KEY` gesetzt
- Ollama `nomic-embed-text` (768 Dimensionen) sonst

Die Dimension ist im Schema festgelegt — ein Modellwechsel erfordert eine neue Migration da Vektordimensionen nicht nachträglich geändert werden können.

### `src/db/semantic-search.ts`

Vektor-, Hybrid- und Text-Suche via pgvector. Drei Varianten: reine Vektorsuche, hybride Suche (Vektor + Volltext), und reine Textsuche als Fallback wenn pgvector fehlt oder deaktiviert ist.

### `src/db/supabase.ts`

Supabase Realtime Client. Wird von `api/realtime-bridge.ts` verwendet wenn `SUPABASE_URL` und `SUPABASE_ANON_KEY` gesetzt sind.

### `src/db/migrations/`

33 SQL-Dateien, in numerischer Reihenfolge angewendet:

| Migration | Inhalt |
|---|---|
| `001_init.sql` | Basistabellen (notes, tasks, termine, projects, files, team) + pgvector |
| `002_chat_sessions.sql` | Chat-Sessions und Nachrichten-Tabellen |
| `003_db_only_storage.sql` | File-Blob-Speicherung in DB |
| `004_project_stammdaten.sql` | Strukturierte Stammdaten-Spalten für Projekte |
| `005_fix_files_project_fk.sql` | FK-Constraint-Fix für files → projects |
| `005_project_links.sql` | Projekt-Verlinkungen |
| `006_projects_name_unique.sql` | Unique-Index auf projects.name |
| `006_team_redesign.sql` | Team-Tabellen-Redesign (Firmen, M:N Projekt-Zuordnungen, Kontakt-Log) |
| `007_assignee_links.sql` | Zuweisungs-Verknüpfungen |
| `008_users_activation.sql` | User-Aktivierung |
| `009_acl.sql` | Zugriffssteuerung (ACL) |
| `010_per_user_bots.sql` | Per-Organisation Bot-Tokens |
| `011_bautagebuch.sql` | Bautagebuch-Tabellen |
| `012_meetings.sql` | Meeting/Protokoll-Tabellen |
| `013_team_user_link.sql` | Team-Mitglied → User-Account Verknüpfung |
| `014_time_entries.sql` | Stundenerfassungs-Tabellen |
| `015_unique_telegram_chat_id.sql` | Unique-Constraint auf Telegram-Chat-ID |
| `016_cleanup_object_assignee.sql` | Aufräumen alter Assignee-Felder |
| `017_user_2fa.sql` | TOTP-basierte Zwei-Faktor-Authentifizierung |
| `018_audit_log.sql` | Audit-Log-Tabellen |
| `019_file_stars.sql` | Datei-Favoriten |
| `020_email_2fa.sql` | E-Mail-basierte 2FA |
| `021_email_otp_magic_link.sql` | Magic-Link-Login per E-Mail |
| `022_user_microsoft_accounts.sql` | Microsoft-Account-Verknüpfung |
| `023_termine_microsoft_sync.sql` | Termin-Sync mit Microsoft Calendar |
| `024_user_microsoft_calendars.sql` | Microsoft-Kalender-Konfiguration |
| `025_org_branding.sql` | Org-Branding (Logo, Farben, Firmendaten für Exporte) |
| `026_templates.sql` | Vorlagen-System |
| `027_export_templates.sql` | Export-Vorlagen |
| `028_project_modules.sql` | Projekt-Module (aktivierbare Features pro Projekt) |
| `029_user_ui_preferences.sql` | UI-Präferenzen pro User |
| `030_custom_features.sql` | Benutzerdefinierte Module und Platzhalter |
| `031_project_budget.sql` | Projekt-Budget-Felder |
| `032_otp_password_reset.sql` | OTP-basierter Passwort-Reset |
| `033_chat_db_sharing.sql` | Chat-DB-Sharing zwischen Instanzen |

---

## Web API (`src/api/`)

### `src/api/server.ts`

Hono HTTP-Server. Port via `API_PORT` (Standard: 3000). Konfiguriert CORS, Security-Headers und alle API-Routen. Wird nur gestartet wenn `JWT_SECRET` gesetzt ist.

### `src/api/auth.ts`

JWT-Middleware für alle API-Routen. User-Records liegen in `data/users.json`. Enthält auch User-Management-Funktionen (Registrierung, Passwort-Reset, 2FA).

### `src/api/events.ts`

Server-Sent Events (SSE) Emitter für Live-Updates im Web-Frontend. Der `emit()`-Aufruf in den Handlern löst diese Events aus.

### `src/api/realtime-bridge.ts`

Verbindet Supabase Realtime mit dem Bot. Ermöglicht Echtzeit-Benachrichtigungen aus der DB zurück in den Bot.

### `src/api/routes/`

26 Route-Dateien die die Tool-Oberfläche des Bots als HTTP-API spiegeln:

| Datei | Beschreibung |
|---|---|
| `notes.ts` | CRUD für Notizen |
| `tasks.ts` | CRUD für Aufgaben |
| `termine.ts` | CRUD für Termine |
| `projects.ts` | CRUD für Projekte |
| `files.ts` | Upload, Download, Suche |
| `team.ts` | Team-Mitglieder |
| `companies.ts` | Firmen-Verwaltung |
| `agents.ts` | Agent-Verwaltung |
| `agent-logs.ts` | Agent-Log-Abfragen |
| `chat.ts` | Chat-Historie, Suche, Streaming |
| `search.ts` | Semantische Suche, Reindex |
| `dashboard.ts` | Aggregierte Übersichts-Daten |
| `settings.ts` | Konfiguration, Modell-Auswahl |
| `bautagebuch.ts` | Bautagebuch CRUD |
| `meetings.ts` | Meetings/Protokolle CRUD |
| `time-entries.ts` | Stundenerfassung CRUD |
| `templates.ts` | Vorlagen CRUD |
| `export-templates.ts` | Export-Vorlagen CRUD |
| `project-modules.ts` | Projekt-Module |
| `ui-preferences.ts` | UI-Präferenzen |
| `auth-2fa.ts` | 2FA-Verwaltung |
| `auth-microsoft.ts` | Microsoft OAuth-Flow |
| `webhooks-microsoft.ts` | Microsoft Graph Webhooks |
| `admin-users.ts` | User-Administration |
| `branding.ts` | Org-Branding |
| `events.ts` | SSE-Endpoint für Live-Updates |

---

## Commands (`src/commands/`)

### `src/commands/system.ts`

Implementierung aller Slash-Commands die in `bot.ts` registriert werden:

`/start` `/hilfe` `/commands` `/status` `/kontext` `/kompakt` `/neu` `/whoami` `/agents` `/export` `/model` `/fast` `/sprache` `/heute` `/config` `/restart` `/logs [n]`

Speziell: `/btw <message>` — direkter LLM-Roundtrip ohne Tools und ohne Konversations-Log. Nützlich für One-off-Fragen die den Agenten-Kontext nicht beeinflussen sollen.

---

## Dynamic Tools (`src/tools.ts`)

Lädt und verwaltet dynamische Tools aus dem `tools/`-Verzeichnis. Jedes Unterverzeichnis enthält:
- `tool.json` — OpenAI-Tool-Schema (Name, Beschreibung, Parameter)
- `run.js` — Node.js-Script (erhält `args`-Objekt, gibt String zurück)
- oder `run.sh` — Shell-Script (Parameter als Umgebungsvariablen)

Exportiert `createTool`, `deleteTool`, `listDynamicTools` und stellt die geladenen Schemas für den LLM zur Verfügung. Neue Tools sind sofort verfügbar ohne Neustart.

---

## MCP-Client (`src/mcp.ts`)

MCP (Model Context Protocol) Client. Startet externe MCP-Server als stdio-Kindprozesse gemäß `mcp.json`. Ihre Tools werden mit dem Servernamen präfixiert und proxied. Ermöglicht Anbindung externer Systeme (z.B. GitHub, Dateisystem, Datenbanken, APIs) ohne Code-Änderungen.
