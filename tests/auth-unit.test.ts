import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";

const TEST_SECRET = "test-secret-fuer-unit-tests-mindestens-32-zeichen-lang";

beforeAll(() => {
  // JWT_SECRET muss gesetzt sein, bevor src/config.js (via auth.js) lädt —
  // der Wert wird dort auf Modul-Ebene aus process.env gelesen.
  process.env.JWT_SECRET = TEST_SECRET;
  // Kein DATABASE_URL — auth.js bleibt im FS-Modus, keine DB-Verbindung.
  delete process.env.DATABASE_URL;
});

describe("createToken", () => {
  it("erzeugt einen gültigen JWT-String", async () => {
    const { createToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "admin");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("Payload enthält username und role", async () => {
    const { createToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "admin");
    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    expect(decoded.username).toBe("julius");
    expect(decoded.role).toBe("admin");
  });

  it("Payload enthält sub wenn id übergeben wird", async () => {
    const { createToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "user", "uuid-1234");
    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe("uuid-1234");
  });

  it("ohne id ist sub nicht gesetzt", async () => {
    const { createToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "user");
    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBeUndefined();
  });

  it("Token kann mit jsonwebtoken direkt dekodiert werden", async () => {
    const { createToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "admin");
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded).not.toBeNull();
    expect(decoded.username).toBe("julius");
  });
});

describe("verifyToken — Valide Tokens", () => {
  it("eigener Token aus createToken() wird akzeptiert", async () => {
    const { createToken, verifyToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "admin");
    expect(() => verifyToken(token)).not.toThrow();
  });

  it("username und role sind korrekt im Payload", async () => {
    const { createToken, verifyToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "admin");
    const payload = verifyToken(token);
    expect(payload.username).toBe("julius");
    expect(payload.role).toBe("admin");
  });

  it("sub ist korrekt wenn id gesetzt wurde", async () => {
    const { createToken, verifyToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "user", "uuid-abcd");
    const payload = verifyToken(token);
    expect(payload.sub).toBe("uuid-abcd");
  });
});

describe("verifyToken — Algorithmus-Whitelist", () => {
  it("akzeptiert HS256-Token (Standard)", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    const hs256Token = jwt.sign({ username: "test", role: "user" }, TEST_SECRET, {
      algorithm: "HS256",
    });
    expect(() => verifyToken(hs256Token)).not.toThrow();
  });

  it("lehnt 'none'-Algorithmus ab", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    // Manuell einen 'none'-Token bauen (keine Signatur)
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ username: "hacker", role: "admin" })).toString("base64url");
    const noneToken = `${header}.${payload}.`;
    expect(() => verifyToken(noneToken)).toThrow();
  });

  it("lehnt HS512-Token ab", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    const hs512Token = jwt.sign({ username: "test", role: "user" }, TEST_SECRET, {
      algorithm: "HS512",
    });
    expect(() => verifyToken(hs512Token)).toThrow();
  });
});

describe("verifyToken — Audience-Whitelist", () => {
  it("Token ohne audience wird akzeptiert", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    const token = jwt.sign({ username: "test", role: "user" }, TEST_SECRET, {
      algorithm: "HS256",
    });
    expect(() => verifyToken(token)).not.toThrow();
  });

  it("lehnt Token mit audience-Claim ab", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    const tokenWithAud = jwt.sign({ username: "test", role: "user" }, TEST_SECRET, {
      algorithm: "HS256",
      audience: "bau-os",
    });
    expect(() => verifyToken(tokenWithAud)).toThrow();
  });
});

describe("verifyToken — Ablauf", () => {
  it("lehnt abgelaufenen Token ab", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    const expired = jwt.sign({ username: "x", role: "user" }, TEST_SECRET, {
      algorithm: "HS256",
      expiresIn: -1, // bereits abgelaufen
    });
    expect(() => verifyToken(expired)).toThrow();
  });
});

describe("verifyToken — Tampered Tokens", () => {
  it("lehnt Token mit falscher Signatur ab", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    const foreignToken = jwt.sign({ username: "test", role: "user" }, "ein-voellig-anderes-secret", {
      algorithm: "HS256",
    });
    expect(() => verifyToken(foreignToken)).toThrow();
  });

  it("lehnt einen Token mit manipuliertem Payload ab", async () => {
    const { createToken, verifyToken } = await import("../src/api/auth.js");
    const token = createToken("julius", "user");
    const parts = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ username: "julius", role: "admin" })).toString("base64url");
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(() => verifyToken(tampered)).toThrow();
  });

  it("lehnt einen komplett ungültigen String ab", async () => {
    const { verifyToken } = await import("../src/api/auth.js");
    expect(() => verifyToken("kein-gueltiges-token")).toThrow();
    expect(() => verifyToken("")).toThrow();
  });
});
