# PATIO — Harter Testlauf Juli 2026 (Baseline)

> **Umgebung:** Ubuntu-24.04 (WSL2), Node **24.18.0** (LTS), frischer `git clone`
> von `julasim/patio` ins Linux-FS, echtes **PostgreSQL 16 + pgvector** (Docker),
> `bcrypt` nativ für Linux gebaut. Erstmals gegen echte DB/Container statt Windows-Mock.
> **Zweck:** Ist-Zustand härten, Audit-Befunde live prüfen, Regressionsbasis schaffen.
> **Datum:** 2026-07-15 · **Keine** Code-Änderung, keine Commits.

## Kurzfazit

Der Kern ist **robust**: alle Migrationen sauber, Typecheck/Unit-Tests grün, Auth greift
durchgängig, Performance sehr gut. Der Testlauf hat aber **den Audit an vier Stellen
korrigiert/geschärft** — der wichtigste Grund, warum man real testet statt nur zu lesen:

| Was | Ergebnis |
|---|---|
| **INF-1 Healthcheck** | **Kein Bug** — Fehleinschätzung im Audit. Herabstufung P0 → P2. |
| **INF-2 Prozess-Crash** | **Live bestätigt** — ein Bot-Fehler killt den ganzen Dienst. |
| **Rate-Limit unter Last** | **Neuer Befund** — greift nicht (0× 429 bei 33k Requests). |
| **vue-tsc-Toolchain** | **Neuer Befund** — in sauberer Umgebung nicht lauffähig. |

---

## 2a — Typecheck + Unit-Tests (Linux)

| Prüfung | Ergebnis |
|---|---|
| `bcrypt` nativ laden | ✅ OK (Linux-Binary via `npm ci` gebaut) |
| `tsc --noEmit` (Backend) | ✅ exit 0 |
| `vitest run` | ✅ **282/282 grün** (14 Dateien) — identisch zu Windows; die 2 „errors" sind dieselben vorbestehenden `queue.test.ts`-Rejections |
| `vue-tsc --noEmit` (Frontend) | 🔴 **schlägt fehl** |

**🔴 NEU — TEST-1 (P1): Frontend-Typecheck nicht reproduzierbar.** `vue-tsc` ist **nicht als
Dev-Dependency gepinnt**; `npx` zieht frisch **TypeScript 7**, und `vue-tsc@3.3.7` sucht
`typescript/lib/tsc`, das TS 6/7 nicht mehr exportiert (`ERR_PACKAGE_PATH_NOT_EXPORTED`).
Auch mit gepinnter TS 6.0.2 gleiches Bild. Auf dem Windows-Dev-Rechner lief es nur durch
Zufall der npx-Cache-Auflösung. → `vue-tsc` + kompatible `typescript`-Version als
`devDependencies` pinnen (gehört zu INF-8 Toolchain-Modernisierung).

## 2b — Integration gegen echte Postgres-DB

**Migrationen — ✅ voller Erfolg:**
- Alle **41 Migrationen (001→039)** laufen sauber durch (exit 0), 33 Tabellen, pgvector aktiv.
- **Idempotenz bestätigt:** 2. Lauf → „Keine ausstehenden Migrations".
- **Rebrand (039) verifiziert auf echter DB:**
  `calendar_mode IN ('default','patio')` und `ms_source IN ('patio','microsoft')` ✓.

**App-Boot + Auth — ✅ (mit Einschränkung):**
- `/api/health` → `{"ok":true,"db":true}` (echte DB verbunden).
- `/api/projects`, `/api/invoices` **ohne Token → 401** (Auth-Middleware greift auf allen
  geschützten Routen, auch den neuen PM-Routen).

**🔴 Live bestätigt — INF-2 (P0): unbehandelte Rejection killt den Dienst.** Boot-Log:
`[API] Web-Server gestartet` → dann `GrammyError: getMe failed (401)` (vom Test-Token) →
**Prozess stirbt sofort**, obwohl die API schon lief. Erst ein vorgeschalteter
`process.on('unhandledRejection')`-Handler (als Preload simuliert) hält den Dienst am
Leben — **Beleg, dass INF-2 der richtige Fix ist**. `bot-manager` loggt den Fehler zwar,
die Rejection propagiert aber trotzdem (→ verstärkt INF-5 Bot-Isolation).

**🔴 NEU — TEST-2 (P1/Betrieb): kein headless-Betrieb.** `src/index.ts:23/24` erzwingt
per `throw` **BOT_TOKEN und WORKSPACE_PATH** beim Boot; ein **ungültiger** BOT_TOKEN führt
zum fatalen Crash (s. INF-2). API/Web sind damit hart an einen funktionierenden
Telegram-Bot gekoppelt — relevant für Deployments/Tests ohne Telegram.

