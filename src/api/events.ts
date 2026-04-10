// ============================================================
// Bau-OS — Event Bus
// Typisierter In-Memory Event-Emitter fuer Live-Updates.
// SSE-Clients registrieren sich hier, Data-Layer emittiert hier.
// ============================================================

export interface DataEvent {
  type: "task" | "termin" | "note" | "project" | "file" | "team";
  action: "created" | "updated" | "deleted" | "completed";
  id?: string;
  data?: Record<string, unknown>;
  project?: string | null;
  timestamp: string;
}

type EventListener = (event: DataEvent) => void;

const listeners = new Set<EventListener>();

/** Registriert einen Listener fuer alle Data-Events. Gibt unsubscribe-Funktion zurueck. */
export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Emittiert ein Data-Event an alle registrierten Listener. */
export function emit(event: Omit<DataEvent, "timestamp">): void {
  const full: DataEvent = { ...event, timestamp: new Date().toISOString() };
  for (const listener of listeners) {
    try {
      listener(full);
    } catch {
      // Listener-Fehler ignorieren (z.B. geschlossene SSE-Verbindung)
    }
  }
}

/** Anzahl aktiver Listener (fuer Monitoring). */
export function listenerCount(): number {
  return listeners.size;
}
