# Archiv: Web-LLM-Frontend (Chat + Agenten-Verwaltung)

**Archiviert:** 2026-07-15 · **Grund:** Der Web-Chat und die Web-Agenten-Verwaltung
werden nicht mehr gebraucht — der LLM-Agent läuft künftig über **Telegram**, Agenten
werden hardcodiert festgelegt statt über die Web-UI konfiguriert.

**Unangetastet geblieben** (der Agent funktioniert weiter): `src/llm/**`, `src/bot.ts`,
`chatRepo` + DB-Tabellen `chat_sessions`/`chat_messages`, semantische Suche/Embeddings,
sowie die Backend-Route **`agent-logs.ts`** (die lebende `ProjectDetailView` nutzt
`/agent-logs` weiter für die Projekt-Aktivitätsanzeige).

## Inhalt & Original-Pfade

| Archiv | Ursprung |
|---|---|
| `views/ChatView.vue` | `web/src/views/ChatView.vue` |
| `views/AgentsView.vue` | `web/src/views/AgentsView.vue` |
| `views/AgentEditorView.vue` | `web/src/views/AgentEditorView.vue` |
| `routes/chat.ts` | `src/api/routes/chat.ts` |
| `routes/agents.ts` | `src/api/routes/agents.ts` |

## Wiedereinbau

1. Dateien an die Original-Pfade zurückverschieben (`git mv` — dann stimmen die relativen
   Imports wieder).
2. Verdrahtung wiederherstellen:
   - **`web/src/router.ts`:** Routen `agents`, `agent-editor`, `chat` wieder ergänzen.
   - **`web/src/components/shell/NavRail.vue`:** Nav-Eintrag „Chat & Agenten" → `/chat`
     und die SYSTEM-Sektion mit „Telegram-Agent"-Button.
   - **`web/src/components/NavSidebar.vue`:** Einträge `/chat` und `/agents`.
   - **`web/src/components/TopBar.vue`:** Titel-Mappings `chat`, `agents`, `agent-editor`.
   - **`web/src/components/AppLayout.vue`:** `isChatRoute`-Sonderlayout (ChatView rendert
     ohne Wrapper).
   - **`web/src/views/DashboardView.vue`:** „Chat-Sessions"-Kachel + „Neuer Chat"-Button.
   - **`src/api/server.ts`:** Importe `chatRoutes`/`agentsRoutes` + `app.route("/api", …)`.
3. Verifizieren: `npx tsc --noEmit`, `npx vue-tsc`, `npm run build:all`.

Referenz-Commit (Archivierung): siehe Git-History dieses Ordners.
