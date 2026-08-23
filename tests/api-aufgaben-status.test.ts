import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, jsonHeader, namensraum, type AclFixture } from "./helpers/acl-fixture.js";

// Der Aufgaben-Status: EINE Schreibweise, und die Oberfläche kann sie schalten.
//
// Warum das einen eigenen Test bekommt: der Fehler, den Migration 051 behebt,
// war zwei Jahre unsichtbar, obwohl er drei Stellen der Oberfläche lahmlegte.
// Er sah nach nichts aus, weil nichts scheiterte — die Datenbank schrieb
// `offen`, der Typ sagte `open`, und jeder Vergleich lief einfach ins Leere:
//
//   * die Registerkarte „Offen" zeigte „Keine offenen Aufgaben vorhanden.",
//     während 1230 offene Aufgaben in der Tabelle standen,
//   * `cycleStatus()` in der Detailansicht schlug `next["offen"]` nach,
//     bekam `undefined`, und `JSON.stringify` ließ das Feld weg — der Knopf
//     schickte eine Anfrage OHNE Status und tat damit nichts,
//   * die Dashboard-Kennzahl „in Arbeit" konnte nie etwas anderes als 0 sein.
//
// Kein einziger Test wäre damals rot geworden. Diese Datei schließt genau
// diese Lücke: sie prüft nicht Code gegen Code, sondern was tatsächlich in
// der Spalte landet.
describe.skipIf(!HAS_DB)("Aufgaben-Status", () => {
  let fx: AclFixture;
  const P = `status-${namensraum()}`;

  beforeAll(async () => {
    fx = await setupAclFixture("status");
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM tasks WHERE text LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  async function neueAufgabe(name: string) {
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${P}-${name}`, project: fx.projectName }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; status: string; rev?: number };
  }

  it("eine neue Aufgabe ist `open` — nicht `offen`", async () => {
    const t = await neueAufgabe("neu");
    expect(t.status).toBe("open");
  });

  it("auch der Standard der Spalte ist `open`", async () => {
    // Der INSERT in `db-tasks.ts` setzt den Wert selbst. Diese Prüfung geht
    // an ihm vorbei und schreibt OHNE Status — sonst deckte der Test nur die
    // eine Codezeile ab und nicht den Standard, auf den jede Migration und
    // jeder Direktzugriff fällt.
    const { getDb } = await import("../src/db/client.js");
    const [row] = await getDb()`
      INSERT INTO tasks (text) VALUES (${`${P}-direkt`}) RETURNING status`;
    expect(row.status).toBe("open");
  });

  it("die Statuskette der Detailansicht läuft durch: open → in_progress → done", async () => {
    // Genau die Kette aus `TaskDetail.vue.cycleStatus()`. Sie war der
    // stillste der drei Schäden: der Knopf reagierte, die Anfrage ging
    // hinaus, und der Status blieb stehen.
    const t = await neueAufgabe("kette");
    let rev = t.rev;

    for (const erwartet of ["in_progress", "done"] as const) {
      const res = await fx.app.request(`/api/tasks/${t.id}`, {
        method: "PUT",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ status: erwartet, rev }),
      });
      expect(res.status).toBe(200);
      const nachher = (await res.json()) as { status: string; rev?: number };
      expect(nachher.status).toBe(erwartet);
      rev = nachher.rev;
    }
  });

  it("keine Aufgabe in der Datenbank trägt mehr `offen`", async () => {
    // Der Bestandsteil von Migration 051. Ohne diese Prüfung wäre eine
    // Datenbank, in der die Migration nicht durchlief, von einer, in der sie
    // durchlief, nicht zu unterscheiden.
    const { getDb } = await import("../src/db/client.js");
    const [row] = await getDb()`SELECT count(*)::int AS n FROM tasks WHERE status = 'offen'`;
    expect(row.n).toBe(0);
  });

  it("eine fremde Schreibweise wird von der Datenbank abgelehnt", async () => {
    // Die CHECK-Bedingung aus 051. Sie ist der eigentliche Schutz: dass
    // heute alles `open` heisst, sagt nichts darüber, was der nächste
    // Direktzugriff schreibt.
    const { getDb } = await import("../src/db/client.js");
    await expect(getDb()`INSERT INTO tasks (text, status) VALUES (${`${P}-verboten`}, 'offen')`).rejects.toThrow();
  });

  it("Leistungsphasen bleiben auf Deutsch — 051 fasst nur `tasks` an", async () => {
    // Gegenprobe zur Migration: ein Reihen-Rename über alle `status`-Spalten
    // wäre hier der falsche Griff gewesen. `project_phases` hat eine eigene,
    // bewusst deutsche Werteliste (Migration 035).
    const { getDb } = await import("../src/db/client.js");
    const [row] = await getDb()`
      SELECT column_default FROM information_schema.columns
       WHERE table_name = 'project_phases' AND column_name = 'status'`;
    expect(String(row.column_default)).toContain("offen");
  });
});
