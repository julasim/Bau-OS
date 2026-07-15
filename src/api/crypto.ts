// ============================================================
// PATIO — Symmetrische Verschluesselung (SEC-4)
// ============================================================
// AES-256-GCM fuer Felder, die in der DB liegen, aber niemand aus einem Backup
// direkt lesen koennen soll — Telegram-Bot-Tokens, TOTP-Secrets, Microsoft-
// OAuth-Tokens.
//
// Format: "enc:v1:<iv-base64>:<ciphertext-base64>:<authTag-base64>"
//   - "enc:" prefix erlaubt Co-Existenz mit (Legacy-)Plaintext.
//   - "v1" reserviert Platz fuer spaetere Format-Wechsel.
//
// SEC-4: Der Verschluesselungs-Key wird aus ENCRYPTION_KEY abgeleitet, getrennt
// vom JWT_SECRET (Token-Signierung). Damit reisst eine JWT_SECRET-Rotation die
// verschluesselten Felder NICHT mehr mit.
//
// Migration (zweistufig, siehe docs/sec-4-crypto-migration.md):
//   - encryptString nutzt IMMER den Primaerschluessel (ENCRYPTION_KEY, sonst —
//     solange keiner gesetzt ist — JWT_SECRET als Rueckfall).
//   - decryptString probiert erst den Primaerschluessel, dann JWT_SECRET. So
//     bleiben mit dem alten Key verschluesselte Bestandsdaten lesbar, bis
//     scripts/reencrypt.ts sie auf den Primaerschluessel umgeschluesselt hat.
//   - Der Legacy-Plaintext-Durchgriff (Werte ohne enc-Prefix) bleibt in dieser
//     Stufe erhalten und faellt in Stufe 2 (nach dem Re-Encrypt) weg.
// ============================================================

import crypto from "crypto";
import { JWT_SECRET, ENCRYPTION_KEY } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

/** Primaerschluessel: bevorzugt der dedizierte ENCRYPTION_KEY. Solange keiner
 *  gesetzt ist, JWT_SECRET (Rueckwaertskompat waehrend der Migration). */
const PRIMARY_SECRET = ENCRYPTION_KEY || JWT_SECRET;
/** Ob ein separater Fallback-Schluessel existiert (nur waehrend der Migration,
 *  wenn ENCRYPTION_KEY gesetzt und != JWT_SECRET ist). */
const HAS_FALLBACK = PRIMARY_SECRET !== JWT_SECRET && JWT_SECRET.length > 0;

/** Leitet einen 32-Byte-Key aus einem Secret ab. */
function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptWith(secret: string, plain: string): string {
  const iv = crypto.randomBytes(12); // GCM-Standard: 96 Bit IV
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${ciphertext.toString("base64")}:${authTag.toString("base64")}`;
}

/** Versucht, ein enc-Tripel mit einem bestimmten Secret zu entschluesseln.
 *  Liefert null bei falschem Key / beschaedigten Daten / Manipulation. */
function tryDecryptWith(secret: string, ivB64: string, ctB64: string, tagB64: string): string | null {
  try {
    const iv = Buffer.from(ivB64, "base64");
    const ct = Buffer.from(ctB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
}

/** Zerlegt einen enc-Wert in sein iv/ct/tag-Tripel; null wenn kein/kaputtes
 *  enc-Format. */
function parseEnc(stored: string): [string, string, string] | null {
  if (!stored.startsWith(PREFIX)) return null;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  return [parts[0]!, parts[1]!, parts[2]!];
}

/** Verschluesselt einen String mit dem Primaerschluessel. Bereits
 *  verschluesselte Werte werden unveraendert zurueckgegeben (idempotent). */
export function encryptString(plain: string | null | undefined): string | null {
  if (!plain) return null;
  if (plain.startsWith(PREFIX)) return plain; // schon verschluesselt
  return encryptWith(PRIMARY_SECRET, plain);
}

/** Entschluesselt. Probiert Primaerschluessel, dann (waehrend der Migration)
 *  JWT_SECRET. Werte ohne enc-Prefix werden als Legacy-Plaintext
 *  zurueckgegeben. Bei nicht entschluesselbaren enc-Werten: null. */
export function decryptString(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const tripel = parseEnc(stored);
  if (!tripel) return stored; // Legacy-Plaintext (faellt in Stufe 2 weg)
  const [ivB64, ctB64, tagB64] = tripel;
  const primary = tryDecryptWith(PRIMARY_SECRET, ivB64, ctB64, tagB64);
  if (primary !== null) return primary;
  if (HAS_FALLBACK) {
    const legacy = tryDecryptWith(JWT_SECRET, ivB64, ctB64, tagB64);
    if (legacy !== null) return legacy;
  }
  return null;
}

/** true, wenn ein gespeicherter Wert (noch) NICHT mit dem Primaerschluessel
 *  verschluesselt ist und daher vom Re-Encrypt-Skript umgeschluesselt werden
 *  muss: Legacy-Plaintext oder ein enc-Wert, den nur der Fallback-Schluessel
 *  oeffnet. Bereits mit dem Primaerschluessel verschluesselte Werte -> false. */
export function needsReencrypt(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const tripel = parseEnc(stored);
  if (!tripel) return true; // Legacy-Plaintext -> soll verschluesselt werden
  const [ivB64, ctB64, tagB64] = tripel;
  return tryDecryptWith(PRIMARY_SECRET, ivB64, ctB64, tagB64) === null;
}
