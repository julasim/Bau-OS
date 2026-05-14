# Workspace & Datenschicht

PATIO speichert Daten entweder als Markdown-Dateien in einem lokalen Workspace oder in einer PostgreSQL-Datenbank. Welcher Modus aktiv ist, entscheidet eine einzige Umgebungsvariable — der restliche Code bleibt identisch.

## Zwei Modi — eine Codebasis

### Filesystem-Modus (Standard)

Kein extra Dienst nötig. Alle Daten landen als Markdown-Dateien in dem Ordner, der als `WORKSPACE_PATH` konfiguriert ist. Der Ordner ist direkt in Obsidian verwendbar.

### Datenbank-Modus

Wenn `DATABASE_URL` in `.env` gesetzt ist, schaltet PATIO auf PostgreSQL um. Das ermöglicht strukturierte Abfragen und — wenn `pgvector` installiert ist — semantische KI-Suche. Außerdem werden dann zusätzliche Features wie Bautagebuch, Meetings und Zeiterfassung aktiviert, die im Filesystem-Modus nicht verfügbar sind.

```env
# Filesystem-Modus (Standard — keine Zeile nötig)

# Datenbank-Modus (PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/bauos
```

## Workspace-Struktur (Filesystem-Modus)

```
WORKSPACE_PATH/
├── Agents/
│   └── Main/
│       ├── IDENTITY.md       ← Name, Persönlichkeit
│       ├── SOUL.md           ← Kernwerte und Charakter
│       ├── BOOT.md           ← System-Prompt (Startkontext)
│       ├── USER.md           ← Informationen über den Nutzer
│       ├── AGENTS.md         ← Sub-Agenten-Konfiguration
│       ├── TOOLS.md          ← Tool-Beschreibungen
│       ├── MEMORY.md         ← Langzeit-Notizen des Agents
│       ├── HEARTBEAT.md      ← Proaktive Aufgaben (Scheduler)
│       └── MEMORY_LOGS/
│           └── 2026-05-11.md ← Tageslog (ein File pro Tag)
├── Inbox/                    ← Notizen
├── Projekte/                 ← Projektordner
└── Uploads/                  ← Hochgeladene Dateien (FS-Modus)
```

::: tip Tageslog-Pfad
Der Tageslog liegt in `Agents/<Name>/MEMORY_LOGS/` — eine Datei pro Tag, benannt nach dem Datum (`YYYY-MM-DD.md`). Compaction (`/kompakt`) fasst ältere Einträge zusammen und behält die letzten `KEEP_RECENT_LOGS` Einträge immer vollständig.
:::

### Agent-Konfigurationsdateien

Alle Markdown-Dateien im Agent-Ordner sind zur Laufzeit editierbar — kein Neustart nötig. Der nächste Agenten-Aufruf liest die geänderten Dateien automatisch ein.

| Datei | Zweck |
|---|---|
| `IDENTITY.md` | Name, Emoji, grundlegende Selbstbeschreibung |
| `SOUL.md` | Werte, Stil, Kommunikationsregeln |
| `BOOT.md` | Erster Systemkontext — was der Agent beim Start "weiß" |
| `USER.md` | Nutzerpräferenzen und Hintergrundinformationen |
| `AGENTS.md` | Konfiguration für Sub-Agenten |
| `TOOLS.md` | Welche Tools der Agent bevorzugt und wie |
| `MEMORY.md` | Langzeitgedächtnis — persistent über Tage |
| `HEARTBEAT.md` | Proaktive Routinen (z.B. Morgen-Briefing) |

## Datenbank-Modus

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/bauos
```

Sobald `DATABASE_URL` gesetzt ist:

- PostgreSQL wird beim Start verbunden und auf Erreichbarkeit geprüft
- Migrationen laufen automatisch (`DB_AUTO_MIGRATE=true` ist Standard)
- Alle Entitäten (Aufgaben, Termine, Notizen, Projekte, Team) werden in Postgres gespeichert
- `pgvector` ist optional — wenn vorhanden, ist semantische Suche aktiv; wenn nicht, fällt PATIO auf Volltext-Suche zurück
- Zusätzliche Features werden freigeschaltet: Bautagebuch, Meeting-Protokolle, Zeiterfassung

**Supabase** kann zusätzlich aktiviert werden, um Realtime-Events in den Bot zu bridgen:

```env
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_ANON_KEY=...
```

::: warning Chat-History und Agent-Logs
Agent-Tageslog (`agentLogRepo`) liegt **immer** im Filesystem — unabhängig vom gewählten Modus. Das ist eine bewusste Design-Entscheidung: JSONL-Dateien lassen sich einfach per `tail`/`grep` überwachen und sind nicht von der Datenbankverbindung abhängig.

Chat-Verläufe (`chatRepo`) hingegen folgen dem gewählten Modus: Filesystem im FS-Modus, PostgreSQL im DB-Modus.
:::

## Automatische Wahl — Repository-Factory

`src/data/index.ts` ist die einzige Import-Schnittstelle für Persistenz. Sie wählt automatisch die richtige Implementierung:

```typescript
export const taskRepo: TaskRepository        = DB_ENABLED ? dbTasks      : fsTasks;
export const terminRepo: TerminRepository    = DB_ENABLED ? dbTermine    : fsTermine;
export const noteRepo: NoteRepository        = DB_ENABLED ? dbNotes      : fsNotes;
export const projectRepo: ProjectRepository  = DB_ENABLED ? dbProjects   : fsProjects;
export const teamRepo: TeamRepository        = DB_ENABLED ? dbTeam       : fsTeam;
export const fileRepo: FileRepository | null = DB_ENABLED ? dbFiles      : null;
export const chatRepo: ChatRepository        = DB_ENABLED ? dbChat       : fsChat;

