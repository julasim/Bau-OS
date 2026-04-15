import fs from "fs";
import path from "path";
import { workspacePath, ensureDir, atomicWriteSync, frontmatter } from "./helpers.js";
import { listTasks } from "./tasks.js";
import { listTermine } from "./termine.js";

export interface ProjectInfo {
  name: string;
  notes: number;
  openTasks: number;
  termine: number;
}

function safeProjectName(name: string): boolean {
  // Unicode-Buchstaben (\p{L}: ae oe ue ss e a, kyrillisch, griechisch ...),
  // Ziffern, Leerzeichen, "-", "_", "." sind erlaubt.
  return /^[\p{L}\p{N}_\-. ]+$/u.test(name) && !name.includes("..");
}

/**
 * Legt ein neues Projekt im Vault an.
 * Struktur: Projekte/{name}/ mit Notizen/-Unterordner und README.md.
 * Idempotent: wenn der Ordner schon existiert, kommt false zurueck.
 */
export function createProject(name: string, description?: string | null): boolean {
  if (!safeProjectName(name)) return false;
  const projectPath = path.join(workspacePath, "Projekte", name);
  if (fs.existsSync(projectPath)) return false;

  try {
    ensureDir(projectPath);
    ensureDir(path.join(projectPath, "Notizen"));
    const readme = path.join(projectPath, "README.md");
    const body = description
      ? `${frontmatter("system")}# ${name}\n\n${description}\n`
      : `${frontmatter("system")}# ${name}\n`;
    atomicWriteSync(readme, body);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loescht den Vault-Ordner eines Projekts komplett (inkl. aller Notizen,
 * Aufgaben etc. die darin liegen). Idempotent: wenn der Ordner schon weg
 * ist, gibt true zurueck. false nur bei ungueltigem Namen oder FS-Fehlern.
 */
export function deleteProject(name: string): boolean {
  if (!safeProjectName(name)) return false;
  const projectPath = path.join(workspacePath, "Projekte", name);
  if (!fs.existsSync(projectPath)) return true; // schon weg — ok
  try {
    fs.rmSync(projectPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function listProjects(): string[] {
  const projektePath = path.join(workspacePath, "Projekte");
  if (!fs.existsSync(projektePath)) return [];

  try {
    return fs
      .readdirSync(projektePath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function getProjectInfo(name: string): ProjectInfo | null {
  if (!safeProjectName(name)) return null;
  const projectPath = path.join(workspacePath, "Projekte", name);
  if (!fs.existsSync(projectPath)) return null;

  const openTasks = listTasks(name).filter((t) => t.status !== "done").length;
  const termine = listTermine(name).length;
  const notesDir = path.join(projectPath, "Notizen");
  let noteCount = 0;
  try {
    if (fs.existsSync(notesDir)) {
      noteCount = fs.readdirSync(notesDir).filter((f) => f.endsWith(".md")).length;
    }
  } catch {
    /* ignore */
  }

  return { name, notes: noteCount, openTasks, termine };
}

export function listProjectNotes(name: string): string[] {
  if (!safeProjectName(name)) return [];
  const notesDir = path.join(workspacePath, "Projekte", name, "Notizen");
  if (!fs.existsSync(notesDir)) return [];

  try {
    return fs
      .readdirSync(notesDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .map((f) => f.replace(".md", ""));
  } catch {
    return [];
  }
}

export function readProjectNote(project: string, noteName: string): string | null {
  if (!safeProjectName(project)) return null;
  const filepath = path.join(workspacePath, "Projekte", project, "Notizen", noteName + ".md");
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}
