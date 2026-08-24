// ============================================================
// PATIO — Die Bereiche der Einstellungen, an einer Stelle
// ============================================================
// EINZIGE Quelle für die Frage „welche Bereiche haben die Einstellungen".
// Genutzt von `SettingsView.vue` (was gerendert wird) und von
// `components/shell/ContextSidebar.vue` (was in der Leiste steht).
//
// Aus demselben Grund ausgelagert wie `projekt-tabs.ts`: zwei Listen, die
// deckungsgleich bleiben müssen, laufen irgendwann auseinander — und der
// Fehler ist unsichtbar, weil die Leiste den Eintrag trotzdem aktiv markiert.
// ============================================================

export type SettingsSection =
  | "profil"
  | "praeferenzen"
  | "branding"
  | "vorlagen"
  | "word-export"
  | "projekt-module"
  | "positionskatalog"
  | "ki-freigabe"
  | "system";

export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: string;
  group: string;
  adminOnly?: boolean;
  geldOnly?: boolean;
}

// `adminOnly` deckt sich mit dem Serverstand: diese vier Bereiche gelten fuers
// ganze Buero (Logo, Textbausteine, Word-Vorlagen, Modul-Voreinstellungen) und
// duerfen seit der Rechte-Runde nur noch vom Verwalter geaendert werden.
// Ohne diese Kennzeichnung saehe ein normaler Nutzer weiterhin alle Knoepfe —
// und liefe beim Klick in ein unerklaertes „Kein Zugriff".
export const SETTINGS_NAV: SettingsNavItem[] = [
  { id: "profil", label: "Profil & Sicherheit", icon: "user", group: "Konto" },
  { id: "praeferenzen", label: "Präferenzen", icon: "sliders", group: "System" },
  { id: "branding", label: "Branding", icon: "image", group: "Vorlagen", adminOnly: true },
  { id: "vorlagen", label: "Vorlagen", icon: "file-text", group: "Vorlagen", adminOnly: true },
  { id: "word-export", label: "Word-Export", icon: "download", group: "Vorlagen", adminOnly: true },
  { id: "projekt-module", label: "Projekt-Module", icon: "layers", group: "Vorlagen", adminOnly: true },
  // Der Katalog haengt am Geld-Recht, nicht an der Rolle: er besteht aus
  // Preisen. Ein Admin ohne Geld-Recht gibt es nicht (er ist implizit
  // berechtigt), ein Buchhalter ohne Admin-Rechte sehr wohl.
  { id: "positionskatalog", label: "Positionskatalog", icon: "archive", group: "Vorlagen", geldOnly: true },
  // Was ein Sprachmodell sehen darf, ist eine Datenschutz-Entscheidung fuers
  // Buero — nicht die Praeferenz eines Arbeitsplatzes. Deshalb adminOnly.
  { id: "ki-freigabe", label: "KI-Zugriff", icon: "cpu", group: "System", adminOnly: true },
  { id: "system", label: "System-Info", icon: "info", group: "System" },
];

/** Bereiche, die das Konto tatsächlich öffnen darf. */
export function sichtbareSektionen(istAdmin: boolean, darfGeld: boolean): SettingsNavItem[] {
  return SETTINGS_NAV.filter((n) => (istAdmin || !n.adminOnly) && (darfGeld || !n.geldOnly));
}

/** Nach Gruppen gebündelt, in der Reihenfolge des ersten Auftretens. */
export function nachGruppen(items: SettingsNavItem[]): { group: string; items: SettingsNavItem[] }[] {
  const map = new Map<string, SettingsNavItem[]>();
  for (const item of items) {
    if (!map.has(item.group)) map.set(item.group, []);
    map.get(item.group)!.push(item);
  }
  return Array.from(map.entries()).map(([group, list]) => ({ group, items: list }));
}

/**
 * Muss der angezeigte Bereich gewechselt werden?
 *
 * Gibt den Ersatzbereich zurück, wenn das Konto den gewünschten nicht öffnen
 * darf — sonst `null` (nichts zu tun).
 *
 * ── Warum `geladen` der Kern dieser Funktion ist ──────────────────────────
 *
 * `/auth/me` kommt asynchron. Bis die Antwort da ist, sind `istAdmin` und
 * `darfGeld` beide `false`, und das ist von „darf wirklich nicht" nicht zu
 * unterscheiden. Ohne die Abfrage wirft der Wächter jeden Verwalter aus einem
 * per Lesezeichen geöffneten `?sektion=branding` — samt Adresse, sodass auch
 * „Zurück" nichts mehr hilft. Genau das war der erste Bau (im Browser
 * nachgestellt: `?sektion=ki-freigabe` landete nach 900 ms auf `/settings`).
 */
export function bereichNachRechten(
  gewuenscht: string,
  geladen: boolean,
  istAdmin: boolean,
  darfGeld: boolean,
): SettingsSection | null {
  if (!geladen) return null;
  if (sichtbareSektionen(istAdmin, darfGeld).some((n) => n.id === gewuenscht)) return null;
  return "profil";
}
