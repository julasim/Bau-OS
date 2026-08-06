// ============================================================
// PATIO — Gemeinsame Konstanten der Oberflaeche
// ============================================================
// Werte, die im Backend eine Entsprechung haben und dort die eigentliche
// Regel darstellen. Hier stehen sie nur, damit das Formular schon vor dem
// Absenden anzeigt, was der Server ohnehin erzwingen wuerde.
//
// WICHTIG: Bei Aenderungen BEIDE Seiten anfassen — sonst weist der Server
// etwas ab, das die Oberflaeche als in Ordnung markiert hat.

/** Muss zu PASSWORD_MIN_LENGTH in src/config.ts passen.
 *
 *  Seit dem Umbau zum Firmenserver ist das Passwort der einzige Faktor
 *  (der Email-Code-Zweig ist entfallen, TOTP kommt erst mit dem Zugang von
 *  aussen zurueck) — deshalb 12 statt der frueheren 8. */
export const PASSWORD_MIN_LENGTH = 12;
