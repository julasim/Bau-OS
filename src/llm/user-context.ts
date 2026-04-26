// ============================================================
// Bau-OS — LLM User-Context (Phase 6)
// ============================================================
// AsyncLocalStorage-basierter Kontext fuer den User, in dessen Namen das
// LLM gerade laeuft. Wird vom Bot-Wrapper bzw. von der /chat-API gesetzt
// und von Tool-Handlern gelesen, um Repo-Aufrufe zu scopen.
//
// Warum AsyncLocalStorage und nicht Parameter-Threading?
//   - processMessage → processAgent → executor → handler ist tief verkettet.
//     Die Tool-Handler-Signatur ist via OpenAI/JSON-Schema fix definiert.
//   - AsyncLocalStorage ist Concurrency-safe (anders als modul-level state).
//     Zwei parallele LLM-Calls in unterschiedlichen Async-Chains stoeren
//     sich nicht gegenseitig.
//   - Bot-Wrapper kann mit runWithUserCtx(ctx, () => processMessage(...))
//     den ganzen Call-Tree atomar in einen User-Kontext einbetten.
// ============================================================

import { AsyncLocalStorage } from "async_hooks";
import type { UserCtx } from "../data/access.js";

const storage = new AsyncLocalStorage<UserCtx>();

/** Fuehrt fn innerhalb eines User-Kontextes aus. Alle async-Aufrufe darin
 *  koennen via getCurrentUserCtx() den Kontext lesen. */
export function runWithUserCtx<T>(ctx: UserCtx, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Liefert den aktuellen User-Kontext oder null, wenn der Code ohne
 *  Bot/API-Wrapper laeuft (z.B. Heartbeat, Cron-Jobs). null = "kein
 *  Scoping" → Tools sehen alles wie ein Admin. */
export function getCurrentUserCtx(): UserCtx | null {
  return storage.getStore() ?? null;
}

/** Convenience: liefert userId oder null. */
export function getCurrentUserId(): string | null {
  return storage.getStore()?.userId ?? null;
}

/** Convenience: liefert role oder Default 'admin' (kein Scope = alles). */
export function getCurrentRole(): "admin" | "user" {
  return storage.getStore()?.role ?? "admin";
}
