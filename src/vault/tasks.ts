import fs from "fs";
import path from "path";
import { vaultPath, ensureDir } from "./helpers.js";

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
