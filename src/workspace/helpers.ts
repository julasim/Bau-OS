import fs from "fs";
import path from "path";
import { WORKSPACE_PATH } from "../config.js";

export const workspacePath = WORKSPACE_PATH;

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Atomic write: schreibt in .tmp, dann rename — verhindert Datenverlust bei Crash mid-write */
export function atomicWriteSync(filepath: string, data: string): void {
  const tmp = filepath + ".tmp";
  try {
    fs.writeFileSync(tmp, data, "utf-8");
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp existiert nicht — OK */
    }
    throw err;
  }
}

/** Sicherer Pfad innerhalb des Vaults — blockiert Traversal und Symlinks */
export function safePath(relativePath: string): string | null {
  const resolved = path.resolve(workspacePath, relativePath);
  if (!resolved.startsWith(workspacePath + path.sep) && resolved !== workspacePath) return null;
  try {
    if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) return null;
  } catch {
    /* nicht existent = OK */
  }
  return resolved;
}
