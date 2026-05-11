# Was ist Bau-OS?

Bau-OS ist eine KI-Plattform für **Architekturbüros und Büros in der Baubranche** (Planung, Bauleitung, Statik, Projektsteuerung). Der Kern: Ein intelligenter Assistent der über **Web-UI und Telegram** erreichbar ist und sein Wissen in einer **PostgreSQL-Datenbank** plus einem **Obsidian Vault** als Markdown-Backup speichert.

::: warning Wichtige Abgrenzung
Bau-OS ist ein **Büro-Werkzeug**, nicht für die Baustelle gedacht. Zielgruppe sind Architekten, Bauleiter, Projektsteuerer, Statiker und Sachbearbeiter im Büro — nicht der Polier oder Maurer auf dem Gerüst. Stundenerfassung, Bautagebuch und Meeting-Protokolle dienen der **Doku im Büro** (in der Regel abends/retrospektiv erfasst), nicht der Echtzeit-Eingabe von der Baustelle.
:::

## Wie funktioniert es?

```
Du schreibst in Telegram  ODER  Web-UI (Browser)
            |                         |
[Zugriffskontrolle: Auto-Owner / ALLOWED_CHAT_IDS]
            |
[Session-Queue — serialisiert pro Chat-ID]
            |
[Agent Runtime — Agentic Loop, bis zu 56 Tools]
            |
[LLM: Ollama lokal ODER OpenAI cloud]
            |
[Datenschicht: Workspace (Markdown) ODER PostgreSQL]
```

## Für wen?

- **Architekturbüros** für Projektsteuerung, Termine, Bauakte
- **Planungs- und Statikbüros** für Aufgabenverteilung im Team
- **Projektsteuerer und Bauleiter** (im Büro, nicht auf der Baustelle) für
  Bautagebuch, Meeting-Protokolle, Stundenerfassung
- **Datenschutz-bewusste Firmen** die keine Cloud-KI nutzen wollen (Ollama lokal)
  oder maximale Qualität bevorzugen (OpenAI cloud)

**NICHT für:** Echtzeit-Bedienung von der Baustelle, Polier-Schnellein-
gabe vom Gerüst, gewerbliches Personal als primäre Bediener. Diese
Personen werden als `team_members` im System abgebildet und können per
Telegram zugewiesen / benachrichtigt werden, sind aber nicht die
Hauptzielgruppe.

## Was macht es besonders?

| Feature | Beschreibung |
|---|---|
| **Self-hosted** | Läuft auf eigenem Server — keine Daten an Dritte (by default) |
| **Dual-Backend** | Ollama lokal (Datensouveränität) oder OpenAI cloud (höchste Qualität) |
| **56 LLM-Tools** | Notizen, Aufgaben, Termine, Projekte, Suche, PDF/DOCX, Team, Web, und mehr |
| **Multi-Agent** | Mehrere spezialisierte KI-Agenten mit eigenem Workspace |
| **Web-UI** | Browser-Interface (Vue 3) zusätzlich zu Telegram |
| **Anpassbar ohne Code** | Charakter, Regeln, Erinnerungen über Markdown-Dateien steuerbar |
| **Proaktiv** | Heartbeat-System: Agent meldet sich selbst bei Terminen |
| **PostgreSQL optional** | Semantische Suche mit pgvector, Supabase Realtime |

## Geschäftsmodell

Jeder Kunde (Architekturbüro, Planungsbüro, Bauleitungs-Office) bekommt eine eigene Instanz auf einem EU-Server (Hetzner). Der Techniker richtet den Server ein, der Kunde startet den Setup-Wizard selbst. Monatliche Miete: ca. 100–150 EUR pro Büro.

## Nächste Schritte

- [Schnellstart](/start/schnellstart) — In 5 Minuten zum laufenden Bot
- [Architektur](/konzepte/architektur) — Wie das System aufgebaut ist
- [Deployment](/betrieb/voraussetzungen) — Server aufsetzen für Produktion
