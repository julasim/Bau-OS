# AGENTS.md

> Betriebsanleitung, Prioritäten, Limits und Sub-Agenten-Regeln.

## Was macht diese Datei?

`AGENTS.md` ist die **Betriebsanleitung** des Agenten. Sie definiert seine Rolle, Prioritäten, wie er mit Sub-Agenten umgeht, und welche Grenzen er einhalten muss. Diese Datei wird nur im **Full-Mode** geladen — Sub-Agenten und btw-Nachrichten sehen sie nicht.

Hier steht das operative Wissen: Wann soll der Agent eine Aufgabe selbst erledigen, wann einen Sub-Agenten starten, und wann einfach antworten?

## Beispiel

```markdown
# Bauleiter-Bot – Operating Instructions

## Rolle
Du bist der Hauptagent für SIMA Architektur. Du verwaltest Notizen, Aufgaben,
Termine und Projektdaten im Obsidian Vault.

## Prioritäten
Bearbeite jede Nachricht in dieser Reihenfolge:
1. **Explizite Aufgaben** — User sagt klar was zu tun ist → ausführen
2. **Memory speichern** — "merk dir" / "wichtig" → memory_speichern aufrufen
3. **Sub-Agent starten** — Spezialisierte Aufgabe → agent_spawnen
4. **Kurz antworten** — Keine Aktion nötig → kurze Antwort geben

## Memory-Struktur
Der Vault ist wie folgt organisiert:
- `/Inbox/` — Notizen, schnelle Gedanken
- `/Projekte/` — Projektordner mit Unterlagen
- `/Agents/` — Agent-Workspaces
- `/Agents/Main/MEMORY_LOGS/` — Täglich Gesprächsprotokolle

## Sub-Agenten
- Nutze `agent_spawnen` für kurze, fokussierte Aufgaben
- Nutze `agent_spawnen_async` für längere Aufgaben die im Hintergrund laufen
- Sub-Agenten erben NICHT deine AGENTS.md — sie arbeiten im Minimal-Mode
- Gib Sub-Agenten eine klare, einzelne Aufgabe

## Limits
- Maximal 5 Tool-Runden pro Nachricht (MAX_TOOL_ROUNDS)
- Maximale Spawn-Tiefe: 2 (Sub-Agenten können keine weiteren Sub-Agenten starten)
- Geschuetzte Agenten (z.B. "Main") können nicht gelöscht werden
- Kontext-Budget: maximal 150.000 Zeichen für alle Workspace-Dateien zusammen
- Einzelne Dateien werden ab 20.000 Zeichen gekürzt
```

## Was passiert wenn du sie änderst?

| Änderung | Auswirkung |
|-----------|------------|
| **Prioritäten umordnen** | Ändert was der Agent zuerst tut — z.B. zuerst speichern, dann antworten. |
| **Sub-Agenten-Regeln ändern** | Beeinflusst wann und wie der Agent Sub-Agenten startet. |
| **Memory-Struktur dokumentieren** | Hilft dem Agenten, Dateien am richtigen Ort zu speichern. |
| **Limits dokumentieren** | Rein informativ für den Agenten — die echten Limits sind im Code (`config.ts`). |
| **Datei löschen** | Agent arbeitet ohne Betriebsanleitung. Funktioniert, aber er weiß nicht wie er priorisieren soll. |

::: warning Hinweis
Die numerischen Limits (5 Tool-Runden, Spawn-Tiefe 2, etc.) sind im Code festgelegt. In `AGENTS.md` stehen sie nur zur Information für den Agenten. Änderungen hier ändern nicht die echten Limits.
:::

## Tipps

- **Prioritäten-Reihenfolge ist entscheidend.** Der Agent arbeitet die Liste von oben nach unten ab. Setze das Wichtigste an Position 1.
- **Vault-Struktur dokumentieren.** Je besser der Agent die Ordnerstruktur kennt, desto zuverlässiger speichert er am richtigen Ort.
- **Sub-Agenten sparsam einsetzen.** Jeder Sub-Agent ist ein separater LLM-Aufruf. Für einfache Aufgaben besser selbst erledigen.
- **Nur im Full-Mode aktiv.** Sub-Agenten und btw-Nachrichten sehen diese Datei nicht — halte kritische Infos daher auch in `SOUL.md` oder `BOOT.md`.
