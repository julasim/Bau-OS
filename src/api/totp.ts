// ============================================================
// PATIO — TOTP (RFC 6238) ohne externe Dependency
// ============================================================
// Eigene Implementierung statt einer der grossen TOTP-Bibliotheken,
// weil die Spec klein ist und wir keine zusaetzliche Supply-Chain-
// Risiken in den Auth-Pfad einkaufen wollen.
//
// Algorithmus:
//   1. T = floor(unixTime / 30)        — Time-Step (default 30s)
//   2. HMAC-SHA1(secret, T as 8-byte BE) → 20-byte HMAC
//   3. Dynamic-Truncation: offset = HMAC[19] & 0x0f
//      4-byte Slice ab offset, MSB clear → 31-bit-Integer
//      modulo 10^digits = das angezeigte 6-stellige Token
//
// Verifikation laeuft mit Window=1: aktueller Step plus +/-1, weil
// Client-Uhren oft ein paar Sekunden driften. RFC empfiehlt das.
//
// Compatible mit Google Authenticator, Aegis, 1Password, Bitwarden,
// Microsoft Authenticator. Alle benutzen die gleiche Spec.
// ============================================================

import crypto from "crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALGO = "sha1";

// ── Base32 (RFC 4648, kein Padding) ─────────────────────────────────────────
// Authenticator-Apps erwarten den Secret in Base32.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(str: string): Buffer {
  // Padding und Whitespace ignorieren, damit User-Eingaben mit "= " etc.
  // beim Setup auch funktionieren — der Secret kommt nur von uns, aber
  // robuster ist robuster.
  const clean = str.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Ungueltiges Base32-Zeichen: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── Secret-Generierung ──────────────────────────────────────────────────────

/** Liefert einen frischen Base32-Secret. 20 Bytes = 160 Bit, RFC-Empfehlung. */
export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

// ── Provisioning-URI ────────────────────────────────────────────────────────

/** Baut otpauth://totp/...-URI fuer QR-Code-Anzeige in Authenticator-Apps.
 *  Beispiel: otpauth://totp/PATIO:julius?secret=ABC...&issuer=PATIO */
export function buildOtpAuthUri(secret: string, account: string, issuer = "PATIO"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Token-Berechnung ────────────────────────────────────────────────────────

function computeToken(secret: Buffer, step: number): string {
  // 8-Byte Big-Endian Counter. JS Number reicht fuer Steps bis ~Jahr 6635.
  const counter = Buffer.alloc(8);
  // Wir benutzen BigInt um den hohen Bits-Bereich sauber zu behandeln,
  // auch wenn der reale Wert immer in 32 Bit passt.
  const big = BigInt(step);
  counter.writeBigUInt64BE(big, 0);

  const hmac = crypto.createHmac(ALGO, secret).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Verifiziert ein User-Token gegen den gespeicherten Secret.
 *  Toleriert +/- window Steps (Default 1 = +/-30s). Konstantzeit-Vergleich
 *  schuetzt vor Timing-Attacks. */
export function verifyToken(secret: string, token: string, window = 1): boolean {
  const cleanToken = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleanToken)) return false;

  let secretBuf: Buffer;
  try {
    secretBuf = base32Decode(secret);
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    const expected = computeToken(secretBuf, now + i);
    // Konstantzeit-Vergleich. token-Length vorab gepruefte 6.
    if (crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(cleanToken, "utf8"))) {
      return true;
    }
  }
  return false;
}

// ── Backup-Codes ────────────────────────────────────────────────────────────

/** Generiert N einmalig nutzbare Recovery-Codes. Format: 4-4-4 hex
 *  (z.B. "a3f2-9b1c-7e8d") — gut lesbar, einfach abzutippen. */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(6).toString("hex"); // 12 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}
