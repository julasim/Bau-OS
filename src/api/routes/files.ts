import { Hono } from "hono";
import type { Context } from "hono";
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, DB_ENABLED, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../../config.js";
import { readFile, listFolder } from "../../workspace/index.js";
import { fileRepo, projectRepo } from "../../data/index.js";
import { getDb } from "../../db/client.js";
import { emit } from "../events.js";
import { validateUpload } from "../file-validation.js";
import type { AppEnv } from "../server.js";

export const filesRoutes = new Hono<AppEnv>();

/** Gibt die Projekt-IDs zurueck, die der aktuelle User sehen darf.
 *  Admin → undefined (kein Filter noetig, alle Dateien sichtbar).
 *  Non-Admin → Array der zugaenglichen Projekt-IDs (kann leer sein). */
async function getVisibleProjectIds(c: Context<AppEnv>): Promise<string[] | undefined> {
  const userRole = c.get("userRole");
  if (userRole === "admin") return undefined; // kein Filter
  const userId = c.get("userId");
  if (!userId || !projectRepo.listVisibleProjectIds) return [];
  return projectRepo.listVisibleProjectIds(userId);
}

/** ACL-Check: darf der aktuelle User diese Datei sehen/lesen/loeschen?
 *  Admin → immer ja. Non-Admin → ja wenn:
 *    - file.project_id in sichtbaren Projekten ODER
 *    - file.uploaded_by === userId ODER
 *    - explizit via file_shares geshared.
 *  Liest project_id/uploaded_by direkt aus der DB, weil FileEntry beide
 *  Felder nicht exponiert. */
async function canAccessFile(c: Context<AppEnv>, fileId: string): Promise<boolean> {
  const userRole = c.get("userRole");
  if (userRole === "admin") return true;
  const userId = c.get("userId");
  if (!userId) return false;
  const db = getDb();
  const rows = await db`
    SELECT project_id, uploaded_by FROM files WHERE id = ${fileId}
  `;
  if (rows.length === 0) return false;
  const projectId = rows[0].project_id ? String(rows[0].project_id) : null;
  const uploadedBy = rows[0].uploaded_by ? String(rows[0].uploaded_by) : null;
  if (uploadedBy && uploadedBy === userId) return true;
  if (projectId && projectRepo.listVisibleProjectIds) {
    const visible = await projectRepo.listVisibleProjectIds(userId);
    if (visible.includes(projectId)) return true;
  }
  const shareRows = await db`
    SELECT 1 FROM file_shares WHERE file_id = ${fileId} AND user_id = ${userId} LIMIT 1
  `;
  return shareRows.length > 0;
}

/** Ownership-Check: nur Admin oder Uploader darf Shares verwalten / loeschen. */
async function isFileOwnerOrAdmin(c: Context<AppEnv>, fileId: string): Promise<boolean> {
  const userRole = c.get("userRole");
  if (userRole === "admin") return true;
  const userId = c.get("userId");
  if (!userId) return false;
  const db = getDb();
  const rows = await db`
    SELECT uploaded_by FROM files WHERE id = ${fileId}
  `;
  if (rows.length === 0) return false;
  const uploadedBy = rows[0].uploaded_by ? String(rows[0].uploaded_by) : null;
  return uploadedBy === userId;
}

/** Baut die 415-Antwort fuer eine fehlgeschlagene Upload-Validierung.
 *  extension → Endung nicht erlaubt; content-mismatch → Inhalt (Magic
 *  Bytes) passt nicht zur Endung (getarnter Upload, SEC-3b). */
function uploadRejection(c: Context<AppEnv>, reason: "extension" | "content-mismatch", filename: string) {
  const msg =
    reason === "extension"
      ? `Dateityp nicht erlaubt: "${filename.split(".").pop()}"`
      : `Dateiinhalt passt nicht zur Endung: "${filename}"`;
  return c.json({ error: msg }, 415);
}

// Path-Traversal-Schutz
function safePath(userPath: string): string | null {
  const resolved = path.resolve(WORKSPACE_PATH, userPath);
  if (!resolved.startsWith(WORKSPACE_PATH + path.sep) && resolved !== WORKSPACE_PATH) return null;
  return userPath;
}

