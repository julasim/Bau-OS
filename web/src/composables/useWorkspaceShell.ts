// ============================================================
// Bau-OS Workspace v2 — Shell-State (Phase 7c)
// ============================================================
// Globaler Singleton fuer Variant (Studio/Atelier), Density
// (compact/cozy), Rail/List-Collapsed-States. Persistiert in
// localStorage + synct ueber Tabs via storage-event.
// ============================================================

import { ref, watch } from "vue";

export type Variant = "studio" | "atelier";
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

const STORAGE_KEY = "bau-os-shell-v2";

function loadState(): ShellState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ShellState>;
    return {
      variant: parsed.variant === "atelier" ? "atelier" : "studio",
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
    toggleRailMobile() {
      railMobileOpen.value = !railMobileOpen.value;
    },
    closeRailMobile() {
      railMobileOpen.value = false;
    },
    setVariant(v: Variant) {
      state.value.variant = v;
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
