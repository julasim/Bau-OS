// ============================================================
// PATIO — Personendaten aus Antworten entfernen (Präsentationsrolle)
// ============================================================
//
// ── Wogegen das steht ──────────────────────────────────────────────────────
//
// `GET /api/team` liefert jedem angemeldeten Konto E-Mail und Telefonnummer
// aller Mitglieder — im Büro völlig richtig, es ist der interne
// Kollegenkatalog. Im Besprechungsraum nicht: dort sitzen Bauherren,
// ausführende Firmen und Behördenvertreter vor demselben Bildschirm.
//
// ── Warum das aussieht wie `geld.ts`, und warum das gut ist ────────────────
//
// Dieselbe Bauform: EINE Middleware hinter der Anmeldung, die jede
// JSON-Antwort durchgeht und Felder mit bestimmten NAMEN entfernt. Zwei
// Filter mit derselben Mechanik sind leichter zu prüfen als zwei verschiedene
// Ansätze für dasselbe Problem — und die Mechanik hat sich beim Geld-Recht
// bereits bewährt.
//
// ── Was NICHT gefiltert wird, und warum ────────────────────────────────────
//
// Der NAME. Ein Board ohne Namen wäre leer: „heute im Haus", „zugewiesen an",
// „anwesend laut Bautagebuch" — überall steht ein Name, und er ist genau die
// Information, wegen der das Gerät im Raum hängt.
//
// Die Abwägung ist bewusst: ein Name ist im Besprechungsraum ohnehin bekannt
// (die Leute sitzen dort), eine Privatnummer nicht.
// ============================================================

import type { Context, Next } from "hono";
import type { AppEnv } from "./server.js";

/**
 * Feldnamen, die für die Präsentationsrolle verschwinden.
 *
 * Kontaktwege einer Person, plus alles, woraus sich einer ableiten lässt.
 * `notes` am Team-Mitglied fällt mit: dort steht erfahrungsgemäß „erreichbar
 * über die Privatnummer der Frau" und Ähnliches.
 */
const PERSONENFELDER = new Set([
  "email",
  "phone",
  "mobile",
  "telefon",
  "handy",
  "privatAdresse",
  "address",
  "adresse",
  "contactLog",
  "vcard",
]);

function ohnePersonendaten(wert: unknown): unknown {
  if (Array.isArray(wert)) return wert.map(ohnePersonendaten);
  if (wert === null || typeof wert !== "object") return wert;
  const ziel: Record<string, unknown> = {};
  for (const [schluessel, inhalt] of Object.entries(wert as Record<string, unknown>)) {
    if (PERSONENFELDER.has(schluessel)) continue;
    ziel[schluessel] = ohnePersonendaten(inhalt);
  }
  return ziel;
}

/**
 * Antwort-Filter für die Präsentationsrolle.
 *
 * Greift NUR für diese Rolle — für alle anderen ist die Middleware ein
 * Durchgang ohne Kosten. Das Büro braucht die Kontaktdaten, das Board nicht.
 */
export async function personendatenFilter(c: Context<AppEnv>, next: Next): Promise<void> {
  await next();
  if (c.get("userRole") !== "praesentation") return;

  const antwort = c.res;
  if (!antwort || !antwort.headers.get("content-type")?.includes("application/json")) return;

  try {
    const daten: unknown = await antwort.clone().json();
    const gefiltert = JSON.stringify(ohnePersonendaten(daten));
    c.res = new Response(gefiltert, {
      status: antwort.status,
      headers: antwort.headers,
    });
  } catch {
    // Kein lesbares JSON — dann bleibt die Antwort, wie sie ist. Ein Filter,
    // der bei Unklarheit die Antwort zerstört, wäre schlimmer als einer, der
    // eine unbekannte Form durchlässt.
  }
}

/**
 * Schreibschutz für die Präsentationsrolle.
 *
 * ── Warum EINE Middleware und nicht 94 Prüfungen ──────────────────────────
 *
 * Weil es 94 schreibende Routen gibt. Jede einzeln zu bewachen heißt: die
 * 95. wird vergessen. Genau so sind die siebzehn Rechte-Lücken entstanden,
 * die im August geschlossen wurden.
 *
 * Hier steht die Regel einmal, vor allen Routen: alles außer GET und HEAD ist
 * für dieses Konto zu Ende. Eine neue Route bekommt den Schutz geschenkt.
 */
export async function schreibschutz(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  if (c.get("userRole") === "praesentation" && !["GET", "HEAD"].includes(c.req.method)) {
    return c.json({ error: "Dieses Konto ist eine Anzeige und kann nichts ändern." }, 403);
  }
  await next();
}
