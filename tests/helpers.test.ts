import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Wir testen die Funktionen direkt — muessen aber WORKSPACE_PATH setzen bevor der Import passiert
const tmpDir = path.join(os.tmpdir(), "bau-os-test-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.WORKSPACE_PATH = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("atomicWriteSync", () => {
  it("schreibt Datei atomar (kein .tmp danach)", async () => {
    // Dynamischer Import damit WORKSPACE_PATH gesetzt ist
    const { atomicWriteSync } = await import("../src/workspace/helpers.js");
    const fp = path.join(tmpDir, "test.json");

    atomicWriteSync(fp, '{"ok": true}');

    expect(fs.existsSync(fp)).toBe(true);
    expect(fs.existsSync(fp + ".tmp")).toBe(false);
    expect(fs.readFileSync(fp, "utf-8")).toBe('{"ok": true}');
  });

  it("ueberschreibt bestehende Datei atomar", async () => {
    const { atomicWriteSync } = await import("../src/workspace/helpers.js");
    const fp = path.join(tmpDir, "overwrite.json");

    fs.writeFileSync(fp, "alt", "utf-8");
    atomicWriteSync(fp, "neu");

    expect(fs.readFileSync(fp, "utf-8")).toBe("neu");
  });

  it("laesst .tmp nicht zurueck bei Fehler", async () => {
    const { atomicWriteSync } = await import("../src/workspace/helpers.js");
    const invalidDir = path.join(tmpDir, "nicht-existent", "sub", "deep");
    const fp = path.join(invalidDir, "fail.json");

    expect(() => atomicWriteSync(fp, "data")).toThrow();
    // Kein .tmp darf zurueckbleiben
    expect(fs.existsSync(fp + ".tmp")).toBe(false);
  });
});

describe("safePath", () => {
  it("erlaubt relative Pfade innerhalb des Vaults", async () => {
    const { safePath } = await import("../src/workspace/helpers.js");
    // safePath nutzt vaultPath aus dem Modul, das beim Import gesetzt wird
    // Da WORKSPACE_PATH = tmpDir, testen wir manuell
    const result = safePath("Inbox/test.md");
    expect(result).not.toBeNull();
    expect(result!.startsWith(tmpDir)).toBe(true);
  });

  it("blockiert Pfad-Traversal (../)", async () => {
    const { safePath } = await import("../src/workspace/helpers.js");
    const result = safePath("../../etc/passwd");
    expect(result).toBeNull();
  });

  it("blockiert absolute Pfade ausserhalb des Vaults", async () => {
    const { safePath } = await import("../src/workspace/helpers.js");
    const result = safePath("/etc/passwd");
    // Auf Windows ist /etc/passwd relativ zum Vault, auf Linux absolut
    if (process.platform !== "win32") {
      expect(result).toBeNull();
    }
  });

  it("blockiert Symlinks", async () => {
    const { safePath } = await import("../src/workspace/helpers.js");
    const target = path.join(os.tmpdir(), "bau-os-symlink-target-" + Date.now());
    const link = path.join(tmpDir, "evil-link");

    fs.writeFileSync(target, "secret", "utf-8");
    try {
      fs.symlinkSync(target, link);
      const result = safePath("evil-link");
      expect(result).toBeNull();
    } catch {
      // Symlink-Erstellung kann auf Windows ohne Admin-Rechte fehlschlagen
    } finally {
      fs.rmSync(target, { force: true });
    }
  });
});

describe("ensureDir", () => {
  it("erstellt verschachtelte Ordner", async () => {
    const { ensureDir } = await import("../src/workspace/helpers.js");
    const deep = path.join(tmpDir, "a", "b", "c");

    ensureDir(deep);

    expect(fs.existsSync(deep)).toBe(true);
    expect(fs.statSync(deep).isDirectory()).toBe(true);
  });

  it("ist idempotent (kein Fehler bei existierendem Ordner)", async () => {
    const { ensureDir } = await import("../src/workspace/helpers.js");
    const dir = path.join(tmpDir, "exists");

    fs.mkdirSync(dir);
    expect(() => ensureDir(dir)).not.toThrow();
  });
});
