import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, DB_ENABLED, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../../config.js";
import { readFile, listFolder } from "../../workspace/index.js";
import { fileRepo } from "../../data/index.js";
import { getDb } from "../../db/client.js";
import { findDbUserById } from "../auth.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";

export const filesRoutes = new Hono<AppEnv>();

// Path-Traversal-Schutz
function safePath(userPath: string): string | null {
  const resolved = path.resolve(WORKSPACE_PATH, userPath);
  if (!resolved.startsWith(WORKSPACE_PATH)) return null;
  return userPath;
}

// ── Dateien auflisten (DB oder Filesystem) ──────────────────────────────────
filesRoutes.get("/files", async (c) => {
  const p = c.req.query("path") || "";
  const source = c.req.query("source"); // ?source=fs erzwingt Filesystem

  // DB-Modus: Dateien aus Datenbank laden (nur Root-Ebene, kein Pfad)
  if (DB_ENABLED && fileRepo && !p && source !== "fs") {
    const project = c.req.query("project");
    const files = await fileRepo.list(project ?? undefined);
    return c.json(
      files.map((f) => ({
        name: f.filename,
        type: "file" as const,
        size: f.filesize,
        modified: f.updatedAt,
        extension: f.filetype || "",
        id: f.id,
        project: f.project,
        analyzed: f.analyzed,
      })),
    );
  }

  // Filesystem-Fallback (Ordner-Navigation, Agent-Dateien)
  if (p && !safePath(p)) return c.json({ error: "Zugriff verweigert" }, 403);
  const items = listFolder(p);
  return c.json(items);
});

// ── Datei lesen ─────────────────────────────────────────────────────────────
filesRoutes.get("/files/read", async (c) => {
  const p = c.req.query("path");
  const id = c.req.query("id");

  // DB: ueber ID lesen
  if (id && DB_ENABLED && fileRepo) {
    const file = await fileRepo.get(id);
    if (!file) return c.json({ error: "Datei nicht gefunden" }, 404);
    // Text-Inhalt aus DB zurueckgeben wenn vorhanden
    if (file.contentText) {
      return c.json({ path: file.filepath, content: file.contentText, filename: file.filename });
    }
    // Fallback: von Filesystem lesen
    const content = readFile(file.filepath);
    return c.json({ path: file.filepath, content: content ?? "", filename: file.filename });
  }

  // Filesystem
  if (!p) return c.json({ error: "Pfad erforderlich (?path=...)" }, 400);
  if (!safePath(p)) return c.json({ error: "Zugriff verweigert" }, 403);
  const content = readFile(p);
  if (content === null) return c.json({ error: "Datei nicht gefunden" }, 404);
  return c.json({ path: p, content });
});

// ── Neuer Ordner ─────────────────────────────────────────────────────────────
filesRoutes.post("/files/mkdir", async (c) => {
  const body = await c.req.json<{ path: string }>();
  if (!body.path || !safePath(body.path)) return c.json({ error: "Zugriff verweigert" }, 403);
  const fullPath = path.resolve(WORKSPACE_PATH, body.path);
  if (!fullPath.startsWith(WORKSPACE_PATH)) return c.json({ error: "Zugriff verweigert" }, 403);
  if (fs.existsSync(fullPath)) return c.json({ error: "Ordner existiert bereits" }, 409);
  fs.mkdirSync(fullPath, { recursive: true });
  emit({ type: "file", action: "created", id: body.path });
  return c.json({ success: true });
});

// ── Loeschen ─────────────────────────────────────────────────────────────────
filesRoutes.delete("/files", async (c) => {
  const body = await c.req.json<{ path?: string; id?: string }>();

  // DB: ueber ID loeschen
  if (body.id && DB_ENABLED && fileRepo) {
    const file = await fileRepo.get(body.id);
    if (!file) return c.json({ error: "Nicht gefunden" }, 404);
    // Legacy-Eintraege hatten evtl. eine physische Datei im Vault — die wird
    // best-effort mitgeloescht, damit keine Waisen liegen bleiben.
    const legacyPath = path.resolve(WORKSPACE_PATH, file.filepath);
    if (legacyPath.startsWith(WORKSPACE_PATH) && fs.existsSync(legacyPath)) {
      try {
        fs.unlinkSync(legacyPath);
      } catch {
        /* ignore — DB-Eintrag ist das was zaehlt */
      }
    }
    await fileRepo.delete(body.id);
    emit({ type: "file", action: "deleted", id: file.filename });
    return c.json({ success: true });
  }

  // Filesystem
  if (!body.path || !safePath(body.path)) return c.json({ error: "Zugriff verweigert" }, 403);
  const fullPath = path.resolve(WORKSPACE_PATH, body.path);
  if (!fullPath.startsWith(WORKSPACE_PATH)) return c.json({ error: "Zugriff verweigert" }, 403);
  if (!fs.existsSync(fullPath)) return c.json({ error: "Nicht gefunden" }, 404);
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }
  emit({ type: "file", action: "deleted", id: body.path });
  return c.json({ success: true });
});

