// ============================================================
// PATIO — Positionskatalog (Migration 046)
// ============================================================
//   GET    /api/positionskatalog       → Liste
//   POST   /api/positionskatalog       → anlegen
//   PATCH  /api/positionskatalog/:id   → aendern
//   DELETE /api/positionskatalog/:id   → loeschen
//
// Der Katalog gilt fuers ganze Buero UND besteht aus Preisen. Beides zusammen
// heisst: er haengt am Geld-Recht (Migration 043), nicht an der Rolle — und
// zwar vollstaendig, auch beim Lesen.
//
// Der Antwort-Filter aus `src/api/geld.ts` allein genuegt hier nicht: er
// wuerde `einzelpreis` entfernen und eine Liste von Leistungsbezeichnungen
// ohne Preise uebriglassen. Das ist keine nuetzliche Teilansicht, sondern eine
// Huelle — wie bei `GET /projects/:name/finance` ist ein 403 die ehrliche
// Antwort.
// ============================================================

import { Hono } from "hono";
import { positionskatalogRepo } from "../../data/index.js";
import type { AppEnv } from "../server.js";
import { darfGeldSehen } from "../geld.js";
import type { PositionskatalogInput } from "../../data/types.js";

export const positionskatalogRoutes = new Hono<AppEnv>();

// Vor den Routen — Hono wendet Middleware in Registrierungsreihenfolge an.
positionskatalogRoutes.use("/positionskatalog", async (c, next) => {
  if (!darfGeldSehen(c)) return c.json({ error: "Kein Zugriff auf Betraege" }, 403);
  await next();
});
positionskatalogRoutes.use("/positionskatalog/*", async (c, next) => {
  if (!darfGeldSehen(c)) return c.json({ error: "Kein Zugriff auf Betraege" }, 403);
  await next();
});

positionskatalogRoutes.get("/positionskatalog", async (c) => {
  return c.json(await positionskatalogRepo.list());
});

positionskatalogRoutes.post("/positionskatalog", async (c) => {
  let body: PositionskatalogInput;
  try {
    body = await c.req.json<PositionskatalogInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const result = await positionskatalogRepo.create(body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  return c.json(result, 201);
});

positionskatalogRoutes.patch("/positionskatalog/:id", async (c) => {
  let body: PositionskatalogInput;
  try {
    body = await c.req.json<PositionskatalogInput>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  // Ein veralteter `rev` wirft KonfliktFehler — `app.onError` macht daraus 409.
  const result = await positionskatalogRepo.update(c.req.param("id"), body);
  if (typeof result === "string") return c.json({ error: result }, 400);
  if (!result) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  return c.json(result);
});

positionskatalogRoutes.delete("/positionskatalog/:id", async (c) => {
  const ok = await positionskatalogRepo.delete(c.req.param("id"));
  if (!ok) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  return c.json({ ok });
});
