import { Hono } from "hono";
import { noteRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx, type Rolle } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import type { NoteMeta, NoteSummary } from "../../data/types.js";
import { emitForProjectName } from "../events.js";
import { projektBezug } from "../projekt-bezug.js";

export const notesRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

notesRoutes.get("/notes", async (c) => {
  const detailed = c.req.query("detailed");
  const ctx = userCtx(c);

  // Detailed-Mode: liefert Project-Info pro Notiz, also filtern wir hier.
  if (detailed === "1" && noteRepo.listDetailed) {
    const notes = await noteRepo.listDetailed(50);
    if (ctx.role === "admin") return c.json(notes);
    const visible = await getVisibleProjectIds(ctx);
    if (visible === "all") return c.json(notes);
    const visibleNames = new Set(await projectRepo.list(visible));
    return c.json(notes.filter((n) => sichtbarFuer(n, visibleNames, ctx)));
  }

  // Simple-Mode (nur Titel): wir muessen auch hier den User-Scope respektieren.
  // Loesung: fuer Non-Admins via listDetailed laufen, dann auf Titles mappen.
  if (ctx.role !== "admin" && noteRepo.listDetailed) {
    const visible = await getVisibleProjectIds(ctx);
    if (visible !== "all") {
      const visibleNames = new Set(await projectRepo.list(visible));
      const detailed = await noteRepo.listDetailed(500);
      return c.json(detailed.filter((n) => sichtbarFuer(n, visibleNames, ctx)).map((n) => n.title));
    }
  }
  const notes = await noteRepo.list();
  return c.json(notes);
});

/** Darf dieser Aufrufer diese Notiz in seiner Liste sehen?
 *
 *  Zwei Faelle, wie bei Aufgaben und Terminen auch:
 *  - MIT Projekt: sichtbar, wenn das Projekt sichtbar ist.
 *  - OHNE Projekt: persoenlich — sichtbar nur fuer den Verfasser.
 *
 *  Der zweite Fall fehlte. Wer eine Notiz ohne Projekt anlegte, durfte das —
 *  und sah sie danach nie wieder. Moeglich wurde die Unterscheidung erst,
 *  seit `notes.created_by` beim Anlegen gesetzt wird. */
function sichtbarFuer(n: NoteSummary, sichtbareProjekte: Set<string>, ctx: UserCtx): boolean {
  if (n.project) return sichtbareProjekte.has(n.project);
  return !!n.createdById && n.createdById === ctx.userId;
}

/** Loest die Notiz auf UND prueft die Rechte — in einem Schritt.
 *
 *  Frueher standen hier zwei Funktionen, die den Namen unabhaengig
 *  voneinander aufloesten, mit unterschiedlicher Sortierung (`updated_at`
 *  gegen `created_at`). Bei zwei Notizen desselben Titels entschieden sie
 *  ueber VERSCHIEDENE Zeilen: freigegeben wurde die eine, ausgeliefert die
 *  andere — auch aus einem fremden Projekt. Nachgewiesen und in
 *  `tests/api-notes-acl.test.ts` festgehalten.
 *
 *  Deshalb gibt diese Funktion die aufgeloeste Notiz ZURUECK. Die Routen
 *  arbeiten danach ueber ihre `id`; Entscheidung und Zugriff betreffen damit
 *  nachweislich dieselbe Zeile. */
async function notizMitRecht(
  ctx: UserCtx,
  name: string,
): Promise<{ ok: true; notiz: NoteMeta } | { ok: false; status: 403 | 404; error: string }> {
  const notiz = noteRepo.resolve ? await noteRepo.resolve(name) : null;
  if (!notiz) return { ok: false, status: 404, error: "Notiz nicht gefunden" };
  if (ctx.role === "admin") return { ok: true, notiz };

  if (!notiz.project) {
    // Persoenliche Notiz: nur der Verfasser.
    if (notiz.createdById && notiz.createdById === ctx.userId) return { ok: true, notiz };
    return { ok: false, status: 403, error: "Kein Zugriff" };
  }
  if (!(await canSeeProjectByName(ctx, notiz.project))) {
    return { ok: false, status: 403, error: "Kein Zugriff" };
  }
  return { ok: true, notiz };
}

