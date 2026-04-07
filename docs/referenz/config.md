# Konfigurationsreferenz

Alle Konstanten aus `src/config.ts`. Werte mit `.env`-Spalte können über Umgebungsvariablen überschrieben werden.

## LLM

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | `OLLAMA_BASE_URL` | URL der Ollama-API (OpenAI-kompatibel) |
| `DEFAULT_MODEL` | `qwen2.5:7b` | `OLLAMA_MODEL` | Standard-LLM-Modell für den Main-Agent |
| `FAST_MODEL` | = `DEFAULT_MODEL` | `OLLAMA_FAST_MODEL` | Modell im Fast-Modus (`/fast`) |
| `SUBAGENT_MODEL` | = `DEFAULT_MODEL` | `OLLAMA_SUBAGENT_MODEL` | Modell für Sub-Agenten (minimal-Modus) |
| `MAX_TOOL_ROUNDS` | `5` | — | Maximale Iterationen im Agentic Loop |

::: tip Modell zur Laufzeit wechseln
Mit `/model <name>` kann das Modell im laufenden Betrieb gewechselt werden, ohne `.env` zu ändern oder den Bot neu zu starten.
:::

### Beispiel `.env`

```env
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_FAST_MODEL=qwen2.5:3b
OLLAMA_SUBAGENT_MODEL=qwen2.5:3b
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
    model: DEFAULT_MODEL,   // LLM-Modell
    protected: true,        // Loeschgeschuetzt
    description: "Haupt-Agent"
  },
];
```

Weitere Agenten werden zur Laufzeit via `agent_erstellen` erzeugt und im Vault unter `Agents/<name>/` gespeichert.

## Gedächtnis

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_HISTORY_CHARS` | `60.000` | Pruning-Grenze für den Message-Buffer im Agentic Loop |
| `COMPACT_THRESHOLD` | `8.000` | Tageslog-Größe (Bytes) ab der automatisch komprimiert wird |
| `KEEP_RECENT_LOGS` | `5` | Letzte N Log-Einträge bleiben bei Compaction immer erhalten |
| `HISTORY_LOAD_LIMIT` | `10` | Anzahl Gesprächseintraege die beim Start geladen werden |

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

## Vault / Obsidian

| Konstante | Standardwert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `VAULT_PATH` | — (Pflicht) | `VAULT_PATH` | Absoluter Pfad zum Obsidian Vault |
| `VAULT_INBOX` | `"Inbox"` | — | Ordnername für Notizen |
| `VAULT_AGENTS_DIR` | `"Agents"` | — | Ordnername für Agent-Workspaces |
| `VAULT_LOGS_DIR` | `"MEMORY_LOGS"` | — | Ordnername für Tageslog-Dateien |

### Vault-Struktur

```
vault/
├── Inbox/                    # Notizen (notiz_speichern)
├── Aufgaben.md               # Globale Aufgabenliste
├── Termine.md                # Globale Terminliste
├── Projekte/                 # Projektordner
│   └── <Projektname>/
│       ├── README.md
│       ├── Aufgaben.md
│       └── Termine.md
├── Agents/
│   ├── Main/                 # Haupt-Agent
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   ├── BOOT.md
│   │   ├── USER.md
│   │   ├── TOOLS.md
│   │   ├── AGENTS.md
│   │   ├── MEMORY.md
│   │   ├── HEARTBEAT.md
│   │   ├── BOOTSTRAP.md      # Wird nach erstem Gespräch gelöscht
│   │   └── MEMORY_LOGS/
│   │       ├── 2026-04-06.md
│   │       └── 2026-04-07.md
│   └── <SubAgent>/
│       └── ...
└── Exports/                  # Session-Exporte (/export)
```

### Abgeleitete Pfad-Funktionen

| Funktion | Ergebnis |
|---|---|
| `agentsPath()` | `VAULT_PATH/Agents` |
| `agentPath(name)` | `VAULT_PATH/Agents/<name>` |
| `logsPath(name)` | `VAULT_PATH/Agents/<name>/MEMORY_LOGS` |

## System

| Konstante | Wert | `.env`-Variable | Beschreibung |
|---|---|---|---|
| `TIMEZONE` | `"Europe/Vienna"` | — | Zeitzone für Cron-Jobs und Timestamps |
| `LOCALE` | `"de-AT"` | — | Locale für Datums- und Zeitformatierung |
| `LANGUAGE` | `"Deutsch"` | — | Sprache des Assistenten |
| `CHAT_ID_FILE` | `<cwd>/.chat_id` | — | Pfad zur Chat-ID-Datei |
| `LOG_FILE` | `<cwd>/logs/bot.log` | — | Pfad zur Log-Datei |

### Interne Konstanten (vault/agents.ts)

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_FILE_CHARS` | `20.000` | Maximale Zeichenanzahl pro Workspace-Datei (Truncation) |
| `MAX_TOTAL_CHARS` | `150.000` | Maximales Gesamtbudget für den System-Prompt |
| `MAX_LINES` (logger) | `500` | Maximale Zeilen in `bot.log` (Rotation) |
| `EDITABLE_AGENT_FILES` | 9 Dateien | Whitelist für `agent_datei_schreiben` |

### Pflicht-Umgebungsvariablen

```env
# Beide sind Pflicht — ohne sie startet der Bot nicht
BOT_TOKEN=<telegram-bot-token>
VAULT_PATH=/pfad/zum/obsidian/vault
```

::: warning Fehlende Variablen
Wenn `BOT_TOKEN` oder `VAULT_PATH` fehlen, wirft `src/index.ts` sofort einen Fehler und der Bot startet nicht.
:::
