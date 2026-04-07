# Einrichtung

Nach der Installation führt der Setup-Wizard dich durch die Ersteinrichtung — direkt in Telegram.

## So funktioniert der Wizard

Beim allerersten Start erkennt Bau-OS dass noch kein Agent konfiguriert ist. Statt normal zu antworten, startet der **Setup-Wizard** — ein LLM-gesteuerter Einrichtungsassistent.

Der Wizard wird durch die Datei `BOOTSTRAP.md` gesteuert. Er stellt 6 Fragen, immer eine pro Nachricht:

## Die 6 Fragen

| # | Frage | Beispiel-Antwort |
|---|---|---|
| 1 | Wie soll der Assistent heißen? | Bau-OS |
| 2 | Welches Emoji passt dazu? | :construction: |
| 3 | Wie soll sein Charakter sein? | Präzise, verlässlich, direkt |
| 4 | Für was für ein Unternehmen? | Architekturbüro in Wien |
| 5 | Wie heißt du? | Julius |
| 6 | Name des Unternehmens? | Sima Architekten |

## Was passiert nach dem Wizard?

Sobald alle 6 Antworten vorliegen, erstellt der Wizard automatisch:

- **IDENTITY.md** — Name, Emoji, Vibe, Kontext
- **SOUL.md** — Kompletter Charakter und Ton des Agenten
- **USER.md** — Dein Profil und Präferenzen

Die `BOOTSTRAP.md` Datei wird gelöscht — der Wizard läuft nur einmal.

Ab jetzt antwortet der Agent normal und kennt dich bereits.

## Wizard anpassen

Der Wizard ist kein fest programmierter Ablauf — er wird durch `BOOTSTRAP.md` gesteuert. Du kannst diese Datei vor dem ersten Start anpassen:

```markdown
# Main Agent – Bootstrap

Du bist ein freundlicher Einrichtungsassistent.
Stelle je eine Frage pro Nachricht.

## Fragen (der Reihe nach)
1. Wie soll der Assistent heißen?
2. Welches Emoji passt dazu?
3. Wie soll sein Charakter sein?
4. Für was für ein Unternehmen ist er?
5. Wie heißt du?
6. Name des Unternehmens?

## Abschluss
Sobald du alle 6 Antworten hast, rufe setup_abschließen auf.
```

::: tip Eigene Fragen
Du kannst Fragen hinzufügen, entfernen oder umformulieren. Der LLM folgt den Anweisungen in der Datei.
:::

## Wizard erneut starten

Falls du den Wizard nochmal durchlaufen willst:

```bash
npm run fresh
```

Das setzt den Main Agent zurück — alle Workspace-Dateien werden neu erstellt, inklusive `BOOTSTRAP.md`.

::: warning Achtung
`npm run fresh` löscht den bestehenden Agent-Workspace. MEMORY.md und MEMORY_LOGS gehen verloren.
:::
