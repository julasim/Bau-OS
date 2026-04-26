// ============================================================
// Bau-OS — Symmetrische Verschluesselung (Phase 6 Cleanup)
// ============================================================
// AES-256-GCM, Key abgeleitet aus JWT_SECRET via SHA-256. Verwendet fuer
// Felder, die in der DB liegen aber niemand aus einem Backup direkt lesen
// koennen sollte — primaer Telegram-Bot-Tokens.
//
// Format: "enc:v1:<iv-base64>:<ciphertext-base64>:<authTag-base64>"
//   - "enc:" prefix erlaubt Co-Existenz mit Plaintext (Migration ohne
//     Big-Bang). Plaintext-Werte werden bei der naechsten Schreibung
//     transparent verschluesselt.
//   - "v1" reserviert Platz fuer spaetere Format-Wechsel.
//
// JWT_SECRET-Wechsel = alte Tokens unlesbar. Das ist OK, weil Bot-Tokens
// zur Not vom User neu eingetragen werden koennen — anders als Passwoerter,
// die wir mit bcrypt rotation-frei haben.
// ============================================================

import crypto from "crypto";
import { JWT_SECRET } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

/** Leitet einen 32-Byte-Key aus JWT_SECRET ab. */
function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(JWT_SECRET).digest();
}

/** Verschluesselt einen String. Wenn der Input bereits verschluesselt
 *  aussieht, wird er unveraendert zurueckgegeben (idempotent). */
export function encryptString(plain: string | null | undefined): string | null {
  if (!plain) return null;
  if (plain.startsWith(PREFIX)) return plain; // schon verschluesselt
  const iv = crypto.randomBytes(12); // GCM-Standard: 96 Bit IV
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${ciphertext.toString("base64")}:${authTag.toString("base64")}`;
}

/** Entschluesselt. Wenn der Input keinen enc-Prefix hat, wird er als
 *  Plaintext (Legacy) zurueckgegeben — Migration ohne Code-Sprung. */
export function decryptString(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored; // Legacy-Plaintext
  try {
    const parts = stored.slice(PREFIX.length).split(":");
    if (parts.length !== 3) return null;
    const [ivB64, ctB64, tagB64] = parts;
    const iv = Buffer.from(ivB64!, "base64");
    const ct = Buffer.from(ctB64!, "base64");
    const tag = Buffer.from(tagB64!, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    // Falscher Key, beschaedigte Daten oder Manipulation — kein Crash,
    // aber null zurueck. Caller behandelt das wie "kein Token".
    return null;
  }
}
