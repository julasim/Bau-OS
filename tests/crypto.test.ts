import { describe, it, expect } from "vitest";
import { encryptString, decryptString, needsReencrypt } from "../src/api/crypto.js";

// SEC-4: AES-256-GCM Feld-Verschluesselung. Diese Suite deckt die Kern-Logik
// mit dem Primaerschluessel ab (der dual-key-Fallback ist Migrations-Logik,
// per Code-Review + Re-Encrypt-Skript abgesichert).
describe("crypto (SEC-4)", () => {
  it("round-trip: encrypt -> decrypt ergibt den Klartext", () => {
    const plain = "geheim-bot-token-123:ABC";
    const enc = encryptString(plain);
    expect(enc).not.toBeNull();
    expect(enc!.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain(plain); // Klartext taucht nicht auf
    expect(decryptString(enc)).toBe(plain);
  });

  it("null/leer bleibt null", () => {
    expect(encryptString(null)).toBeNull();
    expect(encryptString(undefined)).toBeNull();
    expect(encryptString("")).toBeNull();
    expect(decryptString(null)).toBeNull();
    expect(decryptString("")).toBeNull();
  });

  it("idempotent: bereits verschluesselte Werte werden nicht doppelt verschluesselt", () => {
    const enc = encryptString("x")!;
    expect(encryptString(enc)).toBe(enc);
  });

  it("ein Wert ohne enc-Prefix wird VERWORFEN, nicht durchgereicht", () => {
    // Bis Stufe 2 kam er als Klartext zurück (Durchgriff für Bestandsdaten).
    // Das einzige Feld, das diese Spalte je trägt, ist ein TOTP-Geheimnis —
    // dort ist „irgendwas kam durch" die schlechteste denkbare Antwort: ein
    // Zweitfaktor, den jeder mit Datenbankzugriff lesen kann, und niemand
    // merkt es.
    expect(decryptString("klartext-legacy")).toBeNull();
  });

  it("gleicher Klartext -> unterschiedliche Ciphertexts (frischer IV)", () => {
    expect(encryptString("gleich")).not.toBe(encryptString("gleich"));
  });

  it("manipulierter authTag -> null (GCM-Auth schlaegt an)", () => {
    const enc = encryptString("wichtig")!;
    const parts = enc.split(":");
    // Letztes Segment (authTag) durch einen falschen 16-Byte-Wert ersetzen.
    parts[parts.length - 1] = Buffer.alloc(16, 0).toString("base64");
    expect(decryptString(parts.join(":"))).toBeNull();
  });

  it("needsReencrypt: Plaintext -> true, frisch verschluesselt -> false", () => {
    expect(needsReencrypt("legacy-plaintext")).toBe(true);
    expect(needsReencrypt(encryptString("neu"))).toBe(false);
    expect(needsReencrypt(null)).toBe(false);
    expect(needsReencrypt("")).toBe(false);
  });
});
