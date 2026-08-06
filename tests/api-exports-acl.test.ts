import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Export-Routen (`/api/exports/*`) hatten KEINE einzige Rechteprüfung —
// weder auf das Projekt noch auf die Rolle. Sie erzeugen Word-Dateien mit
// vollem Inhalt: Besprechungsprotokolle, Bautagebuch-Einträge, Projektbericht
// und Stundenlisten samt Beträgen.
//
// Damit war der Export die bequemste Umgehung der gesamten ACL: was die
// Listen-Routen sauber gefiltert haben, ließ sich über einen einzigen
// GET-Aufruf trotzdem herunterladen. Beim Stundenexport betrifft es zusätzlich
// das Geld-Recht — die Datei trägt Stundensätze und Beträge.
//
// B ist hier der Prüfstein: teil-berechtigt (sieht sein eigenes Projekt),
// aber nicht A's. Ein kaputter Check „hat irgendein Projekt → darf alles"
// bliebe bei einem Nutzer ohne jede Sichtbarkeit unentdeckt.
describe.skipIf(!HAS_DB)("Export-Routen — Rechte", () => {
  let fx: AclFixture;
  let meetingId = "";
  let bautagebuchId = "";

  beforeAll(async () => {
    fx = await setupAclFixture("expacl");

    // Eine Besprechung und ein Bautagebuch-Eintrag in A's Projekt — B darf
    // beide nicht exportieren.
    const m = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/meetings`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ title: "Bauherrenbesprechung", date: "2026-09-01" }),
    });
    expect(m.status).toBe(201);
    meetingId = ((await m.json()) as { id: string }).id;

    // Bautagebuch wird ueber Projekt + Datum angelegt (PUT, kein POST).
    const bt = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/bautagebuch/2026-09-01`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ wetter: "sonnig", notes: "Rohbau begonnen" }),
    });
    expect([200, 201]).toContain(bt.status);
    bautagebuchId = ((await bt.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  it("Projektbericht: ein Fremder bekommt ihn nicht", async () => {
    const res = await fx.app.request(`/api/exports/project/${encodeURIComponent(fx.projectName)}/summary`, {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("Projektbericht: der Berechtigte bekommt ihn", async () => {
    const res = await fx.app.request(`/api/exports/project/${encodeURIComponent(fx.projectName)}/summary`, {
      headers: authHeader(fx.a.token),
    });
    // 200 mit Word-Datei, oder 400 wenn keine Vorlage hinterlegt ist — nur
    // 403 darf es nicht sein. Die Rechteprüfung darf den Berechtigten nicht
    // mit aussperren; genau das ist der häufigste Fehler beim Nachrüsten.
    expect(res.status).not.toBe(403);
  });

  it("Stundenexport: ein Fremder bekommt die Stunden fremder Projekte nicht", async () => {
    const res = await fx.app.request(`/api/exports/time-entries?project=${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("Stundenexport ohne Projektangabe geht nur an den Admin", async () => {
    // Ohne `project` umfasst der Export ALLE Projekte. Für einen normalen
    // Nutzer ließe sich daraus die gesamte Auslastung des Büros ablesen —
    // samt Stundensätzen.
    const alsNutzer = await fx.app.request("/api/exports/time-entries", { headers: authHeader(fx.b.token) });
    expect(alsNutzer.status).toBe(403);

    const alsAdmin = await fx.app.request("/api/exports/time-entries", { headers: authHeader(fx.admin.token) });
    expect(alsAdmin.status).not.toBe(403);
  });

  it("Besprechungsprotokoll: ein Fremder bekommt es nicht", async () => {
    expect(meetingId).not.toBe("");
    const res = await fx.app.request(`/api/exports/meeting/${meetingId}`, { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(403);
  });

  it("Bautagebuch: ein Fremder bekommt es nicht", async () => {
    expect(bautagebuchId).not.toBe("");
    const res = await fx.app.request(`/api/exports/bautagebuch/${bautagebuchId}`, {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(403);
  });

  it("ein unbekannter Datensatz gibt 404, nicht 403", async () => {
    // Sonst verrät der Statuscode, welche IDs existieren.
    const res = await fx.app.request("/api/exports/meeting/00000000-0000-0000-0000-000000000000", {
      headers: authHeader(fx.b.token),
    });
    expect(res.status).toBe(404);
  });
});
