import fs from "fs";
import path from "path";
import { vaultPath, ensureDir } from "./helpers.js";

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
