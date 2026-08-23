# Changelog

Versionshistorie von PATIO. Älteste Version zuerst.

::: warning Historischer Stand bis v0.13.0
Die Einträge bis einschließlich **v0.13.0** beschreiben die frühere Fassung
von PATIO: eine KI-Büro-Software mit Telegram-Bot, Sprachmodell,
Obsidian-Vault und semantischer Suche über pgvector. All das ist mit dem
**Umbau zum Firmenserver** ersatzlos entfallen — siehe den letzten Eintrag.

Was dort steht, ist als Historie richtig und als Beschreibung des heutigen
Systems falsch. Wer wissen will, was PATIO heute tut:
[Architektur](/konzepte/architektur).
:::

## v0.1.0 — Initial MVP
**04.04.2026**

Erster funktionsfähiger Prototyp mit Telegram-Bot, lokalem LLM und Obsidian-Vault.

- Telegram-Bot mit grammY-Framework
- Ollama-Integration als lokales LLM (qwen2.5:7b)
- Obsidian Vault als Datenspeicher (Markdown-Dateien)
- 30+ Slash-Commands (`/hilfe`, `/status`, `/heute`, etc.)
- Notizen, Aufgaben und Termine verwalten
- Vault-Suche über alle Markdown-Dateien
- Projekt-Verwaltung mit Unterordnern
- System-Prompt aus Markdown-Dateien (SOUL.md, BOOT.md, etc.)

::: tip MVP-Entscheidung
Bewusste Entscheidung gegen Cloud-AI (OpenAI, etc.) zugunsten von vollständiger Datensouveränität. Alle Daten bleiben auf dem eigenen Server.
:::

---

## v0.2.0 — Multi-Agent System
**05.04.2026**

Einführung des Multi-Agent-Systems mit Sub-Agenten, Session-Queue und Tageslog-Komprimierung.

- Multi-Agent-Architektur: Main-Agent kann Sub-Agenten spawnen
- `agent_spawnen` (blocking) und `agent_spawnen_async` (non-blocking)
- `agent_erstellen` — neue Agenten zur Laufzeit anlegen
- Session-Queue: Serialisierung pro Chat-ID gegen Race Conditions
- Tageslog-Komprimierung (Compaction) via LLM
- Gesprächsverlauf: Laden der letzten N Einträge
- PROTECTED_AGENTS: Main-Agent kann nicht gelöscht werden
- MAX_SPAWN_DEPTH: Verschachtelungstiefe begrenzt auf 2

---

## v0.3.0 — Setup-Wizard & Heartbeat
**06.04.2026**

Interaktiver Einrichtungsassistent und zeitgesteuertes Heartbeat-System.

- Setup-Wizard beim ersten Start (Name, Emoji, Vibe, Unternehmen)
- `setup_abschliessen`-Tool: LLM sammelt Daten und konfiguriert sich selbst
- HEARTBEAT.md: Cron-basierte Agent-Ausführung
- Stille-Modus: Agent antwortet mit `[STILL]` wenn nichts zu melden
- `node-cron` Integration mit Timezone-Support (Europe/Vienna)
- Installer-Script für automatisiertes Deployment

---

## v0.4.0 — LLM Tools & File Editor
**06.04.2026**

Umstellung von Regex-Commands auf LLM Tool Calling. Der Bot versteht jetzt natürliche Sprache.

- LLM Tool Calling statt Regex-basierte Erkennung
- OpenAI Function Calling Format (JSON Schema)
- Agentic Loop: Bis zu 5 Tool-Runden pro Nachricht
- Agent-Datei-Editor: `agent_datei_lesen`, `agent_datei_schreiben`
- Whitelist für editierbare Dateien (SOUL.md, BOOT.md, etc.)
- CRUD-Operationen über natürliche Sprache
- `/btw`-Modus: Direkte Antwort ohne Tools und ohne Log
- Memory-Tool: `memory_speichern` für Langzeitgedächtnis

::: tip Paradigmenwechsel
Vorher: `/notiz Baustellenbegehung war erfolgreich`
Nachher: "Notier dir dass die Baustellenbegehung erfolgreich war"
:::

