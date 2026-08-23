import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// `POST /api/projects` war ein Beitritt zu jedem fremden Projekt.
//
// ── Der Mechanismus ─────────────────────────────────────────────────────────
//
// `projectRepo.create()` hat eine Doppelrolle: existiert der Name schon, ist
// das kein Fehler, sondern ein Durchpatchen der Stammdaten — und danach ein
// bedingungsloses
//
//     INSERT INTO user_projects (user_id, project_id) ... ON CONFLICT DO NOTHING
//
// Die Route reichte `createdById = c.var.userId` ohne jede Rechteprüfung
// weiter. Wer den Projektnamen kannte, war anschließend eingetragen — in einem
// Büro mit drei bis acht Arbeitsplätzen also jeder.
//
// Damit war auch der Fix aus `aeb05f6` umgehbar: was die acht bewachten
// Unterrouten verwehren, holte man sich mit einem POST davor.
//
// ── Warum 409 und nicht 403 ─────────────────────────────────────────────────
//
// Ein 403 auf einen bestehenden fremden Namen wäre selbst eine Auskunft
// („diesen Namen gibt es"). 409 sagt dasselbe, was auch ein Berechtigter
// bekäme, dem der Name schon gehört — und ist damit kein Namens-Orakel.
describe.skipIf(!HAS_DB)("POST /projects ist kein Beitritt", () => {
  let fx: AclFixture;
  const P = namensraum();

  beforeAll(async () => {
    fx = await setupAclFixture("beitritt");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM projects WHERE name LIKE ${"bt-" + P + "%"}`;
    await fx.cleanup();
  });

  /** B versucht, sich auf A's Projekt zu setzen. */
  const alsBAnlegen = (name: string, extra: Record<string, unknown> = {}) =>
    fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ name, ...extra }),
    });

  const alsBLesen = (pfad: string) =>
    fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}${pfad}`, {
      headers: authHeader(fx.b.token),
    });

  it("B kommt an A's Projekt vorher nicht heran", async () => {
    // Ausgangslage. Ohne sie sagt der Rest nichts.
    expect((await alsBLesen("")).status).toBe(403);
  });

  it("ein POST auf A's Projektnamen macht B NICHT zum Mitglied", async () => {
    const res = await alsBAnlegen(fx.projectName, { projektnummer: `BT-${P}-001` });
    // 409: der Name ist vergeben. Kein 201, kein 200.
    expect(res.status).toBe(409);

    const { getDb } = await import("../src/db/client.js");
    const [zeile] = await getDb()`
      SELECT count(*)::int AS n FROM user_projects
       WHERE user_id = ${fx.b.id} AND project_id = ${fx.projectId}`;
    expect(zeile.n).toBe(0);
  });

  it("und B kommt danach immer noch nicht heran", async () => {
    // Der eigentliche Nachweis. Der Statuscode allein sagt nicht, dass nichts
    // geschrieben wurde.
    for (const pfad of ["", "/notes", "/tasks", "/termine", "/export.md"]) {
      expect((await alsBLesen(pfad)).status, pfad || "(Detail)").toBe(403);
    }
  });

  it("B kann A's Stammdaten nicht überschreiben", async () => {
    const vorher = (await (
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
        headers: authHeader(fx.a.token),
      })
    ).json()) as { projektnummer: string; standort: string | null };

    await alsBAnlegen(fx.projectName, { projektnummer: `BT-${P}-999`, standort: "Übernommen" });

    const nachher = (await (
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
        headers: authHeader(fx.a.token),
      })
    ).json()) as { projektnummer: string; standort: string | null };

    expect(nachher.projektnummer).toBe(vorher.projektnummer);
    expect(nachher.standort).toBe(vorher.standort);
  });

  it("B holt kein gelöschtes Projekt aus dem Papierkorb", async () => {
    // Zweiter Schaden derselben Wurzel: `create()` setzte `deleted_at = NULL`,
    // ebenfalls ohne Prüfung. Dem Verwalter verschwand das Projekt
    // kommentarlos aus dem Papierkorb.
    const weg = `bt-${P}-geloescht`;
    expect(
      (
        await fx.app.request("/api/projects", {
          method: "POST",
          headers: jsonHeader(fx.a.token),
          body: JSON.stringify({ name: weg, projektnummer: `BT-${P}-500` }),
        })
      ).status,
    ).toBe(201);
    await fx.app.request(`/api/projects/${encodeURIComponent(weg)}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });

    const res = await alsBAnlegen(weg, { projektnummer: `BT-${P}-501` });
    expect(res.status).toBe(409);

    const { getDb } = await import("../src/db/client.js");
    const [zeile] = await getDb()`SELECT deleted_at FROM projects WHERE name = ${weg}`;
    expect(zeile.deleted_at, "Projekt darf im Papierkorb bleiben").not.toBeNull();
  });

  // ── Was weiterhin gehen muss ──────────────────────────────────────────────

  it("A patcht sein EIGENES Projekt weiterhin per POST durch", async () => {
    // `create()` heißt in diesem Haus ausdrücklich „stelle sicher, dass es
    // existiert". Für den Berechtigten muss das bleiben — sonst repariert der
    // Fix die Lücke, indem er die Funktion abschafft.
    const res = await fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: fx.projectName, standort: "Wien 9" }),
    });
    expect(res.status).toBe(200);
    const p = (await res.json()) as { standort: string | null };
    expect(p.standort).toBe("Wien 9");
  });

  it("ein Admin darf es auch bei fremden Projekten", async () => {
    const res = await fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: fx.projectName, nutzung: "Wohnbau" }),
    });
    expect(res.status).toBe(200);
  });

  it("ein wirklich neues Projekt legt B ganz normal an", async () => {
    const res = await alsBAnlegen(`bt-${P}-eigenes`, { projektnummer: `BT-${P}-700` });
    expect(res.status).toBe(201);
  });
});
