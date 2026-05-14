import { describe, it, expect } from "vitest";
import { enqueue, MAX_QUEUE_DEPTH } from "../src/queue.js";

describe("MAX_QUEUE_DEPTH", () => {
  it("ist eine Zahl > 0", () => {
    expect(typeof MAX_QUEUE_DEPTH).toBe("number");
    expect(MAX_QUEUE_DEPTH).toBeGreaterThan(0);
  });

  it("ist exakt 50", () => {
    expect(MAX_QUEUE_DEPTH).toBe(50);
  });
});

describe("enqueue — Sequenzierung", () => {
  it("serialisiert Jobs pro chatId", async () => {
    const order: number[] = [];
    const p1 = enqueue(1, async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    const p2 = enqueue(1, async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("isoliert verschiedene chatIds", async () => {
    const order: number[] = [];
    const p1 = enqueue(1, async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    const p2 = enqueue(2, async () => {
      order.push(2);
    });
    await Promise.all([p1, p2]);
    expect(order).toContain(1);
    expect(order).toContain(2);
  });
});

describe("enqueue — Fehlerbehandlung", () => {
  it("Queue läuft weiter nach Fehler", async () => {
    const order: number[] = [];
    const chatId = 9991;
    // Kontrolliertes Promise: wir rejizieren NACHDEM p1safe angehängt ist
    // → kein unhandled rejection, weil der Handler schon sitzt wenn reject() kommt
    let rejectFn!: (e: Error) => void;
    const controlled = new Promise<void>((_, rej) => {
      rejectFn = rej;
    });
    const p1 = enqueue(chatId, () => controlled);
    const p1safe = p1.catch(() => {}); // Handler SOFORT anhängen
    const p2 = enqueue(chatId, async () => {
      order.push(2);
    });
    // 2 Mikrotask-Ticks abwarten: (1) prev.catch() resolved, (2) .then(fn) setzt Follow-Handler
    // Erst DANN rejectFn aufrufen — sonst hat controlled noch keinen Handler
    await Promise.resolve();
    await Promise.resolve();
    rejectFn(new Error("Fehler!"));
    await p1safe;
    await p2;
    expect(order).toEqual([2]);
  });

  it("fn laeuft genau einmal auch wenn Vorgaenger wirft", async () => {
    let callCount = 0;
    const chatId = 9981;
    let rejectFn!: (e: Error) => void;
    const controlled = new Promise<void>((_, rej) => {
      rejectFn = rej;
    });
    const p1 = enqueue(chatId, () => controlled);
    const p1safe = p1.catch(() => {}); // Handler SOFORT anhängen
    const p2 = enqueue(chatId, async () => {
      callCount++;
    });
    await Promise.resolve();
    await Promise.resolve();
    rejectFn(new Error("err"));
    await p1safe;
    await p2;
    expect(callCount).toBe(1);
  });
});

describe("enqueue — Backpressure", () => {
  it("lehnt bei voller Queue ab", async () => {
    const chatId = 777;
    let release: () => void;
    const blocker = enqueue(
      chatId,
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );

    const jobs: Promise<void>[] = [];
    for (let i = 0; i < MAX_QUEUE_DEPTH - 1; i++) {
      jobs.push(enqueue(chatId, async () => {}));
    }

    await expect(enqueue(chatId, async () => {})).rejects.toThrow();

    release!();
    await blocker.catch(() => {});
    await Promise.allSettled(jobs);
  });

  it("kann nach Abarbeitung wieder befüllt werden", async () => {
    const chatId = 776;
    let release: () => void;
    const blocker = enqueue(
      chatId,
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );

    const jobs: Promise<void>[] = [];
    for (let i = 0; i < MAX_QUEUE_DEPTH - 1; i++) {
      jobs.push(enqueue(chatId, async () => {}));
    }
    // Queue ist voll
    await expect(enqueue(chatId, async () => {})).rejects.toThrow();

    // Abarbeiten lassen
    release!();
    await blocker.catch(() => {});
    await Promise.allSettled(jobs);

    // Jetzt muss enqueue wieder funktionieren
    let ran = false;
    await enqueue(chatId, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe("enqueue — Memory-Cleanup", () => {
  it("blockiert dieselbe chatId nach Abarbeitung nicht dauerhaft", async () => {
    const chatId = 555;
    // Viele Runden nacheinander — wenn die Map nicht bereinigt würde,
    // würde queueDepths irgendwann MAX_QUEUE_DEPTH überschreiten und ablehnen.
    for (let round = 0; round < MAX_QUEUE_DEPTH + 10; round++) {
      let ran = false;
      await enqueue(chatId, async () => {
        ran = true;
      });
      expect(ran).toBe(true);
    }
  });
});
