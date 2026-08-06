import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Firmen (Bauherren, Fachplaner, ausführende Firmen).
//
// Die API gab es seit Migration 006 vollständig — nur rief sie niemand auf:
// die Oberfläche kannte keinen einzigen `/companies`-Pfad. Firmen entstanden
// deshalb ausschließlich als Nebenwirkung: wer bei einem Teammitglied einen
// Firmennamen eintippt, legt damit stillschweigend eine Firma an.
//
// Die Folge im Büro ist absehbar. „Müller GmbH", „Mueller GmbH" und
// „Müller Gmbh" sind drei Firmen, Adresse und Website lassen sich nirgends
// eintragen, und niemand kann das je wieder geradeziehen. Umbenennen allein
// hilft nicht — es macht aus drei Einträgen drei gleichnamige.
describe.skipIf(!HAS_DB)("Firmen", () => {
  let fx: AclFixture;
  const S = Date.now();
  const angelegt: string[] = [];

  const firma = (token: string, name: string, rest: Record<string, unknown> = {}) =>
    fx.app.request("/api/companies", {
      method: "POST",
      headers: jsonHeader(token),
      body: JSON.stringify({ name, ...rest }),
    });

  beforeAll(async () => {
    fx = await setupAclFixture("firmen");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM team_members WHERE name LIKE ${"%" + S + "%"}`;
    await getDb()`DELETE FROM companies WHERE name LIKE ${"%" + S + "%"}`;
    await fx.cleanup();
  });

  it("anlegen, lesen, ändern", async () => {
    const res = await firma(fx.a.token, `Zimmerei Huber ${S}`, {
      address: "Hauptstraße 1, 4020 Linz",
      website: "https://huber.example",
      notes: "Holzbau, kurzfristig verfügbar",
    });
    expect(res.status).toBe(201);
    const f = (await res.json()) as { id: string; name: string; address: string };
    angelegt.push(f.id);
    expect(f.address).toContain("Linz");

    const geaendert = await fx.app.request(`/api/companies/${f.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ notes: "Holzbau, Angebot 09/2026" }),
    });
    expect(geaendert.status).toBe(200);
    expect(((await geaendert.json()) as { notes: string }).notes).toContain("09/2026");
  });

  it("derselbe Name zweimal wird abgelehnt", async () => {
    const name = `Doppelt ${S}`;
    const erste = await firma(fx.a.token, name);
    expect(erste.status).toBe(201);
    angelegt.push(((await erste.json()) as { id: string }).id);

    const zweite = await firma(fx.a.token, name);
    expect(zweite.status).toBe(409);
  });

  it("ohne Namen kein Eintrag", async () => {
    expect((await firma(fx.a.token, "   ")).status).toBe(400);
  });

  it("die Liste zählt die zugeordneten Mitglieder mit", async () => {
    const res = await firma(fx.a.token, `Statik Berger ${S}`);
    const f = (await res.json()) as { id: string };
    angelegt.push(f.id);

    const mitglied = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: `Berger Mitarbeiter ${S}`, role: "Statik", companyId: f.id }),
    });
    expect(mitglied.status).toBe(201);

    const liste = await fx.app.request("/api/companies", { headers: authHeader(fx.a.token) });
    const eintrag = ((await liste.json()) as { id: string; memberCount: number }[]).find((x) => x.id === f.id);
    expect(eintrag?.memberCount).toBe(1);
  });

  // ── Zusammenführen: der eigentliche Grund für diese Runde ────────────────

  it("Dubletten lassen sich zusammenführen, die Mitglieder ziehen mit", async () => {
    const falsch = (await (await firma(fx.a.token, `Mueller GmbH ${S}`)).json()) as { id: string };
    const richtig = (await (await firma(fx.a.token, `Müller GmbH ${S}`)).json()) as { id: string };
    angelegt.push(falsch.id, richtig.id);

    const m = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: `Mueller Mitarbeiter ${S}`, companyId: falsch.id }),
    });
    expect(m.status).toBe(201);
    const mitgliedId = ((await m.json()) as { id: string }).id;

    const res = await fx.app.request(`/api/companies/${falsch.id}/zusammenfuehren`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ zielId: richtig.id }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { umgehaengt: number }).umgehaengt).toBe(1);

    // Die falsche Firma ist weg …
    expect((await fx.app.request(`/api/companies/${falsch.id}`, { headers: authHeader(fx.a.token) })).status).toBe(404);

    // … und das Mitglied hängt an der richtigen, samt Freitextfeld.
    const mitglied = await fx.app.request(`/api/team/${mitgliedId}`, { headers: authHeader(fx.a.token) });
    const daten = (await mitglied.json()) as { companyId: string; companyName: string; company: string };
    expect(daten.companyId).toBe(richtig.id);
    expect(daten.companyName).toContain("Müller");
    expect(daten.company).toContain("Müller");
  });

  it("eine Firma mit sich selbst zusammenzuführen wird abgelehnt", async () => {
    const f = (await (await firma(fx.a.token, `Selbstbezug ${S}`)).json()) as { id: string };
    angelegt.push(f.id);
    const res = await fx.app.request(`/api/companies/${f.id}/zusammenfuehren`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ zielId: f.id }),
    });
    expect(res.status).toBe(400);
  });

  it("ein unbekanntes Ziel lässt die Quelle unangetastet", async () => {
    // Sonst wäre die Firma weg und die Mitglieder hingen im Nichts.
    const f = (await (await firma(fx.a.token, `Bleibt ${S}`)).json()) as { id: string };
    angelegt.push(f.id);

    const res = await fx.app.request(`/api/companies/${f.id}/zusammenfuehren`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ zielId: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
    expect((await fx.app.request(`/api/companies/${f.id}`, { headers: authHeader(fx.a.token) })).status).toBe(200);
  });

  it("Zusammenführen und Löschen sind Verwaltungssache", async () => {
    const f = (await (await firma(fx.a.token, `Nur Admin ${S}`)).json()) as { id: string };
    const g = (await (await firma(fx.a.token, `Ziel ${S}`)).json()) as { id: string };
    angelegt.push(f.id, g.id);

    const merge = await fx.app.request(`/api/companies/${f.id}/zusammenfuehren`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ zielId: g.id }),
    });
    expect(merge.status).toBe(403);

    const del = await fx.app.request(`/api/companies/${f.id}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(del.status).toBe(403);
  });

  it("eine gelöschte Firma nimmt ihre Mitglieder NICHT mit", async () => {
    // `ON DELETE SET NULL`: das Mitglied bleibt, nur die Verknüpfung geht.
    // Hier festgehalten, weil die Alternative (CASCADE) Personendaten
    // vernichtet hätte.
    const f = (await (await firma(fx.a.token, `Wird geloescht ${S}`)).json()) as { id: string };
    const m = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: `Bleibt erhalten ${S}`, companyId: f.id }),
    });
    const mitgliedId = ((await m.json()) as { id: string }).id;

    await fx.app.request(`/api/companies/${f.id}`, { method: "DELETE", headers: authHeader(fx.admin.token) });

    const mitglied = await fx.app.request(`/api/team/${mitgliedId}`, { headers: authHeader(fx.a.token) });
    expect(mitglied.status).toBe(200);
    expect(((await mitglied.json()) as { companyId: string | null }).companyId).toBeNull();
  });
});
