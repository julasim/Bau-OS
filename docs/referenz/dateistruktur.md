# Dateistruktur

Vollstaendige Referenz aller Module im `src/`-Verzeichnis. Bau-OS besteht aus **23 TypeScript-Dateien** mit insgesamt **~2.150 Zeilen Code**.

## Uebersicht

```
src/
├── index.ts              # Einstiegspunkt
├── bot.ts                # Telegram Bot (grammY)
├── config.ts             # Zentrale Konfiguration
├── queue.ts              # Session-Queue
├── format.ts             # Markdown → Telegram HTML
├── logger.ts             # Logging-Modul
├── heartbeat.ts          # Cron-basierter Heartbeat
├── llm/
│   ├── client.ts         # OpenAI-Client (Ollama)
│   ├── tools.ts          # Tool-Definitionen (JSON Schema)
│   ├── executor.ts       # Tool-Ausfuehrung
│   ├── runtime.ts        # Agent Runtime (Agentic Loop)
│   ├── compaction.ts     # Tageslog-Komprimierung
│   └── setup.ts          # Setup-Wizard
└── vault/
    ├── index.ts          # Barrel Re-Export
    ├── helpers.ts        # Pfad-Utilities
    ├── notes.ts          # Notizen CRUD
    ├── tasks.ts          # Aufgaben CRUD
    ├── termine.ts        # Termine CRUD
    ├── projects.ts       # Projekt-Verwaltung
    ├── files.ts          # Datei-Operationen
    ├── search.ts         # Vault-Suche
    └── agents.ts         # Agent-Workspace-Verwaltung
```

## Kern-Module

### `src/index.ts` — Einstiegspunkt
**25 Zeilen** | Exports: _keine (Hauptmodul)_

Startet den Bot und den Heartbeat-Scheduler. Liest `BOT_TOKEN` und `VAULT_PATH` aus der `.env`-Datei. Verbindet den Heartbeat-Callback mit der Telegram-API.

---

### `src/bot.ts` — Telegram Bot
**112 Zeilen** | Exports: `createBot(token)`

Erstellt den grammY-Bot mit allen Command-Handlern und dem Text-Message-Handler. Kernlogik:
- System-Commands (`/hilfe`, `/status`, `/heute`, etc.) an `commands/system.ts` delegiert
- Textnachrichten via Session-Queue an LLM Runtime weitergeleitet
- Setup-Wizard bei erstem Start
- `/btw`-Modus fuer direkte Antworten ohne Tool-Nutzung
- Fallback: Nachricht als Notiz speichern wenn LLM nicht erreichbar

---

### `src/config.ts` — Zentrale Konfiguration
**42 Zeilen** | Exports: Alle Konstanten (siehe [Konfigurationsreferenz](./config.md))

Definiert alle konfigurierbaren Werte: LLM-Modelle, Agent-Definitionen, Gedaechtnis-Limits, Vault-Pfade und System-Einstellungen. Werte koennen ueber Umgebungsvariablen (`.env`) ueberschrieben werden.

---

### `src/queue.ts` — Session-Queue
**20 Zeilen** | Exports: `enqueue(chatId, fn)`

Serialisiert die Verarbeitung pro Chat-ID. Verhindert Race Conditions wenn zwei Nachrichten gleichzeitig ankommen (z.B. doppelte Aufgaben, konkurrierende Datei-Schreibvorgaenge). Automatische Bereinigung der Queue-Map wenn ein Chat idle wird.

---

### `src/format.ts` — Markdown-Konverter
**34 Zeilen** | Exports: `fmt(text)`, `stripMarkdown(text)`

Konvertiert LLM-Markdown-Output zu Telegram-kompatiblem HTML (`<b>`, `<i>`, `<code>`, `<pre>`). Enthalt eine Fallback-Funktion `stripMarkdown()` fuer Plaintext bei Formatierungsfehlern.

---

### `src/logger.ts` — Logging-Modul
**47 Zeilen** | Exports: `logInfo(msg)`, `logError(context, err)`, `readRecentLogs(n)`

Schreibt Logs in `logs/bot.log` mit Zeitstempel (de-AT, Europe/Vienna). Automatische Rotation bei ueber 500 Zeilen. Gibt Logs parallel auf `stdout`/`stderr` aus.

---

### `src/heartbeat.ts` — Cron-Heartbeat
**117 Zeilen** | Exports: `startHeartbeat(replyFn)`, `saveChatId(id)`, `loadChatId()`

