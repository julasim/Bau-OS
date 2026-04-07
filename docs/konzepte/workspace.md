# Agent Workspace

Jeder Agent hat einen eigenen Ordner mit 10 Markdown-Dateien. Zusammen bilden sie das "Gehirn" des Agenten.

## Uebersicht

```
Agents/Main/
├── IDENTITY.md      ← Wer bin ich?
├── SOUL.md          ← Wie bin ich?
├── BOOT.md          ← Grundregeln bei jedem Gespraech
├── BOOTSTRAP.md     ← Ersteinrichtung (wird danach geloescht)
├── AGENTS.md        ← Betriebsanweisungen & Limits
├── USER.md          ← Benutzerprofil
├── TOOLS.md         ← Tool-Konventionen
├── MEMORY.md        ← Langzeitgedaechtnis
├── HEARTBEAT.md     ← Cron-basierte Erinnerungen
└── MEMORY_LOGS/     ← Tages-Gespraechsprotokolle
    ├── 2026-04-07.md
    └── 2026-04-06.md
```

## Welche Datei wann geladen wird

| Datei | full-Modus | minimal-Modus |
|---|---|---|
| IDENTITY.md | Ja | Ja |
| SOUL.md | Ja | Ja |
| BOOT.md | Ja | Ja |
| USER.md | Ja | — |
| AGENTS.md | Ja | — |
| TOOLS.md | Ja | — |
| MEMORY.md | Ja | — |
| HEARTBEAT.md | Ja | — |
| BOOTSTRAP.md | Nur beim allerersten Start | — |
| MEMORY_LOGS/ (heute) | Ja | — |

**full-Modus:** Der Main Agent — bekommt den kompletten Kontext.
**minimal-Modus:** Sub-Agents — nur das Noetigste fuer fokussierte Aufgaben.

## Lade-Reihenfolge

Die Dateien werden in dieser Reihenfolge als System-Prompt zusammengesetzt:

1. `Heute ist: Montag, 7. April 2026` ← einzige Code-Injektion
2. IDENTITY.md
3. SOUL.md
4. BOOT.md
5. USER.md
6. AGENTS.md
7. TOOLS.md
8. MEMORY.md
9. HEARTBEAT.md
10. BOOTSTRAP.md (nur beim Erststart)
11. Tageslog aus MEMORY_LOGS/

## Limits

| Parameter | Wert |
|---|---|
| Max. Zeichen pro Datei | 20.000 |
| Max. Zeichen gesamt (alle Dateien) | 150.000 |
| Dateien die das Limit ueberschreiten | Werden gekuerzt mit Hinweis |
| Dateien die das Gesamtbudget sprengen | Werden nicht geladen (Warnung im Log) |

## Dateien editieren

Agent-Dateien koennen auf drei Wegen geaendert werden:

1. **Per LLM-Tool:** "Aendere meine SOUL.md so dass du formeller antwortest"
2. **Per Texteditor:** Die Dateien direkt im Obsidian Vault oeffnen und bearbeiten
3. **Per `/config` Command:** Zeigt die aktuelle Konfiguration an (read-only)

Aenderungen werden beim naechsten Gespraech sofort wirksam — kein Neustart noetig.

::: tip Tipp
Jede Datei ist einzeln dokumentiert unter [Agenten-Dateien](/agenten/identity).
:::
