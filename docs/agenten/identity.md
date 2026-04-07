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
## Kontext: KI-Assistent fuer SIMA Architektur — ein Wiener Architekturbuero mit Schwerpunkt Wohnbau und Sanierung.
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Name aendern** | Der Agent stellt sich ab sofort mit dem neuen Namen vor. Aendert auch den Absender-Namen im Tageslog. |
| **Emoji aendern** | Rein kosmetisch — wird aktuell nur intern verwendet. |
| **Vibe aendern** | Beeinflusst den Grundcharakter des Agenten in jeder Nachricht. |
| **Kontext aendern** | Aendert den fachlichen Rahmen — z.B. von Architektur zu Generalunternehmer. |
| **Datei loeschen** | Der Agent verliert seine Identitaet. Das System erkennt ihn als "nicht konfiguriert" und startet den Setup-Wizard erneut. |

::: warning Achtung
Das System prueft `IDENTITY.md` um festzustellen, ob der Main-Agent bereits eingerichtet ist. Wenn die Datei fehlt oder kein `## Name:` enthaelt, gilt der Agent als unkonfiguriert.
:::

## Tipps

- **Halte die Datei kurz.** Sie wird bei _jeder_ Nachricht geladen, auch im Minimal-Mode. Jedes Zeichen kostet Kontext-Budget.
- **Der Vibe ist maechtig.** Ein Satz wie "Spricht Wienerisch, ist direkt und hat trockenen Humor" aendert den gesamten Ton des Agenten.
- **Sub-Agenten brauchen auch eine IDENTITY.md.** Wenn du per `agent_erstellen` einen neuen Agenten anlegst, bekommt er automatisch eine minimale Identity.
- **Format einhalten:** Die Zeilen muessen mit `## Name:`, `## Emoji:`, `## Vibe:`, `## Kontext:` beginnen — das System parst dieses Format.
