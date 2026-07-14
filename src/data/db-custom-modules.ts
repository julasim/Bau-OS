// ============================================================
// PATIO — Custom Project Modules Repo
// ============================================================
// CRUD fuer nutzerdefinierte Projekt-Modul-Kategorien
// (custom_project_modules). Diese ergaenzen die 9 built-in
// Module um eigene Kategorien wie "Gewährleistung", "Mängel" etc.
// ============================================================

import crypto from "crypto";
import { getDb } from "../db/client.js";
import { DB_ENABLED } from "../config.js";

export interface CustomProjectModule {
  id: string;
  key: string;
  label: string;
  description: string | null;
  icon: string;
  enabledByDefault: boolean;
  sortOrder: number;
  createdAt: string;
}

function rowToCustomModule(row: Record<string, unknown>): CustomProjectModule {
  return {
    id: String(row.id),
    key: String(row.key),
    label: String(row.label),
    description: row.description ? String(row.description) : null,
    icon: String(row.icon ?? "folder"),
    enabledByDefault: row.enabled_by_default === true,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function listCustomModules(): Promise<CustomProjectModule[]> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = await db`SELECT * FROM custom_project_modules ORDER BY sort_order, label`;
  return rows.map(rowToCustomModule);
}

export async function createCustomModule(input: {
  key: string;
  label: string;
  description?: string | null;
  icon?: string;
  enabledByDefault?: boolean;
}): Promise<CustomProjectModule> {
  if (!DB_ENABLED) throw new Error("DB-Modus erforderlich");
  const db = getDb();
  const id = crypto.randomUUID();
  const [row] = await db`
    INSERT INTO custom_project_modules (id, key, label, description, icon, enabled_by_default)
    VALUES (
      ${id},
      ${input.key},
      ${input.label},
      ${input.description ?? null},
      ${input.icon ?? "folder"},
      ${input.enabledByDefault ?? true}
    )
    RETURNING *
  `;
  return rowToCustomModule(row);
}

export async function updateCustomModule(
  id: string,
  patch: {
    label?: string;
    description?: string | null;
    icon?: string;
    enabledByDefault?: boolean;
    sortOrder?: number;
  },
): Promise<CustomProjectModule | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [current] = await db`SELECT * FROM custom_project_modules WHERE id = ${id}`;
  if (!current) return null;

  const next = {
    label: "label" in patch ? patch.label : current.label,
    description: "description" in patch ? patch.description : current.description,
    icon: "icon" in patch ? patch.icon : current.icon,
    enabledByDefault: "enabledByDefault" in patch ? patch.enabledByDefault : current.enabled_by_default,
    sortOrder: "sortOrder" in patch ? patch.sortOrder : current.sort_order,
  };
  const [row] = await db`
    UPDATE custom_project_modules SET
      label              = ${next.label as string},
      description        = ${next.description as string | null},
      icon               = ${next.icon as string},
      enabled_by_default = ${next.enabledByDefault as boolean},
      sort_order         = ${next.sortOrder as number}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToCustomModule(row) : null;
}

export async function deleteCustomModule(id: string): Promise<boolean> {
  if (!DB_ENABLED) return false;
  const db = getDb();
  const result = await db`DELETE FROM custom_project_modules WHERE id = ${id}`;
  return result.count > 0;
}
