import { createApp } from "vue";
import "./patio-tokens.css";
import "./patio-components.css";
import "./patio-shell.css";
// Klassen, die mehrere Fach-Ansichten teilen. Stand frueher scoped in je
// einer Ansicht und wirkte dort, wo sie geliehen war, nicht.
import "./patio-fach.css";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";
// Theme beim Start initialisieren (setzt html.dark synchron — kein FOUC)
import { useTheme } from "./composables/useTheme";
useTheme();

// ── Kein Pinia ────────────────────────────────────────────────────────────
//
// Hier stand `app.use(createPinia())`. Einen Store gab es nie — geteilter
// Zustand liegt in Composables (`useEvents`, `useAufgabensystem`,
// `useBranding`, `useTheme`), und das reicht fuer eine Oberflaeche dieser
// Groesse. Registriert, aber leer, hiess nur: die Doku nannte Pinia im Stack,
// und wer einen Store suchte, fand keinen.
const app = createApp(App);
app.use(router);
app.mount("#app");

// Cross-Tab-Logout-Sync: Wenn der Token in einem anderen Tab entfernt wird
// (z.B. durch Logout), wird dieser Tab sofort zur Login-Seite weitergeleitet.
window.addEventListener("storage", (e) => {
  if (e.key === "patio-token" && e.newValue === null) {
    router.push("/login");
  }
});
