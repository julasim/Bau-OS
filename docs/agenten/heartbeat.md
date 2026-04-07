# HEARTBEAT.md

> Cron-Ausdruck und Aufgaben fuer periodische Agent-Laeufe.

## Was macht diese Datei?

`HEARTBEAT.md` steuert den **Heartbeat** — den periodischen, automatischen Lauf des Agenten. Sie definiert _wann_ der Agent von selbst aktiv wird (Cron-Ausdruck) und _was_ er dann tun soll (Aufgaben-Liste).

Die Datei wird nur im **Full-Mode** geladen. Der Heartbeat-Scheduler liest die Cron-Zeile aus der Datei und triggert den Agenten entsprechend. Der Agent fuehrt dann die definierten Aufgaben aus und entscheidet ob er eine Nachricht senden soll — oder still bleibt (`[STILL]`).

Mehr zur Heartbeat-Architektur unter [/konzepte/heartbeat](/konzepte/heartbeat).

## Beispiel

```markdown
# Bauleiter-Bot – Heartbeat

Cron: */30 8-20 * * 1-6

## Aufgaben
Pruefe ob es etwas Relevantes zu melden gibt:
1. Termine die HEUTE anstehen (nutze termine_auflisten)
2. Offene Aufgaben die ueberfaellig oder dringend sind (nutze aufgaben_auflisten)
3. Wichtige Erinnerungen aus MEMORY.md

## Regeln
- NUR melden wenn es etwas Konkretes gibt (Termin heute, ueberfaellige Aufgabe)
- Wenn NICHTS relevant ist: antworte exakt mit [STILL] — keine Nachricht wird gesendet
- Kurz und knapp — maximal 3-5 Zeilen
- Keine Floskeln, kein "Guten Morgen", direkt zur Sache
- Termine: Uhrzeit + was ansteht
- Aufgaben: nur ueberfaellige oder heute faellige
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Cron-Ausdruck aendern** | Aendert wie oft und wann der Agent automatisch laeuft. Z.B. `0 9 * * 1-5` fuer einmal taeglich um 9:00, nur Werktage. |
| **Aufgaben aendern** | Agent prueft andere Dinge bei jedem Heartbeat-Lauf. |
| **[STILL]-Regel entfernen** | Agent sendet bei _jedem_ Heartbeat eine Nachricht — auch wenn nichts ansteht. |
| **Regeln verschaerfen** | Weniger Nachrichten, nur bei wirklich wichtigen Dingen. |
| **Datei loeschen** | Heartbeat fuer diesen Agenten wird deaktiviert — keine automatischen Laeufe mehr. |

## Cron-Ausdruck Referenz

| Ausdruck | Bedeutung |
|----------|-----------|
| `*/30 8-20 * * 1-6` | Alle 30 Minuten, 8:00-20:00, Montag-Samstag |
| `0 9 * * 1-5` | Taeglich um 9:00, nur Werktage |
| `0 9,13,18 * * *` | Um 9:00, 13:00 und 18:00, jeden Tag |
| `*/15 * * * *` | Alle 15 Minuten, rund um die Uhr |

## Tipps

- **`[STILL]` ist entscheidend.** Ohne diese Konvention wuerde der Agent bei jedem Heartbeat eine Nachricht senden — auch wenn es nichts zu melden gibt. Das nervt schnell.
- **Cron-Ausdruecke testen.** Nutze [crontab.guru](https://crontab.guru) um den Ausdruck zu pruefen bevor du ihn eintraegst.
- **Weniger ist mehr.** Ein Heartbeat alle 30 Minuten erzeugt bis zu 24 LLM-Aufrufe pro Tag. Ueberlege ob taeglich oder 3x am Tag reicht.
- **Aufgaben muessen Tool-Aufrufe erwaehnen.** Der Agent weiss nur was er pruefen soll wenn du die konkreten Tools nennst (z.B. `termine_auflisten`).
- **Zeitzone ist Europe/Vienna.** Alle Cron-Zeiten werden in der konfigurierten Zeitzone (`TIMEZONE` in `config.ts`) ausgewertet.

::: tip Praxis-Tipp
Starte mit einem konservativen Zeitplan (z.B. 3x taeglich) und erhoehe die Frequenz nur wenn noetig. Jeder Heartbeat-Lauf kostet einen LLM-Aufruf.
:::
