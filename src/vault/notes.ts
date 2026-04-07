import fs from "fs";
import path from "path";
import { VAULT_INBOX, LOCALE } from "../config.js";
import { vaultPath, timestampFilename, frontmatter, ensureDir, resolveNotePath } from "./helpers.js";

export function saveNote(content: string, project?: string): string {
  const folder = project
    ? path.join(vaultPath, "Projekte", project, "Notizen")
    : path.join(vaultPath, VAULT_INBOX);

  ensureDir(folder);

  const filename = timestampFilename() + ".md";
  const filepath = path.join(folder, filename);
  fs.writeFileSync(filepath, frontmatter() + content + "\n", "utf-8");
  return filepath;
}

export function listNotes(limit = 10): string[] {
  const inboxPath = path.join(vaultPath, VAULT_INBOX);
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
  const time = now.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
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
