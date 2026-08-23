import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der schreibende Weg in die Dateiablage.
//
// ── Warum es diese Datei geben muss ────────────────────────────────────────
//
// Es gab sieben Testdateien zu den Datei-Rechten. Keine einzige rief
// `POST /files/upload` auf — sie legten ihre Testdateien direkt am Repo an und
// setzten `uploadedById` dabei selbst. Damit belegten sie, dass das
// Eigentümer-Recht greift, WENN das Feld gesetzt ist. Dass die einzige Route,
// die es setzen müsste, es nicht tat, konnte keine von ihnen sehen.
//
// Dieselbe Blindstelle steckte im Projektbezug: die lesenden Wege waren alle
// bewacht, der schreibende nahm jeden Projektnamen entgegen.
describe.skipIf(!HAS_DB)("Dateien — der schreibende Weg", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("datei-acl");
    ({ getDb } = await import("../src/db/client.js"));
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM files WHERE filename LIKE ${"datei-acl-%"}`;
    await fx.cleanup();
  });

  /** Baut einen Upload-Request. Der Inhalt ist eine echte, gültige Textdatei —
   *  die Route prüft Endung UND Magic Bytes (SEC-3b). */
  function upload(token: string, dateiname: string, project?: string) {
    const form = new FormData();
    form.append("files", new File(["Inhalt der Testdatei\n"], dateiname, { type: "text/plain" }));
    if (project !== undefined) form.append("project", project);
    return fx.app.request("/api/files/upload", { method: "POST", headers: authHeader(token), body: form });
  }

  const ersteId = async (res: Response): Promise<string> => {
    const body = (await res.json()) as { dbEntries: { id: string }[] };
    expect(body.dbEntries.length).toBe(1);
    return body.dbEntries[0].id;
  };

  it("B kann keine Datei in A's Projekt hochladen", async () => {
    const res = await upload(fx.b.token, "datei-acl-fremd.txt", fx.projectName);
    expect(res.status).toBe(403);

    // Und es darf auch nichts angekommen sein — ein 403 nach dem Schreiben
    // wäre keine Rechteprüfung, sondern eine Beschwerde.
    const [z] = await getDb()`SELECT count(*)::int AS n FROM files WHERE filename = ${"datei-acl-fremd.txt"}`;
    expect(z.n).toBe(0);
  });

  it("A kann in sein eigenes Projekt hochladen", async () => {
    const res = await upload(fx.a.token, "datei-acl-eigen.txt", fx.projectName);
    expect(res.status).toBe(200);
    await ersteId(res);
  });

  it("der Upload trägt den Hochladenden ein", async () => {
    // Ohne dieses Feld ist jedes Eigentümer-Recht wirkungslos: `uploaded_by`
    // blieb NULL, und `isFileOwnerOrAdmin` sagte deshalb immer nein.
    const res = await upload(fx.a.token, "datei-acl-uploader.txt", fx.projectName);
    expect(res.status).toBe(200);
    const id = await ersteId(res);
    const [z] = await getDb()`SELECT uploaded_by FROM files WHERE id = ${id}::uuid`;
    expect(z.uploaded_by ? String(z.uploaded_by) : null).toBe(fx.a.id);
  });

  it("wer hochlädt, kommt an seine Datei ohne Projekt auch wieder heran", async () => {
    // Der Fall, der vorher endgültig verloren war: ein Upload ohne Projekt
    // hatte weder Projektbezug noch Eigentümer — für niemanden ausser dem
    // Admin je wieder erreichbar, auch nicht für den, der ihn angelegt hat.
    const res = await upload(fx.a.token, "datei-acl-ohne-projekt.txt");
    expect(res.status).toBe(200);
    const id = await ersteId(res);

    const geladen = await fx.app.request(`/api/files/download?id=${id}`, { headers: authHeader(fx.a.token) });
    expect(geladen.status).toBe(200);

    const geloescht = await fx.app.request("/api/files", {
      method: "DELETE",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ id }),
    });
    expect(geloescht.status).toBe(200);
  });

  it("B sieht die Datei aus A's Projekt nicht", async () => {
    const res = await upload(fx.a.token, "datei-acl-geheim.txt", fx.projectName);
    const id = await ersteId(res);
    const fremd = await fx.app.request(`/api/files/download?id=${id}`, { headers: authHeader(fx.b.token) });
    expect(fremd.status).toBe(403);
  });

  // ── Merkliste ─────────────────────────────────────────────────────────────

  it("B kann eine fremde Datei nicht markieren", async () => {
    // Ohne Prüfung liess sich jede beliebige UUID markieren — und Dateiname,
    // Projektname und Projektnummer standen danach in der eigenen Merkliste.
    // Ein Leseweg in fremde Projekte, gebaut aus einem Lesezeichen.
    const res = await upload(fx.a.token, "datei-acl-stern.txt", fx.projectName);
    const id = await ersteId(res);

    const markiert = await fx.app.request(`/api/files/${id}/star`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
    });
    expect(markiert.status).toBe(403);

    const [z] = await getDb()`SELECT count(*)::int AS n FROM file_stars WHERE file_id = ${id}::uuid`;
    expect(z.n).toBe(0);
  });

  it("die Merkliste zeigt keine Datei, die man nicht mehr sehen darf", async () => {
    // Der Nachweis, dass der Filter in der ABFRAGE steht und nicht im Mapping
    // danach: eine markierte, aber nicht mehr sichtbare Datei darf gar nicht
    // erst geladen werden — sonst zählt sie gegen das LIMIT 50.
    const res = await upload(fx.a.token, "datei-acl-merkliste.txt", fx.projectName);
    const id = await ersteId(res);

    await fx.app.request(`/api/files/${id}/star`, { method: "POST", headers: jsonHeader(fx.a.token) });
    // B markiert dieselbe Datei am Wachposten vorbei — so, wie es vor dem Fix
    // über die Route möglich war.
    await getDb()`INSERT INTO file_stars (file_id, user_id) VALUES (${id}::uuid, ${fx.b.id}::uuid) ON CONFLICT DO NOTHING`;

    const beiA = (await (await fx.app.request("/api/files/starred", { headers: authHeader(fx.a.token) })).json()) as {
      id: string;
    }[];
    const beiB = (await (await fx.app.request("/api/files/starred", { headers: authHeader(fx.b.token) })).json()) as {
      id: string;
    }[];
    expect(beiA.map((f) => f.id)).toContain(id);
    expect(beiB.map((f) => f.id)).not.toContain(id);
  });
});
