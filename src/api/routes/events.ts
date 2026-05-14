// ============================================================
// Bau-OS — SSE (Server-Sent Events) Route
// Clients verbinden sich per EventSource und erhalten
// Live-Updates bei Daten-Aenderungen.
//
// Endpoint: GET /api/events
// Optional: ?types=task,termin (Filter auf Event-Typen)
// ============================================================

import crypto from "crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, listenerCount } from "../events.js";
import type { DataEvent } from "../events.js";
import type { AppEnv } from "../server.js";

// One-Time-Tickets fuer SSE-Authentifizierung.
// EventSource kann keine Custom-Header setzen, also muss das Credential
// in die URL. Statt das langlebige JWT dort zu exponieren (landet in
// Server-Logs, Browser-History, Referer), holt der Client per
// authentifiziertem POST ein kurzlebiges Einmal-Ticket.
// TTL: 30 Sekunden — reicht fuer den Verbindungsaufbau.
const _tickets = new Map<string, { userId: string | null; expiresAt: number }>();
const TICKET_TTL_MS = 30_000;

// Cleanup abgelaufener Tickets (laeuft bei jeder Ticket-Erstellung).
function pruneTickets() {
  const now = Date.now();
  for (const [k, v] of _tickets) {
    if (v.expiresAt < now) _tickets.delete(k);
  }
}

/** Prueft ob ein Ticket gueltig ist OHNE es zu konsumieren. Wird von der
 *  authMiddleware aufgerufen, damit ein gueltiges Ticket den fehlenden
 *  JWT-Query-Param ersetzen darf. Das eigentliche Einloesen (One-Time-
 *  Delete) passiert erst in der GET /events-Route. */
export function peekTicket(ticket: string): boolean {
  const entry = _tickets.get(ticket);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    _tickets.delete(ticket);
    return false;
  }
  return true;
}

export const eventsRoutes = new Hono<AppEnv>();

// POST /api/events/ticket — kurzlebiges Einmal-Ticket fuer den SSE-Connect.
// Liegt hinter der globalen authMiddleware (server.ts schuetzt /api/*),
// also ist der Aufrufer hier garantiert authentifiziert.
eventsRoutes.post("/events/ticket", (c) => {
  const user = c.get("user");
  pruneTickets();
  const ticket = crypto.randomBytes(24).toString("hex");
  _tickets.set(ticket, {
    userId: user?.sub ?? null,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return c.json({ ticket });
});

eventsRoutes.get("/events", (c) => {
  // One-Time-Ticket einloesen, falls vorhanden. Die authMiddleware hat
  // bei gueltigem Ticket bereits durchgewunken — hier wird es konsumiert,
  // damit es kein zweites Mal verwendet werden kann.
  const ticketParam = c.req.query("ticket");
  if (ticketParam) {
    const entry = _tickets.get(ticketParam);
    if (!entry || entry.expiresAt < Date.now()) {
      _tickets.delete(ticketParam);
      return c.json({ error: "Ungueltiges oder abgelaufenes Ticket" }, 401);
    }
    _tickets.delete(ticketParam);
  }

  // Optionaler Filter auf Event-Typen
  const typesParam = c.req.query("types");
  const allowedTypes = typesParam ? new Set(typesParam.split(",").map((t) => t.trim())) : null;

  return streamSSE(c, async (stream) => {
    let eventId = 0;

    // Heartbeat alle 30s damit die Verbindung offen bleibt
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ event: "ping", data: "", id: String(eventId++) });
      } catch {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }, 30_000);

    // Event-Listener registrieren
    const unsubscribe = subscribe(async (event: DataEvent) => {
      // Filter anwenden
      if (allowedTypes && !allowedTypes.has(event.type)) return;

      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: String(eventId++),
        });
      } catch {
        // Verbindung geschlossen
        clearInterval(heartbeat);
        unsubscribe();
      }
    });

    // Initiale Nachricht
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ message: "Verbunden", listeners: listenerCount() }),
      id: String(eventId++),
    });

    // Stream offen halten bis Client disconnected
    stream.onAbort(() => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Endlos warten (Stream bleibt offen)
    await new Promise(() => {});
  });
});

// Status-Endpoint: Wie viele Clients sind verbunden?
eventsRoutes.get("/events/status", (c) => {
  return c.json({ connectedClients: listenerCount() });
});
