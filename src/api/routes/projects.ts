import { Hono } from "hono";
import { listProjects, getProjectInfo } from "../../vault/index.js";

export const projectsRoutes = new Hono();

projectsRoutes.get("/projects", (c) => {
  const projects = listProjects();
  return c.json(projects);
});

projectsRoutes.get("/projects/:name", (c) => {
  const name = c.req.param("name");
  const info = getProjectInfo(name);
  if (!info) return c.json({ error: "Projekt nicht gefunden" }, 404);
  return c.json(info);
});
