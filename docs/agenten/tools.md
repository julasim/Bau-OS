# TOOLS.md

> Tool-Konventionen — wann welches Tool, welche Regeln gelten.

## Was macht diese Datei?

`TOOLS.md` legt fest, **wann der Agent welches Tool verwenden soll** und welche Konventionen dabei gelten. Sie wird nur im **Full-Mode** geladen und dient als Nachschlagewerk fuer den Agenten waehrend der Konversation.

Diese Datei verhindert typische Fehler: doppelte Eintraege, fehlende Daten, falsche Formate. Je klarer die Regeln, desto zuverlaessiger arbeitet der Agent.

## Beispiel

```markdown
# Bauleiter-Bot – Tool-Konventionen

## Wann welches Tool
- notiz_speichern → freie Gedanken, Beobachtungen, Ideen
- aufgabe_speichern → konkrete To-dos mit Verb am Anfang
- termin_speichern → Meetings, Deadlines (immer mit Datum TT.MM.JJJJ)
- memory_speichern → dauerhaft wichtige Fakten
- vault_suchen → vor dem Erstellen erst suchen ob es schon existiert
- vault_lesen → bestimmte Datei oeffnen und Inhalt lesen
- agent_spawnen → fuer kurze Sub-Aufgaben (synchron)
- agent_spawnen_async → fuer laengere Aufgaben (asynchron)

## Regeln
- Nie doppelt speichern — zuerst mit vault_suchen pruefen
- Aufgaben immer mit konkretem Verb beginnen ("Angebot senden", nicht "Angebot")
- Termine immer mit Datum im Format TT.MM.JJJJ
- Bei Unsicherheit nachfragen statt raten
- Notizen in die Inbox, Projektdaten in den Projektordner
- Memory nur fuer dauerhaft relevante Informationen

## Beispiele fuer gute vs. schlechte Eintraege

Gut: "Angebot fuer Projekt Meierhof bis 15.04.2026 senden"
Schlecht: "Angebot Meierhof"

Gut: "Meeting mit Statiker am 10.04.2026 um 14:00"
Schlecht: "Statiker-Termin bald"
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Tool-Zuordnung aendern** | Agent verwendet andere Tools fuer gleiche Anfragen. |
| **Regeln hinzufuegen** | Neue Konventionen gelten ab der naechsten Nachricht. |
| **Format-Regeln aendern** | Beeinflusst wie Daten gespeichert werden (z.B. Datumsformat). |
| **Datei loeschen** | Agent nutzt Tools nach eigenem Ermessen — funktioniert, aber weniger konsistent. |

## Tipps

- **"Erst suchen, dann speichern" ist die wichtigste Regel.** Ohne sie entstehen schnell doppelte Eintraege im Vault.
- **Konkrete Beispiele helfen dem LLM.** Die Gut/Schlecht-Vergleiche im Beispiel oben verbessern die Qualitaet der Eintraege deutlich.
- **Datumsformat festlegen.** `TT.MM.JJJJ` ist der oesterreichische Standard — ohne diese Regel mischt der Agent gerne ISO-Format und deutsche Schreibweise.
- **Neue Tools dokumentieren.** Wenn du eigene Tools hinzufuegst (z.B. `email_senden`), trage sie hier ein damit der Agent weiss wann er sie nutzen soll.
- **Nur im Full-Mode sichtbar.** Sub-Agenten sehen `TOOLS.md` nicht — sie verwenden Tools nach allgemeinem Wissen.

::: tip Praxis-Tipp
Wenn der Agent regelmaessig falsche Tools waehlt, pruefe zuerst `TOOLS.md`. Oft reicht ein klareres Beispiel oder eine zusaetzliche Abgrenzung.
:::
