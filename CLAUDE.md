# PATIO — Project Instructions

> **Namens-Hinweis:** Das Produkt heißt **PATIO**. Alle `npm`-Befehle laufen
> aus `patio/`. In allen UI-Texten und der Doku gilt **PATIO**.

## Zielgruppe (WICHTIG)

> **PATIO ist ein Programm für Architektur-, Planungs- und Projektsteuerungs-
> büros — für die PLANUNG im Büro, NICHT für die Bauausführung/Baustelle.**

Das heißt konkret:

- **Primäre Nutzer:** Architekten, Projektleiter im Büro, Sachbearbeiter,
  Statiker, Bauphysik, Hausverwalter, Auftraggeber-Vertreter — Menschen am
  Schreibtisch.
- **Geräte-Annahme:** Desktop, Laptop, gelegentlich Tablet/Phone vom
  Außendienst-Termin (Bauherrenmeeting, Begehung). Mobile-UI ist Komfort,
  nicht Hauptweg.
- **NICHT die Zielgruppe:** Polier auf der Baustelle, Maurer, Maschinen-
  führer, gewerbliche Mitarbeiter. Die werden im System abgebildet (als
  `team_members`, in Stundenerfassung, Bautagebuch), aber sie sind nicht
  die Bedienenden.
- **Sprache & Tonalität:** Bürodeutsch, nicht Baustellen-Jargon. „Eintrag
  dokumentieren" statt „Schnell auf der Baustelle eintippen".
- **Stundenerfassung, Bautagebuch, Meeting-Protokolle** sind Doku-Tools
  fürs Büro, das die Daten aufbereitet (in der Regel abends, retrospektiv).
  Sie existieren — aber die Produkt-Positionierung betont die **Planung**,
  nicht die Bauausführung.

## Codebase-Überblick

Stack:

- **Backend:** Node.js + TypeScript + Hono + grammY (Telegram), PostgreSQL
  via postgres.js (+ pgvector, optional), LLM-Backend wahlweise OpenAI
  (wenn `OPENAI_API_KEY` gesetzt) oder lokales Ollama
- **Frontend:** Vue 3 (Composition API) + Pinia + Vite + Tailwind v4
- **Deployment:** Docker Compose (`bauos-app`, `bauos-postgres`,
  `bauos-ollama`, `bauos-caddy`) auf eigener VM

Wichtige Pfade:

- `src/` — Backend (Hono Routes, LLM-Handler, DB/FS-Repos, Bot-Manager,
  Heartbeat, Sync, Notifications, Maintenance)
- `src/db/migrations/` — SQL-Migrationen, idempotent forward-only
- `web/src/` — Vue-3-SPA
- `tests/` — Vitest unit tests (162 Tests, Stand Mai 2026)
- `docs/` — VitePress-Doku

Architekturkern:

- Repos sind hybrid: `dbRepo` für DB-Mode, `fsRepo` als FS-Fallback. Konsumen-
  ten importieren immer von `src/data/index.ts`, nie direkt. Chat-History und
  Agent-Logs liegen bewusst immer im FS (JSONL).
- LLM-Tool-Handler sind in `src/llm/handlers/*.ts`, registriert in
  `executor.ts` und `tools.ts`. Drei Tool-Quellen: built-in, dynamic
  (`tools/`), MCP (`mcp.json`).
- Der Tool-Loop in `src/llm/runtime.ts` läuft bis `MAX_TOOL_ROUNDS`, bis das
  Modell das `antworten`-Tool aufruft (Terminator).
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
strukturiert, präzise, doku-orientiert. Bürodeutsch, kein Baustellen-Jargon,
kein Hype-Wording.
