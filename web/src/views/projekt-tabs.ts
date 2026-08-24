// ============================================================
// PATIO — Die Reiter der Projektakte, an einer Stelle
// ============================================================
// EINZIGE Quelle für die Frage „welche Reiter hat ein Projekt". Genutzt von
//   - `ProjectDetailView.vue` (was intern umschaltbar ist),
//   - `components/shell/ContextSidebar.vue` (was in der Leiste steht).
//
// ── Warum das eine eigene Datei ist ────────────────────────────────────────
//
// Vorher standen die Reiter zweimal: als `VALID_TABS` in der Ansicht und als
// `PROJECT_NAV` in der Navigationsleiste. Beide Listen mussten deckungsgleich
// bleiben, und wenn sie es nicht waren, fiel das durch jede Prüfung: ein
// Eintrag ohne Gegenstück setzt `?tab=`, die Ansicht fällt intern auf
// „uebersicht" zurück — und die Leiste markiert den Eintrag trotzdem als
// aktiv. Der Nutzer klickt auf „Stunden" und liest die Übersicht.
//
// Jetzt gibt es nur noch diese Liste; `VALID_TABS` wird daraus abgeleitet.
// Ein Auseinanderlaufen ist damit nicht mehr möglich, sondern ein Typfehler.
// ============================================================

export interface ProjektReiter {
  /** Wert von `?tab=` und interner Schlüssel der Ansicht. */
  key: string;
  label: string;
  icon: string;
  /** Überschrift in der Kontext-Leiste. */
  gruppe: "Projekt" | "Kaufmännisch" | "Dokumentation" | "Beteiligte";
  /** Nur für die Verwaltung. */
  adminOnly?: boolean;
  /** Braucht das Geld-Recht (Migration 043). Der Reiter ist von vorne bis
   *  hinten Honorar und Betrag; ohne das Recht antwortet der Server mit 403,
   *  und ein Reiter, der nur eine Fehlermeldung zeigt, gehört nicht in die
   *  Leiste. */
  geldOnly?: boolean;
}

export const PROJEKT_REITER: ProjektReiter[] = [
  { key: "uebersicht", label: "Übersicht", icon: "grid", gruppe: "Projekt" },
  { key: "phasen", label: "Phasen", icon: "timeline", gruppe: "Projekt" },
  { key: "termine", label: "Termine", icon: "calendar", gruppe: "Projekt" },
  { key: "tasks", label: "Aufgaben", icon: "check", gruppe: "Projekt" },

  { key: "rechnungen", label: "Rechnungen", icon: "archive", gruppe: "Kaufmännisch", geldOnly: true },
  { key: "stunden", label: "Stunden", icon: "clock", gruppe: "Kaufmännisch" },

  { key: "notes", label: "Notizen", icon: "pencil", gruppe: "Dokumentation" },
  { key: "bautagebuch", label: "Bautagebuch", icon: "book", gruppe: "Dokumentation" },
  { key: "meetings", label: "Meetings", icon: "kanban", gruppe: "Dokumentation" },
  { key: "entscheidungen", label: "Entscheidungen", icon: "list", gruppe: "Dokumentation" },
  { key: "files", label: "Dateien", icon: "file", gruppe: "Dokumentation" },

  { key: "team", label: "Team", icon: "users", gruppe: "Beteiligte" },
  { key: "zugriff", label: "Zugriff", icon: "lock", gruppe: "Beteiligte", adminOnly: true },
];

/** Reihenfolge der Gruppen in der Kontext-Leiste. */
export const PROJEKT_GRUPPEN: ProjektReiter["gruppe"][] = ["Projekt", "Kaufmännisch", "Dokumentation", "Beteiligte"];

export type ProjektTab = (typeof PROJEKT_REITER)[number]["key"];

/** Alle gültigen Werte von `?tab=` — abgeleitet, nicht abgeschrieben. */
export const VALID_TABS: string[] = PROJEKT_REITER.map((r) => r.key);

export function istProjektTab(t: unknown): t is ProjektTab {
  return typeof t === "string" && VALID_TABS.includes(t);
}

/**
 * Filtert die Reiter nach den Rechten des angemeldeten Kontos.
 *
 * Steht hier und nicht in der Leiste, weil beide Seiten sie brauchen: was der
 * Nutzer nicht anklicken kann, soll er auch per Adresszeile nicht als aktiven
 * Reiter markiert bekommen.
 */
export function sichtbareReiter(istAdmin: boolean, darfGeld: boolean): ProjektReiter[] {
  return PROJEKT_REITER.filter((r) => (!r.adminOnly || istAdmin) && (!r.geldOnly || darfGeld));
}
