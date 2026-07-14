// ============================================================
// PATIO — Bautagebuch-Repository (DB-Backend)
// ============================================================
// Migration 011 setzt die Tabelle, dieser Adapter implementiert das
// BautagebuchRepository-Interface aus types.ts.
//
// Validation-Strategie (parallel zu termine):
//   - Datum-Format YYYY-MM-DD wird hier vor dem INSERT geprueft.
//     Falsche Formate kommen als String-Returnwert (wie save() bei
//     terminRepo) zurueck, nicht als Exception.
//   - weather wird nur "leise" durchgereicht — der CHECK-Constraint in
//     der DB faengt ungueltige Werte. Falls die DB einen Fehler wirft,
//     wird er als string zurueckgegeben.
// ============================================================

import { getDb } from "../db/client.js";
import type { BautagebuchEntry, BautagebuchRepository, BautagebuchUpsertInput } from "./types.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function rowToEntry(row: Record<string, unknown>): BautagebuchEntry {
  // entry_date kommt aus Postgres als Date-Objekt (postgres.js setzt
  // automatisch parseDate=true). Wir wollen aber YYYY-MM-DD-String fuer
  // konsistente Vergleiche im Frontend.
  const dateRaw = row.entry_date;
  const dateStr = dateRaw instanceof Date ? dateRaw.toISOString().slice(0, 10) : String(dateRaw).slice(0, 10);

  // personnel kommt als JSONB → wird von postgres.js direkt zu Object/Array
  // geparst. Defensiv: wir akzeptieren auch Strings (falls die Pipeline mal
  // anders konfiguriert ist).
  let personnel = row.personnel;
  if (typeof personnel === "string") {
    try {
      personnel = JSON.parse(personnel);
    } catch {
      personnel = [];
    }
  }

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : null,
    date: dateStr,
    weather: row.weather ? (String(row.weather) as BautagebuchEntry["weather"]) : null,
    temperatureMin:
      row.temperature_min === null || row.temperature_min === undefined ? null : Number(row.temperature_min),
    temperatureMax:
      row.temperature_max === null || row.temperature_max === undefined ? null : Number(row.temperature_max),
    personnel: Array.isArray(personnel) ? (personnel as BautagebuchEntry["personnel"]) : [],
    machines: row.machines ? String(row.machines) : null,
    activities: row.activities ? String(row.activities) : null,
    incidents: row.incidents ? String(row.incidents) : null,
    createdById: row.created_by ? String(row.created_by) : null,
    createdByUsername: row.created_by_username ? String(row.created_by_username) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

const SELECT = `
  SELECT b.*,
         p.name AS project_name,
         u.username AS created_by_username
    FROM bautagebuch b
    LEFT JOIN projects p ON p.id = b.project_id
    LEFT JOIN users u ON u.id = b.created_by
`;

