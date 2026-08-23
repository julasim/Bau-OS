import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { HAS_DB, namensraum } from "./helpers/acl-fixture.js";

// Wie `db-notes` eine Notiz anhand eines Namens findet.
//
// Warum diese Tests: alle vier Zugriffe (`read`, `append`, `update`, `delete`)
// suchten die Notiz mit derselben Bedingung —
//
//     WHERE id::text = $1 OR title = $1 OR title LIKE $1 || '%'
//     ORDER BY created_at DESC LIMIT 1
//
// Daraus folgen zwei Fehler, die beide **still** zuschlagen:
//
//   1. Der Praefix-Treffer schlaegt den exakten. Gibt es „Besprechung" und
//      „Besprechung Bauherr", gewinnt bei `update("Besprechung", …)` die
//      juengere der beiden — also womoeglich die falsche. Der Aufrufer
//      bekommt `true` zurueck und glaubt, es sei gut gegangen.
//   2. `delete` hatte gar kein `LIMIT`. Die Bedingung trifft beide Notizen,
//      geloescht werden **beide**, zurueckgegeben wird nur die erste. Wer
//      „Besprechung" loescht, verliert „Besprechung Bauherr" gleich mit.
//
// Dazu die Sonderzeichen: `%` und `_` sind in LIKE Platzhalter. Eine Notiz
// „Rohbau_Ost" fand ohne Maskierung auch „RohbauXOst".
describe.skipIf(!HAS_DB)("db-notes — welche Notiz wird getroffen", () => {
  let noteRepo: (typeof import("../src/data/index.js"))["noteRepo"];
  let db: ReturnType<(typeof import("../src/db/client.js"))["getDb"]>;
  const PRAEFIX = `sel-${namensraum()}`;

  beforeAll(async () => {
    ({ noteRepo } = await import("../src/data/index.js"));
    const { getDb } = await import("../src/db/client.js");
    db = getDb();
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await db`DELETE FROM notes WHERE title LIKE ${PRAEFIX + "%"}`;
  });

  beforeEach(async () => {
    await db`DELETE FROM notes WHERE title LIKE ${PRAEFIX + "%"}`;
  });

  /** Legt eine Notiz an und gibt ihre ID zurueck. Der erste Zeilentext wird
   *  zum Titel — so macht es `save()`. */
  async function notiz(titel: string, rest = "Inhalt"): Promise<string> {
    return noteRepo.save(`${titel}\n${rest}`);
  }

  // ── 1. Der exakte Titel gewinnt ──────────────────────────────────────────

  it("aendert die exakt benannte Notiz, nicht die juengere mit demselben Anfang", async () => {
    const kurz = `${PRAEFIX} Besprechung`;
    const lang = `${PRAEFIX} Besprechung Bauherr`;
    const idKurz = await notiz(kurz, "urspruenglich");
    // Bewusst DANACH angelegt: die alte Abfrage sortierte nach created_at DESC
    // und haette damit diese hier erwischt.
    const idLang = await notiz(lang, "unberuehrt");

    expect(await noteRepo.update(kurz, `${kurz}\ngeaendert`)).toBe(true);

    const [a] = await db`SELECT content FROM notes WHERE id = ${idKurz}`;
    const [b] = await db`SELECT content FROM notes WHERE id = ${idLang}`;
    expect(String(a.content)).toContain("geaendert");
    expect(String(b.content)).toContain("unberuehrt");
  });

  it("liest die exakt benannte Notiz", async () => {
    const kurz = `${PRAEFIX} Protokoll`;
    await notiz(kurz, "die richtige");
    await notiz(`${PRAEFIX} Protokoll Anhang`, "die falsche");

    expect(await noteRepo.read(kurz)).toContain("die richtige");
  });

  it("haengt an die exakt benannte Notiz an", async () => {
    const kurz = `${PRAEFIX} Statik`;
    const idKurz = await notiz(kurz, "Basis");
    const idLang = await notiz(`${PRAEFIX} Statik Nachweis`, "unberuehrt");

    expect(await noteRepo.append(kurz, "Nachtrag")).toBe(true);

    const [a] = await db`SELECT content FROM notes WHERE id = ${idKurz}`;
    const [b] = await db`SELECT content FROM notes WHERE id = ${idLang}`;
    expect(String(a.content)).toContain("Nachtrag");
    expect(String(b.content)).not.toContain("Nachtrag");
  });

  // ── 2. Loeschen trifft genau eine ────────────────────────────────────────

  it("loescht GENAU EINE Notiz, nicht alle mit demselben Anfang", async () => {
    const kurz = `${PRAEFIX} Abnahme`;
    await notiz(kurz);
    await notiz(`${PRAEFIX} Abnahme Rohbau`);
    await notiz(`${PRAEFIX} Abnahme Fenster`);

    expect(await noteRepo.delete(kurz)).toBe(kurz);

    // Seit Migration 049 landet Geloeschtes im Papierkorb statt weg zu sein —
    // „geloescht" heisst jetzt `deleted_at IS NOT NULL`. Die Aussage des Tests
    // bleibt dieselbe: es ist GENAU EINE Notiz betroffen.
    const rest = await db`
      SELECT title FROM notes
       WHERE title LIKE ${PRAEFIX + "%"} AND deleted_at IS NULL
       ORDER BY title`;
    expect(rest.map((r) => String(r.title))).toEqual([`${PRAEFIX} Abnahme Fenster`, `${PRAEFIX} Abnahme Rohbau`]);

    // Und die eine liegt im Papierkorb — nicht im Nichts.
    const imKorb = await db`
      SELECT title FROM notes WHERE title LIKE ${PRAEFIX + "%"} AND deleted_at IS NOT NULL`;
    expect(imKorb.map((r) => String(r.title))).toEqual([kurz]);
  });

  // ── 3. Zugriff per ID und per Praefix ────────────────────────────────────

  it("findet weiterhin per ID", async () => {
    const id = await notiz(`${PRAEFIX} PerId`, "gefunden");
    expect(await noteRepo.read(id)).toContain("gefunden");
  });

  it("findet per eindeutigem Anfang, wenn es keinen exakten Titel gibt", async () => {
    await notiz(`${PRAEFIX} Baugrube Aushub`, "gefunden");
    expect(await noteRepo.read(`${PRAEFIX} Baugrube`)).toContain("gefunden");
  });

  it("verweigert bei mehrdeutigem Anfang, statt zu raten", async () => {
    await notiz(`${PRAEFIX} Fassade Nord`, "eine");
    await notiz(`${PRAEFIX} Fassade Sued`, "andere");

    // Kein exakter Titel, zwei Kandidaten → lieber nichts als das Falsche.
    expect(await noteRepo.read(`${PRAEFIX} Fassade`)).toBeNull();
    expect(await noteRepo.update(`${PRAEFIX} Fassade`, "x")).toBe(false);
    expect(await noteRepo.delete(`${PRAEFIX} Fassade`)).toBeNull();

    const rest = await db`SELECT count(*)::int AS n FROM notes WHERE title LIKE ${PRAEFIX + "%"}`;
    expect(Number(rest[0].n)).toBe(2);
  });

  // ── 3a. Gleicher Titel zweimal: bewusst die juengere ─────────────────────

  it("nimmt bei zwei GLEICHEN Titeln die juengere — dokumentierte Entscheidung", async () => {
    // Anders als beim mehrdeutigen Anfang wird hier NICHT verweigert: die
    // Oberflaeche adressiert Notizen ueber ihren Titel, ein `null` machte also
    // beide unerreichbar statt eine zu schuetzen. Der Test haelt die
    // Entscheidung fest, damit sie nicht zufaellig kippt.
    const titel = `${PRAEFIX} Doppelt`;
    await notiz(titel, "aeltere");
    const idNeu = await notiz(titel, "juengere");

    expect(await noteRepo.read(titel)).toContain("juengere");
    expect(await noteRepo.update(titel, `${titel}\nueberschrieben`)).toBe(true);
    const [row] = await db`SELECT content FROM notes WHERE id = ${idNeu}`;
    expect(String(row.content)).toContain("ueberschrieben");
  });

  // ── 4. LIKE-Sonderzeichen sind keine Platzhalter ─────────────────────────

  it("behandelt _ und % im Namen als Zeichen, nicht als Platzhalter", async () => {
    await notiz(`${PRAEFIX} RohbauXOst`, "falsche");
    const id = await notiz(`${PRAEFIX} Rohbau_Ost`, "richtige");

    // Ohne Maskierung matcht `_` jedes beliebige Zeichen — dann waere
    // „RohbauXOst" ein zweiter Kandidat und die Suche mehrdeutig.
    expect(await noteRepo.read(`${PRAEFIX} Rohbau_Ost`)).toContain("richtige");
    const [row] = await db`SELECT title FROM notes WHERE id = ${id}`;
    expect(String(row.title)).toBe(`${PRAEFIX} Rohbau_Ost`);
  });
});
