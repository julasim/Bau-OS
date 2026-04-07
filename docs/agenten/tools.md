# TOOLS.md

> Tool-Konventionen — wann welches Tool, welche Regeln gelten.

## Was macht diese Datei?

`TOOLS.md` legt fest, **wann der Agent welches Tool verwenden soll** und welche Konventionen dabei gelten. Sie wird nur im **Full-Mode** geladen und dient als Nachschlagewerk für den Agenten während der Konversation.

Diese Datei verhindert typische Fehler: doppelte Einträge, fehlende Daten, falsche Formate. Je klarer die Regeln, desto zuverlässiger arbeitet der Agent.

## Beispiel

```markdown
# Bauleiter-Bot – Tool-Konventionen

## Wann welches Tool
- notiz_speichern → freie Gedanken, Beobachtungen, Ideen
- aufgabe_speichern → konkrete To-dos mit Verb am Anfang
- termin_speichern → Meetings, Deadlines (immer mit Datum TT.MM.JJJJ)
- memory_speichern → dauerhaft wichtige Fakten
- vault_suchen → vor dem Erstellen erst suchen ob es schon existiert
- vault_lesen → bestimmte Datei öffnen und Inhalt lesen
- agent_spawnen → für kurze Sub-Aufgaben (synchron)
- agent_spawnen_async → für laengere Aufgaben (asynchron)

## Regeln
- Nie doppelt speichern — zuerst mit vault_suchen prüfen
- Aufgaben immer mit konkretem Verb beginnen ("Angebot senden", nicht "Angebot")
- Termine immer mit Datum im Format TT.MM.JJJJ
- Bei Unsicherheit nachfragen statt raten
- Notizen in die Inbox, Projektdaten in den Projektordner
- Memory nur für dauerhaft relevante Informationen

## Beispiele für gute vs. schlechte Einträge

Gut: "Angebot für Projekt Meierhof bis 15.04.2026 senden"
Schlecht: "Angebot Meierhof"

Gut: "Meeting mit Statiker am 10.04.2026 um 14:00"
Schlecht: "Statiker-Termin bald"
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Tool-Zuordnung ändern** | Agent verwendet andere Tools für gleiche Anfragen. |
| **Regeln hinzufügen** | Neue Konventionen gelten ab der nächsten Nachricht. |
| **Format-Regeln ändern** | Beeinflusst wie Daten gespeichert werden (z.B. Datumsformat). |
| **Datei löschen** | Agent nutzt Tools nach eigenem Ermessen — funktioniert, aber weniger konsistent. |

## Tipps

- **"Erst suchen, dann speichern" ist die wichtigste Regel.** Ohne sie entstehen schnell doppelte Einträge im Vault.
- **Konkrete Beispiele helfen dem LLM.** Die Gut/Schlecht-Vergleiche im Beispiel oben verbessern die Qualitaet der Einträge deutlich.
- **Datumsformat festlegen.** `TT.MM.JJJJ` ist der österreichische Standard — ohne diese Regel mischt der Agent gerne ISO-Format und deutsche Schreibweise.
- **Neue Tools dokumentieren.** Wenn du eigene Tools hinzufuegst (z.B. `email_senden`), trage sie hier ein damit der Agent weiß wann er sie nutzen soll.
- **Nur im Full-Mode sichtbar.** Sub-Agenten sehen `TOOLS.md` nicht — sie verwenden Tools nach allgemeinem Wissen.

::: tip Praxis-Tipp
Wenn der Agent regelmäßig falsche Tools wählt, prüfe zuerst `TOOLS.md`. Oft reicht ein klareres Beispiel oder eine zusätzliche Abgrenzung.
:::
