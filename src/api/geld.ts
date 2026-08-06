// ============================================================
// PATIO — Das Geld-Recht
// ============================================================
// Bis zur Rechte-Runde konnte jeder angemeldete Nutzer jeden Betrag lesen:
// Stundensaetze der Kolleginnen und Kollegen, Rechnungsbetraege, Budgets,
// Deckungsbeitraege. Das ist die heikelste Offenlegung in einem Buero, in dem
// Zeichensaal und Geschaeftsfuehrung dieselbe Anwendung benutzen — sie
// betrifft Gehaltsniveaus.
//
// ── Warum ein Filter auf der Antwort und keine Pruefung je Route ────────────
//
// Betraege kommen an vielen Stellen heraus: Rechnungen, Portfolio,
// Projekt-Cockpit, Stundenliste, Team, Phasen, Suche, Live-Kanal, Export.
// Eine Pruefung je Route waere neun Stellen, die man beim naechsten neuen
// Endpunkt vergessen kann — und genau so entstehen Luecken.
//
// Deshalb steht die Regel an EINER Stelle und greift auf dem Rueckweg: jede
// JSON-Antwort laeuft durch `ohneGeld()`, solange der Aufrufer das Recht nicht
// hat. Eine neue Route ist damit von sich aus dicht, ohne dass jemand daran
// denken muss.
//
// Der Preis, offen gesagt: der Filter arbeitet auf Feldnamen, nicht auf Typen.
// Ein kuenftiges Geldfeld mit anderem Namen faellt durch. Dagegen hilft nur
// die Liste unten zu pflegen — und der Rundum-Test
// (`tests/api-geld-recht.test.ts`), der ueber alle Endpunkte laeuft und jede
// Zahl anschaut, die nach einem Betrag aussieht.
// ============================================================

import type { Context, Next } from "hono";

/** Feldnamen, die einen Geldbetrag tragen — vollstaendig gemessen am
 *  Datenmodell (Migrationen 035–037) und an den DTOs in `src/data/types.ts`.
 *
 *  BEWUSST NICHT dabei:
 *  - `honorarProzent` — ein Anteil, kein Betrag. Er treibt die
 *    Fortschrittsanzeige der Leistungsphasen; ohne ihn bliebe das
 *    Projekt-Cockpit fuer alle ausser der Buchhaltung leer. Aus einem Prozent
 *    allein laesst sich kein Honorar ableiten.
 *  - `hours` — Stunden sind Arbeitszeit, kein Geld. Wer seine eigenen und die
 *    Stunden des Projekts sieht, kann daraus nichts ueber Saetze schliessen.
 *  - `offen` (offener Honorarrest) — zu allgemein fuer eine Namensliste. Ein
 *    kuenftiges Feld gleichen Namens ohne Geldbezug wuerde sonst still
 *    verschwinden. Es entsteht ohnehin nur in `GET /projects/:name/finance`,
 *    und die Route ist als Ganzes ans Geld-Recht gebunden. */
const GELD_FELDER = new Set([
  // Stundensatz — an TeamMember, TimeEntry und in den Auswertungen
  "hourlyRate",
  "hourly_rate",
  // Rechnungen — `einzelpreis` steckt in den Positionen (Migration 046),
  // also verschachtelt in der Rechnungsantwort. Genau dafuer arbeitet der
  // Filter rekursiv.
  "betrag",
  "einzelpreis",
  "invoiced",
  "invoicedTotal",
  "unassignedInvoiced",
  // Budget am Projekt
  "budget",
  "budgetUsed",
  "budget_used",
  // Honorar und Marge je Leistungsphase (`GET /projects/:name/finance`)
  "sollHonorar",
  "honorar",
  "deckung",
  "deckungsbeitrag",
  // Ist-Kosten aus Stunden mal Satz
  "kostenIst",
  "kostenIstTotal",
  "kosten",
  "cost",
  "costs",
]);

/** Entfernt alle Geldfelder aus einer beliebig verschachtelten Struktur.
 *
 *  Arbeitet rekursiv ueber Objekte und Arrays und laesst alles andere
 *  unveraendert. Die Felder werden **entfernt**, nicht auf 0 gesetzt: eine 0
 *  liesse sich nicht von einem echten Nullbetrag unterscheiden, und die
 *  Oberflaeche kann „Feld fehlt" sauber als „darf ich nicht sehen" abbilden. */
export function ohneGeld(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(ohneGeld);
  if (wert === null || typeof wert !== "object") return wert;

  const quelle = wert as Record<string, unknown>;
  const ziel: Record<string, unknown> = {};
  for (const [schluessel, inhalt] of Object.entries(quelle)) {
    if (GELD_FELDER.has(schluessel)) continue;
    ziel[schluessel] = ohneGeld(inhalt);
  }
  return ziel;
}

/** Darf dieser Aufrufer Betraege sehen?
 *
 *  Admins implizit ja — sonst sperrte sich die Person, die das Recht vergibt,
 *  beim ersten Start selbst aus. */
export function darfGeldSehen(c: Context): boolean {
  if (c.var.userRole === "admin") return true;
  return c.var.dbUser?.canSeeMoney === true;
}

/** Antwort-Filter. Haengt app-weit hinter der Authentifizierung.
 *
 *  Fasst nur JSON an — Dateidownloads, Word-Exporte und der Live-Kanal
 *  (`text/event-stream`) laufen unveraendert durch. Fuer den Live-Kanal ist
 *  das kein Loch: seine Ereignisse tragen keine Nutzdaten, nur Typ und ID
 *  (siehe src/api/events.ts). */
export async function geldFilter(c: Context, next: Next): Promise<void> {
  await next();

  if (darfGeldSehen(c)) return;

  const typ = c.res.headers.get("content-type") ?? "";
  if (!typ.includes("application/json")) return;

  let daten: unknown;
  try {
    daten = await c.res.clone().json();
  } catch {
    return; // kein auswertbares JSON — unveraendert lassen
  }

  const gefiltert = JSON.stringify(ohneGeld(daten));
  const kopf = new Headers(c.res.headers);
  kopf.delete("content-length"); // Laenge stimmt nach dem Filtern nicht mehr
  c.res = new Response(gefiltert, { status: c.res.status, headers: kopf });
}
