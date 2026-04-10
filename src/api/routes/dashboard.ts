import { Hono } from "hono";
import { listNotes, listTasks, listTermine, listProjects, listAgents } from "../../vault/index.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/dashboard", (c) => {
  const notes = listNotes();
  const tasks = listTasks();
  const termine = listTermine();
  const projects = listProjects();
  const agents = listAgents();

  const today = new Date().toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
  const todayTermine = termine.filter((t) => t.datum === today || t.datum.includes(today));

  const openTasks = tasks.filter((t) => t.status !== "done");

  return c.json({
    notes: notes.length,
    openTasks: openTasks.length,
    totalTasks: tasks.length,
    todayTermine: todayTermine.map((t) => (t.uhrzeit ? `${t.uhrzeit} – ${t.text}` : t.text)),
    termine: termine.length,
    projects: projects.length,
    agents,
  });
});
