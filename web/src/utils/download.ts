// ============================================================
// PATIO — Datei vom Server holen und speichern
// ============================================================
// Ein Download mit Anmeldung geht nicht über einen einfachen Link: der Browser
// schickt bei einem `<a href>` keinen Authorization-Header mit. Also holen,
// als Blob halten, und über einen erzeugten Link speichern.
//
// Der Helfer liegt hier und nicht in einer Ansicht, weil ihn inzwischen
// mehrere brauchen (Projektdetail, Rechnungen). Eine zweite Kopie hätte
// irgendwann eine andere Fehlerbehandlung.
// ============================================================

import { getToken } from "../api";
import { dateinameAusHeader } from "./dateiname";

/**
 * Holt eine Datei und speichert sie.
 *
 * @returns `null` bei Erfolg, sonst die Fehlermeldung des Servers im Klartext.
 *          Die Anzeige gehört der Ansicht — hier wäre sie an der falschen
 *          Stelle, und ein stilles `catch` wäre schlimmer als beides.
 */
export async function dateiHolen(url: string, rueckfallName: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  } catch (e) {
    return e instanceof Error ? e.message : "Der Server ist nicht erreichbar.";
  }

  if (!res.ok) {
    // Der Server antwortet bei Fehlern mit JSON und einem deutschen Satz —
    // etwa „PDF-Umwandlung ist auf diesem Server nicht eingerichtet". Den soll
    // der Nutzer sehen, nicht „HTTP 503".
    const körper = await res.json().catch(() => null);
    return (körper as { error?: string } | null)?.error ?? `Der Export ist fehlgeschlagen (HTTP ${res.status}).`;
  }

  const blob = await res.blob();
  // `filename*` bevorzugt — sonst gewinnt der ASCII-Ersatzname und aus
  // „Müller" wird „Mueller" auf der Platte.
  const name = dateinameAusHeader(res.headers.get("Content-Disposition"), rueckfallName);
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = name;
  a.click();
  URL.revokeObjectURL(objUrl);
  return null;
}
