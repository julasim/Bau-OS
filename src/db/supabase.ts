// ============================================================
// Bau-OS — Supabase JS Client
// Fuer Realtime Subscriptions, Storage und Supabase Auth.
// Direktes SQL laeuft ueber client.ts (postgres.js).
// ============================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, SUPABASE_ENABLED } from "../config.js";
import { logInfo } from "../logger.js";

let client: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

/**
 * Server-seitiger Supabase Client (Service Role Key).
 * Hat vollen Zugriff auf alle Tabellen — nur im Backend verwenden.
 */
export function getSupabase(): SupabaseClient {
  if (!SUPABASE_ENABLED) {
    throw new Error("Supabase nicht konfiguriert. Setze SUPABASE_URL + SUPABASE_ANON_KEY in .env");
  }
  if (!client) {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    client = createClient(SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    logInfo("[Supabase] Client erstellt (Service Role)");
  }
  return client;
}

/**
 * Client-seitiger Supabase Client (Anon Key).
 * Fuer Realtime Subscriptions im Frontend.
 */
export function getSupabaseAnon(): SupabaseClient {
  if (!SUPABASE_ENABLED) {
    throw new Error("Supabase nicht konfiguriert");
  }
  if (!anonClient) {
    anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    logInfo("[Supabase] Anon Client erstellt");
  }
  return anonClient;
}

/**
 * Supabase Realtime: Subscribe auf Tabellen-Aenderungen.
 * Gibt den Channel zurueck fuer spaeteres Unsubscribe.
 */
export function subscribeToTable(table: string, callback: (payload: unknown) => void) {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`db-${table}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
      callback(payload);
    })
    .subscribe();

  return channel;
}

/**
 * Health Check fuer Supabase Verbindung.
 */
export async function checkSupabaseHealth(): Promise<boolean> {
  if (!SUPABASE_ENABLED) return false;
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("_migrations").select("id").limit(1);
    // Tabelle existiert vielleicht noch nicht, aber Verbindung funktioniert
    return !error || error.code === "42P01"; // 42P01 = table does not exist = OK
  } catch {
    return false;
  }
}
