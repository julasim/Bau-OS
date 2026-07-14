# PATIO — Project Instructions

> **Produktname:** **PATIO** (P·A·T·I·O — Plan · Architektur · Termine ·
> Intelligenz · Office; zugleich der architektonische Begriff für einen
> Innenhof). Alles Nutzer-Sichtbare (UI, Doku) sagt **PATIO**. Maker-Tag:
> **„by Sima"** — kein Bezug zu „SIMA Architecture" o.ä.
>
> **Repo-Layout:** Der Code (`src/`, `web/`) liegt **direkt im Repo-Root**
> (dieser Ordner; im Workspace unter `apps/patio/`). **Alle `npm`-Befehle aus
> dem Repo-Root ausführen.** Remote: `github.com/julasim/patio`
> (früher `Bau-OS`).

## Zielgruppe (WICHTIG)

> **PATIO ist ein Programm für Architektur-, Planungs- und Projektsteuerungs-
> büros — für die PLANUNG im Büro, NICHT für die Bauausführung/Baustelle.**

- **Primäre Nutzer:** Architekten, Projektleiter im Büro, Sachbearbeiter,
  Statiker, Bauphysik, Hausverwalter, Auftraggeber-Vertreter — Menschen am
  Schreibtisch.
- **Geräte-Annahme:** Desktop, Laptop, gelegentlich Tablet/Phone vom
  Außendienst-Termin. Mobile-UI ist Komfort, nicht Hauptweg.
- **NICHT die Zielgruppe:** Polier, Maurer, Maschinenführer. Sie werden im
  System abgebildet (als `team_members`, in Stundenerfassung, Bautagebuch),
  bedienen es aber nicht.
- **Sprache & Tonalität:** Bürodeutsch, kein Baustellen-Jargon. „Eintrag
  dokumentieren" statt „schnell auf der Baustelle eintippen".

## Stack & Deployment

- **Backend:** Node.js + TypeScript + Hono (HTTP-API) + grammY (Telegram),
  PostgreSQL via postgres.js (+ pgvector, optional).
- **LLM:** OpenAI-SDK als Client — zeigt auf OpenAI (wenn `OPENAI_API_KEY`
  gesetzt) **oder** auf Ollama via OpenAI-kompatiblen Endpoint
  (`OLLAMA_BASE_URL`). **Produktiv aktuell: Ollama Cloud** (im
  `patio-ollama`-Container per `ollama signin` eingeloggt, starkes Cloud-Modell
  — gut im Tool-Calling; `.env.example`-Default ist aktuell `kimi-k2.5:cloud`).
  Lokale Modelle (z.B.
  `qwen2.5:7b`) gehen, sind auf kleiner Hardware aber zu langsam/schwach
  fürs agentic Tool-Calling.
- **Frontend:** Vue 3 (Composition API) + Pinia + Vite + Tailwind v4 (`web/`).
- **Deployment:** Docker Compose auf eigener VM unter `/opt/patio`.
  Container: `patio-app`, `patio-postgres`, `patio-ollama`. Davor ein
  **gemeinsamer Edge-Proxy** `edge-caddy` (externes Docker-Netz `proxy`,
  `external: true`) — terminiert TLS, routet per Domain, hält DB/Ollama im
  privaten Netz. SSE-Routes (`/api/chat`, `/api/events`) werden ungepuffert
  durchgeleitet.

**Deploy/Update auf dem Server (der übliche Weg):**

```bash
cd /opt/patio && git pull && docker compose build app && docker compose up -d app
```

DB-Migrationen laufen beim Start automatisch (`DB_AUTO_MIGRATE`, default an).

## Befehle (aus dem Repo-Root)

```bash
npm run dev          # tsx watch src/index.ts (Bot + API)
npm run dev:web      # Vite Dev-Server fürs Frontend
npm run build        # tsc → dist/
npm run build:all    # tsc + Vite-Build von web/
npm run start        # node dist/index.js (Produktion)

npm test             # vitest run (alle Tests, ~282)
npx vitest run tests/<file>.test.ts   # einzelne Datei
npm run lint  /  npm run lint:fix
npm run format

npm run db:migrate   # Migrationen anwenden (nur mit DATABASE_URL)
npm run db:status    # Migrations-Status anzeigen
```

