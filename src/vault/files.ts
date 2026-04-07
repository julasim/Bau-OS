import fs from "fs";
import path from "path";
import { vaultPath, ensureDir } from "./helpers.js";

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

export function listFolder(relativePath = ""): string[] {
  const folderPath = relativePath ? path.join(vaultPath, relativePath) : vaultPath;
  if (!fs.existsSync(folderPath)) return [];

  return fs.readdirSync(folderPath, { withFileTypes: true })
    .map(e => e.isDirectory() ? `\u{1F4C1} ${e.name}` : `\u{1F4C4} ${e.name}`)
    .sort();
}
