// ============================================================
// Bau-OS — Theme (hell / dunkel)
// Minimaler Store ohne Pinia: global singleton, persistiert in
// localStorage, setzt `.dark` auf <html>, reagiert auf OS-Preference
// nur beim allerersten Start (wenn noch nichts gewaehlt wurde).
// ============================================================

import { ref, watch } from "vue";

const STORAGE_KEY = "bau-os-theme";
type Theme = "light" | "dark";

function resolveInitial(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const theme = ref<Theme>(resolveInitial());

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// Initial direkt anwenden (vor dem ersten Render)
apply(theme.value);

watch(theme, (t) => {
  apply(t);
  localStorage.setItem(STORAGE_KEY, t);
});

export function useTheme() {
  return {
    theme,
    isDark: () => theme.value === "dark",
    toggle: () => {
      theme.value = theme.value === "dark" ? "light" : "dark";
    },
    set: (t: Theme) => {
      theme.value = t;
    },
  };
}
