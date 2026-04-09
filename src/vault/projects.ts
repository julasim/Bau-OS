import fs from "fs";
import path from "path";
import { vaultPath } from "./helpers.js";
import { listTasks } from "./tasks.js";
import { listTermine } from "./termine.js";

export interface ProjectInfo {
  name: string;
  notes: number;
  openTasks: number;
  termine: number;
}

export function listProjects(): string[] {
  const projektePath = path.join(vaultPath, "Projekte");
  if (!fs.existsSync(projektePath)) return [];

  return fs.readdirSync(projektePath, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

export function getProjectInfo(name: string): ProjectInfo | null {
  const projectPath = path.join(vaultPath, "Projekte", name);
  if (!fs.existsSync(projectPath)) return null;

  const openTasks = listTasks(name).length;
  const termine = listTermine(name).length;
  const notesDir = path.join(projectPath, "Notizen");
  const noteCount = fs.existsSync(notesDir)
    ? fs.readdirSync(notesDir).filter(f => f.endsWith(".md")).length
    : 0;

  return { name, notes: noteCount, openTasks, termine };
}

export function listProjectNotes(name: string): string[] {
  const notesDir = path.join(vaultPath, "Projekte", name, "Notizen");
  if (!fs.existsSync(notesDir)) return [];

  return fs.readdirSync(notesDir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .reverse()
    .map(f => f.replace(".md", ""));
}

export function readProjectNote(project: string, noteName: string): string | null {
  const filepath = path.join(vaultPath, "Projekte", project, "Notizen", noteName + ".md");
  if (!fs.existsSync(filepath)) return null;
  return fs.readFileSync(filepath, "utf-8");
}
