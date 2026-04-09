import fs from "fs";
import path from "path";
import { vaultPath, ensureDir } from "./helpers.js";

function safePath(relativePath: string): string | null {
  const resolved = path.resolve(vaultPath, relativePath);
  if (!resolved.startsWith(vaultPath)) return null;
  return resolved;
}

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

export function listFolder(relativePath = ""): string[] {
  const folderPath = relativePath ? safePath(relativePath) : vaultPath;
  if (!folderPath || !fs.existsSync(folderPath)) return [];

  try {
    return fs.readdirSync(folderPath, { withFileTypes: true })
      .map(e => e.isDirectory() ? `\u{1F4C1} ${e.name}` : `\u{1F4C4} ${e.name}`)
      .sort();
  } catch {
    return [];
  }
}