---

## v0.5.0 — Admin Commands & Logging
**07.04.2026**

Erweitertes Logging-System und administrative Telegram-Commands.

- Logging-Modul (`src/logger.ts`) mit Datei- und Konsolen-Ausgabe
- Log-Rotation: Automatisches Kürzen auf 500 Zeilen
- `/logs [n]` — Letzte Log-Einträge im Chat anzeigen
- `/config` — Aktuelle Konfiguration anzeigen
- `/restart` — Bot per Command neu starten
- `/kontext` — Kontext-Auslastung mit Token-Schaetzung
- `/export` — Session-Log als Markdown exportieren
- `/model` — Modell zur Laufzeit wechseln
- `/fast` — Fast-Modus umschalten
- Zeitstempel im österreichischen Format (de-AT, Europe/Vienna)

---

## v0.6.0 — Modularisierung
**07.04.2026**

Komplette Projekt-Restrukturierung: Von 2 großen Dateien zu 15+ fokussierten Modulen.

- `src/vault/` — 8 Module: notes, tasks, termine, projects, files, search, agents, helpers
- `src/llm/` — 5 Module: client, tools, executor, runtime, compaction, setup
- `src/commands/` — System-Commands in eigenes Modul
- Barrel Re-Exports (`vault/index.ts`)
- Zirkulaere Imports aufgeloest (Late-Binding Pattern in executor.ts)
- Express-Dependency entfernt (kein Web-Dashboard mehr)
- Codebase von ~1.500 Zeilen in 2 Dateien zu ~2.150 Zeilen in 23 Dateien

::: warning Breaking Change
Die Module-Pfade haben sich geändert. Alle Imports zeigen jetzt auf Sub-Module statt auf monolithische Dateien.
:::

---

## v0.7.0 — Hardcode-Reduktion & Dokumentation
**07.04.2026**

Konfiguration zentralisiert und VitePress-Dokumentation aufgebaut.

- Zentrale `config.ts` mit allen Konstanten
- Umgebungsvariablen für LLM-Modelle (`OLLAMA_MODEL`, `OLLAMA_FAST_MODEL`, `OLLAMA_SUBAGENT_MODEL`)
- VitePress-Dokumentation mit vollständiger Referenz
- Sicherheitsdokumentation: DSGVO, Isolation, Zugriffskontrolle
- Tool-Referenz: Alle 26 LLM-Tools dokumentiert
- Dateistruktur-Referenz: Alle 23 Module dokumentiert
- Konfigurationsreferenz: Alle Konstanten dokumentiert

---

## v0.8.0 — Sicherheit & Stabilitaet
**09.04.2026**

Umfassende Code-Haertung: Error-Handling, Path-Schutz, Sandbox-Haertung und Graceful Shutdown.

### Sicherheit
- **Shell-Allowlist** statt Blocklist: ~40 erlaubte Befehle (ls, cat, grep, curl, git, etc.)
- **Rate Limiting**: Login-Endpoint max. 5 Versuche pro IP in 15 Minuten (HTTP 429)
- **CORS konfigurierbar**: Neue Env-Variable `CORS_ORIGINS` (komma-getrennte Liste)
- **Path-Traversal-Schutz**: `safePath()` in `files.ts`, `safeProjectName()` in `projects.ts`
- **Sandbox gehaertet**: `fetch` aus dynamischen Tools entfernt
- **Env-Vars gefiltert**: Shell-Scripts bekommen nur PATH, HOME, USER, LANG (keine Secrets)

### Stabilitaet
- **JSON.parse Error-Handling** an 6+ Stellen (runtime, setup, tasks, termine, team, auth)
- **fs.readdirSync Error-Handling** an 7+ Stellen (agents, projects, files, notes, helpers, search)
- **Graceful Shutdown**: SIGTERM/SIGINT-Handler stoppt Bot, trennt MCP-Server, beendet sauber
- **MCP Cleanup**: `disconnectAll()` beendet alle MCP-Server-Prozesse bei Shutdown

