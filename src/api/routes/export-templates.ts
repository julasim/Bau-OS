// ============================================================
// Bau-OS — Export-Templates-Routes (Phase 6d)
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
import { logError } from "../../logger.js";

export const exportTemplatesRoutes = new Hono<AppEnv>();

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
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
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
  c.header("Content-Disposition", `attachment; filename="${blob.filename.replace(/"/g, "")}"`);
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
  try {
    const result = await renderDocxExport({
      kind: "meeting",
      meetingId: id,
      templateId,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Meeting", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/bautagebuch/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const result = await renderDocxExport({
      kind: "bautagebuch",
      bautagebuchId: id,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] Bautagebuch", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/time-entries", async (c) => {
  try {
    const result = await renderDocxExport({
      kind: "time-entry",
      projectName: c.req.query("project") ?? undefined,
      memberId: c.req.query("memberId") ?? undefined,
      from: c.req.query("from") ?? undefined,
      to: c.req.query("to") ?? undefined,
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] TimeEntries", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});

exportTemplatesRoutes.get("/exports/project/:name/summary", async (c) => {
  try {
    const result = await renderDocxExport({
      kind: "project-summary",
      projectName: decodeURIComponent(c.req.param("name")),
      templateId: c.req.query("templateId") ?? undefined,
      currentUserName: userName(c),
    });
    c.header("Content-Type", DOCX_MIME);
    c.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    return c.body(new Uint8Array(result.buffer));
  } catch (err) {
    if (err instanceof DocxRenderError) return c.json({ error: err.message }, 400);
    logError("[Export] ProjectSummary", err);
    return c.json({ error: "Export fehlgeschlagen" }, 500);
  }
});
