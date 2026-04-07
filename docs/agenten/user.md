# USER.md

> Benutzerprofil — Name, Firma, Praeferenzen und Arbeitsweise.

## Was macht diese Datei?

`USER.md` beschreibt den **Benutzer** des Agenten. Sie enthaelt Informationen ueber die Person, ihre Firma, Kommunikations-Praeferenzen und Arbeitsweise. Der Agent nutzt diese Informationen um Antworten besser auf den Benutzer zuzuschneiden.

Die Datei wird nur im **Full-Mode** geladen und beim Setup-Wizard automatisch generiert. Sie kann danach manuell oder per `agent_datei_schreiben` angepasst werden.

## Beispiel

```markdown
# User – Julius Sima

## Profil
- Benutzer von SIMA Architektur
- Sprache: Deutsch

## Arbeitsweise
- Bevorzugt kurze, direkte Antworten
- Nutzt Sprachnachrichten haeufig (via Whisper transkribiert)
- Arbeitet oft mobil von der Baustelle
- Plant morgens, arbeitet nachmittags an Projekten

## Hinweise
- Wenn Julius "morgen" sagt → Datum relativ zu heute berechnen
- Wenn unklar ob Notiz oder Aufgabe → lieber nachfragen
- Projekte werden intern mit Kurznamen bezeichnet (z.B. "Meierhof", "Ringstrasse")
- Kosten immer netto angeben, ausser explizit anders gewuenscht
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Name aendern** | Agent spricht den Benutzer mit anderem Namen an. |
| **Praeferenzen hinzufuegen** | Agent beruecksichtigt neue Praeferenzen ab der naechsten Nachricht. |
| **Arbeitsweise dokumentieren** | Agent passt Timing und Format seiner Antworten an. |
| **Hinweise hinzufuegen** | Agent beachtet spezifische Konventionen (z.B. Kostenformat, Projektnamen). |
| **Datei loeschen** | Agent kennt den Benutzer nicht mehr — antwortet generisch. |

## Tipps

- **Je spezifischer, desto besser.** "Nutzt Sprachnachrichten" ist hilfreicher als "Kommuniziert per Telegram" — der Agent weiss dann, dass Tippfehler normal sind.
- **Projekt-Konventionen hier eintragen.** Wenn Projekte Kurznamen haben, dokumentiere sie in `USER.md`. So versteht der Agent "Meierhof" ohne nachzufragen.
- **Unterschied zu MEMORY.md:** `USER.md` enthaelt _statische_ Informationen ueber den Benutzer. `MEMORY.md` enthaelt _gelernte_ Fakten aus Gespraechen. Beides ergaenzt sich.
- **Nicht zu lang machen.** `USER.md` wird bei jeder Nachricht im Full-Mode geladen. Halte sie unter 1000 Zeichen fuer optimale Performance.
- **Mehrere Benutzer?** Aktuell unterstuetzt jeder Agent nur ein Benutzerprofil. Fuer mehrere Benutzer separate Agenten anlegen.

::: tip Praxis-Tipp
Wenn der Agent immer wieder die gleichen Fragen stellt (z.B. "Meinst du netto oder brutto?"), ist das ein Zeichen dafuer, dass ein Hinweis in `USER.md` fehlt.
:::