### Codequalitaet
- Hardcoded `"MEMORY_LOGS"` durch `VAULT_LOGS_DIR`-Konstante ersetzt
- Unused Import `estimateTokens` aus `commands/system.ts` entfernt
- Login-Body JSON.parse abgesichert (HTTP 400 statt Crash)

::: tip 18 Dateien geaendert
Diese Version betrifft 18 Quelldateien quer durch die gesamte Codebasis — von der API-Schicht bis zur Vault-Ebene.
:::

---

---

## v0.9.0 — Daten-Layer + Web-API
**April 2026**

Einführung eines abstrakten Daten-Layers mit PostgreSQL-Support und einer vollständigen Hono HTTP-API plus Vue 3 Frontend.

### Daten-Layer
- `src/data/index.ts` — Factory-Pattern: wählt automatisch DB- oder FS-Implementierung
- `src/data/types.ts` — Typen-Interfaces (Task, Termin, Note, Project, TeamMember, FileEntry, etc.)
- `db-*`-Implementierungen: PostgreSQL via `postgres.js` (direkt, kein ORM)
- `fs-*`-Implementierungen: Markdown/JSONL auf dem Filesystem (Fallback ohne DB)
- `src/db/migrate.ts` — SQL-Migrations-Runner (idempotent, nummerierte .sql-Dateien)
- `DATABASE_URL` Env-Variable: wenn gesetzt → DB-Modus, sonst → FS-Modus
- Chat-History und Agent-Logs bleiben **immer** im Filesystem (JSONL, leicht per grep)

### Web-API
- Hono HTTP-Server (`src/api/server.ts`) — kompakt, TypeScript-first
- JWT-Authentifizierung (`JWT_SECRET`-Env-Variable)
- Rate-Limiting Login-Endpoint: 5 Versuche / 15 Minuten
- CORS konfigurierbar via `CORS_ORIGINS`
- REST-Routen: notes, tasks, termine, projects, files, team, agents, search, chat, settings
- Supabase Realtime Bridge: `startRealtimeBridge()` leitet DB-Events in den Bot

### Vue 3 Frontend
- Vue 3 + Pinia + Vue Router (`web/`)
- Separate Vite-Konfiguration (`npm run dev:web`, `npm run build:all`)
- SPA-Fallback über Hono's `serveStatic`

---

## v0.10.0 — OpenAI Dual-Backend + Embeddings
**April 2026**

PATIO unterstützt jetzt sowohl Ollama (lokal) als auch OpenAI — automatische Erkennung via `OPENAI_API_KEY`.

### LLM-Backend
- OpenAI SDK als einheitlicher Client — zeigt je nach Config auf Ollama oder OpenAI-API
- `OPENAI_API_KEY` gesetzt → OpenAI-Modus (gpt-4o, etc.)
- Kein Key → Ollama-Modus (localhost:11434)
- Runtime-Modellwechsel via `/model` und `/fast` auch im Web-UI

### Embeddings & Semantische Suche
- `pgvector` Extension (optional — wenn fehlt, bleibt Volltext-Suche aktiv)
- `text-embedding-3-small` (1536 dims) bei OpenAI-Modus
- `nomic-embed-text` (768 dims) bei Ollama-Modus
- `src/db/embeddings.ts` — Auto-Embed bei Notizen- und Datei-Speicherung
- `src/db/semantic-search.ts` — Pure Vector, Hybrid (Vector + BM25) und Text-only Suche
- `npm run db:embed` — nachträgliches Embedding für bestehende Einträge

---

## v0.11.0 — Dynamic Tools + MCP
**April/Mai 2026**

Zwei neue Erweiterungspunkte: Eigene Tools als Ordner im Filesystem und externe MCP-Server.

### Dynamic Tools (`tools/`)
- Jeder Unterordner ist ein Tool: `tool.json` (Schema) + `run.js` (Node.js) oder `run.sh` (Shell)
- `run.js` läuft in einer Node.js-Sandbox (kein `fetch`, kein fs-Zugriff außerhalb des Tool-Ordners)
- Änderungen sofort aktiv — kein Neustart nötig
- Zusatzdateien (Templates, Daten) werden dem Script als `files()`-Map übergeben
- LLM kann neue Tools über `tool_erstellen` anlegen und bestehende löschen

