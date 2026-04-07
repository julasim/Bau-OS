import fs from "fs";
import path from "path";
import { vaultPath } from "./helpers.js";
import { listTasks } from "./tasks.js";
import { listTermine } from "./termine.js";

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
