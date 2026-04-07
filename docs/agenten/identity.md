# IDENTITY.md

> Name, Emoji, Vibe und Kontext des Agenten — die Visitenkarte.

## Was macht diese Datei?

`IDENTITY.md` definiert **wer der Agent ist** in vier Feldern: Name, Emoji, Vibe (Charakter-Kurzform) und Kontext (Unternehmensumfeld). Sie wird **immer** geladen — sowohl im Full-Mode als auch im Minimal-Mode (z.B. bei btw-Nachrichten oder Sub-Agenten).

Die Datei ist das Erste, was der Agent im System-Prompt sieht. Sie wird beim Setup-Wizard automatisch generiert (via `setup_abschliessen`) und kann danach manuell oder per `agent_datei_schreiben` angepasst werden.

## Beispiel

```markdown
# Identity

## Name: Bauleiter-Bot
## Emoji: 🏗️
## Vibe: Pragmatisch, direkt, kennt die Baustelle
## Kontext: KI-Assistent für SIMA Architektur — ein Wiener Architekturbüro mit Schwerpunkt Wohnbau und Sanierung.
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Name ändern** | Der Agent stellt sich ab sofort mit dem neuen Namen vor. Ändert auch den Absender-Namen im Tageslog. |
| **Emoji ändern** | Rein kosmetisch — wird aktuell nur intern verwendet. |
| **Vibe ändern** | Beeinflusst den Grundcharakter des Agenten in jeder Nachricht. |
| **Kontext ändern** | Ändert den fachlichen Rahmen — z.B. von Architektur zu Generalunternehmer. |
| **Datei löschen** | Der Agent verliert seine Identität. Das System erkennt ihn als "nicht konfiguriert" und startet den Setup-Wizard erneut. |

::: warning Achtung
Das System prüft `IDENTITY.md` um festzustellen, ob der Main-Agent bereits eingerichtet ist. Wenn die Datei fehlt oder kein `## Name:` enthält, gilt der Agent als unkonfiguriert.
:::

## Tipps

- **Halte die Datei kurz.** Sie wird bei _jeder_ Nachricht geladen, auch im Minimal-Mode. Jedes Zeichen kostet Kontext-Budget.
- **Der Vibe ist mächtig.** Ein Satz wie "Spricht Wienerisch, ist direkt und hat trockenen Humor" ändert den gesamten Ton des Agenten.
- **Sub-Agenten brauchen auch eine IDENTITY.md.** Wenn du per `agent_erstellen` einen neuen Agenten anlegst, bekommt er automatisch eine minimale Identity.
- **Format einhalten:** Die Zeilen müssen mit `## Name:`, `## Emoji:`, `## Vibe:`, `## Kontext:` beginnen — das System parst dieses Format.
