import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

const tmpDir = path.join(os.tmpdir(), "bau-os-path-test-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.VAULT_PATH = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("safeProjectName — indirekt via getProjectInfo", () => {
  let getProjectInfo: (name: string) => unknown;
  let listProjectNotes: (name: string) => string[];

  beforeEach(async () => {
    const mod = await import("../src/vault/projects.js");
    getProjectInfo = mod.getProjectInfo;
    listProjectNotes = mod.listProjectNotes;
  });

  // ── Path-Traversal-Versuche ──

  it("blockiert ../../../etc", () => {
    const result = getProjectInfo("../../../etc");
    expect(result).toBeNull();
  });

  it("blockiert name/../../etc", () => {
    const result = getProjectInfo("name/../../etc");
    expect(result).toBeNull();
  });

  it("blockiert .. alleine", () => {
    const result = getProjectInfo("..");
    expect(result).toBeNull();
  });

  it("blockiert Pfade mit Slashes", () => {
    const result = getProjectInfo("test/../../secret");
    expect(result).toBeNull();
  });

  it("blockiert Pfade mit Backslashes", () => {
    // safeProjectName nutzt Regex /^[\w\-. ]+$/ — Backslash ist nicht erlaubt
    const result = getProjectInfo("test\\..\\secret");
    expect(result).toBeNull();
  });

  // ── listProjectNotes mit unsicheren Namen ──

  it("listProjectNotes gibt [] bei Traversal-Versuch", () => {
    const result = listProjectNotes("../../../etc");
    expect(result).toEqual([]);
  });

  it("listProjectNotes gibt [] bei Null-Byte", () => {
    const result = listProjectNotes("name\x00evil");
    expect(result).toEqual([]);
  });

  // ── Gueltige Projektnamen ──

  it("akzeptiert normalen Projektnamen", () => {
    // Projekt-Ordner erstellen damit getProjectInfo nicht null wegen fehlender Datei zurueckgibt
    const projDir = path.join(tmpDir, "Projekte", "EFH-Mayer");
    fs.mkdirSync(projDir, { recursive: true });

    const result = getProjectInfo("EFH-Mayer");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("name", "EFH-Mayer");
  });

  it("akzeptiert Projektnamen mit Leerzeichen", () => {
    const projDir = path.join(tmpDir, "Projekte", "EFH Mayer Graz");
    fs.mkdirSync(projDir, { recursive: true });

    const result = getProjectInfo("EFH Mayer Graz");
    expect(result).not.toBeNull();
  });

  it("akzeptiert Projektnamen mit Punkt", () => {
    const projDir = path.join(tmpDir, "Projekte", "Bau v2.0");
    fs.mkdirSync(projDir, { recursive: true });

    const result = getProjectInfo("Bau v2.0");
    expect(result).not.toBeNull();
  });

  it("gibt null fuer nicht-existierenden Projektnamen", () => {
    const result = getProjectInfo("gibts-nicht");
    expect(result).toBeNull();
  });
});
