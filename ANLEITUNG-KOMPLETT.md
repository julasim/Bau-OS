# Bau-OS – Vollständige Code-Anleitung

> Jede Datei, jede Funktion, jede wichtige Zeile erklärt.
> Geschrieben damit du verstehst was passiert — nicht nur dass es passiert.

---

## Grundkonzepte die du zuerst kennen solltest

Bevor wir in den Code gehen, ein paar Begriffe die überall auftauchen:

---

### Was ist `import` / `export`?

Code-Dateien sind wie Werkzeugkisten. Damit Datei A ein Werkzeug aus Datei B nutzen kann, muss B es "exportieren" und A es "importieren".

```typescript
// In obsidian.ts — Funktion wird exportiert (nach außen verfügbar gemacht)
export function saveNote(content: string) { ... }

// In bot.ts — Funktion wird importiert (von außen geholt)
import { saveNote } from "./obsidian.js";
```

Das `.js` am Ende obwohl die Datei `.ts` heißt: TypeScript wird zu JavaScript kompiliert. Node.js läuft mit JavaScript — deshalb zeigt der Import auf `.js`.

---

### Was ist `async` / `await`?

Manche Operationen dauern eine Weile — zum Beispiel eine Datei runterladen oder auf Telegrams Server warten. Damit das Programm in dieser Zeit nicht "einfriert" und andere Nachrichten bearbeiten kann, nutzen wir `async`/`await`.

```typescript
// OHNE async — Programm wartet blockierend
const antwort = telegram.schickNachricht("Hallo");  // alles steht still

// MIT async — Programm kann andere Dinge tun während es wartet
const antwort = await telegram.schickNachricht("Hallo");  // nicht blockierend
```

Jede Funktion die `await` nutzt, muss selbst `async` sein.

---

### Was sind TypeScript-Typen?

TypeScript fügt JavaScript "Typen" hinzu. Du sagst dem Code was eine Variable sein darf:

```typescript
const name: string = "Julius";     // muss ein Text sein
const anzahl: number = 42;         // muss eine Zahl sein
const aktiv: boolean = true;       // muss true oder false sein

// Optional (darf auch leer sein — "undefined")
const projekt?: string             // entweder ein Text oder leer
```

Wenn du einen Fehler machst (z.B. eine Zahl wo ein Text erwartet wird), zeigt der Editor das sofort rot an — bevor du den Code überhaupt startest. Das spart viel Zeit.

---

### Was ist `process.env`?

`process.env` ist ein Objekt das alle Umgebungsvariablen enthält — also alles was in deiner `.env` Datei steht.

```typescript
process.env.BOT_TOKEN    // gibt "8799580169:AAG..." zurück
process.env.VAULT_PATH   // gibt den Vault-Pfad zurück
```

Der `!` am Ende (`process.env.VAULT_PATH!`) sagt TypeScript: "Ich verspreche dir dass dieser Wert nicht leer ist."

---

### Was ist `ctx` in Telegram-Befehlen?

`ctx` steht für "Context" — der Kontext einer Telegram-Nachricht. Er enthält:
- Die Nachricht selbst (`ctx.message.text`)
- Wer sie geschickt hat
- Methoden zum Antworten (`ctx.reply("...")`)
- Alles nach dem Befehlswort (`ctx.match`)

```typescript
// Jemand schickt: /notiz Hallo Welt
ctx.match  // = "Hallo Welt"  (alles nach /notiz)
```

---

## Datei für Datei

---

# `.env` — Konfiguration

```
BOT_TOKEN=8799580169:AAGWWGBGp_ig-BYIU6qzDH8-YldIapuPWtA
VAULT_PATH=C:\Users\juliu\...\Bau OS
PYTHON_PATH=python
WHISPER_LANG=de
```

**Jede Zeile erklärt:**

`BOT_TOKEN` — Der geheime Schlüssel deines Telegram Bots. Wer diesen Token kennt, kann als dein Bot agieren und Nachrichten schicken. Deshalb kommt diese Datei NIE ins Git.

`VAULT_PATH` — Der absolute Pfad zu deinem Obsidian Vault auf diesem Computer. Auf dem Linux-Server wird das ein anderer Pfad sein (z.B. `/home/julius/vault`).

`PYTHON_PATH` — Welches Python-Programm verwendet werden soll. `python` bedeutet: das Python das im PATH ist. Wenn es nicht gefunden wird, kann man hier den vollen Pfad eintragen.

`WHISPER_LANG` — Die Sprache für die Transkription. `de` = Deutsch, `en` = Englisch, `auto` = automatisch erkennen (unzuverlässiger).

---

# `package.json` — Projektbeschreibung

```json
{
  "name": "bau-os",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "grammy": "^1.42.0",
    "dotenv": "^17.4.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.2",
    "@types/node": "^25.5.2"
  }
}
```

**Zeile für Zeile:**

`"type": "module"` — Sagt Node.js: "Wir nutzen moderne ES-Module (`import`/`export`) statt dem alten `require()`-System."

`"dev": "tsx watch src/index.ts"` — `tsx` ist ein Tool das TypeScript direkt ausführt (ohne erst zu kompilieren). `watch` bedeutet: bei jeder Dateiänderung automatisch neustarten. Das ist dein Entwicklungsbefehl.

`"build": "tsc"` — `tsc` ist der TypeScript-Compiler. Er liest `tsconfig.json` und wandelt alle `.ts` Dateien in `.js` Dateien um (in den `dist/` Ordner).

`"start": "node dist/index.js"` — Startet den kompilierten Code. Für den Produktionsbetrieb auf dem Server.

**Dependencies (Libraries):**

`grammy` — Die Telegram Bot Library. Sie kümmert sich um die gesamte Kommunikation mit Telegram: Nachrichten empfangen, antworten, Dateien senden, etc.

`dotenv` — Lädt die `.env` Datei und macht alle Werte in `process.env` verfügbar.