// ── Dateien auflisten (DB oder Filesystem) ──────────────────────────────────
filesRoutes.get("/files", async (c) => {
  const p = c.req.query("path") || "";
  const source = c.req.query("source"); // ?source=fs erzwingt Filesystem

  // DB-Modus: Dateien aus Datenbank laden (nur Root-Ebene, kein Pfad)
  if (DB_ENABLED && fileRepo && !p && source !== "fs") {
    const project = c.req.query("project");
    // Sicherheit: getVisibleProjectIds IMMER aufrufen. Fuer Admins liefert
    // sie undefined (kein Filter). Fuer Non-Admins wird geprueft, ob das
    // angefragte Projekt in der sichtbaren Menge liegt — sonst koennte ein
    // Non-Admin per ?project=irgendwas alle Dateien fremder Projekte sehen.
    const visibleProjectIds = await getVisibleProjectIds(c);
    const files = await fileRepo.list(project ?? undefined, 50, visibleProjectIds);
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
  // Im FS-Modus zeigt der Browser den rohen Workspace — nur Admins haben
  // Zugriff. Non-Admins sehen keine Dateien (es gibt keine User-Trennung im FS).
  const userRole = c.get("userRole") as string | undefined;
  if (userRole !== "admin") return c.json([]);
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
    if (!(await canAccessFile(c, id))) return c.json({ error: "Zugriff verweigert" }, 403);
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
  if (!fullPath.startsWith(WORKSPACE_PATH + path.sep) && fullPath !== WORKSPACE_PATH)
    return c.json({ error: "Zugriff verweigert" }, 403);
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
    if (!(await isFileOwnerOrAdmin(c, body.id))) return c.json({ error: "Zugriff verweigert" }, 403);
    // Legacy-Eintraege hatten evtl. eine physische Datei im Vault — die wird
    // best-effort mitgeloescht, damit keine Waisen liegen bleiben.
    const legacyPath = path.resolve(WORKSPACE_PATH, file.filepath);
    if (
      (legacyPath.startsWith(WORKSPACE_PATH + path.sep) || legacyPath === WORKSPACE_PATH) &&
      fs.existsSync(legacyPath)
    ) {
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
  if (!fullPath.startsWith(WORKSPACE_PATH + path.sep) && fullPath !== WORKSPACE_PATH)
    return c.json({ error: "Zugriff verweigert" }, 403);
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

// ── Zuletzt bearbeitet ──────────────────────────────────────────────────────
// Gibt die 50 zuletzt geaenderten Dateien zurueck, sortiert nach updatedAt desc.
// Nur DB-Modus — im FS-Modus gibt es kein updatedAt aus der DB.
filesRoutes.get("/files/recent", async (c) => {
  if (!DB_ENABLED || !fileRepo) return c.json([]);
  const visibleProjectIds = await getVisibleProjectIds(c);
  const files = await fileRepo.list(undefined, 200, visibleProjectIds);
  const sorted = [...files]
    .filter((f) => !!f.updatedAt)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 50);
  return c.json(
    sorted.map((f) => ({
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
});

// ── Markierte Dateien (Starred) ─────────────────────────────────────────────
// Gibt alle Dateien zurueck, die der aktuelle User markiert (starred) hat.
// Nur DB-Modus; im FS-Modus gibt es keine user_id-Semantik.
filesRoutes.get("/files/starred", async (c) => {
  if (!DB_ENABLED) return c.json([]);
  const userId = c.get("userId");
  if (!userId) return c.json([]);
  const db = getDb();
  const rows = await db`
    SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize,
           f.mime_type, f.analyzed, f.created_at, f.updated_at,
           p.name as project_name
    FROM files f
    JOIN file_stars fs ON f.id = fs.file_id
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE fs.user_id = ${userId}
    ORDER BY fs.starred_at DESC
    LIMIT 50
  `;
  return c.json(
    rows.map((f) => ({
      name: String(f.filename),
      type: "file" as const,
      size: Number(f.filesize || 0),
      modified: f.updated_at ? String(f.updated_at) : null,
      extension: f.filetype ? String(f.filetype) : "",
      id: String(f.id),
      project: f.project_name ? String(f.project_name) : null,
      analyzed: !!f.analyzed,
      starred: true,
    })),
  );
});

// ── Geteilte Dateien (Shared with me) ───────────────────────────────────────
// Gibt Dateien zurueck, die andere User mit dem aktuellen User geteilt haben.
filesRoutes.get("/files/shared", async (c) => {
  if (!DB_ENABLED) return c.json([]);
  const userId = c.get("userId");
  if (!userId) return c.json([]);
  const db = getDb();
  const rows = await db`
    SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize,
           f.mime_type, f.analyzed, f.created_at, f.updated_at,
           p.name as project_name, fs2.can_edit
    FROM files f
    JOIN file_shares fs2 ON f.id = fs2.file_id
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE fs2.user_id = ${userId}
    ORDER BY fs2.added_at DESC
    LIMIT 50
  `;
  return c.json(
    rows.map((f) => ({
      name: String(f.filename),
      type: "file" as const,
      size: Number(f.filesize || 0),
      modified: f.updated_at ? String(f.updated_at) : null,
      extension: f.filetype ? String(f.filetype) : "",
      id: String(f.id),
      project: f.project_name ? String(f.project_name) : null,
      analyzed: !!f.analyzed,
      canEdit: f.can_edit === true,
    })),
  );
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
      // SEC-3b: Endung + Magic Bytes pruefen (getarnte Uploads abweisen).
      const check = await validateUpload(buffer, file.name);
      if (!check.ok) return uploadRejection(c, check.reason, file.name);

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
    if (!destPath.startsWith(WORKSPACE_PATH + path.sep) && destPath !== WORKSPACE_PATH) continue;
    const buffer = Buffer.from(await file.arrayBuffer());
    // SEC-3b: Endung + Magic Bytes pruefen (getarnte Uploads abweisen).
    const check = await validateUpload(buffer, file.name);
    if (!check.ok) return uploadRejection(c, check.reason, file.name);
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
  if (!(await canAccessFile(c, id))) return c.json({ error: "Zugriff verweigert" }, 403);

  const result = await fileRepo.readBlob(id);
  if (!result) {
    // Kein Blob in DB — pruefen ob die Datei als Legacy-Eintrag noch im
    // Vault liegt (filepath-Feld). Damit brechen bestehende Downloads nicht.
    const file = await fileRepo.get(id);
    if (!file) return c.json({ error: "Nicht gefunden" }, 404);
    const legacyPath = path.resolve(WORKSPACE_PATH, file.filepath);
    if (
      (!legacyPath.startsWith(WORKSPACE_PATH + path.sep) && legacyPath !== WORKSPACE_PATH) ||
      !fs.existsSync(legacyPath)
    ) {
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

// ── Datei markieren (Star) ──────────────────────────────────────────────────
// POST /files/:id/star — Datei als Favorit markieren (idempotent).
filesRoutes.post("/files/:id/star", async (c) => {
  if (!DB_ENABLED) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  const fileId = c.req.param("id");
  const db = getDb();
  await db`
    INSERT INTO file_stars (file_id, user_id)
    VALUES (${fileId}, ${userId})
    ON CONFLICT DO NOTHING
  `;
  return c.json({ ok: true, starred: true });
});

// DELETE /files/:id/star — Markierung entfernen.
filesRoutes.delete("/files/:id/star", async (c) => {
  if (!DB_ENABLED) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  const fileId = c.req.param("id");
  const db = getDb();
  await db`
    DELETE FROM file_stars WHERE file_id = ${fileId} AND user_id = ${userId}
  `;
  return c.json({ ok: true, starred: false });
});

// ── Datei-Shares verwalten ──────────────────────────────────────────────────
// GET /files/:id/shares — Liste der User, mit denen diese Datei geteilt ist.
filesRoutes.get("/files/:id/shares", async (c) => {
  if (!DB_ENABLED || !fileRepo) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const fileId = c.req.param("id");
  if (!(await isFileOwnerOrAdmin(c, fileId))) return c.json({ error: "Zugriff verweigert" }, 403);
  const db = getDb();
  const rows = await db`
    SELECT fs.user_id, u.username, u.display_name, fs.can_edit, fs.added_at
    FROM file_shares fs
    JOIN users u ON u.id = fs.user_id
    WHERE fs.file_id = ${fileId}
    ORDER BY fs.added_at ASC
  `;
  return c.json(
    rows.map((r) => ({
      userId: String(r.user_id),
      username: String(r.username),
      displayName: r.display_name ? String(r.display_name) : null,
      canEdit: r.can_edit === true,
      addedAt: String(r.added_at),
    })),
  );
});

// POST /files/:id/shares — Datei mit einem User teilen.
// Body: { userId: string, canEdit: boolean }
filesRoutes.post("/files/:id/shares", async (c) => {
  if (!DB_ENABLED || !fileRepo) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const fileId = c.req.param("id");
  let body: { userId?: string; canEdit?: boolean };
  try {
    body = await c.req.json<{ userId?: string; canEdit?: boolean }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.userId) return c.json({ error: "userId erforderlich" }, 400);
  // Pruefen ob die Datei existiert
  const file = await fileRepo.get(fileId);
  if (!file) return c.json({ error: "Datei nicht gefunden" }, 404);
  if (!(await isFileOwnerOrAdmin(c, fileId))) return c.json({ error: "Zugriff verweigert" }, 403);
  const canEdit = body.canEdit === true;
  const db = getDb();
  await db`
    INSERT INTO file_shares (file_id, user_id, can_edit)
    VALUES (${fileId}, ${body.userId}, ${canEdit})
    ON CONFLICT (file_id, user_id) DO UPDATE SET can_edit = EXCLUDED.can_edit
  `;
  return c.json({ ok: true });
});

// DELETE /files/:id/shares/:userId — Freigabe entziehen.
filesRoutes.delete("/files/:id/shares/:userId", async (c) => {
  if (!DB_ENABLED) return c.json({ error: "Nur im DB-Modus verfügbar" }, 503);
  const fileId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  if (!(await isFileOwnerOrAdmin(c, fileId))) return c.json({ error: "Zugriff verweigert" }, 403);
  const db = getDb();
  await db`
    DELETE FROM file_shares WHERE file_id = ${fileId} AND user_id = ${targetUserId}
  `;
  return c.json({ ok: true });
});
