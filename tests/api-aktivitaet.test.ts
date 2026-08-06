import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Aktivität — „was hat sich zuletzt getan".
//
// Abgeleitet aus den `updated_at`-Spalten, ohne eigenes Protokoll: ein
// zusätzlicher Schreibpfad an jeder Änderungsstelle wäre genau die Stelle, an
// der so etwas kaputtgeht — eine neue Route vergisst den Eintrag, und der Feed
// behauptet, es sei nichts passiert.
describe.skipIf(!HAS_DB)("Aktivität", () => {
  let fx: AclFixture;

  // Eigener Namensraum je Lauf. Grund: Notizen, Aufgaben und Termine hängen
  // per `ON DELETE SET NULL` am Projekt — sie überleben dessen Löschung als
  // Waisen ohne Projektbezug. Das Fixture-Cleanup entfernt nur Projekte und
  // Konten, die Waisen früherer Läufe bleiben in der Test-Datenbank liegen
  // und tauchen für Admins weiter im Feed auf. Mit festen Titeln schlug
  // deshalb die Papierkorb-Prüfung ab dem zweiten Lauf fehl.
  const P = `aktiv-${Date.now()}`;

  beforeAll(async () => {
    fx = await setupAclFixture("aktiv", { geldRecht: true });

    const p = encodeURIComponent(fx.projectName);
    const admin = jsonHeader(fx.admin.token);

    // In A's Projekt je einen Datensatz verschiedener Art …
    await fx.app.request("/api/notes", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ content: `${P}-notiz\nInhalt`, project: fx.projectName }),
    });
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ text: `${P}-aufgabe`, project: fx.projectName }),
    });
    await fx.app.request(`/api/projects/${p}/meetings`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ title: `${P}-besprechung`, date: "2026-09-01" }),
    });

    // … und einen in B's Projekt, den A nicht sehen darf.
    await fx.app.request("/api/tasks", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ text: `${P}-fremd-aufgabe`, project: fx.projectBName }),
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    // Notizen, Aufgaben und Termine überleben das Projekt-Löschen als Waisen
    // (`ON DELETE SET NULL`) — ohne dieses Aufräumen sammelt die
    // Test-Datenbank sie mit jedem Lauf an.
    const { getDb } = await import("../src/db/client.js");
    const db = getDb();
    await db`DELETE FROM notes WHERE title LIKE ${P + "%"}`;
    await db`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  async function feed(token: string) {
    const res = await fx.app.request("/api/aktivitaet", { headers: authHeader(token) });
    expect(res.status).toBe(200);
    return (await res.json()) as {
      typ: string;
      titel: string;
      projectName: string | null;
      geaendertAm: string;
      angelegtVon: string | null;
    }[];
  }

  it("zeigt Datensätze verschiedener Art, neueste zuerst", async () => {
    const eintraege = await feed(fx.admin.token);
    const titel = eintraege.map((e) => e.titel);
    expect(titel).toContain(`${P}-notiz`);
    expect(titel).toContain(`${P}-aufgabe`);
    expect(titel).toContain(`${P}-besprechung`);

    const arten = new Set(eintraege.map((e) => e.typ));
    expect(arten.size).toBeGreaterThan(1);

    // Sortierung: absteigend nach Änderungszeitpunkt.
    const zeiten = eintraege.map((e) => new Date(e.geaendertAm).getTime());
    expect(zeiten).toEqual([...zeiten].sort((a, b) => b - a));
  });

  it("nennt, wer den Datensatz angelegt hat", async () => {
    const eintraege = await feed(fx.admin.token);
    const notiz = eintraege.find((e) => e.titel === `${P}-notiz`);
    expect(notiz?.angelegtVon).toBe(fx.admin.username);
  });

  it("zeigt nur Datensätze aus sichtbaren Projekten", async () => {
    // A sieht sein Projekt, nicht B's.
    const alsA = await feed(fx.a.token);
    expect(alsA.map((e) => e.titel)).toContain(`${P}-aufgabe`);
    expect(alsA.map((e) => e.titel)).not.toContain(`${P}-fremd-aufgabe`);
    expect(alsA.every((e) => e.projectName !== fx.projectBName)).toBe(true);

    // B umgekehrt.
    const alsB = await feed(fx.b.token);
    expect(alsB.map((e) => e.titel)).not.toContain(`${P}-aufgabe`);
  });

  it("ein Projekt im Papierkorb verschwindet auch aus der Aktivität", async () => {
    // Sonst führe der Feed weiter Datensätze auf, die nirgends mehr
    // erreichbar sind — und verriete damit die Namen gelöschter Projekte.
    await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      method: "DELETE",
      headers: authHeader(fx.admin.token),
    });
    try {
      const eintraege = await feed(fx.admin.token);
      expect(eintraege.map((e) => e.titel)).not.toContain(`${P}-notiz`);
      expect(eintraege.every((e) => e.projectName !== fx.projectName)).toBe(true);
    } finally {
      await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/wiederherstellen`, {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
      });
    }
  });

  it("`limit` wird beachtet und gedeckelt", async () => {
    const res = await fx.app.request("/api/aktivitaet?limit=2", { headers: authHeader(fx.admin.token) });
    expect(((await res.json()) as unknown[]).length).toBeLessThanOrEqual(2);

    // Unsinnige Werte laufen nicht in eine Vollabfrage.
    const uebertrieben = await fx.app.request("/api/aktivitaet?limit=99999", {
      headers: authHeader(fx.admin.token),
    });
    expect(((await uebertrieben.json()) as unknown[]).length).toBeLessThanOrEqual(200);
  });

  it("eine Änderung wandert nach oben", async () => {
    // Der eigentliche Zweck: der Feed zeigt den LETZTEN Stand, nicht die
    // Anlagereihenfolge.
    const vorher = await feed(fx.admin.token);
    const aufgabe = vorher.find((e) => e.titel === `${P}-aufgabe`);
    expect(aufgabe).toBeDefined();

    const alle = await fx.app.request("/api/tasks", { headers: authHeader(fx.admin.token) });
    const id = ((await alle.json()) as { id: string; text: string }[]).find((t) => t.text === `${P}-aufgabe`)!.id;

    await fx.app.request(`/api/tasks/${id}`, {
      method: "PUT",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-aufgabe geändert` }),
    });

    // Bewusst nur innerhalb des eigenen Namensraums geprüft, nicht global:
    // die Testdateien laufen parallel, andere Suiten schreiben in dieselbe
    // Datenbank. `nachher[0]` wäre deshalb mal unser Datensatz und mal ein
    // fremder — ein Test, der von der Reihenfolge fremder Läufe abhängt, ist
    // wertlos, egal wie oft er zufällig grün ist.
    const nachher = (await feed(fx.admin.token)).filter((e) => e.titel.startsWith(P));
    expect(nachher[0].titel).toBe(`${P}-aufgabe geändert`);
  });
});