Parst `HEARTBEAT.md`-Dateien aller Agenten, registriert Cron-Jobs mit `node-cron`. Fuehrt zur konfigurierten Zeit den Agenten aus und sendet das Ergebnis via Telegram. Stille-Modus: Wenn der Agent mit `[STILL]` antwortet, wird keine Nachricht gesendet.

## LLM-Module

### `src/llm/client.ts` — OpenAI-Client
**29 Zeilen** | Exports: `client`, `getModel()`, `getSubagentModel()`, `isFastMode()`, `setModel(name)`, `toggleFast()`, `buildDateLine()`

Erstellt einen OpenAI-kompatiblen Client der auf Ollama zeigt (`localhost:11434/v1`). Verwaltet das aktive Modell und den Fast-Modus. `buildDateLine()` injiziert das aktuelle Datum in den System-Prompt.

---

### `src/llm/tools.ts` — Tool-Definitionen
**375 Zeilen** | Exports: `TOOLS`

Array aller Tool-Definitionen im OpenAI Function Calling Format (JSON Schema). Jedes Tool hat `name`, `description` und `parameters` mit Typen und Pflichtfeldern. Wird dem LLM bei jedem API-Call uebergeben.

---

### `src/llm/executor.ts` — Tool-Ausfuehrung
**189 Zeilen** | Exports: `executeTool(name, args)`, `setReplyContext(fn)`, `getReplyFn()`, `setCurrentDepth(depth)`, `getCurrentDepth()`, `registerProcessAgent(fn)`

Grosser Switch-Case der alle Tools ausfuehrt. Verwaltet den Reply-Context (fuer async Agents), die Spawn-Tiefe und die spaete Bindung von `processAgent` (um zirkulaere Imports zu vermeiden).

---

### `src/llm/runtime.ts` — Agent Runtime
**111 Zeilen** | Exports: `processAgent(name, msg, mode, depth)`, `processBtw(msg)`, `processMessage(msg)`

Kern des Agentic Loop:
1. Workspace laden (System-Prompt aus MD-Dateien)
2. Gespraechsverlauf laden (letzte 10 Eintraege)
3. LLM aufrufen mit Tools
4. Tool-Calls ausfuehren, Ergebnisse zurueckfuettern
5. Wiederholen bis max. `MAX_TOOL_ROUNDS` (5) erreicht
6. Pruning wenn Buffer zu gross wird
7. Compaction wenn Tageslog zu lang wird

---

### `src/llm/compaction.ts` — Tageslog-Komprimierung
**42 Zeilen** | Exports: `runCompaction(agentName)`, `compactNow(agentName)`

Fasst aeltere Gespraechseintraege per LLM in max. 5 Stichpunkten zusammen. Wird automatisch ausgeloest wenn der Tageslog `COMPACT_THRESHOLD` (8.000 Bytes) ueberschreitet. Die letzten `KEEP_RECENT_LOGS` (5) Eintraege bleiben immer erhalten.

---

### `src/llm/setup.ts` — Setup-Wizard
**86 Zeilen** | Exports: `processSetup(msg)`, `isSetupActive()`, `activateSetup()`, `deactivateSetup()`

Interaktiver Einrichtungsassistent beim ersten Start. Fragt nach Name, Emoji, Charakter, Unternehmenskontext, Benutzername und Unternehmensname. Nutzt ein eigenes Tool `setup_abschliessen` um die Konfiguration zu speichern.

## Vault-Module

### `src/vault/index.ts` — Barrel Re-Export
**21 Zeilen** | Exports: Alle Vault-Funktionen und -Typen

Re-exportiert alle Funktionen aus den einzelnen Vault-Modulen. Einziger Import-Punkt fuer den Rest der Anwendung.

---

### `src/vault/helpers.ts` — Pfad-Utilities
**47 Zeilen** | Exports: `vaultPath`, `ensureDir(dir)`, `sanitizeFilename(name)`, `todayPrefix()`

Grundlegende Hilfsfunktionen: Vault-Pfad aus `VAULT_PATH`, sichere Verzeichniserstellung, Dateinamen-Sanitierung, Datumsprefix im Format `YYYY-MM-DD`.

---

### `src/vault/notes.ts` — Notizen CRUD
**54 Zeilen** | Exports: `saveNote(text, projekt?)`, `listNotes(n?)`, `readNote(name)`, `appendToNote(name, text)`, `deleteNote(name)`

Vollstaendige CRUD-Operationen fuer Notizen. Speichert als Markdown-Dateien in `Inbox/` (oder `Projekte/<name>/`). Dateinamen werden aus dem Inhalt generiert mit Datumsprefix.

---

### `src/vault/tasks.ts` — Aufgaben CRUD
**42 Zeilen** | Exports: `saveTask(text, projekt?)`, `listTasks(projekt?)`, `completeTask(text, projekt?)`

