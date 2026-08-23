// ============================================================
// PATIO — Benachrichtigungen (Migration 058)
// ============================================================
//   GET    /api/benachrichtigungen              → eigene Liste
//   GET    /api/benachrichtigungen/anzahl       → Zähler für die Glocke
//   POST   /api/benachrichtigungen/:id/gelesen  → eine als gelesen
//   POST   /api/benachrichtigungen/gelesen      → alle als gelesen
//
// ── Warum hier keine Rechteprüfung gegen Projekte steht ────────────────────
//
// Weil eine Benachrichtigung an eine PERSON gerichtet ist, nicht an ein
// Projekt. Der Empfänger steht in jeder Abfrage in der WHERE-Bedingung — es
// gibt keinen Weg, an fremde Meldungen zu kommen, weil es keine Abfrage ohne
// den eigenen Empfänger gibt.
//
// Das ist bewusst enger als „prüfen und dann ausliefern": eine Prüfung kann
// man vergessen, eine WHERE-Bedingung nicht.
// ============================================================

import { Hono } from "hono";
import { benachrichtigungenRepo } from "../../data/index.js";
import type { AppEnv } from "../server.js";

export const benachrichtigungenRoutes = new Hono<AppEnv>();

benachrichtigungenRoutes.get("/benachrichtigungen", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  const nurUngelesen = c.req.query("ungelesen") === "1";
  const limitRoh = c.req.query("limit");
  const limit = limitRoh ? Math.min(Math.max(parseInt(limitRoh, 10) || 50, 1), 200) : 50;
  return c.json(await benachrichtigungenRepo.liste(userId, nurUngelesen, limit));
});

// ⚠ MUSS vor `/benachrichtigungen/:id/gelesen` stehen — Hono trifft in
// Registrierungsreihenfolge. Dieselbe Falle hat `/meetings/recent` seit dem
// Bau unerreichbar gemacht.
benachrichtigungenRoutes.get("/benachrichtigungen/anzahl", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  return c.json({ ungelesen: await benachrichtigungenRepo.zaehleUngelesen(userId) });
});

benachrichtigungenRoutes.post("/benachrichtigungen/gelesen", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  return c.json({ anzahl: await benachrichtigungenRepo.alleAlsGelesen(userId) });
});

benachrichtigungenRoutes.post("/benachrichtigungen/:id/gelesen", async (c) => {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Nicht authentifiziert" }, 401);
  const ok = await benachrichtigungenRepo.alsGelesen(c.req.param("id"), userId);
  // 404 auch dann, wenn die Meldung existiert und einem anderen gehört —
  // sonst verrät der Statuscode, welche IDs es gibt.
  if (!ok) return c.json({ error: "Nicht gefunden" }, 404);
  return c.json({ ok: true });
});