`tsx` — Führt TypeScript direkt aus, ohne Kompilierungsschritt. Nur für Entwicklung.

`typescript` — Der TypeScript-Compiler selbst.

`@types/node` — TypeScript-Typdefinitionen für Node.js. Damit weiß TypeScript was z.B. `fs.readFileSync()` zurückgibt.

---

# `tsconfig.json` — TypeScript-Konfiguration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`"target": "ES2022"` — Welche JavaScript-Version erzeugt werden soll. ES2022 ist modern und wird von Node.js 24 voll unterstützt.

`"module": "NodeNext"` — Wie Module importiert werden. NodeNext ist der moderne Standard für Node.js.

`"outDir": "dist"` — Kompilierte Dateien kommen in den `dist/` Ordner.

`"rootDir": "src"` — Quellcode liegt in `src/`.

`"strict": true` — Strenger Modus. Viele häufige Fehler werden sofort angezeigt. Besonders: keine impliziten `any`-Typen (TypeScript muss immer wissen was eine Variable ist).

`"esModuleInterop": true` — Ermöglicht `import fs from "fs"` statt dem älteren `import * as fs from "fs"`. Einfacher zu schreiben.

`"skipLibCheck": true` — Prüft Typen in installierten Libraries nicht — spart Kompilierungszeit.

---

# `whisper_transcribe.py` — Python Audio-Transkription

```python
import whisper    # die Whisper-Library von OpenAI
import sys        # für Programmargumente (sys.argv)
import os         # für Umgebungsvariablen (os.environ)

def main():
    # sys.argv ist eine Liste der Programmargumente
    # sys.argv[0] = der Scriptname selbst
    # sys.argv[1] = das erste Argument = der Audio-Pfad
    if len(sys.argv) < 2:
        print("Fehler: Kein Audio-Pfad angegeben.", file=sys.stderr)
        sys.exit(1)   # Programm mit Fehlercode beenden

    audio_path = sys.argv[1]                              # z.B. "C:\Temp\voice_123.ogg"
    model_name = sys.argv[2] if len(sys.argv) > 2 else "tiny"  # Standard: tiny

    # Sprache aus Umgebungsvariable lesen (von Node.js gesetzt)
    lang = os.environ.get("WHISPER_LANG", "de")
    language = None if lang == "auto" else lang  # None = automatisch erkennen

    # Whisper-Modell laden (beim ersten Mal wird es heruntergeladen)
    model = whisper.load_model(model_name)

    # Audio transkribieren
    result = model.transcribe(audio_path, language=language)

    # Nur den Text ausgeben — Node.js liest diese Ausgabe (stdout)
    print(result["text"].strip())

# Standard Python-Muster: nur ausführen wenn direkt aufgerufen
if __name__ == "__main__":
    main()
```

**Warum `sys.argv`?**
Wenn Node.js dieses Script aufruft, sieht es so aus:
```
python whisper_transcribe.py C:\Temp\voice_123.ogg
```
`sys.argv` ist dann: `["whisper_transcribe.py", "C:\\Temp\\voice_123.ogg"]`
Index 0 = Scriptname, Index 1 = erster Parameter.

**Warum `stdout`?**
Node.js ruft Python als Unterprozess auf und liest was Python auf die "Standardausgabe" schreibt (`print()`). So kommunizieren die zwei Programme miteinander.

**Whisper-Modelle:**
- `tiny` — Schnellstes Modell, ~150MB, gut genug für Sprachmemos
- `base` — Etwas besser, ~300MB
- `small` — Noch besser, ~500MB
- `medium` — Sehr gut, ~1.5GB
- `large` — Bestes Modell, ~3GB

---

# `src/index.ts` — Der Startpunkt

```typescript
import "dotenv/config";          // lädt .env → process.env befüllt
import { createBot } from "./bot.js";  // importiert createBot aus bot.ts

// Werte aus .env lesen
const token = process.env.BOT_TOKEN;
const vaultPath = process.env.VAULT_PATH;

// Sicherheitsprüfung: wenn ein Wert fehlt, sofort mit klarer Fehlermeldung abbrechen
// "throw new Error" beendet das Programm und zeigt die Nachricht
if (!token) throw new Error("BOT_TOKEN fehlt in .env");
if (!vaultPath) throw new Error("VAULT_PATH fehlt in .env");

// Bot erstellen (konfiguriert alle Commands)
const bot = createBot(token);

// Statusmeldung in der Konsole
console.log("Bau-OS gestartet...");

// Bot starten — verbindet sich mit Telegram und wartet auf Nachrichten
bot.start();
```

**Warum so kurz?**
`index.ts` ist bewusst minimal. Er ist nur der "Zündschlüssel". Die gesamte Logik ist in `bot.ts` und den anderen Dateien. Das macht es einfacher den Bot später auf verschiedene Arten zu starten (z.B. als HTTP-Webhook statt Long-Polling).

**Was ist Long-Polling?**
`bot.start()` startet Long-Polling. Das bedeutet: der Bot fragt Telegrams Server ständig: "Gibt es neue Nachrichten?" — wenn ja, verarbeitet er sie sofort. Alternative wäre Webhook (Telegram ruft den Bot aktiv an), das braucht aber eine öffentliche URL.

---

# `src/bot.ts` — Das Befehlsregister

```typescript
import { Bot } from "grammy";   // Die Bot-Klasse aus der grammy-Library
import fs from "fs";             // Node.js Dateisystem-Modul
import { saveNote } from "./obsidian.js";
import { downloadFile, transcribeAudio, getTempPath } from "./transcribe.js";

// Alle Command-Handler importieren
import { handleNotiz, handleNotizen, handleLesen, handleBearbeiten, handleLoeschen } from "./commands/notiz.js";
import { handleAufgabe, handleAufgaben, handleErledigt } from "./commands/aufgaben.js";
import { handleTermin, handleTermine, handleTerminLoeschen } from "./commands/termine.js";
import { handleProjekt, handleProjekte, handleProjektInfo } from "./commands/projekte.js";
import { handleDateiLesen, handleDateiErstellen, handleDateiLoeschen, handleOrdnerListe, handleExportieren } from "./commands/dateien.js";
import { handleSuchen } from "./commands/suchen.js";
import { handleHilfe, handleStatus, handleSprache } from "./commands/system.js";
```

