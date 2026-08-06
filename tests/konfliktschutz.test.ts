import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Konfliktschutz beim gleichzeitigen Bearbeiten (Migration 042).
//
// Warum: auf dem Firmenserver arbeiten mehrere Leute am selben Bestand. Ohne
// Schutz galt „wer zuletzt speichert, gewinnt" — und der andere merkte
// nichts. Seine Aenderung war weg, ohne Meldung, ohne Spur. Genau das ist der
// Unterschied zwischen einem Einzelplatzprogramm und einem Server.
//
// Das Verfahren: jeder Datensatz traegt einen Zaehler `rev`. Wer bearbeitet,
// bekommt ihn mit und schickt ihn zurueck; geschrieben wird nur, solange er
// stimmt. Sonst 409 samt aktuellem Stand.
describe.skipIf(!HAS_DB)("Konfliktschutz — zwei Arbeitsplaetze am selben Datensatz", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("konf");
  });
  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  /** Legt eine Aufgabe an und liefert sie samt Zaehler zurueck. */
  async function neueAufgabe(): Promise<{ id: string; rev: number }> {
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "Angebot einholen", project: fx.projectName }),
    });
    expect(res.status).toBe(201);
    const t = (await res.json()) as { id: string; rev: number };
    return { id: t.id, rev: t.rev };
  }

  async function hole(id: string): Promise<{ text: string; rev: number }> {
    const res = await fx.app.request(`/api/tasks/${id}`, { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
    return (await res.json()) as { text: string; rev: number };
  }

  // ── Der Zaehler ist ueberhaupt da ────────────────────────────────────────

  it("jeder Datensatz traegt einen Zaehler, der bei 1 beginnt", async () => {
    const { rev } = await neueAufgabe();
    expect(rev).toBe(1);
  });

  it("der Zaehler steigt bei jedem Speichern", async () => {
    const a = await neueAufgabe();
    await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "erste Aenderung", rev: a.rev }),
    });
    const nach1 = await hole(a.id);
    expect(nach1.rev).toBe(2);

    await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "zweite Aenderung", rev: nach1.rev }),
    });
    expect((await hole(a.id)).rev).toBe(3);
  });

  // ── Der eigentliche Fall ─────────────────────────────────────────────────

  it("zwei Schreibversuche mit demselben Zaehler: der zweite wird abgelehnt", async () => {
    const a = await neueAufgabe();

    // Beide Arbeitsplaetze haben den Datensatz mit rev=1 geladen.
    const ersterVersuch = await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "Anna schreibt", rev: a.rev }),
    });
    const zweiterVersuch = await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "Bernd schreibt", rev: a.rev }),
    });

    expect(ersterVersuch.status).toBe(200);
    expect(zweiterVersuch.status).toBe(409);

    // Und das Entscheidende: Annas Aenderung steht noch da.
    expect((await hole(a.id)).text).toBe("Anna schreibt");
  });

  it("die Ablehnung sagt, was los ist, und liefert den aktuellen Stand mit", async () => {
    const a = await neueAufgabe();
    await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "zuerst", rev: a.rev }),
    });
    const res = await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "zu spaet", rev: a.rev }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      konflikt: boolean;
      aktuell: { text: string; rev: number };
      erwarteteRev: number;
      aktuelleRev: number;
    };
    expect(body.konflikt).toBe(true);
    expect(body.error).toContain("zwischenzeitlich");
    // Der aktuelle Stand kommt mit, damit die Oberflaeche zeigen kann, was
    // sich geaendert hat — statt den Benutzer ins Leere laufen zu lassen.
    expect(body.aktuell.text).toBe("zuerst");
    expect(body.erwarteteRev).toBe(1);
    expect(body.aktuelleRev).toBe(2);
  });

  it("mit dem frischen Zaehler klappt derselbe Schreibversuch", async () => {
    const a = await neueAufgabe();
    await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "zuerst", rev: a.rev }),
    });
    const frisch = await hole(a.id);

    const res = await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "jetzt aber", rev: frisch.rev }),
    });
    expect(res.status).toBe(200);
    expect((await hole(a.id)).text).toBe("jetzt aber");
  });

  // ── Rueckwaertsvertraeglich ──────────────────────────────────────────────

  it("ohne mitgeschickten Zaehler bleibt es beim bisherigen Verhalten", async () => {
    // Aeltere Aufrufer und interne Jobs schicken keinen Zaehler. Die sollen
    // weiter funktionieren — sonst waere die Umstellung ein Bruch.
    const a = await neueAufgabe();
    const res = await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "ohne Zaehler" }),
    });
    expect(res.status).toBe(200);
    expect((await hole(a.id)).text).toBe("ohne Zaehler");
  });

  // ── Der Schutz gilt nicht nur fuer Aufgaben ──────────────────────────────
  //
  // Sieben Repos wurden umgebaut. Ein Test nur an `tasks` bewiese, dass das
  // Verfahren funktioniert — nicht, dass es ueberall angeschlossen ist. Die
  // beiden hier decken die zwei abweichenden Bauformen ab: `termine` steht
  // fuer die sechs gleichfoermigen, `notes` hat eine eigene Signatur.

  it("Termine: der zweite Schreibversuch wird abgelehnt", async () => {
    const angelegt = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ datum: "15.09.2026", text: "Bauverhandlung", project: fx.projectName }),
    });
    expect(angelegt.status).toBe(201);
    const t = (await angelegt.json()) as { id: string; rev: number };
    expect(t.rev).toBe(1);

    const erster = await fx.app.request(`/api/termine/${t.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ location: "Magistrat", rev: t.rev }),
    });
    const zweiter = await fx.app.request(`/api/termine/${t.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ location: "Baustelle", rev: t.rev }),
    });

    expect(erster.status).toBe(200);
    expect(zweiter.status).toBe(409);

    const nachher = await fx.app.request(`/api/termine/${t.id}`, { headers: authHeader(fx.admin.token) });
    expect(((await nachher.json()) as { location: string }).location).toBe("Magistrat");
  });

  it("Notizen: der zweite Schreibversuch wird abgelehnt", async () => {
    const titel = `konf-notiz-${Date.now()}`;
    const angelegt = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ content: `${titel}\nerste Fassung`, project: fx.projectName }),
    });
    expect(angelegt.status).toBe(201);

    // Der Zaehler kommt beim Lesen mit — sonst koennte ihn niemand
    // zurueckschicken.
    const geladen = await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      headers: authHeader(fx.admin.token),
    });
    const n = (await geladen.json()) as { content: string; rev: number };
    expect(n.rev).toBe(1);

    const erster = await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ content: `${titel}\nAnna`, rev: n.rev }),
    });
    const zweiter = await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ content: `${titel}\nBernd`, rev: n.rev }),
    });

    expect(erster.status).toBe(200);
    expect(zweiter.status).toBe(409);

    const nachher = await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(((await nachher.json()) as { content: string }).content).toContain("Anna");

    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM notes WHERE title = ${titel}`;
  });

  // ── Die Falle, die still zuschlaegt ──────────────────────────────────────
  //
  // Liefert eine Leseabfrage `rev` gar nicht mit, faellt der Mapper auf 1
  // zurueck. Beim ERSTEN Speichern faellt das nicht auf — beim zweiten schlaegt
  // dann jedes Mal 409 zu, obwohl niemand dazwischengefunkt hat. Genau das war
  // in `db-team` der Fall: die Spaltenliste dort ist ausgeschrieben und hatte
  // `rev` nicht dabei.
  //
  // Deshalb prueft dieser Test nicht die Ablehnung, sondern das Gegenteil:
  // zweimal hintereinander speichern muss zweimal gelingen.
  it("Team: zweimal hintereinander speichern gelingt beide Male", async () => {
    const angelegt = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `konf-mitglied-${Date.now()}`, role: "Planung" }),
    });
    expect(angelegt.status).toBe(201);
    const m = (await angelegt.json()) as { id: string; rev: number };
    expect(m.rev).toBe(1);

    const erster = await fx.app.request(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ phone: "0664 111", rev: m.rev }),
    });
    expect(erster.status).toBe(200);
    const nach1 = (await erster.json()) as { rev: number };
    expect(nach1.rev).toBe(2); // faellt der Mapper auf 1 zurueck, steht hier 1

    const zweiter = await fx.app.request(`/api/team/${m.id}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ phone: "0664 222", rev: nach1.rev }),
    });
    expect(zweiter.status).toBe(200); // mit fehlendem rev in der Abfrage: 409

    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM team_members WHERE id = ${m.id}`;
  });

  // `db-projects` ist die dritte Bauform: das UPDATE wird dynamisch
  // zusammengesetzt und adressiert ueber den NAMEN, nicht ueber die ID.
  it("Projekte: der zweite Schreibversuch wird abgelehnt", async () => {
    const geladen = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.admin.token),
    });
    expect(geladen.status).toBe(200);
    const p = (await geladen.json()) as { rev: number };
    expect(typeof p.rev).toBe("number");

    const erster = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ standort: "Wien", rev: p.rev }),
    });
    const zweiter = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ standort: "Graz", rev: p.rev }),
    });

    expect(erster.status).toBe(200);
    expect(zweiter.status).toBe(409);
    expect(((await erster.json()) as { standort: string }).standort).toBe("Wien");

    // Und mit dem frischen Zaehler geht es weiter — beweist, dass die
    // Leseabfrage den echten Stand liefert und nicht auf 1 zurueckfaellt.
    const frisch = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.admin.token),
    });
    const dritter = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ standort: "Linz", rev: ((await frisch.json()) as { rev: number }).rev }),
    });
    expect(dritter.status).toBe(200);
  });

  it("ein geloeschter Datensatz gibt 404, nicht 409", async () => {
    const a = await neueAufgabe();
    await fx.app.request(`/api/tasks/${a.id}`, { method: "DELETE", headers: authHeader(fx.admin.token) });
    const res = await fx.app.request(`/api/tasks/${a.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: "ins Leere", rev: a.rev }),
    });
    expect(res.status).toBe(404);
  });
});
