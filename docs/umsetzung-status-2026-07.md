# PATIO-Sanierung — Umsetzungsstand (2026-07-15)

> Fortlaufender Arbeitsstand. **Alles committet + auf `origin/main` gepusht** (Stand `f212566`,
> CI grün). **Verifiziert grün:** `tsc` ✓, `typecheck:web` ✓, `npm test` **(304 in WSL gegen
> echte DB / 291 auf Windows, DB-Tests skippen)** ✓, `build:all` ✓.
> Referenzen: [`audit-2026-07.md`](audit-2026-07.md), [`testreport-2026-07.md`](testreport-2026-07.md),
> Plan: `~/.claude/plans/swift-purring-hejlsberg.md`.

## ✅ ERLEDIGT & verifiziert

**Struktur**
- **Web-LLM-Frontend archiviert** → `_archive/web-llm/` (Chat + Agenten-UI + Backend-Routen,
  README für Wiedereinbau). `agent-logs`/`src/llm`/Bot bleiben.
- **DEAD-1:** 6 tote Legacy-Views (~3518 LOC) → `_archive/legacy-views/`.
- **DEAD-3:** verwaiste Scripts (`test-tools.ts`, `fix_umlauts.py`) → `_archive/scripts/`.
- **DEAD-2:** Datums-Helfer-Duplikat aufgelöst → neues `src/sync/ms-date-utils.ts`
  (geteilt von `microsoft-sync.ts` + `webhooks-microsoft.ts`, Circular-Import gebrochen).
- **INF-11:** Supabase-Subsystem (dormant, `SUPABASE_ENABLED` faktisch immer false) →
  `_archive/supabase/` (JS-Client, Realtime-Bridge, Self-Hosted-Setup-Skript + Compose-Stub,
  README für Wiedereinbau). Verdrahtung in `config.ts` / `db/index.ts` / `index.ts` /
  `dashboard.ts` (db-status ohne `realtime`-Feld) / `SystemStatusBanner.vue` entfernt; Dep
  `@supabase/supabase-js` deinstalliert (−10 Pakete). `tsc` + 282 Tests grün, keine
  Rest-Referenzen in `src/`/`web/src/`. (Frontend-Änderung rein subtraktiv; volle
  `vue-tsc`/`build:all`-Verifikation steht in WSL aus.)

**Sicherheit**
- **SEC-1:** `npm audit fix` (+ nodemailer→9, **Runtime-Smoke verifiziert**). 9→3 Vulns;
  Rest ist **esbuild/dev-only** (aus Prod-Image via `--omit=dev` raus) → mit INF-8 weg.
- **SEC-2 (IDOR Time-Entries):** Owner-Fallback in allen 3 id-Handlern. ⚠️ **Präzisiert (WSL,
  wie INF-1 eine Audit-Fehleinschätzung):** Der beschriebene IDOR-Trigger „verwaister Eintrag
  via gelöschtes Projekt" ist **schema-technisch nicht erzeugbar** — `time_entries.project_id`
  ist `NOT NULL ON DELETE CASCADE`, ein gelöschtes Projekt cascadet den Eintrag weg. Der reale
  Schutz läuft über `canSeeProjectByName` (jetzt per INF-6-Test verifiziert). Der Owner-Fallback
  bleibt als harmlose Defensive.
- **SEC-3a (Download):** war bereits erfüllt (attachment + nosniff).
- **SEC-5 (CSP):** als **Report-Only** gesetzt (`server.ts`) — bricht nichts; nach
  Browser-Beobachtung auf enforce umstellen.
- **SEC-3b (Upload Magic-Byte):** neues Modul `src/api/file-validation.ts` (`validateUpload`
  via `file-type` v22) — Endung **und** Magic Bytes müssen passen, getarnte Uploads (HTML/SVG
  als `.png`, PDF als `.txt`) → 415. Text-Formate ohne Signatur werden anhand der Endung
  erlaubt (kein Fehlalarm). In beide Upload-Pfade (`files.ts`, DB + Legacy-FS) eingehängt;
  Extension-Whitelist dorthin zentralisiert. **9 neue Unit-Tests** decken die Tarnungs-Fälle
  ab. `tsc` + 291 Tests grün.

**Infrastruktur**
- **INF-2:** Prozess-Fehlerhandler (`unhandledRejection`/`uncaughtException`) in `index.ts`
  — in Phase 2 live validiert.
- **INF-3 + INF-7:** **Multi-Stage-Dockerfile + Node 24** (`Dockerfile`, `.nvmrc`, CI,
  `engines`). Build-Tools nur im builder-Stage → Image deutlich schlanker; EOL-Runtime weg.
- **INF-5:** Bot-Respawn mit Exponential-Backoff (`bot-manager.ts`).
- **INF-9:** Lint-Step in CI (`build.yml`).
- **INF-10:** ungenutzte Deps entfernt (`qrcode`, `@types/qrcode`). ⚠️ **Teil-Rücknahme:**
  `angular-expressions` war **doch nötig** — `docxtemplater/expressions.js` lädt es zur Laufzeit
  dynamisch (`depcheck` sah das nicht). Ohne die Dep crasht der **Docx-Export** (Rechnungen/
  Angebote/Protokolle) mit `Cannot find module`. Wiederhergestellt als `^1.5.5` (Commit
  `f0d75ca`). **Aufgedeckt durch den ersten INF-6-Integrationstest** (erster Test, der
  `server.ts` importiert) — Lehre: `depcheck` erkennt dynamische `require`s nicht.
