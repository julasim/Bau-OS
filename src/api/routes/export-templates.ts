// ============================================================
// PATIO — Export-Templates-Routes (Phase 6d)
// ============================================================
// CRUD fuer .docx-Templates (Settings-UI) + die eigentlichen
// Export-Endpoints die ein gerendertes .docx ausliefern.
//
//   GET    /api/export-templates                      → Liste
//   GET    /api/export-templates/:id                   → einzeln
//   POST   /api/export-templates  (multipart .docx)    → Upload
//   POST   /api/export-templates/:id/default           → Default setzen
//   GET    /api/export-templates/:id/file              → Download Original
//   GET    /api/export-templates/:id/test              → Test-Render mit Dummy-Daten
//   DELETE /api/export-templates/:id                   → Loeschen
//   GET    /api/export-templates/_variables?kind=…     → Tag-Doku
//
//   GET    /api/exports/meeting/:id.docx
//   GET    /api/exports/bautagebuch/:id.docx
//   GET    /api/exports/time-entries.docx?...
//   GET    /api/exports/project/:name/summary.docx
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import {
  listExportTemplates,
  getExportTemplate,
  createExportTemplate,
  setDefaultExportTemplate,
  deleteExportTemplate,
  loadExportTemplateBlob,
  type ExportKind,
} from "../../data/db-export-templates.js";
import { renderDocxExport, renderDocxTest, listExportVariables, DocxRenderError } from "../../export/docx-render.js";
import { canSeeProjectByName, type UserCtx } from "../../data/access.js";
import { meetingRepo, bautagebuchRepo } from "../../data/index.js";
import { logError } from "../../logger.js";
import { adminMiddleware } from "../auth.js";
import { contentDisposition } from "../dateiname.js";

export const exportTemplatesRoutes = new Hono<AppEnv>();

// ── Wer darf hier schreiben? ─────────────────────────────────────────────────
//
// Diese Daten gelten fuer das ganze Buero. Wer sie aendert, aendert sie fuer
// alle — bis hin zum Loeschen der einzigen Word-Vorlage, mit der Rechnungen
// erzeugt werden. Bis hierher konnte das JEDER angemeldete Nutzer.
//
// Lesen bleibt offen: ohne diese Daten laesst sich die Oberflaeche nicht
// aufbauen, und ein Rechte-Dialog fuer Textbausteine waere Buerokratie ohne
// Gegenwert. Geschrieben wird nur vom Admin.
//
// Der Guard steht bewusst VOR den Routen — Hono wendet Middleware in
// Registrierungsreihenfolge an; danach eingehaengt wuerde er die darueber
// stehenden Handler nicht mehr erfassen.
exportTemplatesRoutes.on(["POST", "PATCH", "DELETE"], ["/export-templates", "/export-templates/*"], adminMiddleware);

const VALID_KINDS: ExportKind[] = ["meeting", "bautagebuch", "time-entry", "project-summary"];
const MAX_DOCX_BYTES = 10 * 1024 * 1024; // 10 MB
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function userName(c: { var: { dbUser?: { displayName?: string | null; username?: string } | null } }): string | null {
  const u = c.var.dbUser;
  return u?.displayName ?? u?.username ?? null;
}

function isDocxFilename(name: string): boolean {
  return /\.docx$/i.test(name);
}

type CtxTraeger = { var: { userId: string | null; userRole: "admin" | "user" } };

function userCtx(c: CtxTraeger): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Darf dieser Aufrufer ein Dokument zu diesem Projekt bekommen?
 *
 *  Die Export-Routen hatten bis hierher KEINE Rechtepruefung. Sie erzeugen den
 *  vollen Inhalt als Word-Datei — Protokolle, Bautagebuch, Projektbericht,
 *  Stundenlisten samt Betraegen. Damit war der Export die bequemste Umgehung
 *  der gesamten Zugriffssteuerung: was die Listen-Routen sauber filtern, liess
 *  sich ueber einen einzigen GET trotzdem herunterladen.
 *
 *  Die Pruefung steht bewusst VOR dem Rendern. Sonst verraet allein die Dauer
 *  oder die Fehlermeldung („Kein Default-Template fuer …"), dass es den
 *  Datensatz gibt. */
async function darfProjekt(c: CtxTraeger, projectName: string | null | undefined) {
  const ctx = userCtx(c);
  if (ctx.role === "admin") return true;
  if (!projectName) return false; // ohne Projektbezug bleibt es beim Admin
  return canSeeProjectByName(ctx, projectName);
}

// ── Tag-Doku ─────────────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/_variables", (c) => {
  const kind = c.req.query("kind") as ExportKind | undefined;
  if (kind && !VALID_KINDS.includes(kind)) {
    return c.json({ error: "kind ungueltig" }, 400);
  }
  return c.json(listExportVariables(kind ?? "meeting"));
});

// ── List ─────────────────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates", async (c) => {
  const kind = c.req.query("kind") as ExportKind | undefined;
  if (kind && !VALID_KINDS.includes(kind)) return c.json({ error: "kind ungueltig" }, 400);
  const list = await listExportTemplates(kind);
  return c.json(list);
});

// ── Test-Render — VOR /:id matcher ───────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/:id/test", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await renderDocxTest(id, userName(c));
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", contentDisposition(result.filename));
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Test-Render", err);
    return c.json({ error: "Test-Render fehlgeschlagen" }, 500);
  }
});

// ── Download Original ────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/:id/file", async (c) => {
  const blob = await loadExportTemplateBlob(c.req.param("id"));
  if (!blob) return c.json({ error: "Template nicht gefunden" }, 404);
  c.header("Content-Type", DOCX_MIME);
  c.header("Content-Disposition", contentDisposition(blob.filename));
  return c.body(new Uint8Array(blob.buffer));
});

