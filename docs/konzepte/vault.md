# Obsidian Vault

Der Vault ist das "Dateisystem-Brain" von Bau-OS. Alle Daten — Notizen, Aufgaben, Termine, Agent-Konfigurationen — werden als plain Markdown gespeichert.

## Warum kein Database?

| Aspekt | Filesystem (Vault) | Datenbank |
|---|---|---|
| **Lesbarkeit** | Jeder kann die Dateien oeffnen | Braucht Client/Tool |
| **Versionierung** | Git-kompatibel | Extra Setup noetig |
| **Portabilitaet** | Copy-Paste genuegt | Export/Import noetig |
| **Wartung** | Keine — es sind nur Dateien | Updates, Migrations, Backups |
| **Obsidian** | Direkt als Vault nutzbar | Nicht moeglich |

Fuer das aktuelle MVP ist der Filesystem-Ansatz ideal. Eine Datenbank (z.B. SQLite) kann spaeter ergaenzt werden wenn strukturierte Abfragen noetig sind.

## Ordnerstruktur

```
VAULT_PATH/
├── Agents/              ← Agent-Workspaces
│   ├── Main/
│   │   ├── IDENTITY.md
│   │   ├── SOUL.md
│   │   ├── ...
│   │   └── MEMORY_LOGS/
│   └── Kalkulator/      ← weitere Agents
│       └── ...
├── Inbox/               ← Notizen (Standardordner)
│   ├── 2026-04-07_meeting-notiz.md
│   └── 2026-04-07_idee-neues-projekt.md
├── Aufgaben/            ← Aufgaben mit Status
│   └── 2026-04-07_angebot-schreiben.md
└── Termine/             ← Termine mit Datum
    └── 2026-04-10_kundentermin.md
```

## Datei-Formate

### Notizen
```markdown
---
type: Notiz
created: 07.04.2026 14:30
tags:
  - meeting
  - projekt-alpha
---

Meeting mit Kunde Alpha besprochen:
- Budget: 500k EUR
- Timeline: 6 Monate
- Naechster Schritt: Angebot bis Freitag
```

### Aufgaben
```markdown
---
type: Aufgabe
status: offen
prioritaet: hoch
faellig: 11.04.2026
created: 07.04.2026 14:35
tags:
  - angebot
  - projekt-alpha
---

Angebot fuer Projekt Alpha erstellen.
Budget: 500k EUR, Deadline: Freitag.
```

### Termine
```markdown
---
type: Termin
datum: 10.04.2026
uhrzeit: 10:00
ort: Buero Wien
created: 07.04.2026 14:40
tags:
  - kunde
  - projekt-alpha
---

Kundentermin Projekt Alpha.
Teilnehmer: Julius, Herr Mueller.
Agenda: Angebot besprechen.
```

## Volltextsuche

Der Agent kann den gesamten Vault durchsuchen:

> "Suche alles zum Thema Projekt Alpha"

Die Suche durchsucht Dateinamen und Dateiinhalte und gibt die relevantesten Treffer zurueck.

## Zugriff durch den Agent

Der Agent hat folgende Vault-Operationen als Tools:

| Tool | Funktion |
|---|---|
| `notiz_speichern` | Neue Notiz erstellen |
| `notiz_bearbeiten` | Nachtrag an bestehende Notiz |
| `notiz_loeschen` | Notiz loeschen |
| `aufgabe_speichern` | Neue Aufgabe erstellen |
| `aufgabe_erledigen` | Aufgabe als erledigt markieren |
| `termin_speichern` | Neuen Termin erstellen |
| `termin_loeschen` | Termin loeschen |
| `vault_suchen` | Volltextsuche |
| `datei_lesen` | Beliebige Datei lesen |
| `datei_erstellen` | Neue Datei erstellen |
| `ordner_auflisten` | Ordnerinhalt auflisten |