- **INF-6 (Test-Grundstock, angefangen):** `app` aus `server.ts` exportiert; zwei
  Integrationstest-Dateien via Hono `app.request()` gegen echte DB — `api-time-entries-acl`
  (6 Tests) + `api-invoices-acl` (7, geldrelevant, IDOR-Schutz). ACL: fremder Non-Admin → 403,
  Ersteller/Admin → 200, ohne Token → 401. Suiten skippen ohne `DATABASE_URL` (Windows).
  WSL-Suite **304 grün**. Offen: Auth-Middleware/Login-Flow, weitere Routen, Fixture-Helper.
- **TEST-1 (CI vue-tsc rot):** `vue-tsc@3.3.7` als **devDependency gepinnt** + neues Script
  `typecheck:web`; CI-Step (`build.yml`) von `npx vue-tsc` → `npm run typecheck:web`. Ursache:
  ungepinntes `npx vue-tsc` zog in CI die neueste vue-tsc samt neuerer TS-Peer statt des
  Projekt-TS 6.0.2 → `ERR_PACKAGE_PATH_NOT_EXPORTED`. Jetzt deterministisch. Lokal alle
  CI-Steps grün (`build:all`, `typecheck:web`, `lint`, 291 Tests); finaler Beweis = CI-Run
  nach Push.
- **INFO-1:** `SELECT *` → explizite Spaltenlisten in `db-microsoft.ts` (5 Stellen;
  `getMsAccount` lädt keine verschlüsselten Token-Spalten mehr in den Speicher). Spalten
  exakt aus den Row-Mappern (`rowToPublic`/`rowToCalendar`) abgeleitet. `tsc` + Tests grün;
  SQL-Verhalten gegen echte DB noch in WSL zu bestätigen (kein Postgres auf Windows).

**Bewusst nicht geändert (mit Begründung)**
- **INF-1** Healthcheck: kein Bug (im Testlauf widerlegt).
- **SEC-6** JWT-Minlänge in Dev: Dev-Warnung ist bewusst (lokaler Schnellstart); Prod
  erzwingt hart. Erzwingen in Dev würde DX brechen ohne Sicherheitsgewinn.
- **TEST-3** Rate-Limit: `getClientIp` ist für Proxy-Betrieb korrekt; Last-Test hat 429
  vermutlich nicht von 401 getrennt. **Vor jedem Fix mit Code-Aufschlüsselung verifizieren.**

## ⏳ OFFEN

**P1 (größere Brocken)**
- **SEC-4** Crypto-Härtung (eigener `ENCRYPTION_KEY` + Re-Encrypt-Skript + Legacy-Plaintext
  raus) — **zweistufiges VPS-Deploy**.
- **INF-6 (Fortsetzung)** — Grundstock steht (time-entries + Rechnungen ACL, siehe oben).
  Offen: Auth-Middleware/Login-Flow, weitere kritische Routen (Portfolio/Phasen/Files),
  gemeinsamer Fixture-Helper (User A/B/Admin + Projekt) gegen die Duplikation.
- **INF-8** Vite 5→8 (löst die 3 esbuild/Dev-Vulns) — Major-Bump, in WSL mit vollem
  `build:all` verifizieren. *(Der Toolchain-Bruch TEST-1 ist separat gelöst — siehe unten.)*

**P2**
- **SEC-7** `/pair` Attempt-Limit (Angriffspfad ist **Telegram** `/pair <token>` in `bot.ts`,
  nicht HTTP — Limit gehört pro Chat-ID in den Bot-Handler, mit DB/Bot-Kontext in WSL) ·
  **PERF-1** N+1 `GET /projects` (Aggregat-Query wie `db-portfolio.ts`) ·
  **PERF-2** `web/src/utils/format.ts` · **INF-13** Logger async/stdout (Vorsicht:
  `readRecentLogs` + JSONL-Rotation + Flush-bei-`process.exit` hängen dran).
- **TEST-3** verifizieren (Rate-Limit-Codes aufschlüsseln).
- **gitleaks** `.gitleaksignore` (`tests/totp.test.ts:50`) + gitleaks in CI.

**VPS-Betrieb (Runbook, kein Repo-Code)**
INF-4 Offsite-Backup (restic/Hetzner) · INF-14 Monitoring (Uptime-Kuma) ·
LLM-Provider-Fallback (Groq/OpenRouter via `.env`).

**Bewusst NICHT umsetzen (Audit F)**
In-Memory-Rate-Limit-Modell · LLM-Whitelist als Prompt-Guardrail · JWT-7d.

**Backlog II (Test-Arten, nicht ausgeführt)**
Semgrep (SAST) · Trivy (Image) · Playwright-E2E.

