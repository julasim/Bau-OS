import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Die Zahlen auf der Startseite.
//
// ── Der Befund ─────────────────────────────────────────────────────────────
//
// `dashboard.ts` verglich `task.assigneeId === ctx.userId`. Das trifft nie:
// `assignee_id` zeigt auf `team_members.id` (Migration 007), `ctx.userId` ist
// eine `users.id` — zwei disjunkte UUID-Räume, verbunden nur über
// `team_members.user_id` (Migration 013).
//
// Für jedes Nicht-Admin-Konto hiess das: persönliche Aufgaben und Termine
// (also die ohne Projekt) zählten NIE mit. Die Startseite meldete „0 offene
// Aufgaben", während die Aufgabenliste welche zeigte. Kein Fehler, keine
// Meldung im Log, nur eine Zahl, die immer null war.
//
// Der Ersteller fehlte ganz: wer sich selbst eine Aufgabe ohne Projekt anlegt,
// tauchte in keiner Zahl auf.
describe.skipIf(!HAS_DB)("Startseite — die Zahlen stimmen", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const P = `dash-${namensraum()}`;
  let mitgliedId = "";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("dash");
    ({ getDb } = await import("../src/db/client.js"));

    // Ein Team-Mitglied, das mit B's Konto verknüpft ist — genau die Brücke,
    // die der alte Direktvergleich übersprang.
    const res = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `${P}-mitglied`, memberType: "intern" }),
    });
    expect(res.status).toBe(201);
    mitgliedId = ((await res.json()) as { id: string }).id;

    // Die Verknüpfung mit dem Konto geht NUR über PATCH und NUR als Admin —
    // `POST /team` nimmt `userId` gar nicht entgegen (sonst könnte sich jeder
    // ein Mitglied „übernehmen").
    const verknuepft = await fx.app.request(`/api/team/${mitgliedId}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ userId: fx.b.id }),
    });
    expect(verknuepft.status).toBe(200);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await getDb()`DELETE FROM team_members WHERE name LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  const zahlen = async (token: string) => {
    const res = await fx.app.request("/api/dashboard", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as { openTasks: number; totalTasks: number; termine: number };
  };

  it("eine mir zugewiesene Aufgabe ohne Projekt zählt mit", async () => {
    const vorher = await zahlen(fx.b.token);

    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-zugewiesen`, assigneeId: mitgliedId }),
    });
    expect(angelegt.status).toBe(201);

    const nachher = await zahlen(fx.b.token);
    expect(nachher.openTasks).toBe(vorher.openTasks + 1);
  });

  it("eine selbst angelegte Aufgabe ohne Projekt zählt mit", async () => {
    const vorher = await zahlen(fx.b.token);
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ text: `${P}-selbst` }),
    });
    expect(angelegt.status).toBe(201);
    const nachher = await zahlen(fx.b.token);
    expect(nachher.openTasks).toBe(vorher.openTasks + 1);
  });

  it("eine fremde persönliche Aufgabe zählt NICHT mit", async () => {
    // Die Gegenrichtung: der Fix darf nicht dadurch „funktionieren", dass
    // jetzt alles gezählt wird.
    const vorher = await zahlen(fx.b.token);
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `${P}-fremd` }),
    });
    expect(angelegt.status).toBe(201);
    const nachher = await zahlen(fx.b.token);
    expect(nachher.openTasks).toBe(vorher.openTasks);
  });

  it("die Startseite und die Aufgabenliste widersprechen sich nicht", async () => {
    // Der eigentliche Befund in einem Satz: die beiden Zahlen liefen
    // auseinander, und das war von aussen sichtbar.
    const zahl = (await zahlen(fx.b.token)).openTasks;
    const liste = (await (await fx.app.request("/api/tasks", { headers: authHeader(fx.b.token) })).json()) as {
      status: string;
    }[];
    expect(zahl).toBe(liste.filter((t) => t.status !== "done").length);
  });
});
