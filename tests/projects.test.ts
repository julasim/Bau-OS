// ============================================================
// PATIO — Projekt-Bereich Tests (Phase 1 + Handler)
// Prueft: Migration 004 existiert und enthaelt die erwarteten Spalten;
// projekt_anlegen / projekt_aktualisieren / projekt_info schreiben /
// lesen strukturierte Stammdaten korrekt (gegen gemockten Repo).
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ── Mock-Setup ───────────────────────────────────────────────
// Der projekt-Handler importiert projectRepo aus ../../data/index.js.
// Wir mocken das Modul vor dem Handler-Import, damit wir die Aufrufe
// inspizieren koennen, ohne echte DB.
const mockRepo = {
  list: vi.fn(),
  getInfo: vi.fn(),
  listNotes: vi.fn(),
  readNote: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("../src/data/index.js", () => ({
  projectRepo: mockRepo,
  // PM-Repos sind DB-only; im FS-Test null (Handler ueberspringt sie dann).
  phaseRepo: null,
  portfolioRepo: null,
}));

// Events-Modul mocken — emit() schreibt sonst ueber SSE ins Leere.
vi.mock("../src/api/events.js", () => ({
  emit: vi.fn(),
}));

// Handler erst importieren, nachdem die Mocks stehen.
const { projectHandlers } = await import("../src/llm/handlers/projects.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Migration 004 ─────────────────────────────────────────────

describe("Migration 004 — Projekt-Stammdaten", () => {
  const migrationPath = path.join(
    import.meta.dirname ?? process.cwd(),
    "..",
    "src",
    "db",
    "migrations",
    "004_project_stammdaten.sql",
  );

  it("Datei existiert", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("fuegt alle 8 neuen Spalten hinzu", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    for (const col of [
      "projektnummer",
      "bauherr",
      "standort",
      "projektart",
      "nutzung",
      "phase",
      "start_date",
      "end_date",
    ]) {
      expect(content).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}`, "i"));
    }
  });

  it("legt Indizes auf die wichtigsten Filter-Spalten an", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    expect(content).toMatch(/idx_projects_projektnummer/i);
    expect(content).toMatch(/idx_projects_projektart/i);
    expect(content).toMatch(/idx_projects_phase/i);
  });

  it("backfillt aus description via regexp_match", () => {
    const content = fs.readFileSync(migrationPath, "utf-8");
    expect(content).toMatch(/regexp_match\(description/);
    // COALESCE schuetzt bereits gesetzte Werte — idempotent.
    expect(content).toMatch(/COALESCE\(\s*projektnummer/i);
    expect(content).toMatch(/COALESCE\(\s*bauherr/i);
  });
});

// ── projekt_info Handler ──────────────────────────────────────

describe("projekt_info Handler", () => {
  it("zeigt alle Stammdaten mit Werten", async () => {
    mockRepo.getInfo.mockResolvedValueOnce({
      name: "Test",
      status: "aktiv",
      projektnummer: "2026-001",
      bauherr: "Hans Müller",
      standort: "Wien",
      projektart: "Neubau",
      nutzung: "Wohnbau",
      phase: "Einreichung",
      startDate: null,
      endDate: null,
      notes: 3,
      openTasks: 2,
      termine: 1,
      files: 4,
      description: null,
    });
    const out = await projectHandlers.projekt_info({ name: "Test" });
    expect(out).toContain("Projekt: Test");
    expect(out).toContain("Projektnummer: 2026-001");
    expect(out).toContain("Bauherr: Hans Müller");
    expect(out).toContain("Standort: Wien");
    expect(out).toContain("Projektart: Neubau");
    expect(out).toContain("Nutzung: Wohnbau");
    expect(out).toContain("Phase: Einreichung");
    expect(out).toContain("Notizen: 3");
    expect(out).toContain("Dateien: 4");
  });

  it("ersetzt fehlende Felder mit —", async () => {
    mockRepo.getInfo.mockResolvedValueOnce({
      name: "Leer",
      status: "aktiv",
      projektnummer: null,
      bauherr: null,
      standort: null,
      projektart: null,
      nutzung: null,
      phase: null,
      notes: 0,
      openTasks: 0,
      termine: 0,
      files: 0,
    });
    const out = await projectHandlers.projekt_info({ name: "Leer" });
    expect(out).toContain("Projektnummer: —");
    expect(out).toContain("Bauherr: —");
    expect(out).toContain("Phase: —");
  });

  it("gibt freundliche Fehlermeldung bei unbekanntem Namen", async () => {
    mockRepo.getInfo.mockResolvedValueOnce(null);
    const out = await projectHandlers.projekt_info({ name: "Unbekannt" });
    expect(out).toMatch(/nicht gefunden/i);
    expect(out).toContain("projekte_auflisten");
  });
});

// ── projekt_anlegen Handler ──────────────────────────────────

describe("projekt_anlegen Handler", () => {
  it("uebergibt strukturierte Felder an repo.create", async () => {
    mockRepo.create.mockResolvedValueOnce(true);
    await projectHandlers.projekt_anlegen({
      name: "EFH Huber Graz",
      projektnummer: "2026-050",
      bauherr: "Hans Huber",
      standort: "Graz",
      projektart: "Neubau",
      nutzung: "Wohnbau",
      beschreibung: "Freistehender Neubau",
    });
    expect(mockRepo.create).toHaveBeenCalledWith("EFH Huber Graz", {
      description: "Freistehender Neubau",
      projektnummer: "2026-050",
      bauherr: "Hans Huber",
      standort: "Graz",
      projektart: "Neubau",
      nutzung: "Wohnbau",
      phase: null,
      startDate: null,
      endDate: null,
    });
  });

  it("listet fehlende Stammdaten in der Rueckmeldung", async () => {
    mockRepo.create.mockResolvedValueOnce(true);
    const out = await projectHandlers.projekt_anlegen({
      name: "Minimal",
      bauherr: "Max Mustermann",
    });
    expect(out).toContain("Gesetzt: Bauherr");
    expect(out).toMatch(/Fehlen noch:.*Projektnummer/);
    expect(out).toMatch(/Fehlen noch:.*Standort/);
    expect(out).toMatch(/Fehlen noch:.*Projektart/);
    expect(out).toMatch(/Fehlen noch:.*Nutzung/);
  });

  it("verweigert leeren Namen", async () => {
    const out = await projectHandlers.projekt_anlegen({ name: "" });
    expect(out).toMatch(/Name ist erforderlich/);
    expect(mockRepo.create).not.toHaveBeenCalled();
  });
});

// ── projekt_aktualisieren Handler ────────────────────────────

describe("projekt_aktualisieren Handler", () => {
  it("patched nur Felder, die im Aufruf gesetzt sind", async () => {
    mockRepo.update.mockResolvedValueOnce(true);
    await projectHandlers.projekt_aktualisieren({
      name: "Bestand",
      bauherr: "Neuer Bauherr",
      phase: "Ausfuehrung",
    });
    expect(mockRepo.update).toHaveBeenCalledWith("Bestand", {
      bauherr: "Neuer Bauherr",
      phase: "Ausfuehrung",
    });
  });

  it("leerer String leert das Feld (→ null)", async () => {
    mockRepo.update.mockResolvedValueOnce(true);
    await projectHandlers.projekt_aktualisieren({ name: "X", standort: "" });
    expect(mockRepo.update).toHaveBeenCalledWith("X", { standort: null });
  });

  it("uebersetzt beschreibung → description und start_date → startDate", async () => {
    mockRepo.update.mockResolvedValueOnce(true);
    await projectHandlers.projekt_aktualisieren({
      name: "Y",
      beschreibung: "Neuer Text",
      start_date: "2026-05-01",
    });
    expect(mockRepo.update).toHaveBeenCalledWith("Y", {
      description: "Neuer Text",
      startDate: "2026-05-01",
    });
  });

  it("verweigert leeren Patch", async () => {
    const out = await projectHandlers.projekt_aktualisieren({ name: "Z" });
    expect(out).toMatch(/Kein Feld/i);
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it("gibt freundliche Fehlermeldung wenn Projekt fehlt", async () => {
    mockRepo.update.mockResolvedValueOnce(false);
    const out = await projectHandlers.projekt_aktualisieren({ name: "Geist", bauherr: "X" });
    expect(out).toMatch(/nicht gefunden|fehlgeschlagen/i);
  });
});
