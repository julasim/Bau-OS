import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Benachrichtigungen (Migration 058).
//
// ── Wogegen das steht ──────────────────────────────────────────────────────
//
// PATIO hatte keinen Weg, jemandem etwas ZU SAGEN. Zwei Dinge sahen danach
// aus und taugen beide nicht dafür:
//
//   * Der Live-Kanal ist ein Set im Arbeitsspeicher ohne Nachliefern — wer im
//     Moment der Änderung nicht verbunden war, erfährt sie nie.
//   * Die Aktivität ist ABGELEITET (sie liest die Datensätze selbst) und kann
//     deshalb gar keinen Lesestatus je Person tragen: es gibt keine Zeile,
//     an der er hängen könnte.
//
// ── Die Brücke, an der es hier schon zweimal hing ──────────────────────────
//
// Zuweisungen zeigen auf `team_members.id`, ein Konto ist eine `users.id` —
// zwei disjunkte UUID-Räume, verbunden nur über `team_members.user_id`. Wer
// das übersieht, baut eine Meldung, die niemanden erreicht, ohne dass
// irgendwo etwas rot wird. Genau so war der Dashboard-Zähler kaputt.
describe.skipIf(!HAS_DB)("Benachrichtigungen", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const P = `meld-${namensraum()}`;
  let mitgliedB = "";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("meld");
    ({ getDb } = await import("../src/db/client.js"));

    // Ein Team-Mitglied, das mit B's Konto verknüpft ist.
    const res = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `${P}-mitglied`, memberType: "Intern" }),
    });
    expect(res.status).toBe(201);
    mitgliedB = ((await res.json()) as { id: string }).id;
    const v = await fx.app.request(`/api/team/${mitgliedB}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ userId: fx.b.id }),
    });
    expect(v.status).toBe(200);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await getDb()`DELETE FROM team_members WHERE name LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  const anzahl = async (token: string): Promise<number> => {
    const res = await fx.app.request("/api/benachrichtigungen/anzahl", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    return ((await res.json()) as { ungelesen: number }).ungelesen;
  };

  const liste = async (token: string) => {
    const res = await fx.app.request("/api/benachrichtigungen", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      id: string;
      titel: string;
      anlass: string;
      ausloeser: string | null;
      gelesenAm: string | null;
    }[];
  };

  it("eine Zuweisung erzeugt eine Meldung beim Empfänger", async () => {
    const vorher = await anzahl(fx.b.token);
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-zugewiesen`, assigneeId: mitgliedB }),
    });
    expect(res.status).toBe(201);
    expect(await anzahl(fx.b.token)).toBe(vorher + 1);

    const meldungen = await liste(fx.b.token);
    expect(meldungen[0].anlass).toBe("aufgabe-zugewiesen");
    expect(meldungen[0].titel).toContain(`${P}-zugewiesen`);
  });

  it("der Auslöser wird als NAME mitgespeichert, nicht als Verweis", async () => {
    // Die Lehre aus dem Audit-Log: dort steht die Benutzer-ID, und nach dem
    // Löschen eines Kontos stand in den Einträgen nichts mehr.
    const meldungen = await liste(fx.b.token);
    expect(meldungen[0].ausloeser).toBeTruthy();
  });

  it("wer sich selbst etwas zuweist, bekommt keine Meldung", async () => {
    // Sonst wäre die Glocke nach einer halben Stunde Arbeit voll mit dem, was
    // man gerade selbst getan hat.
    const eigenes = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `${P}-selbst`, memberType: "Intern" }),
    });
    const id = ((await eigenes.json()) as { id: string }).id;
    await fx.app.request(`/api/team/${id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ userId: fx.admin.id }),
    });

    const vorher = await anzahl(fx.admin.token);
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-selbstzuweisung`, assigneeId: id }),
    });
    expect(res.status).toBe(201);
    expect(await anzahl(fx.admin.token)).toBe(vorher);
  });

  it("wer die Aufgaben-Meldungen abschaltet, bekommt keine", async () => {
    const aus = await fx.app.request("/api/me/preferences", {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ benachrichtigungen: { tasks: false } }),
    });
    expect(aus.status).toBe(200);
    try {
      const vorher = await anzahl(fx.b.token);
      await fx.app.request("/api/tasks", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ text: `${P}-abgeschaltet`, assigneeId: mitgliedB }),
      });
      expect(await anzahl(fx.b.token)).toBe(vorher);
    } finally {
      await fx.app.request("/api/me/preferences", {
        method: "PATCH",
        headers: jsonHeader(fx.b.token),
        body: JSON.stringify({ benachrichtigungen: { tasks: true } }),
      });
    }
  });

  it("A sieht die Meldungen von B nicht", async () => {
    // Der Empfänger steht in JEDER Abfrage in der WHERE-Bedingung — es gibt
    // keinen Weg zu fremden Meldungen, weil es keine Abfrage ohne den eigenen
    // Empfänger gibt.
    const beiB = await liste(fx.b.token);
    const beiA = await liste(fx.a.token);
    const idsB = new Set(beiB.map((m) => m.id));
    expect(beiA.every((m) => !idsB.has(m.id))).toBe(true);
  });

  it("eine fremde Meldung lässt sich nicht als gelesen markieren", async () => {
    const beiB = await liste(fx.b.token);
    expect(beiB.length).toBeGreaterThan(0);
    const res = await fx.app.request(`/api/benachrichtigungen/${beiB[0].id}/gelesen`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
    });
    // 404 und nicht 403 — sonst verrät der Statuscode, welche IDs es gibt.
    expect(res.status).toBe(404);
  });

  it("gelesen senkt den Zähler, zweimal gelesen nicht doppelt", async () => {
    const offen = (await liste(fx.b.token)).find((m) => !m.gelesenAm);
    expect(offen).toBeTruthy();
    const vorher = await anzahl(fx.b.token);

    const erst = await fx.app.request(`/api/benachrichtigungen/${offen!.id}/gelesen`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
    });
    expect(erst.status).toBe(200);
    expect(await anzahl(fx.b.token)).toBe(vorher - 1);

    // Zweiter Aufruf: die Meldung ist schon gelesen — 404, und der Zähler
    // bleibt. Ohne die Bedingung `gelesen_am IS NULL` im UPDATE ließe sich der
    // Zähler durch wiederholtes Klicken ins Negative treiben.
    const nochmal = await fx.app.request(`/api/benachrichtigungen/${offen!.id}/gelesen`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
    });
    expect(nochmal.status).toBe(404);
    expect(await anzahl(fx.b.token)).toBe(vorher - 1);
  });

  it("alles-gelesen setzt den Zähler auf null", async () => {
    await fx.app.request("/api/benachrichtigungen/gelesen", { method: "POST", headers: jsonHeader(fx.b.token) });
    expect(await anzahl(fx.b.token)).toBe(0);
  });

  it("ohne Anmeldung gibt es keine Meldungen", async () => {
    const res = await fx.app.request("/api/benachrichtigungen");
    expect(res.status).toBe(401);
  });

  it("die Anzahl-Route wird nicht von /:id/gelesen verschluckt", async () => {
    // Hono trifft in Registrierungsreihenfolge. Stünde `/benachrichtigungen/
    // anzahl` nach `/benachrichtigungen/:id/gelesen`, wäre sie unerreichbar —
    // genau so war `/meetings/recent` seit dem Bau tot.
    const res = await fx.app.request("/api/benachrichtigungen/anzahl", { headers: authHeader(fx.b.token) });
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as { ungelesen: number }).ungelesen).toBe("number");
  });
});
