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
// ── Stufe 2 ist abgeschlossen (23.08.2026) ─────────────────────────────────
//
// Die Migration war zweistufig angelegt (docs/sec-4-crypto-migration.md).
// Stufe 1 liess zwei Dinge zu, damit Bestandsdaten waehrend der Umstellung
// lesbar blieben:
//
//   * einen Rueckfall auf JWT_SECRET beim Entschluesseln, und
//   * einen Durchgriff fuer Werte OHNE `enc:`-Prefix, die als Klartext
//     zurueckgegeben wurden.
//
// Beides ist jetzt weg. Der Zeitpunkt war der richtige: nachgemessen am
// 23.08.2026 traegt KEINE Zeile ein verschluesseltes Feld (73 Konten, 0
// TOTP-Geheimnisse) — es gab nichts umzuschluesseln, und spaeter waere es
// teurer geworden.
//
// Was der Durchgriff bedeutet hat: ein Wert ohne Prefix in einer
// verschluesselten Spalte kam ungeprueft als Klartext heraus. Beim einzigen
// Feld, das die Spalte je traegt, ist das ein TOTP-Geheimnis — dort ist
// „irgendwas kam durch" die schlechteste denkbare Antwort. Jetzt: `null`, und
// eine Zeile im Log.
// ============================================================

import crypto from "crypto";
import { JWT_SECRET, ENCRYPTION_KEY } from "../config.js";
import { logWarn } from "../logger.js";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";

/**
 * Der Schluessel. Ohne `ENCRYPTION_KEY` faellt er auf `JWT_SECRET` zurueck —
 * das ist ein START-Rueckfall, kein zweiter Schluessel: entschluesselt wird
 * ausschliesslich damit, was damit verschluesselt wurde.
 *
 * Der Rueckfall bleibt, damit ein Dienst ohne `ENCRYPTION_KEY` startet (er
 * verschluesselt heute nichts). Er ist aber der Grund, warum SEC-4 ueberhaupt
 * gebaut wurde: eine Rotation des JWT_SECRET wuerde dann alle
 * verschluesselten Felder mitreissen. Deshalb warnt `encryptString` beim
 * ersten Schreiben.
 */
const PRIMARY_SECRET = ENCRYPTION_KEY || JWT_SECRET;
const OHNE_EIGENEN_SCHLUESSEL = !ENCRYPTION_KEY;

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
  if (OHNE_EIGENEN_SCHLUESSEL) {
    // Einmal je Vorgang, nicht als Abbruch: das Feld zu verlieren waere
    // schlimmer als es mit dem falschen Schluessel zu schuetzen. Aber wer das
    // Log liest, soll es sehen, BEVOR das JWT_SECRET rotiert wird.
    logWarn(
      "[Crypto] ENCRYPTION_KEY ist nicht gesetzt — verschluesselt wird mit JWT_SECRET. " +
        "Eine Rotation des JWT_SECRET macht diese Felder unlesbar. Siehe docs/sec-4-crypto-migration.",
    );
  }
  return encryptWith(PRIMARY_SECRET, plain);
}

/**
 * Entschluesselt — oder liefert `null`.
 *
 * `null` heisst genau eine Sache: der Wert ist mit DIESEM Schluessel nicht
 * lesbar. Er kann mit einem anderen verschluesselt worden sein, beschaedigt
 * sein, oder gar nicht verschluesselt.
 *
 * ── Warum ein Wert ohne `enc:`-Prefix jetzt null ergibt ────────────────────
 *
 * Bis Stufe 2 kam er als Klartext zurueck (Durchgriff fuer Bestandsdaten).
 * Das einzige Feld, das diese Spalte je traegt, ist ein TOTP-Geheimnis — dort
 * ist „irgendwas kam durch" die schlechteste denkbare Antwort: es waere ein
 * Zweitfaktor, den jeder mit Datenbankzugriff lesen kann, und niemand wuerde
 * es merken.
 */
export function decryptString(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const tripel = parseEnc(stored);
  if (!tripel) {
    logWarn("[Crypto] Wert ohne enc-Prefix in einem verschluesselten Feld — wird verworfen.");
    return null;
  }
  const [ivB64, ctB64, tagB64] = tripel;
  return tryDecryptWith(PRIMARY_SECRET, ivB64, ctB64, tagB64);
}

/** true, wenn ein gespeicherter Wert mit dem aktuellen Schluessel NICHT
 *  lesbar ist und darum umgeschluesselt (oder verworfen) werden muss.
 *  Bereits richtig verschluesselte Werte -> false. */
export function needsReencrypt(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const tripel = parseEnc(stored);
  if (!tripel) return true; // Legacy-Plaintext -> soll verschluesselt werden
  const [ivB64, ctB64, tagB64] = tripel;
  return tryDecryptWith(PRIMARY_SECRET, ivB64, ctB64, tagB64) === null;
}
