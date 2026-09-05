import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Was im Papierkorb liegt, ist überall weg — nicht nur in seiner eigenen Liste.
//
// ── Die Fehlerklasse ───────────────────────────────────────────────────────
//
// Migration 049 hat das Löschen auf `deleted_at` umgestellt. Der Filter fehlte
// danach an fünf Stellen, und dort tauchte das Gelöschte weiter auf:
//
//   * die Suche (Notizen und Aufgaben — der Projekt-Zweig filterte korrekt)
//   * die Aktivitätsliste. ⚠ Verschärft durch `trg_tasks_updated_at`: Löschen
//     setzt `updated_at = now()`, der gelöschte Eintrag stand danach GANZ OBEN
//   * die Kennzahlen der Projektakte („12 offen", ließ sich nicht auf null
//     bringen)
//   * die Notizliste eines Projekts
//   * die nächste Frist im Portfolio — die einzige Leseabfrage auf `termine`
//     im Haus ohne den Filter. Ein gelöschter Termin in der Vergangenheit
//     hielt die Ampel dauerhaft rot
describe.skipIf(!HAS_DB)("Papierkorb: gelöscht heißt überall weg", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const S = `papierkorb-${Date.now()}`;
  let notizName = "";
  let aufgabeId = "";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("papierkorb-unsichtbar");
    ({ getDb } = await import("../src/db/client.js"));

    // Eine Notiz und eine Aufgabe anlegen — und danach wegwerfen.
    notizName = `${S}-Aktenvermerk`;
    const n = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ content: `${notizName}\n\n${S}-inhalt`, project: fx.projectName }),
    });
    expect([200, 201]).toContain(n.status);

    const t = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `${S}-Aufgabe`, project: fx.projectName }),
    });
    aufgabeId = ((await t.json()) as { id: string }).id;

    await fx.app.request(`/api/notes/${encodeURIComponent(notizName)}`, {
      method: "DELETE",
      headers: authHeader(fx.a.token),
    });
    await fx.app.request(`/api/tasks/${aufgabeId}`, { method: "DELETE", headers: authHeader(fx.a.token) });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${S + "%"}`;
    await getDb()`DELETE FROM notes WHERE title LIKE ${S + "%"}`;
    await getDb()`DELETE FROM termine WHERE text LIKE ${S + "%"}`;
    await fx.cleanup();
  });

  it("die Suche findet weder die gelöschte Notiz noch die gelöschte Aufgabe", async () => {
    // ⚠ Die GEGENRICHTUNG ist hier nicht schmückendes Beiwerk, sondern der
    // Kern: Ohne sie wäre diese Prüfung auch dann grün, wenn die Suche gar
    // nichts findet — und genau so ist sie beim ersten Anlauf grün geblieben,
    // obwohl der Filter zurückgenommen war.
    const suche = async (q: string) => {
      const res = await fx.app.request(`/api/search?q=${encodeURIComponent(q)}`, { headers: authHeader(fx.a.token) });
      expect(res.status).toBe(200);
      // ⚠ Das Feld heisst `title`, nicht `titel` — die Query benutzt intern
      // `titel`, das DTO nicht (`db-search.ts`, Zeile 315). Mit dem falschen
      // Namen ergab `.map()` lauter `undefined`, und jede „nicht enthalten"-
      // Prüfung war trivial grün. Genau das hat die Kontrolle darunter
      // aufgedeckt.
      return ((await res.json()) as { results: { type: string; title: string }[] }).results
        .map((t) => t.title)
        .join(" | ");
    };

    // Kontrolle: ein NICHT gelöschter Datensatz mit demselben Präfix wird
    // gefunden. Erst damit sagt die Prüfung darunter etwas aus.
    const lebend = `${S}-lebendige-Notiz`;
    const angelegt = await fx.app.request("/api/notes", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({
        content: `${lebend}

inhalt`,
        project: fx.projectName,
      }),
    });
    expect([200, 201]).toContain(angelegt.status);
    expect(await suche(lebend), "die Suche findet gar nichts — die Prüfung darunter wäre wertlos").toContain(lebend);

    // Hart wieder weg, nicht in den Papierkorb: Sie soll die Kennzahlen der
    // Projektakte weiter unten nicht verfälschen — und im Papierkorb zählte
    // sie zwar nicht mehr, wäre aber genau der Zustand, den die Prüfung
    // darunter herstellen will.
    await getDb()`DELETE FROM notes WHERE title = ${lebend}`;

    const treffer = await suche(S);
    expect(treffer, "gelöschte Notiz in der Suche").not.toContain(`${S}-Aktenvermerk`);
    expect(treffer, "gelöschte Aufgabe in der Suche").not.toContain(`${S}-Aufgabe`);
  });

  it("die Aktivitätsliste zeigt sie nicht — auch nicht ganz oben", async () => {
    // ⚠ Der Trigger setzt beim Löschen `updated_at = now()`. Ohne Filter stand
    // der gelöschte Eintrag deshalb als JÜNGSTE Änderung an erster Stelle.
    const res = await fx.app.request("/api/aktivitaet?limit=50", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text, "Gelöschtes im Aktivitätsfeed").not.toContain(`${S}-Aufgabe`);
    expect(text, "Gelöschtes im Aktivitätsfeed").not.toContain(`${S}-Aktenvermerk`);
  });

  it("die Kennzahlen der Projektakte zählen sie nicht mit", async () => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}`, {
      headers: authHeader(fx.a.token),
    });
    const info = (await res.json()) as { notes: number; openTasks: number };
    // Beide Datensätze liegen im Papierkorb — dieses Projekt hat sonst keine.
    expect(info.openTasks, "die gelöschte Aufgabe zählt weiter als offen").toBe(0);
    expect(info.notes, "die gelöschte Notiz zählt weiter mit").toBe(0);
  });

  it("die Notizliste des Projekts führt sie nicht", async () => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/notes`, {
      headers: authHeader(fx.a.token),
    });
    expect((await res.json()) as string[]).not.toContain(notizName);
  });

  it("die nächste Frist im Portfolio kommt nicht aus dem Papierkorb", async () => {
    // Ein Termin in der Vergangenheit, weggeworfen — genau der Grund, warum
    // man ihn wegwirft. Ohne Filter blieb die Ampel dauerhaft rot.
    const angelegt = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "2027-06-15", text: `${S}-Frist`, project: fx.projectName }),
    });
    const id = ((await angelegt.json()) as { id: string }).id;

    const vorher = await fx.app.request("/api/portfolio", { headers: authHeader(fx.a.token) });
    const zeileVorher = ((await vorher.json()) as { name: string; nextDeadlineLabel?: string | null }[]).find(
      (z) => z.name === fx.projectName,
    );
    expect(zeileVorher?.nextDeadlineLabel, "der Termin steht gar nicht als Frist").toContain(`${S}-Frist`);

    await fx.app.request(`/api/termine/${id}`, { method: "DELETE", headers: authHeader(fx.a.token) });

    const nachher = await fx.app.request("/api/portfolio", { headers: authHeader(fx.a.token) });
    const zeileNachher = ((await nachher.json()) as { name: string; nextDeadlineLabel?: string | null }[]).find(
      (z) => z.name === fx.projectName,
    );
    expect(zeileNachher?.nextDeadlineLabel ?? "", "der gelöschte Termin ist weiter die nächste Frist").not.toContain(
      `${S}-Frist`,
    );
  });
});
