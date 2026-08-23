import { Hono } from "hono";
import type { Context } from "hono";
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "../../config.js";
import { readFile } from "../../workspace/index.js";
import { fileRepo, projectRepo } from "../../data/index.js";
import { getDb } from "../../db/client.js";
import { emitForProjectName } from "../events.js";
import { validateUpload } from "../file-validation.js";
import type { AppEnv } from "../server.js";
import { projektBezugAusQuery } from "../projekt-bezug.js";
import { canSeeProjectByName } from "../../data/access.js";
import { alsIso } from "../../data/zeitstempel.js";
import { contentDisposition } from "../dateiname.js";

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

// ── Dateien auflisten ───────────────────────────────────────────────────────
//
// Ausschliesslich aus der Datenbank. Der frueher hier stehende
// Filesystem-Zweig (`?path=` / `?source=fs`) ist entfallen — siehe den
// Kopfkommentar bei „Datei lesen".
filesRoutes.get("/files", async (c) => {
  {
    const bezug = await projektBezugAusQuery(c);
    if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
    const project = bezug.name;
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
        projektnummer: f.projektnummer ?? null,
        analyzed: f.analyzed,
      })),
    );
  }

  return c.json([]);
});

// ── Datei lesen ─────────────────────────────────────────────────────────────
//
// NUR ueber die ID, und die geht durch `canAccessFile`.
//
// Der frueher danebenstehende Weg `?path=…` las jede Datei im
// Dokumentenordner aus — ohne jede Rechtepruefung. Geprueft wurde allein, ob
// der Pfad den Ordner nicht verlaesst, nicht WER da liest. Ein Konto ohne
// einen einzigen Projektzugriff kam damit an jeden Vertrag und jede
// Honorarvereinbarung; dieser Ordner ist die Samba-Freigabe „Dokumente".
//
// Er stammt aus der Vault-Zeit und war von der Oberflaeche nie erreichbar:
// Dateien liegen seit dem Umbau als `bytea` in der Datenbank, und der
// Dateibrowser baut seine Ordner logisch aus den Projekten. Ein Weg, den
// niemand braucht, ist besser zu als bewacht — deshalb entfernt statt
// abgesichert. Dasselbe gilt fuer `POST /files/mkdir` und das Loeschen ueber
// einen Pfad; letzteres rief `rmSync(recursive)` auf ganze Baeume.
filesRoutes.get("/files/read", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "id erforderlich (?id=...)" }, 400);
  {
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
});

// ── Loeschen ─────────────────────────────────────────────────────────────────
filesRoutes.delete("/files", async (c) => {
  const body = await c.req.json<{ path?: string; id?: string }>();

  // DB: ueber ID loeschen
  if (body.id) {
    const file = await fileRepo.get(body.id);
    if (!file) return c.json({ error: "Nicht gefunden" }, 404);
    if (!(await isFileOwnerOrAdmin(c, body.id))) return c.json({ error: "Zugriff verweigert" }, 403);
    // Alt-Eintraege aus der Vault-Zeit hatten eine echte Datei im Ordner; die
    // wird best-effort mitgeloescht, damit keine Waisen liegen bleiben.
    //
    // ENTSCHEIDEND ist die Bedingung darauf: nur, wenn der Eintrag KEINEN
    // Inhalt in der Datenbank hat. Bei einem heutigen Upload ist `filepath`
    // schlicht der Dateiname, die Datei selbst liegt als `bytea` in der
    // Datenbank — und `WORKSPACE_PATH` ist die Samba-Freigabe „Dokumente".
    // Ohne diese Bedingung loeschte „Grundriss.pdf in PATIO entfernen" die
    // gleichnamige Datei, die eine Kollegin im Explorer dort liegen hatte.
    // Ohne Rueckfrage, ohne Spur. Nachgewiesen in
    // tests/api-files-freigabe.test.ts.
    const hatInhaltInDb = !!(await fileRepo.readBlob(body.id));
    if (!hatInhaltInDb) {
      const legacyPath = path.resolve(WORKSPACE_PATH, file.filepath);
      if (
        (legacyPath.startsWith(WORKSPACE_PATH + path.sep) || legacyPath === WORKSPACE_PATH) &&
        fs.existsSync(legacyPath)
      ) {
        try {
          fs.unlinkSync(legacyPath);
        } catch {
          /* ignore — der Datenbankeintrag ist das, was zaehlt */
        }
      }
    }
    await fileRepo.delete(body.id);
    emitForProjectName({ type: "file", action: "deleted", id: file.filename }, file.project, {
      actorId: c.get("userId"),
    });
    return c.json({ success: true });
  }

  // Ohne `id` gibt es nichts zu tun: das Loeschen ueber einen PFAD ist
  // entfallen (siehe Kopfkommentar bei „Datei lesen"). Es rief
  // `rmSync(recursive)` auf und konnte damit einen ganzen Projektordner
  // entfernen — von jedem angemeldeten Konto aus.
  return c.json({ error: "id erforderlich" }, 400);
});

