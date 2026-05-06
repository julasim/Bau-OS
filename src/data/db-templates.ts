// ============================================================
// Bau-OS — Vorlagen-Repository (Phase 6c)
// ============================================================
// CRUD fuer templates-Tabelle. Bietet zusaetzlich renderTemplate()
// fuer Variable-Substitution: {{Projekt}}, {{Datum}}, {{Bauherr}},
// {{Firma}}, {{User}} etc. werden gegen Live-Daten ersetzt.
//
// Render passiert serverseitig damit Frontend nichts ueber die
// Branding/Project-Datenstruktur wissen muss.
// ============================================================

import crypto from "crypto";
import { getDb } from "../db/client.js";
import { DB_ENABLED } from "../config.js";

export type TemplateKind = "note" | "meeting" | "bautagebuch";

export interface Template {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  body: string;
  isDefault: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateInput {
  kind: TemplateKind;
  name: string;
  description?: string | null;
  body: string;
  isDefault?: boolean;
}

export interface TemplateUpdate {
  name?: string;
  description?: string | null;
  body?: string;
  isDefault?: boolean;
}

function rowToTemplate(row: Record<string, unknown>): Template {
  return {
    id: String(row.id),
    kind: row.kind as TemplateKind,
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    body: String(row.body),
    isDefault: row.is_default === true,
    createdById: row.created_by_id ? String(row.created_by_id) : null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function listTemplates(kind?: TemplateKind): Promise<Template[]> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = kind
    ? await db`SELECT * FROM templates WHERE kind = ${kind} ORDER BY is_default DESC, name`
    : await db`SELECT * FROM templates ORDER BY kind, is_default DESC, name`;
  return rows.map(rowToTemplate);
}

export async function getTemplate(id: string): Promise<Template | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`SELECT * FROM templates WHERE id = ${id}`;
  return row ? rowToTemplate(row) : null;
}

export async function getDefaultTemplate(kind: TemplateKind): Promise<Template | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`SELECT * FROM templates WHERE kind = ${kind} AND is_default = true LIMIT 1`;
  return row ? rowToTemplate(row) : null;
}

export async function createTemplate(input: TemplateInput, createdById: string | null): Promise<Template> {
  if (!DB_ENABLED) throw new Error("DB-Modus erforderlich");
  const db = getDb();
  const id = crypto.randomUUID();

  // Wenn neuer Template als default markiert, andere defaults derselben kind
  // zuruecksetzen (Unique-Index erlaubt nur einen Default pro Kind).
  if (input.isDefault) {
    await db`UPDATE templates SET is_default = false WHERE kind = ${input.kind} AND is_default = true`;
  }
  const [row] = await db`
    INSERT INTO templates (id, kind, name, description, body, is_default, created_by_id)
    VALUES (
      ${id}, ${input.kind}, ${input.name}, ${input.description ?? null},
      ${input.body}, ${input.isDefault ?? false}, ${createdById}
    )
    RETURNING *
  `;
  return rowToTemplate(row);
}

