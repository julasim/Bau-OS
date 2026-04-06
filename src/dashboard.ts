import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  listNotes, readNote,
  listTasks, listTermine,
  listProjects, getProjectInfo,
  listAgents, getAgentPath,
} from "./obsidian.js";
import { getModel, isFastMode, processAgent, setReplyContext } from "./llm.js";
import {
  AGENTS, DASHBOARD_PORT, TIMEZONE, OLLAMA_BASE_URL,
  DEFAULT_MODEL, FAST_MODEL, SUBAGENT_MODEL,
  MAX_SPAWN_DEPTH, MAX_HISTORY_CHARS, COMPACT_THRESHOLD, KEEP_RECENT_LOGS,
} from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const startTime = Date.now();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ── Helpers ───────────────────────────────────────────────────────────────────

function uptime(): string {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── Status ────────────────────────────────────────────────────────────────────

app.get("/api/status", (_req, res) => {
  res.json({
    online: true,
    uptime: uptime(),
    model: getModel(),
    fastMode: isFastMode(),
    ollamaUrl: OLLAMA_BASE_URL,
    timezone: TIMEZONE,
    agentCount: listAgents().length,
    noteCount: listNotes(200).length,
    taskCount: listTasks().length,
    projectCount: listProjects().length,
    termineCount: listTermine().length,
  });
});

// ── Agenten ───────────────────────────────────────────────────────────────────

app.get("/api/agents", (_req, res) => {
  const result = listAgents().map(name => {
    const cfg = AGENTS.find(a => a.name === name);
    return {
      name,
      model: cfg?.model ?? "—",
      protected: cfg?.protected ?? false,
      description: cfg?.description ?? "—",
    };
  });
  res.json(result);
});

// ── Notizen ───────────────────────────────────────────────────────────────────

app.get("/api/notes", (_req, res) => { res.json(listNotes(50)); });

app.get("/api/note/:name", (req, res) => {
  const content = readNote(decodeURIComponent(req.params.name));
  if (!content) return res.status(404).json({ error: "Nicht gefunden" });
  res.json({ content });
});

// ── Aufgaben / Termine / Projekte ─────────────────────────────────────────────

app.get("/api/tasks",   (_req, res) => { res.json(listTasks()); });
app.get("/api/termine", (_req, res) => { res.json(listTermine()); });

app.get("/api/projects", (_req, res) => {
  const projects = listProjects().map(name => {
    const raw = getProjectInfo(name) ?? "";
    const num = (label: string) => parseInt(raw.split("\n").find(l => l.startsWith(label))?.split(": ")[1] ?? "0") || 0;
    return { name, notes: num("Notizen"), tasks: num("Offene Aufgaben"), termine: num("Termine") };
  });
  res.json(projects);
});

// ── Chat ──────────────────────────────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const { message, agent = "Main" } = req.body as { message?: string; agent?: string };
  if (!message?.trim()) return res.status(400).json({ error: "Nachricht fehlt" });

  try {
    setReplyContext(async () => {}); // Web-Chat braucht keinen async Reply-Kontext
    const response = await processAgent(agent, message.trim());
    res.json({ response });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── Logs ──────────────────────────────────────────────────────────────────────

app.get("/api/logs/:agent", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(getAgentPath(req.params.agent), "MEMORY_LOGS", `${today}.md`);
  if (!fs.existsSync(logPath)) return res.json({ content: null });
  res.json({ content: fs.readFileSync(logPath, "utf-8") });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────

app.get("/api/heartbeat", (_req, res) => {
  const result = listAgents().map(name => {
    const hbPath = path.join(getAgentPath(name), "HEARTBEAT.md");
    if (!fs.existsSync(hbPath)) return { name, cron: null };
    const content = fs.readFileSync(hbPath, "utf-8");
    const cronMatch = content.match(/^Cron:\s*(.+)$/im);
    return { name, cron: cronMatch?.[1]?.trim() ?? null };
  });
  res.json(result);
});

// ── Konfiguration (ohne Secrets) ──────────────────────────────────────────────

app.get("/api/config", (_req, res) => {
  res.json({
    llm: {
      aktuellesModell: getModel(),
      standardModell: DEFAULT_MODEL,
      fastModell: FAST_MODEL,
      subagentModell: SUBAGENT_MODEL,
      ollamaUrl: OLLAMA_BASE_URL,
      fastMode: isFastMode(),
    },
    agenten: AGENTS.map(a => ({ name: a.name, modell: a.model, beschreibung: a.description, geschützt: a.protected })),
    gedächtnis: {
      maxHistoryChars: MAX_HISTORY_CHARS,
      compactThreshold: COMPACT_THRESHOLD,
      keepRecentLogs: KEEP_RECENT_LOGS,
    },
    system: {
      maxSpawnTiefe: MAX_SPAWN_DEPTH,
      zeitzone: TIMEZONE,
    },
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function startDashboard(): void {
  app.listen(DASHBOARD_PORT, () => {
    console.log(`[Dashboard] http://localhost:${DASHBOARD_PORT}`);
  });
}
