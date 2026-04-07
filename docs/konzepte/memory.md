# Memory-System

Bau-OS hat ein zweistufiges Gedächtnis: **MEMORY.md** für dauerhaftes Wissen und **MEMORY_LOGS/** für Tages-Protokolle.

## MEMORY.md — Langzeitgedächtnis

Dauerhaft wichtige Fakten, Entscheidungen und Präferenzen:

```markdown
# Memory – Main Agent

- 07.04.2026: Julius bevorzugt kurze Antworten ohne Floskeln
- 07.04.2026: Projekt Alpha hat Budget von 500k EUR
- 07.04.2026: Standardtermin für Team-Meeting: Mittwoch 10 Uhr
- 08.04.2026: Herr Mueller (Kunde) bevorzugt Kommunikation per Mail
```

### Wann wird gespeichert?

Der Agent speichert proaktiv wenn:
- Du sagst "merk dir", "vergiss nicht", "speicher das"
- Du eine klare Präferenz äußerst
- Wichtige Projektentscheidungen getroffen werden
- Er etwas über dich lernt das dauerhaft relevant ist

Nicht jedes Gespräch wird gespeichert — nur was langfristig wichtig ist.

### Tool

```
memory_speichern(eintrag: "Julius bevorzugt formelle Angebote")
```

## MEMORY_LOGS/ — Tages-Protokolle

Jedes Gespräch wird automatisch im Tageslog protokolliert:

```
MEMORY_LOGS/
├── 2026-04-07.md    ← heute
├── 2026-04-06.md    ← gestern
└── 2026-04-05.md    ← ...
```

### Format

```markdown
# Log – Montag, 7. April 2026

## 09:15
**User:** Welche Termine habe ich heute?
**Main:** Du hast einen Termin um 10:00 — Kundentermin Projekt Alpha.

## 09:30
**User:** Erstelle eine Notiz: Budget Alpha auf 600k erhöht
**Main:** Gespeichert.
```

### Was wird geladen?

Beim Start eines Gesprächs lädt der Agent:
- Den **heutigen Tageslog** (als Teil des System-Prompts)
- Die **letzten 10 Gespräche** von heute und gestern (als History)

So hat er Kontext über das was bereits besprochen wurde.

## Kompaktierung

Wenn ein Tageslog zu gross wird (über 8.000 Zeichen), startet automatisch die **Kompaktierung**:

1. Die ältesten Einträge werden vom LLM zusammengefasst
2. Die letzten 5 Einträge bleiben vollständig erhalten
3. Die Zusammenfassung ersetzt die alten Einträge

### Vorher
```markdown
## 09:15
(langes Gespräch...)

## 09:30
(langes Gespräch...)

## 10:00
(langes Gespräch...)

## 14:00
(aktuelles Gespräch)

## 14:30
(aktuelles Gespräch)
```

### Nachher
```markdown
## Zusammenfassung (14:35)
Am Vormittag wurden Termine geprüft, eine Notiz zu Projekt Alpha
erstellt und das Budget auf 600k erhöht.

## 14:00
(vollständig erhalten)

## 14:30
(vollständig erhalten)
```

## Pruning

Wenn der gesamte Message-Buffer über 60.000 Zeichen wächst, werden ältere Nachrichten automatisch entfernt um Platz zu schaffen. Die neuesten Tool-Ergebnisse (letzte 3) bleiben immer erhalten.
