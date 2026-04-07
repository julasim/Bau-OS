# Architektur

Bau-OS besteht aus vier Schichten: **Telegram** (Interface), **Agent Runtime** (Logik), **LLM** (Intelligenz) und **Obsidian Vault** (Speicher).

## Datenfluss

```
[Telegram Bot (grammY)]
        |
        v
[Session Queue — serialisiert pro Chat-ID]
        |
        v
[processAgent(name, msg, mode, depth)]
        |                    |
        v                    v
[Main Agent]         [Sub-Agents (depth <= 2)]
  10 MD-Dateien        eigener Workspace
  MEMORY_LOGS/         minimal-Modus
        |
        v
[Ollama / LLM API (OpenAI-kompatibler Client)]
        |
        v
[Obsidian Vault (plain .md Filesystem)]
```

### Ablauf einer Nachricht

1. **Telegram** empfängt die Nachricht
2. **Session Queue** reiht sie ein (eine Nachricht pro Chat-ID gleichzeitig)
3. **Agent Runtime** lädt den Workspace (MD-Dateien) als System-Prompt
4. **LLM** generiert eine Antwort — evtl. mit Tool-Aufrufen
5. **Tools** führen Aktionen aus (Notiz speichern, Termin anlegen, etc.)
6. **Antwort** geht zurück an Telegram

## Modulstruktur

```
src/
|-- index.ts              Einstiegspunkt — Bot starten + Heartbeat
|-- bot.ts                Telegram-Bot: Commands, Nachrichten-Routing
|-- config.ts             Zentrale Konfiguration (Konstanten + Pfade)
|-- format.ts             Markdown → Telegram HTML Konverter
|-- queue.ts              Message-Serialisierung pro Chat-ID
|-- logger.ts             File-Logging (bot.log, max 500 Zeilen)
|-- heartbeat.ts          Cron-basierte periodische Agent-Runs
|-- commands/
|   +-- system.ts         Alle /slash-Commands
|-- llm/
|   |-- client.ts         OpenAI-Client, Model-State, buildDateLine()
|   |-- tools.ts          28 Tool-Definitionen (JSON-Schema)
|   |-- executor.ts       Tool-Ausführung (Switch-Case)
|   |-- runtime.ts        Agent-Loop: processAgent(), processBtw()
|   |-- compaction.ts     Log-Komprimierung
|   +-- setup.ts          Setup-Wizard + State
+-- vault/
    |-- helpers.ts        Shared Utilities (Pfade, Frontmatter)
    |-- notes.ts          Notizen-CRUD
    |-- tasks.ts          Aufgaben-CRUD
    |-- termine.ts        Termine-CRUD
    |-- projects.ts       Projekte (list, getInfo)
    |-- files.ts          Datei-Operationen
    |-- search.ts         Vault-Volltextsuche
    |-- agents.ts         Agent-Workspace-Management
    +-- index.ts          Barrel Re-Exports
```

Keine Datei hat mehr als 200 Zeilen. Jede hat eine klare Verantwortlichkeit.

## Stack

| Komponente | Technologie |
|---|---|
| **Bot Framework** | grammY (TypeScript) |
| **Runtime** | Node.js, tsx watch (dev), tsc (prod) |
| **LLM** | Ollama lokal (OpenAI-kompatibler Client) |
| **Brain** | Obsidian Vault (Filesystem, plain .md) |
| **Scheduling** | node-cron (Europe/Vienna) |
| **Deployment** | Hetzner VPS pro Kunde (EU, DSGVO) |

## Design-Prinzipien

### Markdown First
Alle Daten und Konfigurationen sind Markdown-Dateien. Kein proprietäres Format, keine Datenbank. Alles ist menschlich lesbar und mit jedem Texteditor änderbar.

### Verhalten in Dateien, nicht in Code
Der Code injiziert nur das heutige Datum. Alles andere — Sprache, Ton, Stil, Regeln, Tool-Konventionen — kommt aus den Agent-MD-Dateien. Änderungen am Verhalten erfordern keinen Code-Eingriff.

### Pro Kunde eine Instanz
Keine geteilte Infrastruktur. Jeder Kunde bekommt einen eigenen Server, eigenen Vault, eigene Konfiguration. Vollständige Datenisolation.
