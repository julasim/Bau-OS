import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// „Ältere laden" — der Datums-Cursor `?vor=`.
//
// ── Der Befund ─────────────────────────────────────────────────────────────
//
// Bautagebuch, Besprechungen und Stunden holten eine feste Zahl neuester
// Einträge (60/100/200) und boten keinen Weg zu den älteren. Nach rund zwei
// Monaten täglicher Einträge war der ältere Bestand im Programm nicht mehr
// erreichbar: die Daten lagen in der Datenbank, der Weg dorthin fehlte.
//
// ── Warum ein Datums-Cursor und kein Offset ────────────────────────────────
//
// Weil während des Blätterns neue Einträge dazukommen. Ein `OFFSET 60`
// überspringt dann Zeilen (wenn vorne etwas dazukam) oder zeigt sie doppelt.
// Der Cursor hängt am Inhalt, nicht an einer Position.
describe.skipIf(!HAS_DB)("Blättern: ältere Einträge bleiben erreichbar", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("blaettern");
    ({ getDb } = await import("../src/db/client.js"));

    // Zehn Bautage und zehn Besprechungen, absteigend datiert.
    const n = encodeURIComponent(fx.projectName);
    for (let i = 1; i <= 10; i++) {
      const tag = `2026-03-${String(i).padStart(2, "0")}`;
      const b = await fx.app.request(`/api/projects/${n}/bautagebuch/${tag}`, {
        method: "PUT",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ activities: `Tag ${i}` }),
      });
      expect(b.status).toBe(200);
      const m = await fx.app.request(`/api/projects/${n}/meetings`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ title: `Besprechung ${i}`, date: tag }),
      });
      expect(m.status).toBe(201);
    }
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM bautagebuch WHERE project_id = ${fx.projectId}::uuid`;
    await getDb()`DELETE FROM meetings WHERE project_id = ${fx.projectId}::uuid`;
    await fx.cleanup();
  });

  const hole = async <T>(pfad: string): Promise<T[]> => {
    const res = await fx.app.request(pfad, { headers: authHeader(fx.admin.token) });
    expect(res.status).toBe(200);
    return (await res.json()) as T[];
  };

  it("Bautagebuch: die zweite Seite bringt die älteren Tage", async () => {
    const n = encodeURIComponent(fx.projectName);
    const erste = await hole<{ date: string }>(`/api/projects/${n}/bautagebuch?limit=4`);
    expect(erste.map((e) => e.date)).toEqual(["2026-03-10", "2026-03-09", "2026-03-08", "2026-03-07"]);

    const zweite = await hole<{ date: string }>(`/api/projects/${n}/bautagebuch?limit=4&vor=${erste.at(-1)!.date}`);
    expect(zweite.map((e) => e.date)).toEqual(["2026-03-06", "2026-03-05", "2026-03-04", "2026-03-03"]);
  });

  it("Bautagebuch: keine Zeile doppelt, keine ausgelassen", async () => {
    // Der eigentliche Punkt gegenüber einem Offset.
    const n = encodeURIComponent(fx.projectName);
    const gesehen: string[] = [];
    let cursor = "";
    for (let runde = 0; runde < 5; runde++) {
      const seite = await hole<{ date: string }>(
        `/api/projects/${n}/bautagebuch?limit=3` + (cursor ? `&vor=${cursor}` : ""),
      );
      if (seite.length === 0) break;
      gesehen.push(...seite.map((e) => e.date));
      cursor = seite.at(-1)!.date;
    }
    expect(new Set(gesehen).size).toBe(gesehen.length); // nichts doppelt
    expect(gesehen.length).toBe(10); // nichts ausgelassen
  });

  it("Besprechungen: derselbe Cursor", async () => {
    const n = encodeURIComponent(fx.projectName);
    const erste = await hole<{ date: string; title: string }>(`/api/projects/${n}/meetings?limit=3`);
    expect(erste.length).toBe(3);
    const zweite = await hole<{ date: string }>(`/api/projects/${n}/meetings?limit=3&vor=${erste.at(-1)!.date}`);
    expect(zweite.length).toBe(3);
    expect(zweite[0].date < erste.at(-1)!.date).toBe(true);
  });

  it("ein unsinniger Cursor wird ignoriert statt zu scheitern", async () => {
    // Der Wert kommt aus einer URL — er darf nicht in die Abfrage geraten.
    const n = encodeURIComponent(fx.projectName);
    for (const bloed of ["morgen", "2026-13-99", "'; DROP TABLE bautagebuch; --"]) {
      const res = await fx.app.request(`/api/projects/${n}/bautagebuch?limit=2&vor=${encodeURIComponent(bloed)}`, {
        headers: authHeader(fx.admin.token),
      });
      expect(res.status, bloed).toBe(200);
      expect(((await res.json()) as unknown[]).length, bloed).toBe(2);
    }
    // Und die Tabelle steht noch.
    const [z] = await getDb()`SELECT count(*)::int AS n FROM bautagebuch WHERE project_id = ${fx.projectId}::uuid`;
    expect(z.n).toBe(10);
  });
});
