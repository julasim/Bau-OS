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

**Sicherheit**
- **SEC-1:** `npm audit fix` (+ nodemailer→9, **Runtime-Smoke verifiziert**). 9→3 Vulns;
  Rest ist **esbuild/dev-only** (aus Prod-Image via `--omit=dev` raus) → mit INF-8 weg.
- **SEC-2 (IDOR Time-Entries):** Owner-Fallback in allen 3 id-Handlern.
- **SEC-3a (Download):** war bereits erfüllt (attachment + nosniff).
- **SEC-5 (CSP):** als **Report-Only** gesetzt (`server.ts`) — bricht nichts; nach
  Browser-Beobachtung auf enforce umstellen.

**Infrastruktur**
- **INF-2:** Prozess-Fehlerhandler (`unhandledRejection`/`uncaughtException`) in `index.ts`
  — in Phase 2 live validiert.
- **INF-3 + INF-7:** **Multi-Stage-Dockerfile + Node 24** (`Dockerfile`, `.nvmrc`, CI,
  `engines`). Build-Tools nur im builder-Stage → Image deutlich schlanker; EOL-Runtime weg.
- **INF-5:** Bot-Respawn mit Exponential-Backoff (`bot-manager.ts`).
- **INF-9:** Lint-Step in CI (`build.yml`).
- **INF-10:** ungenutzte Deps entfernt (`qrcode`, `@types/qrcode`, `angular-expressions`).

**Bewusst nicht geändert (mit Begründung)**
- **INF-1** Healthcheck: kein Bug (im Testlauf widerlegt).
- **SEC-6** JWT-Minlänge in Dev: Dev-Warnung ist bewusst (lokaler Schnellstart); Prod
  erzwingt hart. Erzwingen in Dev würde DX brechen ohne Sicherheitsgewinn.
- **TEST-3** Rate-Limit: `getClientIp` ist für Proxy-Betrieb korrekt; Last-Test hat 429
  vermutlich nicht von 401 getrennt. **Vor jedem Fix mit Code-Aufschlüsselung verifizieren.**

## ⏳ OFFEN

**P1 (größere Brocken)**
- **SEC-3b** Upload Magic-Byte-Validierung (`file-type` + `files.ts`).
- **SEC-4** Crypto-Härtung (eigener `ENCRYPTION_KEY` + Re-Encrypt-Skript + Legacy-Plaintext
  raus) — **zweistufiges VPS-Deploy**.
- **INF-6** Test-Grundstock (Auth/ACL + Rechnungen + SEC-2-Repro) via Hono `app.request()`.
- **INF-8 / TEST-1** Vite 5→8 **und** `vue-tsc`+`typescript` als devDeps pinnen
  (Frontend-Typecheck läuft in sauberer Umgebung aktuell nicht — TS-6-Inkompat; betrifft
  auch den CI-`vue-tsc`-Step). Löst zugleich die esbuild-Vulns.

**P2**
- **SEC-7** `/pair` Attempt-Limit · **PERF-1** N+1 `GET /projects` (Aggregat-Query wie
  `db-portfolio.ts`) · **PERF-2** `web/src/utils/format.ts` · **INF-11** Supabase → `_archive/supabase/` ·
  **INF-13** Logger async/stdout · **INFO-1** `SELECT *` in `db-microsoft.ts`.
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

## Commit-Status
**Nichts committet.** Working Tree: Renames (Archiv), modifizierte Quellen, neue
Doku/Config (`.nvmrc`, Dockerfile, CI). `.claude/` außen vor. Vor Commit: `tsc` + `test`
(aktuell grün).
