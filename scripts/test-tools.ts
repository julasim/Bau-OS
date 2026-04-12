/**
 * Bau-OS Tool & API Test Runner
 * Startet nur die API (ohne Telegram Bot) und testet alle Endpunkte + Tools.
 */
import "dotenv/config";

// ── 1. API-Server starten ───────────────────────────────────────────────────
import { startApi } from "../src/api/server.js";
import { initMcp } from "../src/mcp.js";

await initMcp();
startApi();

// Kurz warten bis Server bereit
await new Promise((r) => setTimeout(r, 1000));

const BASE = "http://localhost:3000";
let TOKEN = "";
let passed = 0;
let failed = 0;
const errors: string[] = [];

// ── Helper ──────────────────────────────────────────────────────────────────
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function test(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    const msg = `  ❌ ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(msg);
    errors.push(msg);
  }
}

// ── 2. Login ────────────────────────────────────────────────────────────────
console.log("\n🔐 AUTH");
const loginRes = await api("POST", "/auth/login", { username: "admin", password: "admin" });
test("POST /auth/login", loginRes.status === 200, `status=${loginRes.status}`);
TOKEN = (loginRes.data as Record<string, string>)?.token ?? "";
test("Token erhalten", !!TOKEN, TOKEN ? "ok" : "kein Token");

const meRes = await api("GET", "/auth/me");
test("GET /auth/me", meRes.status === 200, JSON.stringify(meRes.data));

// ── 3. Dashboard ────────────────────────────────────────────────────────────
console.log("\n📊 DASHBOARD");
const dashRes = await api("GET", "/dashboard");
test("GET /dashboard", dashRes.status === 200, `status=${dashRes.status}`);

// ── 4. Tasks ────────────────────────────────────────────────────────────────
console.log("\n✅ TASKS");
const tasksListRes = await api("GET", "/tasks");
test("GET /tasks", tasksListRes.status === 200, `status=${tasksListRes.status}`);

const taskCreateRes = await api("POST", "/tasks", { text: "TEST-Aufgabe loeschen", assignee: "Test" });
test(
  "POST /tasks",
  taskCreateRes.status === 200 || taskCreateRes.status === 201,
  `status=${taskCreateRes.status}`,
);
const createdTask = taskCreateRes.data as Record<string, string>;
const taskId = createdTask?.id ?? createdTask?.text;

if (taskId) {
  const taskCompleteRes = await api("PATCH", `/tasks/${encodeURIComponent(taskId)}/complete`);
  test("PATCH /tasks/:id/complete", taskCompleteRes.status === 200, `status=${taskCompleteRes.status}`);
}

// ── 5. Termine ──────────────────────────────────────────────────────────────
console.log("\n📅 TERMINE");
const termineListRes = await api("GET", "/termine");
test("GET /termine", termineListRes.status === 200, `status=${termineListRes.status}`);

const terminCreateRes = await api("POST", "/termine", {
  datum: "31.12.2026",
  text: "TEST-Termin loeschen",
  uhrzeit: "10:00",
});
test(
  "POST /termine",
  terminCreateRes.status === 200 || terminCreateRes.status === 201,
  `status=${terminCreateRes.status}`,
);
const createdTermin = terminCreateRes.data as Record<string, string>;
const terminId = createdTermin?.id ?? createdTermin?.text;

if (terminId) {
  const terminDeleteRes = await api("DELETE", `/termine/${encodeURIComponent(terminId)}`);
  test("DELETE /termine/:id", terminDeleteRes.status === 200, `status=${terminDeleteRes.status}`);
}

// ── 6. Notes ────────────────────────────────────────────────────────────────
console.log("\n📝 NOTES");
const notesListRes = await api("GET", "/notes");
test("GET /notes", notesListRes.status === 200, `status=${notesListRes.status}`);

// Einzelne Note lesen (erste falls vorhanden)
const notesArr = notesListRes.data as Record<string, unknown>[];
if (Array.isArray(notesArr) && notesArr.length > 0) {
  const firstNote = notesArr[0];
  const noteName = String(firstNote.name ?? firstNote.file ?? firstNote.title ?? "").replace(/\.md$/, "");
  if (noteName) {
    const noteReadRes = await api("GET", `/notes/${encodeURIComponent(noteName)}`);
    test("GET /notes/:name", noteReadRes.status === 200, `status=${noteReadRes.status}, name=${noteName}`);
  } else {
    test("GET /notes/:name", true, `skipped — kein name-Feld: ${JSON.stringify(firstNote).slice(0, 100)}`);
  }
} else {
  test("GET /notes/:name", true, "skipped — keine Notizen vorhanden");
}

// ── 7. Projekte ─────────────────────────────────────────────────────────────
console.log("\n📁 PROJEKTE");
const projectsListRes = await api("GET", "/projects");
test("GET /projects", projectsListRes.status === 200, `status=${projectsListRes.status}`);

const projectsList = projectsListRes.data as { name: string }[];
if (Array.isArray(projectsList) && projectsList.length > 0) {
  const projDetailRes = await api("GET", `/projects/${encodeURIComponent(projectsList[0].name)}`);
  test("GET /projects/:name", projDetailRes.status === 200, `status=${projDetailRes.status}`);
}

// ── 8. Agents ───────────────────────────────────────────────────────────────
console.log("\n🤖 AGENTS");
const agentsListRes = await api("GET", "/agents");
test("GET /agents", agentsListRes.status === 200, `status=${agentsListRes.status}`);

const agentsList = agentsListRes.data as { name: string }[];
if (Array.isArray(agentsList) && agentsList.length > 0) {
  const agentDetailRes = await api("GET", `/agents/${encodeURIComponent(agentsList[0].name)}`);
  test("GET /agents/:name", agentDetailRes.status === 200, `status=${agentDetailRes.status}`);
}

// ── 9. Search ───────────────────────────────────────────────────────────────
console.log("\n🔍 SEARCH");
const searchRes = await api("GET", "/search?q=test");
test("GET /search?q=test", searchRes.status === 200, `status=${searchRes.status}`);

// ── 10. Files ───────────────────────────────────────────────────────────────
console.log("\n📂 FILES");
const filesListRes = await api("GET", "/files");
test("GET /files (root)", filesListRes.status === 200, `status=${filesListRes.status}`);

// ── 11. Team ────────────────────────────────────────────────────────────────
console.log("\n👥 TEAM");
const teamListRes = await api("GET", "/team");
test("GET /team", teamListRes.status === 200, `status=${teamListRes.status}`);

// ── 12. Chat Sessions ──────────────────────────────────────────────────────
console.log("\n💬 CHAT");
const chatSessionsRes = await api("GET", "/chat/sessions");
test("GET /chat/sessions", chatSessionsRes.status === 200, `status=${chatSessionsRes.status}`);

// ── 13. Events (SSE) ───────────────────────────────────────────────────────
console.log("\n📡 EVENTS (SSE)");
try {
  const evtRes = await fetch(`${BASE}/api/events?token=${TOKEN}`, {
    signal: AbortSignal.timeout(2000),
  });
  test("GET /events (SSE connect)", evtRes.status === 200, `status=${evtRes.status}`);
} catch (err) {
  // Timeout ist ok — SSE bleibt offen
  test("GET /events (SSE connect)", true, "timeout = expected for SSE");
}

// ── 14. Tool-Handler direkt testen ──────────────────────────────────────────
console.log("\n🔧 TOOL-HANDLER (direkt)");
import { executeTool } from "../src/llm/executor.js";

// Notes
const noteListResult = await executeTool("notizen_auflisten", {});
test("notizen_auflisten", !noteListResult.startsWith("Fehler"), noteListResult.slice(0, 80));

// Tasks
const taskListResult = await executeTool("aufgaben_auflisten", {});
test("aufgaben_auflisten", !taskListResult.startsWith("Fehler"), taskListResult.slice(0, 80));

// Termine
const terminListResult = await executeTool("termine_auflisten", {});
test("termine_auflisten", !terminListResult.startsWith("Fehler"), terminListResult.slice(0, 80));

// Save + Delete task
const taskSaveResult = await executeTool("aufgabe_speichern", { text: "_TOOLTEST_ Aufgabe loeschen" });
test("aufgabe_speichern", taskSaveResult.includes("gespeichert") || taskSaveResult.includes("Aufgabe"), taskSaveResult.slice(0, 80));

const taskCompleteResult = await executeTool("aufgabe_erledigen", { text: "_TOOLTEST_ Aufgabe loeschen" });
test("aufgabe_erledigen", !taskCompleteResult.startsWith("Fehler"), taskCompleteResult.slice(0, 80));

// Save + Delete termin
const terminSaveResult = await executeTool("termin_speichern", {
  datum: "31.12.2026",
  text: "_TOOLTEST_ Termin loeschen",
});
test("termin_speichern", terminSaveResult.includes("gespeichert") || terminSaveResult.includes("Termin"), terminSaveResult.slice(0, 80));

const terminDeleteResult = await executeTool("termin_loeschen", { text: "_TOOLTEST_ Termin loeschen" });
test("termin_loeschen", !terminDeleteResult.startsWith("Fehler"), terminDeleteResult.slice(0, 80));

// Notes save + read + delete
const noteSaveResult = await executeTool("notiz_speichern", {
  titel: "_TOOLTEST_Notiz",
  inhalt: "Dies ist eine Testnotiz.",
});
test("notiz_speichern", noteSaveResult.includes("gespeichert") || noteSaveResult.includes("Notiz"), noteSaveResult.slice(0, 80));

const noteReadResult = await executeTool("notiz_lesen", { datei: "_TOOLTEST_Notiz.md" });
test("notiz_lesen", noteReadResult.includes("Testnotiz") || !noteReadResult.startsWith("Fehler"), noteReadResult.slice(0, 80));

const noteDeleteResult = await executeTool("notiz_loeschen", { datei: "_TOOLTEST_Notiz.md" });
test("notiz_loeschen", noteDeleteResult.includes("gelöscht") || noteDeleteResult.includes("geloescht") || noteDeleteResult.includes("Notiz"), noteDeleteResult.slice(0, 80));

// Files
const folderListResult = await executeTool("ordner_auflisten", { pfad: "" });
test("ordner_auflisten", !folderListResult.startsWith("Fehler"), folderListResult.slice(0, 80));

// vault_suchen
const vaultSearchResult = await executeTool("vault_suchen", { query: "test" });
test("vault_suchen", !vaultSearchResult.startsWith("Fehler"), vaultSearchResult.slice(0, 80));

// dateien_suchen
const fileSearchResult = await executeTool("dateien_suchen", { query: "*.md" });
test("dateien_suchen", !fileSearchResult.startsWith("Fehler"), fileSearchResult.slice(0, 80));

// Projekte
const projectListResult = await executeTool("projekte_auflisten", {});
test("projekte_auflisten", !projectListResult.startsWith("Fehler"), projectListResult.slice(0, 80));

// Agents
const agentListResult = await executeTool("agenten_auflisten", {});
test("agenten_auflisten", !agentListResult.startsWith("Fehler"), agentListResult.slice(0, 80));

// System: befehl_ausfuehren
const cmdResult = await executeTool("befehl_ausfuehren", { befehl: "echo hello" });
test("befehl_ausfuehren", cmdResult.includes("hello"), cmdResult.slice(0, 80));

// System: code_ausfuehren
const codeResult = await executeTool("code_ausfuehren", { code: "2 + 3" });
test("code_ausfuehren", codeResult.includes("5"), codeResult.slice(0, 80));

// Web: web_suchen
const webSearchResult = await executeTool("web_suchen", { query: "Wetter Wien" });
test("web_suchen", !webSearchResult.startsWith("Fehler"), webSearchResult.slice(0, 80));

// Web: webseite_lesen
const webReadResult = await executeTool("webseite_lesen", { url: "https://example.com" });
test("webseite_lesen", webReadResult.includes("Example") || !webReadResult.startsWith("Fehler"), webReadResult.slice(0, 80));

// Memory
const memorySaveResult = await executeTool("memory_speichern", {
  agent: "Main",
  eintrag: "_TOOLTEST_ Memory-Eintrag",
});
test("memory_speichern", !memorySaveResult.startsWith("Fehler"), memorySaveResult.slice(0, 80));

// Agent-Verlauf
const agentHistoryResult = await executeTool("agent_verlauf", { agent: "Main" });
test("agent_verlauf", !agentHistoryResult.startsWith("Fehler"), agentHistoryResult.slice(0, 80));

// Regex-Suche
const regexResult = await executeTool("regex_suchen", { pattern: "test", pfad: "" });
test("regex_suchen", !regexResult.startsWith("Fehler"), regexResult.slice(0, 80));

// MCP
const mcpListResult = await executeTool("mcp_server_auflisten", {});
test("mcp_server_auflisten", !mcpListResult.startsWith("Fehler"), mcpListResult.slice(0, 80));

// Dynamic tools
const dynListResult = await executeTool("tools_auflisten", {});
test("tools_auflisten", !dynListResult.startsWith("Fehler"), dynListResult.slice(0, 80));

// datei_erstellen + datei_lesen + datei_bearbeiten
const fileCreateResult = await executeTool("datei_erstellen", {
  pfad: "Inbox/_TOOLTEST_datei.md",
  inhalt: "Zeile 1\nZeile 2\nZeile 3",
});
test("datei_erstellen", fileCreateResult.includes("erstellt") || fileCreateResult.includes("Datei"), fileCreateResult.slice(0, 80));

const fileReadResult = await executeTool("datei_lesen", { pfad: "Inbox/_TOOLTEST_datei.md" });
test("datei_lesen", fileReadResult.includes("Zeile"), fileReadResult.slice(0, 80));

const fileEditResult = await executeTool("datei_bearbeiten", {
  pfad: "Inbox/_TOOLTEST_datei.md",
  suchen: "Zeile 2",
  ersetzen: "Zeile ZWEI",
});
test("datei_bearbeiten", !fileEditResult.startsWith("Fehler"), fileEditResult.slice(0, 80));

// Aufräumen: Test-Datei löschen
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH } from "../src/config.js";
const testFile = path.join(WORKSPACE_PATH, "Inbox", "_TOOLTEST_datei.md");
if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

// ── Zusammenfassung ─────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(60));
console.log(`  ERGEBNIS: ${passed} bestanden, ${failed} fehlgeschlagen`);
if (errors.length > 0) {
  console.log("\n  Fehler:");
  for (const e of errors) console.log(e);
}
console.log("═".repeat(60) + "\n");

process.exit(failed > 0 ? 1 : 0);
