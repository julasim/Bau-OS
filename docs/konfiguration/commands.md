# Slash-Befehle

Bau-OS bietet eine Reihe von Slash-Befehlen, die du direkt im Telegram-Chat verwenden kannst. Tippe `/` um die Befehlsliste zu sehen.

## Übersicht

| Befehl | Beschreibung |
|---|---|
| `/hilfe` | Alle Commands anzeigen |
| `/commands` | Identisch mit `/hilfe` |
| `/heute` | Tagesbericht (Termine + Aufgaben) |
| `/status` | Systemstatus und LLM-Verbindung |
| `/kontext` | Kontext-Auslastung (Zeichen/Limit) |
| `/kompakt` | Tageslog jetzt komprimieren |
| `/neu` | Gesprächskontext zurücksetzen |
| `/whoami` | Chat-ID und Benutzerinfo |
| `/agents` | Sub-Agenten auflisten |
| `/export` | Session-Log als Markdown exportieren |
| `/model [name]` | Modell anzeigen oder wechseln |
| `/fast` | Fast-Modell umschalten |
| `/sprache [de\|en\|auto]` | Whisper-Sprache für Sprachnachrichten |
| `/config` | Konfiguration anzeigen |
| `/restart` | Bot neu starten |
| `/logs [n]` | Letzte Log-Einträge anzeigen |
| `/btw <nachricht>` | Direktantwort ohne Tools und ohne Log-Eintrag |

## Befehle im Detail

### /hilfe

Zeigt eine Übersicht aller verfügbaren Slash-Befehle mit kurzer Beschreibung.

```
/hilfe
```

::: tip
Identisch mit `/commands` — beide zeigen dieselbe Befehlsliste an.
:::

### /heute

Erstellt einen Tagesbericht basierend auf dem aktuellen Datum. Der Agent liest den Workspace, fasst offene Aufgaben und heutige Termine zusammen und gibt einen strukturierten Überblick.

```
/heute
```

**Intern:** Startet einen vollständigen Agenten-Durchlauf mit einem fest kodierten Briefing-Prompt. Läuft mit dem Main-Agent inklusive aller konfigurierten Tools.

### /status

Zeigt den aktuellen Systemstatus: Workspace erreichbar, Pfad, Anzahl Notizen in der Inbox, offene Aufgaben, Whisper-Sprache und Python-Pfad.

```
/status
```

**Intern:** Prüft, ob der Workspace-Pfad existiert und liest Basis-Statistiken daraus. Im OpenAI-Modus erscheint die konfigurierte API-URL, im Ollama-Modus die Ollama-URL.

### /kontext

Zeigt die aktuelle Kontext-Auslastung des Main-Agents: wie viele Zeichen jede Workspace-Datei belegt, ob Dateien abgeschnitten wurden und wie viel des Limits (`WS_MAX_TOTAL_CHARS` = 150.000 Zeichen) bereits verbraucht ist.

```
/kontext
```

**Intern:** Ruft `inspectAgentWorkspace("Main", "full")` auf und aggregiert die Zeichenanzahl aller geladenen Dateien.

### /kompakt

Komprimiert den heutigen Tageslog sofort per LLM-Zusammenfassung. Die letzten `KEEP_RECENT_LOGS` (= 5) Einträge bleiben immer erhalten; ältere werden in eine kompakte Zusammenfassung am Anfang des Logs überführt.

```
/kompakt
```

**Intern:** Ruft `compactNow("Main")` aus `src/llm/compaction.ts` auf. Auto-Compaction greift ab `COMPACT_THRESHOLD` = 8.000 Zeichen.

### /neu

Setzt den heutigen Gesprächskontext des Main-Agents zurück, indem der aktuelle Tageslog gelöscht wird.

```
/neu
```

**Intern:** Ruft `clearAgentToday("Main")` auf — löscht die heutige Log-Datei unter `Agents/Main/MEMORY_LOGS/<datum>.md`. Vault-Inhalte (Notizen, Aufgaben, Termine) bleiben unverändert.

::: warning
Der aktuelle Gesprächsverlauf des Tages geht verloren. Der Agent startet beim nächsten Aufruf ohne Erinnerung an die bisherige Session.
:::

### /whoami

Zeigt Informationen zum aktuellen Telegram-Nutzer — Chat-ID, Username und Name.

```
/whoami
```

