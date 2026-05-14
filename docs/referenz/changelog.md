# Changelog

Versionshistorie von PATIO. Älteste Version zuerst.

## v0.1.0 — Initial MVP
**04.04.2026**

Erster funktionsfähiger Prototyp mit Telegram-Bot, lokalem LLM und Obsidian-Vault.

- Telegram-Bot mit grammY-Framework
- Ollama-Integration als lokales LLM (qwen2.5:7b)
- Obsidian Vault als Datenspeicher (Markdown-Dateien)
- 30+ Slash-Commands (`/hilfe`, `/status`, `/heute`, etc.)
- Notizen, Aufgaben und Termine verwalten
- Vault-Suche über alle Markdown-Dateien
- Projekt-Verwaltung mit Unterordnern
- System-Prompt aus Markdown-Dateien (SOUL.md, BOOT.md, etc.)

::: tip MVP-Entscheidung
Bewusste Entscheidung gegen Cloud-AI (OpenAI, etc.) zugunsten von vollständiger Datensouveränität. Alle Daten bleiben auf dem eigenen Server.
:::

---

## v0.2.0 — Multi-Agent System
**05.04.2026**

Einführung des Multi-Agent-Systems mit Sub-Agenten, Session-Queue und Tageslog-Komprimierung.

- Multi-Agent-Architektur: Main-Agent kann Sub-Agenten spawnen
- `agent_spawnen` (blocking) und `agent_spawnen_async` (non-blocking)
- `agent_erstellen` — neue Agenten zur Laufzeit anlegen
- Session-Queue: Serialisierung pro Chat-ID gegen Race Conditions
- Tageslog-Komprimierung (Compaction) via LLM
- Gesprächsverlauf: Laden der letzten N Einträge
- PROTECTED_AGENTS: Main-Agent kann nicht gelöscht werden
- MAX_SPAWN_DEPTH: Verschachtelungstiefe begrenzt auf 2

---

## v0.3.0 — Setup-Wizard & Heartbeat
**06.04.2026**

Interaktiver Einrichtungsassistent und zeitgesteuertes Heartbeat-System.

- Setup-Wizard beim ersten Start (Name, Emoji, Vibe, Unternehmen)
- `setup_abschliessen`-Tool: LLM sammelt Daten und konfiguriert sich selbst
- HEARTBEAT.md: Cron-basierte Agent-Ausführung
- Stille-Modus: Agent antwortet mit `[STILL]` wenn nichts zu melden
- `node-cron` Integration mit Timezone-Support (Europe/Vienna)
- Installer-Script für automatisiertes Deployment

---

## v0.4.0 — LLM Tools & File Editor
**06.04.2026**

Umstellung von Regex-Commands auf LLM Tool Calling. Der Bot versteht jetzt natürliche Sprache.

- LLM Tool Calling statt Regex-basierte Erkennung
- OpenAI Function Calling Format (JSON Schema)
- Agentic Loop: Bis zu 5 Tool-Runden pro Nachricht
- Agent-Datei-Editor: `agent_datei_lesen`, `agent_datei_schreiben`
- Whitelist für editierbare Dateien (SOUL.md, BOOT.md, etc.)
- CRUD-Operationen über natürliche Sprache
- `/btw`-Modus: Direkte Antwort ohne Tools und ohne Log
- Memory-Tool: `memory_speichern` für Langzeitgedächtnis

::: tip Paradigmenwechsel
Vorher: `/notiz Baustellenbegehung war erfolgreich`
Nachher: "Notier dir dass die Baustellenbegehung erfolgreich war"
:::

---

## v0.5.0 — Admin Commands & Logging
**07.04.2026**

Erweitertes Logging-System und administrative Telegram-Commands.

- Logging-Modul (`src/logger.ts`) mit Datei- und Konsolen-Ausgabe
- Log-Rotation: Automatisches Kürzen auf 500 Zeilen
- `/logs [n]` — Letzte Log-Einträge im Chat anzeigen
- `/config` — Aktuelle Konfiguration anzeigen
- `/restart` — Bot per Command neu starten
- `/kontext` — Kontext-Auslastung mit Token-Schaetzung
- `/export` — Session-Log als Markdown exportieren
- `/model` — Modell zur Laufzeit wechseln
- `/fast` — Fast-Modus umschalten
- Zeitstempel im österreichischen Format (de-AT, Europe/Vienna)

