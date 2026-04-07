# MEMORY_LOGS/

> Taegliche Gespraechsprotokolle — automatisch gefuehrt, automatisch komprimiert.

## Was macht dieses Verzeichnis?

`MEMORY_LOGS/` ist ein Unterverzeichnis im Agent-Workspace das **taegliche Gespraechsprotokolle** speichert. Fuer jeden Tag wird eine eigene Datei angelegt (z.B. `2026-04-07.md`). Der Agent sieht im System-Prompt immer nur das **heutige** Log — aeltere Tage werden beim Start als History geladen (letzte 10 Eintraege aus heute + gestern).

Das Verzeichnis wird nur im **Full-Mode** beruecksichtigt. Es wird automatisch angelegt beim ersten Gespraech und dient auch als Marker fuer den Setup-Wizard: Wenn `MEMORY_LOGS/` leer ist, gilt der Agent als "noch nicht eingerichtet".

## Beispiel

Dateiname: `MEMORY_LOGS/2026-04-07.md`

```markdown
# Log – Montag, 7. April 2026

## 09:15
**User:** Was steht heute an?
**Bauleiter-Bot:** Du hast um 14:00 einen Termin mit dem Statiker fuer Projekt Meierhof.

## 09:22
**User:** Merk dir dass der Statiker eine Woche Verzoegerung hat
**Bauleiter-Bot:** Gespeichert. Statiker Meierhof: 1 Woche Verzoegerung ab 07.04.2026.

## 11:45
**User:** Erstell eine Aufgabe: Nachtrag fuer Elektro berechnen
**Bauleiter-Bot:** Aufgabe erstellt: "Nachtrag fuer Elektro berechnen"

## Zusammenfassung (14:30)
Vormittag: Termine geprueft (Statiker 14:00), Verzoegerung Statiker Meierhof
gespeichert, Aufgabe "Nachtrag Elektro berechnen" angelegt.

## 14:35
**User:** Wie war nochmal das Budget fuer Meierhof?
**Bauleiter-Bot:** Laut Memory: 850.000 EUR netto.
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Eintrag manuell hinzufuegen** | Agent sieht den Eintrag als Teil der Konversationshistorie. |
| **Eintraege loeschen** | Agent vergisst diese Gespraeche fuer den aktuellen Tag. |
| **Heutiges Log loeschen** | Agent startet den Tag "frisch" ohne Kontext. Kann per `/clear` im System ausgeloest werden. |
| **Gesamtes Verzeichnis loeschen** | Agent gilt als "nicht eingerichtet" — der Setup-Wizard startet erneut (wenn `BOOTSTRAP.md` existiert). |

## Auto-Komprimierung

Wenn das heutige Log ueber **8.000 Zeichen** waechst (konfigurierbar via `COMPACT_THRESHOLD`), wird automatisch eine Komprimierung ausgeloest:

1. Die aeltesten Eintraege werden per LLM zusammengefasst
2. Die letzten **5 Eintraege** bleiben vollstaendig erhalten (`KEEP_RECENT_LOGS`)
3. Die Zusammenfassung ersetzt die aelteren Eintraege als `## Zusammenfassung (HH:MM)` Block

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

Beim Start einer Konversation laedt der Agent die letzten Gespraeche als Kontext:

- **Heute + Gestern** werden durchsucht
- Maximal **10 Eintraege** werden geladen (`HISTORY_LOAD_LIMIT`)
- Die Eintraege werden als User/Assistant-Paare in den Message-Buffer eingefuegt
- So hat der Agent Kontext ueber die letzten Gespraeche ohne den gesamten Log zu laden

## Tipps

- **Nicht manuell bearbeiten.** Die Logs werden automatisch geschrieben und komprimiert. Manuelle Aenderungen koennen das Format brechen.
- **Komprimierung ist verlustbehaftet.** Die Zusammenfassung enthaelt nicht alle Details. Wirklich wichtige Informationen gehoeren in `MEMORY.md`, nicht nur in den Tageslog.
- **Verzeichnis nie komplett loeschen.** Das wuerde den Setup-Wizard erneut ausloesen. Wenn du nur den heutigen Log zuruecksetzen willst, loesche nur die heutige Datei.
- **Alte Logs aufraumen.** Die Logs werden nicht automatisch geloescht. Ueber Wochen sammeln sich viele Dateien an. Ein regelmaessiges Aufraeumen (z.B. Logs aelter als 30 Tage loeschen) ist empfehlenswert.
- **8k-Grenze anpassen.** Der `COMPACT_THRESHOLD` liegt bei 8.000 Zeichen. Fuer sehr aktive Agenten kann ein hoeherer Wert sinnvoll sein (in `config.ts`).

::: info Hinweis
Die Existenz von Dateien in `MEMORY_LOGS/` ist der Marker der zwischen "erster Start" (Setup-Wizard) und "normaler Betrieb" unterscheidet. Loesche das Verzeichnis nur wenn du den Agent komplett zuruecksetzen willst.
:::