// Nur im DB-Modus verfügbar — kein FS-Fallback:
export const bautagebuchRepo: BautagebuchRepository | null = DB_ENABLED ? dbBautagebuch : null;
export const meetingRepo: MeetingRepository | null         = DB_ENABLED ? dbMeetings    : null;
export const timeEntryRepo: TimeEntryRepository | null     = DB_ENABLED ? dbTimeEntries : null;

// Immer Filesystem — unabhängig vom Modus:
export const agentLogRepo: AgentLogRepository = fsAgentLogs;
```

Jedes Repository hat zwei Implementierungen (`db-*.ts` und `fs-*.ts`) die dieselbe TypeScript-Schnittstelle aus `src/data/types.ts` erfüllen. Direktimporte aus `db-*` oder `fs-*` außerhalb der Data-Layer sind nicht erlaubt.

## Features nach Modus

| Feature | Filesystem | PostgreSQL |
|---|---|---|
| Notizen, Aufgaben, Termine | Ja | Ja |
| Projekte, Team | Ja | Ja |
| Chat-Verlauf | Ja (JSONL) | Ja (DB) |
| Agent-Tageslog | Ja (immer FS) | Ja (immer FS) |
| Datei-Index (`fileRepo`) | Nein | Ja |
| Bautagebuch | Nein | Ja |
| Meeting-Protokolle | Nein | Ja |
| Zeiterfassung | Nein | Ja |
| Semantische Suche | Nein | Ja (mit pgvector) |

## Volltextsuche vs. Semantische Suche

| Modus | Tool | Funktionsweise |
|---|---|---|
| Filesystem | `vault_suchen` | Volltext — durchsucht Dateinamen und Dateiinhalte |
| PostgreSQL ohne pgvector | `vault_suchen` | Postgres-Volltextsuche (`tsvector`) |
| PostgreSQL + pgvector | `semantisch_suchen` | KI-basiert — versteht Bedeutung, nicht nur Wörter |

Die semantische Suche verwendet Embeddings (Standard: `text-embedding-3-small` bei OpenAI, `nomic-embed-text` bei Ollama). Wenn pgvector fehlt oder kein Embedding-Modell verfügbar ist, fällt das System automatisch auf Volltext-Suche zurück.

## Wann welchen Modus?

**Filesystem-Modus** — sinnvoll wenn:
- Einzelnutzer ohne Multi-User-Anforderungen
- Kein extra Dienst (Postgres) betrieben werden soll
- Obsidian-Integration und direkter Dateizugriff gewünscht ist
- Kein Bedarf an semantischer Suche, Bautagebuch oder Zeiterfassung

**Datenbank-Modus** — sinnvoll wenn:
- Mehrere Nutzer gleichzeitig arbeiten (Multi-User)
- Semantische KI-Suche genutzt werden soll
- Die Web-UI (`JWT_SECRET` gesetzt) produktiv eingesetzt wird
- Bautagebuch, Meeting-Protokolle oder Zeiterfassung benötigt werden

## Zugriff durch den Agent

| Tool | Funktion |
|---|---|
| `notiz_speichern` | Neue Notiz erstellen |
| `notiz_bearbeiten` | Nachtrag an bestehende Notiz |
| `notiz_loeschen` | Notiz löschen |
| `aufgabe_speichern` | Neue Aufgabe erstellen |
| `aufgabe_erledigen` | Aufgabe als erledigt markieren |
| `termin_speichern` | Neuen Termin erstellen |
| `termin_loeschen` | Termin löschen |
| `vault_suchen` | Volltext- oder Postgres-Suche |
| `semantisch_suchen` | KI-Suche (nur mit pgvector) |
| `datei_lesen` | Beliebige Datei lesen |
| `datei_erstellen` | Neue Datei erstellen |
| `ordner_auflisten` | Ordnerinhalt auflisten |
