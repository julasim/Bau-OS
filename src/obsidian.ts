import fs from "fs";
import path from "path";

const vaultPath = process.env.VAULT_PATH!;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestampFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function frontmatter(source = "telegram"): string {
  const now = new Date();
  const date = now.toLocaleDateString("de-AT", { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  return `---\ncreated: ${date} ${time}\nsource: ${source}\n---\n\n`;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveNotePath(nameOrPath: string): string | null {
  const withExt = nameOrPath.endsWith(".md") ? nameOrPath : nameOrPath + ".md";

  for (const candidate of [
    path.join(vaultPath, withExt),
    path.join(vaultPath, "Inbox", withExt),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  function searchDir(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = searchDir(full);
        if (found) return found;
      } else if (entry.name === withExt || entry.name.includes(nameOrPath)) {
        return full;
      }
    }
    return null;
  }

  return searchDir(vaultPath);
}

// ─── Notizen ─────────────────────────────────────────────────────────────────

export function saveNote(content: string, project?: string): string {
  const folder = project
    ? path.join(vaultPath, "Projekte", project, "Notizen")
    : path.join(vaultPath, "Inbox");

  ensureDir(folder);

  const filename = timestampFilename() + ".md";
  const filepath = path.join(folder, filename);
  fs.writeFileSync(filepath, frontmatter() + content + "\n", "utf-8");
  return filepath;
}

export function listNotes(limit = 10): string[] {
  const inboxPath = path.join(vaultPath, "Inbox");
  if (!fs.existsSync(inboxPath)) return [];

  return fs.readdirSync(inboxPath)
    .filter(f => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map(f => f.replace(".md", ""));
}

export function readNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return null;
  return fs.readFileSync(filepath, "utf-8");
}

export function appendToNote(nameOrPath: string, content: string): boolean {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return false;

  const now = new Date();
  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  fs.appendFileSync(filepath, `\n**Nachtrag ${time}:** ${content}\n`, "utf-8");
  return true;
}

export function deleteNote(nameOrPath: string): string | null {
  const filepath = resolveNotePath(nameOrPath);
  if (!filepath) return null;

  const filename = path.basename(filepath);
  fs.unlinkSync(filepath);
  return filename;
}

// ─── Aufgaben ─────────────────────────────────────────────────────────────────

function tasksFilePath(project?: string): string {
  return project
    ? path.join(vaultPath, "Projekte", project, "Aufgaben.md")
    : path.join(vaultPath, "Aufgaben.md");
}

export function saveTask(text: string, project?: string): void {
  const filepath = tasksFilePath(project);
  ensureDir(path.dirname(filepath));

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, project ? `# Aufgaben – ${project}\n\n` : `# Aufgaben\n\n`, "utf-8");
  }

  fs.appendFileSync(filepath, `- [ ] ${text}\n`, "utf-8");
}

export function listTasks(project?: string): string[] {
  const filepath = tasksFilePath(project);
  if (!fs.existsSync(filepath)) return [];

  return fs.readFileSync(filepath, "utf-8")
    .split("\n")
    .filter(line => line.startsWith("- [ ]"))
    .map(line => line.replace("- [ ] ", "").trim());
}

export function completeTask(text: string, project?: string): boolean {
  const filepath = tasksFilePath(project);
  if (!fs.existsSync(filepath)) return false;

  const content = fs.readFileSync(filepath, "utf-8");
  const needle = `- [ ] ${text}`;
  if (!content.includes(needle)) return false;

  fs.writeFileSync(filepath, content.replace(needle, `- [x] ${text}`), "utf-8");
  return true;
}

// ─── Termine ─────────────────────────────────────────────────────────────────

function termineFilePath(project?: string): string {
  return project
    ? path.join(vaultPath, "Projekte", project, "Termine.md")
    : path.join(vaultPath, "Termine.md");
}

export function saveTermin(datum: string, text: string, uhrzeit?: string, project?: string): void {
  const filepath = termineFilePath(project);
  ensureDir(path.dirname(filepath));

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, project ? `# Termine – ${project}\n\n` : `# Termine\n\n`, "utf-8");
  }

  const entry = uhrzeit
    ? `- [ ] ${datum} | ${uhrzeit} | ${text}\n`
    : `- [ ] ${datum} | ${text}\n`;
  fs.appendFileSync(filepath, entry, "utf-8");
}

