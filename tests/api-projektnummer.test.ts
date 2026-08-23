import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Die Projektnummer als Kennung (Migration 052).
//
// Geprüft wird hier, was die Datenbank und die Routen zusammen leisten müssen,
// damit die Nummer die UUID nach außen ablösen kann:
//
//   * jedes neue Projekt hat eine — ohne Nummer kein Projekt,
//   * keine zweite trägt dieselbe, auch nicht in anderer Schreibweise,
//   * eine Anfrage darf ein Projekt über seine Nummer adressieren,
//   * und dieser zweite Weg führt zu denselben Rechten wie der erste.
//
// Der letzte Punkt ist der wichtigste. Eine neue Art, ein Projekt zu
// adressieren, ist immer auch eine neue Art, an der Rechteprüfung
// vorbeizukommen — wenn man sie falsch baut.
describe.skipIf(!HAS_DB)("Projektnummer als Kennung", () => {
  let fx: AclFixture;
  const P = namensraum();
  const nr = (suffix: string) => `SAZTG-${P}-${suffix}`;

  beforeAll(async () => {
    fx = await setupAclFixture("pnr");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM projects WHERE name LIKE ${"pnr-test-" + P + "%"}`;
    await fx.cleanup();
  });

  /** Legt ein Projekt an und liefert die Antwort. */
  const anlegen = (name: string, body: Record<string, unknown>, token = fx.admin.token) =>
    fx.app.request("/api/projects", {
      method: "POST",
      headers: jsonHeader(token),
      body: JSON.stringify({ name, ...body }),
    });

  // ── Pflicht ───────────────────────────────────────────────────────────────

  it("ein neues Projekt ohne Nummer wird abgelehnt", async () => {
    const res = await anlegen(`pnr-test-${P}-ohne`, {});
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    // Die Meldung muss zeigen, wie es richtig aussieht — sonst rät der Nutzer.
    expect(error).toContain("SAZTG-2026-000");
  });

  it("mit Nummer wird es angelegt und die Nummer kommt zurück", async () => {
    const res = await anlegen(`pnr-test-${P}-a`, { projektnummer: nr("001") });
    expect(res.status).toBe(201);
    const p = (await res.json()) as { projektnummer: string };
    expect(p.projektnummer).toBe(nr("001"));
  });

  it("Leerraum am Rand wird abgeschnitten, nicht gespeichert", async () => {
    const res = await anlegen(`pnr-test-${P}-trim`, { projektnummer: `  ${nr("002")}  ` });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { projektnummer: string }).projektnummer).toBe(nr("002"));
  });

  // ── Eindeutigkeit ─────────────────────────────────────────────────────────

  it("dieselbe Nummer ein zweites Mal ist ein 409", async () => {
    const res = await anlegen(`pnr-test-${P}-b`, { projektnummer: nr("001") });
    expect(res.status).toBe(409);
  });

  it("auch in anderer Schreibweise", async () => {
    // Für die Datenbank wären das zwei Zeichenketten, für jeden Menschen
    // dieselbe Akte. Der eindeutige Index liegt darum auf `lower(...)`.
    const res = await anlegen(`pnr-test-${P}-c`, { projektnummer: nr("001").toLowerCase() });
    expect(res.status).toBe(409);
  });

  it("die Meldung verrät nicht, welches Projekt die Nummer trägt", async () => {
    // Sonst wäre der Konflikt eine Auskunft über ein Projekt, das der
    // Fragende womöglich gar nicht sehen darf.
    const res = await anlegen(`pnr-test-${P}-d`, { projektnummer: nr("001") });
    const { error } = (await res.json()) as { error: string };
    expect(error).not.toContain(`pnr-test-${P}-a`);
  });

  // ── Ändern ────────────────────────────────────────────────────────────────

  it("die Nummer lässt sich korrigieren", async () => {
    // Sie ist von Hand vergeben, also wird sie irgendwann korrigiert. Genau
    // dafür ist sie NICHT der Primärschlüssel.
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(`pnr-test-${P}-a`)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projektnummer: nr("010") }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { projektnummer: string }).projektnummer).toBe(nr("010"));
  });

  it('das Speichern OHNE Nummernänderung meldet nicht „schon vergeben"', async () => {
    // Der Selbstvergleich: ohne den Ausschluss der eigenen ID stieße jedes
    // Speichern auf die eigene Nummer.
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(`pnr-test-${P}-a`)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projektnummer: nr("010"), standort: "Wien 9" }),
    });
    expect(res.status).toBe(200);
  });

  it("die Nummer lässt sich nicht leeren", async () => {
    // Die Spalte ist seit 052 NOT NULL. Ohne die Prüfung in der Anwendung
    // wäre das ein Datenbankfehler statt eines sauberen „geht nicht".
    for (const wert of [null, "", "   "]) {
      const res = await fx.app.request(`/api/projects/${encodeURIComponent(`pnr-test-${P}-a`)}`, {
        method: "PATCH",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ projektnummer: wert }),
      });
      expect(res.status, JSON.stringify(wert)).toBe(400);
    }
  });

  it("eine fremde Nummer beim Ändern ist ein 409", async () => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(`pnr-test-${P}-a`)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ projektnummer: nr("002") }),
    });
    expect(res.status).toBe(409);
  });

  // ── Als Bezugsart ─────────────────────────────────────────────────────────

  it("Aufgaben lassen sich über ?projektnummer= abfragen", async () => {
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `pnr-test-${P}-aufgabe`, project: `pnr-test-${P}-a` }),
    });
    const res = await fx.app.request(`/api/tasks?projektnummer=${encodeURIComponent(nr("010"))}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    const liste = (await res.json()) as { text: string }[];
    expect(liste.some((t) => t.text === `pnr-test-${P}-aufgabe`)).toBe(true);
  });

  it("auch in anderer Schreibweise — es ist dieselbe Akte", async () => {
    const res = await fx.app.request(`/api/tasks?projektnummer=${encodeURIComponent(nr("010").toLowerCase())}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }[]).some((t) => t.text === `pnr-test-${P}-aufgabe`)).toBe(true);
  });

  it("eine unbekannte Nummer ist ein 404 — NICHT die Liste aller Projekte", async () => {
    // Der wichtigste Test dieser Datei. Liefe eine ins Leere zeigende Nummer
    // auf „kein Projektbezug angegeben" hinaus, bekäme der Aufrufer MEHR zu
    // sehen statt weniger. Bei Rechten ist das die falsche Richtung.
    const res = await fx.app.request(`/api/tasks?projektnummer=SAZTG-9999-999`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(404);
  });

  it("die Nummer öffnet keine Tür an den Rechten vorbei", async () => {
    // B darf das Projekt von A nicht sehen. Über den Namen bekommt B ein 403;
    // über die Nummer darf nichts anderes herauskommen.
    const geheim = `pnr-test-${P}-geheim`;
    expect((await anlegen(geheim, { projektnummer: nr("099") })).status).toBe(201);

    const ueberName = await fx.app.request(`/api/tasks?project=${encodeURIComponent(geheim)}`, {
      headers: authHeader(fx.b.token),
    });
    const ueberNummer = await fx.app.request(`/api/tasks?projektnummer=${encodeURIComponent(nr("099"))}`, {
      headers: authHeader(fx.b.token),
    });
    // Die Antwort muss dieselbe sein — nicht bloß „auch irgendwie abgelehnt".
    expect(ueberNummer.status).toBe(ueberName.status);
    if (ueberNummer.status === 200) {
      expect(await ueberNummer.json()).toEqual(await ueberName.json());
    }
  });

  it("projectId hat Vorrang vor projektnummer", async () => {
    // Wer beides schickt, meint die stärkere Angabe. Ohne feste Reihenfolge
    // hinge das Ergebnis an der Reihenfolge im JSON.
    const info = (await (
      await fx.app.request(`/api/projects/${encodeURIComponent(`pnr-test-${P}-a`)}`, {
        headers: authHeader(fx.admin.token),
      })
    ).json()) as { id: string };

    const res = await fx.app.request(`/api/tasks?projectId=${info.id}&projektnummer=${encodeURIComponent(nr("002"))}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    const liste = (await res.json()) as { text: string }[];
    // Die Aufgabe hängt an Projekt -a (über projectId), nicht an -trim.
    expect(liste.some((t) => t.text === `pnr-test-${P}-aufgabe`)).toBe(true);
  });

  // ── Suche ─────────────────────────────────────────────────────────────────

  it("ein Projekt ist über seine Nummer auffindbar", async () => {
    const res = await fx.app.request(`/api/search?q=${encodeURIComponent(nr("010"))}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(res.status).toBe(200);
    const treffer = JSON.stringify(await res.json());
    expect(treffer).toContain(`pnr-test-${P}-a`);
  });
});
