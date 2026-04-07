# MEMORY.md

> Langzeitgedaechtnis — dauerhaft wichtige Fakten ueber Projekte, Praeferenzen und Entscheidungen.

## Was macht diese Datei?

`MEMORY.md` ist das **Langzeitgedaechtnis** des Agenten. Hier werden Informationen gespeichert, die ueber einzelne Gespraeche hinaus relevant sind: Benutzer-Praeferenzen, Projektentscheidungen, wichtige Fakten.

Die Datei wird nur im **Full-Mode** geladen und waechst automatisch, wenn der Agent das Tool `memory_speichern` aufruft. Im Gegensatz zu den Tages-Logs (`MEMORY_LOGS/`) wird `MEMORY.md` nie automatisch komprimiert.

## Beispiel

```markdown
# Memory – Bauleiter-Bot

- 15.03.2026: Julius bevorzugt Kostengruppen nach OENORM B 1801-1
- 18.03.2026: Projekt Meierhof hat Budget von 850.000 EUR netto
- 22.03.2026: Statiker fuer Meierhof ist DI Gruber (Tel: 0664/1234567)
- 01.04.2026: Julius will Aufgaben immer mit Deadline sehen
- 03.04.2026: Standard-Besprechungstag mit Bauherr ist Mittwoch 10:00
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Eintrag hinzufuegen** | Agent kennt die Information ab der naechsten Nachricht. |
| **Eintrag loeschen** | Agent vergisst diese Information dauerhaft. |
| **Eintrag korrigieren** | Korrektur wird sofort wirksam — nuetzlich wenn der Agent etwas falsch gespeichert hat. |
| **Datei loeschen** | Agent verliert sein gesamtes Langzeitgedaechtnis. Wird bei der naechsten `memory_speichern`-Aktion neu angelegt. |
| **Datei wird zu gross** | Ab 20.000 Zeichen wird sie im System-Prompt gekuerzt (truncated). Aeltere Eintraege werden dann nicht mehr geladen. |

## Tipps

- **Manuell aufraeumen lohnt sich.** Der Agent speichert manchmal redundante oder veraltete Informationen. Einmal im Monat durchsehen und aufraeumen.
- **Format einhalten.** Jede Zeile beginnt mit `- TT.MM.JJJJ:` gefolgt vom Eintrag. Das hilft dem Agenten beim Lesen und Suchen.
- **Nicht alles gehoert in MEMORY.md.** Tagesaktuelles gehoert in die `MEMORY_LOGS/`, Projektdetails in den Vault. MEMORY.md ist fuer uebergreifende, dauerhafte Fakten.
- **Trigger-Woerter in SOUL.md steuern das Speichern.** Wenn der Agent zu viel oder zu wenig speichert, passe die Trigger in `SOUL.md` unter "Langzeitgedaechtnis" an.
- **Groesse im Auge behalten.** `MEMORY.md` wird nie automatisch komprimiert. Wenn sie ueber 10.000 Zeichen waechst, solltest du manuell aufraumen oder alte Eintraege archivieren.

::: warning Achtung
Im Gegensatz zu den Tages-Logs gibt es fuer `MEMORY.md` keine automatische Komprimierung. Die Datei waechst unbegrenzt bis zum Truncation-Limit von 20.000 Zeichen.
:::