export function listTermine(project?: string): string[] {
  const filepath = termineFilePath(project);
  if (!fs.existsSync(filepath)) return [];

  return fs.readFileSync(filepath, "utf-8")
    .split("\n")
    .filter(line => line.startsWith("- [ ]"))
    .map(line => line.replace("- [ ] ", "").trim());
}

export function deleteTermin(text: string, project?: string): boolean {
  const filepath = termineFilePath(project);
  if (!fs.existsSync(filepath)) return false;

  const content = fs.readFileSync(filepath, "utf-8");
  const lines = content.split("\n");
  const filtered = lines.filter(line => !line.includes(text));

  if (filtered.length === lines.length) return false;

  fs.writeFileSync(filepath, filtered.join("\n"), "utf-8");
  return true;
}

// ─── Projekte ─────────────────────────────────────────────────────────────────

export function createProject(name: string): string {
  const projectPath = path.join(vaultPath, "Projekte", name);

  ensureDir(path.join(projectPath, "Notizen"));

  const files: Record<string, string> = {
    "Aufgaben.md": `# Aufgaben – ${name}\n\n`,
    "Termine.md": `# Termine – ${name}\n\n`,
    "README.md": `# ${name}\n\nErstellt: ${new Date().toLocaleDateString("de-AT")}\n`,
  };

  for (const [filename, content] of Object.entries(files)) {
    const fp = path.join(projectPath, filename);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content, "utf-8");
  }

  return projectPath;
}

export function listProjects(): string[] {
  const projektePath = path.join(vaultPath, "Projekte");
  if (!fs.existsSync(projektePath)) return [];

  return fs.readdirSync(projektePath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

export function getProjectInfo(name: string): string | null {
  const projectPath = path.join(vaultPath, "Projekte", name);
  if (!fs.existsSync(projectPath)) return null;

  const openTasks = listTasks(name).length;
  const termine = listTermine(name).length;
  const notesDir = path.join(projectPath, "Notizen");
  const noteCount = fs.existsSync(notesDir)
    ? fs.readdirSync(notesDir).filter(f => f.endsWith(".md")).length
    : 0;

  return `Projekt: ${name}\n\nNotizen: ${noteCount}\nOffene Aufgaben: ${openTasks}\nTermine: ${termine}`;
}

// ─── Datei-Operationen ────────────────────────────────────────────────────────

export function readFile(relativePath: string): string | null {
  const filepath = path.join(vaultPath, relativePath);
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

export function createFile(relativePath: string, content: string): string {
  const filepath = path.join(vaultPath, relativePath);
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, content, "utf-8");
  return filepath;
}

export function deleteFile(relativePath: string): boolean {
  const filepath = path.join(vaultPath, relativePath);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}

export function listFolder(relativePath = ""): string[] {
  const folderPath = relativePath ? path.join(vaultPath, relativePath) : vaultPath;
  if (!fs.existsSync(folderPath)) return [];

  return fs.readdirSync(folderPath, { withFileTypes: true })
    .map(e => e.isDirectory() ? `📁 ${e.name}` : `📄 ${e.name}`)
    .sort();
}

export function getAbsolutePath(relativePath: string): string {
  return path.join(vaultPath, relativePath);
}

// ─── Suche ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  file: string;
  line: string;
}

export function searchVault(query: string, limitTo?: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const searchRoot = limitTo
    ? path.join(vaultPath, "Projekte", limitTo)
    : vaultPath;

  function searchDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(full);
      } else if (entry.name.endsWith(".md")) {
        const lines = fs.readFileSync(full, "utf-8").split("\n");
        for (const line of lines) {
          if (line.toLowerCase().includes(lowerQuery) && line.trim()) {
            results.push({ file: path.relative(vaultPath, full), line: line.trim().slice(0, 100) });
            break;
          }
        }
      }
    }
  }

  searchDir(searchRoot);
  return results.slice(0, 10);
}

