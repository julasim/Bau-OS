import { ref, onMounted, onUnmounted } from "vue";

/**
 * Globaler Verbindungs-Status fuer Live-Updates (SSE).
 * Wird gesetzt, sobald `MAX_RECONNECT_ATTEMPTS` erschoepft ist, damit
 * Views (z.B. AppLayout) eine sichtbare Warnung anzeigen koennen.
 */
export const connectionError = ref<string | null>(null);

// Deckungsgleich mit `EventType` in src/api/events.ts. Die Liste hing
// zurueck — bautagebuch, meeting, time, phase und invoice sendet der Server
// laengst, nur liess sich darauf nicht typsicher lauschen.
export type EventType =
  | "task"
  | "termin"
  | "note"
  | "project"
  | "file"
  | "team"
  | "bautagebuch"
  | "meeting"
  | "time"
  | "phase"
  | "invoice"
  | "entscheidung";

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

// ============================================================
// EINE Verbindung fuer die ganze Anwendung
// ============================================================
//
// ── Was vorher war ─────────────────────────────────────────────────────────
//
// `source`, Timer und Zaehler standen im Funktionsrumpf: jeder Aufruf von
// `useEvents()` baute eine EIGENE `EventSource` auf und holte ein EIGENES
// Ticket. Auf `/tasks` liefen dadurch DREI Verbindungen fuer dieselben
// Ereignisse — die Navigationsleiste, die Topbar und die Liste.
//
// Das kostet nicht nur Verbindungen. Der Server haelt je Client einen offenen
// Strom, und `connectionError` (das globale Stoerungsbanner) wurde von einer
// einzelnen abgerissenen Verbindung gesetzt, waehrend die anderen zwei
// standen — und von der naechsten, die sich verband, wieder geloescht.
//
// ── Warum ohne `types=`-Parameter ──────────────────────────────────────────
//
// Der Typfilter ist serverseitig OPTIONAL (`src/api/routes/events.ts`: ohne
// den Parameter kommt alles). Die geteilte Verbindung wird deshalb ungefiltert
// aufgebaut und clientseitig verteilt. Die Alternative — die Vereinigungsmenge
// aller Abonnenten in der URL — muesste die Verbindung jedes Mal neu
// aufbauen, wenn eine Ansicht mit einem weiteren Typ dazukommt.
//
// Der Preis ist vernachlaessigbar: Ereignisse tragen bewusst keine Nutzdaten,
// nur Typ und ID, und der Server filtert weiterhin nach Sichtbarkeit.
//
// ── Das Ticket ─────────────────────────────────────────────────────────────
//
// Einmal-Ticket mit 30 s Gueltigkeit (`src/api/sse-tickets.ts`). Es wird pro
// VERBINDUNGSAUFBAU geholt, nicht pro Abonnent — bei jedem Reconnect also
// erneut, bei einem hinzukommenden Abonnenten an stehender Verbindung nicht.
// Damit sinken die Ticket-Anfragen von drei auf eine je Seitenaufruf.

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_RECONNECT_DELAY = 60_000;

/**
 * `connected` als MODUL-Zustand, nicht je Aufruf.
 *
 * ⚠ Der Punkt, an dem der Umbau sonst schiefginge: Als `ref` im Funktionsrumpf
 * bekaeme ein Abonnent, der sich an eine BEREITS STEHENDE Verbindung haengt,
 * fuer immer `false` — das `connected`-Ereignis ist dann laengst vorbei.
 */
const verbunden = ref(false);

const abonnenten = new Map<EventType, Set<(event: DataEvent) => void>>();
let quelle: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;
let reconnectAttempts = 0;
/** Wie viele Komponenten gerade lauschen. Bei 0 wird abgebaut. */
let nutzer = 0;
/**
 * Läuft gerade ein Verbindungsaufbau?
 *
 * ⚠ Ohne diese Sperre wäre der ganze Umbau wirkungslos gewesen. `verbinde()`
 * prüft `if (quelle) return` — aber `quelle` wird erst NACH dem `await` für
 * das Einmal-Ticket gesetzt. Drei Komponenten, die im selben Tick montieren
 * (Navigationsleiste, Topbar, Liste), kommen alle drei an der Prüfung vorbei,
 * bevor die erste ihr Ticket hat: drei Tickets, drei Verbindungen, genau der
 * Zustand, den der Umbau beseitigen sollte.
 *
 * Gefunden vom Test darunter, nicht beim Lesen.
 */
let bautAuf = false;

function verteile(ereignis: DataEvent): void {
  const menge = abonnenten.get(ereignis.type);
  if (!menge) return;
  for (const rueckruf of menge) {
    try {
      rueckruf(ereignis);
    } catch {
      // Ein Abonnent, der wirft, darf die uebrigen nicht mitreissen — sie
      // haengen an derselben Verbindung.
    }
  }
}

async function verbinde(): Promise<void> {
  if (quelle || bautAuf) return; // steht schon oder ist gerade im Aufbau
  const token = localStorage.getItem("patio-token");
  if (!token) return;
  bautAuf = true;
  try {
    await baueAuf(token);
  } finally {
    bautAuf = false;
  }
}