### MCP-Server
- `mcp.json` im Projekt-Root konfiguriert externe MCP-Server
- stdio-Transport: MCP-Server laufen als Kindprozesse
- Tool-Namen werden automatisch mit Server-Prefix versehen (`mcp_servername_toolname`)
- Kollisionsprüfung gegen statische und bereits registrierte Tools
- `npm run mcp` für manuellen Test

---

## v0.12.0 — Datei-Upload & Team
**Mai 2026**

Vollständiger Datei-Upload via Telegram und Web-API, plus Team-Verwaltung.

### Datei-Upload
- Telegram: PDF, DOCX, XLSX, TXT etc. direkt in den Chat senden
- DB-Modus: Datei-Blob wird als `bytea` in der `files`-Tabelle gespeichert — kein Disk-Write
- FS-Modus: Fallback nach `Uploads/` im Workspace
- Text-Extraktion: PDF via `pdfjs-dist`, DOCX via `mammoth`
- Auto-Embedding des extrahierten Textes (fire-and-forget)
- Web-API: `/files/upload` (Drag & Drop), `/files/download` (Blob aus DB)
- `MAX_UPLOAD_MB` Env-Variable (Standard: 50 MB)

### Team-Verwaltung
- `TeamRepository`: Mitglieder anlegen, auflisten, aktualisieren, entfernen
- Projekt-Zuweisung per `projectId`
- DB- und FS-Implementierung

---

## v0.13.0 — Sicherheits- & Stabilitäts-Hardening
**Mai 2026**

24 Bugs und Sicherheitslücken behoben — identifiziert durch systematische Multi-Agent-Code-Analyse.

### Telegram-Zugriffskontrolle (neu)
- **Auto-Owner-Detection**: Erster Nutzer der schreibt wird als Owner gespeichert (`.chat_id`)
- **ALLOWED_CHAT_IDS**: Optionale Env-Variable für explizite Whitelist
- Alle weiteren Chat-IDs werden **ohne Fehlermeldung** ignoriert
- Middleware in `bot.ts` — greift vor allen Commands und Nachrichten

### Sicherheits-Fixes
- **SSRF**: IPv6-Ranges (`fd00::`, `fc00::`, `fe80::`, `::ffff:`) und Dezimal-IPs jetzt blockiert
- **Path-Traversal**: `safePath()` prüft jetzt `startsWith(path + sep)` statt nur `startsWith(path)` — verhindert `/vault-backup` als `/vault`-Bypass
- **Path-Traversal Dynamic Tools**: `safeToolDir()` Validation in `createTool()` und `deleteTool()`
- **MIME-Whitelist**: Datei-Uploads (Telegram + API) nur erlaubte Endungen (pdf, docx, xlsx, csv, txt, md, png, jpg, zip, json, xml)
- **Rate-Limit /api/chat**: 30 Anfragen / Minute pro User (zusätzlich zum Login-Rate-Limit)
- **Security Headers**: `secureHeaders()`-Middleware für alle API-Responses (X-Frame-Options, CSP, etc.)
- **Passwort-Mindestlänge**: 6 → 12 Zeichen
- **MCP Filesystem**: Standardmäßig deaktiviert (verhindert Zugriff auf `.env`)

### Stabilitäts-Fixes
- **LLM-Crash-Schutz**: `choices[0]`-Guard nach jedem API-Call
- **Message-Pruning**: assistant+tool-Runden werden als Paare entfernt (OpenAI-Anforderung)
- **History-Parser**: Mehrzeilige User-Nachrichten korrekt erkannt
- **Heartbeat-Race**: `startHeartbeat()` wird erst nach `bot.start()` aufgerufen
- **compactNow()**: Vollständig in try/catch — kein Crash mehr bei LLM-Fehler
- **Compaction-Lock**: `writeCompactedLog()` ist jetzt race-condition-sicher
- **updateNote()**: Atomarer Write via `atomicWriteSync()` statt direktem `fs.writeFileSync`
- **db-notes Prefix-Match**: `append()` und `update()` treffen jetzt exakt eine Zeile (SELECT id → UPDATE WHERE id = foundId)
- **null-Check nach INSERT...RETURNING**: tasks, termine, team, files — wirft jetzt Fehler statt zu crashen
- **JSONL-Größenbegrenzung**: fs-chat (10.000 Zeilen), fs-agent-logs (5.000 Zeilen)
- **searchWorkspace limitTo**: Verhindert Path-Traversal via `limitTo`-Parameter
- **MCP Reconnect**: Automatischer Reconnect nach Prozess-Absturz (3 Versuche, Backoff 5/10/15s)
- **Embedding-Startup-Check**: Dimensions-Mismatch wird beim Start geloggt (kein process.exit)
- **SQL-Migrations**: `005_fix_files_project_fk.sql` (ON DELETE SET NULL statt CASCADE), `006_projects_name_unique.sql`

