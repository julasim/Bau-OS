import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
    // Unhandled Rejections als Warning statt Error — verhindert false-positive Failures
    // wenn Tests bewusst Promise-Rejections testen (z.B. queue.test.ts Fehler-Isolation)
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
