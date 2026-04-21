/**
 * Halluzinations-Schutz: Aktions-Anfragen-Erkennung + System-Hints.
 *
 * Gemeinsam genutzt von runtime.ts (Telegram) und api/routes/chat.ts (WebUI),
 * damit beide Kanaele denselben Schutz haben und die Regex nicht driftet.
 *
 * Staemme OHNE trailing \b — deutsche Konjugationen (speicher → speichere,
 * speichert, speichern) wuerden sonst nicht matchen und das Netz haette Loecher.
 * False-positives sind okay, weil das Modell notfalls ein Lese-Tool statt
 * antworten waehlen kann.
 */

export const ACTION_PATTERN =
  /\b(leg|anleg|erstell|speicher|lösch|loesch|änder|aender|entfern|aktualisier|trag.*ein|plan.*ein|notier|merk|benenn.*um|verschieb|hinzufüg|einfüg|füg.*hinzu|buch|setz|schreib|erfass|protokollier)/i;

export function isActionRequest(message: string): boolean {
  return ACTION_PATTERN.test(message);
}

/** System-Prompt-Zusatz bei Aktions-Anfragen. */
export const ACTION_HINT =
  `\n\nWICHTIG: Der Benutzer fordert eine Aktion (speichern/anlegen/loeschen/...). ` +
  `Du MUSST dafuer das entsprechende Tool aufrufen (z.B. notiz_speichern, termin_speichern, ` +
  `task_speichern, projekt_anlegen). Bei mehreren Items: ein Tool-Call pro Item. ` +
  `Gib NIEMALS eine Text-Antwort wie "gespeichert" oder "eingeplant" zurueck, ohne ` +
  `vorher die Tool-Calls wirklich ausgefuehrt zu haben — das waere eine Luege.`;

/** User-Message die bei Null-Tool-Calls als Retry-Korrektur eingeschoben wird. */
export const TOOL_SKIP_CORRECTION =
  `[SYSTEM-KORREKTUR] Du hast gerade KEINEN Tool-Call gemacht, ` +
  `obwohl tool_choice=required gesetzt war. Eine Text-Antwort wie ` +
  `"erledigt" oder "gespeichert" ist hier eine Luege, weil nichts ` +
  `wirklich passiert ist. Rufe JETZT sofort das passende Tool ` +
  `(notiz_loeschen, termin_loeschen, task_speichern, projekt_anlegen, ...) ` +
  `mit den richtigen Argumenten auf. Keine Text-Antwort — nur der Tool-Call.`;

export const MAX_TOOL_SKIP_RETRIES = 2;