// ── Single ───────────────────────────────────────────────────────────────────
exportTemplatesRoutes.get("/export-templates/:id", async (c) => {
  const t = await getExportTemplate(c.req.param("id"));
  if (!t) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json(t);
});

// ── Upload ───────────────────────────────────────────────────────────────────
exportTemplatesRoutes.post("/export-templates", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Multipart-Body erwartet" }, 400);
  }

  const file = formData.get("file") as File | null;
  const kind = (formData.get("kind") as string | null) ?? "";
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const description = ((formData.get("description") as string | null) ?? "").trim() || null;
  const isDefault = formData.get("isDefault") === "true";

  if (!file || !file.name) return c.json({ error: "Feld 'file' fehlt" }, 400);
  if (!VALID_KINDS.includes(kind as ExportKind)) {
    return c.json({ error: `kind muss einer von: ${VALID_KINDS.join(", ")}` }, 400);
  }
  if (!name) return c.json({ error: "name ist Pflicht" }, 400);
  if (file.size > MAX_DOCX_BYTES) {
    return c.json({ error: `Datei zu gross (max ${MAX_DOCX_BYTES / 1024 / 1024} MB)` }, 413);
  }
  if (!isDocxFilename(file.name)) {
    return c.json({ error: "Nur .docx-Dateien erlaubt" }, 415);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const created = await createExportTemplate({
      kind: kind as ExportKind,
      name,
      description,
      filename: file.name,
      blob: buffer,
      isDefault,
      createdById: c.var.userId,
    });
    return c.json(created, 201);
  } catch (err) {
    logError("[Export] Upload fehlgeschlagen", err);
    return c.json({ error: err instanceof Error ? err.message : "Upload fehlgeschlagen" }, 500);
  }
});

// ── Default setzen ───────────────────────────────────────────────────────────
exportTemplatesRoutes.post("/export-templates/:id/default", async (c) => {
  const updated = await setDefaultExportTemplate(c.req.param("id"));
  if (!updated) return c.json({ error: "Template nicht gefunden" }, 404);
  return c.json(updated);
});

// ── Delete ───────────────────────────────────────────────────────────────────
exportTemplatesRoutes.delete("/export-templates/:id", async (c) => {
  const ok = await deleteExportTemplate(c.req.param("id"));
  return c.json({ ok });
});

// ── Export-Endpoints (das eigentliche Generieren) ────────────────────────────

exportTemplatesRoutes.get("/exports/meeting/:id", async (c) => {
  const id = c.req.param("id");
  const templateId = c.req.query("templateId") ?? undefined;

  // 404 vor 403: sonst verraet der Statuscode, welche IDs es gibt.
  const meeting = await meetingRepo.get(id);
  if (!meeting) return c.json({ error: "Besprechung nicht gefunden" }, 404);
  if (!(await darfProjekt(c, meeting.projectName))) return c.json({ error: "Kein Zugriff" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "meeting",
      meetingId: id,
      // Der Projektbezug geht mit, damit die Projektnummer im Dateinamen
      // stehen kann (Migration 052). Die Route kennt ihn ohnehin — sie hat
      // damit gerade die Rechte geprueft.
      projectName: meeting.projectName ?? undefined,
      templateId,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", contentDisposition(result.filename));
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Meeting", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/bautagebuch/:id", async (c) => {
  const id = c.req.param("id");

  const eintrag = await bautagebuchRepo.getById(id);
  if (!eintrag) return c.json({ error: "Bautagebuch-Eintrag nicht gefunden" }, 404);
  if (!(await darfProjekt(c, eintrag.projectName))) return c.json({ error: "Kein Zugriff" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "bautagebuch",
      bautagebuchId: id,
      projectName: eintrag.projectName ?? undefined,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", contentDisposition(result.filename));
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Bautagebuch", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/time-entries", async (c) => {
  // Ohne `project` umfasst der Export ALLE Projekte — daraus liesse sich die
  // gesamte Auslastung des Bueros samt Stundensaetzen ablesen. Das bleibt dem
  // Admin vorbehalten; mit Projektangabe entscheidet die uebliche Pruefung.
  const projektFilter = c.req.query("project") ?? undefined;
  if (!(await darfProjekt(c, projektFilter ?? null))) return c.json({ error: "Kein Zugriff" }, 403);

  // KEINE Geld-Pruefung hier, nachgesehen statt vermutet: der Stundenzettel
  // enthaelt Datum, Stunden, Mitarbeiter, Taetigkeit — keinen Satz und keinen
  // Betrag (`buildTimeEntryData` in src/export/docx-render.ts baut die Zeilen
  // Feld fuer Feld auf, `SummeStunden` sind Stunden). Ihn ans Geld-Recht zu
  // binden wuerde die Projektleitung daran hindern, dem Bauherrn einen
  // Stundennachweis zu geben — ohne dass dadurch irgendein Betrag geschuetzt
  // waere.

  try {
    const result = await renderDocxExport({
      kind: "time-entry",
      projectName: projektFilter,
      memberId: c.req.query("memberId") ?? undefined,
      from: c.req.query("from") ?? undefined,
      to: c.req.query("to") ?? undefined,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", contentDisposition(result.filename));
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] TimeEntries", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/project/:name/summary", async (c) => {
  const projectName = decodeURIComponent(c.req.param("name"));
  if (!(await darfProjekt(c, projectName))) return c.json({ error: "Kein Zugriff" }, 403);

  try {
    const result = await renderDocxExport({
      kind: "project-summary",
      projectName,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", contentDisposition(result.filename));
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] ProjectSummary", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});
