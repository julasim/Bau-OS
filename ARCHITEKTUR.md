# Bau-OS – Architektur & Datei-Erklärung

> Vollständige Erklärung jeder Datei, was sie tut, warum sie existiert und wie alles zusammenhängt.

---

## Das große Bild

Wenn du eine Nachricht in Telegram schickst, passiert folgendes:

```
Du (Telegram)
     ↓ Nachricht
Telegram-Server
     ↓ weiterleiten
src/index.ts          ← Programm startet hier
     ↓
src/bot.ts            ← empfängt die Nachricht, entscheidet was zu tun ist
     ↓
src/commands/*.ts     ← führt den richtigen Befehl aus
     ↓
src/obsidian.ts       ← schreibt/liest Dateien im Vault
     ↓
Bau OS/               ← dein Obsidian Vault (echte .md Dateien)
```

Bei Sprachnachrichten gibt es einen zusätzlichen Schritt:

```
Sprachnachricht
     ↓
src/transcribe.ts     ← lädt Audio herunter, ruft Python auf
     ↓
whisper_transcribe.py ← Python transkribiert mit Whisper
     ↓
Text → src/obsidian.ts → Vault
```

---

## Ordnerstruktur

```
KI- Autonom/
│
├── src/                      ← Der gesamte TypeScript-Code
│   ├── index.ts              ← Startpunkt des Programms
│   ├── bot.ts                ← Telegram Bot, Befehlsregister
│   ├── obsidian.ts           ← Alle Vault-Operationen
│   ├── transcribe.ts         ← Audio-Download + Whisper-Aufruf
│   └── commands/             ← Ein File pro Befehlsgruppe
│       ├── notiz.ts
│       ├── aufgaben.ts
│       ├── termine.ts
│       ├── projekte.ts
│       ├── dateien.ts
│       ├── suchen.ts
│       └── system.ts
│
├── Bau OS/                   ← Dein Obsidian Vault (Datenspeicher)
│   ├── Inbox/                ← Alle einfachen Nachrichten landen hier
│   ├── Aufgaben.md           ← Globale Aufgabenliste
│   ├── Termine.md            ← Globale Terminliste
│   └── Projekte/             ← Projektordner (werden per /projekt erstellt)
│       └── [Projektname]/
│           ├── Notizen/
│           ├── Aufgaben.md
│           ├── Termine.md
│           └── README.md
│
├── whisper_transcribe.py     ← Python-Script für Audio-Transkription
├── .env                      ← Deine geheimen Konfigurationswerte
├── .env.example              ← Vorlage (ohne echte Werte, für Git)
├── .gitignore                ← Was Git ignorieren soll
├── package.json              ← Projektbeschreibung + npm-Befehle
├── package-lock.json         ← Exakte Versionen aller installierten Libraries
├── tsconfig.json             ← TypeScript-Konfiguration
└── node_modules/             ← Installierte Libraries (nicht anfassen)
```

---

## Konfigurationsdateien (Wurzel des Projekts)

---

### `.env`
**Was:** Deine persönlichen, geheimen Konfigurationswerte.
**Inhalt:**
```
BOT_TOKEN=       ← Telegram Bot Token (von BotFather)
VAULT_PATH=      ← Absoluter Pfad zu deinem Obsidian Vault
PYTHON_PATH=     ← Pfad zum Python-Executable
WHISPER_LANG=    ← Sprache für Whisper (de / en / auto)
```
**Wichtig:** Diese Datei kommt NIE ins Git. Jeder Wert ist entweder ein Geheimnis (Token) oder maschinenspezifisch (Pfade). Auf dem Linux-Server gibst du andere Werte ein als auf dem Laptop.

---

### `.env.example`
**Was:** Die leere Vorlage von `.env` — zeigt welche Variablen existieren, aber ohne echte Werte.
**Warum:** Wenn jemand anderes (oder du auf dem Server) das Projekt einrichtet, sieht er sofort was er befüllen muss. Diese Datei kommt ins Git.

---

### `.gitignore`
**Was:** Sagt Git: "Diese Ordner/Dateien bitte ignorieren."
**Inhalt:**
```
node_modules/   ← Tausende Dateien, werden per npm install neu geladen
dist/           ← Kompilierter Output, wird aus dem Code erzeugt
.env            ← Deine Geheimnisse
```
**Warum:** Ohne .gitignore würde Git versuchen, alle 50.000+ Dateien in node_modules zu tracken — was sinnlos und langsam wäre.

---