**`export function createBot(token: string): Bot`**
Diese Funktion nimmt den Token, erstellt einen Bot und gibt ihn zurück.
- `export` — damit `index.ts` sie importieren kann
- `token: string` — der Parameter muss ein Text sein
- `: Bot` — die Funktion gibt ein Bot-Objekt zurück

```typescript
export function createBot(token: string): Bot {
  const bot = new Bot(token);  // Bot-Objekt erstellen, Token übergeben
```

**Commands registrieren:**
```typescript
bot.command("notiz", (ctx) => handleNotiz(ctx, ctx.match));
```
Diese Zeile sagt: "Wenn jemand `/notiz` schickt, rufe `handleNotiz` auf."
- `(ctx) => ...` ist eine Arrow-Function (Kurzform einer Funktion)
- `ctx.match` ist alles was nach `/notiz` steht

**Warum Umlaute doppelt?**
```typescript
bot.command("loschen",  (ctx) => handleLoeschen(ctx, ctx.match));  // ohne Umlaut
bot.command("löschen",  (ctx) => handleLoeschen(ctx, ctx.match));  // mit Umlaut
```
Telegram-Bots dürfen technisch Sonderzeichen in Commands haben, aber manche Clients schicken sie ohne. Zur Sicherheit beide Varianten registriert.

