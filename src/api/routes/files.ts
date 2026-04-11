import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { WORKSPACE_PATH } from "../../config.js";
import { readFile, listFolder } from "../../workspace/index.js";
import { emit } from "../events.js";

export const filesRoutes = new Hono();

// Path-Traversal-Schutz
function safePath(userPath: string): string | null {
  const resolved = path.resolve(WORKSPACE_PATH, userPath);
  if (!resolved.startsWith(WORKSPACE_PATH)) return null;
  return userPath;
}

filesRoutes.get("/files", (c) => {
  const p = c.req.query("path") || "";
  if (p && !safePath(p)) return c.json({ error: "Zugriff verweigert" }, 403);
  const items = listFolder(p);
  return c.json(items);
});

filesRoutes.get("/files/read", (c) => {
  const p = c.req.query("path");
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
  const body = await c.req.json<{ path: string }>();
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

// ── Upload (Drag & Drop) ────────────────────────────────────────────────────
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
  for (const file of files) {
    if (!file.name || file.size === 0) continue;
    const safeName = file.name.replace(/[<>:"|?*]/g, "_");
    const destPath = path.join(destDir, safeName);

    // Nicht ausserhalb des Workspace schreiben
    if (!destPath.startsWith(WORKSPACE_PATH)) continue;

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    saved.push(targetDir ? `${targetDir}/${safeName}` : safeName);
  }

  if (saved.length > 0) emit({ type: "file", action: "created", id: saved.join(", ") });
  return c.json({ success: true, uploaded: saved });
});