**Intern:** Liest die Telegram-Benutzerinformationen direkt aus dem grammY-Kontext.

### /agents

Listet alle Sub-Agenten auf, die unter `Agents/` im Workspace konfiguriert sind (ohne Main). Zeigt an, ob der Agent heute bereits aktiv war (d.h. ob ein Tageslog existiert).

```
/agents
```

**Intern:** Liest den `Agents/`-Ordner aus und prüft, ob für den heutigen Tag ein Log existiert.

### /export

Exportiert den heutigen Gesprächsverlauf als Markdown-Datei in den Ordner `Exports/` im Workspace.

```
/export
```

Gibt den Exportpfad als Bestätigung zurück, z.B. `Exports/session_2026-05-11.md`.

### /model [name]

Zeigt das aktive LLM-Modell oder wechselt es zur Laufzeit.

```bash
# Aktuelles Modell anzeigen
/model

# Modell wechseln
/model qwen2.5:14b

# OpenAI-Modus: Cloud-Modell wechseln
/model gpt-4o-mini
```

**Intern:** Setzt den Runtime-Override in `config.ts` via `setRuntimeMainModel()`. Gilt nur für den Main-Agent und nur für die aktuelle Laufzeit.

### /fast

Schaltet den Fast-Modus um. Im Fast-Modus verwendet der Main-Agent das Modell aus `OLLAMA_FAST_MODEL` (oder `gpt-4o-mini` im OpenAI-Modus).

```
/fast
```

Erneutes `/fast` schaltet zurück zum Standardmodell.

::: tip
Im Fast-Modus zeigt der Bot ein Blitz-Symbol in der Bestätigung. `/model` ohne Parameter zeigt immer, welches Modell gerade aktiv ist.
:::

### /sprache [de|en|auto]

Setzt die Whisper-Erkennungssprache für Sprachnachrichten.

```
/sprache de
/sprache en
/sprache auto
```

`auto` lässt Whisper die Sprache selbst erkennen — etwas langsamer, aber nützlich bei gemischten Nachrichten.

**Intern:** Setzt `process.env.WHISPER_LANG` für die laufende Session.

### /config

Gibt die aktuelle Konfiguration aus — Bot-Token (maskiert), Workspace-Pfad, Ollama-URL und aktives Modell.

```
/config
```

::: warning
Sensible Werte wie das Bot-Token werden nicht im Klartext angezeigt — nur die ersten und letzten Zeichen.
:::

### /restart

Startet den Bot-Prozess neu. Nützlich nach Änderungen an Agent-Konfigurationsdateien, wenn der Neustart schneller sein soll als das Warten auf den nächsten Request.

```
/restart
```

::: warning
Ein Restart unterbricht laufende Operationen. Der Bot ist für einige Sekunden nicht erreichbar.
:::

### /logs [n]

Zeigt die letzten `n` Zeilen aus der Bot-Logdatei (`logs/bot.log`). Standard: 20 Zeilen, Maximum: 50 Zeilen.

```bash
# Standard: 20 Einträge
/logs

# Explizite Anzahl
/logs 50
```

**Intern:** Liest aus `logs/bot.log` via `readRecentLogs(n)`. Ausgabe wird auf `LOG_DISPLAY_MAX_CHARS` (= 3.800 Zeichen) begrenzt.

### /btw \<nachricht\>

Stellt dem LLM eine direkte Frage — ohne Tool-Nutzung, ohne Eintrag in den Tageslog. Der Kontext der laufenden Session wird nicht beeinflusst.

```
/btw Was ist der Unterschied zwischen Bruttofläche und Nutzfläche?
/btw Übersetze "Baugenehmigung" ins Englische
```

**Intern:** Startet einen einzelnen LLM-Call via `processBtw()` — kein Agentic Loop, keine Tool-Calls, kein Log-Schreiben. Ideal für schnelle Nebenfragen, die nicht in der Gesprächshistorie landen sollen.

::: tip
`/btw` ist perfekt für einmalige Wissensfragen, die den Agent-Kontext nicht "verschmutzen" sollen — z.B. schnelle Übersetzungen oder Definitionen mitten in einem komplexen Workflow.
:::

## Eigene Befehle

Slash-Befehle sind in `src/commands/system.ts` implementiert und in `src/bot.ts` registriert. Um eigene Befehle hinzuzufügen, siehe [Anpassung](./anpassung).
