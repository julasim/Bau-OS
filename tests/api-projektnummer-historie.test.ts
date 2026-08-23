import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Frühere Projektnummern (Migration 053).
//
// ── Das Problem, das die Spalte löst ────────────────────────────────────────
//
// Jede Ausgabe des Hauses zieht die Projektnummer LIVE aus `projects`:
// Word-Export, Markdown-Dossier, Dateiname, Suchtreffer, jede Liste. Kein
// Kind-Datensatz hält einen Schnappschuss.
//
// Wird die Nummer korrigiert — und sie wird korrigiert, sie ist von Hand
// vergeben —, dann trägt das bereits versendete Protokoll die alte Nummer, und
// im Programm findet man darunter nichts mehr. Genau das macht eine Korrektur
// zu etwas, das man lieber unterlässt; und dann steht dauerhaft die falsche
// Nummer im System.
describe.skipIf(!HAS_DB)("Projektnummer — Historie", () => {
  let fx: AclFixture;
  const P = namensraum();
  const projekt = `pnh-${P}`;
  const nr = (s: string) => `SAZTG-${P}-${s}`;

  beforeAll(async () => {
    fx = await setupAclFixture("pnh");
    const res = await fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: projekt, projektnummer: nr("014") }),
    });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM projects WHERE name LIKE ${"pnh-" + P + "%"}`;
    await fx.cleanup();
  });

  const aendern = (auf: string, name = projekt) =>
    fx.app.request(`/api/projects/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projektnummer: auf }),
    });

  const lesen = async (name = projekt) => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(name)}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { projektnummer: string; projektnummerFrueher: string[] };
  };

  it("ein frisches Projekt hat keine Historie", () => {
    return lesen().then((p) => expect(p.projektnummerFrueher).toEqual([]));
  });

  it("eine Korrektur hebt die alte Nummer auf", async () => {
    expect((await aendern(nr("015"))).status).toBe(200);
    const p = await lesen();
    expect(p.projektnummer).toBe(nr("015"));
    expect(p.projektnummerFrueher).toEqual([nr("014")]);
  });

  it("zwei Korrekturen ergeben zwei Einträge, älteste zuerst", async () => {
    // Der Reihenfolgetest ist nicht kosmetisch: die Spalte ist ein Feld, und
    // ein dynamisch gebautes UPDATE hat es beinahe als Zeichenkette
    // geschrieben — dann wäre aus zwei Einträgen einer geworden.
    expect((await aendern(nr("016"))).status).toBe(200);
    const p = await lesen();
    expect(p.projektnummerFrueher).toEqual([nr("014"), nr("015")]);
  });

  it("dasselbe zweimal einzutragen ändert nichts", async () => {
    const vorher = (await lesen()).projektnummerFrueher;
    expect((await aendern(nr("016"))).status).toBe(200);
    expect((await lesen()).projektnummerFrueher).toEqual(vorher);
  });

  it("nach einer Rückkorrektur steht die AKTUELLE Nummer nicht in der Historie", async () => {
    // Die Liste beantwortet genau eine Frage: welche Nummern trug das Projekt
    // einmal und trägt sie nicht mehr? Hin und zurück (016 → 014 → 016) darf
    // also nicht dazu führen, dass 016 unter „früher: …" auftaucht — sie ist
    // die aktuelle.
    //
    // Beim ersten Bau tat es das. Der Fall ist hier festgehalten, weil er
    // beim Lesen des Codes nicht auffällt: das Anhängen ist offensichtlich,
    // das Entfernen nicht.
    await aendern(nr("014"));
    expect((await lesen()).projektnummerFrueher).not.toContain(nr("014"));

    await aendern(nr("016"));
    const p = await lesen();
    expect(p.projektnummer).toBe(nr("016"));
    expect(p.projektnummerFrueher).not.toContain(nr("016"));
    // Beide früheren Nummern sind weiterhin da — die Reihenfolge ist die des
    // Ausscheidens, nicht die der Vergabe.
    expect([...p.projektnummerFrueher].sort()).toEqual([nr("014"), nr("015")].sort());
  });

  it("der Platzhalter aus Migration 052 landet nicht in der Historie", async () => {
    // Er war nie eine Aktennummer. Stünde er unter „früher: …", sähe es aus,
    // als hätte das Büro einmal so nummeriert.
    const { getDb } = await import("../src/db/client.js");
    const mitPlatzhalter = `pnh-${P}-alt`;
    await getDb()`
      INSERT INTO projects (name, projektnummer, status)
      VALUES (${mitPlatzhalter}, ${"OHNE-NUMMER-" + P.slice(0, 8)}, 'aktiv')`;

    expect((await aendern(nr("100"), mitPlatzhalter)).status).toBe(200);
    const p = await lesen(mitPlatzhalter);
    expect(p.projektnummer).toBe(nr("100"));
    expect(p.projektnummerFrueher).toEqual([]);
  });

  // ── Suche ─────────────────────────────────────────────────────────────────

  it("das Projekt ist weiterhin unter seiner ALTEN Nummer auffindbar", async () => {
    // Der eigentliche Zweck. Ein Protokoll mit der alten Nummer auf dem Papier
    // muss zu einem auffindbaren Projekt führen.
    const res = await fx.app.request(`/api/search?q=${encodeURIComponent(nr("014"))}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { title: string }[] };
    expect(results.some((r) => r.title === projekt)).toBe(true);
  });

  it("und selbstverständlich unter der aktuellen", async () => {
    const res = await fx.app.request(`/api/search?q=${encodeURIComponent(nr("016"))}`, {
      headers: authHeader(fx.admin.token),
    });
    const { results } = (await res.json()) as { results: { title: string }[] };
    expect(results.some((r) => r.title === projekt)).toBe(true);
  });

  // ── Wiedervergabe ─────────────────────────────────────────────────────────

  it("eine frühere Nummer lässt sich neu vergeben", async () => {
    // Bewusst so: sonst wäre jeder Tippfehler eine dauerhaft verbrannte
    // Nummer. Wer sich einmal bei 014 vertippt und auf 015 korrigiert, könnte
    // 014 nie mehr benutzen — obwohl sie nie in Gebrauch war.
    const res = await fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `pnh-${P}-neu`, projektnummer: nr("014") }),
    });
    expect(res.status).toBe(201);
  });

  it("danach findet die Suche beide — mit klarer aktueller Zuordnung", async () => {
    // Der Preis der Wiedervergabe. Beide Projekte haben mit der Nummer
    // wirklich zu tun; die Oberfläche beschriftet den historischen Treffer.
    const res = await fx.app.request(`/api/search?q=${encodeURIComponent(nr("014"))}`, {
      headers: authHeader(fx.admin.token),
    });
    const { results } = (await res.json()) as { results: { title: string; projektnummer?: string | null }[] };
    const treffer = results.filter((r) => r.title.startsWith(`pnh-${P}`));
    expect(treffer.length).toBeGreaterThanOrEqual(2);
    // Das Projekt, das die Nummer AKTUELL trägt, liefert sie auch als solche.
    expect(treffer.find((t) => t.title === `pnh-${P}-neu`)?.projektnummer).toBe(nr("014"));
  });
});
