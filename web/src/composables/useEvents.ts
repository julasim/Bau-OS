import { ref, onMounted, onUnmounted } from "vue";

export type EventType = "task" | "termin" | "note" | "project" | "file" | "team";

export interface DataEvent {
  type: EventType;
  action: "created" | "updated" | "deleted" | "completed";
  id?: string;
  project?: string | null;
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

  function connect() {
    const token = localStorage.getItem("bau-os-token");
    if (!token) return;

    const typesParam = types.length ? `types=${types.join(",")}` : "";
    const tokenParam = `token=${encodeURIComponent(token)}`;
    const params = [typesParam, tokenParam].filter(Boolean).join("&");
    source = new EventSource(`/api/events?${params}`);

    source.addEventListener("connected", () => {
      connected.value = true;
      reconnectDelay = 3000;
      reconnectAttempts = 0;
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
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
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