---

## v0.6.0 — Modularisierung
**07.04.2026**

Komplette Projekt-Restrukturierung: Von 2 großen Dateien zu 15+ fokussierten Modulen.

- `src/vault/` — 8 Module: notes, tasks, termine, projects, files, search, agents, helpers
- `src/llm/` — 5 Module: client, tools, executor, runtime, compaction, setup
- `src/commands/` — System-Commands in eigenes Modul
- Barrel Re-Exports (`vault/index.ts`)
- Zirkulaere Imports aufgeloest (Late-Binding Pattern in executor.ts)
- Express-Dependency entfernt (kein Web-Dashboard mehr)
- Codebase von ~1.500 Zeilen in 2 Dateien zu ~2.150 Zeilen in 23 Dateien

::: warning Breaking Change
Die Module-Pfade haben sich geändert. Alle Imports zeigen jetzt auf Sub-Module statt auf monolithische Dateien.
:::

---

## v0.7.0 — Hardcode-Reduktion & Dokumentation
**07.04.2026**

Konfiguration zentralisiert und VitePress-Dokumentation aufgebaut.

- Zentrale `config.ts` mit allen Konstanten
- Umgebungsvariablen für LLM-Modelle (`OLLAMA_MODEL`, `OLLAMA_FAST_MODEL`, `OLLAMA_SUBAGENT_MODEL`)
- VitePress-Dokumentation mit vollständiger Referenz
- Sicherheitsdokumentation: DSGVO, Isolation, Zugriffskontrolle
- Tool-Referenz: Alle 26 LLM-Tools dokumentiert
- Dateistruktur-Referenz: Alle 23 Module dokumentiert
- Konfigurationsreferenz: Alle Konstanten dokumentiert

---

## v0.8.0 — Sicherheit & Stabilitaet
**09.04.2026**

Umfassende Code-Haertung: Error-Handling, Path-Schutz, Sandbox-Haertung und Graceful Shutdown.

### Sicherheit
- **Shell-Allowlist** statt Blocklist: ~40 erlaubte Befehle (ls, cat, grep, curl, git, etc.)
- **Rate Limiting**: Login-Endpoint max. 5 Versuche pro IP in 15 Minuten (HTTP 429)
- **CORS konfigurierbar**: Neue Env-Variable `CORS_ORIGINS` (komma-getrennte Liste)
- **Path-Traversal-Schutz**: `safePath()` in `files.ts`, `safeProjectName()` in `projects.ts`
- **Sandbox gehaertet**: `fetch` aus dynamischen Tools entfernt
- **Env-Vars gefiltert**: Shell-Scripts bekommen nur PATH, HOME, USER, LANG (keine Secrets)

### Stabilitaet
- **JSON.parse Error-Handling** an 6+ Stellen (runtime, setup, tasks, termine, team, auth)
- **fs.readdirSync Error-Handling** an 7+ Stellen (agents, projects, files, notes, helpers, search)
- **Graceful Shutdown**: SIGTERM/SIGINT-Handler stoppt Bot, trennt MCP-Server, beendet sauber
- **MCP Cleanup**: `disconnectAll()` beendet alle MCP-Server-Prozesse bei Shutdown

### Codequalitaet
- Hardcoded `"MEMORY_LOGS"` durch `VAULT_LOGS_DIR`-Konstante ersetzt
- Unused Import `estimateTokens` aus `commands/system.ts` entfernt
- Login-Body JSON.parse abgesichert (HTTP 400 statt Crash)

::: tip 18 Dateien geaendert
Diese Version betrifft 18 Quelldateien quer durch die gesamte Codebasis — von der API-Schicht bis zur Vault-Ebene.
:::

---

---

## v0.9.0 — Daten-Layer + Web-API
**April 2026**

Einführung eines abstrakten Daten-Layers mit PostgreSQL-Support und einer vollständigen Hono HTTP-API plus Vue 3 Frontend.

