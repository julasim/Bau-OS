import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die sieben jsonb-Spalten — geprüft an der WIRKUNG, nicht an der Schreibform.
//
// ── Der Fehler, den das festhält ───────────────────────────────────────────
//
// Sieben Spalten wurden mit `${JSON.stringify(x)}::jsonb` geschrieben.
// postgres.js serialisiert die übergebene Zeichenkette dabei ein zweites Mal;
// in der Spalte landet ein JSON-String statt eines Objekts. Am Treiber
// nachgemessen (02.09.2026, postgres 3.4.9).
//
// Bei fünf Spalten fingen die Leser das ab — dort war es unschön, aber
// folgenlos. Bei zwei nicht, und dort hat es Daten gekostet:
//
//   * `team_members.contact_log` — `Array.isArray` fällt durch auf `[]`.
//     **223 von 223 Zeilen** standen auf `"[]"`: es hat nie ein Vermerk
//     überlebt.
//   * `users.settings` — `typeof === "object"` fällt durch auf `{}`, und
//     dieselbe Funktion MERGT die Einstellungen. Beim nächsten Speichern war
//     alles Vorherige weg.
//
// ⚠ Eine Prüfung auf `jsonb_typeof(...) = 'array'` allein würde nur den
// Schreiber belegen. Der Nachweis ist: **schreiben und wiederfinden.**
describe.skipIf(!HAS_DB)("jsonb-Spalten: geschrieben heißt lesbar", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  let mitgliedId = "";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("jsonb");
    ({ getDb } = await import("../src/db/client.js"));
    const res = await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ name: `jsonb-mitglied-${Date.now()}`, memberType: "Intern" }),
    });
    expect([200, 201]).toContain(res.status);
    mitgliedId = ((await res.json()) as { id: string }).id;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM team_members WHERE id = ${mitgliedId}`;
    await fx.cleanup();
  });

  // ── Der Kontaktverlauf: der teuerste der sieben ──────────────────────────

  it("ein Kontaktvermerk ist nach dem Schreiben wieder da", async () => {
    const text = `Rückruf vereinbart ${Date.now()}`;
    const geschrieben = await fx.app.request(`/api/team/${mitgliedId}/log`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text }),
    });
    expect([200, 201]).toContain(geschrieben.status);

    const gelesen = await fx.app.request(`/api/team/${mitgliedId}`, { headers: authHeader(fx.a.token) });
    expect(gelesen.status).toBe(200);
    const m = (await gelesen.json()) as { contactLog: { ts: string; text: string }[] };
    expect(
      m.contactLog.map((e) => e.text),
      "der Vermerk ist nicht wieder aufgetaucht",
    ).toContain(text);
  });

  it("ein zweiter Vermerk kommt dazu, statt den ersten zu verdrängen", async () => {
    // Das Anhängen läuft über den jsonb-Operator `||`. Auf zwei
    // ZEICHENKETTEN ergibt der ein Array aus zwei Zeichenketten statt eines
    // Objekt-Arrays — die Form, an der ein zu einfacher Leser scheitert.
    const zweiter = `Unterlagen geschickt ${Date.now()}`;
    await fx.app.request(`/api/team/${mitgliedId}/log`, {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ text: zweiter }),
    });
    const gelesen = await fx.app.request(`/api/team/${mitgliedId}`, { headers: authHeader(fx.a.token) });
    const m = (await gelesen.json()) as { contactLog: { text: string }[] };
    expect(m.contactLog.length, "der erste Vermerk ist verschwunden").toBeGreaterThanOrEqual(2);
    expect(m.contactLog.map((e) => e.text)).toContain(zweiter);
  });

  it("in der Spalte stehen Objekte, nicht Zeichenketten", async () => {
    // ⚠ `jsonb_typeof(contact_log) = 'array'` allein genügt NICHT — das ist es
    // auch beim doppelt kodierten Altbestand: `[] || '"[{…}]"'` ergibt ein
    // Array, dessen einziges Element eine Zeichenkette ist. Die Gegenprobe
    // blieb damit grün, weil der tolerante Leser die Form abfängt.
    //
    // Geprüft wird deshalb das ERSTE ELEMENT. Nur so hält diese Zeile den
    // Schreiber und nicht bloß den Leser.
    const [zeile] = await getDb()`
      SELECT jsonb_typeof(contact_log) AS aussen,
             jsonb_typeof(contact_log->0) AS erstes
        FROM team_members WHERE id = ${mitgliedId}`;
    expect(zeile?.aussen).toBe("array");
    expect(zeile?.erstes, "die Einträge sind doppelt kodierte Zeichenketten").toBe("object");
  });

  // ── Die Einstellungen: zweite Speicherung darf die erste nicht löschen ───

  it("eine zweite gespeicherte Einstellung löscht die erste nicht", async () => {
    // ⚠ Genau der Ablauf, der Einstellungen gekostet hat: Speichern schreibt
    // doppelt kodiert, der Merge liest `typeof !== "object"` und beginnt bei
    // `{}` — die erste Einstellung ist beim zweiten Speichern weg.
    const { updateDbUserSettings, findDbUserById } = await import("../src/api/auth.js");

    await updateDbUserSettings(fx.a.id, { theme: "dark" } as Record<string, unknown>);
    await updateDbUserSettings(fx.a.id, { locale: "de-AT" } as Record<string, unknown>);

    const u = await findDbUserById(fx.a.id);
    const s = u?.settings as Record<string, unknown> | undefined;
    expect(s?.locale).toBe("de-AT");
    expect(s?.theme, "die zuerst gespeicherte Einstellung ist verloren gegangen").toBe("dark");

    const [zeile] = await getDb()`SELECT jsonb_typeof(settings) AS typ FROM users WHERE id = ${fx.a.id}`;
    expect(zeile?.typ, "settings ist doppelt kodiert").toBe("object");
  });

  it("Einstellungen aus der Zeit vor dem Fix überleben den nächsten Merge", async () => {
    // Der Altbestand ist doppelt kodiert und lässt sich nicht rücknahmslos
    // migrieren. Betroffen sind genau die Konten, die schon einmal etwas
    // gespeichert haben — und der Schaden entsteht beim NÄCHSTEN Speichern,
    // nicht beim Lesen. Deshalb prüft diese Zeile den Merge, nicht nur den
    // Leser: `updateDbUserSettings` liest den Altbestand, mergt und schreibt
    // zurück. Ohne den toleranten Leser dort beginnt der Merge bei `{}`.
    const { updateDbUserSettings, findDbUserById } = await import("../src/api/auth.js");

    // Altbestand herstellen: genau die alte, doppelt kodierte Schreibform.
    await getDb()`
      UPDATE users SET settings = ${JSON.stringify({ theme: "light" })}::jsonb
       WHERE id = ${fx.b.id}`;
    const vorher = await findDbUserById(fx.b.id);
    expect((vorher?.settings as Record<string, unknown>)?.theme, "Altbestand nicht lesbar").toBe("light");

    await updateDbUserSettings(fx.b.id, { locale: "de-AT" } as Record<string, unknown>);

    const nachher = await findDbUserById(fx.b.id);
    const s = nachher?.settings as Record<string, unknown> | undefined;
    expect(s?.locale).toBe("de-AT");
    expect(s?.theme, "der Altbestand ist beim Merge verloren gegangen").toBe("light");
  });
});