---

## Umbau zum Firmenserver
**2026**

PATIO wird vom Internet-Stack zum zentral betriebenen Firmenprogramm im
eigenen Netz: ein Rechner im Büro, kein Internet, echte Benutzerrollen,
projektweise Rechte.

### Ersatzlos entfernt (rund 16.000 Zeilen)

- **Telegram-Bot** samt grammY, Session-Queue, Slash-Commands und
  Benachrichtigungen
- **Sprachmodell-Laufzeit**: Agentic Loop, Tool-Router, Handler,
  Kontext-Komprimierung, Agenten-Verwaltung
- **LLM-Anbindung** an OpenAI und Ollama; der `ollama`-Service ist aus dem
  Compose-Stack verschwunden
- **Embeddings und semantische Suche** über pgvector
- **Websuche und Seitenabruf** samt SSRF-Schutz
- **MCP-Client** und dynamische Tools
- **Outlook-Abgleich** über Microsoft Graph
- **Dateisystem-Modus**: die `fs-*`-Repositories und die Weiche zwischen
  Datei- und Datenbankbetrieb

### Neu beziehungsweise geändert

- **Harter Boot-Abbruch** bei fehlendem `WORKSPACE_PATH`, `DATABASE_URL`
  oder `JWT_SECRET`. Vorher lief der Prozess weiter, galt für Docker als
  gesund und lieferte bei jedem Datenzugriff einen 500er.
- **Alle Repositories sind non-nullable** — kein Aufrufer prüft mehr auf
  `null`, weil es keinen zweiten Speicherweg mehr gibt.
- **Volltextsuche** in `src/data/db-search.ts` über Notizen, Aufgaben,
  Projekte und Dateien, **mit** Filterung auf sichtbare Projekte. Die alte
  Suche filterte nicht.
- **Rechtefilter auf dem Live-Update-Kanal**: Ereignisse tragen keine
  Inhalte mehr und werden nur an Abonnenten zugestellt, deren
  Sichtbarkeits-Kontext sie abdeckt.
- **Zentrale Fehlerbehandlung** in der API: sinnvolle HTTP-Codes statt
  eines nackten „Internal Server Error" als `text/plain`.
- **Migrationen `040` und `041`** entfernen Embedding-Spalten, HNSW-Indizes
  und die Registrierung der `vector`-Extension. PATIO läuft damit auf einem
  gewöhnlichen `postgres:16` — auf einem Firmenserver ohne Internet ist das
  Spezial-Image `pgvector/pgvector:pg16` nicht zu beschaffen.
- **`src/workspace/`** auf den echten Dateizugriff zusammengestrichen (rund
  1.770 → 245 Zeilen).
- **`patio.service` und `scripts/install.sh`** fragen weder Bot-Token ab
  noch installieren sie Ollama; die Unit hängt an `postgresql.service`
  statt an `ollama.service`.

### Offen

| Vorhaben | Warum |
|---|---|
| Volltextsuche auf `tsvector` | Derzeit `ILIKE`; bei großen Beständen zu langsam |
| Konfliktschutz bei gleichzeitiger Bearbeitung | Zwei Arbeitsplätze am selben Datensatz überschreiben einander |
| Papierkorb | Gelöschtes ist endgültig weg |
| Migrationen `022`–`024` abräumen | Microsoft-Tabellen ohne Code; ein `DROP` wäre unumkehrbar und wartet aufs Schema-Paket |

