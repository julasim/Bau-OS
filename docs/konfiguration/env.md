# Umgebungsvariablen (.env)

Alle Einstellungen werden ueber eine `.env`-Datei im Projekt-Root gesteuert. Bau-OS laedt diese automatisch beim Start via `dotenv`.

## Uebersicht

| Variable | Pflicht | Standardwert | Beschreibung |
|---|---|---|---|
| `BOT_TOKEN` | Ja | — | Telegram Bot Token von [@BotFather](https://t.me/BotFather) |
| `VAULT_PATH` | Ja | — | Absoluter Pfad zum Obsidian Vault |
| `OLLAMA_BASE_URL` | Nein | `http://localhost:11434/v1` | Basis-URL der Ollama-API |
| `OLLAMA_MODEL` | Nein | `qwen2.5:7b` | Standard-Modell fuer den Haupt-Agenten |
| `OLLAMA_FAST_MODEL` | Nein | Wert von `OLLAMA_MODEL` | Schnelles Modell fuer einfache Aufgaben |
| `OLLAMA_SUBAGENT_MODEL` | Nein | Wert von `OLLAMA_MODEL` | Modell fuer Sub-Agenten |

## Pflicht-Variablen

### BOT_TOKEN

Das Telegram Bot Token erhaeltst du vom [@BotFather](https://t.me/BotFather). Ohne dieses Token kann der Bot nicht starten.

```bash
BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

::: warning Sicherheitshinweis
Das Bot Token ist ein Geheimnis. Teile es nicht oeffentlich und committe die `.env`-Datei niemals in ein Git-Repository. Die `.gitignore` schliesst `.env` bereits aus.
:::

### VAULT_PATH

Der absolute Pfad zu deinem Obsidian Vault. Hier speichert Bau-OS Agent-Dateien, Tagesberichte und Erinnerungen.

```bash
# Windows
VAULT_PATH=C:\Users\max\Documents\MeinVault

# macOS / Linux
VAULT_PATH=/home/max/MeinVault
```

::: tip
Der Vault muss bereits existieren. Bau-OS erstellt die Unterordner `Agents/` und `Inbox/` automatisch beim ersten Start.
:::

## LLM-Konfiguration

### OLLAMA_BASE_URL

Die Basis-URL der Ollama-API. Nur aendern, wenn Ollama auf einem anderen Rechner oder Port laeuft.

```bash
# Standard (lokal)
OLLAMA_BASE_URL=http://localhost:11434/v1

# Remote-Server
OLLAMA_BASE_URL=http://192.168.1.50:11434/v1
```

### OLLAMA_MODEL

Das Haupt-Modell, das fuer alle Agenten verwendet wird. Muss in Ollama bereits heruntergeladen sein.

```bash
OLLAMA_MODEL=qwen2.5:7b
```

### OLLAMA_FAST_MODEL

Ein optionales schnelleres Modell fuer einfache Aufgaben wie Zusammenfassungen oder kurze Antworten. Wird ueber den `/fast`-Befehl aktiviert.

```bash
OLLAMA_FAST_MODEL=qwen2.5:3b
```

Wenn nicht gesetzt, wird das Standardmodell (`OLLAMA_MODEL`) verwendet.

### OLLAMA_SUBAGENT_MODEL

Das Modell, das fuer Sub-Agenten verwendet wird. Kann ein leichteres Modell sein, um Ressourcen zu sparen.

```bash
OLLAMA_SUBAGENT_MODEL=qwen2.5:3b
```

## Beispiel .env

Eine vollstaendige `.env`-Datei sieht so aus:

```bash
# Pflicht
BOT_TOKEN=7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAULT_PATH=/home/max/ObsidianVault

# Optional — LLM
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_FAST_MODEL=qwen2.5:3b
OLLAMA_SUBAGENT_MODEL=qwen2.5:3b
```

## Fest konfigurierte Werte

Die folgenden Werte sind in `src/config.ts` definiert und nicht ueber Umgebungsvariablen aenderbar:

| Konstante | Wert | Beschreibung |
|---|---|---|
| `MAX_TOOL_ROUNDS` | `5` | Max. Iterationen im Agentic Loop |
| `MAX_SPAWN_DEPTH` | `2` | Max. Tiefe fuer Sub-Agent-Erzeugung |
| `MAX_HISTORY_CHARS` | `60000` | Pruning-Grenze fuer den Message-Buffer |
| `COMPACT_THRESHOLD` | `8000` | Ab dieser Laenge wird das Tageslog komprimiert |
| `KEEP_RECENT_LOGS` | `5` | Anzahl der letzten Log-Eintraege die erhalten bleiben |
| `HISTORY_LOAD_LIMIT` | `10` | Gespraechseintraege die beim Start geladen werden |
| `TIMEZONE` | `Europe/Vienna` | Zeitzone fuer alle Datums-Operationen |
| `LOCALE` | `de-AT` | Locale fuer Formatierungen |
| `LANGUAGE` | `Deutsch` | Sprache fuer LLM-Antworten |

::: tip Werte anpassen
Um diese Werte zu aendern, bearbeite `src/config.ts` direkt und starte den Bot neu. Ein Rebuild ist nach Aenderungen noetig (`npm run build`).
:::
