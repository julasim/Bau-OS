// ============================================================
// PATIO — User-UI-Praeferenzen-Repository (Phase 6f)
// ============================================================

import { getDb } from "../db/client.js";
import { DB_ENABLED } from "../config.js";

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
  telegramNotifications: {
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
  telegramNotifications: {
    termine: true,
    tasks: true,
    meetings: true,
    bautagebuch: false,
  },
};

/** Liest die Praeferenzen eines Users + merged mit Defaults damit
 *  fehlende Keys (z.B. neu hinzugefuegte Preferences) gefuellt sind. */
export async function getUiPreferences(userId: string): Promise<UiPreferences> {
  if (!DB_ENABLED) return DEFAULT_PREFERENCES;
  const db = getDb();
  const [row] = await db`SELECT ui_preferences FROM users WHERE id = ${userId}`;
  if (!row) return DEFAULT_PREFERENCES;
  const raw = (row.ui_preferences ?? {}) as Partial<UiPreferences> & {
    telegramNotifications?: Partial<UiPreferences["telegramNotifications"]>;
  };
  return {
    theme: (raw.theme ?? DEFAULT_PREFERENCES.theme) as ThemeMode,
    accentColor: raw.accentColor ?? DEFAULT_PREFERENCES.accentColor,
    fontSize: (raw.fontSize ?? DEFAULT_PREFERENCES.fontSize) as FontSize,
    compactUI: raw.compactUI === true,
    weekStart: (raw.weekStart ?? DEFAULT_PREFERENCES.weekStart) as WeekStart,
    calendarDefaultView: (raw.calendarDefaultView ?? DEFAULT_PREFERENCES.calendarDefaultView) as CalendarView,
    dateFormat: (raw.dateFormat ?? DEFAULT_PREFERENCES.dateFormat) as DateFormat,
    telegramNotifications: {
      termine: raw.telegramNotifications?.termine ?? DEFAULT_PREFERENCES.telegramNotifications.termine,
      tasks: raw.telegramNotifications?.tasks ?? DEFAULT_PREFERENCES.telegramNotifications.tasks,
      meetings: raw.telegramNotifications?.meetings ?? DEFAULT_PREFERENCES.telegramNotifications.meetings,
      bautagebuch: raw.telegramNotifications?.bautagebuch ?? DEFAULT_PREFERENCES.telegramNotifications.bautagebuch,
    },
  };
}

/** Updated die Praeferenzen mit einem Patch — Deep-Merge fuer das
 *  telegramNotifications-Sub-Object damit der User nur einen Toggle
 *  schicken muss ohne die anderen mitzusenden. */
export async function updateUiPreferences(
  userId: string,
  patch: Partial<UiPreferences> & {
    telegramNotifications?: Partial<UiPreferences["telegramNotifications"]>;
  },
): Promise<UiPreferences> {
  if (!DB_ENABLED) return DEFAULT_PREFERENCES;
  const db = getDb();
  const current = await getUiPreferences(userId);
  const next: UiPreferences = {
    ...current,
    ...patch,
    telegramNotifications: {
      ...current.telegramNotifications,
      ...(patch.telegramNotifications ?? {}),
    },
  };
  // postgres.js' JSONValue-Constraint ist sehr eng (Index-Signature + nicht-Date),
  // typisierte Interfaces matchen nicht. `as never` umgeht das ohne Lauffzeit-
  // Effekt — db.json akzeptiert beliebige JSON-serialisierbare Werte.
  await db`UPDATE users SET ui_preferences = ${db.json(next as never)} WHERE id = ${userId}`;
  return next;
}
