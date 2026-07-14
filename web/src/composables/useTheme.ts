// ============================================================
// PATIO — Theme + UI-Praeferenzen (Phase 6f)
// ============================================================
// Globaler Singleton-Store fuer User-UI-Settings:
//   - theme: "light" | "dark" | "system" (matchMedia-Watch)
//   - accentColor: hex-Farbe → setzt --color-primary CSS-Var
//   - fontSize: small | medium | large → body-class
//   - compactUI: kleinere Paddings → body-class
//
// Sync-Strategie:
//   1. Initial-Apply aus localStorage (synchron, vor Render — kein FOUC).
//   2. Bei Login: Backend-Werte laden + lokal anwenden + speichern.
//   3. Bei Aenderung in Settings: lokal anwenden + Backend-PATCH.
//   4. Cross-Tab: storage-event-Listener — wenn ein anderer Tab Theme
//      umschaltet, uebernimmt's dieser Tab automatisch.
// ============================================================

import { ref, watch } from "vue";

export type ThemeMode = "light" | "dark" | "system";
export type FontSize = "small" | "medium" | "large";

const STORAGE_KEY = "patio-ui-prefs";

interface LocalPrefs {
  theme: ThemeMode;
  accentColor: string;
  fontSize: FontSize;
  compactUI: boolean;
}

const DEFAULTS: LocalPrefs = {
  theme: "system",
  accentColor: "#111827",
  fontSize: "medium",
  compactUI: false,
};

function loadFromStorage(): LocalPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<LocalPrefs>;
    return {
      theme: parsed.theme ?? DEFAULTS.theme,
      accentColor: parsed.accentColor ?? DEFAULTS.accentColor,
      fontSize: parsed.fontSize ?? DEFAULTS.fontSize,
      compactUI: parsed.compactUI ?? DEFAULTS.compactUI,
    };
  } catch {
    return DEFAULTS;
  }
}

function saveToStorage(p: LocalPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* QuotaExceeded oder Privacy-Mode — wir akzeptieren stilles Scheitern */
  }
}

const prefs = ref<LocalPrefs>(loadFromStorage());

function resolveEffectiveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function apply(p: LocalPrefs): void {
  const root = document.documentElement;
  // Theme (.dark Class)
  const effective = resolveEffectiveTheme(p.theme);
  if (effective === "dark") root.classList.add("dark");
  else root.classList.remove("dark");

  // Akzentfarbe als CSS-Variable. Wenn der User Dark-Mode hat aber eine
  // helle Akzentfarbe ausgewaehlt hat, kollidiert das nicht — die
  // anderen Farben bleiben dem Theme treu, --color-primary ist nur fuer
  // Active-States, Buttons, etc.
  root.style.setProperty("--color-accent", p.accentColor);
  // data-accent-active="true" → CSS ueberschreibt --color-primary mit
  // --color-accent. Bei den Theme-Default-Werten (#111827/#f4f4f5) lassen
  // wir die Theme-Hand → kein UI-Bruch.
  const isDefault = p.accentColor.toLowerCase() === "#111827" || p.accentColor.toLowerCase() === "#f4f4f5";
  root.dataset.accentActive = isDefault ? "false" : "true";

  // Schriftgroesse als data-Attribut + ein paar CSS-Hooks im style.css.
  root.dataset.fontSize = p.fontSize;
  // Compact-UI als data-Attribut
  root.dataset.compact = p.compactUI ? "1" : "0";
}

// Initial sofort anwenden (synchron — kein FOUC bevor Vue mounted)
apply(prefs.value);

// Wenn theme="system": auf OS-Theme-Wechsel reagieren.
const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
if (mq) {
  mq.addEventListener("change", () => {
    if (prefs.value.theme === "system") apply(prefs.value);
  });
}

// Bei lokaler Aenderung anwenden + persistieren.
watch(
  prefs,
  (p) => {
    apply(p);
    saveToStorage(p);
  },
  { deep: true },
);

// Cross-Tab-Sync: andere Tabs bekommen ein Storage-Event sobald sich
// der Eintrag aendert.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      const parsed = JSON.parse(e.newValue) as LocalPrefs;
      prefs.value = parsed;
    } catch {
      /* malformed — ignore */
    }
  }
});

export function useTheme() {
  return {
    /** Reactive ref. Direkt mutieren persistiert + applied automatisch. */
    prefs,

    setTheme(mode: ThemeMode) {
      prefs.value = { ...prefs.value, theme: mode };
    },
    setAccentColor(hex: string) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
      prefs.value = { ...prefs.value, accentColor: hex };
    },
    setFontSize(size: FontSize) {
      prefs.value = { ...prefs.value, fontSize: size };
    },
    setCompactUI(v: boolean) {
      prefs.value = { ...prefs.value, compactUI: v };
    },
    /** Wird bei Login + nach Settings-PATCH gerufen — Backend ist
     *  Source-of-Truth, lokaler State syncen sich an. */
    applyFromServer(remote: Partial<LocalPrefs>) {
      prefs.value = {
        theme: remote.theme ?? prefs.value.theme,
        accentColor: remote.accentColor ?? prefs.value.accentColor,
        fontSize: remote.fontSize ?? prefs.value.fontSize,
        compactUI: remote.compactUI ?? prefs.value.compactUI,
      };
    },

    /** Effektiver Theme-Mode (system → light/dark aufgeloest). */
    isDark: () => resolveEffectiveTheme(prefs.value.theme) === "dark",

    // Backward-compat: alte API
    theme: prefs,
    toggle: () => {
      const next: ThemeMode = resolveEffectiveTheme(prefs.value.theme) === "dark" ? "light" : "dark";
      prefs.value = { ...prefs.value, theme: next };
    },
    set(t: "light" | "dark") {
      prefs.value = { ...prefs.value, theme: t };
    },
  };
}