**Text-Handler:**
```typescript
bot.on("message:text", async (ctx) => {
  try {
    const filepath = saveNote(ctx.message.text);  // Text speichern
    const filename = filepath.split(/[\\/]/).pop();  // nur Dateiname aus vollem Pfad
    await ctx.reply(`Gespeichert: ${filename}`);
  } catch (err) {
    console.error("Fehler:", err);  // Fehler in der Konsole anzeigen
    await ctx.reply("Fehler beim Speichern.");  // User informieren
  }
});
```
`bot.on("message:text", ...)` — reagiert auf ALLE Textnachrichten die kein Befehl sind.
`try/catch` — wenn ein Fehler passiert (z.B. Vault nicht erreichbar), wird er abgefangen statt das Programm zum Absturz zu bringen.
`filepath.split(/[\\/]/).pop()` — trennt den Pfad bei `/` oder `\` und nimmt das letzte Element (den Dateinamen).

**Voice-Handler:**
```typescript
bot.on("message:voice", async (ctx) => {
  await ctx.reply("Transkribiere...");  // sofortiges Feedback, Transkription dauert

  const file = await ctx.getFile();  // Telegram gibt File-Objekt zurück (noch kein Download)
  // Download-URL zusammenbauen: Telegram-API-Muster
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  // Temporären Dateipfad generieren: voice_1712345678.ogg im Temp-Ordner
  const tempPath = getTempPath(`voice_${Date.now()}.ogg`);

  try {
    await downloadFile(fileUrl, tempPath);    // Audiodatei herunterladen
    const text = await transcribeAudio(tempPath);  // Python/Whisper aufrufen

    if (!text) {  // leere Transkription abfangen
      await ctx.reply("Transkription leer – bitte nochmal versuchen.");
      return;
    }

    const filepath = saveNote(text);  // in Vault speichern
    const filename = filepath.split(/[\\/]/).pop();
    await ctx.reply(`Gespeichert: ${filename}\n\n"${text}"`);  // mit Vorschau antworten
  } catch (err) {
    console.error("Fehler bei Transkription:", err);
    await ctx.reply("Fehler bei der Transkription.");
  } finally {
    // finally läuft IMMER — egal ob Erfolg oder Fehler
    // Temp-Datei aufräumen damit sich kein Audio-Müll ansammelt
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});
```

`Date.now()` gibt die aktuelle Zeit als Zahl zurück (Millisekunden seit 1970). Damit hat jede Temp-Datei einen einzigartigen Namen.

`finally` — dieser Block läuft immer, egal was passiert. Ideal zum Aufräumen.

---

# `src/obsidian.ts` — Die Vault-Zentrale

Das Herzstück. Alle Dateioperationen laufen über diese Datei.

```typescript
import fs from "fs";      // Node.js Dateisystem: lesen, schreiben, löschen
import path from "path";  // Pfade plattformunabhängig zusammenbauen

const vaultPath = process.env.VAULT_PATH!;
// Das ! sagt TypeScript: "Dieser Wert ist garantiert nicht undefined"
// (weil wir in index.ts bereits prüfen ob er gesetzt ist)
```

## Die internen Hilfsfunktionen (nicht exportiert)

Diese Funktionen sind nur intern — andere Dateien können sie nicht direkt aufrufen.

---

**`timestampFilename()`**
```typescript
function timestampFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
```
Erzeugt einen Dateinamen aus dem aktuellen Zeitstempel.
- `new Date()` — aktuelles Datum/Uhrzeit
- `.toISOString()` — gibt z.B. `"2026-04-04T14:32:00.000Z"` zurück
- `.replace(/[:.]/g, "-")` — ersetzt alle `:` und `.` mit `-` (ungültig in Dateinamen)
- `.slice(0, 19)` — nur die ersten 19 Zeichen: `"2026-04-04T14-32-00"`

Ergebnis: `2026-04-04T14-32-00.md`

---

**`frontmatter()`**
```typescript
function frontmatter(source = "telegram"): string {
  const now = new Date();
  const date = now.toLocaleDateString("de-AT", { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  return `---\ncreated: ${date} ${time}\nsource: ${source}\n---\n\n`;
}
```
Erzeugt den YAML-Frontmatter-Block am Anfang jeder Notiz:
```
---
created: 04.04.2026 14:32
source: telegram
---
```
`"de-AT"` — österreichisches Datumsformat (04.04.2026 statt 04/04/2026).
`source = "telegram"` — Standardwert, kann überschrieben werden.

---

**`ensureDir()`**
```typescript
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
```
Erstellt einen Ordner — aber nur wenn er noch nicht existiert.
`{ recursive: true }` — erstellt auch alle übergeordneten Ordner. Also wenn `Projekte/Wohnbau-Linz/Notizen` noch nicht existiert, werden alle drei Ebenen auf einmal erstellt.

---

**`resolveNotePath()`**
```typescript
function resolveNotePath(nameOrPath: string): string | null {
  const withExt = nameOrPath.endsWith(".md") ? nameOrPath : nameOrPath + ".md";
  // Dateinamen sicherstellen: falls kein .md am Ende, anhängen

  // Zuerst direkte Pfade prüfen (schnell)
  for (const candidate of [
    path.join(vaultPath, withExt),              // Vault-Root
    path.join(vaultPath, "Inbox", withExt),     // Inbox
  ]) {
    if (fs.existsSync(candidate)) return candidate;  // gefunden!
  }

  // Falls nicht direkt gefunden: rekursiv durch den ganzen Vault suchen
  function searchDir(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchDir(full);  // Rekursion: Unterordner durchsuchen
        if (found) return found;
      } else if (entry.name === withExt || entry.name.includes(nameOrPath)) {
        return full;  // Datei gefunden
      }
    }
    return null;  // nichts gefunden
  }

  return searchDir(vaultPath);
}
```
Diese Funktion findet eine Datei auch wenn der User nur einen Teilnamen angibt.
`{ withFileTypes: true }` — gibt statt nur Namen auch den Typ zurück (Datei oder Ordner).
`entry.isDirectory()` — prüft ob es ein Ordner ist (für Rekursion).

---

## Die exportierten Notiz-Funktionen

**`saveNote(content, project?)`**
```typescript
export function saveNote(content: string, project?: string): string {
  // Ziel-Ordner bestimmen
  const folder = project
    ? path.join(vaultPath, "Projekte", project, "Notizen")  // mit Projekt
    : path.join(vaultPath, "Inbox");                         // ohne Projekt

  ensureDir(folder);  // Ordner erstellen falls nicht vorhanden

  const filename = timestampFilename() + ".md";           // Dateiname generieren
  const filepath = path.join(folder, filename);           // vollständiger Pfad

  // Datei schreiben: Frontmatter + Inhalt + Zeilenumbruch
  fs.writeFileSync(filepath, frontmatter() + content + "\n", "utf-8");

  return filepath;  // Pfad zurückgeben (damit bot.ts den Dateinamen anzeigen kann)
}
```

**`listNotes(limit)`**
```typescript
export function listNotes(limit = 10): string[] {
  const inboxPath = path.join(vaultPath, "Inbox");
  if (!fs.existsSync(inboxPath)) return [];  // leeres Array wenn Inbox nicht existiert

  return fs.readdirSync(inboxPath)     // alle Dateien im Ordner
    .filter(f => f.endsWith(".md"))    // nur .md Dateien
    .sort()                            // alphabetisch sortieren (= chronologisch, da Timestamp im Namen)
    .reverse()                         // umkehren → neueste zuerst
    .slice(0, limit)                   // nur die ersten N Dateien
    .map(f => f.replace(".md", ""));   // .md-Endung entfernen für Anzeige
}
```

**`readNote(nameOrPath)`**
```typescript
export function readNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);  // Datei finden
  if (!filepath) return null;                     // null = nicht gefunden
  return fs.readFileSync(filepath, "utf-8");      // Inhalt als Text zurückgeben
}
```
`"utf-8"` — Zeichenkodierung. Ohne das käme ein Buffer-Objekt zurück statt lesbarem Text.

**`appendToNote(nameOrPath, content)`**
```typescript
export function appendToNote(nameOrPath: string, content: string): boolean {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return false;  // false = nicht gefunden

  const now = new Date();
  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  // Nachtrag mit Zeitstempel anhängen (fettgedruckt dank **)
  fs.appendFileSync(filepath, `\n**Nachtrag ${time}:** ${content}\n`, "utf-8");
  return true;  // true = erfolgreich
}
```
`appendFileSync` — hängt Text ANhängen statt zu überschreiben.

**`deleteNote(nameOrPath)`**
```typescript
export function deleteNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return null;

  const filename = path.basename(filepath);  // nur Dateiname (ohne Ordnerpfad)
  fs.unlinkSync(filepath);                   // Datei löschen
  return filename;                           // Dateiname zurückgeben für Bestätigung
}
```

---

## Die Aufgaben-Funktionen

**`tasksFilePath(project?)`** — interne Hilfsfunktion
```typescript
function tasksFilePath(project?: string): string {
  return project
    ? path.join(vaultPath, "Projekte", project, "Aufgaben.md")
    : path.join(vaultPath, "Aufgaben.md");
}
```
Gibt je nach Projekt den richtigen Pfad zurück. Wird von allen drei Aufgaben-Funktionen genutzt.

**`saveTask(text, project?)`**
```typescript
export function saveTask(text: string, project?: string): void {
  const filepath = tasksFilePath(project);
  ensureDir(path.dirname(filepath));  // path.dirname = Ordner des Pfads

  if (!fs.existsSync(filepath)) {
    // Datei noch nicht vorhanden → mit Überschrift erstellen
    fs.writeFileSync(filepath, project ? `# Aufgaben – ${project}\n\n` : `# Aufgaben\n\n`, "utf-8");
  }

  // Aufgabe als Markdown-Checkbox anhängen
  fs.appendFileSync(filepath, `- [ ] ${text}\n`, "utf-8");
}
```
Das `- [ ] ` ist Markdown-Syntax für eine offene Checkbox. Obsidian zeigt das als anklickbare Checkbox an.

**`listTasks(project?)`**
```typescript
export function listTasks(project?: string): string[] {
  const filepath = tasksFilePath(project);
  if (!fs.existsSync(filepath)) return [];

  return fs.readFileSync(filepath, "utf-8")
    .split("\n")                           // in einzelne Zeilen aufteilen
    .filter(line => line.startsWith("- [ ]"))  // nur offene Aufgaben
    .map(line => line.replace("- [ ] ", "").trim());  // Checkbox-Prefix entfernen
}
```
Nur Zeilen die mit `- [ ]` beginnen werden zurückgegeben — erledigte (`- [x]`) werden ignoriert.

**`completeTask(text, project?)`**
```typescript
export function completeTask(text: string, project?: string): boolean {
  const filepath = tasksFilePath(project);
  if (!fs.existsSync(filepath)) return false;

  const content = fs.readFileSync(filepath, "utf-8");
  const needle = `- [ ] ${text}`;          // was gesucht wird

  if (!content.includes(needle)) return false;  // nicht gefunden

  // Offene durch erledigte Checkbox ersetzen
  fs.writeFileSync(filepath, content.replace(needle, `- [x] ${text}`), "utf-8");
  return true;
}
```
`.replace()` ersetzt nur das erste Vorkommen. Das ist gewollt — wenn zwei identische Aufgaben existieren, wird nur die erste erledigt.

---

## Die Termin-Funktionen

Funktionieren nach demselben Prinzip wie Aufgaben, aber mit eigenem Format.

**`saveTermin(datum, text, uhrzeit?, project?)`**
```typescript
export function saveTermin(datum: string, text: string, uhrzeit?: string, project?: string): void {
  const filepath = termineFilePath(project);
  ensureDir(path.dirname(filepath));

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, project ? `# Termine – ${project}\n\n` : `# Termine\n\n`, "utf-8");
  }

  // Format: "- [ ] 10.04.2026 | 09:00 | Baubesprechung" (mit Uhrzeit)
  //     oder "- [ ] 10.04.2026 | Abnahme" (ohne Uhrzeit)
  const entry = uhrzeit
    ? `- [ ] ${datum} | ${uhrzeit} | ${text}\n`
    : `- [ ] ${datum} | ${text}\n`;
  fs.appendFileSync(filepath, entry, "utf-8");
}
```
Das `|` als Trennzeichen zwischen Datum, Uhrzeit und Text macht das Format klar lesbar.

---

## Die Projekt-Funktionen

**`createProject(name)`**
```typescript
export function createProject(name: string): string {
  const projectPath = path.join(vaultPath, "Projekte", name);

  ensureDir(path.join(projectPath, "Notizen"));  // Notizen-Unterordner erstellen

  // Objekt mit Dateiname → Inhalt Paaren
  const files: Record<string, string> = {
    "Aufgaben.md": `# Aufgaben – ${name}\n\n`,
    "Termine.md": `# Termine – ${name}\n\n`,
    "README.md": `# ${name}\n\nErstellt: ${new Date().toLocaleDateString("de-AT")}\n`,
  };

  // Alle drei Dateien erstellen (nur wenn noch nicht vorhanden)
  for (const [filename, content] of Object.entries(files)) {
    const fp = path.join(projectPath, filename);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content, "utf-8");
  }

  return projectPath;
}
```
`Record<string, string>` — TypeScript-Typ für ein Objekt wo sowohl Schlüssel als auch Wert Texte sind.
`Object.entries()` — gibt ein Array von `[schlüssel, wert]` Paaren zurück, damit man mit `for` drüber iterieren kann.

**`getProjectInfo(name)`**
```typescript
export function getProjectInfo(name: string): string | null {
  const projectPath = path.join(vaultPath, "Projekte", name);
  if (!fs.existsSync(projectPath)) return null;

  // Vorhandene Funktionen wiederverwenden
  const openTasks = listTasks(name).length;    // .length = Anzahl
  const termine = listTermine(name).length;
  const notesDir = path.join(projectPath, "Notizen");
  const noteCount = fs.existsSync(notesDir)
    ? fs.readdirSync(notesDir).filter(f => f.endsWith(".md")).length
    : 0;

  // Einen formatierten Text zurückgeben (kein Objekt — direkt für ctx.reply())
  return `Projekt: ${name}\n\nNotizen: ${noteCount}\nOffene Aufgaben: ${openTasks}\nTermine: ${termine}`;
}
```

---

## Die Datei-Operationen

**`readFile(relativePath)`**
```typescript
export function readFile(relativePath: string): string | null {
  // relativePath ist immer relativ zum Vault: "Projekte/Wohnbau/README.md"
  const filepath = path.join(vaultPath, relativePath);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}
