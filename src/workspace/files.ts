import fs from "fs";
import path from "path";
import { workspacePath, ensureDir, safePath } from "./helpers.js";
import { WORKSPACE_AGENTS_DIR, WORKSPACE_LOGS_DIR } from "../config.js";

export function readFile(relativePath: string): string | null {
  const filepath = safePath(relativePath);
  if (!filepath || !fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}

export function createFile(relativePath: string, content: string): string {
  const filepath = safePath(relativePath);
  if (!filepath) return "(Pfad ungueltig)";
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, content, "utf-8");
  return filepath;
}

export interface FolderEntry {
  name: string;
  type: "folder" | "file";
  size: number;
  modified: string;
  extension: string;
}

// System-Ordner/-Dateien die im Dateibrowser ausgeblendet werden (nur Root-Ebene)
const HIDDEN_ROOT_ENTRIES = new Set([
  WORKSPACE_AGENTS_DIR, // "Agents" — Bot-Agent Workspace
  WORKSPACE_LOGS_DIR, // "MEMORY_LOGS"
  "Daily", // Daily Notes (System)
  "Templates", // Vorlagen (System)
]);

export function listFolder(relativePath = ""): FolderEntry[] {
  const folderPath = relativePath ? safePath(relativePath) : workspacePath;
  if (!folderPath || !fs.existsSync(folderPath)) return [];
  const isRoot = !relativePath;

  try {
    return fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith("."))
      .filter((e) => !isRoot || !HIDDEN_ROOT_ENTRIES.has(e.name))
      .map((e) => {
        const fullPath = path.join(folderPath, e.name);
        let size = 0;
        let modified = "";
        try {
          const stat = fs.statSync(fullPath);
          size = stat.size;
          modified = stat.mtime.toISOString();
        } catch {
          /* stat failed */
        }
        const ext = e.isDirectory() ? "" : path.extname(e.name).slice(1).toLowerCase();
        return {
          name: e.name,
          type: (e.isDirectory() ? "folder" : "file") as "folder" | "file",
          size,
          modified,
          extension: ext,
        };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  } catch {
    return [];
  }
}
