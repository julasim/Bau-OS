# HEARTBEAT.md

> Cron-Ausdruck und Aufgaben für periodische Agent-Laeufe.

## Was macht diese Datei?

`HEARTBEAT.md` steuert den **Heartbeat** — den periodischen, automatischen Lauf des Agenten. Sie definiert _wann_ der Agent von selbst aktiv wird (Cron-Ausdruck) und _was_ er dann tun soll (Aufgaben-Liste).

Die Datei wird nur im **Full-Mode** geladen. Der Heartbeat-Scheduler liest die Cron-Zeile aus der Datei und triggert den Agenten entsprechend. Der Agent führt dann die definierten Aufgaben aus und entscheidet ob er eine Nachricht senden soll — oder still bleibt (`[STILL]`).

Mehr zur Heartbeat-Architektur unter [/konzepte/heartbeat](/konzepte/heartbeat).

## Beispiel

```markdown
# Bauleiter-Bot – Heartbeat

Cron: */30 8-20 * * 1-6

## Aufgaben
Prüfe ob es etwas Relevantes zu melden gibt:
1. Termine die HEUTE anstehen (nutze termine_auflisten)
2. Offene Aufgaben die überfällig oder dringend sind (nutze aufgaben_auflisten)
3. Wichtige Erinnerungen aus MEMORY.md

## Regeln
- NUR melden wenn es etwas Konkretes gibt (Termin heute, überfällige Aufgabe)
- Wenn NICHTS relevant ist: antworte exakt mit [STILL] — keine Nachricht wird gesendet
- Kurz und knapp — maximal 3-5 Zeilen
- Keine Floskeln, kein "Guten Morgen", direkt zur Sache
- Termine: Uhrzeit + was ansteht
- Aufgaben: nur überfällige oder heute fällige
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Cron-Ausdruck ändern** | Ändert wie oft und wann der Agent automatisch läuft. Z.B. `0 9 * * 1-5` für einmal täglich um 9:00, nur Werktage. |
| **Aufgaben ändern** | Agent prüft andere Dinge bei jedem Heartbeat-Lauf. |
| **[STILL]-Regel entfernen** | Agent sendet bei _jedem_ Heartbeat eine Nachricht — auch wenn nichts ansteht. |
| **Regeln verschaerfen** | Weniger Nachrichten, nur bei wirklich wichtigen Dingen. |
| **Datei löschen** | Heartbeat für diesen Agenten wird deaktiviert — keine automatischen Laeufe mehr. |

## Cron-Ausdruck Referenz

| Ausdruck | Bedeutung |
|----------|-----------|
| `*/30 8-20 * * 1-6` | Alle 30 Minuten, 8:00-20:00, Montag-Samstag |
| `0 9 * * 1-5` | Täglich um 9:00, nur Werktage |
| `0 9,13,18 * * *` | Um 9:00, 13:00 und 18:00, jeden Tag |
| `*/15 * * * *` | Alle 15 Minuten, rund um die Uhr |

## Tipps

- **`[STILL]` ist entscheidend.** Ohne diese Konvention würde der Agent bei jedem Heartbeat eine Nachricht senden — auch wenn es nichts zu melden gibt. Das nervt schnell.
- **Cron-Ausdrücke testen.** Nutze [crontab.guru](https://crontab.guru) um den Ausdruck zu prüfen bevor du ihn einträgst.
- **Weniger ist mehr.** Ein Heartbeat alle 30 Minuten erzeugt bis zu 24 LLM-Aufrufe pro Tag. Überlege ob täglich oder 3x am Tag reicht.
- **Aufgaben müssen Tool-Aufrufe erwaehnen.** Der Agent weiß nur was er prüfen soll wenn du die konkreten Tools nennst (z.B. `termine_auflisten`).
- **Zeitzone ist Europe/Vienna.** Alle Cron-Zeiten werden in der konfigurierten Zeitzone (`TIMEZONE` in `config.ts`) ausgewertet.

::: tip Praxis-Tipp
Starte mit einem konservativen Zeitplan (z.B. 3x täglich) und erhöhe die Frequenz nur wenn nötig. Jeder Heartbeat-Lauf kostet einen LLM-Aufruf.
:::
