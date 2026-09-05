import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der Konfliktschutz — geprüft an der WIRKUNG, nicht am Anfragekörper.
//
// ── Warum es diese Datei gibt ──────────────────────────────────────────────
//
// `pruefeRev` (src/data/konflikt.ts) steigt ohne mitgeschickten Zähler STILL
// aus. Der Schutz ist damit vom Client aus opt-in — und ob ein Client ihn
// wirklich erreicht, hängt an einer Kette: Oberfläche → Route → Repository.
//
// Bei `PATCH /team/:id` war diese Kette **unterbrochen**: Die Route baut ihr
// Update aus einer Weißliste von acht Feldnamen, `rev` war keiner davon, und
// `db-team.ts` sah deshalb immer `undefined`. Zwei Personen, die dasselbe
// Mitglied bearbeiteten, überschrieben einander lautlos — und kein Aufrufer
// hätte daran etwas ändern können.
//
// ⚠ **Ein Test, der prüft „das Frontend schickt `rev` mit", wäre dabei grün
// geblieben.** Deshalb prüft diese Datei die Wirkung: zweimal mit demselben
// Zähler schreiben, der zweite Aufruf muss 409 ergeben. Das ist die einzige
// Form, die den Unterschied zwischen „eingebaut" und „wirksam" kennt.
describe.skipIf(!HAS_DB)("Konfliktschutz ist von außen erreichbar", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const aufraeumen: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("konflikt-erreichbar");
    ({ getDb } = await import("../src/db/client.js"));
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    for (const weg of aufraeumen) await weg();
    await fx.cleanup();
  });

  /**
   * Das Muster für jede Datenart: anlegen, `rev` merken, zweimal mit
   * demselben Zähler schreiben.
   *
   * Der erste Schreibvorgang muss gelingen (sonst prüft der zweite nichts),
   * der zweite muss 409 ergeben — und die Antwort muss den aktuellen Stand
   * mitschicken, damit die Oberfläche ihn übernehmen kann, ohne die Eingabe
   * des Nutzers wegzuwerfen.
   */
  async function pruefeKonflikt(
    name: string,
    pfad: string,
    methode: "PUT" | "PATCH",
    koerper: Record<string, unknown>,
  ) {
    const laden = await fx.app.request(pfad, { headers: authHeader(fx.a.token) });
    expect(laden.status, `${name}: laden`).toBe(200);
    const stand = (await laden.json()) as { rev?: number };
    expect(
      stand.rev,
      `${name}: die Route liefert gar kein rev — dann kann es der Client auch nicht zurückschicken`,
    ).toBeTypeOf("number");

    const erster = await fx.app.request(pfad, {
      method: methode,
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ ...koerper, rev: stand.rev }),
    });
    expect(erster.status, `${name}: erster Schreibvorgang`).toBe(200);

    const zweiter = await fx.app.request(pfad, {
      method: methode,
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ ...koerper, rev: stand.rev }),
    });
    expect(zweiter.status, `${name}: zweiter Schreibvorgang mit VERALTETEM Zähler`).toBe(409);

    const fehler = (await zweiter.json()) as { konflikt?: boolean; aktuell?: unknown; aktuelleRev?: number };
    expect(fehler.konflikt, `${name}: Antwort ohne konflikt-Marke`).toBe(true);
    expect(fehler.aktuell, `${name}: der aktuelle Stand fehlt in der Antwort`).toBeTruthy();
    expect(fehler.aktuelleRev, `${name}: aktuelleRev fehlt`).toBeGreaterThan(stand.rev!);
  }

  // ── Die Stelle, an der die Kette unterbrochen war ─────────────────────────

  it("Team-Mitglied: der Zähler erreicht das Repository", async () => {
    const angelegt = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: `konflikt-mitglied-${Date.now()}`, memberType: "Intern" }),
    });
    expect([200, 201]).toContain(angelegt.status);
    const id = ((await angelegt.json()) as { id: string }).id;
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM team_members WHERE id = ${id}`;
    });

    await pruefeKonflikt("Team", `/api/team/${id}`, "PATCH", { role: "Projektleitung" });
  });

  // ── Die Gegenrichtung: dort war er schon immer erreichbar ────────────────
  //
  // Ohne diese Zeilen wäre nicht belegt, dass der Team-Fall der Ausreißer war
  // und nicht die Regel — und beim nächsten Umbau wüsste niemand, welche
  // Wege geprüft sind.

  it("Aufgabe: der Zähler erreicht das Repository", async () => {
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `konflikt-aufgabe-${Date.now()}`, project: fx.projectName }),
    });
    expect([200, 201]).toContain(angelegt.status);
    const id = ((await angelegt.json()) as { id: string }).id;
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM tasks WHERE id = ${id}`;
    });

    await pruefeKonflikt("Aufgabe", `/api/tasks/${id}`, "PUT", { location: "Büro" });
  });

  it("Termin: der Zähler erreicht das Repository", async () => {
    const angelegt = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "2027-05-04", text: `konflikt-termin-${Date.now()}`, project: fx.projectName }),
    });
    expect(angelegt.status).toBe(201);
    const id = ((await angelegt.json()) as { id: string }).id;
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM termine WHERE id = ${id}`;
    });

    await pruefeKonflikt("Termin", `/api/termine/${id}`, "PUT", { location: "Baustelle" });
  });

  // ── Und der Nachweis, dass er ohne Zähler weiterhin schweigt ─────────────

  it("ohne mitgeschickten Zähler gilt weiterhin „zuletzt gewinnt“", async () => {
    // Das ist Absicht und keine Lücke: es gibt Aufrufer außerhalb der eigenen
    // Oberfläche. Festgehalten, damit niemand den Schutz versehentlich
    // verpflichtend macht und damit alte Clients bricht — und damit umgekehrt
    // sichtbar bleibt, dass „kein 409" hier NICHT heißt „geschützt".
    const angelegt = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "2027-05-05", text: `konflikt-ohne-rev-${Date.now()}` }),
    });
    const id = ((await angelegt.json()) as { id: string }).id;
    aufraeumen.push(async () => {
      await getDb()`DELETE FROM termine WHERE id = ${id}`;
    });

    for (const durchgang of [1, 2]) {
      const res = await fx.app.request(`/api/termine/${id}`, {
        method: "PUT",
        headers: jsonHeader(fx.a.token),
        body: JSON.stringify({ location: `Durchgang ${durchgang}` }),
      });
      expect(res.status, `Durchgang ${durchgang}`).toBe(200);
    }
  });
});
