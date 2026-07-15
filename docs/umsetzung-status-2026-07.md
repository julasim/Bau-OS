# PATIO-Sanierung — Umsetzungsstand (2026-07-15)

> Fortlaufender Arbeitsstand. Alle Änderungen **uncommitted** im Working Tree.
> **Aktuell verifiziert grün:** `tsc` ✓, `npm test` (282/282) ✓, `build:all` ✓.
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
- **SEC-2 (IDOR Time-Entries):** Owner-Fallback in allen 3 id-Handlern.
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
- **INF-10:** ungenutzte Deps entfernt (`qrcode`, `@types/qrcode`, `angular-expressions`).
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
- **INF-6** Test-Grundstock (Auth/ACL + Rechnungen + SEC-2-Repro) via Hono `app.request()`.
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
Ubuntu-24.04 (WSL), Node 24, `patio-test-db` (pgvector, restart-policy). Für die
Fix-Verifikation gegen echte DB Windows-Änderungen nach `~/patio` syncen (rsync/git).

## Erster Schritt beim Wiederaufnehmen (neue Session)
1. **Testumgebung hochfahren:** WSL `Ubuntu-24.04`, Container `patio-test-db` (kommt via
   restart-policy hoch), `~/patio` per `git pull` auf `main` (≥ `844c8a5`) bringen, `npm ci`.
   WSL fährt idle herunter → ggf. Keepalive.
2. **INF-8 (Vite 5→8) zuerst** — löst die 3 esbuild/Dev-Vulns UND den vue-tsc-Toolchain-
   Bruch (TEST-1). In der Testumgebung eine kompatible Kombi finden
   (Vite/@vitejs/plugin-vue/vitest/vue-tsc/typescript), bis `build:all` **und** `vue-tsc`
   grün sind. Danach 0 Vulns.
3. **INF-6 Test-Suite** — Auth/ACL + Rechnungen + der **SEC-2-IDOR-Repro** (verwaistes
   Projekt) via Hono `app.request()` gegen `patio-test-db`.
4. **Rest:** PERF-1 (N+1 — gegen echte DB: altes vs. neues Ergebnis auf Fixtures identisch,
   Vorbild `db-portfolio.ts`), PERF-2 (`format.ts` — mit funktionierendem `vue-tsc`), INF-13
   (Logger — mit laufendem Prozess/`docker logs`), SEC-7 (/pair-Attempt-Limit im Bot-Handler),
   **TEST-3 verifizieren** (429 vs 401 aufschlüsseln — vermutlich kein Bug).
   *(SEC-3b, INF-11, INFO-1 sind bereits erledigt — siehe unten.)*
5. **SEC-4 (Crypto)** separat, mit VPS-Deploy-Koordination (zweistufig).
6. **VPS-Runbook:** Offsite-Backup (restic), Monitoring (Uptime-Kuma), LLM-Fallback.

## Commit-Status
**Committet + gepusht:** `844c8a5` auf `origin/main` (35 Dateien: Archiv-Renames,
Fixes, Doku, Dockerfile/CI/.nvmrc), danach `db36eb5` (Doku-Nachtrag).

**Committet, NICHT gepusht (Session 2026-07-15):**
- `a3f7c5e` — INF-11 (Supabase → `_archive/supabase/`, Dep raus) + INFO-1
  (`db-microsoft.ts` explizite Spalten).
- `7fbff06` — SEC-3b (Magic-Byte-Upload-Validierung `file-type` + 9 Unit-Tests).

`tsc` + `npm test` (291/291) grün. **Push erst auf Julius' Anweisung** (Server zieht
`main` per `git pull`). SEC-3b/INFO-1 sollten in WSL zusätzlich gegen echte DB laufen
(Upload-Flow bzw. SQL-Spalten), bevor produktiv.
