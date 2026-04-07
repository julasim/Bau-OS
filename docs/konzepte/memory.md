# Memory-System

Bau-OS hat ein zweistufiges Gedaechtnis: **MEMORY.md** fuer dauerhaftes Wissen und **MEMORY_LOGS/** fuer Tages-Protokolle.

## MEMORY.md — Langzeitgedaechtnis

Dauerhaft wichtige Fakten, Entscheidungen und Praeferenzen:

```markdown
# Memory – Main Agent

- 07.04.2026: Julius bevorzugt kurze Antworten ohne Floskeln
- 07.04.2026: Projekt Alpha hat Budget von 500k EUR
- 07.04.2026: Standardtermin fuer Team-Meeting: Mittwoch 10 Uhr
- 08.04.2026: Herr Mueller (Kunde) bevorzugt Kommunikation per Mail
```

### Wann wird gespeichert?

Der Agent speichert proaktiv wenn:
- Du sagst "merk dir", "vergiss nicht", "speicher das"
- Du eine klare Praeferenz aeusserst
- Wichtige Projektentscheidungen getroffen werden
- Er etwas ueber dich lernt das dauerhaft relevant ist

Nicht jedes Gespraech wird gespeichert — nur was langfristig wichtig ist.

### Tool

```
memory_speichern(eintrag: "Julius bevorzugt formelle Angebote")
```

## MEMORY_LOGS/ — Tages-Protokolle

Jedes Gespraech wird automatisch im Tageslog protokolliert:

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
**User:** Erstelle eine Notiz: Budget Alpha auf 600k erhoeht
**Main:** Gespeichert.
```

### Was wird geladen?

Beim Start eines Gespraechs laedt der Agent:
- Den **heutigen Tageslog** (als Teil des System-Prompts)
- Die **letzten 10 Gespraeche** von heute und gestern (als History)

So hat er Kontext ueber das was bereits besprochen wurde.

## Kompaktierung

Wenn ein Tageslog zu gross wird (ueber 8.000 Zeichen), startet automatisch die **Kompaktierung**:

1. Die aeltesten Eintraege werden vom LLM zusammengefasst
2. Die letzten 5 Eintraege bleiben vollstaendig erhalten
3. Die Zusammenfassung ersetzt die alten Eintraege

### Vorher
```markdown
## 09:15
(langes Gespraech...)

## 09:30
(langes Gespraech...)

## 10:00
(langes Gespraech...)

## 14:00
(aktuelles Gespraech)

## 14:30
(aktuelles Gespraech)
```

### Nachher
```markdown
## Zusammenfassung (14:35)
Am Vormittag wurden Termine geprueft, eine Notiz zu Projekt Alpha
erstellt und das Budget auf 600k erhoeht.

## 14:00
(vollstaendig erhalten)

## 14:30
(vollstaendig erhalten)
```

## Pruning

Wenn der gesamte Message-Buffer ueber 60.000 Zeichen waechst, werden aeltere Nachrichten automatisch entfernt um Platz zu schaffen. Die neuesten Tool-Ergebnisse (letzte 3) bleiben immer erhalten.
