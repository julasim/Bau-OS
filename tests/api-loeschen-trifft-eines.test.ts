import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Löschen und Abhaken treffen GENAU EINEN Datensatz — und nur den gemeinten.
//
// ── Die Fehlerklasse ───────────────────────────────────────────────────────
//
// Drei Repositories lösten einen Datensatz über `id::text = $1 OR <name> = $1`
// auf, ohne Limit. Bei zwei gleichnamigen Einträgen traf die Anweisung beide,
// gemeldet wurde nur, dass „mindestens einer" betroffen war.
//
// Bei Dateien und Team-Mitgliedern gibt es dafür **keinen Papierkorb** — was
// weg ist, ist weg. Und bei den Aufgaben kam dazu, dass die Route den
// Projektnamen zwar mitgab, `complete()` ihn aber gar nicht entgegennahm: das
// Abhaken lief projektübergreifend.
describe.skipIf(!HAS_DB)("Löschen trifft genau einen Datensatz", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const S = `loeschen-${Date.now()}`;
  const aufraeumen: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("loeschen");
    ({ getDb } = await import("../src/db/client.js"));
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    for (const weg of aufraeumen) await weg();
    await getDb()`DELETE FROM team_members WHERE name LIKE ${S + "%"}`;
    await fx.cleanup();
  });

  // ── Team-Mitglieder ──────────────────────────────────────────────────────

  it("DELETE /team/:name ist der Verwaltung vorbehalten", async () => {
    // ⚠ Hier stand KEINE Prüfung. Jedes angemeldete Konto konnte jedes
    // Mitglied entfernen — und daran hängen zwei Trigger und vier
    // Fremdschlüssel.
    const angelegt = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `${S}-geschuetzt`, memberType: "Intern" }),
    });
    const id = ((await angelegt.json()) as { id: string }).id;

    const alsB = await fx.app.request(`/api/team/${id}`, { method: "DELETE", headers: authHeader(fx.b.token) });
    expect(alsB.status).toBe(403);

    // Und es ist wirklich noch da — ein 403, nach dem der Datensatz trotzdem
    // weg wäre, hätte nichts geholfen.
    const [zeile] = await getDb()`SELECT id FROM team_members WHERE id = ${id}`;
    expect(zeile, "trotz 403 gelöscht").toBeTruthy();

    const alsAdmin = await fx.app.request(`/api/team/${id}`, { method: "DELETE", headers: authHeader(fx.admin.token) });
    expect(alsAdmin.status).toBe(200);
  });

  it("das Lösen einer Projektzuordnung bleibt für Nicht-Admins offen", async () => {
    // ⚠ Der Wächter darf `DELETE /team/:id/projects/:projectId` NICHT
    // miterfassen — ein Platzhalter `/team/*` hätte genau das getan.
    const angelegt = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: `${S}-zuordnung`, memberType: "Intern", projectId: fx.projectId }),
    });
    const id = ((await angelegt.json()) as { id: string }).id;
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM team_members WHERE id = ${id}`;
    });

    const res = await fx.app.request(`/api/team/${id}/projects/${fx.projectId}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(res.status, "der Admin-Wächter greift zu weit").not.toBe(403);
  });

  it("zwei gleichnamige Mitglieder: über den Namen wird KEINES gelöscht", async () => {
    // Lieber ein Löschvorgang, der nicht stattfindet, als der falsche.
    const ids: string[] = [];
    for (const i of [1, 2]) {
      const res = await fx.app.request("/api/team", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ name: `${S}-doppelt`, memberType: "Intern", role: `Nr ${i}` }),
      });
      ids.push(((await res.json()) as { id: string }).id);
    }
    expect(new Set(ids).size, "die Anlage hat zusammengeführt statt zwei anzulegen").toBe(2);

    const ueberName = await fx.app.request(`/api/team/${encodeURIComponent(`${S}-doppelt`)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    expect(((await ueberName.json()) as { ok: boolean }).ok).toBe(false);

    const übrig = await getDb()`SELECT id FROM team_members WHERE name = ${`${S}-doppelt`}`;
    expect(übrig.length, "über den Namen wurde doch gelöscht").toBe(2);

    // Über die ID geht genau eines.
    await fx.app.request(`/api/team/${ids[0]}`, { method: "DELETE", headers: authHeader(fx.admin.token) });
    const danach = await getDb()`SELECT id FROM team_members WHERE name = ${`${S}-doppelt`}`;
    expect(danach.length).toBe(1);
    expect(String(danach[0].id)).toBe(ids[1]);
  });

  // ── Dateien: dieselbe Klasse, ohne Papierkorb ────────────────────────────

  it("eine Datei lässt sich nicht über ihren Namen löschen", async () => {
    // Prüfung und Wirkung trafen verschiedene Zeilen: `canAccessFile` löste
    // strikt über die ID auf, das DELETE zusätzlich über `filename` — ohne
    // Limit, projektübergreifend, endgültig.
    const [datei] = await getDb()`
      INSERT INTO files (project_id, filename, filepath, mime_type, blob)
      VALUES (${fx.projectId}, ${S + "-plan.txt"}, ${S + "-plan.txt"}, 'text/plain', ${Buffer.from("x")})
      RETURNING id`;
    const id = String(datei.id);
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM files WHERE id = ${id}`;
    });

    const ueberName = await fx.app.request("/api/files", {
      method: "DELETE",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ id: `${S}-plan.txt` }),
    });
    // 403 oder 404 — nur nicht gelöscht, und vor allem kein 500er aus dem
    // UUID-Cast.
    expect([400, 403, 404]).toContain(ueberName.status);

    const [nochDa] = await getDb()`SELECT id FROM files WHERE id = ${id}`;
    expect(nochDa, "über den Dateinamen gelöscht").toBeTruthy();
  });

  it("ein Dateiname statt einer ID ergibt keinen Serverfehler", async () => {
    // `WHERE id = '<keine UUID>'` wirft in Postgres 22P02. Das fängt
    // `app.onError` schon länger ab (400 „Ungueltige ID im Pfad") — ein 500er
    // entsteht hier also auch ohne den Wächter nicht. Die Zeile bleibt als
    // Regressionsschutz für die Fehlerbehandlung stehen; den Wächter selbst
    // hält sie NICHT, und das ist hier ausdrücklich vermerkt statt so zu tun.
    const res = await fx.app.request(`/api/files/download?id=${encodeURIComponent("kein-uuid")}`, {
      headers: authHeader(fx.a.token),
    });
    expect(res.status).not.toBe(500);
    expect([400, 403, 404]).toContain(res.status);
  });

  it("das Repository löscht nicht mehr über den Dateinamen", async () => {
    // ⚠ Diese Prüfung geht bewusst am HTTP-Weg vorbei. Über die Route greift
    // seit dem 02.09.2026 schon `canAccessFile` und weist eine Nicht-UUID mit
    // 403 ab — die Route hält den Repository-Fix damit NICHT fest. Zwei
    // gleichnamige Dateien in zwei Projekten sind aber genau der Fall, in dem
    // das `DELETE` ohne Limit beide nahm, endgültig und ohne Papierkorb.
    const { fileRepo } = await import("../src/data/index.js");
    const name = `${S}-zwilling.txt`;
    const ids: string[] = [];
    for (const projekt of [fx.projectId, fx.projectBId]) {
      const [z] = await getDb()`
        INSERT INTO files (project_id, filename, filepath, mime_type, blob)
        VALUES (${projekt}, ${name}, ${name}, 'text/plain', ${Buffer.from("x")})
        RETURNING id`;
      ids.push(String(z.id));
    }
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM files WHERE filename = ${name}`;
    });

    expect(await fileRepo.delete(name), "über den Namen wurde gelöscht").toBe(false);
    const uebrig = await getDb()`SELECT id FROM files WHERE filename = ${name}`;
    expect(uebrig.length, "beide Zwillinge sind weg").toBe(2);

    expect(await fileRepo.delete(ids[0])).toBe(true);
    const danach = await getDb()`SELECT id FROM files WHERE filename = ${name}`;
    expect(danach.length).toBe(1);
  });

  // ── Aufgaben: das Abhaken lief projektübergreifend ───────────────────────

  it("gleichnamige Aufgaben in zwei Projekten: nur die gemeinte wird abgehakt", async () => {
    // ⚠ Die Route übergab `taskRepo.complete(text, name)` — und `complete()`
    // nahm den Projektnamen gar nicht entgegen. Das `UPDATE` traf jede
    // Aufgabe mit diesem Wortlaut, in jedem Projekt.
    const text = `${S}-Plan freigeben`;
    const ids: Record<string, string> = {};
    for (const [wer, token, projekt] of [
      ["a", fx.a.token, fx.projectName],
      ["b", fx.b.token, fx.projectBName],
    ] as const) {
      const res = await fx.app.request("/api/tasks", {
        method: "POST",
        headers: jsonHeader(token),
        body: JSON.stringify({ text, project: projekt }),
      });
      expect([200, 201]).toContain(res.status);
      ids[wer] = ((await res.json()) as { id: string }).id;
      aufraeumen.push(async () => {
        await getDb()`DELETE FROM tasks WHERE id = ${ids[wer]}`;
      });
    }

    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/tasks`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ id: ids.a }),
    });
    expect(res.status).toBe(200);

    const [meine] = await getDb()`SELECT status FROM tasks WHERE id = ${ids.a}`;
    const [fremde] = await getDb()`SELECT status FROM tasks WHERE id = ${ids.b}`;
    expect(meine.status).toBe("done");
    expect(fremde.status, "die gleichnamige Aufgabe im fremden Projekt wurde mit abgehakt").not.toBe("done");
  });

  it("eine Aufgabe aus einem anderen Projekt lässt sich hier nicht abhaken", async () => {
    // Die Rechteprüfung der Route prüft das Projekt aus dem PFAD. Ohne die
    // Zugehörigkeitsprüfung wäre sie nur eine Behauptung darüber.
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ text: `${S}-fremd`, project: fx.projectBName }),
    });
    const fremdeId = ((await res.json()) as { id: string }).id;
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM tasks WHERE id = ${fremdeId}`;
    });

    const versuch = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/tasks`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ id: fremdeId }),
    });
    expect(versuch.status).toBe(404);
  });
});
