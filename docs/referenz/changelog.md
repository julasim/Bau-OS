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

## Die Oberfläche aus PATIO Desktop
**21.08.2026**

Der Server trägt jetzt dasselbe Erscheinungsbild wie PATIO Desktop:
Helvetica statt Inter, 13 px Grundschrift, durchgehend 7 px Radius, keine
Schatten, schwarze Navigationsleiste über eine eigene Hell/Dunkel-Achse.

- **Eine globale Leiste oben** mit Bereichsnamen und Brotkrumen. Dadurch
  bleiben Navigations- und Listenspalte über die volle Höhe stehen — vorher
  lag der Inhalt als Grid-Kind daneben
- **Seitenleiste hell oder dunkel** umschaltbar
- **Auf schmalen Bildschirmen** lässt sich die Listenspalte einblenden; unter
  768 px war sie vorher unerreichbar

### Beim Bauen gefunden

- Die Einstellungen boten einen Umschalter **„Workspace-Variante: Studio /
  Atelier"**. Das neue Stylesheet kennt nur noch „Studio" — der Knopf wäre
  stehengeblieben und hätte bei „Atelier" eine Oberfläche ohne eine einzige
  Regel hinterlassen. Er ist mit raus, und ein alter Eintrag im
  Browserspeicher kann den ungültigen Wert nicht mehr weitertragen
- Die neue Leiste lud das **Firmen-Branding ein zweites Mal**; die
  Navigationsleiste tat es längst. Jetzt eine geteilte Quelle — gemessen genau
  ein Aufruf je Seite statt zwei

Nicht dabei: der Fokus-Modus. Er setzt eine Kontext-Seitenleiste voraus, die
es hier noch nicht gibt; ohne sie wäre das Projekt eine 60 px schmale Leiste
ohne Navigation.

---

## Der Aufgabenreiter bekommt vier Arbeitsweisen
**23.08.2026** · Migrationen 050/051

Neben der gewohnten Liste stehen jetzt **Eingang**, **Matrix** und **Mein
Tag**. Umgeschaltet wird über einen Streifen oben in der Leiste.

Ausführlich: [Das Aufgabensystem](/konzepte/aufgabensystem).

- **Rang 1 bis 4** statt der nie benutzten Priorität — dringend und wichtig
  sind zwei Fragen, nicht eine Achse. Der Standard ist 3: der Normalfall wird
  nicht markiert
- **Geschätzter Aufwand** in groben Stufen (15/30/60/120/180/240 Minuten),
  damit sich die Tagessumme im Kopf nachrechnen lässt
- **Mein Tag** rechnet gegen ein Budget von fünf Fokusstunden und zeigt die
  Auslastung. **Gesperrt wird nichts** — eine harte Grenze wird nach der
  zweiten Umgehung zur Gewohnheit, eine sichtbare Zahl nicht
- **Der Tagesplan gehört der Person, nicht dem Büro**, und wird um Mitternacht
  für alle geleert. Keine Rückstandsliste, keine Übertragung

### Beim Bauen gefunden

- Das Tagesbudget hieß zuerst `budget` — und der **Geld-Filter warf es weg**,
  weil er Geldbeträge am Feldnamen erkennt. Für jedes Konto ohne Geld-Recht
  kam ein leeres Objekt zurück: Status 200, kein Fehler, kein Log, ein Balken,
  der auf null stehenblieb
- Der **Gesamtlauf der Tests war flackernd**, weil sich Namensräume paralleler
  Testdateien überlappen konnten

---

## Die Projektnummer wird zur Kennung
**23.08.2026** · Migrationen 052–054

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
- **`POST /api/projects` mit einem fremden Projektnamen war ein Beitritt.**
  Wer den Namen kannte, trug sich damit selbst in die Berechtigungstabelle ein
  — und überschrieb im selben Zug Projektnummer und Standort. Ein Projekt im
  Papierkorb kam dabei zurück
- **Drei Team-Routen prüften den Zugriff nicht.** Über sie ließen sich
  Mitglieder eines fremden Projekts anlegen, ändern und entfernen. Die
  Zuordnung kennt keinen Papierkorb — das Entfernen war endgültig
- **Der Vorlagen-Export gab fremde Stammdaten aus.** `?project=` wurde
  eingesetzt, ohne zu prüfen, ob der Fragende das Projekt sehen darf
- **Der Platzhalter für Projekte ohne Nummer stand in Word-Vorlagen, im
  Bericht und im Dossier** — als wäre `OHNE-NUMMER-…` eine Aktennummer
- **Die Projektauswahl in der Aufgaben-Detailansicht zeigte seit Mai JSON.**
  Sie erwartete eine Liste von Namen, die Route liefert Objekte
- **Die Bereinigung der Migration stimmte nicht mit dem Programm überein.**
  Sie versprach im Kopfkommentar, „genauso zu normalisieren, wie es die
  Anwendung tut" — gemessen entfernte sie Tabulator, Zeilenumbruch,
  geschütztes Leerzeichen und Byte-Reihenfolge-Marke nicht. Migration `054`
  bringt beide Seiten zusammen, und ein Test hält sie gegeneinander
- **`lower()` in Postgres und `toLowerCase()` in JavaScript sind nicht
  dasselbe** — gemessen in 9 von 1181 Zeichen. Verglichen wird die Nummer
  jetzt auf beiden Seiten der Abfrage von der Datenbank
- **Vier Ansichten benutzten eine Komponente, die sie nicht importiert
  hatten.** Vue rendert so etwas als unbekanntes HTML-Element: keine Warnung,
  kein Fehler, die Stelle bleibt einfach leer. Weder Typprüfung noch Linter
  noch Bau noch die Testsuite haben es bemerkt — jetzt prüft ein eigener Test
  jede `.vue`-Datei, und er fand sofort einen zweiten, älteren Fall

---

## Der Fokus-Modus — und Gestaltung, die zehn Ansichten nie erreicht hat
**24.08.2026**

Der Fokus-Modus aus PATIO Desktop steht jetzt auch hier. In der Projektakte
und in den Einstellungen schrumpft die Navigationsleiste auf 60 Pixel (nur
Symbole), und daneben trägt eine zweite, 238 Pixel breite Leiste die Reiter
des Projekts beziehungsweise die Bereiche der Einstellungen.

- **Die Projekt-Navigation ist aus der Hauptleiste ausgezogen.** Sie wechselte
  dort ihren Inhalt: wer in einem Projekt arbeitete, kam ohne Umweg nicht mehr
  zu den Aufgaben oder zum Kalender
- **Die Einstellungen haben ihr eigenes Menü verloren** — zwei Navigationen
  nebeneinander waren eine zu viel. Der geöffnete Bereich steht jetzt in der
  Adresse (`?sektion=word-export`): ein Link darauf lässt sich weitergeben,
  und wer sich einen Rechner teilt, landet nicht mehr im Bereich des
  Vorgängers
- **Auf dem Handy** bleibt die Hauptleiste breit und beschriftet; dort liegen
  beide Leisten ohnehin als Überblendung übereinander

Die Kontext-Leiste zeigt nur, was das eigene Konto auch öffnen darf.
„Rechnungen" braucht das Geld-Recht, „Zugriff" die Verwaltung — ein Eintrag,
der beim Klick eine Fehlermeldung öffnet, gehört nicht in die Navigation.

### Beim Bauen gefunden