### `package.json`
**Was:** Das "Personalausweis" des Node.js-Projekts. Definiert:
- Name und Version des Projekts
- Welche externen Libraries verwendet werden (Dependencies)
- Die npm-Befehle (Scripts)

**Die wichtigsten Scripts:**
```
npm run dev    → startet den Bot im Entwicklungsmodus (tsx watch)
               → bei jeder Änderung an .ts Dateien startet er neu
npm run build  → kompiliert TypeScript → JavaScript in dist/
npm start      → startet den kompilierten Bot (für Produktion/Server)
```
**Faustregel:** `npm run dev` beim Entwickeln, `npm start` auf dem Server.

---

### `package-lock.json`
**Was:** Wird automatisch von npm erstellt und aktualisiert. Enthält die exakten Versionen aller installierten Libraries — auch die Libraries, die deine Libraries brauchen.
**Warum:** Stellt sicher, dass auf dem Server exakt dieselben Versionen installiert werden wie auf deinem Laptop. Nie manuell bearbeiten.

---

### `tsconfig.json`
**Was:** Konfiguration für den TypeScript-Compiler. Sagt ihm:
- `rootDir: "src"` → Der Quellcode liegt in src/
- `outDir: "dist"` → Kompilierter Output geht nach dist/
- `target: "ES2022"` → Welche JavaScript-Version erzeugt wird
- `strict: true` → Strenge Typprüfung (hilft Fehler früh zu finden)

**Warum TypeScript überhaupt?**
TypeScript ist JavaScript + Typen. Du siehst Fehler bereits im Editor, bevor du den Code startest. Und du siehst genau, was eine Funktion erwartet und zurückgibt — das ist bei einem wachsenden Projekt sehr wertvoll.

---

### `whisper_transcribe.py`
**Was:** Ein Python-Script das eine Audio-Datei als Argument bekommt und den transkribierten Text ausgibt.
**Wie es aufgerufen wird:**
```
python whisper_transcribe.py C:\Temp\voice_123.ogg
```
**Was es intern macht:**
1. Liest den Dateipfad aus den Programmargumenten (`sys.argv`)
2. Liest die Whisper-Sprache aus der Umgebungsvariable `WHISPER_LANG`
3. Lädt das Whisper-Modell (`tiny` = schnell, klein, reicht für MVP)
4. Transkribiert die Audio-Datei
5. Gibt den Text auf stdout aus (damit Node.js ihn lesen kann)

**Warum Python und nicht direkt TypeScript?**
Whisper ist ein Python-Projekt von OpenAI. Es gibt zwar JavaScript-Ports, aber Python ist die "Muttersprache" von Whisper — stabiler, schneller, bessere Modellunterstützung. Node.js ruft Python als Unterprozess auf und liest das Ergebnis.

---

## Source-Code (`src/`)

---

### `src/index.ts` — Der Startpunkt

**Was:** Die allererste Datei die ausgeführt wird wenn du `npm run dev` eingibst.
**Was sie macht:**
1. Lädt `.env` (damit alle Umgebungsvariablen verfügbar sind)
2. Prüft ob `BOT_TOKEN` und `VAULT_PATH` vorhanden sind — wenn nicht, Fehler mit klarer Meldung
3. Erstellt den Bot über `createBot()`
4. Startet den Bot mit `bot.start()`

**Warum eine eigene Datei?**
`index.ts` ist nur der Eingang — keine Logik. Sauber getrennt von dem was der Bot tatsächlich tut. Wenn du später den Bot z.B. auch als HTTP-Server starten willst, änderst du nur `index.ts`.

```
index.ts
  ↓ importiert
bot.ts (createBot Funktion)
  ↓ gibt zurück
bot Objekt
  ↓
bot.start() → verbindet mit Telegram
```

---

### `src/bot.ts` — Das Befehlsregister

**Was:** Erstellt den Telegram Bot und registriert alle Befehle.
**Was sie macht:**
- Importiert alle Command-Handler aus `src/commands/`
- Registriert jeden Befehl mit `bot.command("befehlsname", handler)`
- Registriert den Text-Handler (`bot.on("message:text", ...)`) für freie Nachrichten
- Registriert den Voice-Handler (`bot.on("message:voice", ...)`) für Sprachnachrichten

**Wichtiges Konzept — Event Listener:**
```typescript
bot.command("notiz", (ctx) => handleNotiz(ctx, ctx.match))
```
Das bedeutet: "Wenn jemand /notiz schickt, rufe handleNotiz auf."
`ctx` ist der Kontext — enthält die Nachricht, Absender, und Methoden zum Antworten.
`ctx.match` ist alles nach dem Befehl, also bei `/notiz Hallo Welt` ist `ctx.match = "Hallo Welt"`.

