// Session-Queue: serialisiert Runs pro Chat-ID
// Verhindert Race Conditions wenn zwei Nachrichten gleichzeitig ankommen
// (z.B. doppelte Aufgaben, konkurrierende Datei-Schreibvorgänge)

const queues = new Map<number, Promise<void>>();
const queueDepths = new Map<number, number>();

/** Maximale Anzahl gleichzeitig wartender Jobs pro Chat */
export const MAX_QUEUE_DEPTH = 50;

export function enqueue(chatId: number, fn: () => Promise<void>): Promise<void> {
  const depth = queueDepths.get(chatId) ?? 0;
  if (depth >= MAX_QUEUE_DEPTH) {
    return Promise.reject(new Error(`Queue voll (${MAX_QUEUE_DEPTH} pending) für Chat ${chatId}`));
  }
  queueDepths.set(chatId, depth + 1);

  const prev = queues.get(chatId) ?? Promise.resolve();

  // fn läuft genau einmal — egal ob prev resolved oder rejected.
  // catch() vorher stellt sicher dass fn immer läuft, unabhängig vom Vorgänger.
  const next = prev.catch(() => {}).then(fn);
  queues.set(chatId, next);

  // Map aufräumen wenn Queue leer ist (kein Memory-Leak)
  next.finally(() => {
    const d = queueDepths.get(chatId) ?? 1;
    if (d <= 1) queueDepths.delete(chatId);
    else queueDepths.set(chatId, d - 1);
    if (queues.get(chatId) === next) queues.delete(chatId);
  });

  return next;
}