Husky + lint-staged formatieren/linten gestagte `.ts`/`.vue`-Dateien beim
Commit; ein Pre-Push-Hook lässt `npm test` laufen.

## Architektur-Kern

- **Entry:** `src/index.ts` — lädt `.env` → DB-Healthcheck + Auto-Migrate →
  Bot → Heartbeat → MCP-Clients → Hono-API. Support-Module: `bot-manager.ts`
  (per-User-Bots, Main als Fallback), `notifications.ts`, `maintenance.ts`,
  `sync/` (Microsoft Graph / Outlook).
- **Telegram-Pipeline:** `bot.ts` → `queue.ts` (per-Chat-FIFO) →
  `llm/runtime.ts`. Der Tool-Loop läuft bis `MAX_TOOL_ROUNDS` mit
  `tool_choice:"required"`, bis das Modell `antworten` aufruft (Terminator).
  `antworten` ist load-bearing: ohne Tool-Call keine Nutzer-Antwort.
- **Agenten:** Markdown-Dateien unter `<workspace>/Agents/<Name>/`
  (SOUL/BOOT/TOOLS/HEARTBEAT/MEMORY …). Laufzeit-Rekonfiguration, kein
  Neustart. Nur `Main` ist geschützt. Sub-Agenten via `agent_spawnen` bis
  `MAX_SPAWN_DEPTH`.
- **Tool-Quellen** (in `tools.ts` gemerged): built-in (`llm/handlers/*.ts`,
  registriert in `executor.ts`), dynamic (`tools/`), MCP (`mcp.json`).
- **Data-Layer:** `src/data/index.ts` ist die **einzige** Import-Fläche.
  Repos sind hybrid `dbRepo` (Postgres) / `fsRepo` (Markdown), Auswahl per
  `DB_ENABLED`. **Chat liegt in der DB** (`chatRepo = DB_ENABLED ? dbChat :
  fsChat`); **nur Agent-Logs sind immer FS** (JSONL). Bautagebuch, Meetings,
  Time-Entries sind **DB-only**. Nie direkt aus `db-*`/`fs-*` importieren.
- **Migrationen:** plain SQL in `src/db/migrations/`, `NNN_name.sql`,
  forward-only, idempotent (`IF NOT EXISTS` / DO-Block-Guards). Runner
  (`src/db/migrate.ts`) trackt per Dateiname in `_migrations` (keine
  Prüfsumme), jede Migration in eigener Transaktion, Advisory-Lock gegen
  parallele Starts. Aktuellste: `039_rename_calendar_enum.sql`. **Schema-Lektion:**
  Beim JOIN müssen Typen passen — `034` hat `chat_messages.session_id` von TEXT
  auf UUID umgestellt (passend zu `chat_sessions.id`), sonst
  `operator does not exist: text = uuid`.
- **Projektsteuerung (PM, Migrationen 035–038):** Leistungsphasen
  (`035_project_phases`, Routes `phases.ts`, Repo `db-phases.ts`, Web
  `projects-v2/ProjectPhasesTab.vue`) · **Gantt-Zeitleiste** mit
  Phasen-Abhängigkeiten + Auto-Meilenstein (`038_phase_gantt`) · **Honorar-
  Ökonomie**: Stundensatz + Deckungsbeitrag (`037_hourly_rate`,
  `036_time_entry_phase`) · **Rechnungen** (Routes `invoices.ts`, Repo
  `db-invoices.ts`, Web `projects-v2/ProjectInvoicesTab.vue`; ACL beachtet) ·
  **Portfolio-Cockpit** (Routes `portfolio.ts`, Repo `db-portfolio.ts`, Web
  `views/portfolio/`) mit echten Fortschrittszahlen. `039` benennt nur den
  internen Kalender-Enum-Wert (`bau-os` → `patio`) um.
- **Web-API + Frontend:** Hono in `src/api/server.ts` (Port `API_PORT`,
  default 3000), JWT-Auth (`authMiddleware` setzt `userId`/`userRole`/
  `dbUser`). Routes in `src/api/routes/` spiegeln die Tool-Fläche. Vue-SPA
  in `web/` — App-Shell `web/src/components/AppLayout.vue` (3-Spalten-Grid
  `.app-v2`: NavRail + ListPane + Detail).
