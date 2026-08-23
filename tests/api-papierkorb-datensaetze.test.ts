import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Papierkorb für einzelne Datensätze (Migration 049).
//
// Migration 044 hat den Papierkorb für PROJEKTE gebracht — dort ist der
// Schaden am größten. Im Alltag wird aber etwas anderes gelöscht: eine Notiz,
// eine Aufgabe, ein Termin. Das passierte bis hierher endgültig, mit einer
// Rückfrage als einziger Bremse; der Rückweg war die nächtliche Sicherung.
//
// Die Rechte sind dieselben wie in den Listen selbst — sonst wäre der
// Papierkorb der Weg, auf dem man die persönlichen Notizen der Kollegen doch
// noch zu sehen bekommt.
describe.skipIf(!HAS_DB)("Papierkorb für Notizen, Aufgaben und Termine", () => {
  let fx: AclFixture;
  const S = namensraum();

  const korb = (token: string) => fx.app.request("/api/papierkorb", { headers: authHeader(token) });

  async function inhalt(token: string) {
    const res = await korb(token);
    expect(res.status).toBe(200);
    return (await res.json()) as {
      eintraege: { typ: string; id: string; titel: string; projectName: string | null }[];
      projekte: { name: string }[];
    };
  }

  beforeAll(async () => {
    fx = await setupAclFixture("pkds");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    await db`DELETE FROM notes WHERE title LIKE ${"%" + S + "%"}`;
    await db`DELETE FROM tasks WHERE text LIKE ${"%" + S + "%"}`;
    await db`DELETE FROM termine WHERE text LIKE ${"%" + S + "%"}`;
    await fx.cleanup();
  });

  it("eine gelöschte Aufgabe verschwindet aus der Liste und liegt im Papierkorb", async () => {
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `Aufgabe ${S}`, project: fx.projectName }),
    });
    expect(angelegt.status).toBe(201);
    const id = ((await angelegt.json()) as { id: string }).id;

    expect(
      (await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) })).status,
    ).toBe(200);

    // Aus der Liste raus …
    const liste = await fx.app.request("/api/tasks", { headers: authHeader(fx.a.token) });
    expect(((await liste.json()) as { id: string }[]).some((t) => t.id === id)).toBe(false);
    // … einzeln nicht mehr auffindbar …
    expect((await fx.app.request(`/api/tasks/${id}`, { headers: authHeader(fx.a.token) })).status).toBe(404);
    // … aber im Papierkorb.
    const k = await inhalt(fx.a.token);
    expect(k.eintraege.some((e) => e.id === id && e.typ === "aufgabe")).toBe(true);
  });

  it("… und lässt sich vollständig zurückholen", async () => {
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `Zurueckholen ${S}`, project: fx.projectName }),
    });
    const t = (await angelegt.json()) as { id: string; rev: number };
    // Ein Feld nachtraeglich setzen — das Anlegen nimmt nur Text und Projekt.
    await fx.app.request(`/api/tasks/${t.id}`, {
      method: "PUT",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ priority: "hoch", rev: t.rev }),
    });
    await fx.app.request(`/api/tasks/${t.id}`, { method: "DELETE", headers: authHeader(fx.a.token) });

    const zurueck = await fx.app.request(`/api/papierkorb/aufgabe/${t.id}/zurueckholen`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
    });
    expect(zurueck.status).toBe(200);

    const wieder = await fx.app.request(`/api/tasks/${t.id}`, { headers: authHeader(fx.a.token) });
    expect(wieder.status).toBe(200);
    // Nicht nur die Hülle: die Felder sind noch da.
    const daten = (await wieder.json()) as { text: string; priority: string };
    expect(daten.text).toBe(`Zurueckholen ${S}`);
    expect(daten.priority).toBe("hoch");
  });

  it("Notizen und Termine ebenso", async () => {
    const notiz = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ content: `Notiz ${S}\nInhalt`, project: fx.projectName }),
    });
    expect(notiz.status).toBe(201);
    await fx.app.request(`/api/notes/${encodeURIComponent(`Notiz ${S}`)}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    // Die Notiz ist über ihren Titel nicht mehr auffindbar …
    expect(
      (await fx.app.request(`/api/notes/${encodeURIComponent(`Notiz ${S}`)}`, { headers: authHeader(fx.a.token) }))
        .status,
    ).toBe(404);

    const termin = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "01.10.2026", text: `Termin ${S}`, project: fx.projectName }),
    });
    const tid = ((await termin.json()) as { id: string }).id;
    await fx.app.request(`/api/termine/${tid}`, { method: "DELETE", headers: authHeader(fx.a.token) });

    const k = await inhalt(fx.a.token);
    expect(k.eintraege.some((e) => e.typ === "notiz" && e.titel === `Notiz ${S}`)).toBe(true);
    expect(k.eintraege.some((e) => e.typ === "termin" && e.id === tid)).toBe(true);

    // Zurückholen bringt die Notiz wieder unter ihrem Titel zurück.
    const notizEintrag = k.eintraege.find((e) => e.typ === "notiz" && e.titel === `Notiz ${S}`)!;
    await fx.app.request(`/api/papierkorb/notiz/${notizEintrag.id}/zurueckholen`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
    });
    const wieder = await fx.app.request(`/api/notes/${encodeURIComponent(`Notiz ${S}`)}`, {
      headers: authHeader(fx.a.token),
    });
    expect(wieder.status).toBe(200);
    expect(((await wieder.json()) as { content: string }).content).toContain("Inhalt");
  });

  // ── Rechte ───────────────────────────────────────────────────────────────

  it("aus einem fremden Projekt sieht man nichts im Papierkorb", async () => {
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `Fremd ${S}`, project: fx.projectName }),
    });
    const id = ((await angelegt.json()) as { id: string }).id;
    await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) });

    const k = await inhalt(fx.b.token);
    expect(k.eintraege.some((e) => e.id === id)).toBe(false);

    // Und Zurückholen geht auch nicht — wer es nicht sieht, fasst es nicht an.
    const versuch = await fx.app.request(`/api/papierkorb/aufgabe/${id}/zurueckholen`, {
      method: "POST",
      headers: jsonHeader(fx.b.token),
    });
    expect(versuch.status).toBe(404);
  });

  it("eine persönliche Notiz erscheint nur bei ihrem Verfasser", async () => {
    // Ohne diese Regel wäre der Papierkorb der Weg, auf dem man die
    // persönlichen Notizen der Kollegen doch noch zu sehen bekommt.
    const titel = `Privat ${S}`;
    await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ content: `${titel}\nnur für A` }),
    });
    await fx.app.request(`/api/notes/${encodeURIComponent(titel)}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });

    expect((await inhalt(fx.a.token)).eintraege.some((e) => e.titel === titel)).toBe(true);
    expect((await inhalt(fx.b.token)).eintraege.some((e) => e.titel === titel)).toBe(false);
  });

  it("Projekte im Papierkorb sieht nur die Verwaltung", async () => {
    await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    try {
      expect((await inhalt(fx.admin.token)).projekte.some((p) => p.name === fx.projectName)).toBe(true);
      expect((await inhalt(fx.b.token)).projekte).toEqual([]);
    } finally {
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
      });
    }
  });

  // ── Endgültig ────────────────────────────────────────────────────────────

  it("endgültig löschen geht nur aus dem Papierkorb heraus", async () => {
    const angelegt = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `Endgueltig ${S}`, project: fx.projectName }),
    });
    const id = ((await angelegt.json()) as { id: string }).id;

    // Noch in Verwendung: der Papierkorb kennt sie nicht.
    const zuFrueh = await fx.app.request(`/api/papierkorb/aufgabe/${id}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(zuFrueh.status).toBe(404);

    await fx.app.request(`/api/tasks/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) });
    const jetzt = await fx.app.request(`/api/papierkorb/aufgabe/${id}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(jetzt.status).toBe(200);

    // Danach ist sie wirklich weg — auch aus dem Papierkorb.
    expect((await inhalt(fx.a.token)).eintraege.some((e) => e.id === id)).toBe(false);
    const { getDb } = await import("../src/db/client.js");
    const [rest] = await getDb()`SELECT count(*)::int AS n FROM tasks WHERE id = ${id}`;
    expect(Number((rest as { n: number }).n)).toBe(0);
  });

  it("eine unbekannte Art wird abgelehnt", async () => {
    const res = await fx.app.request("/api/papierkorb/rechnung/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    expect(res.status).toBe(400);
  });

  it("ein Termin wird über die ID gelöscht, nicht über seinen Text", async () => {
    // Früher stand hier `DELETE … WHERE id::text = $1 OR text LIKE '%$1%'` —
    // derselbe Fehler, der bei den Notizen schon einmal zugeschlagen hat:
    // „Abnahme" löschen hätte jeden Termin mit „Abnahme" im Text getroffen.
    const eins = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "02.10.2026", text: `Abnahme ${S}`, project: fx.projectName }),
    });
    const zwei = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "03.10.2026", text: `Abnahme ${S} Rohbau`, project: fx.projectName }),
    });
    const id1 = ((await eins.json()) as { id: string }).id;
    const id2 = ((await zwei.json()) as { id: string }).id;

    await fx.app.request(`/api/termine/${id1}`, { method: "DELETE", headers: authHeader(fx.a.token) });

    expect((await fx.app.request(`/api/termine/${id2}`, { headers: authHeader(fx.a.token) })).status).toBe(200);
    expect((await fx.app.request(`/api/termine/${id1}`, { headers: authHeader(fx.a.token) })).status).toBe(404);
  });
});
