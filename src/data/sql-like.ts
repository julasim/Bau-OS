// ============================================================
// PATIO — Maskierung fuer LIKE/ILIKE-Muster
// ============================================================
// Lag bis zuletzt modulprivat in db-search.ts. Seit db-notes.ts dieselbe
// Maskierung braucht (Notiztitel wie `Rohbau_Ost` oder `LP3_Einreichung`),
// steht sie hier — eine Stelle statt zweier Kopien, die auseinanderlaufen.
// ============================================================

/** Macht `%`, `_` und `\` zu buchstaeblichen Zeichen.
 *
 *  Ohne das bleiben sie LIKE-Metazeichen — und Bezeichnungen wie
 *  `LP3_Einreichung_01` oder `Grundriss_EG` sind in einem Planungsbuero der
 *  Normalfall, nicht der Randfall: `_` matcht sonst jedes beliebige Zeichen
 *  (`Grundriss-EG`, `GrundrissXEG`). `100%` wuerde zur Praefixsuche, `?q=%`
 *  lieferte alles im sichtbaren Bereich, und `C:\Plan` suchte nach `C:Plan`,
 *  weil der Backslash selbst das Escape-Zeichen ist.
 *
 *  Kein Injection-Schutz — die Werte gehen als Bind-Parameter raus. Es geht
 *  ausschliesslich um die Bedeutung der Zeichen INNERHALB des Musters.
 *
 *  Der Backslash ist in PostgreSQL das Vorgabe-Escape-Zeichen fuer LIKE, eine
 *  eigene `ESCAPE`-Klausel ist deshalb nicht noetig. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
