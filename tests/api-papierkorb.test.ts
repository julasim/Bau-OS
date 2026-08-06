import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der Papierkorb (Migration 044).
//
// Löschen war bis hierher endgültig, und zwar mit zwei verschiedenen, gleich
// unangenehmen Folgen — an den Fremdschlüsseln der laufenden Datenbank
// nachgemessen:
//
//   ZERSTÖRT (ON DELETE CASCADE):
//     bautagebuch · meetings · time_entries · project_phases ·
//     project_invoices
//   VERWAIST (ON DELETE SET NULL):
//     notes · tasks · termine · files
//
// Ein versehentlich gelöschtes Projekt riss also Bautagebuch, Protokolle,
// erfasste Stunden, Phasen und Rechnungen mit und ließ Notizen, Aufgaben,
// Termine und Dateien ohne Bezug zurück. Der einzige Rückweg war die
// nächtliche Sicherung — bis zu einem Tag Arbeit.
//
// **Deshalb prüft dieser Test je Beziehung einzeln.** Ein Test, der nur
// „Projekt ist wieder da" sagt, hätte genau den Fehler durchgelassen, an dem
// PATIO Desktop schon einmal Daten verloren hat: die Hülle kam zurück, der
// Inhalt nicht.
describe.skipIf(!HAS_DB)("Papierkorb — ein gelöschtes Projekt kommt vollständig zurück", () => {
  let fx: AclFixture;
  let mitgliedId = "";

  /** Legt in A's Projekt je einen Datensatz jeder Art an. */
  async function projektFuellen(): Promise<void> {
    const p = encodeURIComponent(fx.projectName);
    const admin = jsonHeader(fx.admin.token);

    const notiz = await fx.app.request("/api/notes", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ content: `papierkorb-notiz\nInhalt`, project: fx.projectName }),
    });
    expect(notiz.status).toBe(201);

    const aufgabe = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ text: "Einreichplan zeichnen", project: fx.projectName }),
    });
    expect(aufgabe.status).toBe(201);

    const termin = await fx.app.request("/api/termine", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ datum: "15.09.2026", text: "Bauverhandlung", project: fx.projectName }),
    });
    expect(termin.status).toBe(201);

    const phase = await fx.app.request(`/api/projects/${p}/phases`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ name: "LPH 4", honorarProzent: 30 }),
    });
    expect([200, 201]).toContain(phase.status);

    const rechnung = await fx.app.request(`/api/projects/${p}/invoices`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ nummer: "2026-777", betrag: 9900, datum: "2026-09-01" }),
    });
    expect([200, 201]).toContain(rechnung.status);

    const besprechung = await fx.app.request(`/api/projects/${p}/meetings`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ title: "Baubesprechung 12", date: "2026-09-02" }),
    });
    expect(besprechung.status).toBe(201);

    const tagebuch = await fx.app.request(`/api/projects/${p}/bautagebuch/2026-09-02`, {
      method: "PUT",
      headers: admin,
      body: JSON.stringify({ wetter: "bedeckt", notes: "Schalung Decke" }),
    });
    expect([200, 201]).toContain(tagebuch.status);

    const stunden = await fx.app.request(`/api/projects/${p}/time-entries`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ memberId: mitgliedId, date: "2026-09-02", hours: 6, description: "Detailplanung" }),
    });
    expect(stunden.status).toBe(201);
  }

  /** Zählt je Beziehung, was noch am Projekt hängt — direkt in der Datenbank,
   *  nicht über die API. Die API filtert gelöschte Projekte aus, sie könnte
   *  also nicht zwischen „Datensatz weg" und „Projekt unsichtbar"
   *  unterscheiden — und genau darum geht es hier. */
  async function bestand(): Promise<Record<string, number>> {
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    const id = fx.projectId;
    const zaehle = async (tabelle: string): Promise<number> => {
      const [row] = await db.unsafe(`SELECT count(*)::int AS n FROM ${tabelle} WHERE project_id = $1`, [id]);
      return Number((row as { n: number }).n);
    };
    return {
      notizen: await zaehle("notes"),
      aufgaben: await zaehle("tasks"),
      termine: await zaehle("termine"),
      phasen: await zaehle("project_phases"),
      rechnungen: await zaehle("project_invoices"),
      besprechungen: await zaehle("meetings"),
      bautagebuch: await zaehle("bautagebuch"),
      stunden: await zaehle("time_entries"),
    };
  }

  beforeAll(async () => {
    fx = await setupAclFixture("papierkorb", { geldRecht: true });

    const mitglied = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `papierkorb-person-${Date.now()}`, role: "Planung" }),
    });
    expect(mitglied.status).toBe(201);
    mitgliedId = ((await mitglied.json()) as { id: string }).id;

    await projektFuellen();
  });

  afterAll(async () => {
    if (HAS_DB) {
      const { getDb } = await import("../src/db/client.js");
      await getDb()`DELETE FROM team_members WHERE id = ${mitgliedId}`;
      await fx.cleanup();
    }
  });

  it("das gefüllte Projekt hat von jeder Art mindestens einen Datensatz", async () => {
    // Ohne diese Prüfung bewiese der Rest nichts: acht Nullen vor und nach dem
    // Löschen wären ebenfalls „nichts verloren".
    const vorher = await bestand();
    for (const [art, anzahl] of Object.entries(vorher)) {
      expect(anzahl, `${art} sollte vorbereitet sein`).toBeGreaterThan(0);
    }
  });

  it("Löschen entfernt das Projekt aus allen Listen — aber keinen einzigen Datensatz", async () => {
    const vorher = await bestand();

    const geloescht = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    expect(geloescht.status).toBe(204);

    // Aus der Liste verschwunden …
    const liste = await fx.app.request("/api/projects", { headers: authHeader(fx.admin.token) });
    const namen = ((await liste.json()) as { name: string }[]).map((p) => p.name);
    expect(namen).not.toContain(fx.projectName);

    // … und einzeln nicht mehr auffindbar.
    const einzeln = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(einzeln.status).toBe(404);

    // Aber der Bestand ist unverändert — Beziehung für Beziehung.
    expect(await bestand()).toEqual(vorher);
  });

  it("es liegt im Papierkorb und lässt sich vollständig zurückholen", async () => {
    const korb = await fx.app.request("/api/projects/_papierkorb", { headers: authHeader(fx.admin.token) });
    expect(korb.status).toBe(200);
    const eintraege = (await korb.json()) as { name: string; deletedAt: string }[];
    expect(eintraege.map((e) => e.name)).toContain(fx.projectName);

    const zurueck = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
    });
    expect(zurueck.status).toBe(200);

    const liste = await fx.app.request("/api/projects", { headers: authHeader(fx.admin.token) });
    const namen = ((await liste.json()) as { name: string }[]).map((p) => p.name);
    expect(namen).toContain(fx.projectName);

    // Und alles hängt wieder dran, je Beziehung geprüft.
    const nachher = await bestand();
    for (const [art, anzahl] of Object.entries(nachher)) {
      expect(anzahl, `${art} nach dem Zurückholen`).toBeGreaterThan(0);
    }
  });

  it("ein Projekt im Papierkorb ist für niemanden mehr sichtbar", async () => {
    await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    try {
      // Auch für A, der es angelegt hat und sonst Zugriff hätte.
      const alsErsteller = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
        headers: authHeader(fx.a.token),
      });
      expect(alsErsteller.status).toBe(404);

      // Und seine Datensätze tauchen nirgends mehr auf. Die Notiz-Liste
      // antwortet mit 200 und einer gefilterten Menge — sie kennt keinen
      // `?project=`-Parameter, sondern filtert über die sichtbaren Projekte,
      // und aus denen ist das gelöschte gefallen. Geprüft wird deshalb der
      // Inhalt, nicht der Statuscode.
      const notizen = await fx.app.request("/api/notes?detailed=1", { headers: authHeader(fx.a.token) });
      expect(notizen.status).toBe(200);
      const titel = (await notizen.json()) as { title: string; project: string | null }[];
      expect(titel.some((n) => n.project === fx.projectName)).toBe(false);
    } finally {
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
      });
    }
  });

  it("den Papierkorb sieht und leert nur die Verwaltung", async () => {
    expect((await fx.app.request("/api/projects/_papierkorb", { headers: authHeader(fx.a.token) })).status).toBe(403);

    const zurueck = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
    });
    expect(zurueck.status).toBe(403);
  });

  it("endgültig löschen geht nur aus dem Papierkorb heraus", async () => {
    // Die zweite bewusste Entscheidung: ein Projekt, das noch in Verwendung
    // ist, lässt sich nicht in einem Schritt unwiderruflich entfernen.
    const direkt = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/endgueltig`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    expect(direkt.status).toBe(404);
  });

  it("erst das endgültige Löschen räumt wirklich ab — und dann alles", async () => {
    // Das ist die Gegenprobe zu allem darüber: hier feuern die Kaskaden, und
    // sie sollen es. Wäre das Löschen oben schon hart gewesen, sähe der
    // Bestand genauso aus — deshalb ist erst dieser Test der Beweis, dass die
    // Kaskaden überhaupt noch scharf sind.
    const p = encodeURIComponent(fx.projectName);
    await fx.app.request(`/api/projects/${p}`, { method: "DELETE", headers: authHeader(fx.admin.token) });

    const endgueltig = await fx.app.request(`/api/projects/${p}/endgueltig`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    expect(endgueltig.status).toBe(204);

    const nachher = await bestand();
    expect(nachher.phasen).toBe(0);
    expect(nachher.rechnungen).toBe(0);
    expect(nachher.besprechungen).toBe(0);
    expect(nachher.bautagebuch).toBe(0);
    expect(nachher.stunden).toBe(0);
    // Notizen, Aufgaben, Termine und Dateien hängen per SET NULL — sie
    // überleben ohne Projektbezug. Das ist Bestand aus Migration 001 und
    // hier nur festgehalten, nicht bewertet.
    expect(nachher.notizen).toBe(0);
  });
});