// ── Zuletzt bearbeitet ──────────────────────────────────────────────────────
// Gibt die 50 zuletzt geaenderten Dateien zurueck, sortiert nach updatedAt desc.
// Nur DB-Modus — im FS-Modus gibt es kein updatedAt aus der DB.
filesRoutes.get("/files/recent", async (c) => {
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
      projektnummer: f.projektnummer ?? null,
      analyzed: f.analyzed,
    })),
  );
});

// ── Markierte Dateien (Starred) ─────────────────────────────────────────────
// Gibt alle Dateien zurueck, die der aktuelle User markiert (starred) hat.
// Nur DB-Modus; im FS-Modus gibt es keine user_id-Semantik.
filesRoutes.get("/files/starred", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json([]);
  const db = getDb();

  // Der Sichtbarkeitsfilter gehoert in die ABFRAGE, nicht ins Mapping
  // danach: sonst zaehlt `LIMIT 50` die aussortierten Zeilen mit, und die
  // Liste bricht ab, bevor die sichtbaren Dateien alle drin sind.
  //
  // Zu sehen ist eine markierte Datei unter derselben Regel wie ueberall
  // sonst (`canAccessFile`): eigenes Projekt, selbst hochgeladen, oder
  // ausdruecklich freigegeben.
  const sichtbar = await getVisibleProjectIds(c);
  const rows = sichtbar
    ? await db`
    SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize,
           f.mime_type, f.analyzed, f.created_at, f.updated_at,
           p.name as project_name, p.projektnummer as project_nummer
    FROM files f
    JOIN file_stars fs ON f.id = fs.file_id
    LEFT JOIN projects p ON f.project_id = p.id
    WHERE fs.user_id = ${userId}
      AND (
        f.uploaded_by = ${userId}
        OR (f.project_id IS NOT NULL AND f.project_id = ANY(${sichtbar}::uuid[]))
        OR EXISTS (SELECT 1 FROM file_shares sh WHERE sh.file_id = f.id AND sh.user_id = ${userId})
      )
    ORDER BY fs.starred_at DESC
    LIMIT 50
  `
    : await db`
    SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize,
           f.mime_type, f.analyzed, f.created_at, f.updated_at,
           p.name as project_name, p.projektnummer as project_nummer
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
      modified: f.updated_at ? alsIso(f.updated_at) : null,
      extension: f.filetype ? String(f.filetype) : "",
      id: String(f.id),
      project: f.project_name ? String(f.project_name) : null,
      projektnummer: f.project_nummer ? String(f.project_nummer) : null,
      analyzed: !!f.analyzed,
      starred: true,
    })),
  );
});

// ── Geteilte Dateien (Shared with me) ───────────────────────────────────────
// Gibt Dateien zurueck, die andere User mit dem aktuellen User geteilt haben.
filesRoutes.get("/files/shared", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json([]);
  const db = getDb();
  const rows = await db`
    SELECT f.id, f.filename, f.filepath, f.filetype, f.filesize,
           f.mime_type, f.analyzed, f.created_at, f.updated_at,
           p.name as project_name, p.projektnummer as project_nummer, fs2.can_edit
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
      modified: f.updated_at ? alsIso(f.updated_at) : null,
      extension: f.filetype ? String(f.filetype) : "",
      id: String(f.id),
      project: f.project_name ? String(f.project_name) : null,
      projektnummer: f.project_nummer ? String(f.project_nummer) : null,
      analyzed: !!f.analyzed,
      canEdit: f.can_edit === true,
    })),
  );
});

// ── Datei-Suche (DB) ────────────────────────────────────────────────────────
filesRoutes.get("/files/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);
  // Sicherheit: wie bei GET /files den Scope IMMER ermitteln. Admin → undefined
  // (kein Filter), Non-Admin → nur Dateien aus sichtbaren Projekten. Ohne das
  // gab die Suche fremde Dateien inklusive contentText heraus; mit ?q=% sogar
  // den gesamten Bestand. Limit bleibt beim Repo-Default.
  const visibleProjectIds = await getVisibleProjectIds(c);
  const results = await fileRepo.search(q, undefined, visibleProjectIds);
  return c.json(results);
});

