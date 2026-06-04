import { createApp } from "vue";
import "./patio-tokens.css";
import "./patio-components.css";
import "./patio-shell.css";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./style.css";
// Theme beim Start initialisieren (setzt html.dark synchron — kein FOUC)
import { useTheme } from "./composables/useTheme";
useTheme();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

// Cross-Tab-Logout-Sync: Wenn der Token in einem anderen Tab entfernt wird
// (z.B. durch Logout), wird dieser Tab sofort zur Login-Seite weitergeleitet.
window.addEventListener("storage", (e) => {
  if (e.key === "bau-os-token" && e.newValue === null) {
    router.push("/login");
  }
});
