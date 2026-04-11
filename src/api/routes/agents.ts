import { Hono } from "hono";
import { listAgents, inspectAgentWorkspace, readAgentFile, writeAgentFile } from "../../workspace/index.js";

const EDITABLE_FILES = [
  "SOUL.md",
  "BOOT.md",
  "AGENTS.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "USER.md",
  "IDENTITY.md",
  "MEMORY.md",
];

export const agentsRoutes = new Hono();

agentsRoutes.get("/agents", (c) => {
  const agents = listAgents();
  return c.json(agents);
});

agentsRoutes.get("/agents/:name", (c) => {
  const name = c.req.param("name");
  const info = inspectAgentWorkspace(name);
  return c.json(info);
});

agentsRoutes.get("/agents/:name/files/:filename", (c) => {
  const name = c.req.param("name");
  const filename = c.req.param("filename");
  const content = readAgentFile(name, filename);
  if (content === null) return c.json({ error: "Datei nicht gefunden" }, 404);
  return c.json({ name: filename, content });
});

agentsRoutes.put("/agents/:name/files/:filename", async (c) => {
  const name = c.req.param("name");
  const filename = c.req.param("filename");

  if (!EDITABLE_FILES.includes(filename)) {
    return c.json({ error: "Diese Datei kann nicht bearbeitet werden" }, 403);
  }

  const { content } = await c.req.json<{ content: string }>();
  if (content === undefined) return c.json({ error: "Inhalt erforderlich" }, 400);

  writeAgentFile(name, filename, content);
  return c.json({ success: true });
});
