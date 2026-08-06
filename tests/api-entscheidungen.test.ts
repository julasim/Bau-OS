import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Entscheidungslog (Migration 045), portiert aus `apps/patio-app-lokal`.
//
// Bisher lebten Projektentscheidungen in einem Freitextfeld am
// Besprechungsprotokoll. Sie waren damit nicht auffindbar, die Begründung ging
// verloren — und Entscheidungen, die am Telefon fielen, wurden gar nicht
// erfasst.
describe.skipIf(!HAS_DB)("Entscheidungslog", () => {
  let fx: AclFixture;
  let besprechungId = "";
  let fremdeBesprechungId = "";

  beforeAll(async () => {
    fx = await setupAclFixture("entsch");

    const m = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/meetings`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ title: "Bauherrenbesprechung 3", date: "2026-09-01" }),
    });
    expect(m.status).toBe(201);
    besprechungId = ((await m.json()) as { id: string }).id;

    const fremd = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectBName)}/meetings`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ title: "Fremde Besprechung", date: "2026-09-01" }),
    });
    expect(fremd.status).toBe(201);
    fremdeBesprechungId = ((await fremd.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  async function anlegen(body: Record<string, unknown>, token = fx.a.token) {
    return fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/entscheidungen`, {
      method: "POST",
      headers: jsonHeader(token),
      body: JSON.stringify(body),
    });
  }

  it("legt eine Entscheidung mit Begründung und Alternativen an", async () => {
    const res = await anlegen({
      datum: "2026-09-01",
      titel: "Fenster in Holz-Alu",
      begruendung: "Wartungsarm außen, Wohnlichkeit innen. Bauherr trägt Mehrkosten.",
      alternativen: [
        { text: "Fenster in Holz", verworfenWeil: "Wartungsaufwand an der Wetterseite" },
        { text: "Fenster in Kunststoff", verworfenWeil: "Vom Bauherrn abgelehnt" },
      ],
      beteiligteExtern: ["Bauherr Müller"],
      status: "bestaetigt",
      relatedMeetingId: besprechungId,
    });
    expect(res.status).toBe(201);
    const e = (await res.json()) as {
      id: string;
      titel: string;
      alternativen: { text: string; verworfenWeil: string }[];
      status: string;
      relatedMeetingResolved: { title: string } | null;
      rev: number;
    };
    expect(e.titel).toBe("Fenster in Holz-Alu");
    expect(e.alternativen).toHaveLength(2);
    expect(e.alternativen[0].verworfenWeil).toContain("Wartungsaufwand");
    expect(e.status).toBe("bestaetigt");
    expect(e.relatedMeetingResolved?.title).toBe("Bauherrenbesprechung 3");
    expect(e.rev).toBe(1);
  });

  it("verlangt Datum und Titel — mit konkreter Begründung", async () => {
    const ohneTitel = await anlegen({ datum: "2026-09-01" });
    expect(ohneTitel.status).toBe(400);
    expect(((await ohneTitel.json()) as { error: string }).error).toContain("Titel");

    const falschesDatum = await anlegen({ datum: "01.09.2026", titel: "Egal" });
    expect(falschesDatum.status).toBe(400);
    expect(((await falschesDatum.json()) as { error: string }).error).toContain("JJJJ-MM-TT");
  });

  it("eine Besprechung aus einem fremden Projekt lässt sich nicht verknüpfen", async () => {
    // Sonst stünde in der Entscheidung des einen Projekts der Titel einer
    // Besprechung aus einem anderen — ein stiller Abfluss über die
    // Projektgrenze hinweg.
    const res = await anlegen({
      datum: "2026-09-01",
      titel: "Mit fremdem Bezug",
      relatedMeetingId: fremdeBesprechungId,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("anderen Projekt");
  });

  it("erscheint in der Projektliste und projektübergreifend", async () => {
    const liste = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/entscheidungen`, {
      headers: authHeader(fx.a.token),
    });
    expect(liste.status).toBe(200);
    const eintraege = (await liste.json()) as { titel: string }[];
    expect(eintraege.some((e) => e.titel === "Fenster in Holz-Alu")).toBe(true);

    const uebergreifend = await fx.app.request("/api/entscheidungen/recent", {
      headers: authHeader(fx.a.token),
    });
    expect(uebergreifend.status).toBe(200);
    expect(((await uebergreifend.json()) as { titel: string }[]).length).toBeGreaterThan(0);
  });

  it("`recent` zeigt nur Entscheidungen aus sichtbaren Projekten", async () => {
    // B ist teil-berechtigt: eigenes Projekt ja, A's Projekt nein.
    const res = await fx.app.request("/api/entscheidungen/recent", { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(200);
    const eintraege = (await res.json()) as { projectName: string }[];
    expect(eintraege.every((e) => e.projectName !== fx.projectName)).toBe(true);
  });

  it("ein Fremder kommt weder an die Liste noch an den Datensatz", async () => {
    const liste = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/entscheidungen`, {
      headers: authHeader(fx.b.token),
    });
    expect(liste.status).toBe(403);

    const alle = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/entscheidungen`, {
      headers: authHeader(fx.admin.token),
    });
    const ersteId = ((await alle.json()) as { id: string }[])[0].id;

    const einzeln = await fx.app.request(`/api/entscheidungen/${ersteId}`, {
      headers: authHeader(fx.b.token),
    });
    expect(einzeln.status).toBe(403);

    const geaendert = await fx.app.request(`/api/entscheidungen/${ersteId}`, {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ titel: "Übernommen" }),
    });
    expect(geaendert.status).toBe(403);
  });

  it("Ändern greift, und ein veralteter Zähler wird abgelehnt", async () => {
    const angelegt = await anlegen({ datum: "2026-09-02", titel: "Dachdeckung" });
    expect(angelegt.status).toBe(201);
    const e = (await angelegt.json()) as { id: string; rev: number };

    const erster = await fx.app.request(`/api/entscheidungen/${e.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ status: "bestaetigt", rev: e.rev }),
    });
    expect(erster.status).toBe(200);
    expect(((await erster.json()) as { status: string }).status).toBe("bestaetigt");

    const zweiter = await fx.app.request(`/api/entscheidungen/${e.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ titel: "Zu spät", rev: e.rev }),
    });
    expect(zweiter.status).toBe(409);
  });

  it("ein unbekannter Status wird abgelehnt", async () => {
    const res = await anlegen({ datum: "2026-09-03", titel: "Mit falschem Status", status: "vielleicht" });
    expect(res.status).toBe(400);
  });

  it("Löschen entfernt genau diesen Datensatz", async () => {
    const angelegt = await anlegen({ datum: "2026-09-04", titel: "Wird gelöscht" });
    const e = (await angelegt.json()) as { id: string };

    const geloescht = await fx.app.request(`/api/entscheidungen/${e.id}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(geloescht.status).toBe(200);

    const danach = await fx.app.request(`/api/entscheidungen/${e.id}`, { headers: authHeader(fx.a.token) });
    expect(danach.status).toBe(404);

    // Die anderen stehen noch.
    const liste = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/entscheidungen`, {
      headers: authHeader(fx.a.token),
    });
    expect(((await liste.json()) as unknown[]).length).toBeGreaterThan(0);
  });

  it("eine gelöschte Besprechung nimmt die Entscheidung NICHT mit", async () => {
    // `related_meeting_id` steht bewusst auf SET NULL, nicht CASCADE: die
    // Entscheidung ist das Wertvollere von beiden. Ginge sie mit, wäre das
    // genau der stille Datenverlust, den der Papierkorb gerade beseitigt hat.
    const m = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/meetings`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ title: "Wird gelöscht", date: "2026-09-05" }),
    });
    const mId = ((await m.json()) as { id: string }).id;

    const angelegt = await anlegen({
      datum: "2026-09-05",
      titel: "Überlebt die Besprechung",
      relatedMeetingId: mId,
    });
    const eId = ((await angelegt.json()) as { id: string }).id;

    await fx.app.request(`/api/meetings/${mId}`, { method: "DELETE", headers: authHeader(fx.admin.token) });

    const danach = await fx.app.request(`/api/entscheidungen/${eId}`, { headers: authHeader(fx.a.token) });
    expect(danach.status).toBe(200);
    const e = (await danach.json()) as { titel: string; relatedMeetingId: string | null };
    expect(e.titel).toBe("Überlebt die Besprechung");
    expect(e.relatedMeetingId).toBeNull();
  });
});
