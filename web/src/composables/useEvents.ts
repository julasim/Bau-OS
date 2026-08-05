import { ref, onMounted, onUnmounted } from "vue";

/**
 * Globaler Verbindungs-Status fuer Live-Updates (SSE).
 * Wird gesetzt, sobald `MAX_RECONNECT_ATTEMPTS` erschoepft ist, damit
 * Views (z.B. AppLayout) eine sichtbare Warnung anzeigen koennen.
 */
export const connectionError = ref<string | null>(null);

export type EventType = "task" | "termin" | "note" | "project" | "file" | "team";

/**
 * Ein Live-Ereignis sagt nur, WAS sich geaendert hat — nie, wie es aussieht.
 * Es gibt bewusst kein Inhaltsfeld: der Kanal ging frueher ungefiltert an
 * jeden angemeldeten Client, samt beliebiger Nutzdaten. Wer den Inhalt
 * braucht, laedt ueber die regulaere Route nach; die filtert nach Rechten.
 *
 * `projectId` ersetzt das fruehere `project` (Name): der Server filtert die
 * Zustellung ueber die Projekt-UUID, und die gehoert damit auch ins DTO.
 * Fehlt sie oder ist sie null, ist der Datensatz projektlos.
 */
export interface DataEvent {
  type: EventType;
  action: "created" | "updated" | "deleted" | "completed";
  id?: string;
  projectId?: string | null;
  timestamp: string;
}

/**
 * SSE Composable: Verbindet sich mit /api/events und ruft den
 * Callback bei relevanten Events auf. Reconnected automatisch.
 *
 * @param types - Welche Event-Typen interessieren (z.B. ["task", "termin"])
 * @param onEvent - Callback bei Event
 */
export function useEvents(types: EventType[], onEvent: (event: DataEvent) => void) {
  const connected = ref(false);
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 3000;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const MAX_RECONNECT_DELAY = 60_000;

  async function connect() {
    const token = localStorage.getItem("patio-token");
    if (!token) return;

    // One-Time-Ticket holen — so bleibt das langlebige JWT aus der URL
    // raus (Server-Logs, Browser-History, Referer). Schlaegt der Fetch
    // fehl, faellt es auf den token-Query-Param zurueck (Backward-Compat).
    let authParam = "";
    try {
      const res = await fetch("/api/events/ticket", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) {
        const { ticket } = (await res.json()) as { ticket: string };
        authParam = `ticket=${encodeURIComponent(ticket)}`;
      } else {
        authParam = `token=${encodeURIComponent(token)}`;
      }
    } catch {
      authParam = `token=${encodeURIComponent(token)}`;
    }

    const typesParam = types.length ? `types=${types.join(",")}` : "";
    const params = [typesParam, authParam].filter(Boolean).join("&");
    source = new EventSource(`/api/events?${params}`);

    source.addEventListener("connected", () => {
      connected.value = true;
      reconnectDelay = 3000;
      reconnectAttempts = 0;
      connectionError.value = null;
    });

    for (const type of types) {
      source.addEventListener(type, (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as DataEvent;
          onEvent(data);
        } catch {
          // Parse-Fehler ignorieren
        }
      });
    }

    source.onerror = () => {
      connected.value = false;
      source?.close();
      source = null;
      reconnectAttempts++;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        connectionError.value = "Live-Updates unterbrochen. Bitte Seite neu laden.";
        return;
      }
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
    source = null;
    connected.value = false;
  }

  onMounted(connect);
  onUnmounted(disconnect);

  return { connected };
}
