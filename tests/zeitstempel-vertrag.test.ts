import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { alsIso, alsIsoOderNull } from "../src/data/zeitstempel.js";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Der Zeitstempel-Vertrag: **jedes Datum verlässt den Server als ISO 8601.**
//
// Warum das einen eigenen Test verdient: der Bruch dieses Vertrags sieht nach
// nichts aus. `String(new Date())` liefert eine lesbare Zeichenkette — sie
// beginnt nur eben mit dem Wochentag, und damit sortiert jeder
// String-Vergleich darauf nach „Fri, Mon, Sat, Sun, Thu, Tue, Wed".
//
// Gemessen am 2026-08-23 betraf das acht von vierzehn Repos. Sichtbar war es
// in der Aufgaben- und der Notizenliste (beide sortieren „zuletzt geändert
// zuerst") sowie im Papierkorb, der die Einträge aller Arten über
// `geloeschtAm` in eine gemeinsame Reihenfolge bringt — und dabei zwei
// verschiedene Formate mischte.
describe("Zeitstempel-Vertrag", () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  // ── Der Helfer selbst ────────────────────────────────────────────────────

  it("wandelt ein Date nach ISO", () => {
    expect(alsIso(new Date("2026-08-05T17:44:33.000Z"))).toBe("2026-08-05T17:44:33.000Z");
  });

  it("reicht eine bereits fertige Zeichenkette durch", () => {
    expect(alsIso("2026-08-05T17:44:33.000Z")).toBe("2026-08-05T17:44:33.000Z");
  });

  it("alsIsoOderNull lässt leere Werte leer", () => {
    expect(alsIsoOderNull(null)).toBeNull();
    expect(alsIsoOderNull(undefined)).toBeNull();
    expect(alsIsoOderNull(new Date("2026-08-05T17:44:33.000Z"))).toBe("2026-08-05T17:44:33.000Z");
  });

  it("ISO sortiert alphabetisch richtig, Date.toString nicht", () => {
    // Der Kern des Ganzen in zwei Zeilen: dieselben zwei Zeitpunkte, einmal
    // richtig und einmal falsch verglichen.
    const frueher = new Date("2026-08-05T17:44:33.000Z");
    const spaeter = new Date("2026-08-23T08:46:14.000Z");

    expect(alsIso(spaeter).localeCompare(alsIso(frueher))).toBeGreaterThan(0);
    // 05.08.2026 ist ein Mittwoch („Wed"), 23.08.2026 ein Sonntag („Sun") —
    // alphabetisch steht der spätere Zeitpunkt damit VOR dem früheren.
    expect(String(spaeter).localeCompare(String(frueher))).toBeLessThan(0);
  });

  // ── Der Sweep über die Repos ─────────────────────────────────────────────

  it("kein Repo bildet einen Zeitstempel mehr mit blankem String() ab", () => {
    // Dieser Test braucht KEINE Datenbank — er liest die Quelltexte. Damit
    // greift er auch in einer DB-losen CI, und genau dort soll er greifen:
    // ein neues Repo mit `String(row.created_at)` fällt beim ersten Lauf auf
    // und nicht erst, wenn jemand eine Liste falsch sortiert sieht.
    const ordner = join(process.cwd(), "src", "data");
    const treffer: string[] = [];
    for (const datei of readdirSync(ordner).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(ordner, datei), "utf-8");
      for (const [i, zeile] of text.split("\n").entries()) {
        if (/String\(\s*\w+\.\w*_at\s*\)/.test(zeile)) treffer.push(`${datei}:${i + 1}`);
      }
    }
    expect(treffer).toEqual([]);
  });

  // ── Über die echte API ───────────────────────────────────────────────────

  describe.skipIf(!HAS_DB)("über die API", () => {
    let fx: AclFixture;
    const P = `zeit-${namensraum()}`;

    beforeAll(async () => {
      fx = await setupAclFixture("zeit");
    });

    afterAll(async () => {
      if (!HAS_DB) return;
      const { getDb } = await import("../src/db/client.js");
      await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
      await getDb()`DELETE FROM notes WHERE title LIKE ${P + "%"}`;
      await fx.cleanup();
    });

    it("Aufgaben liefern createdAt und updatedAt als ISO", async () => {
      const res = await fx.app.request("/api/tasks", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ text: `${P}-aufgabe`, project: fx.projectName }),
      });
      expect(res.status).toBe(201);
      const t = (await res.json()) as { createdAt: string; updatedAt: string };
      expect(t.createdAt).toMatch(ISO);
      expect(t.updatedAt).toMatch(ISO);
    });

    it("Notizen ebenso", async () => {
      const res = await fx.app.request("/api/notes", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ content: `${P}-notiz\nInhalt`, project: fx.projectName }),
      });
      expect(res.status).toBe(201);
      // Geprüft wird die GANZE Liste, nicht die eine eben angelegte Notiz.
      // Zwei Gründe: `GET /notes/:name` liefert bewusst nur Titel, Inhalt und
      // den Konflikt-Zähler (keine Zeitstempel), und `?detailed=1` ist auf 50
      // Einträge begrenzt — ein Test, der darin genau seine eigene Notiz
      // suchen müsste, hinge an fremden, parallel laufenden Testdateien.
      //
      // Über alle Einträge zu prüfen ist ohnehin die schärfere Aussage: es
      // genügt EIN Repo-Pfad mit blankem `String()`, und der Test ist rot.
      const liste = (await (
        await fx.app.request("/api/notes?detailed=1", { headers: authHeader(fx.admin.token) })
      ).json()) as { title: string; createdAt: string; updatedAt: string }[];

      expect(liste.length).toBeGreaterThan(0);
      for (const n of liste) {
        expect(n.createdAt).toMatch(ISO);
        expect(n.updatedAt).toMatch(ISO);
      }
    });

    it("der Papierkorb sortiert über EIN Format, nicht über zwei", async () => {
      // Die Route mischt Notizen, Aufgaben und Termine in eine Liste und
      // sortiert sie über `geloeschtAm`. Solange ein Teil der Repos ISO
      // lieferte und ein Teil nicht, war diese Reihenfolge Zufall.
      const a = await fx.app.request("/api/tasks", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ text: `${P}-weg`, project: fx.projectName }),
      });
      const { id } = (await a.json()) as { id: string };
      await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.admin.token) });

      const k = (await (await fx.app.request("/api/papierkorb", { headers: authHeader(fx.admin.token) })).json()) as {
        eintraege: { geloeschtAm: string }[];
      };

      expect(k.eintraege.length).toBeGreaterThan(0);
      for (const e of k.eintraege) expect(e.geloeschtAm).toMatch(ISO);
    });
  });
});
