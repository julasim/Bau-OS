// ============================================================
// PATIO — Entscheidungslog (Migration 045)
// ============================================================
//   GET    /api/projects/:projectName/entscheidungen   → Liste
//   POST   /api/projects/:projectName/entscheidungen   → anlegen
//   GET    /api/entscheidungen/recent                  → projektuebergreifend
//   GET    /api/entscheidungen/:id                     → einzeln
//   PATCH  /api/entscheidungen/:id                     → aendern
//   DELETE /api/entscheidungen/:id                     → loeschen
//
// Die Rechte haengen am Projekt: wer das Projekt sehen darf, darf auch seine
// Entscheidungen lesen und anlegen. Die Routen, die nur eine ID kennen, loesen
// das Projekt aus dem Datensatz auf und pruefen dann.
// ============================================================

import { Hono } from "hono";
import { entscheidungRepo, projectRepo } from "../../data/index.js";
import {
  canSeeProject,
  canSeeProjectByName,
  getVisibleProjectIds,
  type UserCtx,
  type Rolle,
} from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import type { EntscheidungInput } from "../../data/types.js";

export const entscheidungenRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Projekt aus dem Pfad + Rechtepruefung. */
async function resolveProject(c: {
  req: { param: (k: string) => string };
  json: (obj: unknown, status?: number) => Response;
  var: { userId: string | null; userRole: Rolle };
}): Promise<{ id: string; name: string } | { error: Response }> {
  const projectName = decodeURIComponent(c.req.param("projectName") ?? "");
  if (!projectName) return { error: c.json({ error: "Projektname fehlt" }, 400) };
  if (!(await canSeeProjectByName(userCtx(c), projectName))) {
    return { error: c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403) };
  }
  const info = await projectRepo.getInfo(projectName);
  if (!info?.id) return { error: c.json({ error: "Projekt nicht gefunden" }, 404) };
  return { id: info.id, name: info.name };
}

/** Laedt die Entscheidung und prueft, ob der Aufrufer ihr Projekt sehen darf.
 *  404 kommt vor 403 — sonst verriete der Statuscode, welche IDs existieren. */
async function ladenMitRecht(c: {
  req: { param: (k: string) => string };
  json: (obj: unknown, status?: number) => Response;
  var: { userId: string | null; userRole: Rolle };
}) {
  const id = c.req.param("id");
  const entscheidung = await entscheidungRepo.get(id);
  if (!entscheidung) return { error: c.json({ error: "Entscheidung nicht gefunden" }, 404) };
  // ── Warum ueber die ID und nicht ueber den Projektnamen ─────────────────
  //
  // Hier stand `if (ctx.role !== "admin" && entscheidung.projectName)`. Das ist ein
  // Skip-Muster: fehlt der Projektname, faellt die GANZE Pruefung aus, und der
  // Datensatz wird ausgeliefert. Heute ist der Fall nicht ausloesbar
  // (`project_id` ist NOT NULL, der Name kommt aus dem Join) — aber es ist
  // eine gestellte Falle: ein LEFT JOIN, ein umbenanntes Feld, ein Projekt im
  // Papierkorb, und die Rechtepruefung schaltet sich still ab.
  //
  // Ueber die UUID gibt es den Fall gar nicht erst. Nebenbei spart es die
  // Namensaufloesung, die `canSeeProjectByName` sonst zusaetzlich macht.
  const ctx = userCtx(c);
  if (!(await canSeeProject(ctx, entscheidung.projectId))) {
    return { error: c.json({ error: "Kein Zugriff" }, 403) };
  }
  return { id, entscheidung };
}

// ── Liste pro Projekt ────────────────────────────────────────
entscheidungenRoutes.get("/projects/:projectName/entscheidungen", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  const limitRoh = c.req.query("limit");
  const limit = limitRoh ? Math.min(Math.max(parseInt(limitRoh, 10) || 50, 1), 200) : 50;
  return c.json(await entscheidungRepo.list(proj.id, limit));
});

// ── Anlegen ──────────────────────────────────────────────────
entscheidungenRoutes.post("/projects/:projectName/entscheidungen", async (c) => {
  const proj = await resolveProject(c);
  if ("error" in proj) return proj.error;
  let body: EntscheidungInput;
  try {
    body = await c.req.json<EntscheidungInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await entscheidungRepo.create(proj.id, body, c.var.userId);
  if (typeof result === "string") return c.json({ error: result }, 400);
  emit({ type: "entscheidung", action: "created", id: result.id, projectId: proj.id }, { actorId: c.var.userId });
  return c.json(result, 201);
});

// ── Projektuebergreifend ─────────────────────────────────────
//
// MUSS vor `/entscheidungen/:id` stehen: Hono trifft in
// Registrierungsreihenfolge, nicht nach Genauigkeit. Darunter eingehaengt
// landete „recent" als ID-Wert im Platzhalter und ergaebe 404.
entscheidungenRoutes.get("/entscheidungen/recent", async (c) => {
  const limitRoh = c.req.query("limit");
  const limit = limitRoh ? Math.min(Math.max(parseInt(limitRoh, 10) || 20, 1), 100) : 20;
  const sichtbar = await getVisibleProjectIds(userCtx(c));
  return c.json(await entscheidungRepo.listRecent(sichtbar, limit));
});

// ── Einzeln ──────────────────────────────────────────────────
entscheidungenRoutes.get("/entscheidungen/:id", async (c) => {
  const res = await ladenMitRecht(c);
  if ("error" in res) return res.error;
  return c.json(res.entscheidung);
});

// ── Aendern ──────────────────────────────────────────────────
entscheidungenRoutes.patch("/entscheidungen/:id", async (c) => {
  const res = await ladenMitRecht(c);
  if ("error" in res) return res.error;

  let body: Partial<EntscheidungInput>;
  try {
    body = await c.req.json<Partial<EntscheidungInput>>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  // Ein veralteter `rev` wirft KonfliktFehler — `app.onError` macht daraus
  // einen 409 samt aktuellem Stand.
  const aktualisiert = await entscheidungRepo.update(res.id, body);
  if (typeof aktualisiert === "string") return c.json({ error: aktualisiert }, 400);
  if (!aktualisiert) return c.json({ error: "Entscheidung nicht gefunden" }, 404);
  emit(
    {
      type: "entscheidung",
      action: "updated",
      id: res.id,
      projectId: res.entscheidung.projectId,
    },
    { actorId: c.var.userId },
  );
  return c.json(aktualisiert);
});

// ── Loeschen ─────────────────────────────────────────────────
entscheidungenRoutes.delete("/entscheidungen/:id", async (c) => {
  const res = await ladenMitRecht(c);
  if ("error" in res) return res.error;
  const ok = await entscheidungRepo.delete(res.id);
  if (ok) {
    emit(
      {
        type: "entscheidung",
        action: "deleted",
        id: res.id,
        projectId: res.entscheidung.projectId,
      },
      { actorId: c.var.userId },
    );
  }
  return c.json({ ok });
});
