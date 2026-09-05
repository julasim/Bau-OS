import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { HAS_DB, setupAclFixture, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die vier kleinen Fehler aus AP6 §6.4 — jeder fuer sich harmlos aussehend.
//
// ── Warum sie zusammen in einer Datei stehen ───────────────────────────────
//
// Sie teilen eine Eigenschaft: Keiner von ihnen faellt beim Benutzen auf. Eine
// Meldung ohne Projektbezug sieht aus wie eine Meldung; eine Vorlage ohne
// Standard sieht aus wie „noch keiner gesetzt“; ein `createdBy` von NULL faellt
// erst auf, wenn jemand seine eigene projektlose Aufgabe nicht mehr aendern
// kann. Genau deshalb standen sie jahrelang da.
describe.skipIf(!HAS_DB)("AP6: die kleinen Fehler", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const S = `kleinbug-${Date.now()}`;

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("kleinbugs-ap6");
    ({ getDb } = await import("../src/db/client.js"));
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM benachrichtigungen WHERE titel LIKE ${"%" + S + "%"}`;
    await getDb()`DELETE FROM tasks WHERE text LIKE ${S + "%"}`;
    await getDb()`DELETE FROM termine WHERE text LIKE ${S + "%"}`;
    await getDb()`DELETE FROM team_members WHERE name LIKE ${S + "%"}`;
    await getDb()`DELETE FROM templates WHERE name LIKE ${S + "%"}`;
    await fx.cleanup();
  });

  // ── Benachrichtigungen ohne Projektbezug ────────────────────────────────

  /** Ein Team-Mitglied, das am Benutzerkonto B haengt.
   *
   *  Zwei Bedingungen, ohne die hier gar keine Meldung entsteht — beide beim
   *  Schreiben dieser Pruefung erst durch den Fehlschlag gefunden:
   *
   *   1. `kontenVon` (src/api/melden.ts) meldet nur an Mitglieder mit
   *      verknuepftem Konto. Ein frisch angelegtes Mitglied hat keines.
   *   2. `anlegen()` wirft den AUSLOESER heraus — „Sie haben sich selbst etwas
   *      zugewiesen" ist Laerm. Angelegt wird deshalb vom Verwalterkonto,
   *      zugewiesen an B.
   *
   *  Und es gibt genau EIN solches Mitglied: `uq_team_members_user_id` laesst
   *  je Konto nur eine Verknuepfung zu. */
  let mitgliedB = "";
  async function mitgliedFuerB(): Promise<string> {
    if (mitgliedB) return mitgliedB;
    const res = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ name: `${S}-empfaenger`, memberType: "Intern", projectId: fx.projectBId }),
    });
    mitgliedB = ((await res.json()) as { id: string }).id;
    await getDb()`UPDATE team_members SET user_id = ${fx.b.id} WHERE id = ${mitgliedB}`;
    return mitgliedB;
  }

  it("eine zugewiesene Aufgabe meldet MIT Projekt", async () => {
    // ⚠ `benachrichtigungen.project_id` (Migration 058) blieb bei Aufgaben und
    // Terminen immer leer — die Spalte und der JOIN auf den Projektnamen
    // existierten von Anfang an, nur gab ihn niemand mit. In der Glocke stand
    // die Meldung damit ohne Projekt, obwohl die Aufgabe eines hat.
    const mitglied = await mitgliedFuerB();
    const res = await fx.app.request("/api/tasks", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ text: `${S}-zugewiesen`, project: fx.projectBName, assigneeId: mitglied }),
    });
    expect([200, 201]).toContain(res.status);

    const [m] = await getDb()`
      SELECT project_id FROM benachrichtigungen
       WHERE titel LIKE ${"%" + S + "-zugewiesen%"} ORDER BY erstellt_am DESC LIMIT 1`;
    expect(m, "es wurde gar keine Meldung geschrieben").toBeTruthy();
    expect(m.project_id ? String(m.project_id) : null, "die Meldung traegt keinen Projektbezug").toBe(fx.projectBId);
  });

  it("ein Termin mit Teilnehmern meldet MIT Projekt", async () => {
    const mitglied = await mitgliedFuerB();
    const res = await fx.app.request("/api/termine", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        datum: "2027-07-14",
        text: `${S}-Begehung`,
        project: fx.projectBName,
        assigneeIds: [mitglied],
      }),
    });
    expect([200, 201]).toContain(res.status);

    const [m] = await getDb()`
      SELECT project_id FROM benachrichtigungen
       WHERE titel LIKE ${"%" + S + "-Begehung%"} ORDER BY erstellt_am DESC LIMIT 1`;
    expect(m, "es wurde gar keine Meldung geschrieben").toBeTruthy();
    expect(m.project_id ? String(m.project_id) : null, "die Meldung traegt keinen Projektbezug").toBe(fx.projectBId);
  });

  // ── createdById auf dem Umweg ueber die Projektakte ─────────────────────

  it("eine Aufgabe ueber die Projektakte traegt ihren Verfasser", async () => {
    // ⚠ Dieselbe Aufgabe hatte je nach Anlageweg einen Verfasser oder keinen:
    // `POST /tasks` gab `createdById` mit, `POST /projects/:name/tasks` nicht.
    // Daran haengt, wem eine Aufgabe OHNE Projekt gehoert.
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/tasks`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: `${S}-ueber-Akte` }),
    });
    // Die Route antwortet `{ ok: true }` ohne Datensatz — gesucht wird ueber
    // den Text.
    expect([200, 201]).toContain(res.status);

    const [zeile] = await getDb()`SELECT created_by FROM tasks WHERE text = ${`${S}-ueber-Akte`}`;
    expect(zeile.created_by ? String(zeile.created_by) : null, "die Aufgabe hat keinen Verfasser").toBe(fx.a.id);
  });

  it("ein Termin ueber die Projektakte traegt seinen Verfasser", async () => {
    const res = await fx.app.request(`/api/projects/${encodeURIComponent(fx.projectName)}/termine`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ datum: "2027-08-03", text: `${S}-Termin-Akte` }),
    });
    expect([200, 201]).toContain(res.status);

    const [zeile] = await getDb()`SELECT created_by FROM termine WHERE text = ${`${S}-Termin-Akte`}`;
    expect(zeile.created_by ? String(zeile.created_by) : null, "der Termin hat keinen Verfasser").toBe(fx.a.id);
  });

  // ── Standardvorlage: kein Zwischenzustand ohne Standard ─────────────────

  it("die Standardvorlage wechselt in EINEM Schritt", async () => {
    // Das Umschalten lief in zwei Anweisungen ohne Transaktion: erst alle
    // zuruecksetzen, dann die neue setzen. Dazwischen gab es KEINE
    // Standardvorlage — bricht der Prozess dort ab, meldet der Export einen
    // Fehler, obwohl eine gesetzt ist. Der Zwischenzustand selbst ist von
    // aussen nicht zu treffen; pruefbar ist das ERGEBNIS: nach jedem Wechsel
    // gibt es genau einen Standard, nie null und nie zwei.
    const ids: string[] = [];
    for (const nr of [1, 2]) {
      const res = await fx.app.request("/api/templates", {
        method: "POST",
        headers: jsonHeader(fx.admin.token),
        body: JSON.stringify({ kind: "note", name: `${S}-Vorlage-${nr}`, body: "Text", isDefault: true }),
      });
      expect([200, 201]).toContain(res.status);
      ids.push(((await res.json()) as { id: string }).id);
    }

    const standard = await getDb()`SELECT id FROM templates WHERE kind = 'note' AND is_default = true`;
    expect(standard.length, "kein oder mehr als ein Standard").toBe(1);
    expect(String(standard[0].id)).toBe(ids[1]);

    // Und dasselbe ueber den Aenderungsweg zurueck auf die erste.
    const zurueck = await fx.app.request(`/api/templates/${ids[0]}`, {
      method: "PATCH",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ isDefault: true }),
    });
    expect(zurueck.status).toBe(200);
    const danach = await getDb()`SELECT id FROM templates WHERE kind = 'note' AND is_default = true`;
    expect(danach.length).toBe(1);
    expect(String(danach[0].id)).toBe(ids[0]);
  });

  // ── null mit Status 201 ─────────────────────────────────────────────────

  it("eine angelegte Aufgabe kommt nie als leerer Koerper zurueck", async () => {
    // `taskRepo.update()` liefert `null`, wenn die Zeile zwischen dem Anlegen
    // und dem Nachtragen der optionalen Felder verschwunden ist — die Route
    // reichte das ungeprueft als **201 mit dem Koerper `null`** weiter. Der
    // Client las eine erfolgreiche Anlage ohne Datensatz, `task.id` war
    // `undefined`, und der naechste Schritt lief ins Leere.
    //
    // ⚠ Der Fall ist ueber HTTP nicht herzustellen — zwischen `save()` und
    // `update()` passt keine zweite Anfrage. Ohne die Attrappe waere diese
    // Pruefung auch mit dem alten Code gruen (nachgemessen) und hielte nichts
    // fest. `taskRepo` ist dasselbe Objekt, das die Route importiert.
    const { taskRepo } = await import("../src/data/index.js");
    const spion = vi.spyOn(taskRepo, "update").mockResolvedValue(null);
    try {
      const res = await fx.app.request("/api/tasks", {
        method: "POST",
        headers: jsonHeader(fx.a.token),
        body: JSON.stringify({ text: `${S}-mit-Feldern`, project: fx.projectName, location: "Buero" }),
      });
      expect(res.status).toBe(201);
      const koerper = (await res.json()) as { id?: string } | null;
      expect(koerper, "Status 201, Koerper null").not.toBeNull();
      expect(koerper?.id, "Status 201 ohne id").toBeTruthy();
    } finally {
      spion.mockRestore();
    }
  });
});