// ── Datei-Suche (DB) ────────────────────────────────────────────────────────
filesRoutes.get("/files/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);
  if (!DB_ENABLED || !fileRepo) return c.json([]);
  const results = await fileRepo.search(q);
  return c.json(results);
});

// ── Upload (Drag & Drop) ─────────────────────────────────────────────────────
// DB-Modus (Standard): Datei wird als bytea in files-Tabelle gespeichert,
// NICHTS landet auf Disk. Im Legacy-FS-Modus (kein DB_ENABLED) wird in den
// Vault geschrieben — das ist nur noch fuer Setups ohne PostgreSQL relevant.
filesRoutes.post("/files/upload", async (c) => {
  const formData = await c.req.formData();
  const targetDir = (formData.get("path") as string) || "";
  const project = (formData.get("project") as string) || undefined;

  const files = formData.getAll("files") as File[];
  if (files.length === 0) return c.json({ error: "Keine Dateien gesendet" }, 400);

  const saved: string[] = [];
  const dbEntries: Array<{ id: string; filename: string }> = [];

  // ── DB-Modus: Blob in die DB, kein Vault-Write ─────────────────────────────
  if (DB_ENABLED && fileRepo) {
    for (const file of files) {
      if (!file.name || file.size === 0) continue;
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json({ error: `Datei "${file.name}" ist zu groß (max ${MAX_UPLOAD_MB} MB)` }, 413);
      }
      const safeName = file.name.replace(/[<>:"|?*]/g, "_");
      const buffer = Buffer.from(await file.arrayBuffer());

      // Text aus Buffer extrahieren (kein Temp-File noetig)
      let contentText: string | undefined;
      try {
        const { extractDocumentFromBuffer } = await import("../../workspace/extractor.js");
        const result = await extractDocumentFromBuffer(buffer, safeName, file.type || "");
        if (result.format !== "unsupported" && result.text) {
          contentText = result.text;
        }
      } catch {
        // Extraktion fehlgeschlagen — Datei trotzdem speichern
      }

      try {
        const entry = await fileRepo.save({
          filename: safeName,
          // filepath bleibt als logischer Anzeigename drin; kein Disk-Pfad.
          filepath: safeName,
          filesize: file.size,
          mimeType: file.type || undefined,
          contentText,
          project,
          blob: buffer,
          // Phase 3: Uploader aus Auth-Context durchreichen, damit der File
          // im persoenlichen Workspace des Users landet (wenn project leer).
          uploadedById: c.var.userId ?? null,
        });
        dbEntries.push({ id: entry.id, filename: entry.filename });
        saved.push(safeName);
      } catch {
        // DB-Fehler — Datei geht verloren (kein Vault-Fallback mehr, weil der
        // User explizit "alles in die DB" wollte).
      }
    }

    if (saved.length > 0) emit({ type: "file", action: "created", id: saved.join(", ") });
    return c.json({ success: true, uploaded: saved, dbEntries });
  }

  // ── Legacy-FS-Modus (kein DB_ENABLED) ──────────────────────────────────────
  if (targetDir && !safePath(targetDir)) {
    return c.json({ error: "Zugriff verweigert" }, 403);
  }
  const destDir = targetDir ? path.resolve(WORKSPACE_PATH, targetDir) : WORKSPACE_PATH;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  for (const file of files) {
    if (!file.name || file.size === 0) continue;
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `Datei "${file.name}" ist zu groß (max ${MAX_UPLOAD_MB} MB)` }, 413);
    }
    const safeName = file.name.replace(/[<>:"|?*]/g, "_");
    const destPath = path.join(destDir, safeName);
    if (!destPath.startsWith(WORKSPACE_PATH)) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    const relativePath = targetDir ? `${targetDir}/${safeName}` : safeName;
    saved.push(relativePath);
  }

  if (saved.length > 0) emit({ type: "file", action: "created", id: saved.join(", ") });
  return c.json({ success: true, uploaded: saved, dbEntries });
});

