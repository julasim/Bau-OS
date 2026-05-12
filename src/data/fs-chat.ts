// Filesystem-Implementation: Chat-Sessions + Messages als JSONL pro Agent.
//
// Layout: data/chat/<agent>.jsonl — append-only. Jede Zeile ist entweder
// ein Session-Start ({type:"session", ...}) oder eine Message
// ({type:"message", sessionId, role, content, ...}). Einfach, robust gegen
// partielle Writes (Zeilen-orientiert) und leicht per tail/grep zu warten.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { ChatRepository, ChatSession, ChatMessage } from "./types.js";
import { atomicWriteSync } from "../workspace/helpers.js";

const CHAT_DIR = path.join(process.cwd(), "data", "chat");
const CHAT_MAX_LINES = 10_000;
const CHAT_TRIM_TO = 8_000;

function ensureDir(): void {
  if (!fs.existsSync(CHAT_DIR)) fs.mkdirSync(CHAT_DIR, { recursive: true });
}

function fileFor(agent: string): string {
  ensureDir();
  const safe = agent.replace(/[^\w.-]+/g, "_");
  return path.join(CHAT_DIR, `${safe}.jsonl`);
}

function trimChatFileIfNeeded(filepath: string): void {
  if (!fs.existsSync(filepath)) return;
  const lines = fs.readFileSync(filepath, "utf-8").split("\n").filter(Boolean);
  if (lines.length <= CHAT_MAX_LINES) return;
  const kept = lines.slice(-CHAT_TRIM_TO);
  fs.writeFileSync(filepath, kept.join("\n") + "\n", "utf-8");
}

