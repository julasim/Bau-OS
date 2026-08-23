import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Rechnungsnummern aus der Projektnummer (Migrationen 052/053).
//
// ── Vorschlag, nicht Vergabe ────────────────────────────────────────────────
//
// Die Rechnungsnummer ist steuerlich relevant. Eine Software, die die
// Buchhaltung des Hauses nicht kennt, sollte sie nicht erzwingen: Stornos,
// übernommene Vorgänge und Korrekturen brauchen Nummern, die aus keinem
// Schema folgen. PATIO nimmt die Arbeit ab, die Entscheidung bleibt im Büro —
// das Feld ist überschreibbar, und ein Doppel wird gewarnt, nicht gesperrt.
describe.skipIf(!HAS_DB)("Rechnungsnummer aus der Projektnummer", () => {
  let fx: AclFixture;
  const P = namensraum();
  const projekt = `rnr-${P}`;
  const nummer = `SAZTG-${P}-014`;

  beforeAll(async () => {
    fx = await setupAclFixture("rnr");
    const res = await fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: projekt, projektnummer: nummer }),
    });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM projects WHERE name LIKE ${"rnr-" + P + "%"}`;
    await fx.cleanup();
  });

  const vorschlag = async (name = projekt) => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(name)}/invoices/naechste-nummer`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { vorschlag: string | null }).vorschlag;
  };

  // Die Anlage antwortet mit 200, nicht 201 — so ist die Route gebaut
  // (src/api/routes/invoices.ts). Hier festgehalten, damit der naechste Leser
  // nicht denselben Irrtum macht wie diese Testdatei beim ersten Lauf.
  const anlegen = (nr: string | null, name = projekt) =>
    fx.app.request(`/api/projects/${encodeURIComponent(name)}/invoices`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ nummer: nr, betrag: 1000, status: "entwurf" }),
    });

  it("die erste Rechnung bekommt R01", async () => {
    expect(await vorschlag()).toBe(`${nummer}-R01`);
  });

  it("nach der ersten wird R02 vorgeschlagen", async () => {
    expect((await anlegen(`${nummer}-R01`)).status).toBe(200);
    expect(await vorschlag()).toBe(`${nummer}-R02`);
  });

  it("der Zähler richtet sich nach der höchsten vergebenen Nummer, nicht nach der Anzahl", async () => {
    // Der Grund: gelöschte oder von Hand umbenannte Rechnungen verschieben die
    // Anzahl, und ein Vorschlag aus `Anzahl + 1` zeigte dann auf eine bereits
    // vergebene Nummer.
    expect((await anlegen(`${nummer}-R07`)).status).toBe(200);
    expect(await vorschlag()).toBe(`${nummer}-R08`);
  });

  it("Rechnungen mit abweichender Nummer stören den Zähler nicht", async () => {
    // Ein Storno oder ein übernommener Vorgang darf heißen, wie er heißt.
    expect((await anlegen("Storno 2019/4")).status).toBe(200);
    expect(await vorschlag()).toBe(`${nummer}-R08`);
  });

  it("eine Rechnung ohne Nummer stört ihn ebenso wenig", async () => {
    expect((await anlegen(null)).status).toBe(200);
    expect(await vorschlag()).toBe(`${nummer}-R08`);
  });

  it("die Zählung ist unempfindlich gegen Groß-/Kleinschreibung", async () => {
    expect((await anlegen(`${nummer.toLowerCase()}-r09`)).status).toBe(200);
    expect(await vorschlag()).toBe(`${nummer}-R10`);
  });

  it("ein Projekt mit Platzhalter bekommt keinen Vorschlag", async () => {
    // Aus `OHNE-NUMMER-abc12345-R01` würde eine Rechnungsnummer, die wie eine
    // Aktennummer aussieht und keine ist.
    const { getDb } = await import("../src/db/client.js");
    const ohne = `rnr-${P}-ohne`;
    await getDb()`
      INSERT INTO projects (name, projektnummer, status)
      VALUES (${ohne}, ${"OHNE-NUMMER-" + P.slice(0, 8)}, 'aktiv')`;
    expect(await vorschlag(ohne)).toBeNull();
  });

  it("eine Projektnummer mit Sonderzeichen bricht die Zählung nicht", async () => {
    // Der Präfix geht in eine reguläre Ausdrucksform ein. `A-14/2` enthält
    // nichts Gefährliches, aber eine Aktenordnung kennt auch Klammern und
    // Punkte — unmaskiert wäre das ein anderer Ausdruck als gemeint.
    const { getDb } = await import("../src/db/client.js");
    const speziell = `rnr-${P}-spezial`;
    const speziellNr = `A.14(2)+${P}`;
    await getDb()`
      INSERT INTO projects (name, projektnummer, status) VALUES (${speziell}, ${speziellNr}, 'aktiv')`;

    expect(await vorschlag(speziell)).toBe(`${speziellNr}-R01`);
    expect((await anlegen(`${speziellNr}-R01`, speziell)).status).toBe(200);
    expect(await vorschlag(speziell)).toBe(`${speziellNr}-R02`);
  });

  it("der Vorschlag folgt einer korrigierten Projektnummer", async () => {
    // Nach einer Korrektur soll die nächste Rechnung die NEUE Aktennummer
    // tragen — die alten behalten ihre, das ist der Sinn einer Rechnungsnummer.
    const neu = `SAZTG-${P}-099`;
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(projekt)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projektnummer: neu }),
    });
    expect(res.status).toBe(200);
    expect(await vorschlag()).toBe(`${neu}-R01`);
  });
});
