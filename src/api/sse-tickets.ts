// ============================================================
// PATIO — SSE One-Time-Tickets
// Kurzlebige Einmal-Tickets fuer den SSE-Verbindungsaufbau.
//
// EventSource kann keine Custom-Header setzen, also muss das Credential
// in die URL. Statt das langlebige JWT dort zu exponieren (landet in
// Server-Logs, Browser-History, Referer), holt der Client per
// authentifiziertem POST ein kurzlebiges Einmal-Ticket.
// TTL: 30 Sekunden — reicht fuer den Verbindungsaufbau.
//
// Dieses Modul ist bewusst frei von Route-/Hono-Abhaengigkeiten, damit
// sowohl die authMiddleware als auch die events-Route es statisch
// importieren koennen (Middleware -> Route waere eine zyklische
// Dependency-Richtung).
// ============================================================

import crypto from "crypto";

type TicketEntry = { userId: string | null; expiresAt: number };

const _tickets = new Map<string, TicketEntry>();

export const TICKET_TTL_MS = 30_000;

// Cleanup abgelaufener Tickets (laeuft bei jeder Ticket-Erstellung).
function pruneTickets(): void {
  const now = Date.now();
  for (const [k, v] of _tickets) {
    if (v.expiresAt < now) _tickets.delete(k);
  }
}

/** Erzeugt ein neues Einmal-Ticket, setzt die TTL und gibt den
 *  Ticket-String zurueck. */
export function createTicket(userId: string | null): string {
  pruneTickets();
  const ticket = crypto.randomBytes(24).toString("hex");
  _tickets.set(ticket, {
    userId,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return ticket;
}

/** Prueft ob ein Ticket gueltig ist OHNE es zu konsumieren. Wird von der
 *  authMiddleware aufgerufen, damit ein gueltiges Ticket den fehlenden
 *  JWT-Query-Param ersetzen darf. Abgelaufene Tickets werden entfernt. */
export function peekTicket(ticket: string): boolean {
  const entry = _tickets.get(ticket);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    _tickets.delete(ticket);
    return false;
  }
  return true;
}

/** Wie peekTicket, loescht das Ticket aber danach (One-Time-Use).
 *  Wird in der GET /events-Route zum Einloesen verwendet. */
export function consumeTicket(ticket: string): boolean {
  const entry = _tickets.get(ticket);
  if (!entry) return false;
  _tickets.delete(ticket);
  if (entry.expiresAt < Date.now()) return false;
  return true;
}
