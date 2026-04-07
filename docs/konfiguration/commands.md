# Slash-Befehle

Bau-OS bietet eine Reihe von Slash-Befehlen, die du direkt im Telegram-Chat verwenden kannst. Tippe `/` um die Befehlsliste zu sehen.

## Uebersicht

| Befehl | Beschreibung |
|---|---|
| `/hilfe` | Zeigt alle verfuegbaren Befehle |
| `/heute` | Tagesbericht und aktuelle Aufgaben |
| `/status` | Systemstatus und Bot-Informationen |
| `/config` | Aktuelle Konfiguration anzeigen |
| `/model [name]` | Modell wechseln oder anzeigen |
| `/fast` | Auf schnelles Modell umschalten |
| `/agents` | Alle Agenten auflisten |
| `/whoami` | Benutzer-Informationen anzeigen |
| `/export` | Daten exportieren |
| `/restart` | Bot neu starten |
| `/logs` | Letzte Log-Eintraege anzeigen |
| `/commands` | Befehlsliste anzeigen |
| `/clear` | Chat-Verlauf zuruecksetzen |

## Befehle im Detail

### /hilfe

Zeigt eine Uebersicht aller verfuegbaren Slash-Befehle mit kurzer Beschreibung.

```
/hilfe
```

::: tip
Identisch mit `/commands` — beide zeigen die Befehlsliste an.
:::

### /heute

Erstellt einen Tagesbericht basierend auf dem aktuellen Datum. Der Agent liest den Vault, fasst offene Aufgaben zusammen und gibt einen Ueberblick ueber den Tag.

```
/heute
```

**Intern:** Laedt den Tageslog und aktuelle Vault-Inhalte, generiert eine LLM-basierte Zusammenfassung des Tages.

### /status

Zeigt den aktuellen Systemstatus: aktives Modell, Anzahl der Agenten, Speicherverbrauch und Verbindungsstatus zu Ollama.

```
/status
```

**Intern:** Sammelt Laufzeit-Informationen und prueft die Erreichbarkeit der Ollama-API.

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

**Intern:** Setzt das Modell fuer die aktuelle Session. Das Modell muss in Ollama verfuegbar sein (siehe [Modelle](./modelle)).

### /fast

Schaltet auf das konfigurierte schnelle Modell (`OLLAMA_FAST_MODEL`) um. Ideal fuer einfache Fragen, bei denen Geschwindigkeit wichtiger ist.

```
/fast
```

**Intern:** Setzt das Session-Modell auf den Wert von `OLLAMA_FAST_MODEL`.

::: tip
Zurueck zum Standardmodell geht es mit `/model` gefolgt vom gewuenschten Modellnamen.
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

Exportiert Daten aus dem Bot — z.B. Gespraechsverlaeufe oder Tagesberichte.

```
/export
```

### /restart

Startet den Bot neu. Nuetzlich nach Konfigurationsaenderungen.

```
/restart
```

::: warning
Ein Restart unterbricht laufende Operationen. Der Bot ist fuer einige Sekunden nicht erreichbar.
:::

### /logs

Zeigt die letzten Log-Eintraege an. Die Anzahl wird durch `KEEP_RECENT_LOGS` (Standard: 5) begrenzt.

```
/logs
```

**Intern:** Liest die letzten Eintraege aus dem Log-Verzeichnis des aktiven Agenten (`Agents/<Name>/MEMORY_LOGS/`).

### /commands

Zeigt die vollstaendige Befehlsliste an. Funktioniert identisch zu `/hilfe`.

```
/commands
```

### /clear

Setzt den Chat-Verlauf des Bots zurueck. Der Agent beginnt mit einem leeren Gespraechspuffer.

```
/clear
```

**Intern:** Leert den In-Memory Message-Buffer. Tagesberichte und Vault-Inhalte bleiben erhalten.

::: warning
Der gesamte Gespraechskontext geht verloren. Der Agent erinnert sich nicht mehr an vorherige Nachrichten der aktuellen Session.
:::

## Eigene Befehle

Slash-Befehle sind im Quellcode definiert. Um eigene Befehle hinzuzufuegen, siehe [Anpassung](./anpassung).
