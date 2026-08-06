import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Die Konten aus `data/users.json` waren der letzte einstufige Anmeldeweg.
//
// Warum ihr Ausbau sicher ist — und nicht nur „vermutlich": `src/index.ts`
// ruft beim Start `importLegacyJsonUsers()`. Jedes JSON-Konto liegt zu dem
// Zeitpunkt, an dem der Dienst die erste Anfrage annimmt, bereits in der
// Datenbank, mit demselben bcrypt-Hash. Der Rückfall auf JSON war damit nicht
// ein Sicherheitsnetz, sondern ein zweiter Weg zum selben Konto — einer, der
// die Rechte umging: eine JSON-Anmeldung hatte keine UUID, und ohne die
// liefert `getVisibleProjectIds()` für Nicht-Admins eine leere Liste.
//
// Dieser Test legt eine echte `data/users.json` an und beweist, dass sie beim
// Anmelden keine Rolle mehr spielt.
describe.skipIf(!HAS_DB)("Anmeldung geht nur noch gegen die Datenbank", () => {
  let fx: AclFixture;
  const datei = path.join(process.cwd(), "data", "users.json");
  let vorhandenerInhalt: string | null = null;

  beforeAll(async () => {
    fx = await setupAclFixture("json");

    // Ein bestehendes users.json nicht zerstören — der Test läuft auch auf
    // einem Rechner, auf dem eines liegt.
    if (fs.existsSync(datei)) vorhandenerInhalt = fs.readFileSync(datei, "utf-8");
    fs.mkdirSync(path.dirname(datei), { recursive: true });

    // Hash von "json-passwort-123", mit denselben bcrypt-Kosten erzeugt wie
    // im Programm — sonst prüfte der Test gegen einen Hash, den niemand
    // akzeptieren würde, und wäre aus dem falschen Grund grün.
    const { hashPassword } = await import("../src/api/auth.js");
    const hash = await hashPassword("json-passwort-123");
    fs.writeFileSync(
      datei,
      JSON.stringify(
        [
          {
            username: "json-altkonto",
            passwordHash: hash,
            role: "admin",
            createdAt: new Date().toISOString(),
            settings: {},
          },
        ],
        null,
        2,
      ),
    );
  });

  afterAll(async () => {
    if (HAS_DB) await fx.cleanup();
    if (vorhandenerInhalt !== null) fs.writeFileSync(datei, vorhandenerInhalt);
    else if (fs.existsSync(datei)) fs.unlinkSync(datei);
  });

  it("ein Konto, das es NUR in users.json gibt, kommt nicht mehr hinein", async () => {
    const res = await fx.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "json-altkonto", password: "json-passwort-123" }),
    });
    expect(res.status).toBe(401);
  });

  it("die Anmeldung an einem Datenbank-Konto funktioniert unverändert", async () => {
    // Die Gegenrichtung: sonst bewiese der Test oben nur, dass die Anmeldung
    // kaputt ist.
    const angelegt = await fx.app.request("/api/admin/users", {
      method: "POST",
      headers: jsonHeader(fx.admin.token),
      body: JSON.stringify({
        username: `json-dbkonto-${Date.now()}`,
        password: "db-passwort-1234",
        role: "user",
      }),
    });
    expect(angelegt.status).toBe(201);
    const neu = (await angelegt.json()) as { id: string; username: string };

    const res = await fx.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: neu.username, password: "db-passwort-1234" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token: string }).token).toBeTruthy();

    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM users WHERE id = ${neu.id}`;
  });

  it("der Übernahme-Lauf zieht JSON-Konten weiterhin in die Datenbank", async () => {
    // Der Ausbau des Anmeldewegs darf den MIGRATIONSWEG nicht mitnehmen —
    // sonst käme jemand, der von einer alten Installation kommt, gar nicht
    // mehr hinein.
    const { importLegacyJsonUsers, findDbUserByUsername } = await import("../src/api/auth.js");
    const ergebnis = await importLegacyJsonUsers();
    expect(ergebnis.imported + ergebnis.skipped).toBeGreaterThan(0);

    const uebernommen = await findDbUserByUsername("json-altkonto");
    expect(uebernommen).toBeTruthy();

    // Und danach geht die Anmeldung — über die Datenbank.
    const res = await fx.app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "json-altkonto", password: "json-passwort-123" }),
    });
    expect(res.status).toBe(200);

    const { getDb } = await import("../src/db/client.js");
    await getDb()`DELETE FROM users WHERE username = 'json-altkonto'`;
  });

  it("ein gültiges Token ohne Konto führt zu 401, nicht zu einer halben Sitzung", async () => {
    // Wird ein Konto gelöscht, während jemand angemeldet ist, gab es früher
    // einen Rückfall auf den JSON-Eintrag. Jetzt endet die Sitzung sauber.
    const { createToken } = await import("../src/api/auth.js");
    const token = createToken("gibt-es-nicht", "user", undefined);

    const me = await fx.app.request("/api/auth/me", { headers: authHeader(token) });
    expect(me.status).toBe(401);

    const settings = await fx.app.request("/api/settings", { headers: authHeader(token) });
    expect(settings.status).toBe(401);
  });
});
