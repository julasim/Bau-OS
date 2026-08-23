import fs from "fs";
import path from "path";
import { WORKSPACE_PATH } from "../config.js";

export const workspacePath = WORKSPACE_PATH;

// ── Was hier stand: ensureDir und atomicWriteSync ─────────────────────────
//
// Zwei Schreib-Helfer aus der Vault-Zeit. Seit dem Umbau zum Firmenserver
// schreibt die Anwendung nicht mehr ins Dateisystem — beide hatten keinen
// Aufrufer ausserhalb der Tests mehr.
//
// `atomicWriteSync` war gut gebaut (schreiben nach .tmp, dann umbenennen) und
// hatte drei eigene Pruefungen. Genau das macht solchen Code gefaehrlich: er
// liest sich wie ein benutzter Baustein. Wer ihn wieder braucht, holt ihn aus
// der Git-Historie.

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
