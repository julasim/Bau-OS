import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    // ── Warum zwei Umgebungen ─────────────────────────────────────────────
    //
    // Die Server-Suite läuft in Node und darf das auch: sie spricht mit
    // PostgreSQL und mit Hono, nicht mit einem Browser. Eine DOM-Umgebung für
    // alle wäre langsamer und würde nichts prüfen, was ohne sie nicht auch
    // geprüft wird.
    //
    // Das Frontend braucht dagegen eines: bis hierher hatte `web/` NULL
    // Testdateien — jede Prüfung dort lief über `vue-tsc` (Typen) oder über
    // den Browser von Hand. Beides fängt keine Logik.
    // Die Umgebung je Datei setzt ein Kommentar im Kopf
    // (`@vitest-environment happy-dom`) — `environmentMatchGlobs` gibt es in
    // Vitest 4 nicht mehr, und der Aufruf blieb wirkungslos statt zu
    // scheitern: die Frontend-Tests liefen in Node und brachen mit
    // „document is not defined" ab.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    // Kein `dangerouslyIgnoreUnhandledErrors`: die Option galt global fuer die
    // gesamte Suite und machte jede unbehandelte Promise-Rejection zur blossen
    // Warnung — also genau den Fall "gruene Suite trotz asynchronem Fehler".
    // Begruendet war sie mit `tests/queue.test.ts`; diese Datei gibt es in
    // diesem Branch nicht mehr.
  },
});