---

## Server betriebsbereit
**06.08.2026**

Der Rechner im Büro kann aufgesetzt werden: Anmeldung, Stack, Zertifikat,
Sicherung, Netzfreigabe und der Weg für Updates stehen.

### Anmeldung: ein festes Passwort je Benutzer

Der Login verzweigte bis hierher **jeden** Datenbank-Benutzer in den
E-Mail-Pfad — mit Adresse in den SMTP-Versand (der ohne Internet scheiterte
und mit 502 antwortete), ohne Adresse in einen erzwungenen
Einrichtungs-Fluss, der ebenfalls SMTP braucht. Auf dem Zielsystem kam
**niemand** hinein außer über ein einstufiges Konto aus einer JSON-Datei.

- Sieben Routen entfernt (`login/2fa`, `setup-email/*`, `login/magic-link/*`,
  `forgot-password`, `reset-password`), dazu die verifizierte E-Mail-Änderung
  in den Einstellungen
- `src/api/email.ts`, `email-template.ts`, `src/emails/` und `nodemailer` raus
- Anmeldeseite von sechs Schritten auf einen
- **Mindestlänge 8 → 12, bcrypt 10 → 12**, beides zentral statt viermal
  einzeln im Code. Bestehende Hashes bleiben gültig
- E-Mail ist jetzt **optional** — sie war Anlege-Pflicht und hätte auf einem
  Server ohne Mailversand verhindert, überhaupt ein Konto anzulegen
- Toter Telegram-Code aus `auth.ts` (Pairing, Per-Benutzer-Bots)

`src/api/totp.ts` und `routes/auth-2fa.ts` bleiben unangetastet liegen: der
zweite Faktor kommt zurück, sobald es einen Zugang von außen gibt.

### Betrieb

- **Ein Compose-Stack** (postgres + app + caddy), in sich geschlossen. Die
  frühere Fassung hing am externen Netz eines gemeinsamen Edge-Proxy und kam
  ohne dieses gar nicht hoch
- **Eigene lokale Zertifizierungsstelle** statt Let's Encrypt. Nichts
  verlässt das Haus — bei einem öffentlichen Zertifikat stünde der interne
  Rechnername im Certificate-Transparency-Log
- **Sicherung auf eine externe Festplatte**, gestaffelt 7/4/12, mit
  Selbstprüfung: jeder Lauf spielt den Dump probeweise zurück und vergleicht
  Zeilenzahlen. Der private CA-Schlüssel ist mit drin — ohne ihn kostet ein
  Wiederaufbau den Gang zu jedem Arbeitsplatz
- **Netzfreigabe** mit Papierkorb; alles, was hereinkommt, gehört uid 1000
- **Offline-Updates**: ein Paket vom Entwicklungsrechner, per USB-Stick
  eingespielt, mit Prüfsumme, erzwungener Sicherung und Rückweg
- **Kein Außenkontakt der Oberfläche** mehr — die Schriften kamen bis hierher
  von Google Fonts

### Zwei Fallen, die dabei aufgefallen sind

- **`chown -R patio:patio` auf das Dokumentenverzeichnis** war so
  dokumentiert und macht den Dienst schreibunfähig: der Container läuft als
  uid 1000, der Dienstbenutzer hat eine andere. Der Fehler zeigt sich an
  ganz anderer Stelle
- **Eine fehlgeschlagene Sicherung belegte einen Aufbewahrungsplatz.** Nach
  einer Woche Fehlschlägen wären alle sieben Tagesplätze mit unbrauchbaren
  Ständen gefüllt gewesen — und der letzte gute weggerotiert

---

## Datenverlust geschlossen, Rechte scharf, Papierkorb
**06.08.2026**

Sechs Stufen in einem Zug — von „hier gehen still Daten verloren" bis zur
Volltextsuche. Migrationen `042`–`049`, 265 → 399 Tests.

### Es gingen still Daten verloren

- **Notizen wurden per Namenspräfix gesucht.** Zwei Notizen „Besprechung" und
  „Besprechung Bauherr" — und eine Änderung landete auf der falschen. Jetzt
  entscheidet nur noch die ID.
