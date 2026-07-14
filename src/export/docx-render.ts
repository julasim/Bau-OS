// ============================================================
// PATIO — Word-Export-Render-Pipeline (Phase 6d)
// ============================================================
// Lädt ein .docx-Template aus der DB, ersetzt {Tag}-Platzhalter
// mit Daten und gibt das Ergebnis als Buffer zurueck.
//
// Tag-Syntax (docxtemplater-Default):
//   {Variable}                — einfacher Wert
//   {#liste}…{/liste}         — Loop ueber Array
//   {?bedingung}…{/bedingung} — Conditional
//
// Verfuegbare Daten je nach Export-Kind:
//   - meeting:        siehe buildMeetingData()
//   - bautagebuch:    siehe buildBautagebuchData()
//   - time-entry:     siehe buildTimeEntryData()
//   - project-summary: siehe buildProjectSummaryData()
//
// Branding-Felder (Firma, FirmenAdresse, …) sind in jedem Export
// verfuegbar — werden in buildBaseData() global eingesammelt.
// ============================================================

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
// Expression-Parser fuer verschachtelte Tags wie {Meeting.Titel}, {Projekt.Bauherr}.
// Ohne diesen Parser interpretiert docxtemplater "Meeting.Titel" als FLACHEN
// Tag-Namen mit Punkt drin -- der Datenzugriff schlaegt fehl und der nullGetter
// liefert "" -> ALLE verschachtelten Tags landen leer im Word. Verifiziert per
// Debug-Log am 2026-06-01.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- expressions.js hat keine d.ts-Typen
import expressionParser from "docxtemplater/expressions.js";
import { getDb } from "../db/client.js";
import { DB_ENABLED } from "../config.js";
import {
  loadExportTemplateBlob,
  getDefaultExportTemplate,
  getExportTemplate,
  type ExportKind,
} from "../data/db-export-templates.js";
import { logError } from "../logger.js";

/** Wandelt einen beliebigen DB-Datumswert in TT.MM.JJJJ.
 *  postgres.js liefert DATE/TIMESTAMP als Date-Objekt; String(date) gibt
 *  dann die haessliche "Tue Apr 28 2026 ..."-Form. Mit toISOString().slice(0,10)
 *  bekommen wir zuverlaessig ein YYYY-MM-DD, das wir formatieren koennen. */
function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let iso: string;
  if (value instanceof Date) {
    iso = value.toISOString().slice(0, 10);
  } else {
    const s = String(value).split("T")[0]!;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      iso = s;
    } else {
      // Fallback: irgendwas Unbekanntes — versuchen via Date zu parsen.
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      iso = d.toISOString().slice(0, 10);
    }
  }
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export class DocxRenderError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "DocxRenderError";
  }
}

/** Basis-Daten die in JEDEM Export-Kind verfuegbar sind:
 *  Branding-Felder + Datum/Uhrzeit + User. */
