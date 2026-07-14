// ============================================================
// PATIO — Projekt-Module-Konfiguration (Phase 6e)
// ============================================================
// Singleton-Tabelle fuer globale Defaults + Per-Projekt-Override
// in projects.modules_override (JSONB).
//
// Effektive-Sicht-Strategie: globale Defaults werden mit dem Override
// gemerget — der User kann pro Projekt einzelne Module umkippen, aber
// "vergessene" Module fallen auf Default zurueck.
// ============================================================

import { getDb } from "../db/client.js";
import { DB_ENABLED } from "../config.js";

export interface ProjectModuleFlags {
  stammdaten: boolean;
  notes: boolean;
  tasks: boolean;
  termine: boolean;
  files: boolean;
  team: boolean;
  bautagebuch: boolean;
  meetings: boolean;
  time_entries: boolean;
}

const DEFAULT_FLAGS: ProjectModuleFlags = {
  stammdaten: true,
  notes: true,
  tasks: true,
  termine: true,
  files: true,
  team: true,
  bautagebuch: true,
  meetings: true,
  time_entries: true,
};

export const MODULE_KEYS: (keyof ProjectModuleFlags)[] = [
  "stammdaten",
  "notes",
  "tasks",
  "termine",
  "files",
  "team",
  "bautagebuch",
  "meetings",
  "time_entries",
];

function normalize(input: unknown): ProjectModuleFlags {
  const raw = (input ?? {}) as Record<string, unknown>;
  const out: ProjectModuleFlags = { ...DEFAULT_FLAGS };
  for (const key of MODULE_KEYS) {
    if (key in raw) out[key] = raw[key] === true;
  }
  return out;
}

/** Globale Defaults aus dem Singleton lesen. */
export async function getGlobalModules(): Promise<ProjectModuleFlags> {
  if (!DB_ENABLED) return DEFAULT_FLAGS;
  const db = getDb();
  const [row] = await db`SELECT modules FROM project_module_config WHERE id = 1`;
  return row ? normalize(row.modules) : DEFAULT_FLAGS;
}

/** Globale Defaults setzen. Patch wird mit existing gemerged — fehlende
 *  Keys bleiben unveraendert. */
export async function updateGlobalModules(patch: Partial<ProjectModuleFlags>): Promise<ProjectModuleFlags> {
  if (!DB_ENABLED) return DEFAULT_FLAGS;
  const db = getDb();
  const current = await getGlobalModules();
  const next = { ...current, ...patch };
  // postgres.js braucht JSONB als JSON-string ueber db.json() — direkter
  // Object-Pass scheitert am TypeScript-Overload.
  await db`UPDATE project_module_config SET modules = ${db.json(next as never)} WHERE id = 1`;
  return next;
}

/** Liefert die effektive Modules-Sicht fuer ein Projekt:
 *  global default + override. Wenn override NULL → reine global. */
export async function getProjectEffectiveModules(projectName: string): Promise<{
  effective: ProjectModuleFlags;
  hasOverride: boolean;
  override: Partial<ProjectModuleFlags> | null;
  global: ProjectModuleFlags;
}> {
  if (!DB_ENABLED) {
    return { effective: DEFAULT_FLAGS, hasOverride: false, override: null, global: DEFAULT_FLAGS };
  }
  const db = getDb();
  const global = await getGlobalModules();
  const [row] = await db`
    SELECT modules_override FROM projects WHERE name = ${projectName} LIMIT 1
  `;
  const override = row?.modules_override ? (row.modules_override as Record<string, unknown>) : null;
  if (!override) {
    return { effective: global, hasOverride: false, override: null, global };
  }
  // Effective = global + override (override gewinnt).
  const effective: ProjectModuleFlags = { ...global };
  for (const key of MODULE_KEYS) {
    if (key in override) effective[key] = override[key] === true;
  }
  return {
    effective,
    hasOverride: true,
    override: override as Partial<ProjectModuleFlags>,
    global,
  };
}

/** Setzt den Per-Projekt-Override. Wenn patch null → Override loeschen. */
export async function setProjectModulesOverride(
  projectName: string,
  override: Partial<ProjectModuleFlags> | null,
): Promise<void> {
  if (!DB_ENABLED) return;
  const db = getDb();
  if (override === null) {
    await db`UPDATE projects SET modules_override = NULL WHERE name = ${projectName}`;
    return;
  }
  // Merge mit existing override: User toggelt EIN Modul, andere bleiben.
  const [row] = await db`SELECT modules_override FROM projects WHERE name = ${projectName} LIMIT 1`;
  const existing = (row?.modules_override ?? {}) as Record<string, unknown>;
  const next = { ...existing, ...override };
  await db`UPDATE projects SET modules_override = ${db.json(next as never)} WHERE name = ${projectName}`;
}