- **Zwei Arbeitsplätze überschrieben einander wortlos.** Es gab keinerlei
  Konflikterkennung. Jetzt trägt jeder Datensatz einen Zähler; wer einen
  überholten Stand speichert, bekommt eine Ablehnung statt eines stillen
  Verlusts.
- **`db-termine.delete()` löschte per Textmuster.** Ein Termin „Abnahme" hätte
  jeden anderen Termin mit „Abnahme" im Text mitgenommen.
- **Das Löschen einer Datei nahm die gleichnamige Datei in der Netzfreigabe
  mit** — zwei getrennte Ablagen, die der Code verwechselte.

### Rechte

- **Der Word-Export war die offene Hintertür.** Vier Export-Routen ohne jede
  Rechteprüfung: darüber ließ sich die gesamte Zugriffskontrolle umgehen.
- **Bürointerne Konfiguration war für jeden schreibbar** — bis hin zum Löschen
  der einzigen Word-Vorlage, mit der Rechnungen erzeugt werden.
- **Die Team-Liste verriet alle Projektnamen des Büros** über die
  Projektzuordnungen der Mitglieder. Bei einem Büro, das für konkurrierende
  Bauherren arbeitet, ist schon der Projektname eine Auskunft.
- **Neu: das Geld-Recht.** Stundensätze, Honorare und Deckungsbeiträge hängen
  an einem eigenen Schalter je Konto, Voreinstellung zu. Durchgesetzt an einer
  einzigen Stelle für alle Routen, nicht achtmal einzeln.
- **Der Dokumentenordner war über HTTP offen.** Drei Wege arbeiteten ohne
  Rechteprüfung direkt im Dateisystem der Netzfreigabe. Entfernt statt bewacht.

### Papierkorb

Löschen setzt nur noch eine Markierung. Die Kaskaden im Schema feuern erst beim
endgültigen Entfernen — vorher riss ein gelöschtes Projekt Rechnungen und
erfasste Stunden mit, während Notizen als verwaiste Reste zurückblieben. Je
Beziehung ein eigener Test, der in der Datenbank nachzählt.

Gilt für Projekte **und** für einzelne Notizen, Aufgaben und Termine.

### Neue Funktionen

- **Entscheidungslog** je Projekt: Begründung, Alternativen, Beteiligte
- **Rechnungspositionen und Positionskatalog**
- **Aktivität** — was zuletzt im Büro passiert ist, über alle Datenarten
- **Sicherungs-Status** in der Oberfläche
- **Firmen-Ansicht** samt Zusammenführen von Dubletten. Die API gab es seit
  Monaten vollständig, nur rief sie niemand auf
- **Volltextsuche** mit deutschen Wortstämmen statt reinem Textvergleich

### Aufgeräumt

95 tote Abfragen auf einen Dateisystem-Modus, den es nicht mehr gibt. Die
JSON-Konten sind als Anmeldeweg geschlossen — sie werden nur noch beim Start in
die Datenbank übernommen. Sechs Tabellen der Bot- und Outlook-Ära entfernt,
aber nur, wenn sie leer waren.

---

## Arbeitsplatz-Programm
**06.08.2026**

Am Arbeitsplatz läuft kein Browser mehr, sondern `PATIO.exe`.

Die Hülle stammt aus PATIO Desktop und wurde entkernt: dort **startet** das
Programm die Anwendung samt eigenem Server, hier **findet** es den
Firmenserver. Die Oberfläche musste dafür nicht angefasst werden — sie spricht
durchgehend relative Pfade und kennt gar keine Serveradresse.

- Beim ersten Start fragt es nach der Serveradresse und prüft sie, bevor es sie
  übernimmt
- Ist der Server weg, erscheint eine Erklärung in Klartext statt der
  Fehlerseite des Browsers — auch dann, wenn die Verbindung mitten in der
  Arbeit abreißt
- Zweimal gestartet ergibt **ein** Fenster, nicht zwei Sitzungen
- Zertifikatsfehler werden **nicht** übergangen, sondern erklärt
- `F1` öffnet diese Dokumentation. Der Server liefert sie jetzt selbst aus —
  vorher zeigte der Menüpunkt ins Leere

