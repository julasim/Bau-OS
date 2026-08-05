// ============================================================
// PATIO — Termin-Validierung
// ============================================================
// Reine Pruef- und Normalisierungsfunktionen ohne Speicherzugriff. Lagen
// frueher in workspace/termine.ts neben dem Vault-CRUD; das CRUD ist mit
// dem Umbau zum Firmenserver in die Datenbank gewandert (db-termine.ts),
// die Validierung bleibt und wird von dort aufgerufen.
//
// Datumsformat: kanonisch ist TT.MM.JJJJ. YYYY-MM-DD wird akzeptiert und
// normalisiert — die Oberflaeche schickt je nach Eingabefeld beides.
// ============================================================

/** Akzeptiert TT.MM.JJJJ oder YYYY-MM-DD. Gibt Fehlermeldung oder null bei Erfolg. */
export function validateDatum(datum: string): string | null {
  let tag: number, monat: number, jahr: number;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(datum)) {
    [tag, monat, jahr] = datum.split(".").map(Number);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    [jahr, monat, tag] = datum.split("-").map(Number);
  } else {
    return `Ungueltiges Datumsformat "${datum}" — erwartet: TT.MM.JJJJ (z.B. 15.04.2026) oder YYYY-MM-DD`;
  }
  if (monat < 1 || monat > 12) return `Ungueltiger Monat ${monat} in "${datum}"`;
  if (tag < 1 || tag > 31) return `Ungueltiger Tag ${tag} in "${datum}"`;
  if (jahr < 2020 || jahr > 2099) return `Ungueltiges Jahr ${jahr} in "${datum}"`;
  return null;
}

/** Normalisiert ein validiertes Datum auf das kanonische TT.MM.JJJJ. */
export function normalizeDatum(datum: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    const [jahr, monat, tag] = datum.split("-");
    return `${tag}.${monat}.${jahr}`;
  }
  return datum;
}

/** Prueft Uhrzeit im Format HH:MM — gibt Fehlermeldung oder null bei Erfolg */
export function validateUhrzeit(uhrzeit: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(uhrzeit)) {
    return `Ungueltiges Uhrzeitformat "${uhrzeit}" — erwartet: HH:MM (z.B. 14:30)`;
  }
  const [h, m] = uhrzeit.split(":").map(Number);
  if (h < 0 || h > 23) return `Ungueltige Stunde ${h} in "${uhrzeit}"`;
  if (m < 0 || m > 59) return `Ungueltige Minute ${m} in "${uhrzeit}"`;
  return null;
}