async function baueAuf(token: string): Promise<void> {
  // One-Time-Ticket holen — so bleibt das langlebige JWT aus der URL
  // raus (Server-Logs, Browser-History, Referer). Schlaegt der Fetch
  // fehl, faellt es auf den token-Query-Param zurueck (Backward-Compat).
  let authParam = "";
  try {
    const res = await fetch("/api/events/ticket", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // ⚠ Ohne Zeitlimit bleibt `bautAuf` fuer immer true, wenn der Endpunkt
      // die Verbindung ANNIMMT, aber nie antwortet (haengender Proxy waehrend
      // eines Updates). Danach kehrt jeder `verbinde()`-Aufruf sofort
      // zurueck, es entsteht keine `EventSource`, also auch kein `onerror`,
      // also kein Wiederversuch — Live-Updates waeren fuer den Rest der
      // Sitzung tot, und zwar OHNE Banner, weil `connectionError` null bleibt.
      //
      // Laeuft das Zeitlimit ab, greift der `catch` darunter und faellt auf
      // den Token-Parameter zurueck; dieser Weg existiert bereits.
      signal: AbortSignal.timeout(10_000),
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

  // Zwischen dem `await` oben und hier kann die letzte Komponente ausgehaengt
  // haben. Dann keine Verbindung aufbauen — sonst bliebe sie ohne Abonnenten
  // offen stehen.
  if (nutzer === 0) return;

  quelle = new EventSource(`/api/events?${authParam}`);

  quelle.addEventListener("connected", () => {
    verbunden.value = true;
    reconnectDelay = 3000;
    reconnectAttempts = 0;
    connectionError.value = null;
  });

  // Auf ALLE Typen lauschen, nicht nur auf die der aktuellen Abonnenten: Eine
  // Ansicht, die spaeter dazukommt, soll ihre Ereignisse sofort bekommen und
  // nicht erst nach einem Neuaufbau der Verbindung.
  const ALLE: EventType[] = [
    "task",
    "termin",
    "note",
    "project",
    "file",
    "team",
    "bautagebuch",
    "meeting",
    "time",
    "phase",
    "invoice",
    "entscheidung",
  ];
  for (const typ of ALLE) {
    quelle.addEventListener(typ, (e) => {
      try {
        verteile(JSON.parse((e as MessageEvent).data) as DataEvent);
      } catch {
        // Parse-Fehler ignorieren
      }
    });
  }

  quelle.onerror = () => {
    verbunden.value = false;
    quelle?.close();
    quelle = null;
    if (nutzer === 0) return; // niemand mehr da — nicht neu verbinden
    reconnectAttempts++;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      connectionError.value = "Live-Updates unterbrochen. Bitte Seite neu laden.";
      return;
    }
    reconnectTimer = setTimeout(() => void verbinde(), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  };
}

/**
 * Wiederanlauf, wenn die Verbindungsversuche erschoepft sind.
 *
 * ── Der Dauerzustand, den das beendet ──────────────────────────────────────
 *
 * Nach zehn Fehlversuchen setzt `onerror` das Banner und kehrt zurueck, OHNE
 * einen Timer zu setzen. `reconnectAttempts` faellt nur an zwei Stellen
 * zurueck: im `connected`-Ereignis und in `trenne()` — und `trenne()` laeuft
 * nur bei `nutzer === 0`, was im angemeldeten Betrieb nie eintritt, weil die
 * Navigationsleiste immer montiert ist.
 *
 * Die Summe der Wartezeiten ist rund 5,5 Minuten; ein `patio update` dauert
 * laenger. Danach: keine Live-Updates mehr, und wer das Banner wegklickt, hat
 * nicht einmal ein Signal. Erst F5 half.
 *
 * ⚠ Die Zuhoerer haengen auf MODUL-Ebene, nicht in `onMounted`. Sonst haengte
 * jede der dreizehn Aufrufstellen einen eigenen an — der Umbau, der die
 * Verbindungen zusammengelegt hat, vervielfachte dann die Zuhoerer.
 */
function wiederAnlauf(): void {
  if (nutzer === 0 || quelle) return;
  reconnectAttempts = 0;
  reconnectDelay = 3000;
  connectionError.value = null;
  void verbinde();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", wiederAnlauf);
  // Nur beim Zurueckkommen, nicht beim Wegklicken.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wiederAnlauf();
  });
}

function trenne(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  quelle?.close();
  quelle = null;
  verbunden.value = false;
  reconnectAttempts = 0;
  reconnectDelay = 3000;
}

/**
 * SSE-Composable: ruft `onEvent` bei den angegebenen Ereignistypen auf.
 *
 * Die Signatur ist unveraendert — alle dreizehn Aufrufstellen bleiben, wie sie
 * sind. Was sich aendert, ist darunter: Sie teilen sich jetzt EINE Verbindung.
 *
 * @param types - Welche Event-Typen interessieren (z.B. ["task", "termin"])
 * @param onEvent - Callback bei Event
 */
export function useEvents(types: EventType[], onEvent: (event: DataEvent) => void) {
  onMounted(() => {
    for (const typ of types) {
      let menge = abonnenten.get(typ);
      if (!menge) {
        menge = new Set();
        abonnenten.set(typ, menge);
      }
      menge.add(onEvent);
    }
    nutzer++;
    void verbinde();
  });

  onUnmounted(() => {
    for (const typ of types) abonnenten.get(typ)?.delete(onEvent);
    nutzer = Math.max(0, nutzer - 1);
    // Erst abbauen, wenn die LETZTE Komponente geht — sonst riesse ein
    // Ansichtswechsel die Verbindung der Navigationsleiste mit ab.
    if (nutzer === 0) trenne();
  });

  return { connected: verbunden };
}
