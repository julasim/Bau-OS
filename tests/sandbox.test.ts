import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const tmpDir = path.join(os.tmpdir(), "bau-os-sandbox-test-" + Date.now());
beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.VAULT_PATH = tmpDir;
});

describe("code_ausfuehren — VM Sandbox", () => {
  let handler: (args: Record<string, string | number>) => Promise<string>;

  beforeAll(async () => {
    const mod = await import("../src/llm/handlers/system.js");
    handler = mod.systemHandlers.code_ausfuehren;
  });

  // ── Grundlegende Ausfuehrung ──

  it("fuehrt einfache Arithmetik aus", async () => {
    const result = await handler({ code: "2 + 2" });
    expect(result).toBe("4");
  });

  it("fuehrt Multiplikation aus", async () => {
    const result = await handler({ code: "Math.round(125.5 * 0.2 * 100) / 100" });
    expect(result).toBe("25.1");
  });

  it("faengt console.log Output auf", async () => {
    const result = await handler({ code: 'console.log("hello"); console.log("world")' });
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("gibt (kein Ergebnis) bei void-Code zurueck", async () => {
    const result = await handler({ code: "undefined" });
    expect(result).toBe("(kein Ergebnis)");
  });

  // ── Erlaubte Globals (Whitelist) ──

  it("Math ist verfuegbar", async () => {
    const result = await handler({ code: "Math.PI.toFixed(4)" });
    expect(result).toBe("3.1416");
  });

  it("Date ist verfuegbar", async () => {
    const result = await handler({ code: "typeof Date" });
    expect(result).toBe("function");
  });

  it("JSON ist verfuegbar", async () => {
    const result = await handler({ code: "JSON.stringify({a: 1})" });
    expect(result).toBe('{"a":1}');
  });

  it("RegExp ist verfuegbar", async () => {
    const result = await handler({ code: '/^test$/.test("test")' });
    expect(result).toBe("true");
  });

  it("Array-Methoden sind verfuegbar", async () => {
    const result = await handler({ code: "[1,2,3].map(x => x*2).join(',')" });
    expect(result).toBe("2,4,6");
  });

  // ── Blockierte Globals (Sicherheit) ──

  it("process ist undefined — kein Zugriff auf env vars", async () => {
    const result = await handler({ code: "typeof process" });
    expect(result).toBe("undefined");
  });

  it("require ist undefined — kein Modul-Laden", async () => {
    const result = await handler({ code: "typeof require" });
    expect(result).toBe("undefined");
  });

  it("fetch ist undefined — kein Netzwerkzugriff", async () => {
    const result = await handler({ code: "typeof fetch" });
    expect(result).toBe("undefined");
  });

  it("setTimeout ist undefined", async () => {
    const result = await handler({ code: "typeof setTimeout" });
    expect(result).toBe("undefined");
  });

  it("setInterval ist undefined", async () => {
    const result = await handler({ code: "typeof setInterval" });
    expect(result).toBe("undefined");
  });

  // ── Fehlerbehandlung ──

  it("faengt Syntax-Fehler ab", async () => {
    const result = await handler({ code: "if (" });
    expect(result).toContain("Code-Fehler");
  });

  it("faengt Runtime-Fehler ab", async () => {
    const result = await handler({ code: "throw new Error('test-error')" });
    expect(result).toContain("Code-Fehler");
    expect(result).toContain("test-error");
  });

  // ── Timeout (Endlosschleife) ──

  it("bricht Endlosschleife ab (Timeout)", async () => {
    const result = await handler({ code: "while(true){}" });
    expect(result).toContain("Code-Fehler");
  }, 15_000); // VM_TIMEOUT_MS ist 10s, wir geben 15s

  // ── Output-Truncation ──

  it("kuerzt langen Output", async () => {
    // CODE_OUTPUT_MAX_CHARS = 4000
    const result = await handler({ code: '"x".repeat(5000)' });
    expect(result.length).toBeLessThanOrEqual(4100); // 4000 + "[... gekuerzt]"
    if (result.length > 4000) {
      expect(result).toContain("gekuerzt");
    }
  });
});
