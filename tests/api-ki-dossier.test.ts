import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Die KI-Dossiers — und die Freigabe davor.
//
// ── Was hier geprüft wird ──────────────────────────────────────────────────
//
// Nicht, ob die Akte schön aussieht. Sondern die vier Zusicherungen, ohne die
// man ein Sprachmodell nicht an Bauherrendaten lassen darf:
//
//   1. DENY BY DEFAULT — ohne Freigabe entsteht gar nichts.
//   2. Der HAUPTSCHALTER sticht alles. Auch ein freigegebenes Projekt liefert
//      nichts, solange er aus ist.
//   3. Nur die FREIGEGEBENEN Kategorien landen in der Akte.
//   4. Die PERSONENDATEN-Stufe wirkt quer über alle Kategorien.
//
// Dazu der Leck-Test: was das Whitelist-Rendering nicht ausdrücklich schreibt,
// darf nicht in der Akte stehen — `rev`, `such_text`, die rohe Konto-UUID in
// `created_by`.
describe.skipIf(!HAS_DB)("KI-Dossier", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const P = `ki-${namensraum()}`;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("kidos", { geldRecht: true });
    ({ getDb } = await import("../src/db/client.js"));

    const n = encodeURIComponent(fx.projectName);

    // Ein Mitglied MIT Kontaktdaten — daran wird die Personendaten-Stufe
    // sichtbar.
    const m = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        name: `${P}-Anna`,
        memberType: "Intern",
        email: "anna@example.at",
        phone: "+43 316 123",
      }),
    });
    const mitgliedId = ((await m.json()) as { id: string }).id;
    await fx.app.request(`/api/team/${mitgliedId}/projects`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projectId: fx.projectId }),
    });

    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-Einreichplan`, project: fx.projectName, assigneeId: mitgliedId }),
    });
    await fx.app.request(`/api/projects/${n}/meetings`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ title: `${P}-Jour-fixe`, date: "2026-07-01", attendeeIds: [mitgliedId] }),
    });
    await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ content: `${P}-Aktenvermerk\n\nGEHEIMER-NOTIZTEXT`, project: fx.projectName }),
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM ki_freigabe_projekt WHERE project_id = ${fx.projectId}::uuid`;
    await getDb()`UPDATE ki_freigabe SET aktiv = false, personendaten = 'namen-ohne-kontakt' WHERE id = 1`;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await getDb()`DELETE FROM team_members WHERE name LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  const freigeben = async (kategorien: string[]) => {
    const res = await fx.app.request(`/api/ki/freigabe/${fx.projectId}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ kategorien }),
    });
    expect(res.status).toBe(200);
  };

  const schalter = async (patch: Record<string, unknown>) => {
    const res = await fx.app.request("/api/ki/freigabe", {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify(patch),
    });
    expect(res.status).toBe(200);
  };

  const akte = async (): Promise<{ status: number; text: string }> => {
    const res = await fx.app.request(`/api/ki/dossier/${fx.projectId}`, { headers: authHeader(fx.admin.token) });
    return { status: res.status, text: await res.text() };
  };

  // ── 1. Deny by default ───────────────────────────────────────────────────

  it("ohne Freigabe gibt es kein Dossier", async () => {
    const { status } = await akte();
    expect(status).toBe(404);
  });

  it("die Voreinstellung ist: Hauptschalter aus, keine Projekte", async () => {
    const res = await fx.app.request("/api/ki/freigabe", { headers: authHeader(fx.admin.token) });
    const f = (await res.json()) as { aktiv: boolean; projekte: Record<string, string[]> };
    expect(f.aktiv).toBe(false);
    expect(f.projekte[fx.projectId] ?? []).toEqual([]);
  });

  // ── 2. Der Hauptschalter sticht ──────────────────────────────────────────

  it("ein freigegebenes Projekt liefert NICHTS, solange der Hauptschalter aus ist", async () => {
    await freigeben(["stammdaten", "aufgaben"]);
    const { status } = await akte();
    expect(status).toBe(404);
  });

  // ── 3. Nur die freigegebenen Kategorien ──────────────────────────────────

  it("mit Hauptschalter und zwei Kategorien entsteht eine Akte", async () => {
    await schalter({ aktiv: true });
    const { status, text } = await akte();
    expect(status).toBe(200);
    expect(text).toContain(fx.projectName);
    expect(text).toContain("## Stammdaten");
    expect(text).toContain("## Aufgaben");
    expect(text).toContain(`${P}-Einreichplan`);
  });

  it("nicht freigegebene Kategorien fehlen vollständig", async () => {
    const { text } = await akte();
    expect(text).not.toContain("## Besprechungen");
    expect(text).not.toContain("## Notizen");
    expect(text).not.toContain(`${P}-Jour-fixe`);
    expect(text).not.toContain("GEHEIMER-NOTIZTEXT");
  });

  it("eine entzogene Kategorie verschwindet wieder", async () => {
    // Der Fall, der bei einem „Ergänzen" statt „Ersetzen" stehen bliebe.
    await freigeben(["stammdaten"]);
    const { text } = await akte();
    expect(text).toContain("## Stammdaten");
    expect(text).not.toContain("## Aufgaben");
  });

  // ── 4. Personendaten-Stufen ──────────────────────────────────────────────

  it("Stufe namen-ohne-kontakt: Namen ja, Kontaktdaten nein", async () => {
    await freigeben(["stammdaten", "beteiligte", "aufgaben"]);
    await schalter({ personendaten: "namen-ohne-kontakt" });
    const { text } = await akte();
    expect(text).toContain(`${P}-Anna`);
    expect(text).not.toContain("anna@example.at");
    expect(text).not.toContain("+43 316 123");
  });

  it("Stufe keine: auch die Namen sind weg, die IDs bleiben", async () => {
    // Die ID ist ein Pseudonym — dasselbe über alle Abschnitte. Ohne sie wäre
    // „wer war in Besprechung X und hat Aufgabe Y?" nicht mehr beantwortbar.
    await schalter({ personendaten: "keine" });
    const { text } = await akte();
    expect(text).not.toContain(`${P}-Anna`);
    expect(text).not.toContain("anna@example.at");
  });

  it("Stufe alle: die Kontaktdaten stehen drin", async () => {
    await schalter({ personendaten: "alle" });
    const { text } = await akte();
    expect(text).toContain("anna@example.at");
  });

  // ── 5. Leck-Test ─────────────────────────────────────────────────────────

  it("was die Whitelist nicht schreibt, steht nicht in der Akte", async () => {
    await freigeben([...["stammdaten", "phasen", "aufgaben", "termine", "notizen"]]);
    const { text } = await akte();
    // Interne Felder, die in jedem DTO stecken.
    for (const feld of ["such_text", '"rev"', "created_by", "deleted_at", "updatedAt"]) {
      expect(text, feld).not.toContain(feld);
    }
    // Die rohe Konto-UUID des Admins darf nirgends auftauchen.
    expect(text).not.toContain(fx.admin.id);
  });

  // ── 6. Rechte ────────────────────────────────────────────────────────────

  it("nur die Verwaltung darf die Freigabe sehen und ändern", async () => {
    for (const [methode, pfad, koerper] of [
      ["GET", "/api/ki/freigabe", null],
      ["PATCH", "/api/ki/freigabe", { aktiv: false }],
      ["PUT", `/api/ki/freigabe/${fx.projectId}`, { kategorien: [] }],
    ] as const) {
      const res = await fx.app.request(pfad, {
        method: methode,
        headers: koerper ? jsonHeader(fx.a.token) : authHeader(fx.a.token),
        body: koerper ? JSON.stringify(koerper) : undefined,
      });
      expect(res.status, `${methode} ${pfad}`).toBe(403);
    }
  });

  it("auch das LESEN einer Akte ist Verwaltungssache", async () => {
    // Die Freigabe ist unabhängig von der Projektzuordnung. Ohne diese
    // Einschränkung wäre der Dossier-Abruf der Weg, auf dem jedes Konto an
    // jedes freigegebene Projekt käme.
    const res = await fx.app.request(`/api/ki/dossier/${fx.projectId}`, { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(403);
  });

  it("eine unbekannte Kategorie wird abgewiesen, nicht stillschweigend verworfen", async () => {
    // Sonst sieht die Oberfläche ein Häkchen, das nie gesetzt wurde.
    const res = await fx.app.request(`/api/ki/freigabe/${fx.projectId}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ kategorien: ["stammdaten", "gehaltsliste"] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("gehaltsliste");
  });

  it("eine unbekannte Personendaten-Stufe wird abgewiesen", async () => {
    const res = await fx.app.request("/api/ki/freigabe", {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ personendaten: "egal" }),
    });
    expect(res.status).toBe(400);
  });
});