Verteilt wird die portable Datei über den geteilten Ordner; es gibt keinen
Update-Dienst. Einzelheiten: [Arbeitsplatz-Programm](/betrieb/arbeitsplatz).

### Beim Bauen gefunden

- Die **Adressprüfung verbog jedes fremde Schema** zu einem
  Unsinns-Rechnernamen: aus `file:///C:/Windows` wurde `https://file`
- Das Programm war **gegen ein Wegwerf-Profil nicht prüfbar**, weil es den
  Datenordner hart überschrieb — damit ließ sich ein gepackter Stand nie ohne
  Risiko für die Echtdaten testen
- Diese **Dokumentation lud Schriften von Google Fonts nach.** Solange sie nur
  lokal gebaut wurde, fiel das nicht auf; ausgeliefert liefe jeder Seitenaufruf
  auf einem Rechner ohne Internet erst in einen Timeout
- Das Programmpaket enthielt den **kompletten Server-Code** samt Datenbank-
  Treiber — 2896 Einträge statt sechs, auf jedem Bürorechner

## Die Projektnummer wird zur Kennung
**23.08.2026** · Migrationen 052/053

Jedes Projekt trägt jetzt eine Nummer, die Sie vergeben — und unter der es im
ganzen Programm geführt wird. Bisher war das ein optionales Freitextfeld unter
den Stammdaten, angezeigt an vier Stellen und sonst folgenlos.

Ausführlich: [Die Projektnummer](/konzepte/projektnummer).

- **Pflicht und eindeutig.** Ohne Nummer kein Projekt; keine zweite trägt
  dieselbe, auch nicht in anderer Groß-/Kleinschreibung
- **Das Format bleibt frei** (`SAZTG-2026-014`, `A-14/2`, `Altbestand 1998/7`).
  Jedes erzwungene Muster steht irgendwann einem echten Vorgang im Weg
- **Überall sichtbar** — Aufgaben, Notizen, Termine, Dateien, Suche,
  Aktivität, Papierkorb, Portfolio, Projektliste
- **Als Verweis nutzbar:** `?projektnummer=SAZTG-2026-014` steht neben Name
  und technischer Kennung. An den Rechten ändert das nichts — die Auflösung
  liefert nur einen Namen, geprüft wird danach wie bisher
- **In Dateinamen:** `SAZTG-2026-014 Besprechungsprotokoll 2026-08-23.docx`
- **Korrigierbar, ohne etwas zu verlieren.** Die alte Nummer bleibt auffindbar
  und steht im Projektkopf als „früher: …" — ein bereits versendetes Dokument
  führt weiterhin zum richtigen Projekt
- **Rechnungsnummern** werden als `<Projektnummer>-R<NN>` vorgeschlagen.
  Ein Vorschlag, keine Vergabe: überschreibbar, ein Doppel wird gewarnt und
  nicht gesperrt

### Beim Bauen gefunden

- **Acht Unterrouten eines Projekts prüften den Zugriff nicht.** Darunter der
  volle Inhalt jeder Notiz, das komplette Projekt-Dossier — und schreibend:
  eine fremde Aufgabe abhaken, einen fremden Termin löschen. Die Lücke stand
  direkt neben dem richtigen Code: die POST-Route prüfte, die PATCH-Route drei
  Zeilen weiter nicht
- **Das Portfolio zeigte gelöschte Projekte.** Seit der Einführung des
  Papierkorbs löscht PATIO nur noch weich; das Cockpit filterte das nicht
- **Zeitstempel verließen den Server in zwei verschiedenen Formaten.** Die
  Folge war unsichtbar und trotzdem falsch: Aufgaben- und Notizenliste
  sortierten „zuletzt geändert" nach dem **Wochentagsnamen**
- **Der Aufgaben-Status hieß in der Datenbank anders als im Programm.** Die
  Registerkarte „Offen" zeigte deshalb nichts an, während über tausend offene
  Aufgaben vorlagen, und der Statuswechsel in der Detailansicht tat still gar
  nichts
