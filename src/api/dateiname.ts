// ============================================================
// PATIO — Dateiname im Content-Disposition-Header
// ============================================================
//
// ── Warum es diese Datei gibt ───────────────────────────────────────────────
//
// In einem österreichischen Architekturbüro trägt fast jede zweite Datei einen
// Umlaut oder ein Leerzeichen: „Angebot Müller & Söhne.pdf", „SAZTG-2026-014
// Besprechungsprotokoll.docx". Der HTTP-Header darf aber nur ASCII enthalten.
//
// Bis hierher gab es dafür zehn Stellen mit drei verschiedenen Antworten:
//
//   * `filename="${encodeURIComponent(name)}"` (dreimal) — der falscheste Fall.
//     Ein Browser dekodiert innerhalb der Anführungszeichen NICHTS, der Nutzer
//     bekommt wörtlich `Angebot%20M%C3%BCller%20%26%20S%C3%B6hne.pdf` auf die
//     Platte. Ein einziges Leerzeichen genügt.
//   * `filename="${name.replace(/"/g, "")}"` (zweimal) — nur die
//     Anführungszeichen entfernt; Umlaute gehen roh in den Header.
//   * `filename="${name}"` (fünfmal) — gar nichts.
//
// Richtig ist der Weg, den RFC 5987 / RFC 6266 dafür vorsehen: ZWEI Angaben
// im selben Header. `filename=` trägt eine ASCII-Notlösung für alte Clients,
// `filename*=UTF-8''…` den echten Namen prozentkodiert. Jeder Browser der
// letzten fünfzehn Jahre nimmt den zweiten und ignoriert den ersten.
//
// Zehn Einzelkorrekturen hätten geheissen: die elfte Stelle macht es wieder
// falsch. Deshalb eine Funktion.
// ============================================================

/** Zeichen, die in einem HTTP-Header nichts zu suchen haben.
 *
 *  CR und LF sind der gefährliche Teil: Node wirft bei ihnen
 *  `ERR_INVALID_CHAR` und aus dem Download wird ein 500er. Ein Dateiname
 *  kommt bei Exporten aus Freitext (Projektname, Besprechungstitel) — das ist
 *  keine theoretische Sorge. */
// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/g;

/** Baut den ASCII-Notnamen für `filename=`.
 *
 *  Umlaute werden auf ihre Grundform gebracht (`ü` → `u`), alles übrige
 *  Nicht-ASCII auf einen Unterstrich. Anführungszeichen und Backslash müssen
 *  weg, sonst bricht der Wert aus seinen eigenen Anführungszeichen aus. */
export function asciiName(name: string): string {
  const ohne = name
    .normalize("NFD")
    // Kombinierende Akzente entfernen — aus „ü" (u + Umlautpunkte) wird „u".
    .replace(/[\u0300-\u036f]/g, "")
    // Die deutschen Sonderfälle, die NFD nicht auflöst.
    .replace(/ß/g, "ss")
    .replace(STEUERZEICHEN, "")
    .replace(/["\\]/g, "")
    // Alles, was danach noch kein ASCII ist.
    .replace(/[^\x20-\x7e]/g, "_")
    .trim();
  return ohne || "datei";
}

/**
 * Baut einen vollständigen `Content-Disposition`-Wert.
 *
 * @param name  Der echte Dateiname, so wie der Nutzer ihn sehen soll.
 * @param art   `attachment` (Download) oder `inline` (im Browser anzeigen).
 */
export function contentDisposition(name: string, art: "attachment" | "inline" = "attachment"): string {
  const roh = (name || "").replace(STEUERZEICHEN, "").trim() || "datei";
  const ascii = asciiName(roh);
  // `encodeURIComponent` lässt !'()* stehen; RFC 5987 erlaubt sie nicht im
  // erweiterten Wert. Deshalb nachkodieren.
  const kodiert = encodeURIComponent(roh).replace(/['()!*]/g, (z) => "%" + z.charCodeAt(0).toString(16).toUpperCase());
  return `${art}; filename="${ascii}"; filename*=UTF-8''${kodiert}`;
}
