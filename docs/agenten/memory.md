# MEMORY.md

> Langzeitgedächtnis — dauerhaft wichtige Fakten über Projekte, Präferenzen und Entscheidungen.

## Was macht diese Datei?

`MEMORY.md` ist das **Langzeitgedächtnis** des Agenten. Hier werden Informationen gespeichert, die über einzelne Gespräche hinaus relevant sind: Benutzer-Präferenzen, Projektentscheidungen, wichtige Fakten.

Die Datei wird nur im **Full-Mode** geladen und wächst automatisch, wenn der Agent das Tool `memory_speichern` aufruft. Im Gegensatz zu den Tages-Logs (`MEMORY_LOGS/`) wird `MEMORY.md` nie automatisch komprimiert.

## Beispiel

```markdown
# Memory – Bauleiter-Bot

- 15.03.2026: Julius bevorzugt Kostengruppen nach ÖNORM B 1801-1
- 18.03.2026: Projekt Meierhof hat Budget von 850.000 EUR netto
- 22.03.2026: Statiker für Meierhof ist DI Gruber (Tel: 0664/1234567)
- 01.04.2026: Julius will Aufgaben immer mit Deadline sehen
- 03.04.2026: Standard-Besprechungstag mit Bauherr ist Mittwoch 10:00
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Eintrag hinzufügen** | Agent kennt die Information ab der nächsten Nachricht. |
| **Eintrag löschen** | Agent vergisst diese Information dauerhaft. |
| **Eintrag korrigieren** | Korrektur wird sofort wirksam — nützlich wenn der Agent etwas falsch gespeichert hat. |
| **Datei löschen** | Agent verliert sein gesamtes Langzeitgedächtnis. Wird bei der nächsten `memory_speichern`-Aktion neu angelegt. |
| **Datei wird zu gross** | Ab 20.000 Zeichen wird sie im System-Prompt gekürzt (truncated). Ältere Einträge werden dann nicht mehr geladen. |

## Tipps

- **Manuell aufräumen lohnt sich.** Der Agent speichert manchmal redundante oder veraltete Informationen. Einmal im Monat durchsehen und aufräumen.
- **Format einhalten.** Jede Zeile beginnt mit `- TT.MM.JJJJ:` gefolgt vom Eintrag. Das hilft dem Agenten beim Lesen und Suchen.
- **Nicht alles gehoert in MEMORY.md.** Tagesaktuelles gehoert in die `MEMORY_LOGS/`, Projektdetails in den Vault. MEMORY.md ist für übergreifende, dauerhafte Fakten.
- **Trigger-Woerter in SOUL.md steuern das Speichern.** Wenn der Agent zu viel oder zu wenig speichert, passe die Trigger in `SOUL.md` unter "Langzeitgedächtnis" an.
- **Größe im Auge behalten.** `MEMORY.md` wird nie automatisch komprimiert. Wenn sie über 10.000 Zeichen wächst, solltest du manuell aufraumen oder alte Einträge archivieren.

::: warning Achtung
Im Gegensatz zu den Tages-Logs gibt es für `MEMORY.md` keine automatische Komprimierung. Die Datei wächst unbegrenzt bis zum Truncation-Limit von 20.000 Zeichen.
:::
