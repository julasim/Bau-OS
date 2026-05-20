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

  it("meldet 'existiert nicht' fuer nicht-existierenden Tool-Namen", async () => {
    const result = await executeTool("gibts_nicht_tool", {});
    expect(result).toContain("existiert nicht");
    expect(result).toContain("gibts_nicht_tool");
  });

  it("meldet 'existiert nicht' fuer leeren Namen", async () => {
    const result = await executeTool("", {});
    expect(result).toContain("existiert nicht");
  });

  it("fuehrt bekanntes Tool aus (notizen_auflisten)", async () => {
    // Ein harmloses Read-Tool, das immer registriert ist.
    const result = await executeTool("notizen_auflisten", {});
    expect(result).not.toContain("existiert nicht");
  });

  // Gefaehrliche Tools wurden bewusst entfernt — der Bot darf Daten nur
  // befuellen, nicht den Server steuern oder Daten zerstoeren. Diese
  // Regressionstests stellen sicher, dass sie ueber den Executor
  // unerreichbar bleiben.
  const BLOCKED_TOOLS = [
    "befehl_ausfuehren",
    "code_ausfuehren",
    "tool_erstellen",
    "tool_loeschen",
    "mcp_server_verbinden",
    "mcp_server_trennen",
    "projekt_loeschen",
    "team_entfernen",
    "agent_erstellen",
    "agent_datei_schreiben",
  ];

  it.each(BLOCKED_TOOLS)("blockiertes Tool '%s' ist ueber den Executor nicht erreichbar", async (name) => {
    const result = await executeTool(name, {});
    expect(result).toContain("existiert nicht");
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
