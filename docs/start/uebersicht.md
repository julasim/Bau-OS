# Was ist Bau-OS?

Bau-OS ist eine KI-Plattform für **Architekturbüros und Büros in der Baubranche** (Planung, Bauleitung, Statik, Projektsteuerung). Der Kern: Ein intelligenter Assistent der über **Web-UI und Telegram** erreichbar ist und sein Wissen in einer **PostgreSQL-Datenbank** plus einem **Obsidian Vault** als Markdown-Backup speichert.

::: warning Wichtige Abgrenzung
Bau-OS ist ein **Büro-Werkzeug**, nicht für die Baustelle gedacht. Zielgruppe sind Architekten, Bauleiter, Projektsteuerer, Statiker und Sachbearbeiter im Büro — nicht der Polier oder Maurer auf dem Gerüst. Stundenerfassung, Bautagebuch und Meeting-Protokolle dienen der **Doku im Büro** (in der Regel abends/retrospektiv erfasst), nicht der Echtzeit-Eingabe von der Baustelle.
:::

## Wie funktioniert es?

```
Du schreibst eine Nachricht in Telegram
        |
Bau-OS versteht was du willst (lokales LLM)
        |
Führt die Aufgabe aus (Notiz speichern, Termin anlegen, ...)
        |
Speichert alles im Obsidian Vault (plain Markdown)
        |
Antwortet dir in Telegram
```

## Für wen?

- **Architekturbüros** für Projektsteuerung, Termine, Bauakte
- **Planungs- und Statikbüros** für Aufgabenverteilung im Team
- **Projektsteuerer und Bauleiter** (im Büro, nicht auf der Baustelle) für
  Bautagebuch, Meeting-Protokolle, Stundenerfassung
- **Datenschutz-bewusste Firmen** die keine Cloud-KI nutzen wollen

**NICHT für:** Echtzeit-Bedienung von der Baustelle, Polier-Schnellein-
gabe vom Gerüst, gewerbliches Personal als primäre Bediener. Diese
Personen werden als `team_members` im System abgebildet und können per
Telegram zugewiesen / benachrichtigt werden, sind aber nicht die
Hauptzielgruppe.

## Was macht es besonders?

| Feature | Beschreibung |
|---|---|
| **Self-hosted** | Läuft auf deinem eigenen Server — keine Daten an Dritte |
| **DSGVO-konform** | EU-Server, lokales LLM, keine externen API-Calls |
| **Markdown-basiert** | Alle Daten sind plain Text — lesbar, editierbar, versionierbar |
| **Multi-Agent** | Mehrere spezialisierte KI-Agenten mit eigener Persönlichkeit |
| **Anpassbar ohne Code** | Charakter, Regeln, Erinnerungen — alles über Markdown-Dateien steuerbar |
| **Proaktiv** | Der Agent meldet sich von selbst bei wichtigen Terminen oder Aufgaben |

## Geschäftsmodell

Jeder Kunde (Architekturbüro, Planungsbüro, Bauleitungs-Office) bekommt eine eigene Instanz auf einem EU-Server (Hetzner). Der Techniker richtet den Server ein, der Kunde startet den Setup-Wizard selbst. Monatliche Miete: ca. 100–150 EUR pro Büro.

## Nächste Schritte

- [Schnellstart](/start/schnellstart) — In 5 Minuten zum laufenden Bot
- [Architektur](/konzepte/architektur) — Wie das System aufgebaut ist
- [Deployment](/betrieb/voraussetzungen) — Server aufsetzen für Produktion
