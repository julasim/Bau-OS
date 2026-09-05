// ============================================================
// PATIO — Datenabfluesse protokollieren
// ============================================================
//
// ── Wozu ───────────────────────────────────────────────────────────────────
//
// Das Pruefprotokoll (`audit_log`, Migration 018) kannte bis hierher nur
// Anmeldungen, Kontenverwaltung und Passwortwechsel — also, WER hereinkommt.
// Nicht protokolliert war, WAS hinausgeht: der Volldump zieht den gesamten
// sichtbaren Bestand samt aller hochgeladenen Dateien in ein ZIP, das
// Projekt-Dossier und die KI-Akte fassen ein ganzes Projekt in Text, und der
// Word-Export erzeugt dasselbe als Datei.
//
// Bei einer Frage nach Bauherrendaten — und die kommt, sobald jemand danach
// fragt, warum ein Protokoll ausserhalb des Hauses auftaucht — ist das die
// wichtigste fehlende Zeile: wer hat wann welchen Bestand mitgenommen.
//
// ── Warum die Ereignisse nicht `ok: false` kennen ──────────────────────────
//
// Weil ein abgewiesener Abfluss KEIN Abfluss ist — er steht als 403 in den
// Zugriffslogs des Proxys. Protokolliert wird nur, was wirklich hinausging;
// alles andere verwaesserte die Liste, die man im Ernstfall liest.
// ============================================================

import type { Context } from "hono";
import { logEvent } from "../data/db-audit.js";
import type { AppEnv } from "./server.js";

/** Was hier hinausgeht. Bewusst grobkoernig — ein Eintrag je Ausgabeform,
 *  nicht je Datensatz; das Protokoll soll lesbar bleiben. */
export type AbflussArt =
  | "export.volldump" // ZIP, ganzer sichtbarer Bestand samt Dateien
  | "export.dossier" // GET /projects/:name/export.md
  | "export.docx" // Word/PDF-Export einer Besprechung, eines Berichts, …
  | "ki.dossier"; // KI-Akte als Markdown

/**
 * Schreibt einen Protokolleintrag ueber einen Datenabfluss.
 *
 * Absichtlich `void`-freundlich und fehlertolerant: `logEvent` schluckt seine
 * Fehler bereits selbst (siehe dort). Ein Protokolleintrag, der den Export
 * abbrechen koennte, waere schlimmer als ein fehlender.
 */
export function protokolliereAbfluss(c: Context<AppEnv>, art: AbflussArt, details: Record<string, unknown> = {}): void {
  const dbUser = c.get("dbUser");
  void logEvent({
    event: art,
    actorUserId: c.get("userId"),
    actorUsername: dbUser?.username ?? null,
    actorRole: c.get("userRole"),
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown",
    userAgent: (c.req.header("user-agent") ?? "").slice(0, 256),
    details,
  });
}
