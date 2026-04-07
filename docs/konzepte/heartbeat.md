# Heartbeat

Der Heartbeat ist das proaktive System von Bau-OS. Statt nur auf Nachrichten zu reagieren, prueft der Agent regelmaessig ob es etwas Wichtiges zu melden gibt.

## Wie funktioniert es?

```
[node-cron Scheduler]
        |
        | alle 30 Min (Mo-Sa, 8-20 Uhr)
        v
[Heartbeat-Runner]
        |
        v
[Agent prueft Termine + Aufgaben]
        |
        +→ Etwas relevant? → Nachricht an Telegram
        +→ Nichts relevant? → [STILL] → keine Nachricht
```

## Konfiguration

Jeder Agent hat eine `HEARTBEAT.md` Datei:

```markdown
# Main Agent – Heartbeat

Cron: */30 8-20 * * 1-6

## Aufgaben
Pruefe ob es etwas Relevantes zu melden gibt:
1. Termine die HEUTE anstehen (nutze termine_auflisten)
2. Offene Aufgaben die ueberfaellig oder dringend sind
3. Wichtige Erinnerungen aus MEMORY.md

## Regeln
- NUR melden wenn es etwas Konkretes gibt
- Wenn NICHTS relevant ist: antworte exakt mit [STILL]
- Kurz und knapp — maximal 3-5 Zeilen
- Keine Floskeln, kein "Guten Morgen", direkt zur Sache
```

## Cron-Ausdruck

Der Cron-Ausdruck steuert wann der Heartbeat laeuft:

| Ausdruck | Bedeutung |
|---|---|
| `*/30 8-20 * * 1-6` | Alle 30 Min, Mo-Sa, 8-20 Uhr |
| `0 9 * * 1-5` | Taeglich 9 Uhr, Mo-Fr |
| `0 8,12,17 * * *` | Um 8, 12 und 17 Uhr, jeden Tag |
| `0 */2 * * 1-5` | Alle 2 Stunden, Mo-Fr |

::: tip Cron-Generator
Nutze [crontab.guru](https://crontab.guru/) um Cron-Ausdruecke zu erstellen.
:::

## Stille-Modus

Wenn der Agent nichts zu melden hat, antwortet er mit `[STILL]`. Diese Antwort wird **nicht** an Telegram weitergeleitet. So bekommst du nur Nachrichten wenn es wirklich etwas Relevantes gibt.

## Anpassen

Du kannst die HEARTBEAT.md jederzeit aendern:

- **Haeufigkeit aendern:** Cron-Ausdruck anpassen
- **Aufgaben aendern:** Was der Agent pruefen soll
- **Regeln aendern:** Wie und wann er sich melden soll
- **Deaktivieren:** Cron-Zeile entfernen oder auskommentieren

Aenderungen an der Datei werden beim naechsten **Bot-Neustart** wirksam (der Cron-Scheduler wird beim Start einmalig konfiguriert).

## Beispiel-Nachricht

Wenn heute ein Termin ansteht, bekommst du z.B.:

> 10:00 — Kundentermin Projekt Alpha (Buero Wien)
> Aufgabe ueberfaellig: "Angebot erstellen" (faellig: gestern)
