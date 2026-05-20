// ============================================================
// PATIO — Bot-Funktionsumfang (Grossueberpruefung)
// Prueft zwei Dinge:
//   1. Der Bot kann alles, was ein WebUI-Nutzer befuellend tun kann
//      (Notizen, Aufgaben inkl. Zuweisung, Termine, Meetings/Protokolle,
//       Projekte anlegen + befuellen, Bautagebuch, Stunden, Team, Datei →
//       Projekt-Zuordnung).
//   2. Gefaehrliche/systemrelevante Tools sind vollstaendig entfernt
//      (Schema + Handler).
// Stil: Repos gemockt, Handler direkt aufgerufen — wie tests/projects.test.ts.
// ============================================================

// DATABASE_URL muss VOR allen Imports gesetzt sein, damit DB_ENABLED in
// src/config.ts true ist (datei_projekt_zuordnen braucht den DB-Modus).
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test/test";

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock-Setup ───────────────────────────────────────────────
const mockNoteRepo = { save: vi.fn(), list: vi.fn(), listDetailed: vi.fn() };
const mockTaskRepo = { save: vi.fn(), list: vi.fn(), update: vi.fn(), complete: vi.fn() };
const mockProjectRepo = { list: vi.fn(), getInfo: vi.fn() };
const mockFileRepo = { save: vi.fn(), linkProject: vi.fn(), get: vi.fn() };

vi.mock("../src/data/index.js", () => ({
  noteRepo: mockNoteRepo,
  taskRepo: mockTaskRepo,
  projectRepo: mockProjectRepo,
  fileRepo: mockFileRepo,
}));

vi.mock("../src/api/events.js", () => ({ emit: vi.fn() }));

vi.mock("../src/notifications.js", () => ({
  notifyTaskAssigned: vi.fn(),
  resolveUserIdFromMember: vi.fn().mockResolvedValue(null),
}));

// Imports erst nach den Mocks.
const { TOOLS } = await import("../src/llm/tools.js");
const { noteHandlers } = await import("../src/llm/handlers/notes.js");
const { taskHandlers } = await import("../src/llm/handlers/tasks.js");
const { fileHandlers } = await import("../src/llm/handlers/files.js");
const allHandlers = await import("../src/llm/handlers/index.js");

const toolNames = TOOLS.map((t) => t.function.name);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. Gefaehrliche Tools sind entfernt ──────────────────────

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

describe("Bot-Sicherheit — gefaehrliche Tools entfernt", () => {
  it.each(BLOCKED_TOOLS)("'%s' ist nicht im TOOLS-Schema", (name) => {
    expect(toolNames).not.toContain(name);
  });

  it("kein blockiertes Tool hat noch einen Handler", () => {
    const handlerNames = new Set<string>();
    for (const [key, value] of Object.entries(allHandlers)) {
      if (key.endsWith("Handlers") && value && typeof value === "object") {
        for (const n of Object.keys(value as Record<string, unknown>)) handlerNames.add(n);
      }
    }
    for (const b of BLOCKED_TOOLS) {
      expect(handlerNames.has(b), `${b} hat noch einen Handler`).toBe(false);
    }
  });
});

// ── 2. Pflicht-Faehigkeiten sind vorhanden ───────────────────

const REQUIRED_TOOLS = [
  "notiz_speichern",
  "aufgabe_speichern",
  "aufgabe_erledigen",
  "termin_speichern",
  "meeting_anlegen",
  "projekt_anlegen",
  "projekt_aktualisieren",
  "bautagebuch_eintrag",
  "stunden_eintragen",
  "team_anlegen",
  "team_zuordnen",
  "datei_projekt_zuordnen",
];

describe("Bot-Faehigkeiten — alle WebUI-Befuell-Funktionen als Tool vorhanden", () => {
  it.each(REQUIRED_TOOLS)("Tool '%s' ist verfuegbar", (name) => {
    expect(toolNames).toContain(name);
  });

  it("aufgabe_speichern kann einem Team-Mitglied zugewiesen werden", () => {
    const schema = TOOLS.find((t) => t.function.name === "aufgabe_speichern");
    const props = (schema?.function.parameters as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("zuweisung");
  });
});

// ── 3. Happy-Path je Bereich (gemockte Repos) ────────────────

describe("Bot-Faehigkeiten — Handler Happy-Path", () => {
  it("notiz_speichern ruft noteRepo.save", async () => {
    mockNoteRepo.save.mockResolvedValueOnce("/vault/Notizen/2026-05-14.md");
    const out = await noteHandlers.notiz_speichern({ text: "Testnotiz", projekt: "EFH Huber" });
    expect(mockNoteRepo.save).toHaveBeenCalledWith("Testnotiz", "EFH Huber");
    expect(out).toMatch(/gespeichert/i);
  });

  it("aufgabe_speichern ruft taskRepo.save", async () => {
    mockTaskRepo.save.mockResolvedValueOnce({ id: "t1", text: "Angebot einholen" });
    const out = await taskHandlers.aufgabe_speichern({ text: "Angebot einholen" });
    expect(mockTaskRepo.save).toHaveBeenCalledWith("Angebot einholen", undefined);
    expect(out).toMatch(/gespeichert/i);
  });

  it("aufgabe_erledigen ruft taskRepo.complete", async () => {
    mockTaskRepo.complete.mockResolvedValueOnce(true);
    const out = await taskHandlers.aufgabe_erledigen({ text: "Angebot einholen" });
    expect(mockTaskRepo.complete).toHaveBeenCalledWith("Angebot einholen", undefined);
    expect(out).toMatch(/erledigt/i);
  });

  it("datei_projekt_zuordnen linkt Datei an Projekt", async () => {
    mockFileRepo.linkProject.mockResolvedValueOnce(true);
    const out = await fileHandlers.datei_projekt_zuordnen({ datei: "file-1", projekt: "EFH Huber" });
    expect(mockFileRepo.linkProject).toHaveBeenCalledWith("file-1", "EFH Huber");
    expect(out).toMatch(/zugeordnet/i);
  });

  it("datei_projekt_zuordnen meldet Fehler bei unbekanntem Projekt", async () => {
    mockFileRepo.linkProject.mockResolvedValueOnce(false);
    const out = await fileHandlers.datei_projekt_zuordnen({ datei: "file-1", projekt: "Geisterprojekt" });
    expect(out).toMatch(/fehlgeschlagen|nicht gefunden/i);
  });

  it("datei_projekt_zuordnen verweigert leere Argumente", async () => {
    const out = await fileHandlers.datei_projekt_zuordnen({ datei: "", projekt: "" });
    expect(out).toMatch(/erforderlich/i);
    expect(mockFileRepo.linkProject).not.toHaveBeenCalled();
  });
});
