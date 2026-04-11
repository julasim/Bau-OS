import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH, DB_ENABLED } from "../../config.js";
import { readFile, listFolder } from "../../workspace/index.js";
import { fileRepo } from "../../data/index.js";
import { emit } from "../events.js";

export const filesRoutes = new Hono();

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
    // Auch vom Filesystem entfernen
    const fullPath = path.resolve(WORKSPACE_PATH, file.filepath);
    if (fullPath.startsWith(WORKSPACE_PATH) && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
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

// ── Upload (Drag & Drop) — speichert auf Filesystem + DB ────────────────────
filesRoutes.post("/files/upload", async (c) => {
  const formData = await c.req.formData();
  const targetDir = (formData.get("path") as string) || "";

  if (targetDir && !safePath(targetDir)) {
    return c.json({ error: "Zugriff verweigert" }, 403);
  }

  const files = formData.getAll("files") as File[];
  if (files.length === 0) return c.json({ error: "Keine Dateien gesendet" }, 400);

  const destDir = targetDir ? path.resolve(WORKSPACE_PATH, targetDir) : WORKSPACE_PATH;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  const saved: string[] = [];
  const dbEntries: Array<{ id: string; filename: string }> = [];

  for (const file of files) {
    if (!file.name || file.size === 0) continue;
    const safeName = file.name.replace(/[<>:"|?*]/g, "_");
    const destPath = path.join(destDir, safeName);

    // Nicht ausserhalb des Workspace schreiben
    if (!destPath.startsWith(WORKSPACE_PATH)) continue;

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(destPath, buffer);

    const relativePath = targetDir ? `${targetDir}/${safeName}` : safeName;
    saved.push(relativePath);

    // In DB speichern wenn aktiv
    if (DB_ENABLED && fileRepo) {
      try {
        // Text extrahieren (PDF, DOCX, Text)
        let contentText: string | undefined;
        try {
          const { extractDocument } = await import("../../workspace/extractor.js");
          const result = await extractDocument(destPath, file.type || "");
          if (result.format !== "unsupported" && result.text) {
            contentText = result.text;
          }
        } catch {
          // Extraktion fehlgeschlagen — Datei trotzdem speichern
        }

        const entry = await fileRepo.save({
          filename: safeName,
          filepath: relativePath,
          filesize: file.size,
          mimeType: file.type || undefined,
          contentText,
        });
        dbEntries.push({ id: entry.id, filename: entry.filename });
      } catch {
        // DB-Speicherung fehlgeschlagen — Datei ist trotzdem auf Filesystem
      }
    }
  }

  if (saved.length > 0) emit({ type: "file", action: "created", id: saved.join(", ") });
  return c.json({ success: true, uploaded: saved, dbEntries });
});