```

**`listFolder(relativePath)`**
```typescript
export function listFolder(relativePath = ""): string[] {
  // Leerer String = Vault-Root anzeigen
  const folderPath = relativePath ? path.join(vaultPath, relativePath) : vaultPath;
  if (!fs.existsSync(folderPath)) return [];

  return fs.readdirSync(folderPath, { withFileTypes: true })
    .map(e => e.isDirectory() ? `📁 ${e.name}` : `📄 ${e.name}`)  // Emoji je nach Typ
    .sort();  // alphabetisch sortieren
}
```

**`getAbsolutePath(relativePath)`**
```typescript
export function getAbsolutePath(relativePath: string): string {
  return path.join(vaultPath, relativePath);
}
```
Wird von `exportieren` gebraucht: grammY's `InputFile` braucht einen absoluten Pfad.

---

## Die Suche

**`searchVault(query, limitTo?)`**
```typescript
export interface SearchResult {  // TypeScript: so sieht ein Suchergebnis aus
  file: string;   // relativer Pfad der Datei
  line: string;   // die gefundene Zeile (max. 100 Zeichen)
}

export function searchVault(query: string, limitTo?: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();  // Suche case-insensitive machen

  // Startpunkt: ganzer Vault oder nur ein Projektordner
  const searchRoot = limitTo
    ? path.join(vaultPath, "Projekte", limitTo)
    : vaultPath;

  // Rekursive innere Funktion
  function searchDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(full);  // Rekursion: in Unterordner gehen
      } else if (entry.name.endsWith(".md")) {
        const lines = fs.readFileSync(full, "utf-8").split("\n");
        for (const line of lines) {
          if (line.toLowerCase().includes(lowerQuery) && line.trim()) {
            results.push({
              file: path.relative(vaultPath, full),  // relativer Pfad für Anzeige
              line: line.trim().slice(0, 100),        // max. 100 Zeichen
            });
            break;  // nur ersten Treffer pro Datei, dann nächste Datei
          }
        }
      }
    }
  }

  searchDir(searchRoot);
  return results.slice(0, 10);  // maximal 10 Ergebnisse
}
```
`path.relative(vaultPath, full)` — wandelt einen absoluten Pfad in einen relativen um. Aus `C:\Users\...\Bau OS\Inbox\notiz.md` wird `Inbox\notiz.md`.

---

# `src/transcribe.ts` — Audio-Bridge

```typescript
import { exec } from "child_process";  // Node.js: externe Programme aufrufen
import { promisify } from "util";       // Callback-Funktion zu Promise machen
import fs from "fs";
import path from "path";
import os from "os";                    // Betriebssystem-Infos (Temp-Ordner etc.)

