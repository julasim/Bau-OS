// ============================================================
// PATIO Workspace v2 — Shell-State (Phase 7c)
// ============================================================
// Globaler Singleton fuer Variant, Density
// (compact/cozy), Rail/List-Collapsed-States. Persistiert in
// localStorage + synct ueber Tabs via storage-event.
// ============================================================

import { ref, watch } from "vue";

// SIMA ist der einzige Look — die frühere Variante "atelier" ist entfernt.
// Grund: das übernommene Stylesheet kennt nur noch
// `.app-v2[data-variant="studio"]`. Bliebe der Typ weit, könnte der Zustand
// einen Wert annehmen, für den es keine einzige Regel gibt — die Oberfläche
// stünde dann ohne Farben da, ohne dass irgendwo ein Fehler auftaucht.
export type Variant = "studio";
export type Density = "compact" | "cozy";

interface ShellState {
  variant: Variant;
  density: Density;
  railCollapsed: boolean;
  listCollapsed: boolean;
}

const DEFAULTS: ShellState = {
  variant: "studio",
  density: "compact",
  railCollapsed: false,
  listCollapsed: false,
};

const STORAGE_KEY = "patio-shell-v2";

function loadState(): ShellState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ShellState>;
    return {
      // Fest auf "studio": ein alter localStorage-Eintrag mit "atelier"
      // würde sonst als ungültiger Wert im Zustand hängen bleiben.
      variant: "studio",
      density: parsed.density === "cozy" ? "cozy" : "compact",
      railCollapsed: parsed.railCollapsed === true,
      listCollapsed: parsed.listCollapsed === true,
    };
  } catch {
    return DEFAULTS;
  }
}

const state = ref<ShellState>(loadState());

// Ephemerer Mobile-Zustand: ob die NavRail als Overlay offen ist (<=768px).
// BEWUSST nicht persistiert und nicht Teil von ShellState — reiner
// Session-UI-Zustand, der beim Navigieren/Resize wieder zugeht.
const railMobileOpen = ref(false);
// Zweites Overlay fuer schmale Bildschirme: die Listenspalte. Ohne dieses
// Gegenstueck waere sie unter 768px nicht erreichbar — die CSS-Regel dafuer
// kam mit dem uebernommenen Stylesheet mit, der Umschalter fehlte.
const listMobileOpen = ref(false);

watch(
  state,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* QuotaExceeded */
    }
  },
  { deep: true },
);

// Cross-tab sync.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      state.value = JSON.parse(e.newValue);
    } catch {
      /* malformed */
    }
  }
});

export function useWorkspaceShell() {
  return {
    state,
    railMobileOpen,
    listMobileOpen,
    toggleRailMobile() {
      railMobileOpen.value = !railMobileOpen.value;
    },
    closeRailMobile() {
      railMobileOpen.value = false;
    },
    toggleListMobile() {
      listMobileOpen.value = !listMobileOpen.value;
    },
    closeListMobile() {
      listMobileOpen.value = false;
    },
    setDensity(d: Density) {
      state.value.density = d;
    },
    toggleRail() {
      state.value.railCollapsed = !state.value.railCollapsed;
    },
    toggleList() {
      state.value.listCollapsed = !state.value.listCollapsed;
    },
  };
}
