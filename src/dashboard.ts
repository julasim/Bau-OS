import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  listNotes, readNote,
  listTasks, listTermine,
  listProjects, getProjectInfo,
  listAgents,
} from "./obsidian.js";
import { getModel, isFastMode } from "./llm.js";
import { AGENTS, DASHBOARD_PORT, TIMEZONE, OLLAMA_BASE_URL } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const startTime = Date.now();

app.use(express.static(path.join(__dirname, "..", "public")));

// ── Helpers ───────────────────────────────────────────────────────────────────

function uptime(): string {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── API ───────────────────────────────────────────────────────────────────────

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

app.get("/api/notes", (_req, res) => {
  res.json(listNotes(50));
});

app.get("/api/note/:name", (req, res) => {
  const content = readNote(decodeURIComponent(req.params.name));
  if (!content) return res.status(404).json({ error: "Nicht gefunden" });
  res.json({ content });
});

app.get("/api/tasks", (_req, res) => {
  res.json(listTasks());
});

app.get("/api/projects", (_req, res) => {
  const projects = listProjects().map(name => {
    const raw = getProjectInfo(name) ?? "";
    const num = (label: string) => {
      const line = raw.split("\n").find(l => l.startsWith(label));
      return parseInt(line?.split(": ")[1] ?? "0") || 0;
    };
    return { name, notes: num("Notizen"), tasks: num("Offene Aufgaben"), termine: num("Termine") };
  });
  res.json(projects);
});

app.get("/api/termine", (_req, res) => {
  res.json(listTermine());
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function startDashboard(): void {
  app.listen(DASHBOARD_PORT, () => {
    console.log(`[Dashboard] http://localhost:${DASHBOARD_PORT}`);
  });
}
