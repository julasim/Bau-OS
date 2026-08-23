// ============================================================
// PATIO — User-UI-Praeferenzen-Repository (Phase 6f)
// ============================================================

import { getDb } from "../db/client.js";

export type ThemeMode = "light" | "dark" | "system";
export type FontSize = "small" | "medium" | "large";
export type WeekStart = "monday" | "sunday";
export type CalendarView = "month" | "week" | "day" | "list";
export type DateFormat = "DD.MM.YYYY" | "YYYY-MM-DD";

export interface UiPreferences {
  theme: ThemeMode;
  accentColor: string;
  fontSize: FontSize;
  compactUI: boolean;
  weekStart: WeekStart;
  calendarDefaultView: CalendarView;
  dateFormat: DateFormat;
  /** Welche Ereignisse eine Meldung ausloesen sollen.
   *
   *  ── Warum das Feld frueher `telegramNotifications` hiess ────────────────
   *
   *  Weil es aus der Bot-Zeit stammt: die Meldungen gingen per Telegram
   *  hinaus. Den Bot gibt es seit AP0 nicht mehr, das Feld wurde im Frontend
   *  nie gelesen — und der Deep-Merge in `updateUiPreferences()` existiert
   *  ausschliesslich seinetwegen.
   *
   *  Statt es zu loeschen ist es umbenannt: die Struktur (je Person, je
   *  Ereignisart) ist genau das, was die Benachrichtigungen brauchen — nur
   *  eben ueber die Glocke im Programm statt ueber einen Messenger. Alte
   *  Werte werden beim Lesen uebernommen (siehe `getUiPreferences`). */
  benachrichtigungen: {
    termine: boolean;
    tasks: boolean;
    meetings: boolean;
    bautagebuch: boolean;
  };
}

export const DEFAULT_PREFERENCES: UiPreferences = {
  theme: "system",
  accentColor: "#111827",
  fontSize: "medium",
  compactUI: false,
  weekStart: "monday",
  calendarDefaultView: "month",
  dateFormat: "DD.MM.YYYY",
  benachrichtigungen: {
    termine: true,
    tasks: true,
    meetings: true,
    bautagebuch: false,
  },
};

/** Liest die Praeferenzen eines Users + merged mit Defaults damit
 *  fehlende Keys (z.B. neu hinzugefuegte Preferences) gefuellt sind. */
export async function getUiPreferences(userId: string): Promise<UiPreferences> {
  const db = getDb();
  const [row] = await db`SELECT ui_preferences FROM users WHERE id = ${userId}`;
  if (!row) return DEFAULT_PREFERENCES;
  const raw = (row.ui_preferences ?? {}) as Partial<UiPreferences> & {
    benachrichtigungen?: Partial<UiPreferences["benachrichtigungen"]>;
    /** Der alte Name. Steht so in den gespeicherten Praeferenzen jedes
     *  Kontos, das vor der Umbenennung angelegt wurde. */
    telegramNotifications?: Partial<UiPreferences["benachrichtigungen"]>;
  };
  // Alter Name gewinnt nur, wenn der neue fehlt — sonst wuerde ein Konto, das
  // die Einstellung neu gesetzt hat, beim naechsten Lesen wieder den alten
  // Stand bekommen.
  const meldungen = raw.benachrichtigungen ?? raw.telegramNotifications ?? {};
  return {
    theme: (raw.theme ?? DEFAULT_PREFERENCES.theme) as ThemeMode,
    accentColor: raw.accentColor ?? DEFAULT_PREFERENCES.accentColor,
    fontSize: (raw.fontSize ?? DEFAULT_PREFERENCES.fontSize) as FontSize,
    compactUI: raw.compactUI === true,
    weekStart: (raw.weekStart ?? DEFAULT_PREFERENCES.weekStart) as WeekStart,
    calendarDefaultView: (raw.calendarDefaultView ?? DEFAULT_PREFERENCES.calendarDefaultView) as CalendarView,
    dateFormat: (raw.dateFormat ?? DEFAULT_PREFERENCES.dateFormat) as DateFormat,
    benachrichtigungen: {
      termine: meldungen.termine ?? DEFAULT_PREFERENCES.benachrichtigungen.termine,
      tasks: meldungen.tasks ?? DEFAULT_PREFERENCES.benachrichtigungen.tasks,
      meetings: meldungen.meetings ?? DEFAULT_PREFERENCES.benachrichtigungen.meetings,
      bautagebuch: meldungen.bautagebuch ?? DEFAULT_PREFERENCES.benachrichtigungen.bautagebuch,
    },
  };
}

/** Aktualisiert die Praeferenzen mit einem Patch — Deep-Merge fuer die
 *  Benachrichtigungen, damit der Aufrufer einen einzelnen Schalter senden kann
 *  ohne die anderen mitzuschicken. */
export async function updateUiPreferences(
  userId: string,
  patch: Partial<UiPreferences> & {
    benachrichtigungen?: Partial<UiPreferences["benachrichtigungen"]>;
  },
): Promise<UiPreferences> {
  const db = getDb();
  const current = await getUiPreferences(userId);
  const next: UiPreferences = {
    ...current,
    ...patch,
    benachrichtigungen: {
      ...current.benachrichtigungen,
      ...(patch.benachrichtigungen ?? {}),
    },
  };
  // postgres.js' JSONValue-Constraint ist sehr eng (Index-Signature + nicht-Date),
  // typisierte Interfaces matchen nicht. `as never` umgeht das ohne Lauffzeit-
  // Effekt — db.json akzeptiert beliebige JSON-serialisierbare Werte.
  await db`UPDATE users SET ui_preferences = ${db.json(next as never)} WHERE id = ${userId}`;
  return next;
}
