import { Hono } from "hono";
import { terminRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import { notifyTerminInvited, resolveUserIdsFromMembers } from "../../notifications.js";

export const termineRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

termineRoutes.get("/termine", async (c) => {
  const project = c.req.query("project");
  const all = await terminRepo.list(project);
  const ctx = userCtx(c);
  if (ctx.role === "admin") return c.json(all);

  const visible = await getVisibleProjectIds(ctx);
  if (visible === "all") return c.json(all);
  const visibleNames = new Set(await projectRepo.list(visible));
  const me = ctx.userId;

  const filtered = all.filter((t) => {
    if (t.project) return visibleNames.has(t.project);
    // ohne Projekt: User darf den Termin sehen, wenn er Teilnehmer ist.
    return !!me && Array.isArray(t.assigneeIds) && t.assigneeIds.includes(me);
  });
  return c.json(filtered);
});

termineRoutes.get("/termine/:id", async (c) => {
  const termin = await terminRepo.get(c.req.param("id"));
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  const ctx = userCtx(c);
  if (ctx.role !== "admin") {
    const allowed = termin.project
      ? await canSeeProjectByName(ctx, termin.project)
      : !!ctx.userId && Array.isArray(termin.assigneeIds) && termin.assigneeIds.includes(ctx.userId);
    if (!allowed) return c.json({ error: "Kein Zugriff" }, 403);
  }
  return c.json(termin);
});

termineRoutes.post("/termine", async (c) => {
  const body = await c.req.json<{
    datum: string;
    text: string;
    uhrzeit?: string;
    endzeit?: string;
    location?: string;
    assignees?: string[];
    assigneeIds?: string[];
    project?: string;
  }>();
  if (!body.datum || !body.text) return c.json({ error: "Datum und Text erforderlich" }, 400);
  if (body.project && !(await canSeeProjectByName(userCtx(c), body.project))) {
    return c.json({ error: "Kein Zugriff auf dieses Projekt" }, 403);
  }
  const termin = await terminRepo.save(body.datum, body.text, body.uhrzeit, body.project);
  if (typeof termin === "string") return c.json({ error: termin }, 400);
  let result = termin;
  if (body.endzeit || body.location || body.assignees?.length || body.assigneeIds?.length) {
    const updated = await terminRepo.update(
      termin.id,
      {
        endzeit: body.endzeit ?? null,
        location: body.location ?? null,
        assignees: body.assignees ?? [],
        assigneeIds: body.assigneeIds ?? [],
      },
      body.project,
    );
    if (updated) result = updated;
  }
  emit({ type: "termin", action: "created", id: termin.id, project: body.project });
  // Notification an alle Teilnehmer mit verlinktem User-Account.
  if (body.assigneeIds && body.assigneeIds.length > 0) {
    void (async () => {
      const userIds = await resolveUserIdsFromMembers(body.assigneeIds!);
      if (userIds.length > 0) {
        const actor = c.var.dbUser?.displayName ?? c.var.dbUser?.username ?? null;
        await notifyTerminInvited(
          userIds,
          {
            text: result.text,
            datum: result.datum,
            uhrzeit: result.uhrzeit,
            project: body.project ?? null,
          },
          c.var.userId,
          actor,
        );
      }
    })();
  }
  return c.json(result, 201);
});

termineRoutes.put("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<
    Partial<{
      text: string;
      datum: string;
      uhrzeit: string | null;
      endzeit: string | null;
      location: string | null;
      assignees: string[];
      assigneeIds: string[];
    }>
  >();
  // Vorigen Stand laden, damit wir nur NEUE Teilnehmer benachrichtigen
  // (kein Spam wenn nur Datum/Ort geaendert wird).
  const prev = await terminRepo.get(id);
  const termin = await terminRepo.update(id, body);
  if (!termin) return c.json({ error: "Termin nicht gefunden" }, 404);
  emit({ type: "termin", action: "updated", id });
  if ("assigneeIds" in body && Array.isArray(body.assigneeIds)) {
    const prevIds = new Set(prev?.assigneeIds ?? []);
    const added = body.assigneeIds.filter((mid) => !prevIds.has(mid));
    if (added.length > 0) {
      void (async () => {
        const userIds = await resolveUserIdsFromMembers(added);
        if (userIds.length > 0) {
          const actor = c.var.dbUser?.displayName ?? c.var.dbUser?.username ?? null;
          await notifyTerminInvited(
            userIds,
            {
              text: termin.text,
              datum: termin.datum,
              uhrzeit: termin.uhrzeit,
              project: termin.project,
            },
            c.var.userId,
            actor,
          );
        }
      })();
    }
  }
  return c.json(termin);
});

termineRoutes.delete("/termine/:id", async (c) => {
  const id = c.req.param("id");
  const ok = await terminRepo.delete(id);
  if (ok) emit({ type: "termin", action: "deleted", id });
  return c.json({ ok });
});

// Legacy compat
termineRoutes.delete("/termine", async (c) => {
  const { text, project } = await c.req.json<{ text: string; project?: string }>();
  if (!text) return c.json({ error: "Text erforderlich" }, 400);
  const ok = await terminRepo.delete(text, project);
  if (ok) emit({ type: "termin", action: "deleted", project });
  return c.json({ success: ok });
});
