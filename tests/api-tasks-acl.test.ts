import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Type-Queries fuers entity-spezifische Setup (kein Laufzeit-`any`).
type TaskRepo = (typeof import("../src/data/index.js"))["taskRepo"];
type TeamRepo = (typeof import("../src/data/index.js"))["teamRepo"];

// Zwei Themen in einer Suite, weil beide dieselbe Fixture brauchen:
//
//  1) BEFUND: PATCH /tasks/complete (Legacy, schliesst per Freitext ab) hatte
//     KEINE Rechtepruefung — ein Non-Admin konnte Aufgaben in Projekten
//     abhaken, die er nicht einmal sehen darf. Die Route ist entfallen.
//  2) REGRESSION: die ACL-Checks verglichen `task.assigneeId` (FK auf
//     team_members, Migration 007) direkt mit `ctx.userId` (users.id). Die
//     UUID-Raeume sind disjunkt, der Vergleich trifft nie zu — Nicht-Admins
//     kamen an ihre EIGENEN projektlosen Aufgaben nicht mehr heran. Die
//     Bruecke ist team_members.user_id (Migration 013).
describe.skipIf(!HAS_DB)("API — tasks ACL", () => {
  let fx: AclFixture;
  let taskRepo: TaskRepo;
  let teamRepo: TeamRepo;
  let bMemberId = ""; // team_member, das mit User B verknuepft ist
  let personalTaskId = ""; // ohne Projekt, B zugewiesen
  let projectTaskId = ""; // in A's Projekt — B darf es nicht sehen
  const tag = Date.now();
  const projectTaskText = `A-Projektaufgabe ${tag}`;

  beforeAll(async () => {
    fx = await setupAclFixture("task");
    ({ taskRepo, teamRepo } = await import("../src/data/index.js"));

    // Team-Mitglied anlegen und mit User B verknuepfen — genau die Verbindung,
    // ueber die eine Aufgabe "mir" gehoert.
    bMemberId = (await teamRepo.add({ name: `task-member-${tag}`, userId: fx.b.id })).id;

    // Persoenliche Aufgabe: kein Projekt, B (ueber sein Team-Mitglied) zugewiesen.
    personalTaskId = (await taskRepo.save(`B-Privataufgabe ${tag}`)).id;
    await taskRepo.update(personalTaskId, { assigneeId: bMemberId });

    // Aufgabe in A's Projekt — fuer B tabu.
    projectTaskId = (await taskRepo.save(projectTaskText, fx.projectName)).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // tasks.project_id ist ON DELETE SET NULL, tasks ohne Projekt haengen an
    // gar nichts — beide explizit loeschen. Das Team-Mitglied ebenso, sonst
    // bleibt es nach dem User-Cleanup als Waise mit user_id NULL zurueck.
    for (const id of [personalTaskId, projectTaskId]) if (id) await taskRepo.delete(id);
    if (bMemberId) await teamRepo.remove(bMemberId);
    await fx.cleanup();
  });

  // ── 1) Legacy-Route /tasks/complete ─────────────────────────────────────
  describe("Legacy PATCH /tasks/complete (entfernt)", () => {
    const legacyComplete = (token: string, text: string, project?: string) =>
      fx.app.request("/api/tasks/complete", {
        method: "PATCH",
        headers: jsonHeader(token),
        body: JSON.stringify({ text, project }),
      });

    it("Non-Admin (B) kann fremde Aufgabe NICHT per Freitext abhaken", async () => {
      const res = await legacyComplete(fx.b.token, projectTaskText, fx.projectName);
      expect(res.status).not.toBe(200);
      // Die eigentliche Zusicherung: der Datensatz ist unveraendert offen.
      const after = await taskRepo.get(projectTaskId);
      expect(after?.status).not.toBe("done");
    });

    it("auch fuer den Admin nicht mehr erreichbar (Route ist weg, nicht nur gesperrt)", async () => {
      const res = await legacyComplete(fx.admin.token, projectTaskText, fx.projectName);
      expect(res.status).not.toBe(200);
      const after = await taskRepo.get(projectTaskId);
      expect(after?.status).not.toBe("done");
    });
  });

  // ── 2) Regression: eigene projektlose Aufgabe bearbeiten ────────────────
  describe("eigene projektlose Aufgabe (assignee_id → team_members → users)", () => {
    it("GET /tasks/:id auf die eigene Aufgabe → 200", async () => {
      const res = await fx.app.request(`/api/tasks/${personalTaskId}`, { headers: authHeader(fx.b.token) });
      expect(res.status).toBe(200);
    });

    it("GET /tasks listet die eigene projektlose Aufgabe", async () => {
      const res = await fx.app.request("/api/tasks", { headers: authHeader(fx.b.token) });
      expect(res.status).toBe(200);
      const rows = (await res.json()) as Array<{ id: string }>;
      expect(rows.map((t) => t.id)).toContain(personalTaskId);
    });

    it("PUT /tasks/:id auf die eigene Aufgabe → 200", async () => {
      const res = await fx.app.request(`/api/tasks/${personalTaskId}`, {
        method: "PUT",
        headers: jsonHeader(fx.b.token),
        body: JSON.stringify({ text: `B-Privataufgabe ${tag} (geaendert)` }),
      });
      expect(res.status).toBe(200);
    });

    it("PATCH /tasks/:id/complete auf die eigene Aufgabe → 200 und wirklich erledigt", async () => {
      const res = await fx.app.request(`/api/tasks/${personalTaskId}/complete`, {
        method: "PATCH",
        headers: jsonHeader(fx.b.token),
      });
      expect(res.status).toBe(200);
      expect((await taskRepo.get(personalTaskId))?.status).toBe("done");
    });
  });

  // ── 3) Confinement: der korrigierte Vergleich darf nicht zu weit oeffnen ─
  describe("Confinement", () => {
    it("A sieht B's projektlose Aufgabe NICHT in /tasks", async () => {
      const res = await fx.app.request("/api/tasks", { headers: authHeader(fx.a.token) });
      const rows = (await res.json()) as Array<{ id: string }>;
      expect(rows.map((t) => t.id)).not.toContain(personalTaskId);
    });

    it("A greift auf B's projektlose Aufgabe zu → 403 (GET/PUT)", async () => {
      const get = await fx.app.request(`/api/tasks/${personalTaskId}`, { headers: authHeader(fx.a.token) });
      expect(get.status).toBe(403);
      const put = await fx.app.request(`/api/tasks/${personalTaskId}`, {
        method: "PUT",
        headers: jsonHeader(fx.a.token),
        body: JSON.stringify({ text: "uebernommen" }),
      });
      expect(put.status).toBe(403);
    });

    it("B greift auf A's Projektaufgabe zu → 403 (Projekt-ACL unveraendert)", async () => {
      const res = await fx.app.request(`/api/tasks/${projectTaskId}`, { headers: authHeader(fx.b.token) });
      expect(res.status).toBe(403);
    });

    it("A loescht B's projektlose Aufgabe → 403", async () => {
      const res = await fx.app.request(`/api/tasks/${personalTaskId}`, {
        method: "DELETE",
        headers: authHeader(fx.a.token),
      });
      expect(res.status).toBe(403);
      expect(await taskRepo.get(personalTaskId)).not.toBeNull();
    });
  });

  // Zuletzt, weil der Datensatz danach weg ist.
  it("DELETE /tasks/:id auf die eigene Aufgabe → 200", async () => {
    const res = await fx.app.request(`/api/tasks/${personalTaskId}`, {
      method: "DELETE",
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(200);
    expect(await taskRepo.get(personalTaskId)).toBeNull();
  });
});

// ── Eigene projektlose Aufgabe OHNE Zuweisung ───────────────────────────────
// Der haeufigste Fall ueberhaupt: jemand notiert sich selbst etwas, ohne
// Projekt und ohne sich zuzuweisen. Als die Schreibrouten eine Rechtepruefung
// bekamen, lief genau dieser Fall in 403 — es gab keinen Weg, den Ersteller zu
// erkennen, weil `tasks.created_by` zwar seit Migration 001 existiert, aber nie
// geschrieben wurde. Auf `main` funktionierten die Aufrufe (dort pruefte gar
// nichts), es war also eine echte Regression.
describe.skipIf(!HAS_DB)("API — eigene projektlose Aufgabe bleibt bearbeitbar", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("eigen");
  });
  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  async function eigeneAufgabe(token: string): Promise<string> {
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(token),
      body: JSON.stringify({ text: "Angebot Mueller pruefen" }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  it("Ersteller wird beim Anlegen festgehalten", async () => {
    const id = await eigeneAufgabe(fx.b.token);
    const res = await fx.app.request(`/api/tasks/${id}`, { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(200);
    expect((await res.json()).createdById).toBe(fx.b.id);
  });

  it("Ersteller darf aendern, abhaken und loeschen", async () => {
    const id = await eigeneAufgabe(fx.b.token);
    const put = await fx.app.request(`/api/tasks/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ text: "Angebot Mueller abgeschickt" }),
    });
    expect(put.status).toBe(200);
    const done = await fx.app.request(`/api/tasks/${id}/complete`, {
      method: "PATCH",
      headers: authHeader(fx.b.token),
    });
    expect(done.status).toBe(200);
    const del = await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.b.token) });
    expect(del.status).toBe(200);
  });

  it("die eigene Aufgabe taucht in der eigenen Liste auf", async () => {
    const id = await eigeneAufgabe(fx.b.token);
    const res = await fx.app.request("/api/tasks", { headers: authHeader(fx.b.token) });
    const ids = ((await res.json()) as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain(id);
  });

  // Gegenrichtung: der Ersteller-Zweig darf nicht zum Scheunentor werden.
  it("Confinement: ein Fremder kommt an die persoenliche Aufgabe nicht heran", async () => {
    const id = await eigeneAufgabe(fx.b.token);
    expect((await fx.app.request(`/api/tasks/${id}`, { headers: authHeader(fx.a.token) })).status).toBe(403);
    const put = await fx.app.request(`/api/tasks/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: "fremd geaendert" }),
    });
    expect(put.status).toBe(403);
    const del = await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) });
    expect(del.status).toBe(403);
    const liste = await fx.app.request("/api/tasks", { headers: authHeader(fx.a.token) });
    expect(((await liste.json()) as Array<{ id: string }>).map((t) => t.id)).not.toContain(id);
  });
});
