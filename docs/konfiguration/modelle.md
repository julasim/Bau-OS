# Modelle & LLM-Konfiguration

Bau-OS unterstützt Ollama (lokal) und OpenAI-kompatible Cloud-APIs. Die Wahl erfolgt automatisch anhand von `OPENAI_API_KEY`.

## LLM-Backend wählen

```bash
# OpenAI-Modus — gesetzt sobald der Key vorhanden ist
OPENAI_API_KEY=sk-...

# Ollama-Modus (Standard — kein Key nötig)
# OLLAMA_BASE_URL=http://localhost:11434/v1  # optional, das ist der Default
```

Wenn `OPENAI_API_KEY` gesetzt ist, spricht der OpenAI SDK direkt mit `api.openai.com`. Ohne Key wird der SDK auf `OLLAMA_BASE_URL` umgeleitet — Ollama bietet eine OpenAI-kompatible API, sodass kein anderer Code geändert werden muss.

## OpenAI Cloud-Modus

Wenn `OPENAI_API_KEY` gesetzt ist, verwendet Bau-OS automatisch folgende Modelle:

| Rolle | Modell | Env-Variable |
|---|---|---|
| Haupt-Agent | `gpt-4o-mini` | `OLLAMA_MODEL` (überschreibt) |
| Sub-Agenten | `gpt-4o-mini` | `OLLAMA_SUBAGENT_MODEL` |
| Vision | `gpt-4o` | `VISION_MODEL` |
| Embedding | `text-embedding-3-small` (1536 dims) | `EMBEDDING_MODEL` |

::: tip Modell zur Laufzeit wechseln
```
/model gpt-4o-mini
/model gpt-4o
```
Der Wechsel gilt sofort, ohne Neustart.
:::

Empfohlene Cloud-Modelle (OpenAI-kompatible APIs):

```env
# Leistungsstarke Alternativen zu OpenAI-Modellen
OLLAMA_MODEL=kimi-k2.5
OLLAMA_MODEL=qwen3-235b
OLLAMA_MODEL=gemma-3-27b
```

---

## Ollama-Modus

### Modell-Architektur

Bau-OS kennt drei Modell-Rollen:

| Rolle | Env-Variable | Standard | Verwendung |
|---|---|---|---|
| **Default** | `OLLAMA_MODEL` | `qwen2.5:7b` | Haupt-Agent, alle regulären Aufgaben |
| **Fast** | `OLLAMA_FAST_MODEL` | = Default | Schnelle Antworten, Zusammenfassungen |
| **Subagent** | `OLLAMA_SUBAGENT_MODEL` | = Default | Sub-Agenten für delegierte Aufgaben |

### Modell wechseln mit /model

Im Chat kannst du das aktive Modell jederzeit wechseln:

```
/model qwen2.5:14b
```

Der Bot bestätigt den Wechsel und verwendet ab sofort das neue Modell. Der Wechsel gilt für die aktuelle Session.

::: tip
Nutze `/model` ohne Parameter, um das aktuell aktive Modell anzuzeigen.
:::

### Schnellmodus mit /fast

Der `/fast`-Befehl schaltet auf das konfigurierte `OLLAMA_FAST_MODEL` um:

```
/fast
```

Das ist nützlich für einfache Fragen, bei denen Geschwindigkeit wichtiger ist als Qualität. Erneutes `/fast` schaltet zurück zum Standardmodell.

::: warning
Wenn `OLLAMA_FAST_MODEL` nicht gesetzt ist, hat `/fast` keinen Effekt — es wird ohnehin das Standardmodell verwendet.
:::

### Empfohlene Modelle

#### Für den täglichen Einsatz (7B)

Ideal für die meisten Aufgaben — schnelle Antworten bei moderatem RAM-Verbrauch (~4-5 GB).

```bash
ollama pull qwen2.5:7b
```

Gut geeignet für:
- Tagesplanung und Zusammenfassungen
- Einfache Recherchen im Workspace
- Schnelle Antworten auf Fragen
- Datei-Operationen und Notizen

#### Für komplexe Aufgaben (14B)

Deutlich bessere Reasoning-Fähigkeiten — braucht aber mehr RAM (~8-10 GB).

```bash
ollama pull qwen2.5:14b
```

Gut geeignet für:
- Komplexe Analysen und Planungen
- Mehrstufige Aufgaben mit Sub-Agenten
- Detaillierte Berichte und Auswertungen
- Aufgaben die präzises Textverständnis erfordern

#### Empfohlene Kombination

Für die beste Balance zwischen Geschwindigkeit und Qualität:

```bash
# .env
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_FAST_MODEL=qwen2.5:7b
OLLAMA_SUBAGENT_MODEL=qwen2.5:7b
```

So nutzt der Haupt-Agent das stärkere 14B-Modell, während schnelle Aufgaben und Sub-Agenten das effizientere 7B-Modell verwenden.

### Neue Modelle installieren

```bash
# Modell von der Ollama-Bibliothek laden
ollama pull qwen2.5:7b
ollama pull qwen2.5:14b
ollama pull llama3.1:8b

# Verfügbare Modelle auflisten
ollama list

# Modell entfernen
ollama rm qwen2.5:7b
```

::: tip Kompatibilität
Bau-OS funktioniert mit jedem Modell, das Ollama unterstützt und Tool-Calling beherrscht. Modelle der Qwen2.5-Familie sind empfohlen, da sie zuverlässig Function-Calling unterstützen.
:::

### Remote-Ollama

Wenn Ollama auf einem anderen Rechner läuft (z.B. ein Server mit GPU):

```bash
# .env
OLLAMA_BASE_URL=http://192.168.1.100:11434/v1
```

::: warning Netzwerk
Stelle sicher, dass der Ollama-Server auf `0.0.0.0` lauscht und nicht nur auf `localhost`. Setze dazu auf dem Server die Umgebungsvariable `OLLAMA_HOST=0.0.0.0`.
:::

## Fehlerbehebung

### Modell nicht gefunden

```
Error: model "qwen2.5:14b" not found
```

Das Modell muss zuerst heruntergeladen werden:

```bash
ollama pull qwen2.5:14b
```

### Ollama nicht erreichbar (Ollama-Modus)

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

Prüfe ob Ollama läuft:

```bash
# Manuell starten
ollama serve

# Oder als Service prüfen
systemctl status ollama
```

### Zu wenig RAM

Wenn Antworten extrem langsam sind oder der Rechner einfriert, ist das Modell zu groß für den verfügbaren Arbeitsspeicher. Wechsle auf ein kleineres Modell:

```
/model qwen2.5:7b
```
