import { Hono } from "hono";
import path from "path";
import { VAULT_PATH } from "../../config.js";
import { readFile, listFolder } from "../../vault/index.js";

export const filesRoutes = new Hono();

// Path-Traversal-Schutz
function safePath(userPath: string): string | null {
  const resolved = path.resolve(VAULT_PATH, userPath);
  if (!resolved.startsWith(VAULT_PATH)) return null;
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
