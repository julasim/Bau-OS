import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import crypto from "node:crypto";
import { HAS_DB, setupAclFixture, authHeader, jsonHeader, type AclFixture } from "./helpers/acl-fixture.js";

// Der geparkte Zweitfaktor — der Nachweis, dass er REAKTIVIERBAR ist.
//
// ── Warum es diesen Test gibt ──────────────────────────────────────────────
//
// `src/api/routes/auth-2fa.ts` und `src/api/totp.ts` liegen seit dem Umbau zum
// Firmenserver unangetastet im Baum. Sie sind bewusst NICHT eingehängt
// (`server.ts` hat die Zeile auskommentiert): im Büronetz gibt es keinen Weg
// von aussen, und der E-Mail-Zweig, über den der zweite Faktor früher lief,
// ist ersatzlos entfallen. Zurück kommt er mit dem VPN.
//
// Geparkter Code hat aber eine Eigenschaft: er verrottet leise. Die Routen
// wurden seit dem 14.07. nicht mehr angefasst, während sich darunter Auth,
// Rollen, Rechte und die Verschlüsselung geändert haben. Wer sie eines Tages
// wieder einhängt, will nicht in diesem Moment herausfinden, dass sie nicht
// mehr zum Rest passen.
//
// Deshalb hängt dieser Test sie in EINER eigenen Hono-Instanz ein und fährt
// den ganzen Weg durch: einrichten → bestätigen → Status → abschalten. Am
// Produktivserver ändert das nichts.
describe.skipIf(!HAS_DB)("Zweitfaktor (geparkt für AP17) — bleibt reaktivierbar", () => {
  let fx: AclFixture;
  let app: Hono;
  let getDb: typeof import("../src/db/client.js").getDb;
  let base32Decode: (s: string) => Buffer;
  const PASSWORT = "ZweitfaktorTest2026!x";

  beforeAll(async () => {
    if (!HAS_DB) return;
    fx = await setupAclFixture("zfa");
    ({ getDb } = await import("../src/db/client.js"));
    ({ base32Decode } = await import("../src/api/totp.js"));

    const { auth2faRoutes } = await import("../src/api/routes/auth-2fa.js");
    const { authMiddleware } = await import("../src/api/auth.js");

    // Dieselbe Kette wie im Server: Anmeldung davor, dann die Routen.
    app = new Hono();
    app.use("/api/*", authMiddleware);
    app.route("/api", auth2faRoutes);

    // Das Konto braucht ein bekanntes Passwort — `disable` verlangt es.
    const bcrypt = (await import("bcrypt")).default;
    const hash = await bcrypt.hash(PASSWORT, 10);
    await getDb()`UPDATE users SET password_hash = ${hash} WHERE id = ${fx.a.id}::uuid`;
  });

  afterAll(async () => {
    if (!HAS_DB) return;
    await fx.cleanup();
  });

  /** Erzeugt den aktuellen Token — mit derselben Rechnung wie der Prüfer.
   *  `totp.ts` exportiert absichtlich keine Erzeugung: der Server prüft
   *  Tokens, er stellt keine aus. */
  function aktuellerToken(geheim: string): string {
    const buf = base32Decode(geheim);
    const step = Math.floor(Date.now() / 1000 / 30);
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step), 0);
    const hmac = crypto.createHmac("sha1", buf).update(counter).digest();
    const off = hmac[hmac.length - 1]! & 0x0f;
    const code =
      ((hmac[off]! & 0x7f) << 24) |
      ((hmac[off + 1]! & 0xff) << 16) |
      ((hmac[off + 2]! & 0xff) << 8) |
      (hmac[off + 3]! & 0xff);
    return String(code % 1_000_000).padStart(6, "0");
  }

  it("Status meldet: noch nicht eingerichtet", async () => {
    const res = await app.request("/api/auth/2fa/status", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { enabled: boolean }).enabled).toBe(false);
  });

  it("Einrichten liefert ein Geheimnis und eine otpauth-Adresse", async () => {
    const res = await app.request("/api/auth/2fa/setup", { method: "POST", headers: jsonHeader(fx.a.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string; otpauthUri: string };
    expect(body.secret).toMatch(/^[A-Z2-7]{16,}$/); // Base32
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });

  it("das Geheimnis liegt VERSCHLÜSSELT in der Datenbank", async () => {
    // Seit Stufe 2 der Krypto-Migration wird ein Wert ohne `enc:`-Prefix beim
    // Lesen verworfen. Stünde das Geheimnis im Klartext, wäre der Zweitfaktor
    // beim Reaktivieren sofort kaputt — und zwar still.
    const [z] = await getDb()`SELECT totp_secret_encrypted AS s FROM users WHERE id = ${fx.a.id}::uuid`;
    expect(String(z.s)).toMatch(/^enc:v1:/);
  });

  it("mit einem gültigen Token lässt sich der Zweitfaktor einschalten", async () => {
    const [z] = await getDb()`SELECT totp_secret_encrypted AS s FROM users WHERE id = ${fx.a.id}::uuid`;
    const { decryptString } = await import("../src/api/crypto.js");
    const geheim = decryptString(String(z.s));
    expect(geheim, "Geheimnis muss lesbar sein").toBeTruthy();

    const res = await app.request("/api/auth/2fa/verify", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ token: aktuellerToken(geheim!) }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { backupCodes: string[] };
    expect(body.backupCodes.length).toBeGreaterThan(0);

    const status = await app.request("/api/auth/2fa/status", { headers: authHeader(fx.a.token) });
    expect(((await status.json()) as { enabled: boolean }).enabled).toBe(true);
  });

  it("ein falsches Token wird abgelehnt", async () => {
    // Nach dem Einschalten antwortet `verify` mit 409 („bereits aktiv") —
    // vorher mit 400. Beides ist eine Ablehnung, und genau das prüft der Test:
    // ein Token, das nicht stimmt, schaltet nichts scharf.
    const res = await app.request("/api/auth/2fa/verify", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ token: "000000" }),
    });
    expect([400, 409]).toContain(res.status);
  });

  it("Abschalten verlangt Passwort UND Token", async () => {
    const [z] = await getDb()`SELECT totp_secret_encrypted AS s FROM users WHERE id = ${fx.a.id}::uuid`;
    const { decryptString } = await import("../src/api/crypto.js");
    const geheim = decryptString(String(z.s))!;

    // Ohne Passwort: abgelehnt.
    const ohne = await app.request("/api/auth/2fa/disable", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ token: aktuellerToken(geheim) }),
    });
    expect(ohne.status).toBeGreaterThanOrEqual(400);

    const mit = await app.request("/api/auth/2fa/disable", {
      method: "POST",
      headers: jsonHeader(fx.a.token),
      body: JSON.stringify({ password: PASSWORT, token: aktuellerToken(geheim) }),
    });
    expect(mit.status).toBe(200);

    const status = await app.request("/api/auth/2fa/status", { headers: authHeader(fx.a.token) });
    expect(((await status.json()) as { enabled: boolean }).enabled).toBe(false);
  });

  it("im laufenden Server sind die Routen weiterhin NICHT eingehängt", async () => {
    // Der Gegenbeweis: dieser Test darf nicht versehentlich dazu führen, dass
    // der Zweitfaktor scharf ist. Er kommt mit dem Zugang von aussen (AP17).
    const res = await fx.app.request("/api/auth/2fa/status", { headers: authHeader(fx.a.token) });
    expect(res.status).toBe(404);
  });
});