// exec() nutzt normalerweise Callbacks (altes System)
// promisify() macht daraus ein Promise (modernes async/await System)
const execAsync = promisify(exec);

const pythonPath = process.env.PYTHON_PATH || "python";
// || "python" = falls PYTHON_PATH nicht gesetzt, "python" als Standard

// __dirname gibt es in ES-Modulen nicht mehr
// process.cwd() = aktuelles Arbeitsverzeichnis (= Projektordner)
const scriptPath = path.join(process.cwd(), "whisper_transcribe.py");
```

**`downloadFile(url, dest)`**
```typescript
export async function downloadFile(url: string, dest: string): Promise<void> {
  // fetch() ist seit Node.js 18 eingebaut (kein Import nötig)
  const res = await fetch(url);

  // HTTP-Statuscode prüfen (200 = OK, alles andere = Fehler)
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);

  // Antwort als binäre Daten (ArrayBuffer) lesen
  const buffer = await res.arrayBuffer();

  // Als Datei speichern (Buffer.from konvertiert ArrayBuffer zu Node.js Buffer)
  fs.writeFileSync(dest, Buffer.from(buffer));
}
```
`Promise<void>` — die Funktion gibt nichts zurück (void), aber sie ist async.

**`transcribeAudio(audioPath)`**
```typescript
export async function transcribeAudio(audioPath: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    // Befehl zusammenbauen: python "pfad/zum/script.py" "pfad/zur/audio.ogg"
    // Anführungszeichen um Pfade wegen Leerzeichen (z.B. in "KI- Autonom")
    `"${pythonPath}" "${scriptPath}" "${audioPath}"`,
    {
      timeout: 120_000,  // 120 Sekunden Timeout (Whisper kann lange dauern)
      env: {
        ...process.env,                 // alle bestehenden Umgebungsvariablen beibehalten
        PYTHONIOENCODING: "utf-8",      // Python: UTF-8 für Ausgabe erzwingen (Umlaute!)
        WHISPER_LANG: process.env.WHISPER_LANG ?? "de"  // Sprache übergeben
      }
    }
  );

  if (stderr) console.error("Whisper stderr:", stderr);  // Warnungen loggen (nicht Fehler)
  return stdout.trim();  // Leerzeichen/Zeilenumbrüche am Anfang/Ende entfernen
}
```
`{ ...process.env }` — der Spread-Operator kopiert alle Eigenschaften eines Objekts. So haben wir alle bestehenden Env-Variablen PLUS die neuen.
`?? "de"` — der Nullish-Coalescing-Operator: wenn der linke Wert `null` oder `undefined` ist, nimm den rechten.

**`getTempPath(filename)`**
```typescript
export function getTempPath(filename: string): string {
  return path.join(os.tmpdir(), filename);
  // os.tmpdir() = C:\Users\juliu\AppData\Local\Temp (Windows)
  //            = /tmp (Linux)
}
```
Plattformunabhängig — funktioniert gleich auf Windows und Linux.

---

# `src/commands/notiz.ts`

```typescript
import type { Context } from "grammy";
// "import type" — nur für TypeScript-Typprüfung, kein echter Import zur Laufzeit
// Optimierung: macht den kompilierten Code kleiner
```

**`parseProjectAndText(args)`** — interne Hilfsfunktion
```typescript
function parseProjectAndText(args: string): { project?: string; text: string } {
  const colonIndex = args.indexOf(":");  // Position des ersten Doppelpunkts
  if (colonIndex > 0) {  // 0 bedeutet ganz am Anfang = kein Projektname davor
    const project = args.slice(0, colonIndex).trim();   // vor dem Doppelpunkt
    const text = args.slice(colonIndex + 1).trim();      // nach dem Doppelpunkt
    if (project && text) return { project, text };       // nur wenn beide nicht leer
  }
  return { text: args.trim() };  // kein Doppelpunkt = kein Projekt
}
```

Beispiel: `"Wohnbau-Linz: Deckenschalung verzögert"`
- `colonIndex = 13`
- `project = "Wohnbau-Linz"`
- `text = "Deckenschalung verzögert"`

**`handleNotiz(ctx, args)`**
```typescript
export async function handleNotiz(ctx: Context, args: string): Promise<void> {
  if (!args) {  // kein Text nach /notiz
    await ctx.reply("Verwendung: /notiz Text\nMit Projekt: /notiz Projektname: Text");
    return;  // frühzeitig beenden (kein else nötig)
  }

  const { project, text } = parseProjectAndText(args);  // Objekt-Destructuring
  const filepath = saveNote(text, project);
  const filename = filepath.split(/[\\/]/).pop();  // letztes Element nach / oder \

  // Ternärer Operator: kurzform für if/else in einem Ausdruck
  const reply = project
    ? `Notiz gespeichert in [${project}]\n${filename}`
    : `Notiz gespeichert\n${filename}`;

  await ctx.reply(reply);
}
```

**`handleLesen(ctx, args)`**
```typescript
export async function handleLesen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /lesen Dateiname");
    return;
  }

  const content = readNote(args.trim());
  if (!content) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  // Telegram erlaubt maximal 4096 Zeichen pro Nachricht
  // Wir kürzen bei 3800 damit noch etwas Puffer bleibt
  const text = content.length > 3800
    ? content.slice(0, 3800) + "\n\n… (gekürzt)"
    : content;

  await ctx.reply(text);
}
```

**`handleBearbeiten(ctx, args)`**
```typescript
export async function handleBearbeiten(ctx: Context, args: string): Promise<void> {
  // args muss Format "Dateiname: Nachtrag" haben
  const colonIndex = args.indexOf(":");
  if (colonIndex < 0) {  // kein Doppelpunkt gefunden
    await ctx.reply("Format: /bearbeiten Dateiname: Nachtrag-Text");
    return;
  }

  const filename = args.slice(0, colonIndex).trim();   // vor dem :
  const nachtrag = args.slice(colonIndex + 1).trim();  // nach dem :

  const success = appendToNote(filename, nachtrag);
  if (!success) {
    await ctx.reply(`Datei nicht gefunden: ${filename}`);
    return;
  }

  await ctx.reply(`Nachtrag gespeichert in: ${filename}`);
}
```

---

# `src/commands/aufgaben.ts`

Funktioniert nach demselben Muster wie notiz.ts — Parsing, Datenbankoperation, Antwort.

**`handleErledigt(ctx, args)`** — der interessanteste Handler
```typescript
export async function handleErledigt(ctx: Context, args: string): Promise<void> {
  const { project, text } = parseProjectAndText(args);
  const success = completeTask(text, project);

  if (!success) {
    // Hilfreich: User direkt sagen wie er die richtige Aufgabe findet
    await ctx.reply(`Aufgabe nicht gefunden: "${text}"\n\nMit /aufgaben alle offenen Aufgaben anzeigen.`);
    return;
  }

  await ctx.reply(`Erledigt: ✓ ${text}`);
}
```
Der Text muss exakt mit der gespeicherten Aufgabe übereinstimmen (da wir nach `- [ ] TEXT` suchen). Tippfehler führen zu "nicht gefunden".

---

# `src/commands/termine.ts`

**`parseTermin(args)`** — die komplexeste Parse-Funktion
```typescript
function parseTermin(args: string): { project?, datum, uhrzeit?, text } | null {
  let input = args.trim();
  let project: string | undefined;

  // Projekt-Erkennung: Doppelpunkt vor Position 30 (Projektname ist kurz)
  const colonIndex = input.indexOf(":");
  if (colonIndex > 0 && colonIndex < 30) {
    project = input.slice(0, colonIndex).trim();
    input = input.slice(colonIndex + 1).trim();
  }

  // Rest in Wörter aufteilen: "10.04.2026 09:00 Baubesprechung"
  const parts = input.split(/\s+/);  // \s+ = ein oder mehrere Leerzeichen
  if (parts.length < 2) return null;  // mindestens Datum + Text nötig

  const datum = parts[0];  // erstes Wort = Datum

  // Prüfen ob zweites Wort eine Uhrzeit ist (Format: 9:00 oder 09:00)
  const timeRegex = /^\d{1,2}:\d{2}$/;
  // ^ = Anfang, \d{1,2} = 1-2 Ziffern, : = Doppelpunkt, \d{2} = 2 Ziffern, $ = Ende

  if (parts.length >= 3 && timeRegex.test(parts[1])) {
    // Mit Uhrzeit: parts[0]=Datum, parts[1]=Uhrzeit, parts[2+]=Text
    return { project, datum, uhrzeit: parts[1], text: parts.slice(2).join(" ") };
  }

  // Ohne Uhrzeit: parts[0]=Datum, parts[1+]=Text
  return { project, datum, text: parts.slice(1).join(" ") };
}
```

---

# `src/commands/projekte.ts`

Der einfachste Command-Handler — ruft direkt obsidian.ts auf ohne viel eigene Logik.

```typescript
export async function handleProjekt(ctx: Context, args: string): Promise<void> {
  const name = args.trim();
  const projectPath = createProject(name);  // Ordnerstruktur erstellen

  // Bestätigung mit Übersicht der erstellten Struktur
  await ctx.reply(
    `Projekt angelegt: ${name}\n\nOrdnerstruktur erstellt:\n📁 Notizen/\n📄 Aufgaben.md\n📄 Termine.md\n📄 README.md`
  );
}
```

---

# `src/commands/dateien.ts`

**`handleExportieren(ctx, args)`** — einziger Handler der grammY direkt nutzt
```typescript
export async function handleExportieren(ctx: Context, args: string): Promise<void> {
  const absolutePath = getAbsolutePath(args.trim());

  if (!fs.existsSync(absolutePath)) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  const filename = absolutePath.split(/[\\/]/).pop()!;
  // InputFile = grammY-Klasse die eine lokale Datei für Telegram verpackt
  // Erster Parameter: Dateipfad, Zweiter Parameter: Dateiname wie er in Telegram erscheint
  await ctx.replyWithDocument(new InputFile(absolutePath, filename));
}
```
`ctx.replyWithDocument()` — sendet eine Datei als Dokument (Download) statt als Text.

---

# `src/commands/suchen.ts`

```typescript
export async function handleSuchen(ctx: Context, args: string): Promise<void> {
  let project: string | undefined;
  let query = args.trim();

  const colonIndex = args.indexOf(":");
  if (colonIndex > 0) {
    project = args.slice(0, colonIndex).trim();
    query = args.slice(colonIndex + 1).trim();
  }

  const results = searchVault(query, project);

  if (results.length === 0) { ... return; }

  // Ergebnisse formatieren: Dateiname + gefundene Zeile
  const lines = results.map(r => `📄 ${r.file}\n   ${r.line}`).join("\n\n");
  // .map() = jedes Element transformieren
  // .join("\n\n") = mit Leerzeile verbinden
  const header = `${results.length} Treffer für "${query}":\n\n`;
  await ctx.reply(header + lines);
}
```

---

# `src/commands/system.ts`

**Die HILFE-Konstante:**
```typescript
const HILFE = `
Bau-OS – Befehle
...
`.trim();
```
Ein Template-String (Backtick-Strings erlauben mehrere Zeilen). `.trim()` entfernt Leerzeilen am Anfang und Ende.

**`handleStatus(ctx)`**
```typescript
export async function handleStatus(ctx: Context): Promise<void> {
  const vault = vaultExists();    // boolean: true/false
  const vaultPath = getVaultPath();
  const whisperLang = process.env.WHISPER_LANG ?? "de";  // ?? = Standardwert
  const pythonPath = process.env.PYTHON_PATH ?? "python";

  let inboxCount = 0;
  let taskCount = 0;

  if (vault) {  // nur zählen wenn Vault erreichbar
    const inboxPath = `${vaultPath}/Inbox`;
    const tasksPath = `${vaultPath}/Aufgaben.md`;

    if (fs.existsSync(inboxPath)) {
      inboxCount = fs.readdirSync(inboxPath).filter(f => f.endsWith(".md")).length;
    }
    if (fs.existsSync(tasksPath)) {
      taskCount = fs.readFileSync(tasksPath, "utf-8")
        .split("\n")
        .filter(l => l.startsWith("- [ ]")).length;
    }
  }

  // Template-String für formatierte Ausgabe
  const status = `
Bau-OS Status

Vault: ${vault ? "✓ erreichbar" : "✗ nicht gefunden"}
...
  `.trim();

  await ctx.reply(status);
}
```

**`handleSprache(ctx, args)`**
```typescript
export async function handleSprache(ctx: Context, args: string): Promise<void> {
  const lang = args?.trim().toLowerCase();
  // ?. = Optional Chaining: falls args undefined ist, nicht crashen sondern undefined zurückgeben

  if (!["de", "en", "auto"].includes(lang)) {  // Array.includes() = ist Wert in Array?
    await ctx.reply("Verwendung: /sprache de|en|auto");
    return;
  }

  process.env.WHISPER_LANG = lang;  // Umgebungsvariable zur Laufzeit ändern
  await ctx.reply(`Whisper-Sprache geändert auf: ${lang}`);
}
```
`process.env.WHISPER_LANG = lang` ändert die Variable nur im aktuellen Prozess — nach einem Neustart gilt wieder was in `.env` steht.

---

## Wie alles zusammen funktioniert — Komplettes Beispiel

### `/aufgabe Wohnbau-Linz: Elektrik Erdgeschoss prüfen`

```
1. Du tippst: /aufgabe Wohnbau-Linz: Elektrik Erdgeschoss prüfen

