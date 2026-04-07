# MEMORY_LOGS/

> Tägliche Gesprächsprotokolle — automatisch gefuehrt, automatisch komprimiert.

## Was macht dieses Verzeichnis?

`MEMORY_LOGS/` ist ein Unterverzeichnis im Agent-Workspace das **tägliche Gesprächsprotokolle** speichert. Für jeden Tag wird eine eigene Datei angelegt (z.B. `2026-04-07.md`). Der Agent sieht im System-Prompt immer nur das **heutige** Log — ältere Tage werden beim Start als History geladen (letzte 10 Einträge aus heute + gestern).

Das Verzeichnis wird nur im **Full-Mode** berücksichtigt. Es wird automatisch angelegt beim ersten Gespräch und dient auch als Marker für den Setup-Wizard: Wenn `MEMORY_LOGS/` leer ist, gilt der Agent als "noch nicht eingerichtet".

## Beispiel

Dateiname: `MEMORY_LOGS/2026-04-07.md`

```markdown
# Log – Montag, 7. April 2026

## 09:15
**User:** Was steht heute an?
**Bauleiter-Bot:** Du hast um 14:00 einen Termin mit dem Statiker für Projekt Meierhof.

## 09:22
**User:** Merk dir dass der Statiker eine Woche Verzögerung hat
**Bauleiter-Bot:** Gespeichert. Statiker Meierhof: 1 Woche Verzögerung ab 07.04.2026.

## 11:45
**User:** Erstell eine Aufgabe: Nachtrag für Elektro berechnen
**Bauleiter-Bot:** Aufgabe erstellt: "Nachtrag für Elektro berechnen"

## Zusammenfassung (14:30)
Vormittag: Termine geprüft (Statiker 14:00), Verzögerung Statiker Meierhof
gespeichert, Aufgabe "Nachtrag Elektro berechnen" angelegt.

## 14:35
**User:** Wie war nochmal das Budget für Meierhof?
**Bauleiter-Bot:** Laut Memory: 850.000 EUR netto.
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Eintrag manuell hinzufuegen** | Agent sieht den Eintrag als Teil der Konversationshistorie. |
| **Einträge löschen** | Agent vergisst diese Gespräche für den aktuellen Tag. |
| **Heutiges Log löschen** | Agent startet den Tag "frisch" ohne Kontext. Kann per `/clear` im System ausgelöst werden. |
| **Gesamtes Verzeichnis löschen** | Agent gilt als "nicht eingerichtet" — der Setup-Wizard startet erneut (wenn `BOOTSTRAP.md` existiert). |

## Auto-Komprimierung

Wenn das heutige Log über **8.000 Zeichen** waechst (konfigurierbar via `COMPACT_THRESHOLD`), wird automatisch eine Komprimierung ausgelöst:

1. Die ältesten Einträge werden per LLM zusammengefasst
2. Die letzten **5 Einträge** bleiben vollständig erhalten (`KEEP_RECENT_LOGS`)
3. Die Zusammenfassung ersetzt die älteren Einträge als `## Zusammenfassung (HH:MM)` Block

```
Vor Komprimierung:          Nach Komprimierung:
┌─────────────────┐         ┌─────────────────┐
│ ## 09:15        │         │ ## Zusammenfassung│
│ ## 09:22        │  ──→    │ (komprimiert)    │
│ ## 11:45        │         │ ## 13:00         │
│ ## 12:30        │         │ ## 13:45         │
│ ## 13:00        │         │ ## 14:00         │
│ ## 13:45        │         │ ## 14:35         │
│ ## 14:00        │         │ ## 15:10         │
│ ## 14:35        │         └─────────────────┘
│ ## 15:10        │
└─────────────────┘
```

## History-Loading

Beim Start einer Konversation lädt der Agent die letzten Gespräche als Kontext:

- **Heute + Gestern** werden durchsucht
- Maximal **10 Einträge** werden geladen (`HISTORY_LOAD_LIMIT`)
- Die Einträge werden als User/Assistant-Paare in den Message-Buffer eingefügt
- So hat der Agent Kontext über die letzten Gespräche ohne den gesamten Log zu laden

## Tipps

- **Nicht manuell bearbeiten.** Die Logs werden automatisch geschrieben und komprimiert. Manuelle Änderungen können das Format brechen.
- **Komprimierung ist verlustbehaftet.** Die Zusammenfassung enthaelt nicht alle Details. Wirklich wichtige Informationen gehoeren in `MEMORY.md`, nicht nur in den Tageslog.
- **Verzeichnis nie komplett löschen.** Das würde den Setup-Wizard erneut ausloesen. Wenn du nur den heutigen Log zurücksetzen willst, loesche nur die heutige Datei.
- **Alte Logs aufraumen.** Die Logs werden nicht automatisch gelöscht. Über Wochen sammeln sich viele Dateien an. Ein regelmäßiges Aufräumen (z.B. Logs älter als 30 Tage löschen) ist empfehlenswert.
- **8k-Grenze anpassen.** Der `COMPACT_THRESHOLD` liegt bei 8.000 Zeichen. Für sehr aktive Agenten kann ein hoeherer Wert sinnvoll sein (in `config.ts`).

::: info Hinweis
Die Existenz von Dateien in `MEMORY_LOGS/` ist der Marker der zwischen "erster Start" (Setup-Wizard) und "normaler Betrieb" unterscheidet. Loesche das Verzeichnis nur wenn du den Agent komplett zurücksetzen willst.
:::
