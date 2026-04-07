# BOOT.md

> Grundregeln für jedes Gespräch — das Verhalten, das früher hardcoded war.

## Was macht diese Datei?

`BOOT.md` enthält die **Basisregeln**, die bei **jedem Gespräch** gelten. Sie wird **immer** geladen (Full- und Minimal-Mode) und steht im System-Prompt direkt nach `SOUL.md`.

Hier stehen die Regeln, die früher im Code fest verdrahtet waren: Sprache, Antwort-Länge, Bestätigungs-Verhalten und Fehlerbehandlung. Durch die Auslagerung in eine Datei kann jeder Agent eigene Boot-Regeln haben — ohne Code-Änderung.

## Beispiel

```markdown
# Bauleiter-Bot – Boot

## Bei jedem Gespräch
- Antworte immer auf Deutsch
- Halte Antworten kurz und direkt — wir sind in Telegram, kein Fließtext
- Bestätigungen kurz halten (z.B. "gespeichert", "erledigt")
- Bei Unsicherheit nachfragen statt raten
- Keine unnötige Höflichkeitsfloskeln
- Wenn der User "morgen" sagt, berechne das Datum relativ zu heute
- Sprachnachrichten kommen als Whisper-Transkription — Tippfehler tolerieren
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Sprach-Regel entfernen** | Der Agent könnte anfangen auf Englisch zu antworten, wenn die User-Nachricht englisch ist. |
| **"Kurz und direkt" entfernen** | Antworten werden länger und ausführlicher — schlecht für Telegram. |
| **Neue Regeln hinzufügen** | Sofort wirksam ab der nächsten Nachricht. |
| **Datei löschen** | Der Agent hat keine Grundregeln mehr. Funktioniert noch, aber Verhalten wird unvorhersagbar. |

## Tipps

- **Hier gehören universelle Regeln hin.** Alles was bei _jeder_ Nachricht gelten soll: Sprache, Format, Bestätigungs-Stil.
- **Nicht mit SOUL.md verwechseln.** `SOUL.md` beschreibt _wer_ der Agent ist. `BOOT.md` beschreibt _wie_ er sich verhält.
- **Wird auch im Minimal-Mode geladen.** Daher möglichst kurz halten — jede Zeile kostet Kontext bei Sub-Agenten und btw-Nachrichten.
- **Spezifische Regeln sind besser als vage.** Statt "Sei hilfsbereit" lieber "Bestätige Speicher-Aktionen mit einem Wort (z.B. 'gespeichert')".
- **Whisper-Hinweis ist wichtig.** Wenn Sprachnachrichten genutzt werden, sollte der Agent wissen, dass Tippfehler von der Transkription kommen.

::: tip Praxis-Tipp
Teste Änderungen an `BOOT.md` sofort per Telegram-Nachricht. Die Regeln greifen ab der nächsten Nachricht — kein Neustart nötig.
:::
