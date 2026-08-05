import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
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