**Warum Umlaute doppelt registriert?**
```typescript
bot.command("loschen",  handler)  // ohne Umlaut
bot.command("löschen",  handler)  // mit Umlaut
```
Telegram-Bots akzeptieren technisch beide Schreibweisen — zur Sicherheit beide registriert.

---

### `src/obsidian.ts` — Die Vault-Zentrale

**Was:** Alle Lese- und Schreiboperationen auf dem Obsidian Vault. Kein anderer Code schreibt direkt ins Filesystem — alles läuft über diese Datei.

**Warum eine zentrale Datei dafür?**
Single Source of Truth. Wenn du den Vault-Pfad änderst oder die Dateistruktur anpasst, machst du das nur hier — nicht in 10 verschiedenen Dateien.

**Die Funktionen im Überblick:**

| Funktion | Was sie tut |
|---|---|
| `saveNote(text, projekt?)` | Erstellt neue .md Datei in Inbox/ oder Projekte/X/Notizen/ |
| `listNotes(limit)` | Gibt die letzten N Dateinamen aus Inbox/ zurück |
| `readNote(name)` | Liest eine Datei, sucht sie bei Bedarf im ganzen Vault |
| `appendToNote(name, text)` | Hängt Text als "Nachtrag" an eine bestehende Datei |
| `deleteNote(name)` | Löscht eine Datei |
| `saveTask(text, projekt?)` | Fügt `- [ ] Text` in Aufgaben.md ein |
| `listTasks(projekt?)` | Liest alle offenen Zeilen aus Aufgaben.md |
| `completeTask(text, projekt?)` | Ändert `- [ ]` zu `- [x]` |
| `saveTermin(datum, text, ...)` | Fügt Termin in Termine.md ein |
| `listTermine(projekt?)` | Liest alle Termine |
| `deleteTermin(text, projekt?)` | Löscht Termin-Zeile |
| `createProject(name)` | Erstellt Projektordner mit Standardstruktur |
| `listProjects()` | Listet alle Unterordner in Projekte/ |
| `getProjectInfo(name)` | Zählt Notizen, Aufgaben, Termine eines Projekts |
| `readFile(pfad)` | Liest beliebige Vault-Datei per relativem Pfad |
| `createFile(pfad, inhalt)` | Erstellt beliebige Datei |
| `deleteFile(pfad)` | Löscht beliebige Datei |
| `listFolder(pfad)` | Listet Ordnerinhalt |
| `searchVault(query, projekt?)` | Sucht in allen .md Dateien nach Text |
| `vaultExists()` | Prüft ob Vault-Pfad erreichbar ist |

**Wichtiges Konzept — Frontmatter:**
Jede neue Notiz bekommt automatisch diesen Header:
```markdown
---
created: 04.04.2026 14:32
source: telegram
---

Dein Text hier
```
Obsidian liest diesen Block und kann danach filtern, sortieren, in Dataview-Abfragen nutzen.

---

### `src/transcribe.ts` — Audio-Bridge

**Was:** Verbindet Node.js mit Python/Whisper. Drei Aufgaben:
1. Audiodatei von Telegram-Servern herunterladen
2. Python-Script mit der Audiodatei aufrufen
3. Temporäre Datei nach der Transkription wieder löschen

**Die Funktionen:**

`downloadFile(url, zielPfad)`
→ Lädt die Audiodatei von Telegram herunter und speichert sie lokal.
→ Nutzt `fetch()` (seit Node 18 eingebaut, kein Import nötig).

`transcribeAudio(audioPfad)`
→ Ruft Python auf: `python whisper_transcribe.py /tmp/voice_123.ogg`
→ Wartet auf das Ergebnis (max. 120 Sekunden)
→ Gibt den transkribierten Text zurück.

`getTempPath(dateiname)`
→ Gibt einen temporären Pfad zurück (z.B. `C:\Users\juliu\AppData\Local\Temp\voice_123.ogg`)
→ Nutzt das Betriebssystem-Temp-Verzeichnis — plattformunabhängig.

**Warum eine eigene Datei?**
`bot.ts` soll nichts von Python oder Audio wissen. Saubere Trennung: bot.ts orchestriert, transcribe.ts macht die technische Arbeit.

---

## Commands (`src/commands/`)

