// ============================================================
// PATIO — Custom Template Variables Repo
// ============================================================
// CRUD fuer nutzerdefinierte Platzhalter (custom_template_variables).
// Diese ergaenzen die built-in {{Projekt}}, {{Datum}}, {{Firma}}
// Variablen um eigene Felder wie {{Bauleiter}}, {{Projektsteuerer}} etc.
// ============================================================

import crypto from "crypto";
import { getDb } from "../db/client.js";

export interface CustomVariable {
  id: string;
  name: string;
  description: string | null;
  value: string;
  createdAt: string;
  updatedAt: string;
}

function rowToCustomVariable(row: Record<string, unknown>): CustomVariable {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    value: String(row.value ?? ""),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function listCustomVariables(): Promise<CustomVariable[]> {
  const db = getDb();
  const rows = await db`SELECT * FROM custom_template_variables ORDER BY name`;
  return rows.map(rowToCustomVariable);
}

export async function createCustomVariable(input: {
  name: string;
  description?: string | null;
  value: string;
}): Promise<CustomVariable> {
  const db = getDb();
  const id = crypto.randomUUID();
  const [row] = await db`
    INSERT INTO custom_template_variables (id, name, description, value)
    VALUES (${id}, ${input.name}, ${input.description ?? null}, ${input.value})
    RETURNING *
  `;
  return rowToCustomVariable(row);
}

export async function updateCustomVariable(
  id: string,
  patch: { name?: string; description?: string | null; value?: string },
): Promise<CustomVariable | null> {
  const db = getDb();
  const [current] = await db`SELECT * FROM custom_template_variables WHERE id = ${id}`;
  if (!current) return null;

  const next = {
    name: "name" in patch ? patch.name : current.name,
    description: "description" in patch ? patch.description : current.description,
    value: "value" in patch ? patch.value : current.value,
  };
  const [row] = await db`
    UPDATE custom_template_variables SET
      name        = ${next.name as string},
      description = ${next.description as string | null},
      value       = ${next.value as string}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToCustomVariable(row) : null;
}

export async function deleteCustomVariable(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db`DELETE FROM custom_template_variables WHERE id = ${id}`;
  return result.count > 0;
}