// ── Upload (Drag & Drop) ─────────────────────────────────────────────────────
// Die Datei wird als bytea in der files-Tabelle gespeichert, NICHTS landet
// auf der Platte. Der Zweig darunter schreibt in den Vault und ist heute
// unerreichbar: `fileRepo` ist seit dem Umbau non-nullable, und der Dienst
// bricht ohne DATABASE_URL schon beim Start ab (src/index.ts). Er bleibt
// vorerst stehen, weil sein Ausbau die Upload-Route umbaut — das gehoert in
// einen eigenen Schritt, nicht in eine Aufraeumrunde.
filesRoutes.post("/files/upload", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);

  const formData = await c.req.formData();
  // Ein `path`-Feld wird nicht mehr ausgewertet: Dateien liegen in der
  // Datenbank, es gibt keine Ordner, in die man sie legen koennte. Der
  // Projektbezug ist der einzige Ort, an dem eine Datei „hingehoert".
  const project = (formData.get("project") as string) || undefined;

  // ── Rechtepruefung ────────────────────────────────────────────────────────
  //
  // Hier stand keine. Die Datei sah bewacht aus — GET /files, /files/read,
  // /files/search, /files/download und DELETE haben alle ihren Wachposten —,
  // aber der einzige SCHREIBENDE Weg nahm jeden Projektnamen entgegen und
  // reichte ihn an `fileRepo.save()` durch. Damit konnte jedes angemeldete
  // Konto Dateien samt extrahiertem Volltext in ein fremdes Projekt
  // einstellen, und die Datei tauchte dort bei allen Berechtigten auf.
  //
  // Genau dasselbe Muster hatten die drei Team-Routen, die am 23.08.
  // geschlossen wurden: die lesende Seite bewacht, die schreibende vergessen.
  if (project && !(await canSeeProjectByName({ userId, role: c.get("userRole") }, project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }

  const files = formData.getAll("files") as File[];
  if (files.length === 0) return c.json({ error: "Keine Dateien gesendet" }, 400);

  const saved: string[] = [];
  const dbEntries: Array<{ id: string; filename: string }> = [];

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
        // ── Ohne dieses Feld ist das Eigentuemer-Recht wirkungslos ──────────
        //
        // `uploaded_by` blieb NULL, weil die einzige Route, die es setzen
        // koennte, es nicht tat. Folge: `canAccessFile` und
        // `isFileOwnerOrAdmin` pruefen gegen NULL und sagen immer nein — wer
        // eine Datei hochlud, konnte sie weder loeschen noch freigeben, und
        // ein Upload OHNE Projekt war fuer niemanden ausser dem Admin je
        // wieder erreichbar.
        //
        // Die sieben Datei-Rechte-Tests setzten das Feld selbst am Repo
        // vorbei. Sie belegten damit, dass das Recht greift, WENN es gesetzt
        // ist — die Route, die es setzen muss, kam in keinem Test vor.
        uploadedById: userId,
      });
      dbEntries.push({ id: entry.id, filename: entry.filename });
      saved.push(safeName);
    } catch {
      // DB-Fehler — Datei geht verloren (kein Vault-Fallback mehr, weil der
      // User explizit "alles in die DB" wollte).
    }
  }

  if (saved.length > 0)
    emitForProjectName({ type: "file", action: "created", id: saved.join(", ") }, project, {
      actorId: c.get("userId"),
    });
  return c.json({ success: true, uploaded: saved, dbEntries });
});

// ── Download (Blob aus DB ausliefern) ───────────────────────────────────────
filesRoutes.get("/files/download", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "id erforderlich (?id=...)" }, 400);
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
    c.header("Content-Disposition", contentDisposition(file.filename));
    return c.body(new Uint8Array(buf));
  }

  c.header("Content-Type", result.mimeType || "application/octet-stream");
  c.header("Content-Disposition", contentDisposition(result.filename));
  return c.body(new Uint8Array(result.blob));
});

// ── Datei markieren (Star) ──────────────────────────────────────────────────
// POST /files/:id/star — Datei als Favorit markieren (idempotent).
filesRoutes.post("/files/:id/star", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  const fileId = c.req.param("id");
  // Ohne diese Pruefung liess sich jede beliebige UUID markieren — und
  // Dateiname, Projektname und Projektnummer standen danach in der eigenen
  // Merkliste. Ein Leseweg in fremde Projekte, gebaut aus einem Lesezeichen.
  if (!(await canAccessFile(c, fileId))) return c.json({ error: "Zugriff verweigert" }, 403);
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
      addedAt: alsIso(r.added_at),
    })),
  );
});

// POST /files/:id/shares — Datei mit einem User teilen.
// Body: { userId: string, canEdit: boolean }
filesRoutes.post("/files/:id/shares", async (c) => {
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
  const fileId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  if (!(await isFileOwnerOrAdmin(c, fileId))) return c.json({ error: "Zugriff verweigert" }, 403);
  const db = getDb();
  await db`
    DELETE FROM file_shares WHERE file_id = ${fileId} AND user_id = ${targetUserId}
  `;
  return c.json({ ok: true });
});
