import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, DB_ENABLED, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../../config.js";
import { readFile, listFolder } from "../../workspace/index.js";
import { fileRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import { getDb } from "../../db/client.js";
import { findDbUserById } from "../auth.js";
import type { AppEnv } from "../server.js";
import { notifyFileShared } from "../../notifications.js";
import { emit } from "../events.js";

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Pruefen, ob ein User eine bestimmte Datei sehen darf. Identisch zur
 *  Filter-Logik in GET /files (Project-Sichtbarkeit ODER Uploader ODER
 *  file_shares-Match). Liefert true fuer Admins immer. */
async function canSeeFile(ctx: UserCtx, file: { id: string; project: string | null }): Promise<boolean> {
  if (ctx.role === "admin") return true;
  if (!ctx.userId) return false;

  // Projekt-Sichtbarkeit
  if (file.project && (await canSeeProjectByName(ctx, file.project))) return true;

  // file_shares-Eintrag pruefen
  const db = getDb();
  const [share] = await db`
    SELECT 1 FROM file_shares
    WHERE file_id = ${file.id} AND user_id = ${ctx.userId} LIMIT 1
  `;
  if (share) return true;

  // Privater Workspace: Datei ohne Projekt UND ich bin Uploader
  if (!file.project) {
    const [row] = await db`SELECT uploaded_by FROM files WHERE id = ${file.id} LIMIT 1`;
    if (row && row.uploaded_by && String(row.uploaded_by) === ctx.userId) return true;
  }
  return false;
}

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
    const ctx = userCtx(c);

    // Phase-4-Filter: Admin sieht alles. User sieht:
    //   - Dateien in seinen sichtbaren Projekten
    //   - eigene private Dateien (uploaded_by = me, kein Projekt)
    //   - direkt mit ihm geshared Dateien (file_shares)
    let visibleSet: Set<string> | null = null;
    let sharedFileIds: Set<string> = new Set();
    if (ctx.role !== "admin" && ctx.userId) {
      const visible = await getVisibleProjectIds(ctx);
      if (visible !== "all") {
        visibleSet = new Set(await projectRepo.list(visible));
      }
      // Shared-File-IDs einmalig holen — wir filtern damit Files ohne project,
      // die der User explizit freigegeben bekommen hat.
      const db = getDb();
      const rows = await db`
        SELECT file_id FROM file_shares WHERE user_id = ${ctx.userId}
      `;
      sharedFileIds = new Set(rows.map((r) => String(r.file_id)));
    }

    // Wir brauchen uploaded_by aus der DB — fileRepo.list() liefert das im
    // FileEntry-DTO nicht. Lazy-Lookup pro nicht-Admin-Request: einmal
    // alle uploaded_by der gefundenen IDs holen.
    let uploadedByMap: Map<string, string | null> = new Map();
    if (ctx.role !== "admin" && ctx.userId && files.length > 0) {
      const db = getDb();
      const ids = files.map((f) => f.id);
      const rows = await db`
        SELECT id, uploaded_by FROM files WHERE id = ANY(${ids})
      `;
      uploadedByMap = new Map(rows.map((r) => [String(r.id), r.uploaded_by ? String(r.uploaded_by) : null]));
    }

    const filtered =
      ctx.role === "admin"
        ? files
        : files.filter((f) => {
            if (visibleSet === null) return true; // role===user but visible="all"-equivalent (no scoping)
            if (f.project && visibleSet.has(f.project)) return true;
            if (sharedFileIds.has(f.id)) return true;
            // Privater Workspace: Datei ohne Projekt + ich bin Uploader.
            if (!f.project && uploadedByMap.get(f.id) === ctx.userId) return true;
            return false;
          });

    // Star-Flags des aktuellen Users mitliefern (Migration 019).
    // Eine einzelne Query, dann pro File ein Bool-Set-Lookup.
    let starredSet = new Set<string>();
    if (ctx.userId && filtered.length > 0) {
      const db = getDb();
      const fileIds = filtered.map((f) => f.id);
      const starRows = await db`
        SELECT file_id FROM file_stars
        WHERE user_id = ${ctx.userId} AND file_id = ANY(${fileIds})
      `;
      starredSet = new Set(starRows.map((r) => String(r.file_id)));
    }

    return c.json(
      filtered.map((f) => ({
        name: f.filename,
        type: "file" as const,
        size: f.filesize,
        modified: f.updatedAt,
        extension: f.filetype || "",
        id: f.id,
        project: f.project,
        analyzed: f.analyzed,
        starred: starredSet.has(f.id),
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
    if (!(await canSeeFile(userCtx(c), file))) {
      return c.json({ error: "Kein Zugriff" }, 403);
    }
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
  const failures: Array<{ filename: string; error: string }> = [];

  // ── DB-Modus: Blob in die DB, kein Vault-Write ─────────────────────────────
  if (DB_ENABLED && fileRepo) {
    for (const file of files) {
      if (!file.name || file.size === 0) {
        if (file.name) failures.push({ filename: file.name, error: "Leere Datei (size = 0)" });
        continue;
      }
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
      } catch (err) {
        // Extraktion fehlgeschlagen — Datei trotzdem speichern. Nur Log,
        // kein Push in failures (das wuerde User verwirren — der File ging
        // ja eh durch).
        const { logInfo } = await import("../../logger.js");
        logInfo(
          `[Upload] Text-Extraktion fehlgeschlagen fuer "${safeName}": ${err instanceof Error ? err.message : String(err)}`,
        );
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
      } catch (err) {
        // KEIN silent-swallow mehr. Bug-Erfahrung: Drag&Drop schien zu klappen
        // ("success: true"), aber files.uploaded war [] — User sah nichts und
        // dachte Upload wurde verschluckt. Jetzt: Fehler loggen + im Response
        // mitschicken, damit die UI eine echte Fehlermeldung anzeigen kann.
        const errMsg = err instanceof Error ? err.message : String(err);
        const { logError } = await import("../../logger.js");
        logError(`[Upload] DB-Save fehlgeschlagen fuer "${safeName}" (project=${project ?? "—"})`, err);
        failures.push({ filename: safeName, error: errMsg });
      }
    }

    if (saved.length > 0) emit({ type: "file", action: "created", id: saved.join(", ") });

    // Nur erfolgreich wenn ALLE Files durchgingen. Bei mindestens einem
    // Fehler: success=false, error mit der ersten Failure-Message — die UI
    // kann das anzeigen.
    if (failures.length > 0 && saved.length === 0) {
      return c.json({ success: false, error: failures[0]!.error, failures }, 500);
    }
    if (failures.length > 0) {
      return c.json({
        success: true,
        uploaded: saved,
        dbEntries,
        partial: true,
        failures,
      });
    }
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

  // Phase-6-Cleanup: vor jedem Download Zugriff pruefen. Sonst koennte
  // jeder authentifizierte User mit einer fremden UUID jede Datei runterladen.
  const fileMeta = await fileRepo.get(id);
  if (!fileMeta) return c.json({ error: "Nicht gefunden" }, 404);
  if (!(await canSeeFile(userCtx(c), fileMeta))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }

  const result = await fileRepo.readBlob(id);
  if (!result) {
    // Kein Blob in DB — pruefen ob die Datei als Legacy-Eintrag noch im
    // Vault liegt (filepath-Feld). Damit brechen bestehende Downloads nicht.
    const legacyPath = path.resolve(WORKSPACE_PATH, fileMeta.filepath);
    if (!legacyPath.startsWith(WORKSPACE_PATH) || !fs.existsSync(legacyPath)) {
      return c.json({ error: "Datei-Blob nicht gefunden" }, 404);
    }
    const buf = fs.readFileSync(legacyPath);
    c.header("Content-Type", fileMeta.mimeType || "application/octet-stream");
    c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(fileMeta.filename)}"`);
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
  // Notification an den Empfaenger (nicht ich selbst).
  if (body.userId !== c.var.userId) {
    void (async () => {
      const file = await fileRepo!.get!(fileId);
      const actor = c.var.dbUser?.displayName ?? c.var.dbUser?.username ?? null;
      if (file) {
        await notifyFileShared(
          body.userId,
          { filename: file.filename, project: file.project },
          body.canEdit === true,
          actor,
        );
      }
    })();
  }
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

// ── File-Starring (Markiert) ────────────────────────────────────────────────
// Pro User. Liefert auch Files zurueck die der User gestartet hat — die
// Reihenfolge ist nach starred_at DESC (neueste oben), nicht nach Datei-
// Datum. Sichtbarkeit wird ueber canSeeFile geprueft, damit ein Star auf
// einer Datei in einem Projekt-ohne-Zugriff (z.B. nach ACL-Wechsel) NICHT
// die Datei zeigt.
filesRoutes.get("/files/starred", async (c) => {
  const ctx = userCtx(c);
  if (!ctx.userId) return c.json([]);
  if (!DB_ENABLED || !fileRepo) return c.json([]);

  const db = getDb();
  const rows = await db`
    SELECT f.id, f.filename, f.filesize, f.filetype, f.updated_at,
           p.name as project_name, fs.starred_at
    FROM file_stars fs
    JOIN files f ON f.id = fs.file_id
    LEFT JOIN projects p ON p.id = f.project_id
    WHERE fs.user_id = ${ctx.userId}
    ORDER BY fs.starred_at DESC
    LIMIT 200
  `;

  // ACL-Filter: ein User darf nur gestartete Files sehen, die er auch
  // sehen darf. Liesse sich theoretisch auch im SELECT loesen, aber
  // canSeeFile zentralisiert die Logik — eine Wahrheit.
  const result: unknown[] = [];
  for (const r of rows) {
    const file = { id: String(r.id), project: r.project_name ? String(r.project_name) : null };
    if (!(await canSeeFile(ctx, file))) continue;
    result.push({
      name: String(r.filename),
      type: "file" as const,
      size: Number(r.filesize || 0),
      modified: String(r.updated_at),
      extension: r.filetype ? String(r.filetype) : "",
      id: String(r.id),
      project: r.project_name ? String(r.project_name) : null,
      starred: true,
    });
  }
  return c.json(result);
});

filesRoutes.post("/files/:id/star", async (c) => {
  const ctx = userCtx(c);
  if (!ctx.userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  const fileId = c.req.param("id");
  if (!fileRepo) return c.json({ error: "DB nicht aktiv" }, 500);
  const file = await fileRepo.get(fileId);
  if (!file) return c.json({ error: "Datei nicht gefunden" }, 404);
  // Nur Files die der User sieht darf er auch starren — sonst koennte
  // jemand UUIDs durchprobieren um die Existenz fremder Files zu testen.
  if (!(await canSeeFile(ctx, file))) {
    return c.json({ error: "Kein Zugriff" }, 403);
  }
  const db = getDb();
  await db`
    INSERT INTO file_stars (file_id, user_id)
    VALUES (${fileId}, ${ctx.userId})
    ON CONFLICT (file_id, user_id) DO NOTHING
  `;
  return c.json({ ok: true, starred: true });
});

filesRoutes.delete("/files/:id/star", async (c) => {
  const ctx = userCtx(c);
  if (!ctx.userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  const fileId = c.req.param("id");
  const db = getDb();
  await db`
    DELETE FROM file_stars WHERE file_id = ${fileId} AND user_id = ${ctx.userId}
  `;
  return c.json({ ok: true, starred: false });
});

// ── Recent (Zuletzt bearbeitet) ─────────────────────────────────────────────
// Files sortiert nach updated_at DESC, max 50 — gefiltert auf was der
// User sehen darf. Im Prinzip eine Variante von /files mit anderer
// Sortierung und kuerzerem Limit.
filesRoutes.get("/files/recent", async (c) => {
  const ctx = userCtx(c);
  if (!DB_ENABLED || !fileRepo) return c.json([]);
  const db = getDb();
  const rows = await db`
    SELECT f.id, f.filename, f.filesize, f.filetype, f.updated_at,
           p.name as project_name, f.uploaded_by
    FROM files f
    LEFT JOIN projects p ON p.id = f.project_id
    ORDER BY f.updated_at DESC
    LIMIT 200
  `;

  // Stars vom aktuellen User in einem Rutsch holen.
  let starredSet = new Set<string>();
  if (ctx.userId) {
    const ids = rows.map((r) => String(r.id));
    if (ids.length > 0) {
      const sr = await db`
        SELECT file_id FROM file_stars WHERE user_id = ${ctx.userId} AND file_id = ANY(${ids})
      `;
      starredSet = new Set(sr.map((r) => String(r.file_id)));
    }
  }

  const out: unknown[] = [];
  for (const r of rows) {
    const file = { id: String(r.id), project: r.project_name ? String(r.project_name) : null };
    // Quick-ACL: bei Admin durch, bei User canSeeFile.
    if (ctx.role !== "admin" && !(await canSeeFile(ctx, file))) continue;
    out.push({
      name: String(r.filename),
      type: "file" as const,
      size: Number(r.filesize || 0),
      modified: String(r.updated_at),
      extension: r.filetype ? String(r.filetype) : "",
      id: String(r.id),
      project: r.project_name ? String(r.project_name) : null,
      starred: starredSet.has(String(r.id)),
    });
    if (out.length >= 50) break;
  }
  return c.json(out);
});

// ── Shared (Geteilt) ────────────────────────────────────────────────────────
// Files, die explizit mit dem aktuellen User geteilt wurden (file_shares).
// Im Gegensatz zu /files (das implizite Sichtbarkeit aus user_projects
// einschliesst) liefert dieses Endpoint NUR Direkt-Shares.
filesRoutes.get("/files/shared", async (c) => {
  const ctx = userCtx(c);
  if (!ctx.userId) return c.json([]);
  if (!DB_ENABLED || !fileRepo) return c.json([]);
  const db = getDb();
  const rows = await db`
    SELECT f.id, f.filename, f.filesize, f.filetype, f.updated_at,
           p.name as project_name, fs.added_at, fs.can_edit
    FROM file_shares fs
    JOIN files f ON f.id = fs.file_id
    LEFT JOIN projects p ON p.id = f.project_id
    WHERE fs.user_id = ${ctx.userId}
    ORDER BY fs.added_at DESC
    LIMIT 200
  `;

  // Stars
  const ids = rows.map((r) => String(r.id));
  let starredSet = new Set<string>();
  if (ids.length > 0) {
    const sr = await db`
      SELECT file_id FROM file_stars WHERE user_id = ${ctx.userId} AND file_id = ANY(${ids})
    `;
    starredSet = new Set(sr.map((r) => String(r.file_id)));
  }

  return c.json(
    rows.map((r) => ({
      name: String(r.filename),
      type: "file" as const,
      size: Number(r.filesize || 0),
      modified: String(r.updated_at),
      extension: r.filetype ? String(r.filetype) : "",
      id: String(r.id),
      project: r.project_name ? String(r.project_name) : null,
      starred: starredSet.has(String(r.id)),
      canEdit: r.can_edit === true,
    })),
  );
});
