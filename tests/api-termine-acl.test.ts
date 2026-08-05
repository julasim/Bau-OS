import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Rechte an den Termin-Routen.
//
// Warum diese Tests: `GET /termine/:id` prüfte die Rechte, PUT und DELETE
// prüften GAR NICHTS. Wer eine Termin-UUID kannte (oder erriet), konnte jeden
// Termin ändern und löschen — auch aus Projekten, für die ihm dieselbe API bei
// GET ein 403 gegeben hätte. Ein klassischer IDOR.
//
// Zweiter Fehler derselben Wurzel wie bei den Aufgaben: der Filter für
// projektlose Termine verglich `assigneeIds.includes(userId)`. `assignee_ids`
// enthält team_members-IDs, `userId` ist eine users.id — der Vergleich trifft
// nie, projektlose Termine waren für Nicht-Admins unsichtbar und unerreichbar.
describe.skipIf(!HAS_DB)("API — Termine: Rechte an Lese- und Schreibpfaden", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("term");
  });
  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  /** Legt einen Termin in A's Projekt an (als A). */
  async function terminInAProjekt(): Promise<string> {
    const res = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "15.09.2026", text: "Bauherrenbesprechung", project: fx.projectName }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  /** Legt einen persönlichen Termin ohne Projekt an. */
  async function persoenlicherTermin(token: string): Promise<string> {
    const res = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(token),
      body: JSON.stringify({ datum: "16.09.2026", text: "Zahnarzt" }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  // ── IDOR an den Schreibpfaden ────────────────────────────────────────────

  it("Fremder kann einen Termin aus A's Projekt nicht aendern", async () => {
    const id = await terminInAProjekt();
    const res = await fx.app.request(`/api/termine/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ text: "fremd geaendert" }),
    });
    expect(res.status).toBe(403);
    // Der Datensatz muss unveraendert sein — 403 allein genuegt nicht.
    const nachher = await fx.app.request(`/api/termine/${id}`, { headers: authHeader(fx.admin.token) });
    expect(((await nachher.json()) as { text: string }).text).toBe("Bauherrenbesprechung");
  });

  it("Fremder kann einen Termin aus A's Projekt nicht loeschen", async () => {
    const id = await terminInAProjekt();
    const res = await fx.app.request(`/api/termine/${id}`, { method: "DELETE", headers: authHeader(fx.b.token) });
    expect(res.status).toBe(403);
    expect((await fx.app.request(`/api/termine/${id}`, { headers: authHeader(fx.admin.token) })).status).toBe(200);
  });

  it("Berechtigter (A) darf aendern und loeschen", async () => {
    const id = await terminInAProjekt();
    const put = await fx.app.request(`/api/termine/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ location: "Besprechungsraum" }),
    });
    expect(put.status).toBe(200);
    expect(
      (await fx.app.request(`/api/termine/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) })).status,
    ).toBe(200);
  });

  it("Admin darf weiterhin alles", async () => {
    const id = await terminInAProjekt();
    const put = await fx.app.request(`/api/termine/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "vom Admin geaendert" }),
    });
    expect(put.status).toBe(200);
  });

  it("unbekannte ID → 404, kein Token → 401", async () => {
    const fake = "00000000-0000-0000-0000-000000000000";
    expect(
      (await fx.app.request(`/api/termine/${fake}`, { method: "DELETE", headers: authHeader(fx.b.token) })).status,
    ).toBe(404);
    expect((await fx.app.request(`/api/termine/${fake}`, { method: "DELETE" })).status).toBe(401);
  });

  // ── Persoenliche Termine bleiben erreichbar ──────────────────────────────

  it("Ersteller kommt an seinen projektlosen Termin heran", async () => {
    const id = await persoenlicherTermin(fx.b.token);
    expect((await fx.app.request(`/api/termine/${id}`, { headers: authHeader(fx.b.token) })).status).toBe(200);
    const put = await fx.app.request(`/api/termine/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ uhrzeit: "09:30" }),
    });
    expect(put.status).toBe(200);
    const liste = await fx.app.request("/api/termine", { headers: authHeader(fx.b.token) });
    expect(((await liste.json()) as Array<{ id: string }>).map((t) => t.id)).toContain(id);
  });

  it("Confinement: der persoenliche Termin bleibt fuer Fremde verschlossen", async () => {
    const id = await persoenlicherTermin(fx.b.token);
    expect((await fx.app.request(`/api/termine/${id}`, { headers: authHeader(fx.a.token) })).status).toBe(403);
    expect(
      (await fx.app.request(`/api/termine/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) })).status,
    ).toBe(403);
    const liste = await fx.app.request("/api/termine", { headers: authHeader(fx.a.token) });
    expect(((await liste.json()) as Array<{ id: string }>).map((t) => t.id)).not.toContain(id);
  });

  // ── Loeschen per Text (Altbestand) ───────────────────────────────────────

  it("Loeschen per Text ist Admins vorbehalten", async () => {
    const id = await terminInAProjekt();
    const alsNutzer = await fx.app.request("/api/termine", {
      method: "DELETE",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ text: "Bauherrenbesprechung" }),
    });
    expect(alsNutzer.status).toBe(403);
    // Der Termin darf dabei nicht verschwunden sein.
    expect((await fx.app.request(`/api/termine/${id}`, { headers: authHeader(fx.admin.token) })).status).toBe(200);
  });
});
