# Archiv: Supabase-Subsystem (Realtime-Bridge · JS-Client · Self-Hosted-Setup)

**Archiviert:** 2026-07-15 · **Grund (Audit INF-11):** Dormantes Subsystem. Im
regulären PostgreSQL-Betrieb war es **faktisch immer inaktiv** (`SUPABASE_ENABLED`
= `!!(SUPABASE_URL && SUPABASE_ANON_KEY)`, beide nie gesetzt). Kein toter Code —
es wurde importiert —, aber ungewartete Angriffs- und Wartungsfläche plus eine
ungenutzte Dependency (`@supabase/supabase-js`). Der reguläre Datenpfad läuft
über `postgres.js` (`src/db/client.ts`); Live-Updates im Frontend kommen über den
internen SSE-Event-Bus (`src/api/events.ts`), **nicht** über Supabase Realtime.

**Unangetastet geblieben:** Der gesamte Postgres-/pgvector-Pfad, der SSE-Event-Bus
(`emit`/`subscribe` in `src/api/events.ts`) und der DB-Status-Endpoint
(`/dashboard/db-status`) — Letzterer nur ohne das `realtime`-Feld.

## Inhalt & Original-Pfade

| Archiv | Ursprung |
|---|---|
| `db-supabase.ts` | `src/db/supabase.ts` |
| `realtime-bridge.ts` | `src/api/realtime-bridge.ts` |
| `setup-supabase.sh` | `scripts/setup-supabase.sh` |
| `docker-compose.supabase.yml` | `docker/docker-compose.yml` (Self-Hosted-Stub) |

## Entfernte Verdrahtung (beim Wiedereinbau wiederherstellen)

- **`src/config.ts`:** Konstanten `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_KEY`, `SUPABASE_ENABLED` (Block „── Supabase Client ──").
- **`src/db/index.ts`:** Re-Export `getSupabase`, `getSupabaseAnon`,
  `subscribeToTable`, `checkSupabaseHealth` aus `./supabase.js`.
- **`src/index.ts`:** Start-Block `startRealtimeBridge()` nach `startApi()`.
- **`src/api/routes/dashboard.ts`:** `SUPABASE_ENABLED`-Import in `db-status`,
  der `bridge`-Statusblock und das Response-Feld `realtime: bridge`.
- **`web/src/components/SystemStatusBanner.vue`:** `realtime`-Feld im `DbStatus`-
  Interface und der `realtime-down`-Banner-Zweig.
- **`.env.example` / `docker/.env.example`:** Supabase-Beispielvariablen
  (`SUPABASE_URL/ANON_KEY/SERVICE_KEY`, `STUDIO_PORT`, `REALTIME_*`, `SECRET_KEY_BASE`).
- **`package.json`:** Dependency `@supabase/supabase-js` (mit `npm install`
  wieder aufnehmen).

## Wiedereinbau

1. Dateien an die Original-Pfade zurückverschieben (`git mv` — dann stimmen die
   relativen Imports wieder). `docker-compose.supabase.yml` → `docker/docker-compose.yml`.
2. `npm install @supabase/supabase-js` (oder die Version aus der Git-History pinnen).
3. Die oben gelistete Verdrahtung wiederherstellen.
4. `npx tsc --noEmit` + `npx vue-tsc --noEmit -p web/tsconfig.json` + `npm test` grün fahren.