// ─── Agent Workspaces ────────────────────────────────────────────────────────

export function getAgentPath(agentName: string): string {
  return path.join(vaultPath, "Agents", agentName);
}

// Token-Limits (wie OpenClaw: 20k/Datei, 150k gesamt)
const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 150_000;

// Grobe Token-Schätzung: ~4 Zeichen pro Token (Standard für europäische Sprachen)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateFile(content: string, filename: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  const removed = content.length - MAX_FILE_CHARS;
  return content.slice(0, MAX_FILE_CHARS) + `\n\n[… ${filename} gekürzt – ${removed} Zeichen entfernt]`;
}

// mode "full"    = Main Agent: alle Dateien + Tageslog
// mode "minimal" = Sub-Agent:  nur IDENTITY + SOUL (schneller, fokussierter)
export function loadAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): string {
  const agentPath = getAgentPath(agentName);
  let context = "";
  let totalChars = 0;

  function addFile(filepath: string, label: string): void {
    if (!fs.existsSync(filepath)) return;
    const raw = fs.readFileSync(filepath, "utf-8").trim();
    if (!raw) return;
    const content = truncateFile(raw, label);
    const block = `\n\n---\n${content}`;
    if (totalChars + block.length > MAX_TOTAL_CHARS) {
      console.warn(`[context] Budget erschöpft – ${label} nicht geladen`);
      return;
    }
    context += block;
    totalChars += block.length;
  }

  // IDENTITY.md immer zuerst (in beiden Modi)
  addFile(path.join(agentPath, "IDENTITY.md"), "IDENTITY.md");
  addFile(path.join(agentPath, "SOUL.md"), "SOUL.md");

  if (mode === "full") {
    addFile(path.join(agentPath, "USER.md"), "USER.md");
    addFile(path.join(agentPath, "AGENTS.md"), "AGENTS.md");
    addFile(path.join(agentPath, "MEMORY.md"), "MEMORY.md");

    // Heutiges Memory-Log
    const today = new Date().toISOString().slice(0, 10);
    addFile(path.join(agentPath, "memory", `${today}.md`), "Tageslog");
  }

  return context.trim();
}

export function appendAgentConversation(agentName: string, userMsg: string, botReply: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const memDir = path.join(getAgentPath(agentName), "memory");
  const filepath = path.join(memDir, `${today}.md`);
  ensureDir(memDir);

  const now = new Date();
  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("de-AT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, `# Log – ${dateStr}\n\n`, "utf-8");
  }

  fs.appendFileSync(filepath, `## ${time}\n**User:** ${userMsg}\n**${agentName}:** ${botReply}\n\n`, "utf-8");
}

