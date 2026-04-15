// ============================================================
// Bau-OS — Supabase Realtime → Event Bus Bridge
// Leitet PostgreSQL-Aenderungen (via Supabase Realtime) an den
// internen Event-Bus weiter, damit SSE-Clients sie empfangen.
// ============================================================

import { SUPABASE_ENABLED } from "../config.js";
import { logInfo, logError } from "../logger.js";
import { emit } from "./events.js";

const WATCHED_TABLES = ["tasks", "termine", "notes", "projects", "files", "team_members"] as const;

type TableName = (typeof WATCHED_TABLES)[number];

// Bridge-Status fuer /dashboard/db-status
let bridgeState: {
  active: boolean;
  startedAt: string | null;
  tables: number;
  lastError: string | null;
} = {
  active: false,
  startedAt: null,
  tables: 0,
  lastError: null,
};

export function getRealtimeBridgeStatus(): typeof bridgeState {
  return { ...bridgeState };
}

const tableToEventType: Record<TableName, "task" | "termin" | "note" | "project" | "file" | "team"> = {
  tasks: "task",
  termine: "termin",
  notes: "note",
  projects: "project",
  files: "file",
  team_members: "team",
};

/**
 * Startet die Supabase Realtime Bridge.
 * Subscribed auf alle relevanten Tabellen und leitet Aenderungen an den Event-Bus.
 * Nur aktiv wenn SUPABASE_ENABLED=true.
 */
export async function startRealtimeBridge(): Promise<void> {
  if (!SUPABASE_ENABLED) {
    bridgeState = { active: false, startedAt: null, tables: 0, lastError: null };
    return;
  }

  try {
    const { subscribeToTable } = await import("../db/supabase.js");

    for (const table of WATCHED_TABLES) {
      subscribeToTable(table, (payload: unknown) => {
        const p = payload as { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> };
        const eventType = tableToEventType[table];
        const action =
          p.eventType === "INSERT"
            ? "created"
            : p.eventType === "UPDATE"
              ? "updated"
              : p.eventType === "DELETE"
                ? "deleted"
                : "updated";

        const record = p.new || p.old;
        emit({
          type: eventType,
          action,
          id: record?.id ? String(record.id) : undefined,
          data: record as Record<string, unknown> | undefined,
        });
      });
    }

    bridgeState = {
      active: true,
      startedAt: new Date().toISOString(),
      tables: WATCHED_TABLES.length,
      lastError: null,
    };
    logInfo(`[Realtime] Supabase Bridge aktiv fuer ${WATCHED_TABLES.length} Tabellen`);
  } catch (err) {
    bridgeState = {
      active: false,
      startedAt: null,
      tables: 0,
      lastError: err instanceof Error ? err.message : String(err),
    };
    logError("[Realtime] Bridge-Start fehlgeschlagen", err);
  }
}
