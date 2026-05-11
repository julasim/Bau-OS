// Filesystem-Implementation: Agent-Logs als JSONL, append-only.
//
// Layout: logs/agent-logs.jsonl — eine Zeile pro Log-Eintrag. Einfach zu
// rotieren (logrotate) und per tail/jq auszuwerten.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { AgentLog, AgentLogRepository } from "./types.js";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "agent-logs.jsonl");
const LOG_MAX_LINES = 5_000;
const LOG_TRIM_TO = 4_000;

function ensureFile(): void {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function trimLogFileIfNeeded(): void {
  if (!fs.existsSync(LOG_FILE)) return;
  const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  if (lines.length <= LOG_MAX_LINES) return;
  const kept = lines.slice(-LOG_TRIM_TO);
  fs.writeFileSync(LOG_FILE, kept.join("\n") + "\n", "utf-8");
}

function readAll(): AgentLog[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return fs
      .readFileSync(LOG_FILE, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AgentLog);
  } catch {
    return [];
  }
}

export const fsAgentLogs: AgentLogRepository = {
  async create(log) {
    ensureFile();
    const entry: AgentLog = {
      ...log,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    trimLogFileIfNeeded();
    return entry;
  },

  async listBySession(sessionId, limit = 100) {
    return readAll()
      .filter((l) => l.sessionId === sessionId)
      .slice(-limit);
  },

  async listRecent(limit = 50, offset = 0) {
    const all = readAll();
    return all.slice(-limit - offset, all.length - offset).reverse();
  },

  async query(filters) {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const from = filters.from ? new Date(filters.from).getTime() : 0;
    const to = filters.to ? new Date(filters.to).getTime() : Number.MAX_SAFE_INTEGER;

    const matches = readAll().filter((l) => {
      if (filters.sessionId && l.sessionId !== filters.sessionId) return false;
      if (filters.agentName && l.agentName !== filters.agentName) return false;
      if (filters.toolName && l.toolName !== filters.toolName) return false;
      if (filters.projectId && l.projectId !== filters.projectId) return false;
      if (l.createdAt) {
        const ts = new Date(l.createdAt).getTime();
        if (ts < from || ts > to) return false;
      }
      return true;
    });
    return matches.slice(-limit - offset, matches.length - offset).reverse();
  },
};
