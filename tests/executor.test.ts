import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const tmpDir = path.join(os.tmpdir(), "bau-os-exec-test-" + Date.now());
beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.VAULT_PATH = tmpDir;
});

describe("executeTool — Dispatch", () => {
  let executeTool: (name: string, args: Record<string, string | number>) => Promise<string>;

  beforeAll(async () => {
    const mod = await import("../src/llm/executor.js");
    executeTool = mod.executeTool;
  });

  it("gibt 'Unbekanntes Tool' fuer nicht-existierenden Tool-Namen zurueck", async () => {
    const result = await executeTool("gibts_nicht_tool", {});
    expect(result).toContain("Unbekanntes Tool");
    expect(result).toContain("gibts_nicht_tool");
  });

  it("gibt 'Unbekanntes Tool' fuer leeren Namen zurueck", async () => {
    const result = await executeTool("", {});
    expect(result).toContain("Unbekanntes Tool");
  });

  it("fuehrt bekanntes Tool aus (echo via befehl_ausfuehren)", async () => {
    const result = await executeTool("befehl_ausfuehren", { befehl: "echo executor-test" });
    expect(result).toContain("executor-test");
  });

  it("fuehrt code_ausfuehren aus", async () => {
    const result = await executeTool("code_ausfuehren", { code: "1 + 1" });
    expect(result).toBe("2");
  });

  it("faengt Fehler in Handlern ab", async () => {
    // code_ausfuehren mit ungueltigem Code — wird intern gefangen
    const result = await executeTool("code_ausfuehren", { code: "throw new Error('test')" });
    expect(result).toContain("Code-Fehler");
  });
});

describe("Handler-Registry — Vollstaendigkeit", () => {
  it("alle 10 Handler-Module sind geladen", async () => {
    const handlers = await import("../src/llm/handlers/index.js");
    const moduleNames = [
      "noteHandlers",
      "taskHandlers",
      "terminHandlers",
      "fileHandlers",
      "projectHandlers",
      "agentHandlers",
      "systemHandlers",
      "webHandlers",
      "dyntoolHandlers",
      "mcpHandlers",
    ];
    for (const name of moduleNames) {
      expect(handlers, `${name} sollte exportiert sein`).toHaveProperty(name);
      expect(typeof (handlers as Record<string, unknown>)[name]).toBe("object");
    }
  });

  it("alle 10 Schema-Module sind geladen", async () => {
    const handlers = await import("../src/llm/handlers/index.js");
    const schemaNames = [
      "noteSchemas",
      "taskSchemas",
      "terminSchemas",
      "fileSchemas",
      "projectSchemas",
      "agentSchemas",
      "systemSchemas",
      "webSchemas",
      "dyntoolSchemas",
      "mcpSchemas",
    ];
    for (const name of schemaNames) {
      expect(handlers, `${name} sollte exportiert sein`).toHaveProperty(name);
      expect(Array.isArray((handlers as Record<string, unknown>)[name])).toBe(true);
    }
  });

  it("TOOLS-Array hat mindestens 41 Eintraege (+ antworten)", async () => {
    const { TOOLS } = await import("../src/llm/tools.js");
    expect(TOOLS.length).toBeGreaterThanOrEqual(42);
  });
});
