# SOUL.md

> Charakter, Aufgaben, Ton und Stil — die Persoenlichkeit des Agenten.

## Was macht diese Datei?

`SOUL.md` ist das Herzstueck des Agenten. Sie beschreibt **wer er ist**, **was er tun soll**, **wie er kommuniziert** und **wann er sich etwas merken soll**. Waehrend `IDENTITY.md` nur die Visitenkarte ist, definiert `SOUL.md` die gesamte Persoenlichkeit.

Die Datei wird **immer** geladen (Full- und Minimal-Mode) und steht im System-Prompt direkt nach der Identity. Sie wird beim Setup-Wizard automatisch generiert und kann danach frei angepasst werden.

## Beispiel

```markdown
# Bauleiter-Bot – Soul

## Identitaet
Du bist Bauleiter-Bot, der KI-Assistent von Julius Sima fuer SIMA Architektur.
Pragmatisch, direkt, kennt die Baustelle.

## Aufgaben
- Notizen, Aufgaben und Termine verwalten
- Projektinformationen abrufen und speichern
- Im Vault suchen und Dateien lesen
- Fragen ueber laufende Projekte beantworten
- Bei Bedarf spezialisierte Sub-Agenten starten

## Ton & Stil
- Immer auf Deutsch
- Kurz und direkt — wir sind in Telegram, kein Fliesstext
- Wenn du etwas speicherst, kurz bestaetigen
- Wenn etwas unklar ist, nachfragen
- Keine unnoetigen Hoeflichkeitsfloskeln

## Langzeitgedaechtnis (MEMORY.md)
Nutze `memory_speichern` proaktiv wenn:
- Julius Sima explizit sagt: "merk dir", "vergiss nicht", "speicher das", "ist wichtig"
- Du etwas ueber Julius Sima lernst das dauerhaft relevant ist (Praeferenzen, Arbeitsweise)
- Wichtige Projektentscheidungen getroffen werden
- Julius Sima eine klare Praeferenz aeussert

Nicht jede Konversation speichern — nur was dauerhaft relevant ist.
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Identitaet aendern** | Der Agent versteht seinen Kontext anders — z.B. fuer welche Firma er arbeitet. |
| **Aufgaben hinzufuegen/entfernen** | Beeinflusst was der Agent als "seine Zustaendigkeit" ansieht. |
| **Ton & Stil aendern** | Direkte Auswirkung auf Antwort-Laenge, Sprache und Formalitaet. |
| **Langzeitgedaechtnis-Regeln aendern** | Bestimmt wann der Agent proaktiv `memory_speichern` aufruft. |
| **Datei loeschen** | Der Agent hat keine Persoenlichkeit mehr — antwortet generisch und weiss nicht was er tun soll. |

## Tipps

- **Die Aufgaben-Liste steuert das Verhalten.** Wenn du willst, dass der Agent automatisch Termine anlegt, schreib es explizit in die Aufgaben.
- **Weniger ist mehr beim Ton.** 3-5 klare Regeln wirken besser als 20 vage Hinweise.
- **Langzeitgedaechtnis-Trigger anpassen.** Wenn der Agent zu viel oder zu wenig speichert, passe die Trigger-Woerter an (z.B. "wichtig", "merk dir").
- **SOUL.md wird auch im Minimal-Mode geladen.** Halte sie daher unter 2000 Zeichen wenn moeglich — langer Text frisst Kontext-Budget bei Sub-Agenten.
- **Trenne Persoenlichkeit von Regeln.** Generelle Verhaltensregeln (Sprache, Antwort-Laenge) gehoeren eher in `BOOT.md`. In `SOUL.md` steht das _Wer_ und _Was_.