export async function updateTemplate(id: string, patch: TemplateUpdate): Promise<Template | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [current] = await db`SELECT * FROM templates WHERE id = ${id}`;
  if (!current) return null;

  // Default-Toggle: wenn auf true gesetzt, andere zuruecksetzen.
  if (patch.isDefault === true) {
    await db`UPDATE templates SET is_default = false WHERE kind = ${current.kind} AND id <> ${id}`;
  }
  const next = {
    name: "name" in patch ? patch.name : current.name,
    description: "description" in patch ? patch.description : current.description,
    body: "body" in patch ? patch.body : current.body,
    isDefault: "isDefault" in patch ? patch.isDefault : current.is_default,
  };
  const [row] = await db`
    UPDATE templates SET
      name        = ${next.name as string},
      description = ${next.description as string | null},
      body        = ${next.body as string},
      is_default  = ${next.isDefault as boolean}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToTemplate(row) : null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  if (!DB_ENABLED) return false;
  const db = getDb();
  const result = await db`DELETE FROM templates WHERE id = ${id}`;
  return result.count > 0;
}

// ── Render: Placeholder-Substitution ─────────────────────────────────────────

export interface RenderContext {
  /** Projekt-Name fuer {{Projekt}}-Lookup. */
  project?: string | null;
  /** Override-Werte fuer den Standard-Lookup (z.B. wenn der Caller schon einen
   *  vollstaendigen Project-Eintrag hat und sich den DB-Roundtrip sparen will). */
  overrides?: Record<string, string>;
  /** Username des aktuellen Users — fuer {{User}}. */
  currentUserName?: string | null;
}

/** Liest Branding + Projekt-Stammdaten aus DB und baut die Variable-Map.
 *  Werte die nicht gefunden werden bleiben als leerer String. */
async function buildVariables(ctx: RenderContext): Promise<Record<string, string>> {
  const today = new Date();
  const datum = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const vars: Record<string, string> = {
    Datum: datum,
    Tag: datum,
    Heute: datum,
    User: ctx.currentUserName ?? "",
    Projekt: ctx.project ?? "",
  };

  if (DB_ENABLED) {
    const db = getDb();

    // Branding
    const [brand] = await db`
      SELECT company_name, address, phone, email, website FROM org_branding WHERE id = 1
    `;
    if (brand) {
      vars.Firma = brand.company_name ? String(brand.company_name) : "";
      vars.FirmenAdresse = brand.address ? String(brand.address) : "";
      vars.FirmenTelefon = brand.phone ? String(brand.phone) : "";
      vars.FirmenEmail = brand.email ? String(brand.email) : "";
      vars.FirmenWebsite = brand.website ? String(brand.website) : "";
    }

    // Projekt-Stammdaten + Bauherr-Name aus Join
    if (ctx.project) {
      const [proj] = await db`
        SELECT p.name, p.projektnummer, p.standort, p.projektart, p.nutzung, p.phase,
               tm.name as bauherr_name
          FROM projects p
          LEFT JOIN team_members tm ON tm.id = p.bauherr_id
         WHERE p.name = ${ctx.project} LIMIT 1
      `;
      if (proj) {
        vars.Projekt = String(proj.name);
        vars.Projektnummer = proj.projektnummer ? String(proj.projektnummer) : "";
        vars.Standort = proj.standort ? String(proj.standort) : "";
        vars.Ort = proj.standort ? String(proj.standort) : "";
        vars.Projektart = proj.projektart ? String(proj.projektart) : "";
        vars.Nutzung = proj.nutzung ? String(proj.nutzung) : "";
        vars.Phase = proj.phase ? String(proj.phase) : "";
        vars.Bauherr = proj.bauherr_name ? String(proj.bauherr_name) : "";
      }
    }
  }

  // Caller-Overrides haben Vorrang
  if (ctx.overrides) {
    for (const [k, v] of Object.entries(ctx.overrides)) {
      vars[k] = v;
    }
  }
  return vars;
}

/** Ersetzt {{Variable}} im Body durch die Map-Werte. Unbekannte Variablen
 *  bleiben unveraendert (damit der User sieht "ah, den Placeholder hab
 *  ich falsch geschrieben"). Whitespace innerhalb der Klammern wird
 *  toleriert: {{ Projekt }} == {{Projekt}}. */
export function applyTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (m, name: string) => {
    return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name]! : m;
  });
}

/** Convenience: laedt Template, baut Variables, rendert. */
export async function renderTemplate(
  id: string,
  ctx: RenderContext,
): Promise<{ template: Template; rendered: string } | null> {
  const template = await getTemplate(id);
  if (!template) return null;
  const vars = await buildVariables(ctx);
  return { template, rendered: applyTemplate(template.body, vars) };
}

/** Liste aller verfuegbaren Variablen — fuer "Verfuegbare Platzhalter"-
 *  Hilfe in der UI. */
export function listAvailableVariables(): { name: string; description: string }[] {
  return [
    { name: "Projekt", description: "Projekt-Name" },
    { name: "Projektnummer", description: "Aus Projekt-Stammdaten" },
    { name: "Standort", description: "Projekt-Standort (auch via Ort verfuegbar)" },
    { name: "Bauherr", description: "Verknuepftes Team-Mitglied" },
    { name: "Projektart", description: "Wohn/Gewerbe/etc." },
    { name: "Nutzung", description: "Aus Stammdaten" },
    { name: "Phase", description: "Aktuelle Projekt-Phase" },
    { name: "Datum", description: "Heute (TT.MM.JJJJ) — auch via Tag/Heute" },
    { name: "User", description: "Aktueller User (Anzeigename oder Username)" },
    { name: "Firma", description: "Firmenname aus Branding-Settings" },
    { name: "FirmenAdresse", description: "Aus Branding" },
    { name: "FirmenTelefon", description: "Aus Branding" },
    { name: "FirmenEmail", description: "Aus Branding" },
    { name: "FirmenWebsite", description: "Aus Branding" },
  ];
}
