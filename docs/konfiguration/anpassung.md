# Anpassung

Bau-OS ist modular aufgebaut und laesst sich auf mehreren Ebenen anpassen — von einfachen Agent-Dateien bis hin zu eigenen Workflows.

## Agenten-Dateien bearbeiten

Jeder Agent besteht aus Markdown-Dateien im Vault unter `Agents/<Name>/`. Diese Dateien steuern Persoenlichkeit, Verhalten und Wissen des Agenten.

### Per LLM-Tool (im Chat)

Der einfachste Weg: Bitte den Bot, seine eigenen Dateien zu bearbeiten.

```
Aendere deine Identity so, dass du immer mit "Servus!" gruesst.
```

```
Fuege zu deinem Boot-Prompt hinzu, dass du morgens immer
nach offenen Aufgaben fragen sollst.
```

Der Agent verwendet sein File-Editor-Tool, um die entsprechende Datei im Vault zu aktualisieren.

::: tip
Das funktioniert fuer alle Agent-Dateien: Identity, Soul, Boot, User-Profil und mehr. Siehe die [Agenten-Dokumentation](/agenten/identity) fuer Details zu jeder Datei.
:::

### Direkt im Vault

Oeffne die Dateien in Obsidian oder einem beliebigen Texteditor:

```
Agents/
  Main/
    IDENTITY.md        # Name, Rolle, Persoenlichkeit
    SOUL.md            # Verhaltensprinzipien
    BOOT.md            # Startanweisungen
    USER.md            # Benutzerprofil
    MEMORY_LOGS/       # Tagesberichte (automatisch)
```

::: warning
Nach direkten Aenderungen an Agent-Dateien muss der Bot nicht neu gestartet werden — die Dateien werden bei jeder Interaktion neu geladen. Aenderungen an `src/config.ts` erfordern hingegen einen Neustart.
:::

## Neue Agenten erstellen

### Agent-Konfiguration

Fuege einen neuen Agenten in `src/config.ts` hinzu:

```typescript
export const AGENTS = [
  { name: "Main", model: DEFAULT_MODEL, protected: true,
    description: "Haupt-Agent" },
  { name: "Kalkulator", model: DEFAULT_MODEL, protected: false,
    description: "Kalkulations-Agent (OENORM)" },
];
```

| Feld | Beschreibung |
|---|---|
| `name` | Eindeutiger Name (wird als Ordnername im Vault verwendet) |
| `model` | LLM-Modell fuer diesen Agenten |
| `protected` | Geschuetzte Agenten koennen nicht geloescht werden |
| `description` | Kurzbeschreibung fuer `/agents`-Ausgabe |

### Vault-Ordner anlegen

Erstelle den Ordner `Agents/<Name>/` im Vault und lege die gewuenschten Dateien an:

```
Agents/
  Kalkulator/
    IDENTITY.md
    SOUL.md
    BOOT.md
```

::: tip Minimal-Setup
Nur `IDENTITY.md` ist zwingend noetig. Alle anderen Dateien sind optional und verwenden Standardwerte, wenn sie fehlen.
:::

### Agent per Chat erstellen

Du kannst den Haupt-Agenten auch bitten, einen neuen Agenten einzurichten:

```
Erstelle einen neuen Agenten namens "Recherche" der auf
Internetrecherche spezialisiert ist.
```

## Workflows bauen

Workflows sind mehrstufige Ablaeufe, die mehrere Tools und Agenten kombinieren.

### Beispiel: Morgenbriefing

Erstelle eine Anweisung im `BOOT.md` des Agenten:

```markdown
## Morgenbriefing

Wenn der Benutzer "Guten Morgen" sagt oder /heute verwendet:

1. Lies die offenen Aufgaben aus dem Vault
2. Pruefe den Kalender fuer heute
3. Fasse alles in einem kurzen Briefing zusammen
4. Frage nach Prioritaeten fuer den Tag
```

### Beispiel: Wochenbericht

```markdown
## Wochenbericht

Wenn der Benutzer nach einem Wochenbericht fragt:

1. Lade die Tagesberichte der letzten 7 Tage
2. Extrahiere erledigte Aufgaben und Meilensteine
3. Identifiziere offene Punkte
4. Erstelle eine strukturierte Zusammenfassung
5. Speichere den Bericht im Vault unter Berichte/
```

## Heartbeat anpassen

Der Heartbeat ist ein automatischer Trigger, der den Agenten in regelmaessigen Abstaenden aktiviert — auch ohne Benutzer-Nachricht.

### Zeitplan aendern

Der Heartbeat-Zeitplan wird in der Heartbeat-Konfiguration des Agenten definiert. Standardmaessig laeuft er zu festen Zeiten (z.B. morgens und abends).

Um den Zeitplan zu aendern, bearbeite die Heartbeat-Datei des Agenten im Vault:

```
Agents/Main/HEARTBEAT.md
```

### Beispiel-Konfiguration

```markdown
## Heartbeat-Zeitplan

- 07:00 — Morgenbriefing erstellen
- 12:00 — Mittags-Check: offene Aufgaben pruefen
- 18:00 — Tagesbericht generieren und speichern
```

::: tip
Der Heartbeat ist optional. Wenn keine Heartbeat-Datei existiert, laeuft der Agent nur auf Anfrage.
:::

### Heartbeat per Chat anpassen

```
Aendere deinen Heartbeat so, dass du mich jeden Morgen
um 8 Uhr an meine Termine erinnerst.
```

## Erweiterte Anpassungen

### Eigene Slash-Befehle

Neue Befehle werden im Quellcode registriert. Erstelle einen Handler in der Command-Registry:

```typescript
// Neuen Befehl registrieren
commands.set("meinbefehl", {
  description: "Beschreibung des Befehls",
  handler: async (ctx) => {
    // Befehlslogik hier
    await ctx.reply("Antwort");
  },
});
```

Nach der Aenderung: `npm run build` und Bot neu starten.

### Eigene Tools

Agenten koennen um neue Tools erweitert werden. Jedes Tool ist eine Funktion, die der Agent im Agentic Loop aufrufen kann. Siehe die [Tool-Dokumentation](/agenten/tools) fuer Details.

### Konfigurationswerte aendern

Feste Werte wie `MAX_TOOL_ROUNDS` oder `MAX_HISTORY_CHARS` lassen sich in `src/config.ts` anpassen:

```typescript
// Mehr Iterationen im Agentic Loop erlauben
export const MAX_TOOL_ROUNDS = 10;

// Groesseren Gespraechspuffer nutzen
export const MAX_HISTORY_CHARS = 120_000;
```

::: warning
Hoehere Werte fuer `MAX_TOOL_ROUNDS` und `MAX_HISTORY_CHARS` erhoehen den Token-Verbrauch und koennen die Antwortzeit verlaengern. Aendere diese Werte nur, wenn du weisst was du tust.
:::
