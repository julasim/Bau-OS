# PATIO-Sanierung — Umsetzungsstand (2026-07-15)

> **Der gesamte Audit-Plan ist eingearbeitet.** Alles committet + auf
> `origin/main` gepusht (Stand `41f0aee`, CI grün). **Verifiziert grün:** `tsc` ✓,
> `typecheck:web` ✓, `build:all` ✓, `docs:build` ✓, `npm test` **344 in WSL gegen
> echte DB** (298 auf Windows, DB-Tests skippen) ✓.
> Plan: `~/.claude/plans/swift-purring-hejlsberg.md`. (Audit + Testreport der Runde
> liegen in der Git-History.)
>
> **Noch NICHT deployt** — Julius deployt, wenn der ganze Plan eingearbeitet ist
> (jetzt gegeben). Deploy: `cd /opt/patio && git pull && docker compose build app
> && docker compose up -d app`.

## ✅ ERLEDIGT & verifiziert

**Struktur / Dead Code**
- Web-LLM-Frontend → `_archive/web-llm/`; **DEAD-1** (6 Legacy-Views),
  **DEAD-3** (verwaiste Scripts), **DEAD-2** (Datums-Helfer-Duplikat →
  `ms-date-utils.ts`), **INF-11** Supabase → `_archive/supabase/`.

**Sicherheit**
- **SEC-1** `npm audit fix`; **SEC-2** Owner-Fallback (Audit-Trigger schema-
  technisch unmöglich, per INF-6-Test bestätigt); **SEC-3a** Download
  (attachment+nosniff, war erfüllt); **SEC-3b** Magic-Byte-Upload-Validierung
  (`file-validation.ts`, 9 Tests); **SEC-5** CSP (Report-Only).
- **SEC-7** `/pair` Brute-Force-Limit pro Chat-ID im Bot (5/15 Min, in-memory,
  nur echte Fehlversuche zählen, Erfolg resettet).
- **SEC-4 (Stufe 1)** Feld-Verschlüsselung auf eigenen **`ENCRYPTION_KEY`**
  (getrennt vom JWT_SECRET). encrypt→Primärschlüssel, decrypt→Primär+JWT-Fallback
  (Bestandsdaten lesbar), Legacy-Plaintext noch durchgereicht. Re-Encrypt-Skript
  `scripts/reencrypt.ts` (`npm run db:reencrypt [-- --dry]`, idempotent, schreibt
  nie null). Start-Warnung wenn Key fehlt. **crypto-Unit-Test (7).**
  Zweistufiger Deploy: [`docs/sec-4-crypto-migration.md`](sec-4-crypto-migration.md).

**Infrastruktur**
- **INF-2** Prozess-Fehlerhandler; **INF-3+INF-7** Multi-Stage-Dockerfile +
  Node 24; **INF-5** Bot-Respawn-Backoff; **INF-9** Lint in CI; **INF-10**
  Dep-Cleanup (⚠ `angular-expressions` wiederhergestellt — Docx-Export,
  `depcheck`-Falle bei dynamischem require).
- **INF-8** **Vite 5 → 8** + `@vitejs/plugin-vue` 6.0.8. esbuild global auf
  0.27.2 gepinnt (`overrides`) — Vite 8 zog das selbst verwundbare 0.27.7; die
  esbuild-Dev-Vulns sind damit weg (App-Build + docs:build bauen sauber).
  *Restanz: 2 vite@5-eigene Vulns in vitepress 1.6.4 — dev-only (Doku-Vorschau,
  nicht im Prod-Image), „no fix available".*
- **INF-13** Logger **non-blocking**: serialisierte Async-Queue statt
  `appendFileSync` im Hot-Path; stdout bleibt sofort (Docker); `flushLogsSync`
  an `process.on("exit")` (letzte Zeilen retten); Rotation/Trim async.
- **INFO-1** `SELECT *` → explizite Spalten (`db-microsoft.ts`).

**Tests (INF-6 — Grundstock + Ausbau)**
- Gemeinsamer **Fixture-Helper** (`tests/helpers/acl-fixture.ts`): A/B/Admin +
  Projekt + Cleanup gegen echte DB.
- ACL-Integrationstests (Hono `app.request()`): **time-entries, invoices,
  phases** (+ Honorar-`finance`), **portfolio** (Sichtbarkeitsfilter),
  **files** (Download-/Read-IDOR, Ownership).