async function buildBaseData(currentUserName: string | null): Promise<Record<string, unknown>> {
  const today = new Date();
  const datum = `${String(today.getDate()).padStart(2, "0")}.${String(today.getMonth() + 1).padStart(2, "0")}.${today.getFullYear()}`;
  const zeit = `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;
  const data: Record<string, unknown> = {
    Datum: datum,
    Heute: datum,
    Zeit: zeit,
    User: currentUserName ?? "",
    Firma: "",
    FirmenAdresse: "",
    FirmenTelefon: "",
    FirmenEmail: "",
    FirmenWebsite: "",
  };

  if (DB_ENABLED) {
    const db = getDb();
    const [b] = await db`SELECT company_name, address, phone, email, website FROM org_branding WHERE id = 1`;
    if (b) {
      data.Firma = b.company_name ? String(b.company_name) : "";
      data.FirmenAdresse = b.address ? String(b.address) : "";
      data.FirmenTelefon = b.phone ? String(b.phone) : "";
      data.FirmenEmail = b.email ? String(b.email) : "";
      data.FirmenWebsite = b.website ? String(b.website) : "";
    }
  }
  return data;
}

// ── Datenquellen pro Export-Kind ─────────────────────────────────────────────

async function buildMeetingData(meetingId: string): Promise<Record<string, unknown>> {
  if (!DB_ENABLED) return {};
  const db = getDb();
  const [m] = await db`
    SELECT m.*, p.name as project_name
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.id = ${meetingId} LIMIT 1
  `;
  if (!m) throw new DocxRenderError("Meeting nicht gefunden");

  // Attendees (gemappte Mitglieder + Externe-Freitext)
  const attendeeIds = Array.isArray(m.attendee_ids) ? (m.attendee_ids as string[]) : [];
  let attendeeRows: Array<{ name: string; role: string | null; company_name: string | null }> = [];
  if (attendeeIds.length > 0) {
    const rows = await db`
      SELECT tm.name, tm.role, c.name as company_name
        FROM team_members tm
        LEFT JOIN companies c ON c.id = tm.company_id
       WHERE tm.id = ANY(${attendeeIds})
       ORDER BY tm.name
    `;
    attendeeRows = rows.map((r) => ({
      name: String(r.name),
      role: r.role ? String(r.role) : null,
      company_name: r.company_name ? String(r.company_name) : null,
    }));
  }
  const attendeesExternal = Array.isArray(m.attendees_external) ? (m.attendees_external as string[]) : [];

  // Action-Items
  const actionItems = Array.isArray(m.action_items) ? (m.action_items as Array<Record<string, unknown>>) : [];

  return {
    Meeting: {
      Titel: String(m.title ?? ""),
      Datum: formatDate(m.meeting_date),
      Startzeit: m.start_time ? String(m.start_time).slice(0, 5) : "",
      Endzeit: m.end_time ? String(m.end_time).slice(0, 5) : "",
      Ort: m.location ? String(m.location) : "",
      Typ: m.meeting_type ? String(m.meeting_type) : "",
      Agenda: m.agenda ? String(m.agenda) : "",
      Protokoll: m.minutes ? String(m.minutes) : "",
      Beschluesse: m.decisions ? String(m.decisions) : "",
      NaechstesMeeting: formatDate(m.next_meeting_date),
    },
    Projekt: m.project_name ? String(m.project_name) : "",
    Teilnehmer: [
      ...attendeeRows.map((a) => ({
        Name: a.name,
        Rolle: a.role ?? "",
        Firma: a.company_name ?? "",
      })),
      ...attendeesExternal.map((name) => ({ Name: name, Rolle: "extern", Firma: "" })),
    ],
    Aufgaben: actionItems.map((a) => ({
      Text: String(a.text ?? ""),
      Faellig: a.dueDate ? String(a.dueDate) : "",
      Erledigt: a.done === true,
    })),
  };
}

async function buildBautagebuchData(entryId: string): Promise<Record<string, unknown>> {
  if (!DB_ENABLED) return {};
  const db = getDb();
  const [e] = await db`
    SELECT b.*, p.name as project_name
      FROM bautagebuch_entries b
      LEFT JOIN projects p ON p.id = b.project_id
     WHERE b.id = ${entryId} LIMIT 1
  `;
  if (!e) throw new DocxRenderError("Bautagebuch-Eintrag nicht gefunden");

  const personnel = Array.isArray(e.personnel) ? (e.personnel as Array<Record<string, unknown>>) : [];

  return {
    Eintrag: {
      Datum: formatDate(e.entry_date),
      Wetter: e.weather ? String(e.weather) : "",
      TemperaturMin: e.temperature_min !== null && e.temperature_min !== undefined ? Number(e.temperature_min) : "",
      TemperaturMax: e.temperature_max !== null && e.temperature_max !== undefined ? Number(e.temperature_max) : "",
      Maschinen: e.machines ? String(e.machines) : "",
      Taetigkeiten: e.activities ? String(e.activities) : "",
      Vorkommnisse: e.incidents ? String(e.incidents) : "",
    },
    Projekt: e.project_name ? String(e.project_name) : "",
    Personal: personnel.map((p) => ({
      Name: String(p.name ?? ""),
      Stunden: p.hours ?? "",
      Rolle: p.role ?? "",
    })),
  };
}

async function buildTimeEntryData(opts: {
  projectName?: string;
  memberId?: string;
  from?: string;
  to?: string;
}): Promise<Record<string, unknown>> {
  if (!DB_ENABLED) return {};
  const db = getDb();

  let projectId: string | null = null;
  if (opts.projectName) {
    const [p] = await db`SELECT id FROM projects WHERE name = ${opts.projectName} LIMIT 1`;
    projectId = p?.id ? String(p.id) : null;
  }

  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (projectId) {
    where.push(`te.project_id = $/projectId`);
    params.projectId = projectId;
  }
  if (opts.memberId) {
    where.push(`te.member_id = $/memberId`);
    params.memberId = opts.memberId;
  }
  if (opts.from) {
    where.push(`te.date >= $/from`);
    params.from = opts.from;
  }
  if (opts.to) {
    where.push(`te.date <= $/to`);
    params.to = opts.to;
  }
  // postgres.js + dynamic where: einfacher mit Tagged-Template via .unsafe.
  // Wir bauen das WHERE manuell + Werte als $1,$2,...
  const args: unknown[] = [];
  // Schema-Spalte heisst entry_date, NICHT date — sonst crasht das SQL
  // mit "column te.date does not exist".
  let sql = `
    SELECT te.id, te.entry_date, te.hours, te.start_time, te.end_time, te.break_minutes,
           te.activity, te.notes, te.member_name,
           tm.name as resolved_member_name, p.name as project_name
      FROM time_entries te
      LEFT JOIN team_members tm ON tm.id = te.member_id
      LEFT JOIN projects p ON p.id = te.project_id
  `;
  const whereClauses: string[] = [];
  if (projectId) {
    args.push(projectId);
    whereClauses.push(`te.project_id = $${args.length}`);
  }
  if (opts.memberId) {
    args.push(opts.memberId);
    whereClauses.push(`te.member_id = $${args.length}`);
  }
  if (opts.from) {
    args.push(opts.from);
    whereClauses.push(`te.entry_date >= $${args.length}`);
  }
  if (opts.to) {
    args.push(opts.to);
    whereClauses.push(`te.entry_date <= $${args.length}`);
  }
  if (whereClauses.length) sql += ` WHERE ${whereClauses.join(" AND ")}`;
  sql += ` ORDER BY te.entry_date, te.start_time`;

  const rows = await db.unsafe(sql, args as never[]);
  let totalHours = 0;
  const eintraege = rows.map((r) => {
    const h = Number(r.hours);
    totalHours += h;
    return {
      Datum: formatDate(r.entry_date),
      Stunden: h,
      Start: r.start_time ? String(r.start_time).slice(0, 5) : "",
      Ende: r.end_time ? String(r.end_time).slice(0, 5) : "",
      Pause: r.break_minutes ?? 0,
      Mitarbeiter: r.resolved_member_name ? String(r.resolved_member_name) : r.member_name ? String(r.member_name) : "",
      Taetigkeit: r.activity ? String(r.activity) : "",
      Notizen: r.notes ? String(r.notes) : "",
      Projekt: r.project_name ? String(r.project_name) : "",
    };
  });

  return {
    Zeitraum: {
      Von: opts.from ?? "",
      Bis: opts.to ?? "",
      Projekt: opts.projectName ?? "",
    },
    Eintraege: eintraege,
    SummeStunden: Number(totalHours.toFixed(2)),
    AnzahlEintraege: eintraege.length,
  };
}

async function buildProjectSummaryData(projectName: string): Promise<Record<string, unknown>> {
  if (!DB_ENABLED) return {};
  const db = getDb();
  const [p] = await db`
    SELECT p.*, tm.name as bauherr_name
      FROM projects p
      LEFT JOIN team_members tm ON tm.id = p.bauherr_id
     WHERE p.name = ${projectName} LIMIT 1
  `;
  if (!p) throw new DocxRenderError("Projekt nicht gefunden");

  return {
    Projekt: {
      Name: String(p.name),
      Projektnummer: p.projektnummer ? String(p.projektnummer) : "",
      Bauherr: p.bauherr_name ? String(p.bauherr_name) : p.bauherr ? String(p.bauherr) : "",
      Standort: p.standort ? String(p.standort) : "",
      Projektart: p.projektart ? String(p.projektart) : "",
      Nutzung: p.nutzung ? String(p.nutzung) : "",
      Phase: p.phase ? String(p.phase) : "",
      Beschreibung: p.description ? String(p.description) : "",
      Status: p.status ? String(p.status) : "",
      Start: formatDate(p.start_date),
      Ende: formatDate(p.end_date),
    },
  };
}

// ── Render-Pipeline ──────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Welche Kategorie? Wenn templateId gegeben, wird kind verifiziert. */
  kind: ExportKind;
  /** Optional: spezifische Template-ID. Sonst Default fuer kind. */
  templateId?: string;
  /** Aktueller User fuer {User}-Placeholder. */
  currentUserName: string | null;

  // Kategorie-spezifische Bezuege
  meetingId?: string;
  bautagebuchId?: string;
  projectName?: string;
  memberId?: string;
  from?: string;
  to?: string;
}

export interface RenderResult {
  buffer: Buffer;
  filename: string;
}

/** Hauptfunktion: laedt Template, baut Daten, ersetzt Tags, gibt Buffer zurueck.
 *  Caller (Route) streamt den Buffer mit MIME application/vnd.openxmlformats-
 *  officedocument.wordprocessingml.document. */
export async function renderDocxExport(opts: RenderOptions): Promise<RenderResult> {
  // 1. Template-Blob laden
  let templateInfo: { buffer: Buffer; filename: string } | null = null;
  if (opts.templateId) {
    templateInfo = await loadExportTemplateBlob(opts.templateId);
    if (!templateInfo) throw new DocxRenderError("Template nicht gefunden");
  } else {
    const def = await getDefaultExportTemplate(opts.kind);
    if (!def) {
      throw new DocxRenderError(
        `Kein Default-Template fuer "${opts.kind}". Lade in Settings → Word-Export ein .docx hoch und markiere es als Standard.`,
      );
    }
    templateInfo = await loadExportTemplateBlob(def.id);
    if (!templateInfo) throw new DocxRenderError("Template-Blob nicht lesbar");
  }

  // 2. Daten zusammenbauen je nach Kategorie
  const base = await buildBaseData(opts.currentUserName);
  let kindData: Record<string, unknown> = {};
  switch (opts.kind) {
    case "meeting":
      if (!opts.meetingId) throw new DocxRenderError("meetingId erforderlich fuer Meeting-Export");
      kindData = await buildMeetingData(opts.meetingId);
      break;
    case "bautagebuch":
      if (!opts.bautagebuchId) throw new DocxRenderError("bautagebuchId erforderlich");
      kindData = await buildBautagebuchData(opts.bautagebuchId);
      break;
    case "time-entry":
      kindData = await buildTimeEntryData({
        projectName: opts.projectName,
        memberId: opts.memberId,
        from: opts.from,
        to: opts.to,
      });
      break;
    case "project-summary":
      if (!opts.projectName) throw new DocxRenderError("projectName erforderlich");
      kindData = await buildProjectSummaryData(opts.projectName);
      break;
  }
  const data = { ...base, ...kindData };

  // 3. Render via docxtemplater
  let buffer: Buffer;
  try {
    const zip = new PizZip(templateInfo.buffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // parser: verschachtelte Tags wie {Meeting.Titel} oder {Projekt.Bauherr}
      // funktionieren NUR mit dem expression-parser. Ohne haengt der
      // Default-Parser an "Meeting.Titel" als flachem Tag-Namen, findet keinen
      // Match in den Daten und der nullGetter macht alles leer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser: expressionParser as any,
      // Bei unbekannten Tags: leer lassen statt Error werfen — User soll
      // neue Tags ausprobieren koennen ohne dass der ganze Export crashed.
      nullGetter: () => "",
    });
    doc.render(data);
    const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
    buffer = Buffer.isBuffer(out) ? out : Buffer.from(out);
  } catch (err) {
    logError("[DocxRender] Render-Fehler", err);
    // docxtemplater wirft strukturierte Fehler — wir extrahieren die properties
    const e = err as { properties?: { errors?: Array<{ message: string }> } };
    const inner = e?.properties?.errors?.map((x) => x.message).join("; ");
    throw new DocxRenderError(
      inner
        ? `Template-Fehler: ${inner}`
        : `Render fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // 4. Sinnvollen Filename bauen
  const dateSlug = new Date().toISOString().slice(0, 10);
  let filename = `${opts.kind}-${dateSlug}.docx`;
  if (opts.kind === "meeting" && opts.meetingId) filename = `Meeting-${dateSlug}.docx`;
  if (opts.kind === "bautagebuch" && opts.bautagebuchId) filename = `Bautagebuch-${dateSlug}.docx`;
  if (opts.kind === "time-entry") filename = `Stundenzettel-${dateSlug}.docx`;
  if (opts.kind === "project-summary" && opts.projectName) {
    filename = `Projekt-${opts.projectName.replace(/[^a-zA-Z0-9_-]/g, "_")}.docx`;
  }
  return { buffer, filename };
}

