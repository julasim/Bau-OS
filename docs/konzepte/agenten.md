# Multi-Agent System

Bau-OS arbeitet mit mehreren KI-Agenten. Jeder Agent hat eine eigene Persoenlichkeit, eigene Regeln und ein eigenes Gedaechtnis.

## Main Agent vs. Sub-Agents

| Eigenschaft | Main Agent | Sub-Agents |
|---|---|---|
| **Kommunikation** | Spricht direkt mit dem Benutzer | Arbeitet im Hintergrund |
| **Modus** | `full` — alle 10 Dateien geladen | `minimal` — nur IDENTITY + SOUL + BOOT |
| **History** | Letzte 10 Gespraeche geladen | Kein Gespraechsverlauf |
| **Geschuetzt** | Kann nicht geloescht werden | Kann geloescht/ueberschrieben werden |
| **Heartbeat** | Hat Cron-basierte Erinnerungen | Kein Heartbeat |

## Wie Agents kommunizieren

```
Benutzer → Main Agent
              |
              |-- (braucht Hilfe bei Kalkulation)
              |
              +→ spawnt "Kalkulator" Sub-Agent
                    |
                    +→ Ergebnis zurueck an Main Agent
                          |
                          +→ Main Agent antwortet dem Benutzer
```

Der Main Agent entscheidet selbst wann er einen Sub-Agent braucht. Er nutzt dafuer die Tools `agent_spawnen` (synchron) oder `agent_spawnen_async` (asynchron).

## Spawn-Tiefe

Sub-Agents koennen **keine weiteren Agents spawnen**. Die maximale Tiefe ist 2:

```
Main Agent (depth 0) → Sub-Agent (depth 1) → STOP
```

Das verhindert unkontrollierte Rekursion.

## Session Queue

Jede Chat-ID hat eine eigene Warteschlange. Wenn zwei Nachrichten gleichzeitig eintreffen, wird die zweite erst verarbeitet wenn die erste fertig ist.

```
Nachricht 1 → [Queue] → Agent verarbeitet → Antwort
Nachricht 2 → [Queue] → wartet...        → Agent verarbeitet → Antwort
```

Das verhindert Race Conditions und sorgt fuer konsistente Antworten.

## Agent erstellen

Neue Agents werden ueber das LLM-Tool `agent_erstellen` angelegt:

> "Erstelle einen Kalkulator-Agent der bei Kostenberechnungen hilft"

Das erstellt automatisch einen neuen Ordner `Agents/Kalkulator/` mit allen 10 Workspace-Dateien.

## Geschuetzte Agents

Der Main Agent ist geschuetzt — er kann nicht geloescht oder ueberschrieben werden. Alle anderen Agents koennen frei erstellt und geloescht werden.

## Tool-Runden

Pro Anfrage kann ein Agent maximal **5 Tool-Aufrufe** machen. Danach gibt er eine Antwort, auch wenn die Aufgabe nicht vollstaendig erledigt ist. Das verhindert Endlosschleifen.
