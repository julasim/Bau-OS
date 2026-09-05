import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Admin-Guards in admin-users.ts deckten nur /admin/users und
// /admin/users/* ab. GET /admin/audit lag daneben und war damit fuer JEDEN
// angemeldeten Nutzer lesbar — Login-Versuche, 2FA-Events, Passwort-Resets
// und IP-Adressen aller Konten. Der Guard muss das gesamte /admin-Prefix
// abdecken, ohne die absichtlich offene Route /users/mini mitzusperren.
describe.skipIf(!HAS_DB)("API — Admin-Guard deckt alle /admin-Routen", () => {
  let fx: AclFixture;

  beforeAll(async () => {
    fx = await setupAclFixture("audit");
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
  });

  const get = (path: string, token?: string) =>
    fx.app.request(path, token ? { headers: authHeader(token) } : undefined);

  // ── Der eigentliche Befund ───────────────────────────────────────────────
  it("Audit-Log: Non-Admin (B) → 403", async () => {
    expect((await get("/api/admin/audit", fx.b.token)).status).toBe(403);
  });

  it("Audit-Log: Non-Admin mit Filter-Parametern → ebenfalls 403", async () => {
    // Der Guard darf nicht an der Query-String haengen.
    expect((await get("/api/admin/audit?limit=5&eventPrefix=login", fx.b.token)).status).toBe(403);
  });

  it("Audit-Log: Admin → 200 mit Liste", async () => {
    const res = await get("/api/admin/audit?limit=5", fx.admin.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("Audit-Log: ohne Token → 401", async () => {
    expect((await get("/api/admin/audit")).status).toBe(401);
  });

  // ── Regressionsschutz: der breitere Guard darf nichts kaputt machen ──────
  it("Nutzerliste: Non-Admin → 403, Admin → 200 (unveraendert)", async () => {
    expect((await get("/api/admin/users", fx.b.token)).status).toBe(403);
    expect((await get("/api/admin/users", fx.admin.token)).status).toBe(200);
  });

  it("Verschachtelte Admin-Route (/admin/users/:id/password): Non-Admin → 403", async () => {
    // Prueft, dass das Prefix-Wildcard auch mehrere Pfadsegmente deckt.
    const res = await fx.app.request(`/api/admin/users/${fx.a.id}/password`, {
      method: "PATCH",
      headers: jsonHeader(fx.b.token),
      body: JSON.stringify({ newPassword: "uebernommen-123" }),
    });
    expect(res.status).toBe(403);
  });

  it("/users/mini bleibt fuer Non-Admins offen (absichtlich, kein /admin-Prefix)", async () => {
    const res = await get("/api/users/mini", fx.b.token);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  // ── Das Protokoll protokolliert wirklich ─────────────────────────────────
  //
  // ⚠ Bis zum 01.09.2026 war das NICHT so, und zwar bei jedem einzelnen
  // Eintrag. `logEvent` schrieb die Details mit
  // `${JSON.stringify(x)}::jsonb` — postgres.js serialisiert die uebergebene
  // Zeichenkette dabei ein zweites Mal, in der Spalte landet ein JSON-String
  // statt eines Objekts. `rowToEntry` prueft auf `typeof === "object"`, die
  // Zeichenkette faellt durch, und heraus kam `{}`.
  //
  // Gemessen an der Testdatenbank: 2839 von 2839 Eintraegen hatten
  // `jsonb_typeof(details) = 'string'`. Wer im Nachhinein wissen wollte,
  // WARUM eine Anmeldung fehlgeschlagen ist oder auf WELCHE Rolle ein Konto
  // gesetzt wurde, bekam eine leere Klammer.
  //
  // Kein Test hat das gefangen, weil alle vorhandenen nur den Statuscode und
  // die Listenform pruefen — der Inhalt der Eintraege war nie Gegenstand.
  it("die Details eines Eintrags kommen als Objekt zurueck, nicht als leere Klammer", async () => {
    const { getDb } = await import("../src/db/client.js");
    const { logEvent } = await import("../src/data/db-audit.js");

    const marke = `audit-detail-${Date.now()}`;
    await logEvent({
      event: "user.update",
      actorUserId: fx.admin.id,
      actorUsername: fx.admin.username,
      actorRole: "admin",
      targetLabel: marke,
      details: { feld: "role", von: "user", nach: "admin", tief: { n: 1 } },
    });

    // In der Spalte muss ein Objekt stehen — nicht eine Zeichenkette, die
    // zufaellig wie eines aussieht.
    const [roh] = await getDb()`
      SELECT jsonb_typeof(details) AS typ FROM audit_log WHERE target_label = ${marke} LIMIT 1`;
    expect(roh?.typ, "details ist doppelt kodiert").toBe("object");

    // Und ueber die Route muss der Inhalt ankommen.
    const res = await get(`/api/admin/audit?limit=50`, fx.admin.token);
    expect(res.status).toBe(200);
    const eintraege = (await res.json()) as { targetLabel: string | null; details: Record<string, unknown> }[];
    const meiner = eintraege.find((e) => e.targetLabel === marke);
    expect(meiner, "Eintrag nicht in der Liste").toBeTruthy();
    expect(meiner?.details.feld).toBe("role");
    expect(meiner?.details.nach).toBe("admin");
    expect((meiner?.details.tief as { n: number }).n).toBe(1);

    await getDb()`DELETE FROM audit_log WHERE target_label = ${marke}`;
  });

  it("Eintraege aus der Zeit vor dem Fix bleiben lesbar", async () => {
    // Der Altbestand ist doppelt kodiert und laesst sich nicht ruecknahmslos
    // migrieren (2839 Zeilen, forward-only). `alsDetails()` faengt die
    // Zeichenkette ab — ohne diesen Zweig blieben genau die Eintraege leer,
    // die man im Nachhinein liest.
    const { getDb } = await import("../src/db/client.js");
    const marke = `audit-altbestand-${Date.now()}`;
    // Genau die alte Schreibform — postgres.js kodiert die Zeichenkette selbst
    // noch einmal, und das ergibt den Altbestand. Ein zweites `JSON.stringify`
    // hier wäre dreifach kodiert und beschriebe nichts, was je in der
    // Datenbank stand.
    await getDb()`
      INSERT INTO audit_log (actor_user_id, actor_username, actor_role, event, target_label, details)
      VALUES (${fx.admin.id}, ${fx.admin.username}, 'admin', 'login.fail', ${marke},
              ${JSON.stringify({ reason: "bad-password" })}::jsonb)`;

    const res = await get(`/api/admin/audit?limit=50`, fx.admin.token);
    const eintraege = (await res.json()) as { targetLabel: string | null; details: Record<string, unknown> }[];
    expect(eintraege.find((e) => e.targetLabel === marke)?.details.reason).toBe("bad-password");

    await getDb()`DELETE FROM audit_log WHERE target_label = ${marke}`;
  });
});
