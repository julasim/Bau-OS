# BOOT.md

> Grundregeln fuer jedes Gespraech — das Verhalten, das frueher hardcoded war.

## Was macht diese Datei?

`BOOT.md` enthaelt die **Basisregeln**, die bei **jedem Gespraech** gelten. Sie wird **immer** geladen (Full- und Minimal-Mode) und steht im System-Prompt direkt nach `SOUL.md`.

Hier stehen die Regeln, die frueher im Code fest verdrahtet waren: Sprache, Antwort-Laenge, Bestaetigungs-Verhalten und Fehlerbehandlung. Durch die Auslagerung in eine Datei kann jeder Agent eigene Boot-Regeln haben — ohne Code-Aenderung.

## Beispiel

```markdown
# Bauleiter-Bot – Boot

## Bei jedem Gespraech
- Antworte immer auf Deutsch
- Halte Antworten kurz und direkt — wir sind in Telegram, kein Fliesstext
- Bestaetigungen kurz halten (z.B. "gespeichert", "erledigt")
- Bei Unsicherheit nachfragen statt raten
- Keine unnoetige Hoeflichkeitsfloskeln
- Wenn der User "morgen" sagt, berechne das Datum relativ zu heute
- Sprachnachrichten kommen als Whisper-Transkription — Tippfehler tolerieren
```

## Was passiert wenn du sie aenderst?

| Aenderung | Auswirkung |
|-----------|------------|
| **Sprach-Regel entfernen** | Der Agent koennte anfangen auf Englisch zu antworten, wenn die User-Nachricht englisch ist. |
| **"Kurz und direkt" entfernen** | Antworten werden laenger und ausfuehrlicher — schlecht fuer Telegram. |
| **Neue Regeln hinzufuegen** | Sofort wirksam ab der naechsten Nachricht. |
| **Datei loeschen** | Der Agent hat keine Grundregeln mehr. Funktioniert noch, aber Verhalten wird unvorhersagbar. |

## Tipps

- **Hier gehoeren universelle Regeln hin.** Alles was bei _jeder_ Nachricht gelten soll: Sprache, Format, Bestaetigungs-Stil.
- **Nicht mit SOUL.md verwechseln.** `SOUL.md` beschreibt _wer_ der Agent ist. `BOOT.md` beschreibt _wie_ er sich verhaelt.
- **Wird auch im Minimal-Mode geladen.** Daher moeglichst kurz halten — jede Zeile kostet Kontext bei Sub-Agenten und btw-Nachrichten.
- **Spezifische Regeln sind besser als vage.** Statt "Sei hilfsbereit" lieber "Bestaetige Speicher-Aktionen mit einem Wort (z.B. 'gespeichert')".
- **Whisper-Hinweis ist wichtig.** Wenn Sprachnachrichten genutzt werden, sollte der Agent wissen, dass Tippfehler von der Transkription kommen.

::: tip Praxis-Tipp
Teste Aenderungen an `BOOT.md` sofort per Telegram-Nachricht. Die Regeln greifen ab der naechsten Nachricht — kein Neustart noetig.
:::