export const dbBautagebuch: BautagebuchRepository = {
  async list(projectId, limit = 30) {
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE b.project_id = $1 ORDER BY b.entry_date DESC LIMIT $2`, [
      projectId,
      limit,
    ]);
    return rows.map((r) => rowToEntry(r as Record<string, unknown>));
  },

  async get(projectId, date) {
    if (!ISO_DATE.test(date)) return null;
    const db = getDb();
    const rows = await db.unsafe(`${SELECT} WHERE b.project_id = $1 AND b.entry_date = $2 LIMIT 1`, [projectId, date]);
    return rows[0] ? rowToEntry(rows[0] as Record<string, unknown>) : null;
  },

  async upsert(projectId, date, patch, createdById = null) {
    if (!ISO_DATE.test(date)) return "Datum muss im Format YYYY-MM-DD sein";

    // Konsistenz: temperature_min darf nicht > max sein.
    if (
      typeof patch.temperatureMin === "number" &&
      typeof patch.temperatureMax === "number" &&
      patch.temperatureMin > patch.temperatureMax
    ) {
      return "Temperatur Min darf nicht groesser als Max sein";
    }

    const db = getDb();

    // Vorhandenen Eintrag laden (fuer partial-update-Semantik).
    const existing = await this.get(projectId, date);

    // Personnel-Eintraege koennen jeweils eine memberId tragen — die
    // pruefen wir best-effort gegen team_members. Kein harter Fehler bei
    // ungueltigen IDs (nur Filter), damit der Eintrag nicht komplett ver-
    // weigert wird, wenn nur eine ID Müll ist.
    let personnel = patch.personnel ?? existing?.personnel ?? [];
    if (Array.isArray(personnel) && personnel.length > 0) {
      const memberIds = personnel.map((p) => p.memberId).filter(Boolean) as string[];
      if (memberIds.length > 0) {
        const valid = await db`SELECT id FROM team_members WHERE id = ANY(${memberIds})`;
        const validSet = new Set(valid.map((r) => String(r.id)));
        personnel = personnel.map((p) => (p.memberId && !validSet.has(p.memberId) ? { ...p, memberId: null } : p));
      }
    }

    // postgres.js akzeptiert keine `undefined`-Werte in der Template-Substitution.
    // Wir koerzen alles strikt auf nullable strings/numbers.
    const weather: string | null = "weather" in patch ? (patch.weather ?? null) : (existing?.weather ?? null);
    const tMin: number | null =
      "temperatureMin" in patch ? (patch.temperatureMin ?? null) : (existing?.temperatureMin ?? null);
    const tMax: number | null =
      "temperatureMax" in patch ? (patch.temperatureMax ?? null) : (existing?.temperatureMax ?? null);
    const machines: string | null = "machines" in patch ? (patch.machines ?? null) : (existing?.machines ?? null);
    const activities: string | null =
      "activities" in patch ? (patch.activities ?? null) : (existing?.activities ?? null);
    const incidents: string | null = "incidents" in patch ? (patch.incidents ?? null) : (existing?.incidents ?? null);

    // JSONB ueber String-Cast einfuegen — dasselbe Pattern wie in db-team.ts
    // (siehe appendLog dort). db.json() haette einen Object-Index erfordert,
    // wir haben aber ein Array als Top-Level.
    const personnelJson = JSON.stringify(personnel);

    // ON CONFLICT-UPSERT: ein Roundtrip statt SELECT + INSERT/UPDATE.
    // created_by wird nur beim INSERT gesetzt — beim Update bleibt der
    // urspruengliche Ersteller stehen.
    try {
      await db`
        INSERT INTO bautagebuch (
          project_id, entry_date, weather, temperature_min, temperature_max,
          personnel, machines, activities, incidents, created_by
        ) VALUES (
          ${projectId}, ${date}, ${weather}, ${tMin}, ${tMax},
          ${personnelJson}::jsonb, ${machines}, ${activities}, ${incidents}, ${createdById}
        )
        ON CONFLICT (project_id, entry_date) DO UPDATE SET
          weather = EXCLUDED.weather,
          temperature_min = EXCLUDED.temperature_min,
          temperature_max = EXCLUDED.temperature_max,
          personnel = EXCLUDED.personnel,
          machines = EXCLUDED.machines,
          activities = EXCLUDED.activities,
          incidents = EXCLUDED.incidents
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // CHECK-Constraint-Verletzung (z.B. weather='unbekannt')
      if (msg.toLowerCase().includes("check") || msg.toLowerCase().includes("violates")) {
        return `Ungueltige Eingabe: ${msg}`;
      }
      throw err;
    }

    const saved = await this.get(projectId, date);
    if (!saved) throw new Error("Bautagebuch-Eintrag nach UPSERT nicht lesbar");
    return saved;
  },

  async delete(projectId, date) {
    if (!ISO_DATE.test(date)) return false;
    const db = getDb();
    const result = await db`
      DELETE FROM bautagebuch
       WHERE project_id = ${projectId} AND entry_date = ${date}
    `;
    return result.count > 0;
  },

  async listRecent(visibleProjectIds, limit = 20) {
    const db = getDb();
    if (visibleProjectIds === "all") {
      const rows = await db.unsafe(`${SELECT} ORDER BY b.entry_date DESC, b.updated_at DESC LIMIT $1`, [limit]);
      return rows.map((r) => rowToEntry(r as Record<string, unknown>));
    }
    if (visibleProjectIds.length === 0) return [];
    const rows = await db.unsafe(
      `${SELECT} WHERE b.project_id = ANY($1::uuid[]) ORDER BY b.entry_date DESC, b.updated_at DESC LIMIT $2`,
      [visibleProjectIds, limit],
    );
    return rows.map((r) => rowToEntry(r as Record<string, unknown>));
  },
};
