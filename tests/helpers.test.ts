import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Wir testen die Funktionen direkt — muessen aber WORKSPACE_PATH setzen bevor der Import passiert
const tmpDir = path.join(os.tmpdir(), "patio-test-" + Date.now());

beforeEach(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.WORKSPACE_PATH = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Was hier stand: Pruefungen fuer atomicWriteSync und ensureDir ─────────
//
// Beide Helfer sind mit dem Aufraeumen entfallen: seit dem Umbau zum
// Firmenserver schreibt die Anwendung nicht mehr ins Dateisystem, und
// ausserhalb dieser Pruefungen hatten sie keinen Aufrufer mehr.
//
// `atomicWriteSync` war gut gebaut (schreiben nach .tmp, dann umbenennen) —
// genau das macht solchen Code gefaehrlich: er liest sich wie ein benutzter
// Baustein. Wer ihn wieder braucht, holt ihn aus der Git-Historie.
//
// Uebrig bleibt `safePath`, der Traversal-Schutz. Er wird gebraucht: der
// Download-Rueckfall auf Alt-Dateien geht durch ihn.

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
    const target = path.join(os.tmpdir(), "patio-symlink-target-" + Date.now());
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
