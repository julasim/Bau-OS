// ============================================================
// PATIO — SSE (Server-Sent Events) Route
// Clients verbinden sich per EventSource und erhalten
// Live-Updates bei Daten-Aenderungen.
//
// Endpoint: GET /api/events
// Optional: ?types=task,termin (Filter auf Event-Typen)
//
// Das Einmal-Ticket AUTHENTIFIZIERT nur — es sagt, WER verbunden ist, nicht
// WAS er sehen darf. Die Autorisierung passiert hier: jede Verbindung bekommt
// einen `EventScope`, und der Event-Bus stellt nur zu, was dieser Scope
// abdeckt (siehe `mayReceive()` in ../events.ts).
// ============================================================

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe, listenerCount } from "../events.js";
import type { DataEvent, EventScope } from "../events.js";
import type { AppEnv } from "../server.js";
import { consumeTicket, createTicket } from "../sse-tickets.js";
import type { TicketIdentity } from "../sse-tickets.js";
import { getVisibleProjectIds, alsRolle } from "../../data/access.js";
import { findDbUserById } from "../auth.js";
import { logError } from "../../logger.js";

export const eventsRoutes = new Hono<AppEnv>();

/** Wie oft der Sichtbarkeits-Kontext einer offenen Verbindung neu aus der
 *  Datenbank geholt wird.
 *
 *  Bekannte Einschraenkung, bewusst so gebaut: Rechte koennen sich WAEHREND
 *  einer offenen Verbindung aendern (jemand bekommt ein Projekt zugewiesen
 *  oder entzogen). Eine beim Verbindungsaufbau ermittelte Liste veraltet
 *  dadurch. Der Kontext wird deshalb periodisch aufgefrischt — die
 *  Fehlzustellung ist damit auf dieses Fenster begrenzt statt unbegrenzt.
 *  Das Restrisiko ist klein, weil ein Ereignis seit Stufe 1 keine Inhalte
 *  mehr traegt: der Client erfaehrt hoechstens, DASS sich in einem Projekt
 *  etwas geaendert hat, und laeuft beim Nachladen in das 403 der reguleren
 *  Route. Alternative waere gewesen, den Scope bei JEDEM Ereignis frisch zu
 *  laden — das sind bei 20 Buero-Clients 20 Abfragen pro Aenderung, ein
 *  schlechter Tausch fuer 15 Sekunden. */
const SCOPE_REFRESH_MS = 15_000;

/** Ermittelt den aktuellen Sichtbarkeits-Kontext einer Verbindung.
 *
 *  Die Rolle wird dabei JEDES MAL neu aus der Datenbank gelesen und nicht aus
 *  dem Token uebernommen — gleiche Begruendung wie in der authMiddleware: ein
 *  herabgestufter Admin behielte sonst bis zum Verbindungsabbruch (und der
 *  kann Tage dauern) den ungefilterten Kanal. */
export async function resolveScope(identity: TicketIdentity): Promise<Pick<EventScope, "unrestricted" | "projectIds">> {
  let role = identity.role;
  if (identity.userId) {
    const user = await findDbUserById(identity.userId);
    // Konto geloescht → nichts mehr zustellen (fail-closed).
    if (!user) return { unrestricted: false, projectIds: new Set() };
    role = user.role;
  }
  const visible = await getVisibleProjectIds({ userId: identity.userId, role });
  if (visible === "all") return { unrestricted: true, projectIds: new Set() };
  return { unrestricted: false, projectIds: new Set(visible) };
}

// POST /api/events/ticket — kurzlebiges Einmal-Ticket fuer den SSE-Connect.
// Liegt hinter der globalen authMiddleware (server.ts schuetzt /api/*),
// also ist der Aufrufer hier garantiert authentifiziert. Identitaet UND Rolle
// wandern ins Ticket, weil die Middleware beim spaeteren GET mit Ticket
// nichts davon setzt.
eventsRoutes.post("/events/ticket", (c) => {
  const user = c.get("user");
  const ticket = createTicket({
    userId: c.get("userId") ?? user?.sub ?? null,
    role: alsRolle(c.get("userRole")),
  });
  return c.json({ ticket });
});