/** Fuer "Test-Render" in der UI: rendert das Template mit Dummy-Daten,
 *  damit der User sieht ob seine Tags korrekt sind ohne erst eine echte
 *  Entity haben zu muessen. */
export async function renderDocxTest(templateId: string, currentUserName: string | null): Promise<RenderResult> {
  const templateInfo = await loadExportTemplateBlob(templateId);
  if (!templateInfo) throw new DocxRenderError("Template nicht gefunden");
  // Kind ermitteln, damit der Dummy zur jeweiligen Datenform passt
  // (sonst kollidiert z.B. das Meeting-`Projekt: "..."` (String) mit dem
  // Project-Summary-`Projekt: { Name, ... }` (Objekt) und Tags wie
  // {Projekt.Name} bleiben im Test leer).
  const tplMeta = await getExportTemplate(templateId);
  const kind = tplMeta?.kind;

  const base = await buildBaseData(currentUserName);
  // Pro Kind die passende Dummy-Form. So sieht der Admin im Test-Render
  // genau, was im echten Export geliefert wird.
  let kindData: Record<string, unknown>;
  if (kind === "project-summary") {
    kindData = {
      Projekt: {
        Name: "(Test-Projekt)",
        Projektnummer: "2026-099",
        Bauherr: "Max Mustermann",
        Standort: "Wien",
        Projektart: "Neubau",
        Nutzung: "Wohnbau",
        Phase: "Einreichung",
        Beschreibung: "Test-Projektbeschreibung fuer Vorschau",
        Status: "aktiv",
        Start: "01.01.2026",
        Ende: "31.12.2026",
      },
    };
  } else if (kind === "bautagebuch") {
    kindData = {
      Projekt: "(Test-Projekt)",
      Eintrag: {
        Datum: "01.01.2026",
        Wetter: "sonnig",
        TemperaturMin: 5,
        TemperaturMax: 12,
        Maschinen: "Bagger, Kran",
        Taetigkeiten: "Aushub, Schalung",
        Vorkommnisse: "(keine)",
      },
      Personal: [
        { Name: "Trupp 1", Stunden: 8, Rolle: "Bagger" },
        { Name: "Trupp 2", Stunden: 8, Rolle: "Beton" },
      ],
    };
  } else if (kind === "time-entry") {
    kindData = {
      Zeitraum: { Von: "01.01.2026", Bis: "31.01.2026", Projekt: "(Test-Projekt)" },
      Eintraege: [
        {
          Datum: "01.01.2026",
          Stunden: 8,
          Start: "08:00",
          Ende: "16:30",
          Pause: 30,
          Mitarbeiter: "Max Mustermann",
          Taetigkeit: "Planung",
          Notizen: "",
          Projekt: "(Test-Projekt)",
        },
      ],
      SummeStunden: 8,
      AnzahlEintraege: 1,
    };
  } else {
    // meeting (Default — vorhandenes Verhalten)
    kindData = {
      Projekt: "(Test-Projekt)",
      Meeting: {
        Titel: "Test-Meeting",
        Datum: "01.01.2026",
        Startzeit: "10:00",
        Endzeit: "11:00",
        Ort: "Buero",
        Typ: "Bauherrenmeeting",
        Agenda: "Tagesordnungspunkt 1\nTagesordnungspunkt 2",
        Protokoll: "Test-Protokoll-Inhalt",
        Beschluesse: "Beschluss 1",
        NaechstesMeeting: "15.02.2026",
      },
      Teilnehmer: [
        { Name: "Max Mustermann", Rolle: "Architekt", Firma: "Sima Architecture" },
        { Name: "Erika Beispiel", Rolle: "Bauherr", Firma: "" },
      ],
      Aufgaben: [{ Text: "Test-Aufgabe", Faellig: "31.01.2026", Erledigt: false }],
    };
  }
  const dummy = { ...base, ...kindData };

  try {
    const zip = new PizZip(templateInfo.buffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser: expressionParser as any,
      nullGetter: () => "",
    });
    doc.render(dummy);
    const out = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
    const buffer = Buffer.isBuffer(out) ? out : Buffer.from(out);
    return { buffer, filename: `test-${templateInfo.filename}` };
  } catch (err) {
    const e = err as { properties?: { errors?: Array<{ message: string }> } };
    const inner = e?.properties?.errors?.map((x) => x.message).join("; ");
    throw new DocxRenderError(inner ? `Template-Fehler: ${inner}` : "Render fehlgeschlagen", err);
  }
}

