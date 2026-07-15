// ============================================================
// PATIO — Datums-Mapping MS-Graph ↔ PATIO (rein, keine Abhaengigkeiten)
// ============================================================
// Eigenes Modul, damit sync/ und api/routes/ dieselben Helfer teilen koennen,
// ohne einen Circular-Import (sync/microsoft-sync ↔ api/routes/webhooks-microsoft).
// Frueher waren isoToPatioDatum/extractTime in beiden Dateien dupliziert.
// ============================================================

/** "07.05.2026" → "2026-05-07". Akzeptiert auch schon ISO. */
export function patioDatumToIso(datum: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) return datum;
  const m = datum.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) throw new Error(`Unverstaendliches Datumsformat: "${datum}"`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "2026-05-07" → "07.05.2026" — PATIO-kanonisch. */
export function isoToPatioDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`Unverstaendliches ISO-Datum: "${iso}"`);
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** "2026-05-05T14:00:00.0000000" → "2026-05-05". */
export function extractDate(dt: string): string {
  return dt.split("T")[0]!;
}

/** "2026-05-05T14:00:00.0000000" → "14:00" (HH:MM, mit Sekunden-Schnitt). */
export function extractTime(dt: string): string {
  return (dt.split("T")[1] ?? "").slice(0, 5);
}
