import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { HAS_DB } from "./helpers/acl-fixture.js";

// Die Datenübernahme aus PATIO Desktop, gegen einen echten Beispiel-Vault.
//
// ── Warum das ein Test sein muss und keine Handprüfung ─────────────────────
//
// Die Vorgängerfassung des Skripts war monatelang kaputt, ohne dass es
// jemandem auffiel: sie brach beim Start mit einem Import-Fehler ab, und
// `tsc` sah `scripts/` gar nicht an. Danach stellte sich heraus, dass sie das
// Vault-Format überhaupt nicht lesen kann — sie suchte flache Sammeldateien,
// der Vault legt jeden Datensatz einzeln ab. Aus einem echten Bestand wären
// 0 Aufgaben und 0 Termine angekommen, mit der Meldung „Migration
// abgeschlossen" darüber.
//
// Ein Import läuft im Ernstfall genau einmal, unter Zeitdruck, auf fremden
// Daten. Er ist der schlechteste Ort für eine Überraschung.
//
// Der Beispiel-Vault unter `tests/fixtures/beispiel-vault/` enthält bewusst
// auch das Unangenehme: drei Notizen mit demselben Titel (an denen die alte
// Dublettenprüfung scheiterte), eine kaputte JSON-Datei, ein Dokument ohne
// Datei auf der Platte, unerlaubte Aufzählungswerte und ein Verzeichnis, das
// das Skript nicht kennt.
describe.skipIf(!HAS_DB)("Datenübernahme aus einem Vault", () => {
  const VAULT = path.join(process.cwd(), "tests/fixtures/beispiel-vault");
  const QUELLE = "vault:beispielvault0001";
  let getDb: typeof import("../src/db/client.js").getDb;

  /** Führt das Skript aus und liefert seine Ausgabe. */
  function importiere(...args: string[]): string {
    return execFileSync("npx", ["tsx", "scripts/import-vault.ts", VAULT, ...args], {
      encoding: "utf-8",
      env: { ...process.env },
      shell: process.platform === "win32",
    });
  }

  /** Alles wieder entfernen, was dieser Lauf angelegt hat — über die
   *  Zuordnungstabelle, nicht über Namen. */
  async function aufraeumen(): Promise<void> {
    const db = getDb();
    const tabelle: Record<string, string> = {
      file: "files",
      invoice: "project_invoices",
      bautagebuch: "bautagebuch",
      entscheidung: "entscheidungen",
      meeting: "meetings",
      note: "notes",
      termin: "termine",
      task: "tasks",
      phase: "project_phases",
      project: "projects",
      team: "team_members",
      company: "companies",
    };
    // Reihenfolge ist die umgekehrte Anlegereihenfolge — sonst greifen die
    // Fremdschlüssel.
    for (const [typ, tab] of Object.entries(tabelle)) {
      const ids = await db`SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = ${typ}`;
      if (ids.length === 0) continue;
      const liste = ids.map((r) => String(r.ziel_id));
      await db.unsafe(`DELETE FROM ${tab} WHERE id = ANY($1::uuid[])`, [liste as unknown as string]);
    }
    await db`DELETE FROM import_zuordnung WHERE quelle = ${QUELLE}`;
  }

  beforeAll(async () => {
    if (!HAS_DB) return;
    ({ getDb } = await import("../src/db/client.js"));
    await aufraeumen();
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await aufraeumen();
  });

  it("der Trockenlauf liest alles und schreibt nichts", () => {
    const aus = importiere("--trocken");
    expect(aus).toContain("Trockenlauf");
    expect(aus).toContain("NICHTS geschrieben");
    expect(aus).toMatch(/21 Datensätze gelesen/);
  });

  it("der Trockenlauf meldet DIESELBEN Probleme, die der echte Lauf hätte", () => {
    // ── Der Befund beim Bauen ────────────────────────────────────────────
    //
    // Zuerst standen die Wertprüfungen INNERHALB des INSERT-Ausdrucks. Im
    // Trockenlauf wird der übersprungen — also lief die Prüfung dort nicht,
    // und der Trockenlauf meldete weniger Probleme als der echte Lauf danach
    // fand. Ein Trockenlauf, dessen Bericht vom echten abweicht, ist
    // schlechter als keiner: er erzeugt Vertrauen, das nicht gedeckt ist.
    //
    // Dieser Test steht deshalb VOR dem echten Lauf: danach sind alle
    // Datensätze in der Zuordnung und werden übersprungen, ohne geprüft zu
    // werden — auch das ist richtig, nur eben nicht das, was hier zählt.
    const aus = importiere("--trocken");
    expect(aus, "kaputte JSON-Datei").toContain("kaputt.json");
    expect(aus, "unbekanntes Verzeichnis").toContain("Fotos");
    expect(aus, "unerlaubter Aufzählungswert").toMatch(/Wert "offen" ist hier nicht erlaubt/);
    expect(aus, "Phasen-Status").toMatch(/Wert "laufend" ist hier nicht erlaubt/);
    expect(aus, "Dokument ohne Datei").toContain("Datei fehlt");
  });

  it("nach dem Trockenlauf steht nichts in der Zuordnung", async () => {
    const [z] = await getDb()`SELECT count(*)::int AS n FROM import_zuordnung WHERE quelle = ${QUELLE}`;
    expect(z.n).toBe(0);
  });

  it("der echte Lauf schreibt alle zwölf Datenarten", async () => {
    const aus = importiere("--als", "admin");
    expect(aus).toContain("Übernahme abgeschlossen");

    const [z] = await getDb()`SELECT count(*)::int AS n FROM import_zuordnung WHERE quelle = ${QUELLE}`;
    expect(z.n).toBe(21);

    const arten = await getDb()`
      SELECT typ, count(*)::int AS n FROM import_zuordnung WHERE quelle = ${QUELLE} GROUP BY typ ORDER BY typ`;
    expect(Object.fromEntries(arten.map((r) => [r.typ, r.n]))).toEqual({
      bautagebuch: 1,
      company: 1,
      entscheidung: 1,
      file: 2,
      invoice: 1,
      meeting: 1,
      note: 4,
      phase: 2,
      project: 2,
      task: 3,
      team: 2,
      termin: 1,
    });
  });

  it("drei Notizen mit demselben Titel kommen alle drei an", async () => {
    // Der Befund, an dem die Vorgängerfassung scheiterte: sie prüfte auf
    // Dubletten über den TITEL, projektübergreifend. Von drei
    // „Aktenvermerk"-Notizen wäre genau eine angekommen.
    const zeilen = await getDb()`
      SELECT content FROM notes
       WHERE id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'note')
         AND title = 'Aktenvermerk'
       ORDER BY content`;
    expect(zeilen.map((r) => String(r.content))).toEqual(["Inhalt Nummer 1", "Inhalt Nummer 2", "Inhalt Nummer 3"]);
  });

  it("Verweise zwischen Datensätzen werden übersetzt", async () => {
    const [aufgabe] = await getDb()`
      SELECT t.text, tm.name AS zugewiesen, ph.name AS phase, p.name AS projekt
        FROM tasks t
        LEFT JOIN team_members tm ON tm.id = t.assignee_id
        LEFT JOIN project_phases ph ON ph.id = t.phase_id
        LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.text = 'Einreichplan zeichnen'
         AND t.id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'task')`;
    expect(aufgabe.zugewiesen).toBe("Anna Berger");
    expect(aufgabe.phase).toBe("LPH 4 Einreichplanung");
    expect(aufgabe.projekt).toBe("Wohnhaus Mueller");

    // Phase → Phase (die Reihenfolge im Vault ist nicht die der Abhängigkeit)
    const [phase] = await getDb()`
      SELECT p.name, d.name AS haengt_an FROM project_phases p
        LEFT JOIN project_phases d ON d.id = p.depends_on_phase_id
       WHERE p.name = 'LPH 5 Ausfuehrungsplanung'
         AND p.id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'phase')`;
    expect(phase.haengt_an).toBe("LPH 4 Einreichplanung");

    // Entscheidung → Besprechung, und Projekt → Elternprojekt
    const [e] = await getDb()`
      SELECT m.title AS besprechung FROM entscheidungen e
        LEFT JOIN meetings m ON m.id = e.related_meeting_id
       WHERE e.id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'entscheidung')`;
    expect(e.besprechung).toBe("Jour fixe 1");

    const [kind] = await getDb()`
      SELECT e.name AS eltern FROM projects p LEFT JOIN projects e ON e.id = p.parent_id
       WHERE p.name = 'Wohnhaus Mueller Garage'
         AND p.id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'project')`;
    expect(kind.eltern).toBe("Wohnhaus Mueller");
  });

  it("die Datei kommt mit ihrem Inhalt, die fehlende ohne", async () => {
    const zeilen = await getDb()`
      SELECT filename, octet_length(blob)::int AS bytes, encode(blob, 'escape') AS inhalt
        FROM files WHERE id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'file')
       ORDER BY filename`;
    const nach = Object.fromEntries(zeilen.map((r) => [String(r.filename), r]));
    expect(nach["Grundriss EG.txt"].bytes).toBe(16);
    expect(nach["Grundriss EG.txt"].inhalt).toBe("Grundriss-Inhalt");
    // Fehlt die Datei, wird der Datensatz trotzdem übernommen — verlieren
    // wäre schlechter als eine Zeile ohne Anhang.
    expect(nach["Verschwunden.pdf"].bytes).toBeNull();
  });

  it("die Zeitstempel kommen aus dem Datensatz, nicht von der Platte", async () => {
    // Ein Kopiervorgang über SMB setzt alle Dateizeiten auf denselben Tag.
    // Die Vorgängerfassung las `birthtime`/`mtime` und hätte damit die ganze
    // Historie auf das Datum des Kopierens gesetzt.
    const [t] = await getDb()`
      SELECT created_at FROM tasks
       WHERE text = 'Einreichplan zeichnen'
         AND id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'task')`;
    expect(new Date(String(t.created_at)).toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });

  it("das Projekt ohne Nummer bekommt einen Platzhalter, das mit Nummer behält sie", async () => {
    const zeilen = await getDb()`
      SELECT name, projektnummer FROM projects
       WHERE id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'project')
       ORDER BY name`;
    const nach = Object.fromEntries(zeilen.map((r) => [String(r.name), String(r.projektnummer)]));
    expect(nach["Wohnhaus Mueller"]).toBe("SAZTG-2026-014");
    expect(nach["Wohnhaus Mueller Garage"]).toMatch(/^OHNE-NUMMER-/);
  });

  it("--als gibt dem Konto Zugriff auf die übernommenen Projekte", async () => {
    // Ohne diesen Schritt sähe nach dem Import nur der Administrator etwas.
    const zeilen = await getDb()`
      SELECT p.name FROM user_projects up
        JOIN users u ON u.id = up.user_id
        JOIN projects p ON p.id = up.project_id
       WHERE u.username = 'admin'
         AND p.id IN (SELECT ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE} AND typ = 'project')`;
    expect(zeilen.length).toBe(2);
  });

  it("der zweite Lauf schreibt nichts mehr", () => {
    const aus = importiere("--als", "admin");
    expect(aus).toContain("21 Datensätze wurden schon einmal übernommen");
    expect(aus).toMatch(/0 von 21 Datensätzen geschrieben/);
  });
});