eventsRoutes.get("/events", async (c) => {
  // Identitaet bestimmen. Zwei Wege fuehren hierher:
  //   1. Einmal-Ticket (Regelfall) — die authMiddleware hat bei gueltigem
  //      Ticket durchgewunken, OHNE userId/userRole zu setzen. Die Identitaet
  //      kommt deshalb aus dem Ticket, das hier zugleich entwertet wird.
  //   2. ?token=JWT (Rueckfallpfad des Frontends) — dann hat die Middleware
  //      alles gesetzt.
  // Ein fehlendes `userRole` darf NIE als Admin durchgehen.
  const ticketParam = c.req.query("ticket");
  let identity: TicketIdentity;
  if (ticketParam) {
    const redeemed = consumeTicket(ticketParam);
    if (!redeemed) return c.json({ error: "Ungueltiges oder abgelaufenes Ticket" }, 401);
    identity = redeemed;
  } else {
    const role = c.get("userRole");
    if (!role) return c.json({ error: "Nicht autorisiert" }, 401);
    identity = { userId: c.get("userId") ?? null, role: alsRolle(role) };
  }

  // Optionaler Filter auf Event-Typen
  const typesParam = c.req.query("types");
  const allowedTypes = typesParam ? new Set(typesParam.split(",").map((t) => t.trim())) : null;

  // Sichtbarkeits-Kontext. Wird an den Event-Bus uebergeben und danach AN
  // ORT UND STELLE aufgefrischt — der Bus haelt die Referenz, sieht also
  // immer den aktuellen Stand.
  const initial = await resolveScope(identity);
  const scope: EventScope = {
    userId: identity.userId,
    unrestricted: initial.unrestricted,
    projectIds: initial.projectIds,
  };

  return streamSSE(c, async (stream) => {
    let eventId = 0;

    // Heartbeat alle 30s damit die Verbindung offen bleibt
    const heartbeat = setInterval(async () => {
      try {
        await stream.writeSSE({ event: "ping", data: "", id: String(eventId++) });
      } catch {
        clearInterval(heartbeat);
        clearInterval(scopeTimer);
        unsubscribe();
      }
    }, 30_000);

    // Sichtbarkeit nachfuehren. Schlaegt die Abfrage fehl (DB-Aussetzer),
    // bleibt der bisherige Stand stehen statt den Kanal zu leeren — ein
    // Fehlschlag hier ist ein Infrastruktur-, kein Rechteproblem, und bei
    // liegender DB emittiert ohnehin niemand.
    const scopeTimer = setInterval(() => {
      void (async () => {
        try {
          const fresh = await resolveScope(identity);
          scope.unrestricted = fresh.unrestricted;
          scope.projectIds = fresh.projectIds;
        } catch (err) {
          logError("[SSE] Sichtbarkeit konnte nicht aufgefrischt werden", err);
        }
      })();
    }, SCOPE_REFRESH_MS);

    // Event-Listener registrieren — mit Sichtbarkeits-Kontext, der Bus
    // filtert damit vor der Zustellung.
    const unsubscribe = subscribe((event: DataEvent) => {
      // Filter auf Event-Typen anwenden
      if (allowedTypes && !allowedTypes.has(event.type)) return;

      void stream
        .writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: String(eventId++),
        })
        .catch(() => {
          // Verbindung geschlossen
          clearInterval(heartbeat);
          clearInterval(scopeTimer);
          unsubscribe();
        });
    }, scope);

    // Initiale Nachricht
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ message: "Verbunden", listeners: listenerCount() }),
      id: String(eventId++),
    });

    // Stream offen halten bis Client disconnected
    stream.onAbort(() => {
      clearInterval(heartbeat);
      clearInterval(scopeTimer);
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