- **Config:** `src/config.ts` — alle Tunables als Konstanten. Laufzeit-
  Modell-Override via `setRuntimeMainModel` (nur `Main`-Agent).

## Frontend / PATIO Design System v2 (WICHTIG bei UI-Arbeit)

Das gesamte Frontend wurde auf das **PATIO Design System v2** umgestellt
(Stand Juni 2026). Beim Bauen an Views unbedingt einhalten:

- **Design-Tokens sind die einzige Quelle der Wahrheit:**
  `web/src/patio-tokens.css` (Brand/Produkt — identisch mit der Mainpage, kein
  zweites Brand-System), `patio-components.css` (Komponenten-Styles wie
  `ap-panel`/`ap-grid`/`pt-tabs`), `patio-shell.css` (App-Shell-Layout). Keine
  Hardcode-Farben/-Abstände — Tokens (`var(--…)`) verwenden. Niveau-Referenz:
  Linear/Vercel/Stripe; Prinzip: monochrom, flach, präzise, viel Ruhe.
  Schrift: **Inter / Inter Tight / JetBrains Mono**.
- **Shell-Bausteine** in `web/src/components/shell/`: `NavRail`, `ListPane`,
  `DetailPane`, `IconBtn`, `Avatar`, `StatusDot`. Die NavRail ist
  **kontext-wechselnd** — im Projekt zeigt sie die Projekt-Module (statt einer
  Tab-Leiste).
- **v2-Views** liegen in `web/src/views/<bereich>-v2/` (`notes-v2`,
  `projects-v2`, `tasks-v2`, `team-v2`) im ListPane/DetailPane-Muster. Daneben
  existieren noch ältere Top-Level-Views (`NotesView.vue`, …) — beim Weiterbauen
  die **v2-Variante** bevorzugen.
- **Projekt-Detail** (`ProjectDetailView.vue`) läuft **vollbreit** (keine
  ListPane), Module über die kontext-wechselnde Sidebar.
- **Keine Emojis in der UI.** Stattdessen Line-Icons über `BIcon.vue` (Glyph in
  `BIcon.vue` ergänzen) oder schlichten Text.

## Bot-Sicherheitsmodell (WICHTIG — nicht aufweichen)

Der Bot/Chat darf **nur Daten befüllen**, nichts Destruktives oder
Systemrelevantes. Folgende Tools wurden bewusst **entfernt** (Schema **und**
Handler) — nicht wieder hinzufügen ohne Rücksprache:

- `befehl_ausfuehren`, `code_ausfuehren` (Shell/JS)
- `tool_erstellen`, `tool_loeschen` (dynamische Tools)
- `mcp_server_verbinden`, `mcp_server_trennen`
- `projekt_loeschen`, `team_entfernen` (destruktiv)
- `agent_erstellen`, `agent_datei_schreiben` (Agent-Config)

Erlaubt bleiben Lesen/Befüllen: Notizen, Aufgaben (inkl. Zuweisung), Termine,
Meetings/Protokolle, Projekte anlegen+aktualisieren, Bautagebuch, Stunden,
Team anlegen/zuordnen, `datei_projekt_zuordnen`, read-only Listings.

Telegram-**Systembefehle** (`/model`, `/fast`, `/restart`, `/config`,
`/logs`) sind über `requireAdmin` in `bot.ts` auf `role === "admin"`
beschränkt (FS-/Legacy-Modus = de-facto Admin). Wenn neue Telegram-Tools/
Befehle dazukommen: gegen dieses Modell prüfen.

Manuelle Abnahme: `docs/telegram-smoke-test.md`.

## Commit- & Verifikations-Strategie

- Pro Feature ein Commit, mit Migration-Referenz bei Schema-Änderungen.
- Vor jedem Commit: `npx tsc --noEmit`,
  `npx vue-tsc --noEmit -p web/tsconfig.json`, `npm test`.
- Push auf `main` → Server holt's per `git pull` (siehe Deploy oben).
- Lokale `.claude/`-Tooling-Ordner **nicht** committen (kein `git add -A`).

## Tonalität in Code & UX

**Wer benutzt das? Ein Architekt am Schreibtisch, kein Bauarbeiter auf der
Leiter.** Texte und Workflows strukturiert, präzise, doku-orientiert.
Bürodeutsch, kein Hype-Wording.