### Daten-Layer
- `src/data/index.ts` — Factory-Pattern: wählt automatisch DB- oder FS-Implementierung
- `src/data/types.ts` — Typen-Interfaces (Task, Termin, Note, Project, TeamMember, FileEntry, etc.)
- `db-*`-Implementierungen: PostgreSQL via `postgres.js` (direkt, kein ORM)
- `fs-*`-Implementierungen: Markdown/JSONL auf dem Filesystem (Fallback ohne DB)
- `src/db/migrate.ts` — SQL-Migrations-Runner (idempotent, nummerierte .sql-Dateien)
- `DATABASE_URL` Env-Variable: wenn gesetzt → DB-Modus, sonst → FS-Modus
- Chat-History und Agent-Logs bleiben **immer** im Filesystem (JSONL, leicht per grep)

### Web-API
- Hono HTTP-Server (`src/api/server.ts`) — kompakt, TypeScript-first
- JWT-Authentifizierung (`JWT_SECRET`-Env-Variable)
- Rate-Limiting Login-Endpoint: 5 Versuche / 15 Minuten
- CORS konfigurierbar via `CORS_ORIGINS`
- REST-Routen: notes, tasks, termine, projects, files, team, agents, search, chat, settings
- Supabase Realtime Bridge: `startRealtimeBridge()` leitet DB-Events in den Bot

### Vue 3 Frontend
- Vue 3 + Pinia + Vue Router (`web/`)
- Separate Vite-Konfiguration (`npm run dev:web`, `npm run build:all`)
- SPA-Fallback über Hono's `serveStatic`

---

## v0.10.0 — OpenAI Dual-Backend + Embeddings
**April 2026**

PATIO unterstützt jetzt sowohl Ollama (lokal) als auch OpenAI — automatische Erkennung via `OPENAI_API_KEY`.

### LLM-Backend
- OpenAI SDK als einheitlicher Client — zeigt je nach Config auf Ollama oder OpenAI-API
- `OPENAI_API_KEY` gesetzt → OpenAI-Modus (gpt-4o, etc.)
- Kein Key → Ollama-Modus (localhost:11434)
- Runtime-Modellwechsel via `/model` und `/fast` auch im Web-UI

### Embeddings & Semantische Suche
- `pgvector` Extension (optional — wenn fehlt, bleibt Volltext-Suche aktiv)
- `text-embedding-3-small` (1536 dims) bei OpenAI-Modus
- `nomic-embed-text` (768 dims) bei Ollama-Modus
- `src/db/embeddings.ts` — Auto-Embed bei Notizen- und Datei-Speicherung
- `src/db/semantic-search.ts` — Pure Vector, Hybrid (Vector + BM25) und Text-only Suche
- `npm run db:embed` — nachträgliches Embedding für bestehende Einträge

---

## v0.11.0 — Dynamic Tools + MCP
**April/Mai 2026**

Zwei neue Erweiterungspunkte: Eigene Tools als Ordner im Filesystem und externe MCP-Server.

### Dynamic Tools (`tools/`)
- Jeder Unterordner ist ein Tool: `tool.json` (Schema) + `run.js` (Node.js) oder `run.sh` (Shell)
- `run.js` läuft in einer Node.js-Sandbox (kein `fetch`, kein fs-Zugriff außerhalb des Tool-Ordners)
- Änderungen sofort aktiv — kein Neustart nötig
- Zusatzdateien (Templates, Daten) werden dem Script als `files()`-Map übergeben
- LLM kann neue Tools über `tool_erstellen` anlegen und bestehende löschen

### MCP-Server
- `mcp.json` im Projekt-Root konfiguriert externe MCP-Server
- stdio-Transport: MCP-Server laufen als Kindprozesse
- Tool-Namen werden automatisch mit Server-Prefix versehen (`mcp_servername_toolname`)
- Kollisionsprüfung gegen statische und bereits registrierte Tools
- `npm run mcp` für manuellen Test

---

## v0.12.0 — Datei-Upload & Team
**Mai 2026**

Vollständiger Datei-Upload via Telegram und Web-API, plus Team-Verwaltung.

### Datei-Upload
- Telegram: PDF, DOCX, XLSX, TXT etc. direkt in den Chat senden
- DB-Modus: Datei-Blob wird als `bytea` in der `files`-Tabelle gespeichert — kein Disk-Write
- FS-Modus: Fallback nach `Uploads/` im Workspace
- Text-Extraktion: PDF via `pdfjs-dist`, DOCX via `mammoth`
- Auto-Embedding des extrahierten Textes (fire-and-forget)
- Web-API: `/files/upload` (Drag & Drop), `/files/download` (Blob aus DB)
- `MAX_UPLOAD_MB` Env-Variable (Standard: 50 MB)

