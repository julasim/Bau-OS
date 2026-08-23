// ============================================================
// PATIO — Dateiname aus dem Content-Disposition-Header lesen
// ============================================================
// Gegenstück zu `src/api/dateiname.ts` auf der Serverseite. Der Header trägt
// zwei Angaben:
//
//   attachment; filename="Angebot Mueller.pdf"; filename*=UTF-8''Angebot%20M%C3%BCller.pdf
//
// `filename=` ist die ASCII-Notlösung für alte Clients, `filename*=` der
// echte Name. Wer nur die erste liest, speichert „Mueller" statt „Müller" —
// und merkt es nie, weil beides plausibel aussieht.
// ============================================================

export function dateinameAusHeader(header: string | null, rueckfall: string): string {
  const cd = header ?? "";

  // Zuerst die erweiterte Angabe. RFC 5987: <charset>'<sprache>'<wert>.
  const erweitert = cd.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (erweitert) {
    try {
      const dekodiert = decodeURIComponent(erweitert[2].trim());
      if (dekodiert) return dekodiert;
    } catch {
      // Kaputte Prozentkodierung — dann die einfache Angabe versuchen.
    }
  }

  const einfach = cd.match(/filename\s*=\s*"([^"]*)"/i) ?? cd.match(/filename\s*=\s*([^;]+)/i);
  const name = einfach?.[1]?.trim();
  return name || rueckfall;
}