export function loadAgentHistory(agentName: string, limit = 10): ConversationEntry[] {
  const results: ConversationEntry[] = [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const date of [yesterday, today]) {
    const iso = date.toISOString().slice(0, 10);
    const filepath = path.join(getAgentPath(agentName), "memory", `${iso}.md`);
    if (!fs.existsSync(filepath)) continue;

    const content = fs.readFileSync(filepath, "utf-8");
    const blocks = content.split(/^## \d{2}:\d{2}/m).slice(1);

    for (const block of blocks) {
      const userMatch = block.match(/\*\*User:\*\* (.+)/);
      const botMatch = block.match(/\*\*[^*]+:\*\* ([\s\S]+?)(?=\n\n|\n##|$)/);
      if (userMatch && botMatch) {
        results.push({ user: userMatch[1].trim(), assistant: botMatch[1].trim() });
      }
    }
  }

  return results.slice(-limit);
}

export function createAgentWorkspace(agentName: string, soul: string, agentsMd = "", userMd = ""): string {
  const agentPath = getAgentPath(agentName);
  ensureDir(path.join(agentPath, "memory"));

  const userDefault = `# User\n\nJulius Sima – Architekt, Wien.\nSprache: Deutsch. Kurze, direkte Antworten bevorzugt.\n`;
  const agentsDefault = `# ${agentName} – Sub-Agents\n\nKeine Sub-Agents konfiguriert.\n`;

  const files: Record<string, string> = {
    "IDENTITY.md": `🤖 ${agentName}`,
    "SOUL.md": soul,
    "AGENTS.md": agentsMd || agentsDefault,
    "USER.md": userMd || userDefault,
    "MEMORY.md": `# Memory – ${agentName}\n\nNoch keine dauerhaften Erkenntnisse.\n`,
  };

  for (const [filename, content] of Object.entries(files)) {
    const fp = path.join(agentPath, filename);
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, content, "utf-8");
  }

  return agentPath;
}

// Gibt eine Auflistung aller Workspace-Dateien mit Größen zurück (für /kontext)
export interface WorkspaceFileInfo {
  name: string;
  rawChars: number;
  injectedChars: number; // nach Truncation
  tokens: number;
  truncated: boolean;
  loaded: boolean;       // false wenn Budget erschöpft
}

export function inspectAgentWorkspace(agentName: string, mode: "full" | "minimal" = "full"): WorkspaceFileInfo[] {
  const agentPath = getAgentPath(agentName);
  const today = new Date().toISOString().slice(0, 10);

  const candidates: { name: string; filepath: string }[] = [
    { name: "IDENTITY.md", filepath: path.join(agentPath, "IDENTITY.md") },
    { name: "SOUL.md",     filepath: path.join(agentPath, "SOUL.md") },
    ...(mode === "full" ? [
      { name: "USER.md",    filepath: path.join(agentPath, "USER.md") },
      { name: "AGENTS.md",  filepath: path.join(agentPath, "AGENTS.md") },
      { name: "MEMORY.md",  filepath: path.join(agentPath, "MEMORY.md") },
      { name: "Tageslog",   filepath: path.join(agentPath, "memory", `${today}.md`) },
    ] : []),
  ];

  const result: WorkspaceFileInfo[] = [];
  let totalChars = 0;

  for (const { name, filepath } of candidates) {
    if (!fs.existsSync(filepath)) continue;
    const raw = fs.readFileSync(filepath, "utf-8").trim();
    if (!raw) continue;

    const injected = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
    const block = `\n\n---\n${injected}`;
    const loaded = totalChars + block.length <= MAX_TOTAL_CHARS;

    result.push({
      name,
      rawChars: raw.length,
      injectedChars: loaded ? injected.length : 0,
      tokens: loaded ? estimateTokens(injected) : 0,
      truncated: raw.length > MAX_FILE_CHARS,
      loaded,
    });

    if (loaded) totalChars += block.length;
  }

  return result;
}

// ─── Compaction ──────────────────────────────────────────────────────────────
// Wenn der Tages-Log zu groß wird, werden alte Einträge durch eine Zusammenfassung
// ersetzt — die letzten 5 Einträge bleiben immer erhalten

const COMPACT_THRESHOLD = 8_000; // Zeichen ab wann komprimiert wird
const KEEP_RECENT = 5;           // Letzte N Einträge nie anfassen

export function shouldCompact(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), "memory", `${today}.md`);
  if (!fs.existsSync(filepath)) return false;
  return fs.statSync(filepath).size >= COMPACT_THRESHOLD;
}

// Gibt die alten Einträge zurück die komprimiert werden sollen
// (alles außer die letzten KEEP_RECENT — die bleiben unberührt)
export function getLogForCompaction(agentName: string): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), "memory", `${today}.md`);
  if (!fs.existsSync(filepath)) return null;

  const content = fs.readFileSync(filepath, "utf-8");
  const entries = content.match(/## \d{2}:\d{2}\n[\s\S]*?(?=\n## \d{2}:\d{2}|$)/g) ?? [];
  if (entries.length <= KEEP_RECENT) return null;

  return entries.slice(0, -KEEP_RECENT).join("\n");
}