type SessionLine = {
  type: "session";
  id: string;
  agent: string;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type MessageLine = {
  type: "message";
  id: string;
  sessionId: string;
  role: string;
  content: string;
  tools: string[];
  source: string;
  createdAt: string;
};

type TitleUpdateLine = {
  type: "title";
  sessionId: string;
  title: string;
  updatedAt: string;
};

type AnyLine = SessionLine | MessageLine | TitleUpdateLine;

function readLines(agent: string): AnyLine[] {
  const fp = fileFor(agent);
  if (!fs.existsSync(fp)) return [];
  try {
    return fs
      .readFileSync(fp, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AnyLine);
  } catch {
    return [];
  }
}

function appendLine(agent: string, line: AnyLine): void {
  const fp = fileFor(agent);
  fs.appendFileSync(fp, JSON.stringify(line) + "\n");
  trimChatFileIfNeeded(fp);
}

function listAgentFiles(): string[] {
  ensureDir();
  return fs.readdirSync(CHAT_DIR).filter((f) => f.endsWith(".jsonl"));
}

function agentFromFile(filename: string): string {
  return filename.replace(/\.jsonl$/, "");
}

function materializeSessions(lines: AnyLine[]): Map<string, ChatSession & { lastActivity: string }> {
  const sessions = new Map<string, ChatSession & { lastActivity: string }>();
  const counts = new Map<string, number>();
  const firstUser = new Map<string, string>();

  for (const l of lines) {
    if (l.type === "session") {
      sessions.set(l.id, {
        id: l.id,
        agent: l.agent,
        title: l.title,
        source: l.source,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        lastActivity: l.updatedAt,
      });
    } else if (l.type === "message") {
      counts.set(l.sessionId, (counts.get(l.sessionId) ?? 0) + 1);
      const s = sessions.get(l.sessionId);
      if (s) s.lastActivity = l.createdAt;
      if (l.role === "user" && !firstUser.has(l.sessionId)) {
        firstUser.set(l.sessionId, l.content);
      }
    } else if (l.type === "title") {
      const s = sessions.get(l.sessionId);
      if (s) {
        s.title = l.title;
        s.updatedAt = l.updatedAt;
        s.lastActivity = l.updatedAt;
      }
    }
  }

  for (const [id, s] of sessions.entries()) {
    s.messageCount = counts.get(id) ?? 0;
    s.lastMessage = firstUser.get(id);
    s.updatedAt = s.lastActivity;
  }
  return sessions;
}

export const fsChat: ChatRepository = {
  async createSession(agent = "Main", title = "Neuer Chat", source = "web") {
    const now = new Date().toISOString();
    const session: ChatSession = {
      id: crypto.randomUUID(),
      agent,
      title,
      source,
      createdAt: now,
      updatedAt: now,
    };
    appendLine(agent, { type: "session", ...session });
    return session;
  },

  async listSessions(agent, limit = 50) {
    const agents = agent ? [agent] : listAgentFiles().map(agentFromFile);
    const all: (ChatSession & { lastActivity: string })[] = [];
    for (const a of agents) {
      const sessions = materializeSessions(readLines(a));
      // Nur Web-Sessions im Web-Interface anzeigen — Heartbeat/Telegram-Sessions
      // sollen nicht in der Session-Liste erscheinen.
      for (const s of sessions.values()) {
        if (s.source === "web") all.push(s);
      }
    }
    all.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    return all.slice(0, limit).map(({ lastActivity: _, ...rest }) => rest);
  },

  async deleteSession(id) {
    for (const f of listAgentFiles()) {
      const agent = agentFromFile(f);
      const lines = readLines(agent);
      const kept = lines.filter((l) =>
        l.type === "session" ? l.id !== id : l.type === "message" || l.type === "title" ? l.sessionId !== id : true,
      );
      if (kept.length !== lines.length) {
        atomicWriteSync(fileFor(agent), kept.map((l) => JSON.stringify(l)).join("\n") + (kept.length ? "\n" : ""));
        return true;
      }
    }
    return false;
  },

  async addMessage(sessionId, role, content, tools, source = "web") {
    // Welcher Agent gehoert zu dieser Session? Alle Dateien durchsuchen.
    let agent = "Main";
    for (const f of listAgentFiles()) {
      const a = agentFromFile(f);
      const lines = readLines(a);
      if (lines.some((l) => l.type === "session" && l.id === sessionId)) {
        agent = a;
        break;
      }
    }

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId,
      role,
      content,
      tools: tools ?? [],
      source,
      createdAt: new Date().toISOString(),
    };
    appendLine(agent, { type: "message", ...msg });

    // Titel bei erster User-Nachricht auf den Inhalt setzen (wenn Default).
    if (role === "user") {
      const lines = readLines(agent);
      const session = lines.find((l) => l.type === "session" && l.id === sessionId) as SessionLine | undefined;
      const userMsgs = lines.filter((l) => l.type === "message" && l.sessionId === sessionId && l.role === "user");
      if (session && session.title === "Neuer Chat" && userMsgs.length === 1) {
        appendLine(agent, {
          type: "title",
          sessionId,
          title: content.slice(0, 60),
          updatedAt: msg.createdAt,
        });
      }
    }

    return msg;
  },

  async getMessages(sessionId, limit = 100) {
    for (const f of listAgentFiles()) {
      const agent = agentFromFile(f);
      const lines = readLines(agent);
      const msgs = lines
        .filter((l): l is MessageLine => l.type === "message" && l.sessionId === sessionId)
        .map(({ type: _, ...m }) => m);
      if (msgs.length > 0 || lines.some((l) => l.type === "session" && l.id === sessionId)) {
        return msgs.slice(0, limit);
      }
    }
    return [];
  },

  async getRecentHistory(agent = "Main", limit = 10) {
    const lines = readLines(agent);
    // Neueste Web-Session finden — Heartbeat/Telegram-Sessions ignorieren,
    // damit deren Inhalt nicht faelschlicherweise im Web-Chat-Kontext landet.
    const sessions = materializeSessions(lines);
    if (sessions.size === 0) return [];
    const webSessions = [...sessions.values()].filter((s) => s.source === "web");
    if (webSessions.length === 0) return [];
    const newest = webSessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))[0];
    const msgs = lines
      .filter((l): l is MessageLine => l.type === "message" && l.sessionId === newest.id)
      .filter((m) => m.role === "user" || m.role === "assistant");
    const pairs: { user: string; assistant: string }[] = [];
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === "user" && msgs[i + 1].role === "assistant") {
        pairs.push({ user: msgs[i].content, assistant: msgs[i + 1].content });
        i++;
      }
    }
    return pairs.slice(-limit);
  },

  async getOrCreateTodaySession(agent, source = "telegram") {
    const today = new Date().toISOString().slice(0, 10);
    const lines = readLines(agent);
    const existing = lines.find(
      (l): l is SessionLine =>
        l.type === "session" && l.agent === agent && l.source === source && l.createdAt.slice(0, 10) === today,
    );
    if (existing) return existing.id;
    const s = await this.createSession(agent, `Chat ${today}`, source);
    return s.id;
  },

  async searchMessages(query, limit = 10) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: ChatMessage[] = [];
    for (const f of listAgentFiles()) {
      const agent = agentFromFile(f);
      const lines = readLines(agent);
      for (const l of lines) {
        if (l.type !== "message") continue;
        if (l.content.toLowerCase().includes(q)) {
          hits.push({
            id: l.id,
            sessionId: l.sessionId,
            role: l.role,
            content: l.content,
            tools: l.tools,
            source: l.source,
            createdAt: l.createdAt,
          });
        }
      }
    }

    // Neueste zuerst — User sucht meistens nach kuerzlich Gesagtem
    hits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return hits.slice(0, limit);
  },
};