Verwaltet Aufgaben in `Aufgaben.md` (oder `Projekte/<name>/Aufgaben.md`). Format: `- [ ] Text` fuer offen, `- [x] Text` fuer erledigt.

---

### `src/vault/termine.ts` — Termine CRUD
**47 Zeilen** | Exports: `saveTermin(datum, text, uhrzeit?, projekt?)`, `listTermine(projekt?)`, `deleteTermin(text, projekt?)`

Verwaltet Termine in `Termine.md`. Format: `- DD.MM.YYYY [HH:MM] – Beschreibung`.

---

### `src/vault/projects.ts` — Projekt-Verwaltung
**28 Zeilen** | Exports: `listProjects()`, `getProjectInfo(name)`

Listet Unterordner in `Projekte/` auf. Liest `README.md` oder `INFO.md` eines Projekts fuer Detailinfo.

---

### `src/vault/files.ts` — Datei-Operationen
**25 Zeilen** | Exports: `readFile(pfad)`, `createFile(pfad, inhalt)`, `listFolder(pfad?)`

Generische Dateioperationen innerhalb des Vaults. Relativer Pfad wird gegen `VAULT_PATH` aufgeloest.

---

### `src/vault/search.ts` — Vault-Suche
**37 Zeilen** | Exports: `searchVault(term, projekt?)`, Type: `SearchResult`

Durchsucht alle `.md`-Dateien im Vault nach einem Suchbegriff. Gibt Dateiname und Trefferzeile zurueck. Kann auf ein Projekt eingegrenzt werden.

---

### `src/vault/agents.ts` — Agent-Workspace-Verwaltung
**351 Zeilen** | Exports: 20+ Funktionen (siehe unten)

Groesstes Modul. Verwaltet den gesamten Agent-Lebenszyklus:

| Bereich | Funktionen |
|---|---|
| Utilities | `estimateTokens`, `getAgentPath`, `isProtectedAgent`, `listAgents`, `vaultExists`, `getVaultPath` |
| Workspace | `isMainWorkspaceConfigured`, `loadAgentWorkspace`, `createAgentWorkspace`, `finalizeMainWorkspace`, `inspectAgentWorkspace` |
| Konversation | `appendAgentConversation`, `loadAgentHistory`, `clearAgentToday` |
| Memory | `appendAgentMemory` |
| Datei-Editor | `readAgentFile`, `writeAgentFile` |
| Compaction | `shouldCompact`, `getLogForCompaction`, `writeCompactedLog` |

## Commands-Module

### `src/commands/system.ts` — System-Commands
**273 Zeilen** | Exports: 16 Command-Handler

Alle Telegram-Slash-Commands:

| Handler | Command | Beschreibung |
|---|---|---|
| `handleHilfe` | `/hilfe`, `/start` | Hilfetext anzeigen |
| `handleStatus` | `/status` | Bot-Status und Vault-Info |
| `handleKontext` | `/kontext` | Kontext-Auslastung anzeigen |
| `handleKompakt` | `/kompakt` | Tageslog komprimieren |
| `handleNeu` | `/neu` | Gespraechskontext zuruecksetzen |
| `handleCommands` | `/commands` | Alle Commands auflisten |
| `handleWhoami` | `/whoami` | Eigene Chat-ID anzeigen |
| `handleAgents` | `/agents` | Sub-Agents auflisten |
| `handleExportSession` | `/export` | Session-Log als MD exportieren |
| `handleModel` | `/model` | Modell anzeigen/wechseln |
| `handleFast` | `/fast` | Fast-Modus umschalten |
| `handleSprache` | `/sprache` | Whisper-Sprache aendern |
| `handleHeute` | `/heute` | Tages-Briefing |
| `handleConfig` | `/config` | Konfiguration anzeigen |
| `handleRestart` | `/restart` | Bot neu starten |
| `handleLogs` | `/logs` | Letzte Log-Eintraege |

## Zeilenverteilung

| Modul | Zeilen | Anteil |
|---|---|---|
| `vault/agents.ts` | 351 | 16,3% |
| `llm/tools.ts` | 375 | 17,4% |
| `commands/system.ts` | 273 | 12,7% |
| `llm/executor.ts` | 189 | 8,8% |
| `heartbeat.ts` | 117 | 5,4% |
| `bot.ts` | 112 | 5,2% |
| `llm/runtime.ts` | 111 | 5,2% |
| `llm/setup.ts` | 86 | 4,0% |
| Restliche 15 Module | 540 | 25,0% |
| **Gesamt** | **2.154** | **100%** |
