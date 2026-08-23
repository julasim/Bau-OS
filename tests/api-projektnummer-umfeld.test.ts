import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Drei Befunde aus dem Umfeld der Projektnummer. Zwei davon sind Altbestand
// und haben mit der Nummer nur zu tun, dass sie beim Durchsehen auffielen.
describe.skipIf(!HAS_DB)("Projektnummer — Umfeld", () => {
  let fx: AclFixture;
  const P = namensraum();
  const projekt = `pnu-${P}`;
  const nummer = `SAZTG-${P}-014`;

  beforeAll(async () => {
    fx = await setupAclFixture("pnu");
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
    await getDb()`DELETE FROM projects WHERE name LIKE ${"pnu-" + P + "%"}`;
    await fx.cleanup();
  });

  // ── Suche über Teilstücke der Nummer ──────────────────────────────────────

  describe("Suche", () => {
    const suchen = async (q: string) => {
      const res = await fx.app.request(`/api/search?q=${encodeURIComponent(q)}`, {
        headers: authHeader(fx.admin.token),
      });
      expect(res.status).toBe(200);
      return JSON.stringify(await res.json());
    };

    it("findet das Projekt über die ganze Nummer", async () => {
      expect(await suchen(nummer)).toContain(projekt);
    });

    it("findet es auch über ein Teilstück OHNE Bürokürzel", async () => {
      // Der eigentliche Punkt. Die Volltextsuche zerlegt `SAZTG-2026-014` in
      // `saztg` · `-2026` · `-014` — ein `2026-014` trifft davon nichts.
      // Dafür ist der ILIKE-Zweig da (Migration 052, Trigramm-Index).
      expect(await suchen(`${P}-014`)).toContain(projekt);
    });

    it("findet es über einen beliebigen Ausschnitt", async () => {
      expect(await suchen(nummer.slice(4, 14))).toContain(projekt);
    });

    it("liefert bei einer fremden Nummer nichts", async () => {
      // Sonst wäre der ILIKE-Zweig zu weit gefasst und jede Suche träfe jedes
      // Projekt.
      expect(await suchen("SAZTG-1900-999")).not.toContain(projekt);
    });
  });

  // ── Portfolio zeigt keine gelöschten Projekte ─────────────────────────────

  describe("Portfolio", () => {
    it("zeigt ein Projekt aus dem Papierkorb nicht mehr", async () => {
      // Altbestand-Befund: `db-portfolio.ts` filterte `deleted_at` in KEINEM
      // der beiden Zweige. Seit Migration 044 löscht PATIO nur noch weich —
      // das Cockpit zeigte gelöschte Projekte darum weiter an, und zwar auch
      // für normale Konten (`"all"` liefert `access.ts` nicht nur Admins).
      const drin = async () => {
        const res = await fx.app.request("/api/portfolio", { headers: authHeader(fx.admin.token) });
        expect(res.status).toBe(200);
        const zeilen = (await res.json()) as { name: string }[];
        return zeilen.some((z) => z.name === projekt);
      };

      expect(await drin()).toBe(true);

      const weg = await fx.app.request(`/api/projects/${encodeURIComponent(projekt)}`, {
        method: "DELETE",
        headers: authHeader(fx.admin.token),
      });
      expect([200, 204]).toContain(weg.status);

      expect(await drin()).toBe(false);

      // Zurückholen, damit die folgenden Prüfungen das Projekt wieder haben.
      await fx.app.request(`/api/projects/${encodeURIComponent(projekt)}/wiederherstellen`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
      });
      expect(await drin()).toBe(true);
    });
  });

  // ── Die Nummer kommt in den Antworten mit ─────────────────────────────────

  describe("DTOs führen die Nummer mit", () => {
    // Der eigentliche Kern von „wird bei allem verwendet": jede Ansicht, die
    // heute nur `project` (den Namen) bekommt, muss die Nummer daneben
    // bekommen. Sonst müßte jede einzeln nachschlagen — und zwanzig Ansichten,
    // die dasselbe nachschlagen, laufen auseinander.
    beforeAll(async () => {
      const anlegen = (pfad: string, body: unknown) =>
        fx.app.request(pfad, { method: "POST", headers: jsonHeader(fx.admin.token), body: JSON.stringify(body) });
      await anlegen("/api/tasks", { text: `pnu-${P}-aufgabe`, project: projekt });
      await anlegen("/api/notes", {
        content: `pnu-${P}-notiz
Inhalt`,
        project: projekt,
      });
      await anlegen("/api/termine", { datum: "01.11.2026", text: `pnu-${P}-termin`, project: projekt });
    });

    const holen = async (pfad: string) => {
      const res = await fx.app.request(pfad, { headers: authHeader(fx.admin.token) });
      expect(res.status, pfad).toBe(200);
      return (await res.json()) as Record<string, unknown>[];
    };

    it("Aufgaben", async () => {
      const t = (await holen("/api/tasks")).find((x) => x.text === `pnu-${P}-aufgabe`);
      expect(t?.projektnummer).toBe(nummer);
    });

    it("Termine", async () => {
      const t = (await holen("/api/termine")).find((x) => x.text === `pnu-${P}-termin`);
      expect(t?.projektnummer).toBe(nummer);
    });

    it("Notizen", async () => {
      const n = (await holen("/api/notes?detailed=1")).find((x) => x.title === `pnu-${P}-notiz`);
      expect(n?.projektnummer).toBe(nummer);
    });

    it("Suchtreffer", async () => {
      // Die Suchroute antwortet mit `{ query, results }`, nicht mit einem
      // blanken Feld — anders als die übrigen Listen.
      const res = await fx.app.request(`/api/search?q=${encodeURIComponent(`pnu-${P}-aufgabe`)}`, {
        headers: authHeader(fx.admin.token),
      });
      expect(res.status).toBe(200);
      const { results } = (await res.json()) as { results: Record<string, unknown>[] };
      const t = results.find((x) => x.title === `pnu-${P}-aufgabe`);
      expect(t?.projektnummer).toBe(nummer);
    });

    it("Papierkorb", async () => {
      // Der wichtigste der fünf. Die Eindeutigkeit gilt bewusst auch für
      // gelöschte Projekte — ohne die Nummer im Papierkorb ist die Meldung
      // „bereits vergeben" eine Sackgasse ohne Ausweg.
      const liste = await holen("/api/tasks");
      const id = String(liste.find((x) => x.text === `pnu-${P}-aufgabe`)!.id);
      await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.admin.token) });

      const res = await fx.app.request("/api/papierkorb", { headers: authHeader(fx.admin.token) });
      const { eintraege } = (await res.json()) as { eintraege: Record<string, unknown>[] };
      const e = eintraege.find((x) => x.titel === `pnu-${P}-aufgabe`);
      expect(e?.projektnummer).toBe(nummer);
    });

    it("ein Datensatz ohne Projekt hat keine Nummer, aber auch keinen Fehler", async () => {
      await fx.app.request("/api/tasks", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ text: `pnu-${P}-ohne-projekt` }),
      });
      const t = (await holen("/api/tasks")).find((x) => x.text === `pnu-${P}-ohne-projekt`);
      expect(t).toBeDefined();
      expect(t?.projektnummer).toBeNull();
    });
  });

  // ── Eine belegte Nummer ist im Änderungspfad ein 409, kein 500 ────────────

  describe("Wettlauf beim Speichern", () => {
    it("der Änderungspfad meldet 409 statt Interner Fehler", async () => {
      // `projectRepo.update()` schreibt über `db.unsafe()` mit dynamisch
      // gebautem SET und hatte keinen eigenen Rückfall für 23505. Die Prüfung
      // davor fängt den Regelfall; erreicht ein Wettlauf trotzdem die
      // Datenbank, muss die zentrale Abbildung in `server.ts` greifen.
      const zweites = `pnu-${P}-zwei`;
      const res = await fx.app.request("/api/projects", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ name: zweites, projektnummer: `SAZTG-${P}-777` }),
      });
      expect(res.status).toBe(201);

      const konflikt = await fx.app.request(`/api/projects/${encodeURIComponent(zweites)}`, {
        method: "PATCH",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ projektnummer: nummer }),
      });
      expect(konflikt.status).toBe(409);
      const { error } = (await konflikt.json()) as { error: string };
      expect(error).not.toContain("Interner Fehler");
    });

    it("die zentrale Abbildung nennt den Datensatz nicht, der den Wert trägt", async () => {
      // Sonst wäre der Konflikt eine Auskunft über ein Projekt, das der
      // Fragende womöglich gar nicht sehen darf.
      const dritt = `pnu-${P}-drei`;
      await fx.app.request("/api/projects", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ name: dritt, projektnummer: `SAZTG-${P}-888` }),
      });
      const res = await fx.app.request("/api/projects", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ name: `pnu-${P}-vier`, projektnummer: `SAZTG-${P}-888` }),
      });
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).not.toContain(dritt);
    });
  });
});