- **Zehn Ansichten benutzten Gestaltungsregeln, die dort keine Wirkung
  hatten.** Vue begrenzt die Regeln einer Ansicht auf ihre eigenen Elemente;
  wird eine Klasse in einer zweiten Ansicht benutzt, greift sie dort nicht.
  Es gibt dafür keine Meldung: die Stelle rendert einfach ohne Gestaltung.
  Betroffen waren unter anderem die Aufgaben-Ansichten „Matrix" und „Mein
  Tag" (vollständig ohne eigene Gestaltung, seit sie gebaut wurden), die
  Stammdaten-Felder und das Zeilen-Menü der Team-Seite, die roten
  Lösch-Schaltflächen, die Eingabefelder in „Firmen" und in den
  Einstellungen. 44 Klassen insgesamt, jetzt an einer Stelle
- **Der Knopf „Ältere laden"** hatte überhaupt keine Regel — an drei Stellen
  der Projektakte stand ein nackter Browser-Knopf
- **„Heute" wurde nach Weltzeit bestimmt.** In Österreich liefert das zwischen
  Mitternacht und ein bzw. zwei Uhr früh den Vortag. Drei dieser Stellen
  füllten das Datum eines neuen Datensatzes vor — ein Bautagebuch-Eintrag um
  00:30 bekam damit den gestrigen Tag
- **Ein Verwalter, der einen Einstellungs-Bereich über ein Lesezeichen
  öffnete, wurde hinausgeworfen.** Die Prüfung „darf dieses Konto das?" lief,
  bevor die Antwort auf „wer bin ich?" da war — und „noch unbekannt" sah aus
  wie „darf nicht"
- **Die Beschriftungen der Navigationsleiste** trugen nicht die Kennzeichnung,
  auf die der Fokus-Modus zielt: die Leiste schrumpfte auf 60 Pixel, die Texte
  blieben stehen und liefen über

---

## Der Docker-Bau war 45 Commits lang kaputt
**25.08.2026**

Seit dem 6. August liess sich **kein Auslieferungspaket mehr schnüren**. Der
Firmenserver war damit von allem abgeschnitten, was seither gebaut wurde —
Export und PDF, Board, Neuigkeiten, Datenübernahme, KI-Zugriff, die
Oberflächen-Runde.

### Was passiert war

