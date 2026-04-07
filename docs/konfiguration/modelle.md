# Modelle & LLM-Konfiguration

Bau-OS nutzt Ollama als lokale LLM-Runtime. Du kannst verschiedene Modelle fuer unterschiedliche Aufgaben einsetzen.

## Modell-Architektur

Bau-OS kennt drei Modell-Rollen:

| Rolle | Env-Variable | Standard | Verwendung |
|---|---|---|---|
| **Default** | `OLLAMA_MODEL` | `qwen2.5:7b` | Haupt-Agent, alle regulaeren Aufgaben |
| **Fast** | `OLLAMA_FAST_MODEL` | wie Default | Schnelle Antworten, Zusammenfassungen |
| **Subagent** | `OLLAMA_SUBAGENT_MODEL` | wie Default | Sub-Agenten fuer delegierte Aufgaben |

## Modell wechseln mit /model

Im Chat kannst du das aktive Modell jederzeit wechseln:

```
/model qwen2.5:14b
```

Der Bot bestaetigt den Wechsel und verwendet ab sofort das neue Modell. Der Wechsel gilt fuer die aktuelle Session.

::: tip
Nutze `/model` ohne Parameter, um das aktuell aktive Modell anzuzeigen.
:::

## Schnellmodus mit /fast

Der `/fast`-Befehl schaltet auf das konfigurierte `OLLAMA_FAST_MODEL` um:

```
/fast
```

Das ist nuetzlich fuer einfache Fragen, bei denen Geschwindigkeit wichtiger ist als Qualitaet. Um zurueck zum Standardmodell zu wechseln, verwende `/model` ohne Parameter oder setze das Modell explizit.

::: warning
Wenn `OLLAMA_FAST_MODEL` nicht gesetzt ist, hat `/fast` keinen Effekt — es wird ohnehin das Standardmodell verwendet.
:::

## Empfohlene Modelle

### Fuer den taeglichen Einsatz (7B)

Ideal fuer die meisten Aufgaben — schnelle Antworten bei moderatem RAM-Verbrauch (~4-5 GB).

```bash
ollama pull qwen2.5:7b
```

Gut geeignet fuer:
- Tagesplanung und Zusammenfassungen
- Einfache Recherchen im Vault
- Schnelle Antworten auf Fragen
- Datei-Operationen und Notizen

### Fuer komplexe Aufgaben (14B)

Deutlich bessere Reasoning-Faehigkeiten — braucht aber mehr RAM (~8-10 GB).

```bash
ollama pull qwen2.5:14b
```

Gut geeignet fuer:
- Komplexe Analysen und Planungen
- Mehrstufige Aufgaben mit Sub-Agenten
- Detaillierte Berichte und Auswertungen
- Aufgaben die praezises Textverstaendnis erfordern

### Empfohlene Kombination

Fuer die beste Balance zwischen Geschwindigkeit und Qualitaet:

```bash
# .env
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_FAST_MODEL=qwen2.5:7b
OLLAMA_SUBAGENT_MODEL=qwen2.5:7b
```

So nutzt der Haupt-Agent das staerkere 14B-Modell, waehrend schnelle Aufgaben und Sub-Agenten das effizientere 7B-Modell verwenden.

## Neue Modelle installieren

### Modell herunterladen

```bash
# Modell von der Ollama-Bibliothek laden
ollama pull qwen2.5:7b
ollama pull qwen2.5:14b
ollama pull llama3.1:8b
```

### Verfuegbare Modelle auflisten

```bash
ollama list
```

### Modell entfernen

```bash
ollama rm qwen2.5:7b
```

::: tip Kompatibilitaet
Bau-OS funktioniert mit jedem Modell, das Ollama unterstuetzt und Tool-Calling beherrscht. Modelle der Qwen2.5-Familie sind empfohlen, da sie zuverlaessig Function-Calling unterstuetzen.
:::

## Remote-Ollama

Wenn Ollama auf einem anderen Rechner laeuft (z.B. ein Server mit GPU):

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

### Ollama nicht erreichbar

```
Error: connect ECONNREFUSED 127.0.0.1:11434
```

Pruefe ob Ollama laeuft:

```bash
# Status pruefen
ollama serve

# Oder als Service
systemctl status ollama
```

### Zu wenig RAM

Wenn Antworten extrem langsam sind oder der Rechner einfriert, ist das Modell zu gross fuer den verfuegbaren Arbeitsspeicher. Wechsle auf ein kleineres Modell:

```
/model qwen2.5:7b
```