notesRoutes.get("/notes/:name", async (c) => {
  const guard = await notizMitRecht(userCtx(c), c.req.param("name"));
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  // Ueber die ID, nicht ueber den Namen — sonst kaeme hier womoeglich eine
  // andere Notiz heraus als die eben freigegebene.
  const gelesen = await noteRepo.readById?.(guard.notiz.id);
  if (!gelesen) return c.json({ error: "Notiz nicht gefunden" }, 404);
  // Der Zaehler geht mit, damit die Oberflaeche ihn beim Speichern
  // zurueckschicken kann (Konfliktschutz, Migration 042).
  return c.json({ name: guard.notiz.title, content: gelesen.content, rev: gelesen.rev });
});

notesRoutes.post("/notes", async (c) => {
  const koerper = await c.req.json<{
    content: string;
    project?: string;
    projectId?: string;
    /** Dritte Bezugsart (Migration 052) — siehe src/api/projekt-bezug.ts. */
    projektnummer?: string;
  }>();
  const content = koerper.content;
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  const bezug = await projektBezug(koerper);
  if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
  const project = bezug.name ?? undefined;
  if (project && !(await canSeeProjectByName(userCtx(c), project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const path = await noteRepo.save(content, project, c.var.userId);
  emitForProjectName({ type: "note", action: "created" }, project, { actorId: c.var.userId });
  return c.json({ path }, 201);
});

notesRoutes.put("/notes/:name", async (c) => {
  const guard = await notizMitRecht(userCtx(c), c.req.param("name"));
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);

  const { content, rev } = await c.req.json<{ content: string; rev?: number }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);

  // `rev` ist der beim Laden mitgelieferte Zaehler. Fehlt er, gilt weiterhin
  // „zuletzt gewinnt" — aeltere Aufrufer bleiben damit lauffaehig.
  const success = await noteRepo.updateById?.(guard.notiz.id, content, rev);
  if (success) {
    emitForProjectName({ type: "note", action: "updated", id: guard.notiz.title }, guard.notiz.project, {
      actorId: c.var.userId,
    });
  }
  return c.json({ success: !!success });
});

notesRoutes.patch("/notes/:name/append", async (c) => {
  const guard = await notizMitRecht(userCtx(c), c.req.param("name"));
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  const { content } = await c.req.json<{ content: string }>();
  if (!content) return c.json({ error: "Inhalt erforderlich" }, 400);
  // Ueber die ID: `append` nimmt zwar einen Namen, aber die aufgeloeste ID
  // ist eindeutig und trifft damit garantiert die freigegebene Notiz.
  const success = await noteRepo.append(guard.notiz.id, content);
  if (success) {
    emitForProjectName({ type: "note", action: "updated", id: guard.notiz.title }, guard.notiz.project, {
      actorId: c.var.userId,
    });
  }
  return c.json({ success });
});

notesRoutes.delete("/notes/:name", async (c) => {
  const guard = await notizMitRecht(userCtx(c), c.req.param("name"));
  if (!guard.ok) return c.json({ error: guard.error }, guard.status);
  const deleted = await noteRepo.deleteById?.(guard.notiz.id);
  if (!deleted) return c.json({ error: "Notiz nicht gefunden" }, 404);
  // Bekannte Einschraenkung: die Notiz ist an dieser Stelle bereits geloescht,
  // ihr Projekt also nicht mehr aufloesbar. Das Ereignis geht deshalb
  // projektlos raus und erreicht nur Admins und den Loeschenden — die uebrigen
  // Projektberechtigten sehen das Verschwinden erst beim naechsten Laden.
  // Anders als frueher ist das Projekt hier bekannt: es stammt aus der
  // Aufloesung VOR dem Loeschen. Das Ereignis erreicht damit alle
  // Projektberechtigten, nicht nur Admins und den Loeschenden.
  emitForProjectName({ type: "note", action: "deleted", id: deleted }, guard.notiz.project, {
    actorId: c.var.userId,
  });
  return c.json({ deleted });
});
