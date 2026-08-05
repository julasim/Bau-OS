// ============================================================
// PATIO — Projekt-Migration 004
// Prueft, dass die Migration existiert und die erwarteten Stammdaten-
// Spalten, Indizes und den Backfill enthaelt.
//
// Die frueheren Handler-Tests (projekt_anlegen / _aktualisieren / _info)
// sind mit der LLM-Laufzeit entfallen. Die gleiche Fachlogik haengt jetzt
// ausschliesslich an den Routen in src/api/routes/projects.ts.
// ============================================================

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
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