// ── Download (Blob aus DB ausliefern) ───────────────────────────────────────
filesRoutes.get("/files/download", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "id erforderlich (?id=...)" }, 400);
  if (!DB_ENABLED || !fileRepo) return c.json({ error: "DB nicht aktiv" }, 500);

  const result = await fileRepo.readBlob(id);
  if (!result) {
    // Kein Blob in DB — pruefen ob die Datei als Legacy-Eintrag noch im
    // Vault liegt (filepath-Feld). Damit brechen bestehende Downloads nicht.
    const file = await fileRepo.get(id);
    if (!file) return c.json({ error: "Nicht gefunden" }, 404);
    const legacyPath = path.resolve(WORKSPACE_PATH, file.filepath);
    if (!legacyPath.startsWith(WORKSPACE_PATH) || !fs.existsSync(legacyPath)) {
      return c.json({ error: "Datei-Blob nicht gefunden" }, 404);
    }
    const buf = fs.readFileSync(legacyPath);
    c.header("Content-Type", file.mimeType || "application/octet-stream");
    c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
    return c.body(new Uint8Array(buf));
  }

  c.header("Content-Type", result.mimeType || "application/octet-stream");
  c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(result.filename)}"`);
  return c.body(new Uint8Array(result.blob));
});

// ── File-Sharing (Phase 3) ──────────────────────────────────────────────────
// Owner-Check: nur der Uploader (uploaded_by) oder ein Admin darf Shares
// einer Datei verwalten. Ohne diese Regel koennte jeder, der eine Datei sieht,
// sie an andere weitergeben.

// Owner-Check: nur der Uploader oder ein Admin darf Shares verwalten.
// Wir typen c als any-via Context, weil Hono-Generics in Helper-Funktionen
// nicht propagieren — die echten Type-Checks kommen in den Handlern selbst.
async function canManageFileShares(
  ctx: { var: { userRole: string; userId: string | null } },
  fileId: string,
): Promise<boolean> {
  if (ctx.var.userRole === "admin") return true;
  if (!fileRepo) return false;
  const db = getDb();
  const [row] = await db`SELECT uploaded_by FROM files WHERE id = ${fileId} LIMIT 1`;
  if (!row) return false;
  const owner = row.uploaded_by ? String(row.uploaded_by) : null;
  return !!owner && owner === ctx.var.userId;
}

filesRoutes.get("/files/:id/shares", async (c) => {
  if (!fileRepo?.listShares) return c.json([]);
  const fileId = c.req.param("id");
  if (!(await canManageFileShares(c, fileId))) {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }
  return c.json(await fileRepo.listShares(fileId));
});

filesRoutes.post("/files/:id/shares", async (c) => {
  if (!fileRepo?.addShare) return c.json({ error: "Nicht unterstützt" }, 501);
  const fileId = c.req.param("id");
  if (!(await canManageFileShares(c, fileId))) {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }

  const body = await c.req.json<{ userId: string; canEdit?: boolean }>();
  if (!body.userId) return c.json({ error: "userId erforderlich" }, 400);
  const target = await findDbUserById(body.userId);
  if (!target) return c.json({ error: "User nicht gefunden" }, 404);

  await fileRepo.addShare(fileId, body.userId, body.canEdit === true);
  emit({ type: "file", action: "updated", id: fileId });
  return c.json({ ok: true });
});

filesRoutes.delete("/files/:id/shares/:userId", async (c) => {
  if (!fileRepo?.removeShare) return c.json({ error: "Nicht unterstützt" }, 501);
  const fileId = c.req.param("id");
  if (!(await canManageFileShares(c, fileId))) {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }
  const ok = await fileRepo.removeShare(fileId, c.req.param("userId"));
  if (ok) emit({ type: "file", action: "updated", id: fileId });
  return c.json({ ok });
});
