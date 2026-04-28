# Bau-OS — Project Instructions

## Zielgruppe (WICHTIG)

> **Bau-OS ist ein Programm für Architekturbüros und Büros in der Baubranche
> (Planung, Bauleitung, Statik, Projektsteuerung) — NICHT für die Baustelle
> selbst.**

Das heißt konkret:

- **Primäre Nutzer:** Architekten, Bauleiter im Büro, Projektleiter,
  Sachbearbeiter, Statiker, Hausverwalter, Auftraggeber-Vertreter.
- **Geräte-Annahme:** Desktop, Laptop, gelegentlich Tablet/Phone vom
  Außendienst-Termin (Bauherrenmeeting, Begehung). Mobile-UI ist Komfort,
  nicht Hauptweg.
- **NICHT die Zielgruppe:** Polier auf der Baustelle, Maurer, Maschinen-
  führer, gewerbliche Mitarbeiter im Trockenbau o.ä. Die werden im System
  abgebildet (als `team_members`, in Stundenerfassung, Bautagebuch), aber
  sie sind nicht die Bedienenden.
- **Sprache & Tonalität:** Bürodeutsch, nicht Baustellen-Jargon. „Ein-
  trag dokumentieren" statt „Schnell auf der Baustelle eintippen".
- **Stundenerfassung, Bautagebuch, Meeting-Protokolle** sind Doku-Tools
  fürs Büro, das **die Daten aus der Baustelle aufbereitet** (in der Regel
  abends, retrospektiv, oder vom Bauleiter aus der Tasche heraus auf dem
  Weg zurück ins Büro).

## Codebase-Überblick

Stack:

- **Backend:** Node.js + TypeScript + Hono + grammy (Telegram), PostgreSQL
  via postgres.js, Ollama für LLM
- **Frontend:** Vue 3 (Composition API) + Vite + Tailwind v4
- **Deployment:** Docker Compose (`bauos-app`, `bauos-postgres`,
  `bauos-ollama`, `bauos-caddy`) auf eigener VM

Wichtige Pfade:

- `src/` — Backend (Hono Routes, LLM-Handler, DB-Repos, Bot-Manager)
- `src/db/migrations/` — SQL-Migrationen, idempotent forward-only
- `web/src/` — Vue-3-SPA
- `tests/` — Vitest unit tests (10 Files, 162 Tests Stand Mai 2026)
- `docs/` — VitePress-Doku

Architekturkern:

- Repos sind hybrid: `dbRepo` für DB-Mode, `fsRepo` als FS-Fallback. Konsumen-
  ten importieren immer von `src/data/index.ts`, nie direkt.
- LLM-Tool-Handler sind in `src/llm/handlers/*.ts`, registriert in
  `executor.ts` und `tools.ts`.
- AsyncLocalStorage (`src/llm/user-context.ts`) propagiert den User-Kontext
  durch den ganzen LLM-Call-Stack — wichtig fürs Multi-User-Scoping.

## Commit-Strategie

- Pro Feature ein Commit, mit klarer Migration-Referenz wenn DB-Schema
  geändert wird.
- Branch ist üblicherweise `claude/<random>`, push via Fast-Forward auf
  `main`.
- Vor jedem Commit: `npx tsc --noEmit`, `npx vue-tsc --noEmit -p web/tsconfig.json`,
  `npm test`, und im Zweifel `npx vite build --config web/vite.config.ts`.

## Tonalität in Code & UX

Wenn neue Features oder UI-Texte geschrieben werden, immer mitdenken:
**Wer benutzt das hier? Ein Architekt am Schreibtisch, kein Bauarbeiter
auf der Leiter.** Texte und Workflows entsprechend dimensionieren —
strukturiert, präzise, doku-orientiert.
