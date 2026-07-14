import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  buildOtpAuthUri,
  verifyToken,
  generateBackupCodes,
} from "../src/api/totp.js";

describe("TOTP", () => {
  describe("Base32", () => {
    it("encodet und decodet roundtrip", () => {
      const buf = Buffer.from("Hello World", "utf8");
      const encoded = base32Encode(buf);
      expect(encoded).toMatch(/^[A-Z2-7]+$/);
      const decoded = base32Decode(encoded);
      expect(decoded.toString("utf8")).toBe("Hello World");
    });

    it("ignoriert Padding und Whitespace beim Decoden", () => {
      const original = base32Encode(Buffer.from("test", "utf8"));
      const messy = ` ${original.toLowerCase()}== `;
      expect(base32Decode(messy).toString("utf8")).toBe("test");
    });

    it("verwirft ungueltige Zeichen", () => {
      expect(() => base32Decode("ABC1!")).toThrow();
    });
  });

  describe("generateSecret", () => {
    it("liefert 32-Zeichen Base32-Secret (20 Bytes)", () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    });

    it("generiert jedes Mal einen neuen Secret", () => {
      const a = generateSecret();
      const b = generateSecret();
      expect(a).not.toBe(b);
    });
  });

  describe("buildOtpAuthUri", () => {
    it("baut otpauth-URI mit allen Pflicht-Parametern", () => {
      const uri = buildOtpAuthUri("ABCDEFGHIJ234567", "julius", "PATIO");
      expect(uri).toMatch(/^otpauth:\/\/totp\/PATIO:julius\?/);
      expect(uri).toContain("secret=ABCDEFGHIJ234567");
      expect(uri).toContain("issuer=PATIO");
      expect(uri).toContain("algorithm=SHA1");
      expect(uri).toContain("digits=6");
      expect(uri).toContain("period=30");
    });

    it("encodet Sonderzeichen im Account-Namen", () => {
      const uri = buildOtpAuthUri("AAAA", "julius@sima.or.at", "PATIO");
      expect(uri).toContain("julius%40sima.or.at");
    });
  });

  describe("verifyToken", () => {
    // Wir generieren einen Token "von Hand" mit derselben Logik wie die Lib
    // — das prueft dass der Verifier intern die gleiche Berechnung macht.
    function expectedToken(secret: string): string {
      const secretBuf = base32Decode(secret);
      const step = Math.floor(Date.now() / 1000 / 30);
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(step), 0);
      const hmac = crypto.createHmac("sha1", secretBuf).update(counter).digest();
      const offset = hmac[hmac.length - 1]! & 0x0f;
      const code =
        ((hmac[offset]! & 0x7f) << 24) |
        ((hmac[offset + 1]! & 0xff) << 16) |
        ((hmac[offset + 2]! & 0xff) << 8) |
        (hmac[offset + 3]! & 0xff);
      return String(code % 1_000_000).padStart(6, "0");
    }

    it("akzeptiert den aktuellen Token", () => {
      const secret = generateSecret();
      const token = expectedToken(secret);
      expect(verifyToken(secret, token)).toBe(true);
    });

    it("akzeptiert Whitespace im Token", () => {
      const secret = generateSecret();
      const token = expectedToken(secret);
      expect(verifyToken(secret, ` ${token} `)).toBe(true);
    });

    it("lehnt einen Token mit falscher Stellenzahl ab", () => {
      const secret = generateSecret();
      expect(verifyToken(secret, "12345")).toBe(false);
      expect(verifyToken(secret, "1234567")).toBe(false);
      expect(verifyToken(secret, "abcdef")).toBe(false);
    });

    it("lehnt einen falschen Token ab", () => {
      const secret = generateSecret();
      expect(verifyToken(secret, "000000")).toBe(false);
    });

    it("lehnt Token gegen ungueltigen Secret ab", () => {
      // Defekter Base32-Secret — verifyToken faengt das ab und liefert false.
      expect(verifyToken("not-base-32!!!", "123456")).toBe(false);
    });
  });

  describe("generateBackupCodes", () => {
    it("liefert 10 Codes per default", () => {
      const codes = generateBackupCodes();
      expect(codes).toHaveLength(10);
    });

    it("benutzt das 4-4-4 hex Format", () => {
      const codes = generateBackupCodes(3);
      for (const c of codes) {
        expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
      }
    });

    it("alle Codes sind eindeutig", () => {
      const codes = generateBackupCodes(20);
      expect(new Set(codes).size).toBe(20);
    });
  });
});
