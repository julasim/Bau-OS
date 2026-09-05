// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";

// Eine Verbindung für die ganze Anwendung — statt einer je Aufruf.
//
// ── Was hier wirklich geprüft wird ─────────────────────────────────────────
//
// Auf `/tasks` rufen drei Komponenten `useEvents()` auf: Navigationsleiste,
// Topbar und Aufgabenliste. Vorher baute jede eine eigene `EventSource` auf
// und holte ein eigenes Einmal-Ticket — drei offene Ströme beim Server für
// dieselben Ereignisse.
//
// Der Umbau auf Modul-Zustand hat zwei Fallen, und beide sind hier festgehalten:
//
//   1. **`connected` muss aus dem Funktionsrumpf heraus.** Als `ref` je Aufruf
//      bekäme ein Abonnent, der sich an eine BEREITS STEHENDE Verbindung
//      hängt, für immer `false` — das `connected`-Ereignis ist dann vorbei.
//   2. **Abgebaut wird erst, wenn die LETZTE Komponente geht.** Sonst risse
//      ein Ansichtswechsel die Verbindung der Navigationsleiste mit ab.

/** Attrappe für `EventSource` — zählt, wie oft eine aufgemacht wurde. */
class FakeEventSource {
  static offen = 0;
  static erzeugt = 0;
  static letzte: FakeEventSource | null = null;

  readonly hoerer = new Map<string, ((e: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  geschlossen = false;

  constructor(readonly url: string) {
    FakeEventSource.erzeugt++;
    FakeEventSource.offen++;
    FakeEventSource.letzte = this;
  }

  addEventListener(typ: string, cb: (e: MessageEvent) => void) {
    const liste = this.hoerer.get(typ) ?? [];
    liste.push(cb);
    this.hoerer.set(typ, liste);
  }

  close() {
    if (!this.geschlossen) {
      this.geschlossen = true;
      FakeEventSource.offen--;
    }
  }

  /** Simuliert eine Server-Nachricht. */
  sende(typ: string, daten: unknown) {
    for (const cb of this.hoerer.get(typ) ?? []) cb({ data: JSON.stringify(daten) } as MessageEvent);
  }
}

/** Eine Komponente, die genau einmal `useEvents` aufruft. */
async function lauscher(typen: string[], onEvent: (e: unknown) => void) {
  const { useEvents } = await import("../../web/src/composables/useEvents");
  return defineComponent({
    setup() {
      const { connected } = useEvents(typen as never, onEvent as never);
      return () => h("div", String(connected.value));
    },
  });
}

describe("useEvents teilt sich EINE Verbindung", () => {
  beforeEach(async () => {
    vi.resetModules();
    FakeEventSource.offen = 0;
    FakeEventSource.erzeugt = 0;
    FakeEventSource.letzte = null;
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("localStorage", {
      getItem: () => "test-token",
      setItem: () => {},
      removeItem: () => {},
    });
    // Das Einmal-Ticket: eine Anfrage je VERBINDUNGSAUFBAU, nicht je Abonnent.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ticket: "t-1" }) })),
    );
  });

  it("drei Abonnenten erzeugen eine Verbindung und ein Ticket", async () => {
    const A = await lauscher(["task"], () => {});
    const B = await lauscher(["task", "termin"], () => {});
    const C = await lauscher(["note"], () => {});

    const a = mount(A);
    const b = mount(B);
    const c = mount(C);
    // Der Ticket-Abruf ist asynchron — die Verbindung entsteht danach.
    await new Promise((f) => setTimeout(f, 0));

    expect(FakeEventSource.erzeugt, "mehr als eine EventSource").toBe(1);
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    a.unmount();
    b.unmount();
    c.unmount();
  });

  it("wer sich an eine stehende Verbindung hängt, sieht sie als verbunden", async () => {
    // ⚠ Die Falle des Umbaus: mit `connected` im Funktionsrumpf bliebe der
    // zweite Abonnent für immer auf `false`.
    const A = await lauscher(["task"], () => {});
    const a = mount(A);
    await new Promise((f) => setTimeout(f, 0));
    FakeEventSource.letzte!.sende("connected", {});
    await a.vm.$nextTick();
    expect(a.text()).toBe("true");

    const B = await lauscher(["note"], () => {});
    const b = mount(B);
    await b.vm.$nextTick();
    expect(b.text(), "der später hinzugekommene Abonnent hält sich für getrennt").toBe("true");

    a.unmount();
    b.unmount();
  });

  it("das Ereignis erreicht genau die Abonnenten seines Typs", async () => {
    const aufgaben: unknown[] = [];
    const notizen: unknown[] = [];
    const A = await lauscher(["task"], (e) => aufgaben.push(e));
    const B = await lauscher(["note"], (e) => notizen.push(e));

    const a = mount(A);
    const b = mount(B);
    await new Promise((f) => setTimeout(f, 0));

    FakeEventSource.letzte!.sende("task", { type: "task", action: "updated", id: "1" });
    expect(aufgaben).toHaveLength(1);
    expect(notizen).toHaveLength(0);

    a.unmount();
    b.unmount();
  });

  it("nach erschöpften Versuchen bringt ein online-Ereignis die Verbindung zurück", async () => {
    // ⚠ Der stillste der beiden Dauerzustände: Nach zehn Fehlversuchen wurde
    // kein Timer mehr gesetzt, und der Zähler fiel nur bei `nutzer === 0`
    // zurück — was im angemeldeten Betrieb nie eintritt, weil die
    // Navigationsleiste immer montiert ist. Nach einem Serverneustart von mehr
    // als rund fünfeinhalb Minuten waren die Live-Updates für den Rest der
    // Sitzung tot; erst F5 half.
    vi.useFakeTimers();
    try {
      const A = await lauscher(["task"], () => {});
      const a = mount(A);
      await vi.advanceTimersByTimeAsync(0);

      // Zehnmal scheitern lassen — danach plant der Code keinen Versuch mehr.
      for (let i = 0; i < 12; i++) {
        FakeEventSource.letzte?.onerror?.();
        await vi.advanceTimersByTimeAsync(70_000);
      }
      const nachAufgabe = FakeEventSource.erzeugt;

      // Der Server ist zurück.
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(0);

      expect(FakeEventSource.erzeugt, "nach dem online-Ereignis wurde nicht neu verbunden").toBeGreaterThan(
        nachAufgabe,
      );
      a.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("die Verbindung bleibt, solange noch jemand lauscht", async () => {
    const A = await lauscher(["task"], () => {});
    const B = await lauscher(["note"], () => {});
    const a = mount(A);
    const b = mount(B);
    await new Promise((f) => setTimeout(f, 0));
    expect(FakeEventSource.offen).toBe(1);

    // Ein Ansichtswechsel: eine Komponente geht, die Navigationsleiste bleibt.
    a.unmount();
    expect(FakeEventSource.offen, "die Verbindung wurde zu früh abgebaut").toBe(1);

    b.unmount();
    expect(FakeEventSource.offen, "nach der letzten Komponente bleibt sie offen").toBe(0);
  });
});