Alle Command-Dateien folgen demselben Muster:
1. Sie importieren Funktionen aus `obsidian.ts`
2. Sie empfangen `ctx` (Telegram-Kontext) und `args` (Text nach dem Befehl)
3. Sie rufen die passende obsidian-Funktion auf
4. Sie schicken eine Antwort via `ctx.reply()`

---

### `src/commands/notiz.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleNotiz` | `/notiz` | Parst "Projekt: Text" oder einfach "Text", ruft `saveNote()` auf |
| `handleNotizen` | `/notizen` | Ruft `listNotes(10)` auf, formatiert als nummerierte Liste |
| `handleLesen` | `/lesen` | Ruft `readNote()` auf, kürzt auf 3800 Zeichen (Telegram-Limit) |
| `handleBearbeiten` | `/bearbeiten` | Parst "Dateiname: Nachtrag", ruft `appendToNote()` auf |
| `handleLoeschen` | `/löschen` | Ruft `deleteNote()` auf |

**Projekt-Parsing:** Bei Befehlen wie `/notiz Wohnbau-Linz: Deckenschalung` erkennt der Code den Doppelpunkt als Trennzeichen zwischen Projektname und Text.

---

### `src/commands/aufgaben.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleAufgabe` | `/aufgabe` | Ruft `saveTask()` auf, fügt `- [ ] Text` in Aufgaben.md ein |
| `handleAufgaben` | `/aufgaben` | Ruft `listTasks()` auf, zeigt alle offenen Aufgaben |
| `handleErledigt` | `/erledigt` | Ruft `completeTask()` auf, ändert `[ ]` zu `[x]` |

**Dateiformat in Aufgaben.md:**
```markdown
# Aufgaben

- [ ] Angebot Elektriker einholen
- [x] Bewehrung prüfen (erledigt)
- [ ] Bautagebuch aktualisieren
```

---

### `src/commands/termine.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleTermin` | `/termin` | Parst Datum + optional Uhrzeit + Text, speichert in Termine.md |
| `handleTermine` | `/termine` | Listet alle offenen Termine |
| `handleTerminLoeschen` | `/termin_löschen` | Löscht Termin-Zeile die den Suchbegriff enthält |

**Datum-Parsing:** Der Code erkennt ob nach dem Datum eine Uhrzeit folgt (Format `HH:MM`). Alles danach ist der Termintext.
```
/termin 10.04.2026 09:00 Baubesprechung
         ↑ Datum   ↑ Uhrzeit  ↑ Text

/termin 10.04.2026 Abnahme Elektrik
         ↑ Datum   ↑ Text (keine Uhrzeit)
```

---

### `src/commands/projekte.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleProjekt` | `/projekt` | Ruft `createProject()` auf — erstellt Ordnerstruktur |
| `handleProjekte` | `/projekte` | Listet alle Unterordner in Projekte/ |
| `handleProjektInfo` | `/projekt_info` | Zeigt Anzahl Notizen, Aufgaben, Termine eines Projekts |

**Was `/projekt Name` erstellt:**
```
Projekte/
└── Name/
    ├── Notizen/        ← leerer Ordner für Notizen
    ├── Aufgaben.md     ← leere Aufgabenliste
    ├── Termine.md      ← leere Terminliste
    └── README.md       ← Basis-Info mit Erstellungsdatum
```

---

### `src/commands/dateien.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleDateiLesen` | `/datei_lesen` | Liest beliebige Vault-Datei per relativem Pfad |
| `handleDateiErstellen` | `/datei_erstellen` | Erstellt neue Datei mit Inhalt |
| `handleDateiLoeschen` | `/datei_löschen` | Löscht beliebige Datei per relativem Pfad |
| `handleOrdnerListe` | `/ordner` | Listet Inhalt eines Vault-Ordners |
| `handleExportieren` | `/exportieren` | Sendet Datei als Telegram-Dokument |

**Pfade sind immer relativ zum Vault:**
```
/datei_lesen Projekte/Wohnbau-Linz/README.md
                ↑ relativ zum VAULT_PATH
```

**Exportieren:** Nutzt `ctx.replyWithDocument()` von grammY — schickt die Datei als Download direkt in den Telegram-Chat.

---

### `src/commands/suchen.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleSuchen` | `/suchen` | Durchsucht alle .md Dateien rekursiv, gibt max. 10 Treffer zurück |

**Wie die Suche funktioniert:**
1. Geht rekursiv durch alle Ordner im Vault
2. Liest jede .md Datei
3. Sucht zeilenweise nach dem Begriff (case-insensitive)
4. Gibt Dateiname + die gefundene Zeile zurück (max. 100 Zeichen)

