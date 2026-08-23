import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Notizen: Rechte und persönliche Notizen.
//
// ── Der Befund, der diese Datei ausgelöst hat ────────────────────────────────
//
// Die Rechteprüfung und das Lesen lösten den Notiznamen GETRENNT auf, mit
// unterschiedlicher Sortierung:
//
//   * die Prüfung (`resolveNoteProject`) über `listDetailed(500)`, sortiert
//     nach `updated_at`;
//   * das Lesen (`findeNotiz`) über eine gestufte Abfrage, sortiert nach
//     `created_at`.
//
// Bei zwei Notizen mit demselben Titel entschieden die beiden über
// VERSCHIEDENE Datensätze. Genügte es, die zuletzt bearbeitete freizugeben,
// kam die zuletzt angelegte heraus — auch aus einem fremden Projekt.
// Nachgewiesen und hier festgehalten.
//
// Die Lösung ist nicht ein besserer zweiter Auflöser, sondern **nur noch
// einer**: die Route löst einmal auf und arbeitet danach mit der ID. Damit
// betreffen Entscheidung und Zugriff nachweislich dieselbe Zeile.
describe.skipIf(!HAS_DB)("Notizen — Rechte und persönliche Notizen", () => {
  let fx: AclFixture;
  const S = namensraum();

  const notiz = (token: string, content: string, project?: string) =>
    fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(token),
      body: JSON.stringify({ content, ...(project ? { project } : {}) }),
    });

  const lies = (token: string, titel: string) =>
    fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, { headers: authHeader(token) });

  beforeAll(async () => {
    fx = await setupAclFixture("notacl");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM notes WHERE title LIKE ${"%" + S + "%"}`;
    await fx.cleanup();
  });

  // ── Der eigentliche Befund ────────────────────────────────────────────────

  it("gleicher Titel in zwei Projekten: es kommt keine fremde Notiz heraus", async () => {
    const titel = `Bauverhandlung${S}`;
    const erlaubt = await notiz(fx.a.token, `${titel}\nharmlos`, fx.projectName);
    expect(erlaubt.status).toBe(201);
    const gesperrt = await notiz(fx.b.token, `${titel}\nGEHEIM aus fremdem Projekt`, fx.projectBName);
    expect(gesperrt.status).toBe(201);

    // Die erlaubte Notiz wird zuletzt BEARBEITET — höchstes `updated_at`,
    // aber älteres `created_at`. Genau die Konstellation, in der die beiden
    // Auflöser auseinanderliefen.
    const { getDb } = await import("../src/db/client.js");
    await getDb()`
      UPDATE notes SET updated_at = now() + interval '1 minute'
       WHERE title = ${titel} AND content LIKE '%harmlos%'`;

    const res = await lies(fx.a.token, titel);
    if (res.status === 200) {
      const body = (await res.json()) as { content: string };
      expect(body.content).not.toContain("GEHEIM");
    } else {
      // Auch eine Ablehnung ist richtig — mehrdeutig ist mehrdeutig.
      expect([403, 404]).toContain(res.status);
    }
  });

  // ── Persönliche Notizen (Notizen ohne Projekt) ───────────────────────────
  //
  // Bis hierher galt: wer eine Notiz OHNE Projekt anlegt, sieht sie nie
  // wieder. Das Anlegen war erlaubt, das Lesen nicht — nur der Verwalter kam
  // noch heran. Aufgaben und Termine kennen diesen Fall längst als
  // „persönlich"; bei Notizen fehlte dafür schlicht die Angabe, wer sie
  // angelegt hat.

  it("wer eine Notiz ohne Projekt anlegt, findet sie in seiner Liste wieder", async () => {
    const titel = `Privatnotiz${S}`;
    expect((await notiz(fx.a.token, `${titel}\nnur für mich`)).status).toBe(201);

    const liste = await fx.app.request("/api/notes?detailed=1", { headers: authHeader(fx.a.token) });
    expect(liste.status).toBe(200);
    const titel_liste = ((await liste.json()) as { title: string }[]).map((n) => n.title);
    expect(titel_liste).toContain(titel);
  });

  it("… und kann sie lesen, ändern und löschen", async () => {
    const titel = `Merkzettel${S}`;
    expect((await notiz(fx.a.token, `${titel}\nerste Fassung`)).status).toBe(201);

    const gelesen = await lies(fx.a.token, titel);
    expect(gelesen.status).toBe(200);
    const { rev } = (await gelesen.json()) as { rev: number };

    const geaendert = await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ content: `${titel}\nzweite Fassung`, rev }),
    });
    expect(geaendert.status).toBe(200);

    const geloescht = await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(geloescht.status).toBe(200);
  });

  it("die persönliche Notiz eines anderen bleibt privat", async () => {
    // Die Kehrseite: „persönlich" heißt nicht „für alle sichtbar, weil kein
    // Projekt daran hängt".
    const titel = `Geheimnotiz${S}`;
    expect((await notiz(fx.a.token, `${titel}\nnur für A`)).status).toBe(201);

    const alsB = await lies(fx.b.token, titel);
    expect(alsB.status).toBe(403);

    const listeB = await fx.app.request("/api/notes?detailed=1", { headers: authHeader(fx.b.token) });
    expect(((await listeB.json()) as { title: string }[]).map((n) => n.title)).not.toContain(titel);
  });

  it("der Verwalter sieht auch persönliche Notizen", async () => {
    // Bewusst so: eine Sicherung mit Lücken wäre keine, und der Admin muss im
    // Ernstfall an alles herankommen. Das ist eine Entscheidung, keine
    // Nachlässigkeit — deshalb steht sie als Test da.
    const titel = `Adminsicht${S}`;
    await notiz(fx.a.token, `${titel}\nInhalt`);
    expect((await lies(fx.admin.token, titel)).status).toBe(200);
  });

  // ── Projektbezogene Notizen: unverändert ─────────────────────────────────

  it("eine Notiz aus einem fremden Projekt bleibt gesperrt", async () => {
    const titel = `Fremdprojekt${S}`;
    expect((await notiz(fx.b.token, `${titel}\nInhalt`, fx.projectBName)).status).toBe(201);
    expect((await lies(fx.a.token, titel)).status).toBe(403);
  });

  it("eine Notiz, die es nicht gibt, ergibt 404 — nicht 403", async () => {
    // Sonst verrät der Statuscode, welche Titel existieren.
    expect((await lies(fx.a.token, `gibt-es-nicht-${S}`)).status).toBe(404);
  });
});
