import { Hono } from "hono";
import { searchVault } from "../../vault/index.js";

export const searchRoutes = new Hono();

searchRoutes.get("/search", (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);

  const project = c.req.query("project");
  const results = searchVault(q, project);
  return c.json(results);
});