### Team-Verwaltung
- `TeamRepository`: Mitglieder anlegen, auflisten, aktualisieren, entfernen
- Projekt-Zuweisung per `projectId`
- DB- und FS-Implementierung

---

## v0.13.0 — Sicherheits- & Stabilitäts-Hardening
**Mai 2026**

24 Bugs und Sicherheitslücken behoben — identifiziert durch systematische Multi-Agent-Code-Analyse.

### Telegram-Zugriffskontrolle (neu)
- **Auto-Owner-Detection**: Erster Nutzer der schreibt wird als Owner gespeichert (`.chat_id`)
- **ALLOWED_CHAT_IDS**: Optionale Env-Variable für explizite Whitelist
- Alle weiteren Chat-IDs werden **ohne Fehlermeldung** ignoriert
- Middleware in `bot.ts` — greift vor allen Commands und Nachrichten

### Sicherheits-Fixes
- **SSRF**: IPv6-Ranges (`fd00::`, `fc00::`, `fe80::`, `::ffff:`) und Dezimal-IPs jetzt blockiert
- **Path-Traversal**: `safePath()` prüft jetzt `startsWith(path + sep)` statt nur `startsWith(path)` — verhindert `/vault-backup` als `/vault`-Bypass
- **Path-Traversal Dynamic Tools**: `safeToolDir()` Validation in `createTool()` und `deleteTool()`
- **MIME-Whitelist**: Datei-Uploads (Telegram + API) nur erlaubte Endungen (pdf, docx, xlsx, csv, txt, md, png, jpg, zip, json, xml)
- **Rate-Limit /api/chat**: 30 Anfragen / Minute pro User (zusätzlich zum Login-Rate-Limit)
- **Security Headers**: `secureHeaders()`-Middleware für alle API-Responses (X-Frame-Options, CSP, etc.)
- **Passwort-Mindestlänge**: 6 → 12 Zeichen
- **MCP Filesystem**: Standardmäßig deaktiviert (verhindert Zugriff auf `.env`)

### Stabilitäts-Fixes
- **LLM-Crash-Schutz**: `choices[0]`-Guard nach jedem API-Call
- **Message-Pruning**: assistant+tool-Runden werden als Paare entfernt (OpenAI-Anforderung)
- **History-Parser**: Mehrzeilige User-Nachrichten korrekt erkannt
- **Heartbeat-Race**: `startHeartbeat()` wird erst nach `bot.start()` aufgerufen
- **compactNow()**: Vollständig in try/catch — kein Crash mehr bei LLM-Fehler
- **Compaction-Lock**: `writeCompactedLog()` ist jetzt race-condition-sicher
- **updateNote()**: Atomarer Write via `atomicWriteSync()` statt direktem `fs.writeFileSync`
- **db-notes Prefix-Match**: `append()` und `update()` treffen jetzt exakt eine Zeile (SELECT id → UPDATE WHERE id = foundId)
- **null-Check nach INSERT...RETURNING**: tasks, termine, team, files — wirft jetzt Fehler statt zu crashen
- **JSONL-Größenbegrenzung**: fs-chat (10.000 Zeilen), fs-agent-logs (5.000 Zeilen)
- **searchWorkspace limitTo**: Verhindert Path-Traversal via `limitTo`-Parameter
- **MCP Reconnect**: Automatischer Reconnect nach Prozess-Absturz (3 Versuche, Backoff 5/10/15s)
- **Embedding-Startup-Check**: Dimensions-Mismatch wird beim Start geloggt (kein process.exit)
- **SQL-Migrations**: `005_fix_files_project_fk.sql` (ON DELETE SET NULL statt CASCADE), `006_projects_name_unique.sql`

---

## Roadmap

| Feature | Priorität | Status |
|---|---|---|
| ALLOWED_CHAT_IDS (Telegram-Zugriffskontrolle) | Hoch | ✅ Implementiert |
| Sprachnachrichten (Whisper) | Mittel | Vorbereitet |
| ÖNORM-Kalkulations-Agent | Mittel | Geplant |
| Telegram-Gruppen-Support | Mittel | Geplant |
| Rollenbasierte Zugriffskontrolle (Admin/User) | Mittel | Geplant |
| Webhook-Modus (statt Long Polling) | Niedrig | Geplant |
| Audit-Log | Niedrig | Geplant |
