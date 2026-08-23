// ============================================================
// PATIO — Aufgabensystem (Baustufe 1)
// ============================================================
//   GET    /api/aufgabensystem/matrix      → vier Spalten mit Zahlen
//   GET    /api/aufgabensystem/tagesplan   → Auswahl + gerechnetes Budget
//   PUT    /api/aufgabensystem/tagesplan/:id   { drin: boolean }
//
// Die Regeln der Spezifikation stehen als ZAHLEN in den Antworten, nicht als
// Verbote in den Routen. Keine dieser Routen lehnt etwas ab, weil eine Grenze
// überschritten ist — sie liefern die Zahl, und die Oberfläche verlangt eine
// bewusste Bestätigung.
//
// Das ist keine Nachlässigkeit, sondern Grundsatz 04 der Spezifikation: eine
// harte Sperre wird nach der zweiten Umgehung zur Gewohnheit, und dann ist
// das ganze System entwertet. Eine Grenze, die man mit einer bewussten
// Bestätigung überschreiten kann, wirkt dagegen dauerhaft — weil man sich
// beim Bestätigen selbst zusieht.
//
// ── Warum das Feld `tagesbudget` heisst und nicht `budget` ──────────────────
//
// Weil der Geld-Filter (`src/api/geld.ts`) es sonst wegwirft. Er erkennt
// Geldbetraege an FELDNAMEN aus einer festen Liste, und `budget` steht dort —
// gemeint ist das Projektbudget in Euro.
//
// Das Tagesbudget ist aber eine ZEIT, kein Geld. Beim ersten Bau hiess das
// Feld trotzdem `budget`, und die Folge war praezise das, was ein
// namensbasierter Filter eben anrichtet: fuer jedes Konto OHNE Geld-Recht kam
// `{}` zurueck — Status 200, kein Fehler, kein Log, nur ein leeres Objekt und
// ein Balken, der bei null stehenblieb. Aufgefallen ist es nur, weil ein Test
// den Tagesplan aus der Sicht eines normalen Kontos geprueft hat.
//
// Merksatz fuer neue Felder: Namen aus `GELD_FELDER` meiden, wenn kein Geld
// gemeint ist.
// ============================================================

import { Hono } from "hono";
import type { Context } from "hono";
import { aufgabensystemRepo, taskRepo } from "../../data/index.js";
import { getVisibleProjectIds, canSeeProjectByName } from "../../data/access.js";
import type { AppEnv } from "../server.js";

export const aufgabensystemRoutes = new Hono<AppEnv>();

/** Sichtbarkeit einmal ermitteln — die Route tut das, nicht das Repository
 *  (siehe src/data/access.ts und die Architektur-Doku). */
async function sichtbarkeit(c: Context<AppEnv>) {
  const sichtbareProjekte = await getVisibleProjectIds({ userId: c.var.userId, role: c.var.userRole });
  return { sichtbareProjekte, benutzerId: String(c.var.userId ?? "") };
}

aufgabensystemRoutes.get("/aufgabensystem/matrix", async (c) => {
  return c.json(await aufgabensystemRepo.matrix(await sichtbarkeit(c)));
});

aufgabensystemRoutes.get("/aufgabensystem/tagesplan", async (c) => {
  const s = await sichtbarkeit(c);
  // Beides in EINER Antwort: die Oberflaeche zeigt Balken und Liste
  // nebeneinander, zwei Aufrufe waeren zwei Zeitpunkte — und damit ein
  // Balken, der kurz etwas anderes behauptet als die Liste darunter.
  const [tagesbudget, aufgaben] = await Promise.all([
    aufgabensystemRepo.tagesplanBudget(s),
    aufgabensystemRepo.tagesplanAufgaben(s),
  ]);
  // Das Feld heisst `tagesbudget` und NICHT `budget` — siehe Kasten oben.
  return c.json({ tagesbudget, aufgaben });
});

aufgabensystemRoutes.put("/aufgabensystem/tagesplan/:id", async (c) => {
  const id = c.req.param("id");

  let body: { drin?: boolean };
  try {
    body = await c.req.json<{ drin?: boolean }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (typeof body.drin !== "boolean") {
    return c.json({ error: "Feld `drin` (true/false) fehlt" }, 400);
  }

  // 404 vor 403: sonst verraet der Statuscode, welche IDs es gibt.
  const aufgabe = await taskRepo.get(id);
  if (!aufgabe) return c.json({ error: "Aufgabe nicht gefunden" }, 404);

  // Rechte wie bei jeder anderen Schreibroute auf Aufgaben: Projektaufgaben
  // nach Projekt, persoenliche nach Ersteller.
  const ctx = { userId: c.var.userId, role: c.var.userRole };
  if (ctx.role !== "admin") {
    const erlaubt = aufgabe.project
      ? await canSeeProjectByName(ctx, aufgabe.project)
      : aufgabe.createdById === c.var.userId;
    if (!erlaubt) return c.json({ error: "Kein Zugriff" }, 403);
  }

  const ok = await aufgabensystemRepo.setzeTagesplan(id, String(c.var.userId ?? ""), body.drin);
  if (!ok) return c.json({ error: "Aufgabe nicht gefunden" }, 404);

  // Das gerechnete Budget gleich mitliefern: die Oberflaeche braucht es
  // unmittelbar nach jeder Uebernahme, und ein zweiter Aufruf waere ein
  // Zustand, in dem Balken und Auswahl kurz auseinanderlaufen.
  const tagesbudget = await aufgabensystemRepo.tagesplanBudget(await sichtbarkeit(c));
  return c.json({ ok: true, tagesbudget });
});
