import fs from "fs";
import path from "path";
import crypto from "crypto";
import { vaultPath, ensureDir } from "./helpers.js";

export interface Termin {
  id: string;
  text: string;
  datum: string;
  uhrzeit: string | null;
  endzeit: string | null;
  location: string | null;
  assignees: string[];
  project: string | null;
  createdAt: string;
}

function termineFilePath(project?: string): string {
  if (project) {
    const dir = path.join(vaultPath, "Projekte", project);
    ensureDir(dir);
    return path.join(dir, "termine.json");
  }
  return path.join(process.cwd(), "data", "termine.json");
}

function legacyTerminePath(project?: string): string {
  return project
    ? path.join(vaultPath, "Projekte", project, "Termine.md")
    : path.join(vaultPath, "Termine.md");
}

function loadTermine(project?: string): Termin[] {
  const fp = termineFilePath(project);
  if (fs.existsSync(fp)) {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  }
  return migrateLegacy(project);
}

function saveTermine(termine: Termin[], project?: string): void {
  const fp = termineFilePath(project);
  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, JSON.stringify(termine, null, 2), "utf-8");
}

function migrateLegacy(project?: string): Termin[] {
  const mdPath = legacyTerminePath(project);
  if (!fs.existsSync(mdPath)) return [];

  const content = fs.readFileSync(mdPath, "utf-8");
  const termine: Termin[] = [];
  const now = new Date().toISOString();

  for (const line of content.split("\n")) {
    const match = line.match(/^- \[ \] (.+)$/);
    if (!match) continue;

    const parts = match[1].split("|").map(s => s.trim());
    const datum = parts[0] || "";
    let uhrzeit: string | null = null;
    let text = "";

    if (parts.length === 3) {
      uhrzeit = parts[1];
      text = parts[2];
    } else if (parts.length === 2) {
      text = parts[1];
    } else {
      text = parts[0];
    }

    termine.push({
      id: crypto.randomUUID().slice(0, 8),
      text,
      datum,
      uhrzeit,
      endzeit: null,
      location: null,
      assignees: [],
      project: project || null,
      createdAt: now,
    });
  }

  if (termine.length > 0) saveTermine(termine, project);
  return termine;
}

export function saveTermin(datum: string, text: string, uhrzeit?: string, project?: string): Termin {
  const termine = loadTermine(project);
  const now = new Date().toISOString();
  const termin: Termin = {
    id: crypto.randomUUID().slice(0, 8),
    text,
    datum,
    uhrzeit: uhrzeit || null,
    endzeit: null,
    location: null,
    assignees: [],
    project: project || null,
    createdAt: now,
  };
  termine.push(termin);
  saveTermine(termine, project);
  return termin;
}

export function listTermine(project?: string): Termin[] {
  return loadTermine(project);
}

export function getTermin(id: string, project?: string): Termin | null {
  return loadTermine(project).find(t => t.id === id) || null;
}

export function updateTermin(id: string, updates: Partial<Omit<Termin, "id" | "createdAt">>, project?: string): Termin | null {
  const termine = loadTermine(project);
  const idx = termine.findIndex(t => t.id === id);
  if (idx === -1) return null;

  termine[idx] = { ...termine[idx], ...updates };
  saveTermine(termine, project);
  return termine[idx];
}

export function deleteTermin(textOrId: string, project?: string): boolean {
  const termine = loadTermine(project);
  const filtered = termine.filter(t => t.id !== textOrId && !t.text.includes(textOrId));
  if (filtered.length === termine.length) return false;
  saveTermine(filtered, project);
  return true;
}
