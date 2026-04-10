// ============================================================
// Bau-OS — SSE (Server-Sent Events) Route
// Clients verbinden sich per EventSource und erhalten
// Live-Updates bei Daten-Aenderungen.
//
// Endpoint: GET /api/events
// Optional: ?types=task,termin (Filter auf Event-Typen)
// ============================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, listenerCount } from "../events.js";
import type { DataEvent } from "../events.js";

export const eventsRoutes = new Hono();

eventsRoutes.get("/events", (c) => {
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
