import { Hono } from "hono";
import { terminRepo, projectRepo } from "../../data/index.js";
import { canSeeProjectByName, getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { emit } from "../events.js";
import { notifyTerminInvited, resolveUserIdsFromMembers } from "../../notifications.js";
import { getMsAccount } from "../../data/db-microsoft.js";
import { pushToOutlook, deleteFromOutlook } from "../../sync/microsoft-sync.js";
import { logError } from "../../logger.js";

export const termineRoutes = new Hono<AppEnv>();

/** Markiert den Termin als pending fuer den MS-Sync und triggert async-Push.
 *  Fire-and-forget: wenn Microsoft Graph gerade down ist, bleibt der Termin
 *  auf 'pending' und der 5-min-Cron versucht's nochmal. */
async function triggerMsSync(userId: string | null, terminId: string): Promise<void> {
  if (!userId) return;
  try {
    const account = await getMsAccount(userId);
    if (!account || !account.syncEnabled) return;
    if (terminRepo.markMsPending) {
      await terminRepo.markMsPending(terminId, userId);
    }
    // Push fire-and-forget. Errors landen im Log, ms_sync_status wird
    // intern auf 'error' gesetzt, der Cron probiert's spaeter wieder.
    void pushToOutlook(userId, terminId).catch((err) => {
      logError(`[Termine] Async-Push zu MS fehlgeschlagen fuer ${terminId}`, err);
    });
  } catch (err) {
    logError("[Termine] triggerMsSync", err);
  }
}

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
  // MS-Graph-Sync: pending markieren + async push (fire-and-forget).
  void triggerMsSync(c.var.userId, result.id);
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
  // MS-Graph-Sync: pending markieren + async push.
  void triggerMsSync(c.var.userId, id);
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
  // VORHER laden, damit wir die ms_event_id fuer den Outlook-Delete kennen.
  const before = await terminRepo.get(id);
  const ok = await terminRepo.delete(id);
  if (ok) {
    emit({ type: "termin", action: "deleted", id });
    // MS-Graph: wenn der Termin in Outlook gespiegelt war → dort auch loeschen.
    if (before?.msEventId && before.msOwnerUserId) {
      void deleteFromOutlook(before.msOwnerUserId, before.msEventId, before.msCalendarId ?? null).catch((err) =>
        logError(`[Termine] Async-Delete in MS fehlgeschlagen fuer ${id}`, err),
      );
    }
  }
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

// ── Konflikt-Auflösung (Phase 5b) ───────────────────────────────────────────
//
// Wenn ein Termin sowohl in Bau-OS als auch in Outlook geaendert wurde
// und ein PATCH die ETag-Pruefung verletzt, setzt pushToOutlook den
// ms_sync_status auf 'conflict'. Diese Endpoints liefern die zwei
// Versionen + erlauben dem User die Wahl welche gewinnt.

/** Holt den aktuellen Outlook-Stand fuer einen Termin in Konflikt.
 *  Gibt Bau-OS-Version + Microsoft-Version zurueck damit das Frontend
 *  einen Side-by-Side-Diff anzeigen kann. */
termineRoutes.get("/termine/:id/conflict", async (c) => {
  const id = c.req.param("id");
  const local = await terminRepo.get(id);
  if (!local) return c.json({ error: "Termin nicht gefunden" }, 404);
  if (!local.msEventId || !local.msOwnerUserId) {
    return c.json({ error: "Termin ist nicht mit Outlook verknuepft" }, 400);
  }

  try {
    const { graphFetch, GraphError } = await import("../graph.js");
    interface MsEventShape {
      id: string;
      subject?: string;
      start?: { dateTime: string; timeZone: string };
      end?: { dateTime: string; timeZone: string };
      location?: { displayName?: string };
      isAllDay?: boolean;
      attendees?: Array<{ emailAddress?: { address?: string; name?: string } }>;
      "@odata.etag"?: string;
    }
    const { data, etag } = await graphFetch<MsEventShape>(local.msOwnerUserId, `/me/events/${local.msEventId}`);
    if (!data) return c.json({ error: "Outlook-Event leer" }, 502);

    return c.json({
      hasConflict: local.msSyncStatus === "conflict",
      local,
      remote: {
        id: data.id,
        subject: data.subject ?? null,
        start: data.start ?? null,
        end: data.end ?? null,
        location: data.location?.displayName ?? null,
        isAllDay: data.isAllDay === true,
        attendees: (data.attendees ?? []).map((a) => ({
          email: a.emailAddress?.address ?? null,
          name: a.emailAddress?.name ?? null,
        })),
        etag: data["@odata.etag"] ?? etag ?? null,
      },
    });
  } catch (err) {
    const { GraphError } = await import("../graph.js");
    if (err instanceof GraphError && err.status === 404) {
      // Outlook-Event existiert nicht mehr — Frontend zeigt "in Outlook
      // geloescht, was tun?". Wir behandeln das wie einen Konflikt-Spezialfall.
      return c.json({
        hasConflict: true,
        deletedInOutlook: true,
        local,
        remote: null,
      });
    }
    return c.json({ error: err instanceof Error ? err.message : "Unbekannter Fehler" }, 500);
  }
});

/** Loest einen Konflikt durch Auswahl einer Quelle.
 *   resolution = 'local'  → Bau-OS-Version gewinnt; ETag wird geloescht
 *                            damit der nachfolgende Push ohne If-Match laeuft
 *                            und Outlook ueberschreibt.
 *   resolution = 'remote' → Outlook-Version gewinnt; wir holen den
 *                            aktuellen Outlook-Stand und upsert'n ihn.
 *   resolution = 'delete-local' → wenn Outlook geloescht wurde und User
 *                            zustimmt dass der Bau-OS-Termin auch weg soll. */
termineRoutes.post("/termine/:id/resolve", async (c) => {
  const id = c.req.param("id");
  const body = await c.req
    .json<{ resolution: "local" | "remote" | "delete-local" }>()
    .catch(() => ({ resolution: undefined }));
  if (!body.resolution || !["local", "remote", "delete-local"].includes(body.resolution)) {
    return c.json({ error: "resolution muss 'local' | 'remote' | 'delete-local' sein" }, 400);
  }
  const local = await terminRepo.get(id);
  if (!local) return c.json({ error: "Termin nicht gefunden" }, 404);
  if (!local.msEventId || !local.msOwnerUserId) {
    return c.json({ error: "Termin ist nicht mit Outlook verknuepft" }, 400);
  }

  if (body.resolution === "delete-local") {
    await terminRepo.delete(id);
    emit({ type: "termin", action: "deleted", id });
    return c.json({ ok: true });
  }

  if (body.resolution === "local") {
    // Bau-OS gewinnt → ETag wegwerfen damit das nachfolgende PATCH ohne
    // If-Match-Header laeuft (kein 412 mehr) + sync_status auf 'pending'
    // damit der Cron + sofortige triggerMsSync den Push starten.
    const { getDb } = await import("../../db/client.js");
    await getDb()`
      UPDATE termine SET ms_etag = NULL, ms_sync_status = 'pending'
      WHERE id = ${id}
    `;
    if (c.var.userId) {
      const { pushToOutlook } = await import("../../sync/microsoft-sync.js");
      void pushToOutlook(c.var.userId, id).catch(() => undefined);
    }
    emit({ type: "termin", action: "updated", id });
    return c.json({ ok: true, resolution: "local" });
  }

  // remote: Outlook-Version uebernehmen → pullFromOutlook fuer den
  // Owner-User triggert ein Update via $filter=lastModifiedDateTime, aber
  // schneller: einzelnen Event direkt holen + upsertFromMs.
  try {
    const { graphFetch } = await import("../graph.js");
    const { mapMsAttendeesToBauOs } = await import("../../sync/microsoft-sync.js");
    interface MsEv {
      id: string;
      subject?: string;
      start?: { dateTime: string; timeZone: string };
      end?: { dateTime: string; timeZone: string };
      location?: { displayName?: string };
      isAllDay?: boolean;
      attendees?: Array<{
        emailAddress?: { address?: string; name?: string };
        type?: "required" | "optional" | "resource";
      }>;
      "@odata.etag"?: string;
    }
    const { data: ev, etag } = await graphFetch<MsEv>(local.msOwnerUserId, `/me/events/${local.msEventId}`);
    if (!ev || !ev.start?.dateTime || !terminRepo.upsertFromMs) {
      return c.json({ error: "Outlook-Event leer oder DB-Modus erforderlich" }, 502);
    }
    const isoDate = ev.start.dateTime.split("T")[0]!;
    const datum = `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}.${isoDate.slice(0, 4)}`;
    const isAllDay = ev.isAllDay === true;
    const uhrzeit = isAllDay ? null : ev.start.dateTime.split("T")[1]!.slice(0, 5);
    const endzeit = isAllDay || !ev.end?.dateTime ? null : ev.end.dateTime.split("T")[1]!.slice(0, 5);
    const { assigneeIds, assignees } = await mapMsAttendeesToBauOs(ev.attendees);
    await terminRepo.upsertFromMs({
      text: ev.subject?.trim() || "(Kein Titel)",
      datum,
      uhrzeit,
      endzeit,
      location: ev.location?.displayName?.trim() || null,
      assignees,
      assigneeIds,
      msEventId: ev.id,
      msCalendarId: local.msCalendarId ?? null,
      msOwnerUserId: local.msOwnerUserId,
      msEtag: ev["@odata.etag"] ?? etag,
    });
    emit({ type: "termin", action: "updated", id });
    return c.json({ ok: true, resolution: "remote" });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Resolve fehlgeschlagen" }, 500);
  }
});
