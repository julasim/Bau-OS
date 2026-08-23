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
import type { Rolle } from "../data/access.js";

/** Wer hinter einem Ticket steckt.
 *
 *  Warum die Rolle mitgespeichert wird: beim Verbindungsaufbau mit Ticket
 *  laeuft die authMiddleware NICHT vollstaendig durch (sie winkt bei gueltigem
 *  Ticket direkt mit `next()` durch, ohne `userId`/`userRole` zu setzen). Die
 *  SSE-Route haette danach keine Identitaet mehr, an die sie den
 *  Sichtbarkeits-Filter haengen koennte — und eine fehlende Rolle darf auf
 *  keinen Fall als „Admin" durchgehen. Das Ticket wird beim POST ausgestellt,
 *  also genau dann, wenn die Identitaet noch feststeht. */
export interface TicketIdentity {
  /** `users.id`. `null` bei Legacy-Konten ohne UUID. */
  userId: string | null;
  role: Rolle;
}

type TicketEntry = TicketIdentity & { expiresAt: number };

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
export function createTicket(identity: TicketIdentity): string {
  pruneTickets();
  const ticket = crypto.randomBytes(24).toString("hex");
  _tickets.set(ticket, {
    userId: identity.userId,
    role: identity.role,
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

/** Wie peekTicket, loescht das Ticket aber danach (One-Time-Use) und liefert
 *  die hinterlegte Identitaet zurueck. `null` = ungueltig oder abgelaufen.
 *  Wird in der GET /events-Route zum Einloesen verwendet. */
export function consumeTicket(ticket: string): TicketIdentity | null {
  const entry = _tickets.get(ticket);
  if (!entry) return null;
  _tickets.delete(ticket);
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, role: entry.role };
}