---

### `src/commands/system.ts`

| Handler | Befehl | Was passiert |
|---|---|---|
| `handleHilfe` | `/hilfe`, `/start` | Gibt die komplette Befehlsliste aus |
| `handleStatus` | `/status` | Prüft Vault, zählt Notizen und offene Aufgaben |
| `handleSprache` | `/sprache` | Setzt `WHISPER_LANG` zur Laufzeit (ohne Neustart) |

**Status prüft:**
- Ist der Vault-Pfad erreichbar? (wichtig nach Neustart oder auf dem Server)
- Wie viele .md Dateien liegen in Inbox/?
- Wie viele offene Aufgaben gibt es?

---

## Der Vault (`Bau OS/`)

Das ist kein Code — das ist der Datenspeicher. Obsidian öffnet diesen Ordner und zeigt dir alle .md Dateien schön formatiert an. Der Bot schreibt hier rein, du liest in Obsidian.

```
Bau OS/
├── .obsidian/          ← Obsidian-Einstellungen (automatisch erstellt)
├── Inbox/              ← Alle einfachen Text- und Sprachnachrichten
│   ├── 2026-04-04T13-21-44.md
│   └── ...
├── Aufgaben.md         ← Globale Aufgaben (kein Projekt zugeordnet)
├── Termine.md          ← Globale Termine
└── Projekte/           ← Projektordner (per /projekt erstellt)
```

---

## Wie eine Nachricht durch das System fließt

### Beispiel 1: `/notiz Wohnbau-Linz: Deckenschalung verzögert`

```
1. Du schickst /notiz Wohnbau-Linz: Deckenschalung verzögert

2. bot.ts:
   bot.command("notiz", (ctx) => handleNotiz(ctx, ctx.match))
   → ctx.match = "Wohnbau-Linz: Deckenschalung verzögert"

3. commands/notiz.ts → handleNotiz():
   parseProjectAndText("Wohnbau-Linz: Deckenschalung verzögert")
   → { project: "Wohnbau-Linz", text: "Deckenschalung verzögert" }
   → saveNote("Deckenschalung verzögert", "Wohnbau-Linz")

4. obsidian.ts → saveNote():
   → Pfad: Bau OS/Projekte/Wohnbau-Linz/Notizen/2026-04-04T14-32-00.md
   → Erstellt Ordner falls nicht vorhanden
   → Schreibt Datei mit Frontmatter + Text

5. bot.ts → ctx.reply():
   → "Notiz gespeichert in [Wohnbau-Linz]
      2026-04-04T14-32-00.md"
```

---

### Beispiel 2: Sprachnachricht schicken

```
1. Du schickst eine Sprachnachricht

2. bot.ts:
   bot.on("message:voice", ...)
   → Telegram gibt eine file_id zurück (keine direkte Datei)

3. transcribe.ts → downloadFile():
   → Baut Download-URL: https://api.telegram.org/file/botTOKEN/voice/file.ogg
   → Lädt Datei nach C:\Temp\voice_123.ogg

4. transcribe.ts → transcribeAudio():
   → Ruft Python auf: python whisper_transcribe.py C:\Temp\voice_123.ogg
   → Python lädt Whisper-Modell
   → Transkribiert Audio
   → Gibt Text auf stdout zurück
   → Node.js liest stdout als String

5. obsidian.ts → saveNote():
   → Speichert transkribierten Text in Inbox/

6. bot.ts → ctx.reply():
   → "Gespeichert: 2026-04-04T14-33-00.md
      "Deckenschalung auf Achse B ist fertig""

7. transcribe.ts:
   → Löscht temporäre .ogg Datei
```

---

## Warum diese Struktur?

**Jede Datei hat eine einzige Aufgabe:**
- `index.ts` → starten
- `bot.ts` → Telegram-Kommunikation
- `obsidian.ts` → Dateisystem
- `transcribe.ts` → Audio/Python
- `commands/*.ts` → Befehlslogik

**Vorteil:** Wenn du später LLM anbindest, erstellst du einfach `src/llm.ts` und rufst es aus `bot.ts` auf — der Rest bleibt unverändert. Wenn du die Dateistruktur im Vault änderst, änderst du nur `obsidian.ts`.

**Nächste Ebene:** Wenn das LLM dazukommt, kann es dieselben Funktionen aus `obsidian.ts` als "Tools" nutzen — es ruft dann z.B. `saveNote()` oder `saveTask()` selbst auf, basierend auf dem was du gesagt hast, ohne dass du einen konkreten Befehl eingeben musst.