## Testumgebung
**PATIO-Testbasis = WSL `Ubuntu-24.04`** (Node 24, `patio-test-db` = pgvector,
restart-policy). `~/patio` ist ein eigener Klon; Windows-Stand nach WSL bringen via
`git pull` oder Datei-`cp` von `/mnt/c/.../apps/patio` (langsam, aber ohne Auth).

**Setup-Stolpersteine (2026-07-15 gelöst):**
- **git-Auth in WSL:** GitHub ist privat, WSL hat keine Credentials → `git fetch/clone` hängt/
  scheitert. Fix (einmalig): WSL-git an den Windows-GCM binden —
  `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`.
  Nutzt die Windows-Credentials, kein Klartext. Alternativ vom lokalen Windows-Klon fetchen.
- **npm `allowScripts`-Warnung:** `npm ci` blockt install-Scripts von `bcrypt`/`esbuild`, beide
  funktionieren aber trotzdem (gebündelte Prebuilds) — Warnung ignorierbar.
- **CRLF:** ein frischer Linux-`git clone` ist sauber; ältere Klone zeigen CRLF-Rauschen
  (belanglos, `git diff --ignore-all-space` = 0 echte Änderungen).

> ⚠️ **Nicht verwechseln:** WSL `Ubuntu-22.04` gehört **RAG-OS** (Container
> `rag-api`/`rag-postgres`/`rag-qdrant`/`rag-ollama`, Ordner `/root/rag-os`) und läuft
> ggf. parallel. **Für PATIO nie anfassen/abschalten.** WSL fährt idle Distros selbst herunter
> (RAM entspannt sich). Bei Parallelbetrieb ggf. `~/.wslconfig` mit `memory=`-Deckel setzen
> (RAG-Ollama braucht Reserve).

## Erster Schritt beim Wiederaufnehmen (neue Session)
1. **Testumgebung:** WSL `Ubuntu-24.04` + `patio-test-db` (via restart-policy). `~/patio` per
   `git pull` (GCM-Bridge, siehe Testumgebung) auf `main` bringen, `npm ci`. WSL fährt idle
   herunter → beim ersten Befehl startet sie neu.
2. **INF-6 fortsetzen** — Grundstock steht (time-entries + Rechnungen). Nächstes:
   **Fixture-Helper** extrahieren (User A/B/Admin + Projekt, weniger Duplikation), dann
   **Auth-Middleware/Login-Flow** + weitere kritische Routen (Portfolio/Phasen/Files).
3. **PERF-1** (N+1 `GET /projects`) — gegen echte DB: altes vs. neues Ergebnis auf Fixtures
   identisch, Vorbild `db-portfolio.ts`.
4. **INF-8** Vite 5→8 (nur noch esbuild-Vulns; TEST-1 ist gelöst) — Major-Bump, mit vollem
   `build:all` + `typecheck:web` verifizieren.
5. **Rest:** PERF-2 (`format.ts`, mit `vue-tsc`), INF-13 (Logger, mit `docker logs`), SEC-7
   (/pair-Limit im Bot-Handler), **TEST-3 verifizieren** (429 vs 401), gitleaks-CI.
6. **SEC-4 (Crypto)** separat, mit VPS-Deploy-Koordination (zweistufig).
7. **VPS-Runbook:** Offsite-Backup (restic), Monitoring (Uptime-Kuma), LLM-Fallback.

## Commit-Status
**Committet + gepusht auf `origin/main`, CI (Build & Test) grün** — Stand `f212566`:
- `844c8a5` · `db36eb5` — Web-LLM/Legacy archiviert, P0/P1-Fixes, Doku (Vorsession).
- `a3f7c5e` — **INF-11** (Supabase → `_archive/supabase/`) + **INFO-1** (explizite Spalten).
- `7fbff06` — **SEC-3b** (Magic-Byte-Upload-Validierung + 9 Unit-Tests).
- `6f1f2ba` — Doku-Nachtrag.
- `b9c4e94` — **TEST-1** (CI-`vue-tsc` gepinnt, CI wieder grün).
- `206a421` — Doku-Nachtrag (CI grün, Aufräumung, WSL/RAG-OS).
- `f0d75ca` — **angular-expressions wiederhergestellt** (INF-10-Regression, Docx-Export-Crash).
- `e9ea551` — **INF-6** time-entries ACL-Test + `app`-Export.
- `f212566` — **INF-6** Rechnungen ACL-Test (geldrelevant, IDOR-Schutz).

Verifiziert: `tsc` + `typecheck:web` + `lint` grün; `npm test` **304 in WSL gegen echte DB**
(291 auf Windows, DB-Tests skippen). Deploy noch **nicht** ausgelöst (manueller `git pull` am
Server). **Empfehlung: bald deployen** — `f0d75ca` behebt den Docx-Export-Crash auf `main`.

**Aufräumung (Session 2026-07-15):** Alte Claude-Worktrees unter `.claude/worktrees/`
(inkl. node_modules) gelöscht; `@supabase/supabase-js` deinstalliert; `vue-tsc`/`file-type`/
`angular-expressions` als Deps ergänzt bzw. wiederhergestellt.