Mit `23d4f9a` („Der Server liefert die Dokumentation aus") wanderte der
Doku-Bau in `build:all`. VitePress holt für jede Seite ein Änderungsdatum, und
zwar über `git log`. Im Bau-Container gibt es weder das Programm `git` noch ein
Repository — und VitePress bricht bei einem fehlgeschlagenen Aufruf den
**gesamten** Bau ab:

```
[vitepress] spawn git ENOENT
file: /opt/patio/docs/betrieb/arbeitsplatz.md
```

Scharf geschaltet hatte die Funktion niemand bewusst. In der Konfiguration
stand `themeConfig.lastUpdated: { text: "Zuletzt aktualisiert" }` — dem Anschein
nach eine reine Beschriftung. VitePress leitet daraus die Datumsermittlung ab.

**Warum es 45 Commits lang niemand sah:** Drei Kommentare im Repo behaupteten,
die CI prüfe „identisch zu Docker" und der Pre-Push-Hook laufe „exakt den
gleichen Befehl". Der Befehl stimmt — die Umgebung nicht. Der Runner hat `git`
und ein `.git`; der Container hat beides nicht.

### Behoben

- `lastUpdated: false` in der Doku-Konfiguration, ausdrücklich und begründet.
  Die Zeile „Zuletzt aktualisiert" entfällt damit im Seitenfuss. Sie mit einem
  nachinstallierten `git` zurückzuholen wäre eine Täuschung gewesen: ohne
  Repository liefert `git log` nichts, das Datum bliebe leer — nachgemessen.
- Der irreführende Beschriftungs-Eintrag ist entfernt. Ohne die Funktion war er
  wirkungslos, und stehen zu bleiben hiesse nur, die Falle für den Nächsten
  wieder aufzustellen.
- Die drei falschen Kommentare sagen jetzt, was wirklich gilt.
- **Ein CI-Job baut die Builder-Stufe wirklich** — ohne LibreOffice, damit er
  schnell bleibt, und parallel zum Testlauf, damit er nichts kostet. Nur ein
  echter `docker build` beweist, dass ein Paket entstehen kann.

### Beim Prüfen dahinter gefunden

Der Bau war nur der erste Riegel. Der Auslieferungsweg trug auch danach nicht:

- **Die Basis-Images lagen nie im Paket.** `postgres:16`, `caddy:2-alpine` und
  `alpine:latest` fehlten. Auf einem Rechner ohne Internet scheiterte damit
  jede Erstinstallation. Bei einer bestehenden fiel es nur deshalb nicht auf,
  weil Postgres und Caddy ohnehin laufen — `alpine` hängt an keinem Container
  und wird von der Sicherung gebraucht: fehlte es, scheiterte die nächtliche
  Sicherung **ohne Meldung**, und jedes Update brach danach ab.
- **Ein gescheiterter Start umging den Rückweg.** Liess sich der Stack nicht
  hochfahren, endete das Update-Skript sofort — nach dem Laden des neuen
  Images und nach dem Ersetzen aller Dateien, aber vor der Gesundheitsprüfung
  und vor dem Rücksetzen. Genau der halb aktualisierte Rechner, den die
  Vorprüfung verhindern soll.
- **Jedes Paket hiess gleich.** Ohne Argument kommt die Version aus
  `package.json`, und die steht seit dem ersten Commit auf `0.1.0` — ein neues
  Paket überschrieb das vorige stillschweigend. Das vorige ist der Rückweg.
- **`logs/`, `data/` und `tools/` gehörten root**, der Dienst schreibt als
  uid 1000, und der Fehler wird im Protokoll-Baustein verschluckt. Folge:
  `patio.log` bleibt dauerhaft leer, während Monitoring und Troubleshooting
  genau dorthin verweisen.
- **Der dokumentierte Weg zum kleineren Paket wirkte nicht.** `MIT_PDF=nein`
  wurde beim Paketbau nicht durchgereicht; die 350 MB LibreOffice waren wieder
  drin.

### Und noch ein roter Lauf, der nichts mit dem Bau zu tun hatte

Nach der Reparatur meldete GitHub weiterhin einen Fehlschlag — diesmal im
bestehenden Job, nach 37 Sekunden. Das ist zu früh für die Tests, und der
Grund lag im **Gitleaks-Schritt**:

```
Regel:    generic-api-key
Datei:    .github/workflows/build.yml, Zeile 148
Treffer:  JWT_SECRET: ci-nur-fuer-tests-mindestens-32-zeichen-lang
```

Der Test-Schlüssel der CI. Er heisst wörtlich „ci-nur-fuer-tests" und steht
absichtlich im Klartext, damit die Testsuite ohne jede Repo-Einstellung läuft;
`config.ts` verlangt mindestens 32 Zeichen, und diese Länge bringt ihm die
Entropie ein, an der Gitleaks ihn als API-Schlüssel aufhängt.

Eingebaut wurde er am **23.08.2026**. Seitdem war **jeder** Lauf rot — und
weil der Scan über die ganze Historie geht, blieb er es unabhängig davon, was
danach kam. Aufgefallen ist es zwei Tage später, weil ein roter Haken am
Commit aussieht wie ein fehlgeschlagener Push. Die Pushes selbst gingen jedes
Mal durch.

Behoben über eine Allowlist in `.gitleaks.toml`, wie schon für das
Dummy-TOTP-Seed und die Testpasswörter. Nicht über ein GitHub-Secret: der Wert
schützt nichts — er signiert Token für eine Datenbank, die nach dem Lauf
verschwindet. Als Secret hinge die CI an einer Repo-Einstellung, die in einem
Fork fehlt; der Lauf wäre dann rot, ohne dass jemand den Grund sähe.

Gegengeprüft mit drei Läufen über dieselbe Historie: ohne Allowlist ein Fund,
mit Allowlist keiner — und ein testweise eingeschmuggeltes Zufallstoken in
derselben Datei wird weiterhin gefunden. Die Ausnahme deckt also genau diesen
einen Wert ab und nimmt nicht die Datei von der Prüfung aus.

---

## Doku gegen den Code geprüft — und dabei den Word-Export repariert
**26.–27.08.2026**

Alle 31 Doku-Seiten durchgesehen und jede Behauptung am Code belegt. Dabei kam
ein Programmfehler heraus, der schwerer wiegt als alles Redaktionelle.

### Der Word-Export war kaputt — alle sechs Wege

Ohne `?format=pdf` rief sich die ausliefernde Funktion **selbst** auf, mit
denselben Argumenten. Wer ein Word-Dokument wollte — der häufigere Fall —,
bekam keines, sondern einen Absturz der Anfrage
(`RangeError: Maximum call stack size exceeded`). Betroffen waren Protokoll,
Bautagebuch, Stundenzettel, Projektübersicht, Rechnung und die
Vorlagen-Vorschau.

Der Fehler kam mit dem Commit herein, der den PDF-Schalter einbaute; beim
Umbau ging der Word-Zweig verloren.

**Warum ihn kein Test gefangen hat:** keiner kam bis dorthin. In der
Testdatenbank liegt keine Word-Vorlage, deshalb enden alle vorhandenen
Export-Tests vorher — mit 400 (keine Vorlage), 403 (fremdes Projekt,
fehlendes Geld-Recht) oder 404 (unbekannte Rechnung). Vier Prüfungen über den
Rechnungs-Export, und keine erreichte die eine fehlerhafte Zeile.
`tests/api-export-word.test.ts` schließt die Lücke: es baut eine minimale
gültige `.docx`, lädt sie als Standardvorlage hoch und geht den Weg zu Ende.

### Zwei Doku-Befehle, die auf dem Server nie laufen konnten

`docker compose exec app npm run db:status` stand als Diagnosebefehl in
Monitoring und Troubleshooting. Er kann dort nicht funktionieren: das
Laufzeit-Image enthält `scripts/` gar nicht — kopiert werden nur
`node_modules`, `dist` und `package.json`. Ersetzt durch eine `psql`-Abfrage
auf `_migrations`, gegen die laufende Datenbank ausprobiert. `db:migrate`,
`db:import` und `db:reencrypt` sind Werkzeuge für den Entwicklungsrechner,
und das steht jetzt auch dort.

### Betriebsfallen, die still wirken

- **`docker image prune -a` löscht auf diesem Rechner den Rückweg.** Daran
  hängen zwei Dinge, die ohne Internet nicht zu beschaffen sind: das vorige
  PATIO-Image (nach einem Update markenlos, für `prune` also „ungenutzt" — es
  ist der automatische Rückweg) und `alpine:latest`, mit dem die Sicherung den
  CA-Schlüssel holt.
- **Fehlt `alpine:latest`, scheitert die nächtliche Sicherung ohne Meldung** —
  und danach bricht jedes Update mit „Die Sicherung ist fehlgeschlagen" ab,
  ohne dass die Ursache irgendwo steht.
- **Ein leeres Protokoll sieht aus wie Fehlerfreiheit.** Gehörte `logs/` dem
  Systemverwalter statt dem Dienst, blieben `patio.log` und `patio.jsonl`
  dauerhaft leer, während alles normal lief — und die Schnelldiagnose meldete
  null Fehler auf einer Maschine mit Fehlern.
- **Die Datenübernahme nannte einen Befehl, aber keinen Ort.** Jetzt steht der
  gangbare Weg da — temporäres Port-Mapping auf `127.0.0.1` plus SSH-Tunnel,
  danach wieder zurückgebaut —, ausdrücklich mit dem Hinweis, dass er noch an
  keiner echten Übernahme erprobt ist.

Dazu Redaktionelles, das im Betrieb teuer geworden wäre: Die Installation
versprach „einmal Internet, dann nie wieder", was bis zum 25.08. nicht
einlösbar war; die Server-Seite führte `/opt/patio` pauschal unter einem
Eigentümer, dem der Dienst die eigenen Ordner damit lautlos wieder verliert;
und die Paketgröße stand an drei Stellen mit drei verschiedenen Zahlen.

---

## Version 1.0.0 — die Erstinstallation zum ersten Mal wirklich gegangen
**28.08.2026**

Der Weg vom leeren Verzeichnis bis zum Einrichtungsassistenten wurde
vollständig durchgespielt: leere Volumes, das echte Paket, kein Internet.
`release/patio-1.0.0.tar.gz`, 497 MB, mit allen drei Basis-Images.

Belegt am laufenden Stand, nicht behauptet: Gesundheitsmeldung
`{"ok":true,"db":true}`, HTTP 200 auf die eigene Adresse und auf `/docs/`,
`{"needsSetup":true}` vom Einrichtungsassistenten, 61 Migrationen auf frischer
Datenbank, Zertifikat aus der eigenen CA, Umleitung von HTTP auf HTTPS — und
`patio.log` wird wirklich beschrieben, der Punkt, der drei Tage zuvor noch als
„bleibt dauerhaft leer" notiert war.

### Beim Durchspielen gefunden

- **Der zweite Installationsversuch scheitert — und die Meldung zeigt in die
  falsche Richtung.** Die Installation erzeugt jedes Mal ein neues
  Zufallspasswort für die Datenbank; Postgres übernimmt eines aber nur bei
  leerem Datenverzeichnis. Das Datenverzeichnis liegt in Docker und überlebt
  ein Löschen des Installationsverzeichnisses. Ergebnis: „Passwort falsch",
  während die Datenbank als gesund gemeldet wird und die Konfiguration in sich
  stimmt. Die Installation bricht jetzt vorher ab und nennt beide Wege.
- **Drei Diagnosewege meldeten auf einem gesunden Server Fehler.** Sie riefen
  einen Port, der auf dem Host gar nicht liegt, und ein Programm, das dort
  nicht installiert ist — auf dem Server läuft alles in Containern. Die
  Fehlerzeile brach zusätzlich in zwei, weil das Zählen von Treffern bei null
  Treffern zwar `0` ausgibt, aber als Fehlschlag endet.
- **`https://localhost/` antwortet auch auf einem gesunden Server nicht.** Das
  Zertifikat gilt für den Rechnernamen aus der Konfiguration, und nur für ihn.
  Beide Diagnosestellen nehmen den Namen jetzt von dort.
- **Die Prüfsumme trug den Pfad vom Baurechner.** Die Handprobe auf dem Server
  meldete daraufhin einen Lesefehler — es liest sich wie ein beschädigtes
  Paket, obwohl nur der Pfad nicht passte.
- **Auf dem Server war nicht feststellbar, welcher Stand läuft.** Eine Datei
  `/opt/patio/VERSION` hält ihn jetzt fest — geschrieben erst nach bestandener
  Gesundheitsprüfung, beim Rückweg zurückgenommen —, und die Statusabfrage
  zeigt ihn an.

::: warning Was in dieser Umgebung nicht prüfbar war
Sicherungsplatte samt Rücksicherung, USV, und ob das Arbeitsplatz-Programm dem
Zertifikat der internen CA nach dem Import traut. Das bleibt Handarbeit vor
Ort.
:::

---

## Die Netzfreigabe ist entfallen — Dateien kommen nur noch über PATIO herein
**29.08.2026**

**Entscheidung:** Es wird keine Samba-Freigabe geben. Niemand bindet den
Dokumentenordner mehr im Windows-Explorer ein. Was ins System soll, geht über
die Oberfläche und liegt danach in der Datenbank — mit Projektbezug, Rechten
und Volltextsuche. Damit fällt die zweite Ablage weg; „zwei Ablagen, klar
getrennt" war ein tragendes Konzept dieser Dokumentation und ist jetzt eines.

Entfallen sind die Freigabe-Konfiguration und ihre Seite in dieser
Dokumentation, dazu ein Schritt der Installation, die Prüfung im Installer,
die Gruppe und das Konto dahinter, der Papierkorb der Freigabe und Port 445 in
der Firewall — es sind jetzt genau drei Ports.

**Der interne Ordner bleibt** (`/opt/patio-workspace`, im Container
`/workspace`): Er wird weiter gesichert, und der Dienst liest daraus
Alt-Datensätze nach, deren Inhalt nicht in der Datenbank liegt. Von außen ist
er nicht mehr erreichbar. An der Funktion hat sich nichts geändert.

Drei Stellen brauchten mehr als Streichen: Die Begründung für die
Ordner-Rechte stand danach genau falsch herum — nicht die Freigabe zählt,
sondern der Dienst, der als `uid 1000` läuft. Der Hinweis zum Reparieren der
Rechte stand unter „Upload schlägt fehl", obwohl der Upload gar nichts ins
Dateisystem schreibt; er gehört zum **Herunterladen** eines Alt-Eintrags. Und
das Wurzelzertifikat wurde bisher über die Freigabe verteilt — dieser Weg ist
weg, es bleiben USB-Stick oder `scp`.

**Nebeneffekt:** Die beiden Befehle, die auf Ubuntu 24.04 an der bereits
vergebenen Kennung 1000 gescheitert wären — der Punkt, der die
Erstinstallation als erstes getroffen hätte —, brauchte ausschließlich Samba.
Sie sind mit ihm entfallen.

### Dazu zwei rote CI-Läufe

- **Ein Test war nur gegen die gewachsene Entwicklungsdatenbank grün.** Er
  prüfte auf ein Konto, das er nie anlegte; lokal war es seit Wochen da, auf
  einer von Null migrierten Datenbank nicht. Seit dem 23.08. kippte er bei
  **jedem** Lauf neun Prüfungen. Der Test versorgt sich jetzt selbst und räumt
  nur weg, was er selbst angelegt hat.
- **Die Fehlermeldung des Übernahme-Skripts gab die Abfrage aus statt ihres
  Ergebnisses** — also gerade nicht die Auskunft, die man braucht. Eine
  Datenübernahme läuft im Ernstfall einmal, unter Zeitdruck, auf fremden
  Daten; jetzt listet die Meldung die vorhandenen Konten auf.
- **Die Dokumentation behauptete an zwei Stellen, der Installer bringe Docker
  und Samba mit.** Er installiert nichts, er prüft nur. Das ist hier nicht
  kosmetisch: Es gibt genau ein Fenster, in dem Nachinstallieren möglich ist —
  danach hat der Rechner kein Internet mehr.

---

## Verteilweg des Arbeitsplatz-Programms, und ein Zeitstempel ohne definierte Reihenfolge
**30.08.2026**

**Die Anleitung zum Arbeitsplatz-Programm zeigte noch auf die abgeschaffte
Freigabe** — sechs Stellen in drei Seiten ließen die `.exe` von einem
Netzordner starten, den es auf diesem Server nicht mehr gibt. Jetzt steht dort
der Weg, der ohnehin zweimal gebraucht wird: der USB-Stick, auf dem
Auslieferungspaket und Wurzelzertifikat liegen. Dazu deutlich gesagt, was das
heißt — eine neue Fassung ersetzt die Datei **an jedem Platz einzeln**.

**Die Ratebremse hängt vollständig an Caddy — nachgemessen.** Eine Prüfung
hatte gemeldet, ein Angreifer könne die Bremse über einen mitgeschickten
Kopfzeilen-Eintrag umgehen. An der laufenden Anlage nachgestellt: Direkt gegen
den Dienst gerichtet stimmt das — die Anwendung nimmt den Eintrag ungeprüft.
Über Caddy nicht: Caddy **ersetzt** ihn durch die echte Adresse, und der
zweite Versuch bekam prompt die Sperre. Daraus die Betriebsregel, die jetzt am
Code steht: **der App-Container darf nie einen eigenen Port nach außen
bekommen.** Wer den Dienst direkt erreichbar macht oder einen anderen Proxy
davorsetzt, verliert Ratebremse und Aussagekraft des Protokolls — lautlos.

**Und ein Fehler, der lange nur aus Zufall gutging:** Bei zwei gleichnamigen
Notizen soll die jüngere getroffen werden. Der Zeitstempel kam aus der
Anwendung und war auf Millisekunden genau — zwei schnell aufeinanderfolgende
Notizen bekamen denselben Wert, und die Abfrage hatte damit kein definiertes
Ergebnis. Auf dem Entwicklungsrechner fielen die beiden Anlagen durch den
Netzweg zur Datenbank immer auseinander; in der CI, wo die Datenbank auf
demselben Rechner liegt, nicht: **20 von 20 Paaren** trugen dieselbe Zeit.
Auch die Vorgabe der Datenbank half nicht — sie liefert die Zeit der
Transaktion, und beide Anlagen liegen in derselben. Erst die Anweisungszeit
macht sie unterscheidbar; ein zusätzliches Ordnungsmerkmal macht das Ergebnis
im theoretischen Gleichstand wenigstens vorhersagbar statt zufällig.

---

## Die Sicherung meldete jede Nacht Fehlschlag — und blockierte damit jedes Update
**30.08.2026**

Ein Code-Review über das ganze System hat zwanzig Fehler zutage gefördert. Die
schwerwiegendsten sitzen im Betrieb, und sie haben eines gemeinsam: Sie treffen
nicht den Ausnahmefall, sondern den Regelfall — und sie melden sich nicht.

### Die nächtliche Sicherung endete mit einem Fehler, obwohl sie gelang

Die letzte Zeile des Sicherungsskripts prüfte, ob unbrauchbare Stände
herumliegen. Liegt keiner herum — der Normalfall —, ist das Ergebnis dieser
Prüfung „nein", und weil es die letzte Zeile war, wurde daraus der Rückgabewert
des ganzen Skripts: **Fehlschlag.**

Die Folgen:

- Der Dienst, der bei einem Fehlschlag Alarm schlägt, feuerte nach **jeder
  erfolgreichen Nacht** — Meldung an alle angemeldeten Terminals, Eintrag im
  Fehlerprotokoll, Fehlermarke im Programm.
- Jedes Update bricht ab, wenn die Sicherung davor fehlschlägt. **Der Server
  wäre nicht mehr aktualisierbar gewesen.**

Nachgemessen auf Ubuntu 24.04: Die Sicherung lief sauber durch — „Selbstprüfung
bestanden", „Sicherung abgeschlossen" — und endete mit Rückgabewert 1. Nach der
Reparatur: 0. Ein Test hält die Konstruktion jetzt für alle Server-Skripte fest.

### Die Fehlermarke wurde nie zurückgenommen

Schlägt die Sicherung fehl, entsteht eine Datei, die `patio status` als rotes
Kreuz anzeigt. **Gelöscht hat sie niemand** — im ganzen Programm gab es keine
Stelle dafür. Zusammen mit dem Fehler oben stand das Kreuz ab der ersten Nacht
dauerhaft. Der nächste erfolgreiche Lauf nimmt es jetzt selbst zurück.

### Eine Sicherung ohne CA-Schlüssel galt als vollständig

Der Datenbank-Teil wird seit jeher scharf geprüft: Jeder Lauf spielt den
frischen Stand in einen Wegwerf-Container zurück und vergleicht die Zeilen.
Für die drei übrigen Bestandteile stand dagegen nur eine Warnung im Protokoll —
die Marke „vollständig" entstand trotzdem.

Am teuersten fällt das beim **Schlüssel der internen Zertifizierungsstelle**
aus: Ohne ihn erzeugt der Proxy beim Wiederaufbau eine neue, und dann muss
jemand an **jeden** Arbeitsplatz. Die Sicherung wäre formal in Ordnung gewesen
und der Wiederanlauf trotzdem ein Tagesprojekt. Jetzt zählt ein Stand nur als
vollständig, wenn alle vier Teile da und nicht leer sind.

### Abgebrochene Läufe blieben für immer liegen

Bricht die Sicherung mittendrin ab, trug ihr Verzeichnis bisher **keine der
beiden Marken** — und fiel damit durch beide Aufräumregeln. Jeder Fehlversuch
ließ mehrere hundert Megabyte zurück, ohne dass die Aufbewahrung es bemerkte.

### Der Rückweg eines Updates holte nur das halbe System zurück

Schlägt ein Update fehl, wird das vorige Programm-Abbild wieder eingesetzt.
Compose-Datei, Proxy-Konfiguration und die Systemdienste waren zu diesem
Zeitpunkt aber **längst ersetzt**. Setzt die neue Fassung etwas voraus, das die
alte nicht mitbringt, scheitert auch der Rückweg — übrig bleibt genau der halb
aktualisierte Rechner, den die Vorprüfung verhindern soll. Der vorige Stand
wird jetzt vorher beiseitegelegt und mit zurückgespielt.

### Eine geänderte Proxy-Konfiguration erreichte den Proxy nie

Beim Update wird das Verzeichnis mit der Proxy-Konfiguration ersetzt. Die Datei
darin ist einzeln in den laufenden Container eingehängt — und der hält nach dem
Austausch weiter die alte fest. Ein Update, das einen Zugriffsweg korrigiert,
war damit eingespielt und trotzdem wirkungslos, ohne jede Meldung. Der Proxy
wird jetzt neu erzeugt.

### Geänderte Systemdienste wurden nie wirksam

Die Einheiten der Sicherung wurden **nur bei der Erstinstallation** eingespielt.
Ein Update ersetzte sie im Installationsverzeichnis, die tatsächlich laufende
Einheit blieb die alte — und niemand merkte es, weil sie weiterlief.

### Die Gesundheitsprüfung sagte nichts über die Datenbank

`/api/health` meldete `db: true`, sobald eine Datenbank-Adresse **konfiguriert**
war. Ob sie erreichbar ist, wurde nie gefragt. Fällt Postgres im laufenden
Betrieb aus, blieb das damit unsichtbar: Container „gesund", `patio status`
meldet „Der Dienst antwortet", ein Update gilt als gelungen — während jeder
Datenzugriff fehlschlägt.

Jetzt fragt der Endpunkt die Datenbank wirklich (mit fünf Sekunden
Zwischenspeicher) und antwortet bei einem Ausfall mit **503**. Nachgemessen:
Datenbank gestoppt → 503, Datenbank zurück → 200.

### Die Rücksicherung meldete Erfolg, ohne den Dienst gesehen zu haben

Lief das Programm vor der Rücksicherung nicht — der Regelfall beim
Totalausfall —, übersprang das Skript den Start und meldete trotzdem
„abgeschlossen". Dazu wurde der Proxy nach dem Zurückspielen des
CA-Schlüssels nicht neu gestartet; er arbeitete mit dem alten Zustand weiter,
und am Arbeitsplatz stand weiterhin eine Zertifikatswarnung. Beides behoben,
und die Abschlussmeldung sagt jetzt ausdrücklich, ob der Dienst antwortet.

### Die Sicherungsanzeige blieb nach der Erstinstallation blind

Die Platte wird erst **nach** dem Start der Container eingehängt. Ein solcher
Mount ist für den Container unsichtbar — die Anzeige unter „Verwaltung →
Sicherung" hätte dauerhaft „keine Sicherung gefunden" gemeldet, während nachts
sauber gesichert wird.

Der naheliegende Weg — die Einhänge-Art auf `rslave` stellen — wurde geprüft
und **verworfen**: Auf einem Rechner, dessen Mountpunkt `private` ist, verweigert
Docker dann den Start des Containers („path … is not a shared or slave mount",
in WSL Ubuntu-24.04 nachgemessen). Eine Compose-Datei, die auf der eigenen
Prüfmaschine nicht hochkommt, wäre ein schlechter Tausch gegen eine Anzeige.
Stattdessen nennt die Installation den Schritt, der immer trägt: nach dem
Einhängen einmal `docker compose up -d --force-recreate app`.

### `patio restart` las die Konfiguration nicht neu

Der Befehl startete die Container nur neu; geänderte Werte in der `.env` greifen
dabei nicht. Wer nach einer Änderung den naheliegenden Befehl nahm, arbeitete
weiter mit den alten Werten. Jetzt werden die Container neu erzeugt.

---

## Das Board darf die Akte öffnen — und Kontaktdaten bleiben trotzdem drin

Die Rolle **Präsentation** ist das Konto für das Board im Besprechungsraum. Sie
sah bisher in den *Listen* jedes Projekt, bekam auf die *Akte* aber 403 — ein
Board, dessen Kacheln sich nicht öffnen lassen, sieht nach einem Defekt aus und
ist einer. Die Ausnahme steht jetzt auch in `canSeeProject()`.

Damit erreicht das Konto die Detailrouten: Projektakte, Notizen, Aufgaben,
Termine, Bautagebuch, Besprechungsprotokolle, Entscheidungen, Phasen, Stunden.
Das ist eine spürbare Ausweitung, und sie trifft ausgerechnet die
vertraulichsten Freitexte. Getragen wird sie davon, dass an dem Gerät niemand
sitzt, es nichts schreiben und — ab jetzt — nichts mitnehmen kann.

### Der Volldump ging am Personendaten-Filter vorbei

Der Filter, der E-Mail und Telefonnummer aus den Antworten für dieses Konto
entfernt, fasst ausschließlich JSON an. Ein Volldump ist ein ZIP, ein Dossier
ist Markdown — beide liefen unverändert hindurch, und im Volldump lag die
Team-Liste des ganzen Hauses mit allen Kontaktdaten.

Geschlossen mit zwei voneinander unabhängigen Sperren: die Anzeige kommt gar
nicht mehr an `/api/exports/*` — an dem Gerät gibt es weder Drucker noch
Dateidialog, ein Massenabzug über ein unbeaufsichtigtes Konto ist genau die
Bauform, die man später erklären muss — und selbst wenn sie hinkäme, ließe die
Team-Liste die Spalten E-Mail und Telefon weg. Dasselbe gilt für das Dossier.

Der Word-Export war ebenfalls verdächtig und ist es nicht: nachgesehen liest er
`name`, `role` und `company`; die Kontaktangaben darin stammen aus dem eigenen
Briefkopf.

**Nicht eingeschränkt wurde der Volldump für normale Konten.** Sein Inhalt
hängt bereits an den Rechten — ein Mitarbeiter bekommt seine eigenen Projekte,
nicht das Haus. Ein Verwaltungsvorbehalt hätte jedem den Abzug seines eigenen
Bestands genommen, ohne dass irgendwo weniger Daten flössen.

### Wer etwas mitnimmt, steht jetzt im Protokoll

Bis hierher hielt das Prüfprotokoll ausschließlich fest, **wer hereinkommt**.
Was hinausgeht, stand nirgends — dabei ist das die Zeile, die man bei einer
Frage nach Bauherrendaten sucht. Vier neue Ereignisse: Volldump, Dossier,
Word-/PDF-Export und KI-Akte, jeweils mit Umfang und der Angabe, ob Beträge und
Kontaktdaten enthalten waren.

::: danger Dabei gefunden: das Prüfprotokoll protokollierte seine Details nie
Beim Schreiben eines Eintrags wurde das Detailfeld **doppelt kodiert** — in der
Spalte landete eine Zeichenkette statt eines Objekts, und die Leseseite verwarf
sie stillschweigend zu einer leeren Klammer.

Betroffen war **jeder Eintrag**, seit es das Protokoll gibt: der Grund einer
fehlgeschlagenen Anmeldung, die alte und die neue Rolle bei einer Änderung, das
Ziel eines Passwort-Resets — alles wurde geschrieben und war nie abrufbar. In
der Testdatenbank traf es 2839 von 2839 Zeilen.

Keine Prüfung hat das gefangen, weil alle vorhandenen nur den Statuscode und
die Listenform prüfen; der **Inhalt** der Einträge war nie Gegenstand. Behoben,
und Alteinträge sind jetzt ebenfalls lesbar.

Dieselbe Schreibform steckt in fünf weiteren Feldern (Alternativen einer
Entscheidung, Rechnungspositionen, Aufgabenpunkte einer Besprechung, Personal
im Bautagebuch, Kontaktverlauf). Dort fällt sie nicht auf, weil die Leseseiten
sie abfangen — sie gehört trotzdem geradegezogen, in einem eigenen Schritt mit
eigener Prüfung.
:::

---

## Das Board zeigte seit seinem Bau keinen einzigen Termin

Die Terminspalte war Text. Darin standen **drei Schreibweisen nebeneinander**:
`15.09.2026` aus der Oberfläche, `2026-09-15` aus dem automatischen
Phasen-Meilenstein, und aus der alten Datenübernahme alles, was dort eben
stand — bis hin zu `morgen` und einem leeren Feld.

Das Board im Besprechungsraum vergleicht das heutige Datum in ISO gegen diese
Spalte. Gegen `15.09.2026` trifft das nie zu. **Es hat deshalb nie einen Termin
angezeigt** — und weil dabei kein Fehler entstand, sah es aus wie ein ruhiger
Tag im Büro.

Migration `060` hebt die Spalte auf ein echtes Datum. Damit funktionieren
gleichzeitig: die Wochenansicht des Boards, die nächste Frist im Portfolio, der
nächste Termin in der Projektakte und die Sortierung — sie ging vorher nach dem
Tag im Monat, also 3. Dezember vor 15. Januar.

Was dabei sonst noch herauskam:

- **`/board/heute` antwortete jedem Konto mit eingeschränkter Sicht mit einem
  Serverfehler.** Eine Zeichenketten-Ersetzung im Abfrage-Baukasten traf die
  falsche Stelle. Für die Verwaltung fiel das nicht auf, weil bei ihr gar nichts
  zu ersetzen war — und die Prüfung fuhr die Route nur als Verwaltung.
- **Der 31. Februar wurde angenommen.** Geprüft wurden nur Bereiche: Tag
  höchstens 31, Monat höchstens 12. Solange die Spalte Text war, landete das
  unbeanstandet in der Datenbank.
- **Die Kachel „heute" im Dashboard rechnete in der falschen Zeitzone.** Sie
  las die Uhrzeit des Servers, und der läuft im Container auf UTC — zwischen
  Mitternacht und zwei Uhr früh zeigte sie den Vortag.
- **Das Datumsfeld im Kalender öffnete sich leer.** Ein Datumsfeld im Browser
  nimmt ausschließlich ISO; es bekam den deutschen Rohwert und zeigte nichts.
  Wer nur den Text eines Termins ändern wollte, musste das Datum neu eingeben.
- **Die Datenübernahme prüfte das Datum nicht** — sie war die Quelle des
  Mischbestands. Jetzt überspringt sie unlesbare Termine und meldet sie.

Unlesbare Datumsangaben wandern beim Update in den Papierkorb, mit ihrem
ursprünglichen Wert im Text. Nichts geht verloren; was zu tun ist, steht unter
[Updates](/betrieb/updates).

::: danger Nach diesem Update ist ein Downgrade des Programms nicht möglich
Schema und Programm gehören zusammen. Der Rückweg ist die Sicherung von vor dem
Update.
:::

---

## Fehler waren unsichtbar, und der Konfliktschutz war es auch

### Der Konfliktschutz für Team-Mitglieder war nie erreichbar

Das System zählt bei jedem Datensatz mit, wie oft er geändert wurde — damit
zwei Personen, die gleichzeitig dasselbe bearbeiten, nicht einander
überschreiben. Bei den Team-Mitgliedern kam dieser Zähler **nie an**: Die
Route nimmt nur eine feste Liste von Feldern entgegen, und der Zähler stand
nicht darin. Kein Client hätte daran etwas ändern können.

Gefunden beim Nachlesen des eigenen Plans, nicht im Code-Review. Festgehalten
ist es jetzt über die **Wirkung** — zweimal mit demselben Zähler schreiben muss
beim zweiten Mal abgewiesen werden. Eine Prüfung, die nur nachsieht, ob die
Oberfläche den Zähler mitschickt, wäre grün geblieben.

### Fehlermeldungen kamen nicht an

Die Oberfläche warf bei jedem Serverfehler denselben allgemeinen Fehler —
**keine Ansicht konnte einen Konflikt von einer Störung unterscheiden.** Die
Folge war überall dieselbe: Bei einem abgelehnten Speichern wurde neu geladen
und die Eingabe des Nutzers dabei verworfen, ohne ihm zu sagen, was falsch war.

- **Die Team-Seite hatte keine einzige Fehleranzeige** bei dreizehn Stellen,
  die Fehler abfingen — die meisten davon leer. Jeder Fehlschlag lief lautlos
  ab: Der Wert sprang zurück, die Zuordnung erschien nicht, das Häkchen blieb
  ungesetzt. Für den Nutzer nicht von der eigenen Fehlbedienung zu
  unterscheiden.
- **Aufgaben- und Notiz-Editor hängten sich bei einem Speicherfehler selbst
  aus.** Die Meldung erschien *anstelle* des Textes — genau in dem Moment, in
  dem man ihn am dringendsten braucht.
- **Eine neue Aufgabe verschwand beim Tippen**, wenn das Anlegen fehlschlug:
  Das Feld wurde vor dem Absenden geleert, und es gab keine Meldung.
- **Löschen meldete einen Fehler, obwohl es gelungen war.** Zwei Routen
  antworten ohne Inhalt; die Oberfläche versuchte trotzdem, einen zu lesen.
- **Eine Meldung in den Neuigkeiten ließ sich nicht öffnen**, wenn das
  Markieren als gelesen scheiterte — das Öffnen hing daran.

### Live-Updates: drei Verbindungen für dieselben Ereignisse

Im Aufgabenbereich hielten Navigationsleiste, Kopfzeile und Liste je eine
eigene Verbindung zum Server offen. Jetzt teilen sich alle Ansichten eine.
Nebeneffekt: Das Störungsbanner wurde vorher von einer einzelnen abgerissenen
Verbindung gesetzt, während die anderen standen.

### Was die Selbstprüfung danach noch gefunden hat

Nach dem Umbau lief eine Prüfrunde über die eigenen Änderungen. Sie hat vier
Dinge zutage gefördert — zwei davon Fehler, die erst durch diesen Umbau
entstanden wären:

- **Die Migration hätte den Dienststart verhindern können.** Ihr zweiter
  Sicherungsblock verglich mit `<>` statt mit `IS DISTINCT FROM`. Auf einer
  Datenbank ohne die Terminspalte ergibt dieser Vergleich weder wahr noch
  falsch, sondern nichts — die Abbruchbedingung feuerte nicht, und die
  Migration lief in eine Abfrage auf eine Tabelle, die es nicht gibt. Ein paar
  Zeilen weiter oben war derselbe Fall korrekt behandelt.
- **Ein geleertes Datumsfeld wäre zum Serverfehler geworden.** Die Prüfung im
  Datenzugriff lautete „falls ein Datum da ist" — und ein leerer Text zählt
  dort nicht als „da". Solange die Spalte Text war, landete er einfach
  unbeanstandet in der Datenbank; danach wäre es ein Absturz gewesen. Das
  Datumsfeld im Kalender lässt sich leeren, der Weg war also offen.
- **Die Datenübernahme verschob Datumsangaben um Monate.** Sie schrieb rohe
  Zeichenketten in Datumsspalten; der Datenbanktreiber liest einen
  punktgetrennten Wert in amerikanischer Schreibweise. Nachgemessen: **der
  5. Oktober wurde zum 9. Mai** — ohne Fehlermeldung. Betroffen waren
  Besprechungen, Entscheidungen, Bautagebuch und Rechnungen; bei den Terminen
  war es in derselben Runde bereits behoben. Andere Werte (`31.12.2026`, ein
  leeres Feld) rissen stattdessen die gesamte Übernahme ab, mit einer Meldung,
  aus der niemand ableiten kann, welche Datei gemeint war.
- **Die nächste Frist im Portfolio war einen Tag zu früh.** Sie rechnete
  „heute" aus der Uhrzeit des Servers und schob dabei über den
  Zeitzonen-Versatz auf den Vortag. Ein Termin von gestern galt damit als
  nächste Frist, und die Ampel sprang für einen Tag auf Rot.

Dazu behoben, weil es in derselben Datei lag: Leere Datumsfelder erschienen im
Archiv als `..null` statt als Gedankenstrich — die Bremse dafür prüfte einen
Wert, der nie leer sein kann.

---

## Zweiter Durchgang der Fehlerbehebung
**02.09.2026**

Die Arbeitspakete, die im ersten Durchgang bewusst offen geblieben waren, plus
das, was die Selbstprüfung darüber hinaus gefunden hat. **850 Prüfungen**
(vorher 801).

### Ein Kontaktvermerk war noch nie sichtbar

Jeder Vermerk, den jemand zu einem Team-Mitglied notiert hat, wurde in einer
Form gespeichert, die die Leseseite verwirft: **223 von 223 Zeilen** in der
Prüfdatenbank standen auf „leer", obwohl geschrieben wurde. Dieselbe
Schreibweise steckte in **sieben** Feldern; bei zweien kostete sie Daten — bei
den Kontaktvermerken sofort, bei den persönlichen Einstellungen beim nächsten
Speichern.

Die Leseseite bleibt bewusst nachsichtig: Der Altbestand liegt weiter in der
alten Form, und Migrationen laufen hier nur vorwärts. Sie versteht jetzt drei
Formen statt einer — die dritte entsteht, wenn an eine bereits falsch
gespeicherte Liste angehängt wurde.

### Löschen traf mehr als das Gemeinte

- **Ein Team-Mitglied konnte jedes angemeldete Konto entfernen** — an dem
  Löschvorgang hängen vier Fremdschlüssel und zwei Auslöser, und einen
  Papierkorb gibt es dafür nicht. Jetzt der Verwaltung vorbehalten.
- **Zwei gleichnamige Mitglieder wurden beide gelöscht.** Jetzt wird über die
  Kennung aufgelöst; bei Mehrdeutigkeit passiert nichts, statt zu raten.
- **Bei Dateien prüften Rechte und Wirkung verschiedene Zeilen.** Die
  Rechteprüfung löste streng über die Kennung auf, das Löschen zusätzlich über
  den Dateinamen — projektübergreifend und endgültig.
- **Das Abhaken einer Aufgabe lief projektübergreifend.** Der Aufruf gab den
  Projektnamen mit, die Datenschicht nahm ihn gar nicht entgegen: Jede Aufgabe
  mit demselben Wortlaut wurde mit abgehakt, in jedem Projekt.

### Was im Papierkorb liegt, ist jetzt überall weg

Der Filter fehlte an fünf Stellen: in der Suche, in der Aktivitätsliste, in den
Kennzahlen der Projektakte, in der Notizliste eines Projekts und bei der
nächsten Frist im Portfolio. Besonders auffällig in der Aktivitätsliste: Das
Löschen setzt den Änderungszeitpunkt neu — der gelöschte Eintrag stand danach
**ganz oben**.

### Das Anzeigekonto: zwei Wege am Verbot vorbei

Das Konto für den Bildschirm im Besprechungsraum darf keine Dateien öffnen.
Über die **Suche** bekam es trotzdem Dateinamen und die ersten 200 Zeichen des
ausgelesenen Dokumententexts. Datei-Treffer entfallen für diese Rolle jetzt
ganz; Projekte, Notizen und Aufgaben bleiben durchsuchbar.

Der zweite Weg war unscheinbarer: Die Live-Meldung über eine hochgeladene Datei
trug als Kennung **den Dateinamen** — bei einem Sammelupload eine ganze Liste.
Jetzt steht dort die Kennung.

::: tip Persönliche Einträge auf dem Bildschirm
Aufgaben und Termine **ohne Projektzuordnung** erscheinen weiterhin auf dem
Bildschirm im Besprechungsraum. Wer einen Eintrag dort nicht sehen möchte,
ordnet ihn einem Projekt zu.
:::

### Datumsangaben: was im ersten Durchgang übrig blieb

- **Projektbeginn und -ende erschienen im Dossier und in der KI-Akte als
  Wochentagsangabe** (`Sun Mar 01 2026 01:00:00 GMT+0100`). Dieselbe Ursache
  wie bei den Terminen, eine Tabelle weiter.
- **Das Fälligkeitsdatum einer Aufgabe wurde bisher nirgends geprüft.** Ein
  deutsch geschriebenes Datum wurde beim Anzeigen **vertauscht**: aus dem
  5. September wurde der 9. Mai, ein Tag über dem 12. ergab eine leere Zelle.
  Die Prüfung beim Speichern ist ergänzt, die Anzeige versteht beide
  Schreibweisen. Ein Tag, den es nicht gibt (`31.02.`), bleibt bewusst leer,
  statt still auf den 3. März verschoben zu werden.

### Konflikte waren eine Sackgasse

Der im ersten Durchgang eingeführte Konfliktschutz hatte eine Kehrseite: Wer
auf einen Konflikt lief, konnte in drei Ansichten **nicht mehr speichern** —
auch der nächste Versuch scheiterte mit demselben veralteten Zähler, und ohne
Neuladen der Seite war die Ansicht nicht mehr benutzbar. Jetzt wird im
Konfliktfall der Stand der Kollegin nachgezogen.

Dazu bei den Live-Updates zwei Zustände, aus denen es kein Zurück gab: Nach
rund fünfeinhalb Minuten Verbindungsverlust — kürzer als ein Update dauert —
wurde nie wieder verbunden; und blieb der Abruf der Eintrittskarte ohne
Antwort, kam es gar nicht erst zu einem Verbindungsversuch. Beides greift jetzt
wieder, sobald das Netz zurück ist oder das Fenster wieder in den Vordergrund
kommt.

### Kleineres, das keiner gemerkt hätte

- **Ein Anmeldeversuch mit falschem Passwort lud die Seite neu** und löschte
  damit die Meldung, bevor jemand sie lesen konnte.
- **Eine Notiz meldete Erfolg, ohne gespeichert zu haben**, wenn sie zwischen
  Auflösen und Schreiben verschwunden war.
- **Benachrichtigungen zu Aufgaben und Terminen trugen keinen Projektbezug** —
  die Glocke zeigte sie ohne Projekt an, obwohl die Spalte dafür von Anfang an
  vorhanden war. Nur Besprechungen gaben ihn je mit.
- **Aufgaben und Termine, die über die Projektakte angelegt wurden, hatten
  keinen Verfasser.** Über den anderen Weg angelegt schon — dieselbe Aufgabe,
  je nach Weg.
- **Der Wechsel der Standardvorlage lief in zwei Schritten**, dazwischen gab es
  keine. Jetzt in einem.
- **Ein Upload meldete Erfolg, auch wenn Dateien fehlschlugen.** Jetzt nennt
  die Antwort, welche.
- **Ein Datenabfluss wurde protokolliert, bevor feststand, dass etwas
  ausgeliefert wird** — ein gescheiterter PDF-Export und jeder Vorschau-Klick
  standen als Abfluss im Protokoll.
- **Die Druckansicht der Projektakte blendete Elemente aus, die es nicht mehr
  gibt** — die Navigationsleiste kam mit aufs Blatt.
- **Zwanzig Gestaltungsklassen waren nirgends definiert.** Der Störungsbanner
  schwebte deshalb nicht über der Oberfläche, der Ungelesen-Zähler hatte kein
  Aussehen, und Einstellungen und Profilbild saßen nicht am unteren Rand.

### Zwei neue Wächter

- **Eine benutzte, aber nirgends definierte Gestaltungsklasse** fällt jetzt
  beim Prüflauf auf. Geprüft wird gegen das gebaute Ergebnis, nicht gegen die
  Quelltexte — sonst gäbe es Fehlalarme für alle Hilfsklassen.
- **Eine Ansicht, die sich nicht übersetzen lässt**, fällt ebenfalls auf. Am
  02.09. stand in einer Ansicht ein Kommentar mitten in einem öffnenden Tag:
  Typprüfung und Stilprüfung meldeten nichts, der Prüflauf war grün — und der
  Bau brach ab. Genau die Konstellation, die den Auslieferungsbau schon einmal
  45 Commits lang unbemerkt kaputt gehalten hat.

---

## Dokumentation gegen den Code abgeglichen
**05.09.2026**

Alle 30 Handbuchseiten plus das README wurden Behauptung für Behauptung gegen
den Quelltext geprüft. **102 Verdachtsfälle**, jeder von zwei unabhängigen
Prüfern gegengelesen — einer gegen die Behauptung, einer gegen den
Korrekturvorschlag. **27 haben sich als unbegründet erwiesen** und blieben
unangetastet; **75 waren echt** und sind behoben.

### Zwei Schritte fehlten in der Anleitung

- **Nach dem Einhängen der Sicherungsplatte** muss der Anwendungs-Container
  einmal neu erzeugt werden. Ein Container sieht ein Verzeichnis so, wie es
  beim Start aussah. Ohne diesen Handgriff meldet die Sicherungsanzeige
  dauerhaft, es gebe keine Sicherung — während jede Nacht eine geschrieben
  wird. Steht jetzt in Installation und Sicherung.
- **Das Konto für den Besprechungsraum** lässt sich in der Oberfläche gar
  nicht anlegen: Die Rolle steht dort nicht zur Auswahl. Der Weg über die
  Schnittstelle ist jetzt beschrieben — samt der Warnung, dass die Nutzerliste
  dieses Konto als gewöhnlichen Nutzer führt.

### Was schlicht nicht mehr stimmte

- Drei Seiten führten ein Verzeichnis `tools/`, das es nicht gibt.
- Zwei Befehle scheiterten ohne `sudo`, weil die betroffenen Dateien nur für
  den Systemverwalter lesbar sind.
- Die Fehlersuche empfahl Befehle für eine Betriebsform ohne Container, die es
  seit dem Umbau nicht mehr gibt, und ein Neubauen auf dem Server — dort liegt
  überhaupt kein Quelltext.
- „Der Einrichtungsassistent erscheint, obwohl Konten existieren" war genau
  verkehrt erklärt: Antwortet die Datenbank nicht, erscheint er gar nicht.
- Die Aufgaben-Ansicht verlangt beim Überschreiten einer Tagesgrenze keine
  Bestätigung; sie macht die Zahl nur sichtbar.
- Die Anmeldeseite zeigt kein Firmen-Branding — die Einrichtung behauptete es.

### Wo die Beschreibung zu großzügig war

- **Der Papierkorb** deckt vier Datenarten ab (Projekte, Notizen, Aufgaben,
  Termine), nicht alles. Dateien, Besprechungen, Rechnungen und Team-Einträge
  sind mit dem Löschen endgültig weg.
- **Benachrichtigungen** gibt es nur beim Anlegen. Wer nachträglich zu einem
  Termin oder einer Besprechung hinzukommt, bekommt keine.
- **Harte Links in der Sicherung** kosten keinen Platz, solange der Tagesstand
  existiert — nach sieben Tagen schon.
- **Ein Zeitlimit auf Datenbankabfragen** setzt allein die Volltextsuche.
- **Der Trockenlauf der Datenübernahme** meldet zwei Dinge nicht, die der
  echte Lauf meldet.

### Neu dokumentiert

- Das **Prüfprotokoll** hält seit dem 02.09.2026 auch jeden Datenabfluss fest.
- Die **Ratebremse trägt nur hinter dem Proxy** — daraus folgt die
  Betriebsregel, dass der Anwendungs-Container nie einen eigenen Port bekommt.
- **Zwei Wege führen das Anmelde-Token doch in die Adresse:** der Rückfall bei
  den Live-Updates und jeder Datei-Download.
- Die **Rücksicherung überschreibt den Dokumentenordner nicht**, sondern legt
  ihn daneben. Das braucht Platz, und Nachzügler muss man von Hand
  herüberholen.
- **Das Projekt-Dossier als Markdown** hatte in der Export-Übersicht gefehlt.

### Version 1.1.0

`package.json` steht jetzt auf 1.1.0. Die Anleitung kündigte den
Migrationsschritt seit dem 01.09.2026 unter dieser Nummer an, während der Code
noch 1.0.0 trug — das nächste Auslieferungspaket hätte den Namen des vorigen
getragen, und das vorige ist der Rückweg.