// Schreibt den komprimierten Log zurück — alte Einträge → Zusammenfassung
export function writeCompactedLog(agentName: string, summary: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), "memory", `${today}.md`);
  if (!fs.existsSync(filepath)) return;

  const content = fs.readFileSync(filepath, "utf-8");
  const header = content.match(/^(# .+\n\n)/)?.[1] ?? "";
  const entries = content.match(/## \d{2}:\d{2}\n[\s\S]*?(?=\n## \d{2}:\d{2}|$)/g) ?? [];
  if (entries.length <= KEEP_RECENT) return;

  const toKeep = entries.slice(-KEEP_RECENT);
  const time = new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });

  fs.writeFileSync(
    filepath,
    `${header}## Zusammenfassung (${time})\n${summary}\n\n${toKeep.join("\n")}`,
    "utf-8"
  );
}

// Schreibt einen dauerhaften Eintrag in die MEMORY.md des Agenten
export function appendAgentMemory(agentName: string, entry: string): void {
  const filepath = path.join(getAgentPath(agentName), "MEMORY.md");
  ensureDir(path.dirname(filepath));

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, `# Memory – ${agentName}\n\n`, "utf-8");
  }

  const date = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  fs.appendFileSync(filepath, `- ${date}: ${entry}\n`, "utf-8");
}

// Löscht den heutigen Conversation-Log eines Agenten (für /neu)
export function clearAgentToday(agentName: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const filepath = path.join(getAgentPath(agentName), "memory", `${today}.md`);
  if (!fs.existsSync(filepath)) return false;
  fs.unlinkSync(filepath);
  return true;
}

export function listAgents(): string[] {
  const agentsRoot = path.join(vaultPath, "Agents");
  if (!fs.existsSync(agentsRoot)) return [];
  return fs.readdirSync(agentsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

// ─── Gesprächsgedächtnis (legacy – wird durch Agent-Memory ersetzt) ──────────

function gespraechFilePath(date: Date = new Date()): string {
  const iso = date.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(vaultPath, "Gespräche", `${iso}.md`);
}

export function appendConversation(userMsg: string, botReply: string): void {
  const filepath = gespraechFilePath();
  ensureDir(path.dirname(filepath));

  const now = new Date();
  const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  const dateStr = now.toLocaleDateString("de-AT", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, `# Gespräch ${dateStr}\n\n`, "utf-8");
  }

  const entry = `## ${time}\n**Du:** ${userMsg}\n**Bau-OS:** ${botReply}\n\n`;
  fs.appendFileSync(filepath, entry, "utf-8");
}

export interface ConversationEntry {
  user: string;
  assistant: string;
}

export function loadRecentConversation(limit = 10): ConversationEntry[] {
  const results: ConversationEntry[] = [];

  // Heute + gestern laden (falls Gespräch über Mitternacht geht)
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const files = [yesterday, today]
    .map(d => gespraechFilePath(d))
    .filter(f => fs.existsSync(f));

  for (const filepath of files) {
    const content = fs.readFileSync(filepath, "utf-8");
    const blocks = content.split(/^## \d{2}:\d{2}/m).slice(1);

    for (const block of blocks) {
      const userMatch = block.match(/\*\*Du:\*\* (.+)/);
      const botMatch = block.match(/\*\*Bau-OS:\*\* ([\s\S]+?)(?=\n\n|$)/);
      if (userMatch && botMatch) {
        results.push({
          user: userMatch[1].trim(),
          assistant: botMatch[1].trim(),
        });
      }
    }
  }

  return results.slice(-limit);
}

// ─── System ──────────────────────────────────────────────────────────────────

export function vaultExists(): boolean {
  return fs.existsSync(vaultPath);
}

export function getVaultPath(): string {
  return vaultPath;
}
