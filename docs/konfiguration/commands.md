# Slash-Befehle

Bau-OS bietet eine Reihe von Slash-Befehlen, die du direkt im Telegram-Chat verwenden kannst. Tippe `/` um die Befehlsliste zu sehen.

## Übersicht

| Befehl | Beschreibung |
|---|---|
| `/hilfe` | Zeigt alle verfügbaren Befehle |
| `/heute` | Tagesbericht und aktuelle Aufgaben |
| `/status` | Systemstatus und Bot-Informationen |
| `/config` | Aktuelle Konfiguration anzeigen |
| `/model [name]` | Modell wechseln oder anzeigen |
| `/fast` | Auf schnelles Modell umschalten |
| `/agents` | Alle Agenten auflisten |
| `/whoami` | Benutzer-Informationen anzeigen |
| `/export` | Daten exportieren |
| `/restart` | Bot neu starten |
| `/logs` | Letzte Log-Einträge anzeigen |
| `/commands` | Befehlsliste anzeigen |
| `/clear` | Chat-Verlauf zurücksetzen |

## Befehle im Detail

### /hilfe

Zeigt eine Übersicht aller verfügbaren Slash-Befehle mit kurzer Beschreibung.

```
/hilfe
```

::: tip
Identisch mit `/commands` — beide zeigen die Befehlsliste an.
:::

### /heute

Erstellt einen Tagesbericht basierend auf dem aktuellen Datum. Der Agent liest den Vault, fasst offene Aufgaben zusammen und gibt einen Überblick über den Tag.

```
/heute
```

**Intern:** Lädt den Tageslog und aktuelle Vault-Inhalte, generiert eine LLM-basierte Zusammenfassung des Tages.

### /status

Zeigt den aktuellen Systemstatus: aktives Modell, Anzahl der Agenten, Speicherverbrauch und Verbindungsstatus zu Ollama.

```
/status
```

**Intern:** Sammelt Laufzeit-Informationen und prüft die Erreichbarkeit der Ollama-API.

### /config

Gibt die aktuelle Konfiguration aus — aktives Modell, Vault-Pfad, Ollama-URL und alle relevanten Einstellungen.

```
/config
```

::: warning
Sensible Werte wie das Bot-Token werden nicht im Klartext angezeigt.
:::

### /model [name]

Wechselt das aktive LLM-Modell oder zeigt das aktuell verwendete Modell an.

```
# Aktuelles Modell anzeigen
/model

# Modell wechseln
/model qwen2.5:14b
```

**Intern:** Setzt das Modell für die aktuelle Session. Das Modell muss in Ollama verfügbar sein (siehe [Modelle](./modelle)).

### /fast

Schaltet auf das konfigurierte schnelle Modell (`OLLAMA_FAST_MODEL`) um. Ideal für einfache Fragen, bei denen Geschwindigkeit wichtiger ist.

```
/fast
```

**Intern:** Setzt das Session-Modell auf den Wert von `OLLAMA_FAST_MODEL`.

::: tip
Zurück zum Standardmodell geht es mit `/model` gefolgt vom gewünschten Modellnamen.
:::

### /agents

Listet alle konfigurierten Agenten mit Name, Modell und Status auf.

```
/agents
```

**Intern:** Liest die Agent-Konfiguration aus `src/config.ts` und den Vault-Ordner `Agents/`.

### /whoami

Zeigt Informationen zum aktuellen Benutzer — Telegram-Name, Chat-ID und Berechtigungsstatus.

```
/whoami
```

**Intern:** Liest die Telegram-Benutzerinformationen aus dem Chat-Kontext.

### /export

Exportiert Daten aus dem Bot — z.B. Gesprächsverläufe oder Tagesberichte.

```
/export
```

### /restart

Startet den Bot neu. Nützlich nach Konfigurationsänderungen.

```
/restart
```

::: warning
Ein Restart unterbricht laufende Operationen. Der Bot ist für einige Sekunden nicht erreichbar.
:::

### /logs

Zeigt die letzten Log-Einträge an. Die Anzahl wird durch `KEEP_RECENT_LOGS` (Standard: 5) begrenzt.

```
/logs
```

**Intern:** Liest die letzten Einträge aus dem Log-Verzeichnis des aktiven Agenten (`Agents/<Name>/MEMORY_LOGS/`).

### /commands

Zeigt die vollständige Befehlsliste an. Funktioniert identisch zu `/hilfe`.

```
/commands
```

### /clear

Setzt den Chat-Verlauf des Bots zurück. Der Agent beginnt mit einem leeren Gesprächspuffer.

```
/clear
```

**Intern:** Leert den In-Memory Message-Buffer. Tagesberichte und Vault-Inhalte bleiben erhalten.

::: warning
Der gesamte Gesprächskontext geht verloren. Der Agent erinnert sich nicht mehr an vorherige Nachrichten der aktuellen Session.
:::

## Eigene Befehle

Slash-Befehle sind im Quellcode definiert. Um eigene Befehle hinzuzufügen, siehe [Anpassung](./anpassung).