**⚠️ KORREKTUR — INF-1 (P0 → P2): Healthcheck ist KEIN Bug.** Live: `/api/status` liefert
**401** (nicht SPA-200), weil `/api/*` von der Auth-Middleware vor dem SPA-Catch-all
erfasst wird. Der Dockerfile-Healthcheck ist **bewusst** so gebaut: `curl -sS` **ohne
`-f`** mit Kommentar „401 = Server läuft korrekt, reagiere nur auf Connection-Failure".
Funktioniert wie beabsichtigt. **Restwert (P2):** prüft nur TCP-Liveness, nicht DB —
optional auf `/api/health` umstellen für Aussagekraft.

**⚠️ SEC-5 präzisiert (bleibt gültig):** Auf regulären Routen sind HSTS, `nosniff`,
`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy` etc. **vorhanden** — **CSP fehlt** (wie
im Audit). `/api/health` hat gar keine Header (liegt vor der `secureHeaders()`-Middleware).

## 2c — Last-/Stresstest (autocannon)

| Ziel | Durchsatz | Latenz (avg / p97.5) | Ergebnis |
|---|---|---|---|
| `/api/health` | **10.476 Req/s** | 2,4 ms / 6 ms | 115k Requests/11s, 0 Fehler |
| `/api/projects` (401) | **4.122 Req/s** | 6,8 ms / 12 ms | 33k Requests, alle 401 |

Performance & Stabilität **sehr gut**; Auth-Middleware hält unter Last durch.

**🔴 NEU — TEST-3 (P1, zu verifizieren): globales Rate-Limit greift nicht.** Bei ~4000
Req/s über 8s (33k Requests von einer IP) kam **kein einziges 429** — das dokumentierte
600/min-per-IP-Limit (`server.ts:176`) hätte längst greifen müssen. Verdacht:
`getClientIp()` liefert lokal (ohne Proxy-Header) keinen stabilen Bucket-Key, wodurch der
Scraper-Schutz wirkungslos ist. Am VPS hinter Caddy ggf. anders — dort mit
`X-Forwarded-For` gegenprüfen.

## 2d — Security-Scans

- **`npm audit --omit=dev` (Linux):** identisch zu Windows — **9 Schwachstellen, 4× HIGH**
  (`nodemailer`, `ws`, `qs`). → **SEC-1 bestätigt**, Fix `npm audit fix` (nicht-breaking).
- **`gitleaks detect` (325 Commits, 4,75 MB):** **1 Finding**, Regel `generic-api-key` in
  `tests/totp.test.ts:50` — verifiziert als **Test-Fixture** (`secret=ABCDEFGHIJ234567`,
  Dummy-TOTP-Seed). **Kein echtes Secret geleakt.** → `.gitleaksignore` setzen + gitleaks
  in CI aufnehmen.
- **Semgrep (SAST) / Trivy (Image):** in diesem Durchlauf **nicht** ausgeführt — siehe
  Backlog II (als CI-Steps empfohlen).

## 2e — Docker-Build + E2E

- **`docker build`: ✅ erfolgreich** (exit 0). Das Image baut sauber durch — aber belegt
  INF-3 und INF-7 hart:
  - **Image-Größe: 1,8 GB** (sehr groß für eine Node-App).
  - **Node `v20.20.2`** im Image → **INF-3 bestätigt** (EOL-Runtime im Produktiv-Image).
  - Layer-Analyse: `npm ci` **555 MB** (inkl. devDeps, da `typescript`/`tsx`/`@types/node`
    als `dependencies`), Build-Tools (`python3`/`make`/`g++`) **316 MB**. → **INF-7
    bestätigt:** Multi-Stage-Build + devDep-Trennung spart grob **~800 MB** (Ziel ~0,5 GB).
- **Container-Healthcheck live:** nicht separat geprüft — der Container-Boot scheitert
  am ungültigen BOT_TOKEN (TEST-2/INF-2, bereits nativ belegt). INF-1-Verhalten ist über
  den nativen Lauf geklärt (kein Bug).
- **Playwright-E2E:** in diesem Durchlauf **nicht** ausgeführt (Browser-Setup/Testaufbau) —
  Backlog II (Login→2FA, Projekt→Rechnung, Upload).

---

## Auswirkungen auf das Audit-Backlog

- **INF-1** Healthcheck: **P0 → P2** (kein Bug; nur optionale DB-Awareness).
- **INF-2** Prozess-Handler: **P0 bestätigt** (live reproduziert) — hohe Priorität.
- **SEC-1** Deps: **P0 bestätigt** (Linux-Gegenprobe).
- **SEC-5** CSP fehlt: **bestätigt**.
- **NEU TEST-1** vue-tsc-Pinning: **P1** (zu INF-8).
- **NEU TEST-2** headless/BOT_TOKEN-Kopplung: **P1**.
- **NEU TEST-3** Rate-Limit wirkungslos unter Last: **P1**, zu verifizieren (getClientIp).
- **gitleaks** in CI + `.gitleaksignore`: Backlog II.

## Reproduzierbarkeit
Testumgebung ist wegwerfbar: Node 24 via nodesource, `~/patio` (git clone),
Container `patio-test-db` (`pgvector/pgvector:pg16`, `--restart unless-stopped`),
Test-`.env` mit zufälligem `JWT_SECRET`. Setup-Skript unter scratchpad archiviert.
