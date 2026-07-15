// ============================================================
// PATIO — Upload-Dateivalidierung (Extension + Magic Bytes) — SEC-3b
// ============================================================
// Zwei Schranken gegen getarnte Uploads:
//   1. Extension-Whitelist (Grobfilter).
//   2. Magic-Byte-Pruefung via file-type: der aus dem Inhalt erkannte
//      Binaertyp muss zur behaupteten Endung passen.
//
// Text-Formate (txt/md/csv/json/xml) haben KEINE verlaesslichen Magic
// Bytes — file-type liefert dafuer `undefined`. Diese werden anhand der
// Endung erlaubt (kein Fehlalarm). Eine *binaere* Endung OHNE passende
// Signatur (z.B. HTML/SVG als .png getarnt) wird abgelehnt; ebenso eine
// Text-Endung, hinter der eine Binaersignatur steckt (z.B. PDF als .txt).
// ============================================================

import { fileTypeFromBuffer } from "file-type";

export const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "txt",
  "md",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "zip",
  "json",
  "xml",
]);

/** Endungen ohne verlaessliche Magic Bytes. file-type erkennt diese
 *  Text-Formate nicht — sie werden allein anhand der Endung akzeptiert. */
const MAGICLESS_EXTENSIONS = new Set(["txt", "md", "csv", "json", "xml"]);

/** Erlaubte Endung → akzeptable von file-type erkannte `ext`-Werte.
 *  OOXML (docx/xlsx) sind ZIP-Container, alte MS-Office-Formate (doc/xls)
 *  sind CFB (Compound File Binary). file-type meldet je nach Inhalt das
 *  spezifische Format ODER den generischen Container — beides akzeptieren. */
const MAGIC_BYTE_TYPES: Record<string, string[]> = {
  pdf: ["pdf"],
  png: ["png"],
  jpg: ["jpg"],
  jpeg: ["jpg"],
  gif: ["gif"],
  webp: ["webp"],
  zip: ["zip"],
  docx: ["docx", "zip", "cfb"],
  doc: ["doc", "cfb"],
  xlsx: ["xlsx", "zip", "cfb"],
  xls: ["xls", "cfb"],
};

export function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isAllowedExtension(filename: string): boolean {
  return ALLOWED_EXTENSIONS.has(extensionOf(filename));
}

export type UploadCheck = { ok: true } | { ok: false; reason: "extension" | "content-mismatch" };

/** Prueft Endung UND Magic Bytes. `buffer` = vollstaendiger Datei-Inhalt. */
export async function validateUpload(buffer: Uint8Array, filename: string): Promise<UploadCheck> {
  const ext = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.has(ext)) return { ok: false, reason: "extension" };

  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    // Keine Magic Bytes: nur fuer Text-Formate ok. Eine binaere Endung
    // ohne Signatur ist getarnt (z.B. HTML als .png).
    return MAGICLESS_EXTENSIONS.has(ext) ? { ok: true } : { ok: false, reason: "content-mismatch" };
  }

  // Magic Bytes erkannt: muessen zur Endung passen. Steht hinter einer
  // Text-Endung eine Binaersignatur (kein Eintrag in MAGIC_BYTE_TYPES),
  // ist das ebenfalls ein Mismatch.
  const acceptable = MAGIC_BYTE_TYPES[ext];
  if (!acceptable || !acceptable.includes(detected.ext)) {
    return { ok: false, reason: "content-mismatch" };
  }
  return { ok: true };
}
