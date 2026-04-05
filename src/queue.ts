// Session-Queue: serialisiert Runs pro Chat-ID
// Verhindert Race Conditions wenn zwei Nachrichten gleichzeitig ankommen
// (z.B. doppelte Aufgaben, konkurrierende Datei-Schreibvorgänge)

const queues = new Map<number, Promise<void>>();

export function enqueue(chatId: number, fn: () => Promise<void>): Promise<void> {
  const prev = queues.get(chatId) ?? Promise.resolve();

  // Auch wenn fn() wirft, läuft die Queue weiter (fn, fn = catch führt fn aus)
  const next = prev.then(fn, fn);
  queues.set(chatId, next);

  // Map aufräumen wenn Queue leer ist (kein Memory-Leak)
  next.finally(() => {
    if (queues.get(chatId) === next) queues.delete(chatId);
  });

  return next;
}
