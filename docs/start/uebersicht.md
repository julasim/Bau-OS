# Was ist Bau-OS?

Bau-OS ist eine KI-Plattform die als "Operating System" fuer Bueros und Bauunternehmen funktioniert. Der Kern: Ein intelligenter Assistent der ueber **Telegram** erreichbar ist und sein Wissen in einem **Obsidian Vault** speichert.

## Wie funktioniert es?

```
Du schreibst eine Nachricht in Telegram
        |
Bau-OS versteht was du willst (lokales LLM)
        |
Fuehrt die Aufgabe aus (Notiz speichern, Termin anlegen, ...)
        |
Speichert alles im Obsidian Vault (plain Markdown)
        |
Antwortet dir in Telegram
```

## Fuer wen?

- **Kleine und mittlere Unternehmen** die einen digitalen Assistenten wollen
- **Bauunternehmen** die Termine, Aufgaben und Projekte zentral verwalten wollen
- **Teams** die einen gemeinsamen KI-Assistenten ueber Telegram nutzen wollen
- **Datenschutz-bewusste Firmen** die keine Cloud-KI nutzen wollen

## Was macht es besonders?

| Feature | Beschreibung |
|---|---|
| **Self-hosted** | Laeuft auf deinem eigenen Server — keine Daten an Dritte |
| **DSGVO-konform** | EU-Server, lokales LLM, keine externen API-Calls |
| **Markdown-basiert** | Alle Daten sind plain Text — lesbar, editierbar, versionierbar |
| **Multi-Agent** | Mehrere spezialisierte KI-Agenten mit eigener Persoenlichkeit |
| **Anpassbar ohne Code** | Charakter, Regeln, Erinnerungen — alles ueber Markdown-Dateien steuerbar |
| **Proaktiv** | Der Agent meldet sich von selbst bei wichtigen Terminen oder Aufgaben |

## Geschaeftsmodell

Jeder Kunde bekommt eine eigene Instanz auf einem EU-Server (Hetzner). Der Techniker richtet den Server ein, der Kunde startet den Setup-Wizard selbst ueber Telegram. Monatliche Miete: ca. 100–150 EUR pro Firma.

## Naechste Schritte

- [Schnellstart](/start/schnellstart) — In 5 Minuten zum laufenden Bot
- [Architektur](/konzepte/architektur) — Wie das System aufgebaut ist
- [Deployment](/betrieb/voraussetzungen) — Server aufsetzen fuer Produktion
