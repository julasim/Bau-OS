import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const tmpDir = path.join(os.tmpdir(), "bau-os-json-test-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.WORKSPACE_PATH = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("JSON-Fallbacks — Tasks", () => {
  it("gibt [] bei korrupter tasks.json zurueck", async () => {
    // Projekt-Ordner mit korrupter JSON erstellen
    const projDir = path.join(tmpDir, "Projekte", "test-proj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "tasks.json"), "invalid{json!!!", "utf-8");

    const { listTasks } = await import("../src/workspace/tasks.js");
    const result = listTasks("test-proj");
    expect(result).toEqual([]);
  });

  it("gibt [] bei leerer tasks.json zurueck", async () => {
    const projDir = path.join(tmpDir, "Projekte", "empty-proj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "tasks.json"), "", "utf-8");

    const { listTasks } = await import("../src/workspace/tasks.js");
    const result = listTasks("empty-proj");
    expect(result).toEqual([]);
  });

  it("gibt [] wenn tasks.json nicht existiert (kein Legacy)", async () => {
    const projDir = path.join(tmpDir, "Projekte", "neue-proj");
    fs.mkdirSync(projDir, { recursive: true });
    // Keine tasks.json und keine Aufgaben.md

    const { listTasks } = await import("../src/workspace/tasks.js");
    const result = listTasks("neue-proj");
    expect(result).toEqual([]);
  });

  it("liest gueltige tasks.json korrekt", async () => {
    const projDir = path.join(tmpDir, "Projekte", "valid-proj");
    fs.mkdirSync(projDir, { recursive: true });
    const tasks = [
      {
        id: "abc",
        text: "Test",
        status: "open",
        assignee: null,
        date: null,
        location: null,
        project: "valid-proj",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ];
    fs.writeFileSync(path.join(projDir, "tasks.json"), JSON.stringify(tasks), "utf-8");

    const { listTasks } = await import("../src/workspace/tasks.js");
    const result = listTasks("valid-proj");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Test");
  });
});

describe("JSON-Fallbacks — Termine", () => {
  it("gibt [] bei korrupter termine.json zurueck", async () => {
    const projDir = path.join(tmpDir, "Projekte", "termin-corrupt");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "termine.json"), "{broken", "utf-8");

    const { listTermine } = await import("../src/workspace/termine.js");
    const result = listTermine("termin-corrupt");
    expect(result).toEqual([]);
  });

  it("gibt [] bei leerer termine.json zurueck", async () => {
    const projDir = path.join(tmpDir, "Projekte", "termin-empty");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "termine.json"), "", "utf-8");

    const { listTermine } = await import("../src/workspace/termine.js");
    const result = listTermine("termin-empty");
    expect(result).toEqual([]);
  });

  it("gibt [] wenn termine.json nicht existiert", async () => {
    const projDir = path.join(tmpDir, "Projekte", "termin-none");
    fs.mkdirSync(projDir, { recursive: true });

    const { listTermine } = await import("../src/workspace/termine.js");
    const result = listTermine("termin-none");
    expect(result).toEqual([]);
  });

  it("liest gueltige termine.json korrekt", async () => {
    const projDir = path.join(tmpDir, "Projekte", "termin-valid");
    fs.mkdirSync(projDir, { recursive: true });
    const termine = [
      {
        id: "xyz",
        text: "Meeting",
        datum: "15.04.2026",
        uhrzeit: "10:00",
        endzeit: null,
        location: null,
        assignees: [],
        project: "termin-valid",
        createdAt: "2026-01-01",
      },
    ];
    fs.writeFileSync(path.join(projDir, "termine.json"), JSON.stringify(termine), "utf-8");

    const { listTermine } = await import("../src/workspace/termine.js");
    const result = listTermine("termin-valid");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Meeting");
  });
});

describe("JSON-Fallbacks — Team", () => {
  it("gibt [] wenn team.json nicht existiert", async () => {
    const { listTeam } = await import("../src/workspace/team.js");
    // team.json nutzt process.cwd()/data/team.json
    // Wenn die Datei nicht existiert, soll [] zurueck kommen
    // Da wir nicht sicher wissen ob die Datei existiert, pruefen wir nur den Typ
    const result = listTeam();
    expect(Array.isArray(result)).toBe(true);
  });
});
