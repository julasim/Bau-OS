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

// ─── System ──────────────────────────────────────────────────────────────────

export function vaultExists(): boolean {
  return fs.existsSync(vaultPath);
}

export function getVaultPath(): string {
  return vaultPath;
}
