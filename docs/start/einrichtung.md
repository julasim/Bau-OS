# Einrichtung

Nach der Installation fuehrt der Setup-Wizard dich durch die Ersteinrichtung — direkt in Telegram.

## So funktioniert der Wizard

Beim allerersten Start erkennt Bau-OS dass noch kein Agent konfiguriert ist. Statt normal zu antworten, startet der **Setup-Wizard** — ein LLM-gesteuerter Einrichtungsassistent.

Der Wizard wird durch die Datei `BOOTSTRAP.md` gesteuert. Er stellt 6 Fragen, immer eine pro Nachricht:

## Die 6 Fragen

| # | Frage | Beispiel-Antwort |
|---|---|---|
| 1 | Wie soll der Assistent heissen? | Bau-OS |
| 2 | Welches Emoji passt dazu? | :construction: |
| 3 | Wie soll sein Charakter sein? | Praezise, verlaesslich, direkt |
| 4 | Fuer was fuer ein Unternehmen? | Architekturbuero in Wien |
| 5 | Wie heisst du? | Julius |
| 6 | Name des Unternehmens? | Sima Architekten |

## Was passiert nach dem Wizard?

Sobald alle 6 Antworten vorliegen, erstellt der Wizard automatisch:

- **IDENTITY.md** — Name, Emoji, Vibe, Kontext
- **SOUL.md** — Kompletter Charakter und Ton des Agenten
- **USER.md** — Dein Profil und Praeferenzen

Die `BOOTSTRAP.md` Datei wird geloescht — der Wizard laeuft nur einmal.

Ab jetzt antwortet der Agent normal und kennt dich bereits.

## Wizard anpassen

Der Wizard ist kein fest programmierter Ablauf — er wird durch `BOOTSTRAP.md` gesteuert. Du kannst diese Datei vor dem ersten Start anpassen:

```markdown
# Main Agent – Bootstrap

Du bist ein freundlicher Einrichtungsassistent.
Stelle je eine Frage pro Nachricht.

## Fragen (der Reihe nach)
1. Wie soll der Assistent heissen?
2. Welches Emoji passt dazu?
3. Wie soll sein Charakter sein?
4. Fuer was fuer ein Unternehmen ist er?
5. Wie heisst du?
6. Name des Unternehmens?

## Abschluss
Sobald du alle 6 Antworten hast, rufe setup_abschliessen auf.
```

::: tip Eigene Fragen
Du kannst Fragen hinzufuegen, entfernen oder umformulieren. Der LLM folgt den Anweisungen in der Datei.
:::

## Wizard erneut starten

Falls du den Wizard nochmal durchlaufen willst:

```bash
npm run fresh
```

Das setzt den Main Agent zurueck — alle Workspace-Dateien werden neu erstellt, inklusive `BOOTSTRAP.md`.

::: warning Achtung
`npm run fresh` loescht den bestehenden Agent-Workspace. MEMORY.md und MEMORY_LOGS gehen verloren.
:::