/** Liste der Tags die je Kategorie zur Verfuegung stehen — fuer
 *  "Verfuegbare Platzhalter"-Hilfe in der UI. */
export function listExportVariables(kind: ExportKind): { tag: string; description: string }[] {
  const base = [
    { tag: "{Datum}", description: "Heutiges Datum (TT.MM.JJJJ)" },
    { tag: "{Zeit}", description: "Aktuelle Uhrzeit (HH:MM)" },
    { tag: "{User}", description: "Aktueller User" },
    { tag: "{Firma}", description: "Firmenname (Branding)" },
    { tag: "{FirmenAdresse}", description: "Adresse (Branding)" },
    { tag: "{FirmenTelefon}", description: "Telefon (Branding)" },
    { tag: "{FirmenEmail}", description: "Email (Branding)" },
    { tag: "{FirmenWebsite}", description: "Website (Branding)" },
  ];
  if (kind === "meeting") {
    return [
      ...base,
      { tag: "{Projekt}", description: "Projekt-Name" },
      { tag: "{Meeting.Titel}", description: "Meeting-Titel" },
      { tag: "{Meeting.Datum}", description: "Meeting-Datum" },
      { tag: "{Meeting.Startzeit}", description: "" },
      { tag: "{Meeting.Endzeit}", description: "" },
      { tag: "{Meeting.Ort}", description: "" },
      { tag: "{Meeting.Typ}", description: "Bauherrenmeeting/Baubesprechung/…" },
      { tag: "{Meeting.Agenda}", description: "Markdown-Body" },
      { tag: "{Meeting.Protokoll}", description: "" },
      { tag: "{Meeting.Beschluesse}", description: "" },
      { tag: "{#Teilnehmer}{Name} – {Rolle}{/Teilnehmer}", description: "Loop ueber Teilnehmer" },
      { tag: "{#Aufgaben}{Text} (faellig: {Faellig}){/Aufgaben}", description: "Loop Action-Items" },
    ];
  }
  if (kind === "bautagebuch") {
    return [
      ...base,
      { tag: "{Projekt}", description: "Projekt-Name" },
      { tag: "{Eintrag.Datum}", description: "" },
      { tag: "{Eintrag.Wetter}", description: "sonnig/regen/…" },
      { tag: "{Eintrag.TemperaturMin}", description: "" },
      { tag: "{Eintrag.TemperaturMax}", description: "" },
      { tag: "{Eintrag.Maschinen}", description: "" },
      { tag: "{Eintrag.Taetigkeiten}", description: "" },
      { tag: "{Eintrag.Vorkommnisse}", description: "" },
      { tag: "{#Personal}{Name} – {Stunden}h{/Personal}", description: "Loop Personal-Liste" },
    ];
  }
  if (kind === "time-entry") {
    return [
      ...base,
      { tag: "{Zeitraum.Von}", description: "" },
      { tag: "{Zeitraum.Bis}", description: "" },
      { tag: "{Zeitraum.Projekt}", description: "" },
      { tag: "{SummeStunden}", description: "Total ueber alle Eintraege" },
      { tag: "{AnzahlEintraege}", description: "" },
      { tag: "{#Eintraege}{Datum}: {Mitarbeiter} {Stunden}h{/Eintraege}", description: "Loop" },
    ];
  }
  if (kind === "project-summary") {
    return [
      ...base,
      { tag: "{Projekt.Name}", description: "" },
      { tag: "{Projekt.Projektnummer}", description: "" },
      { tag: "{Projekt.Bauherr}", description: "" },
      { tag: "{Projekt.Standort}", description: "" },
      { tag: "{Projekt.Projektart}", description: "" },
      { tag: "{Projekt.Phase}", description: "" },
      { tag: "{Projekt.Beschreibung}", description: "" },
    ];
  }
  return base;
}
