<script setup lang="ts">
// ============================================================
// PATIO — AppTopbar (globale Leiste über der Inhaltsspalte)
// ============================================================
// Sitzt oben IN der Inhaltsspalte, nicht als Grid-Zeile über allem — sonst
// wären Navigationsleiste und Listenspalte nicht mehr voll hoch.
//
// Sie trägt den einzigen Brotkrumen der Anwendung (Firma / Bereich) und die
// beiden Umschalter, die sonst nirgends erreichbar wären.
//
// ── Was hier gegenüber PATIO Desktop ANDERS ist ─────────────────────────────
//
// * **Kein Abmelden-Knopf.** Der sitzt im Server bereits unten in der
//   Navigationsleiste (`NavRail.vue`). Zwei Abmelde-Knöpfe wären keine
//   Verbesserung, und der Desktop hängt seinen zusätzlich an eine Route
//   `/auth/status`, die es hier gar nicht gibt — die Anmeldung ist auf dem
//   Firmenserver Pflicht, kein Ansichtsfilter.
// * **Die Firma kommt aus `companyName`**, nicht aus `firma`: so heißt das
//   Feld in der Antwort von `GET /branding` (`src/api/routes/branding.ts`).
// * **Die Bereichsnamen decken die Server-Routen ab** — der Server hat neun
//   Ansichten, die der Desktop nicht kennt (Nutzer, Audit, Sicherung, Firmen,
//   Dateien, Kalender, Suche, Projekte, Portfolio).
// ============================================================

import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBranding } from "../../composables/useBranding";
import { useTheme } from "../../composables/useTheme";
import BIcon from "../BIcon.vue";

const route = useRoute();
const router = useRouter();
const { prefs, isDark, toggle: toggleTheme, toggleSidebarTheme } = useTheme();

/** Bereichsname je Route. Fehlt ein Eintrag, bleibt der Brotkrumen einteilig —
 *  besser als ein technischer Routenname in der Oberfläche. */
const BEREICH: Record<string, string> = {
  dashboard: "Dashboard",
  tasks: "Aufgaben",
  calendar: "Termine",
  notes: "Notizen",
  projects: "Projekte",
  portfolio: "Portfolio",
  "project-detail": "Projekt",
  team: "Team",
  firmen: "Firmen",
  files: "Dateien",
  search: "Suche",
  aktivitaet: "Aktivität",
  papierkorb: "Papierkorb",
  settings: "Einstellungen",
  "admin-users": "Nutzer",
  "admin-audit": "Audit-Log",
  "admin-sicherung": "Sicherung",
};

const projektName = computed(() => decodeURIComponent((route.params.name as string) ?? ""));
const bereich = computed(() => {
  // Im Projekt steht der Projektname selbst da — er sagt mehr als „Projekt".
  if (route.name === "project-detail" && projektName.value) return projektName.value;
  return BEREICH[String(route.name ?? "")] ?? "";
});

// Firmenname aus dem Branding — ueber die GETEILTE Quelle, die auch die
// Navigationsleiste nutzt. Ohne sie laedt jeder Baustein denselben Wert
// selbst, und `/branding` wird bei jedem Seitenaufbau doppelt geholt.
// Schlaegt der Aufruf fehl (Dienst noch nicht oben), bleibt „PATIO" stehen —
// ein leerer Brotkrumen saehe nach einem Fehler aus.
const { branding, ensureBranding } = useBranding();
const firma = computed(() => branding.value.companyName || "PATIO");
onMounted(() => void ensureBranding());

const seitenleisteHell = computed(() => prefs.value.sidebarTheme === "light");

function neueAufgabe() {
  void router.push("/tasks");
}
</script>

<template>
  <header class="ap-topbar">
    <nav class="ap-crumb" aria-label="Brotkrumen">
      <span class="ap-crumb-root">{{ firma }}</span>
      <template v-if="bereich">
        <BIcon name="chevronRight" :size="13" class="ap-crumb-sep" />
        <span class="ap-crumb-here">{{ bereich }}</span>
      </template>
    </nav>

    <div class="ap-topbar-spacer"></div>

    <button
      type="button"
      class="ap-iconbtn"
      :title="seitenleisteHell ? 'Seitenleiste dunkel' : 'Seitenleiste hell'"
      :aria-label="seitenleisteHell ? 'Seitenleiste dunkel schalten' : 'Seitenleiste hell schalten'"
      @click="toggleSidebarTheme"
    >
      <BIcon name="layers" :size="16" />
    </button>
    <button
      type="button"
      class="ap-iconbtn"
      :title="isDark() ? 'Zu Hell-Modus' : 'Zu Dunkel-Modus'"
      :aria-label="isDark() ? 'Zu Hell-Modus wechseln' : 'Zu Dunkel-Modus wechseln'"
      @click="toggleTheme"
    >
      <BIcon :name="isDark() ? 'sun' : 'moon'" :size="16" />
    </button>

    <span class="ap-topbar-div" aria-hidden="true"></span>

    <button type="button" class="ap-topbar-btn" title="Neue Aufgabe" @click="neueAufgabe">
      <BIcon name="plus" :size="15" />
      <span>Aufgabe</span>
    </button>
  </header>
</template>

<style scoped>
.ap-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--nav-height, 56px);
  flex-shrink: 0;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}
.ap-crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--fs-13, 13px);
}
.ap-crumb-root {
  color: var(--muted);
  white-space: nowrap;
}
.ap-crumb-sep {
  color: var(--subtle);
  flex: none;
}
.ap-crumb-here {
  color: var(--fg);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-topbar-spacer {
  flex: 1;
}
.ap-iconbtn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md, 7px);
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--muted);
  transition:
    background-color 120ms ease,
    color 120ms ease;
}
.ap-iconbtn:hover {
  background: var(--surface-subtle);
  color: var(--fg);
}
.ap-topbar-div {
  width: 1px;
  height: 20px;
  background: var(--line);
  margin: 0 4px;
}
.ap-topbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-md, 7px);
  border: 0;
  background: var(--fg);
  color: var(--surface);
  font-size: var(--fs-13, 13px);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 120ms ease;
}
.ap-topbar-btn:hover {
  opacity: 0.86;
}
.ap-topbar-btn svg {
  flex: none;
}
</style>