2. Telegram → Telegram-Server → Long-Polling → grammY empfängt

3. bot.ts:
   bot.command("aufgabe", (ctx) => handleAufgabe(ctx, ctx.match))
   ctx.match = "Wohnbau-Linz: Elektrik Erdgeschoss prüfen"

4. commands/aufgaben.ts → handleAufgabe():
   parseProjectAndText("Wohnbau-Linz: Elektrik Erdgeschoss prüfen")
   colonIndex = 12
   project = "Wohnbau-Linz"
   text = "Elektrik Erdgeschoss prüfen"
   → saveTask("Elektrik Erdgeschoss prüfen", "Wohnbau-Linz")

5. obsidian.ts → saveTask():
   tasksFilePath("Wohnbau-Linz")
   → "C:\...\Bau OS\Projekte\Wohnbau-Linz\Aufgaben.md"
   ensureDir("C:\...\Bau OS\Projekte\Wohnbau-Linz")
   Datei existiert nicht → erstellen mit "# Aufgaben – Wohnbau-Linz\n\n"
   appendFileSync → "- [ ] Elektrik Erdgeschoss prüfen\n" anhängen

6. commands/aufgaben.ts → ctx.reply():
   "Aufgabe gespeichert in [Wohnbau-Linz]
    ☐ Elektrik Erdgeschoss prüfen"

7. Obsidian zeigt in Aufgaben.md:
   - [ ] Elektrik Erdgeschoss prüfen
```

---

## Warum dieses Design die Zukunft vorbereitet

Die aktuelle Struktur ist bewusst so gebaut, dass das LLM nahtlos integriert werden kann:

```
Heute:
Du → /aufgabe Text → bot.ts → commands/aufgaben.ts → obsidian.ts → Vault

Morgen mit LLM:
Du → "Erinnere mich Elektrik zu prüfen" → bot.ts → LLM-Layer
  → LLM entscheidet: "Das ist eine Aufgabe"
  → LLM ruft saveTask() direkt auf
  → obsidian.ts → Vault
```

`obsidian.ts` wird zum "Werkzeugkasten" den das LLM nutzt. Die Funktionen bleiben gleich — nur wer sie aufruft ändert sich: statt einem fixen Befehl entscheidet das LLM was zu tun ist.