- **Auth-/Admin-Middleware**: Token-Präsenz/-Gültigkeit, **aud-Guard**
  (Ticket-Token gibt keine API-Autorisierung), **DB-Rollen-Vorrang** (altes/
  gefälschtes Admin-JWT für DB-`user` → 403).
- **TEST-3 verifiziert** (kein Bug): Login-Rate-Limit trennt 429 sauber von 401
  (`api-login-ratelimit.test.ts`) — Audit-Fehleinschätzung wie INF-1/SEC-2.

**Performance**
- **PERF-1** N+1 in `GET /projects` → eine Aggregat-Query `projectRepo.listInfos`
  (SELECT-Fragment + Row-Mapping mit `getInfo` geteilt); Ergebnisgleichheit per
  deep-equal-Test belegt.
- **PERF-2** zentrale gecachte Intl-Formatter (`web/src/utils/format.ts`);
  14 Views von Inline-`toLocale*` umgezogen (Format je Stelle 1:1).

**CI / Tooling**
- **TEST-1** CI-`vue-tsc` gepinnt; **gitleaks** Secret-Scan in CI
  (`.gitleaks.toml` mit Allowlist fürs Dummy-TOTP-Seed; lokal mit 8.30.1
  verifiziert: 0 Findings; `fetch-depth: 0`, vor `npm ci`).

**VPS-Betrieb (Runbook)**
- [`docs/vps-runbook.md`](vps-runbook.md): **INF-4** Offsite-Backup (restic →
  Hetzner), **INF-14** Monitoring (Uptime-Kuma), **LLM-Fallback** (Groq/
  OpenRouter via `.env`; dafür neuer `OPENAI_BASE_URL`-Override in `client.ts`).

**Bewusst nicht geändert (mit Begründung)**
- **INF-1** Healthcheck (kein Bug), **SEC-6** JWT-Dev-Warnung (DX), Audit-F:
  In-Memory-Rate-Limit-Modell · LLM-Whitelist als Prompt-Guardrail · JWT-7d.

## ⏳ OFFEN

**Deploy (Julius)** — der ganze Plan ist auf `main`; ausrollen wenn bereit.
Enthält u.a. den Docx-Export-Fix (`f0d75ca`) und PERF-1.

**SEC-4 Stufe 2** (erst NACH Deploy + `db:reencrypt` am VPS): JWT_SECRET-Fallback
+ Legacy-Plaintext aus `crypto.ts` entfernen; optional `ENCRYPTION_KEY` in Prod
hart erzwingen. Anleitung in `sec-4-crypto-migration.md`.

**Backlog II** (dauerhafte Härtung, nicht Teil dieser Runde): Semgrep (SAST) +
Trivy (Image) als CI-Steps · Playwright-E2E · Renovate · SBOM · differenzierter
Health-Endpunkt · vitepress 2.x sobald stabil (löst die 2 dev-only vite@5-Vulns).

## Testumgebung
**PATIO-Testbasis = WSL `Ubuntu-24.04`** (Node 24, `patio-test-db` = pgvector).
`~/patio` ist ein eigener Klon; per `git pull` (GCM-Bridge) auf `main`, `npm ci`.
gitleaks 8.30.1 liegt in `~/gitleaks` (persistent, nicht in `/tmp` — WSL wischt
`/tmp` beim Idle-Shutdown).

> ⚠️ **Nicht verwechseln:** WSL `Ubuntu-22.04` gehört **RAG-OS** — für PATIO nie
> anfassen/abschalten.

## Commit-Status (diese Runde, alle auf `origin/main`, CI grün)
`7ad8e82` INF-6 (Fixture + Auth/Phasen/Portfolio/Files-ACL) · `25db44a` PERF-1 ·
`42edb9c` INF-8 (Vite 8 + esbuild-override) · `89f30c3` PERF-2 · `f5a6bc1`
INF-13 · `b048ca8` SEC-7 · `cca4d63` TEST-3 · `87084e4` gitleaks · `dd9e170`
SEC-4 (Stufe 1) · `41f0aee` VPS-Runbook + LLM-Fallback.
(Davor bis `a40bfa3`: P0/P1-Paket, INF-11, SEC-3b, TEST-1, INF-6-Grundstock.)
