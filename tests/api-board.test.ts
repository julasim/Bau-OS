import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture, namensraum } from "./helpers/acl-fixture.js";

// Das Board für den Besprechungsraum — und die dritte Rolle dahinter.
//
// ── Was hier wirklich geprüft wird ─────────────────────────────────────────
//
// Nicht, ob die Kacheln hübsch sind. Sondern die drei Zusicherungen, die die
// Rolle überhaupt erst rechtfertigen:
//
//   1. SCHREIBSCHUTZ. Ein Gerät, an dem niemand sitzt und das den ganzen Tag
//      läuft, darf nichts ändern können. Es gibt 94 schreibende Endpunkte —
//      geprüft wird deshalb die MIDDLEWARE, nicht jede Route einzeln.
//   2. KEINE BETRÄGE. In dem Raum sitzen auch Bauherren.
//   3. KEINE KONTAKTDATEN. `GET /api/team` liefert sonst jedem angemeldeten
//      Konto E-Mail und Telefonnummer aller Mitglieder.
describe.skipIf(!HAS_DB)("Board und Präsentationsrolle", () => {
  let fx: AclFixture;
  let getDb: typeof import("../src/db/client.js").getDb;
  const P = `board-${namensraum()}`;
  let boardToken = "";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("board", { geldRecht: true });
    ({ getDb } = await import("../src/db/client.js"));

    // Ein Präsentationskonto anlegen — über die reguläre Verwaltungsroute,
    // nicht per SQL: nur so wird auch geprüft, dass die Rolle dort überhaupt
    // durchkommt.
    const angelegt = await fx.app.request("/api/admin/users", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ username: `${P}-anzeige`, password: "AnzeigeKonto2026!x", role: "praesentation" }),
    });
    expect([200, 201]).toContain(angelegt.status);

    const anmeldung = await fx.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `${P}-anzeige`, password: "AnzeigeKonto2026!x" }),
    });
    expect(anmeldung.status).toBe(200);
    boardToken = ((await anmeldung.json()) as { token: string }).token;

    // Ein Team-Mitglied mit Kontaktdaten, an dem der Filter sichtbar wird.
    await fx.app.request("/api/team", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        name: `${P}-kontakt`,
        memberType: "Intern",
        email: "geheim@example.at",
        phone: "+43 316 999",
      }),
    });
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await getDb()`DELETE FROM team_members WHERE name LIKE ${P + "%"}`;
    await getDb()`DELETE FROM users WHERE username LIKE ${P + "%"}`;
    await fx.cleanup();
  });

  // ── 1. Die Rolle kommt überhaupt durch ───────────────────────────────────

  it("ein unbekanntes Rollenwort wird abgelehnt statt still zu Benutzer", async () => {
    // Vorher: `body.role === "admin" ? "admin" : "user"` — ein Vertipper ergab
    // wortlos ein Benutzerkonto. Mit einer dritten Rolle ist das kein
    // Schönheitsfehler mehr: ein Präsentationskonto, das sich stillschweigend
    // in ein normales verwandelt, darf danach schreiben.
    const res = await fx.app.request("/api/admin/users", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({ username: `${P}-tippfehler`, password: "IrgendeinPasswort2026!", role: "praesentaton" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Unbekannte Rolle");
  });

  it("die Rolle bleibt nach dem Anmelden erhalten", async () => {
    const res = await fx.app.request("/api/auth/me", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { role: string }).role).toBe("praesentation");
  });

  // ── 2. Schreibschutz ─────────────────────────────────────────────────────

  it.each([
    ["POST", "/api/tasks", { text: "Board darf das nicht" }],
    ["POST", "/api/notes", { content: "Board darf das nicht" }],
    ["POST", "/api/team", { name: "Board darf das nicht" }],
    ["PATCH", "/api/me/preferences", { theme: "dark" }],
  ])("%s %s wird abgewiesen", async (methode, pfad, koerper) => {
    const res = await fx.app.request(pfad, {
      method: methode,
      headers: jsonHeader(boardToken),
      body: JSON.stringify(koerper),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("Anzeige");
  });

  it("lesen darf es dagegen", async () => {
    const res = await fx.app.request("/api/board/heute", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
  });

  // ── 3. Keine Beträge ─────────────────────────────────────────────────────

  it("das Board sieht keine Beträge — auch wenn jemand das Recht setzt", async () => {
    // Der gefährliche Fall: ein versehentlich gesetzter Schalter im
    // Benutzerdialog. Die Rolle muss ihn überstimmen.
    await getDb()`UPDATE users SET can_see_money = true WHERE username = ${P + "-anzeige"}`;
    const res = await fx.app.request("/api/portfolio", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const feld of ["budget", "betrag", "hourlyRate", "honorar"]) {
      expect(text.toLowerCase(), feld).not.toContain(`"${feld.toLowerCase()}"`);
    }
  });

  // ── 4. Keine Kontaktdaten ────────────────────────────────────────────────

  it("das Board sieht weder E-Mail noch Telefonnummer", async () => {
    const res = await fx.app.request("/api/team", { headers: authHeader(boardToken) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(`${P}-kontakt`); // der NAME bleibt — ohne ihn wäre das Board leer
    expect(text).not.toContain("geheim@example.at");
    expect(text).not.toContain("+43 316 999");
  });

  it("ein normales Konto sieht die Kontaktdaten weiterhin", async () => {
    // Die Gegenrichtung: der Filter darf nicht „funktionieren", indem er für
    // alle greift. Das Büro braucht den Kollegenkatalog.
    const res = await fx.app.request("/api/team", { headers: authHeader(fx.a.token) });
    const text = await res.text();
    expect(text).toContain("geheim@example.at");
  });

  // ── 5. Die Board-Endpunkte selbst ────────────────────────────────────────

  it.each(["/api/board/heute", "/api/board/aufgaben", "/api/board/projekte", "/api/board/woche"])(
    "%s antwortet",
    async (pfad) => {
      const res = await fx.app.request(pfad, { headers: authHeader(boardToken) });
      expect(res.status).toBe(200);
    },
  );

  it("das Board sieht alle Projekte, ein normales Konto nur seine", async () => {
    // Der Grund für die Rolle: ein Board, das nur einen Ausschnitt zeigt, wäre
    // irreführend — es hängt im Raum und beantwortet „was ist heute los".
    const alsBoard = (await (
      await fx.app.request("/api/board/projekte", { headers: authHeader(boardToken) })
    ).json()) as { name: string }[];
    const alsB = (await (await fx.app.request("/api/board/projekte", { headers: authHeader(fx.b.token) })).json()) as {
      name: string;
    }[];

    const namenBoard = alsBoard.map((p) => p.name);
    expect(namenBoard).toContain(fx.projectName);
    expect(namenBoard).toContain(fx.projectBName);
    // B ist teil-berechtigt und sieht nur sein eigenes.
    expect(alsB.map((p) => p.name)).not.toContain(fx.projectName);
  });

  it("die Projektliste des Boards führt gar keine Geldfelder", async () => {
    // Bewusst nicht abgefragt statt nachträglich gefiltert: sich auf einen
    // Filter zu verlassen ist schwächer, als die Spalte nie zu lesen.
    const res = await fx.app.request("/api/board/projekte", { headers: authHeader(fx.admin.token) });
    const text = await res.text();
    expect(text).not.toContain("budget");
  });
});
