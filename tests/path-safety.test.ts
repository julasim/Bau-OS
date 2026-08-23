import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Path-Traversal-Schutz fuer den Dateizugriff.
//
// Diese Tests prueften den Schutz frueher INDIREKT ueber getProjectInfo()
// aus workspace/projects.ts. Projekte liegen seit dem Umbau zum Firmenserver
// in der Datenbank, den Zugangsweg gibt es nicht mehr — der Schutz selbst
// aber sehr wohl.
//
// Seit dem Aufraeumen ist `readFile` sein EINZIGER Aufrufer: `createFile` und
// `listFolder` sind entfallen (kein Aufrufer, und `createFile` war ein
// Schreibweg in die Freigabe, den keine Rechtepruefung deckte). Die beiden
// Faelle, die frueher an `listFolder` hingen, pruefen jetzt `readFile` — die
// Abdeckung des Traversal-Schutzes bleibt damit dieselbe.

const tmpDir = path.join(os.tmpdir(), "patio-path-test-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.WORKSPACE_PATH = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("safePath — Traversal-Schutz im Dateizugriff", () => {
  let safePath: (p: string) => string | null;
  let readFile: (p: string) => string | null;

  beforeEach(async () => {
    const helpers = await import("../src/workspace/helpers.js");
    const files = await import("../src/workspace/files.js");
    safePath = helpers.safePath;
    readFile = files.readFile;
  });

  // ── Traversal-Versuche ──────────────────────────────────────────────────

  it.each([
    ["../../../etc", "Aufstieg ueber mehrere Ebenen"],
    ["name/../../etc", "Aufstieg mitten im Pfad"],
    ["..", "der nackte Aufstieg"],
    ["test/../../secret", "Aufstieg hinter einem gueltigen Segment"],
  ])("blockiert %s (%s)", (evil) => {
    expect(safePath(evil)).toBeNull();
  });

  it("blockiert einen absoluten Pfad ausserhalb des Workspace", () => {
    expect(safePath(path.join(os.tmpdir(), "woanders", "geheim.txt"))).toBeNull();
  });

  it("blockiert Symlinks, die aus dem Workspace herauszeigen", () => {
    const ziel = path.join(os.tmpdir(), "patio-symlink-ziel-" + Date.now());
    fs.mkdirSync(ziel, { recursive: true });
    const link = path.join(tmpDir, "raus");
    try {
      fs.symlinkSync(ziel, link, "junction");
    } catch {
      return; // ohne Symlink-Recht nicht pruefbar (Windows ohne Adminrechte)
    }
    expect(safePath("raus")).toBeNull();
    fs.rmSync(ziel, { recursive: true, force: true });
  });

  // ── Die Datei-Funktionen muessen den Schutz mitnehmen ────────────────────

  it("readFile liefert null statt fremder Dateiinhalte", () => {
    const geheim = path.join(os.tmpdir(), "patio-geheim-" + Date.now() + ".txt");
    fs.writeFileSync(geheim, "streng vertraulich", "utf-8");
    expect(readFile("../" + path.basename(geheim))).toBeNull();
    expect(readFile(geheim)).toBeNull();
    fs.rmSync(geheim, { force: true });
  });

  it("readFile liefert null bei einem Traversal-Versuch", () => {
    expect(readFile("../../../etc/passwd")).toBeNull();
  });

  it("ein Null-Byte im Pfad wird abgewiesen", () => {
    // Node wirft bei einem Null-Byte in fs-Aufrufen; `safePath` muss vorher
    // greifen, sonst wird aus einem Angriffsversuch ein ungefangener Fehler.
    expect(() => readFile("name\x00evil")).not.toThrow();
    expect(readFile("name\x00evil")).toBeNull();
  });

  // ── Gueltige Pfade muessen durchgehen ────────────────────────────────────

  it.each([["Projekte"], ["EFH Mayer Graz"], ["Bau v2.0"], ["unterordner/datei.md"]])("laesst %s durch", (gut) => {
    const aufgeloest = safePath(gut);
    expect(aufgeloest).not.toBeNull();
    expect(aufgeloest!.startsWith(tmpDir)).toBe(true);
  });

  it("readFile liest eine Datei innerhalb des Workspace", () => {
    fs.writeFileSync(path.join(tmpDir, "notiz.md"), "Inhalt", "utf-8");
    expect(readFile("notiz.md")).toBe("Inhalt");
  });
});
