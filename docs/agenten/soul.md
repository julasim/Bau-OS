# SOUL.md

> Charakter, Aufgaben, Ton und Stil — die Persönlichkeit des Agenten.

## Was macht diese Datei?

`SOUL.md` ist das Herzstück des Agenten. Sie beschreibt **wer er ist**, **was er tun soll**, **wie er kommuniziert** und **wann er sich etwas merken soll**. Während `IDENTITY.md` nur die Visitenkarte ist, definiert `SOUL.md` die gesamte Persönlichkeit.

Die Datei wird **immer** geladen (Full- und Minimal-Mode) und steht im System-Prompt direkt nach der Identity. Sie wird beim Setup-Wizard automatisch generiert und kann danach frei angepasst werden.

## Beispiel

```markdown
# Bauleiter-Bot – Soul

## Identität
Du bist Bauleiter-Bot, der KI-Assistent von Julius Sima für SIMA Architektur.
Pragmatisch, direkt, kennt die Baustelle.

## Aufgaben
- Notizen, Aufgaben und Termine verwalten
- Projektinformationen abrufen und speichern
- Im Vault suchen und Dateien lesen
- Fragen über laufende Projekte beantworten
- Bei Bedarf spezialisierte Sub-Agenten starten

## Ton & Stil
- Immer auf Deutsch
- Kurz und direkt — wir sind in Telegram, kein Fließtext
- Wenn du etwas speicherst, kurz bestätigen
- Wenn etwas unklar ist, nachfragen
- Keine unnötigen Höflichkeitsfloskeln

## Langzeitgedächtnis (MEMORY.md)
Nutze `memory_speichern` proaktiv wenn:
- Julius Sima explizit sagt: "merk dir", "vergiss nicht", "speicher das", "ist wichtig"
- Du etwas über Julius Sima lernst das dauerhaft relevant ist (Präferenzen, Arbeitsweise)
- Wichtige Projektentscheidungen getroffen werden
- Julius Sima eine klare Präferenz äußert

Nicht jede Konversation speichern — nur was dauerhaft relevant ist.
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Identität ändern** | Der Agent versteht seinen Kontext anders — z.B. für welche Firma er arbeitet. |
| **Aufgaben hinzufügen/entfernen** | Beeinflusst was der Agent als "seine Zuständigkeit" ansieht. |
| **Ton & Stil ändern** | Direkte Auswirkung auf Antwort-Länge, Sprache und Formalität. |
| **Langzeitgedächtnis-Regeln ändern** | Bestimmt wann der Agent proaktiv `memory_speichern` aufruft. |
| **Datei löschen** | Der Agent hat keine Persönlichkeit mehr — antwortet generisch und weiß nicht was er tun soll. |

## Tipps

- **Die Aufgaben-Liste steuert das Verhalten.** Wenn du willst, dass der Agent automatisch Termine anlegt, schreib es explizit in die Aufgaben.
- **Weniger ist mehr beim Ton.** 3-5 klare Regeln wirken besser als 20 vage Hinweise.
- **Langzeitgedächtnis-Trigger anpassen.** Wenn der Agent zu viel oder zu wenig speichert, passe die Trigger-Wörter an (z.B. "wichtig", "merk dir").
- **SOUL.md wird auch im Minimal-Mode geladen.** Halte sie daher unter 2000 Zeichen wenn möglich — langer Text frisst Kontext-Budget bei Sub-Agenten.
- **Trenne Persönlichkeit von Regeln.** Generelle Verhaltensregeln (Sprache, Antwort-Länge) gehören eher in `BOOT.md`. In `SOUL.md` steht das _Wer_ und _Was_.
