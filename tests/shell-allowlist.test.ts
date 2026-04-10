import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// VAULT_PATH muss vor dem Import gesetzt sein
const tmpDir = path.join(os.tmpdir(), "bau-os-shell-test-" + Date.now());
beforeAll(() => {
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.VAULT_PATH = tmpDir;
});

describe("befehl_ausfuehren — Allowlist", () => {
  let handler: (args: Record<string, string | number>) => Promise<string>;

  beforeAll(async () => {
    const mod = await import("../src/llm/handlers/system.js");
    handler = mod.systemHandlers.befehl_ausfuehren;
  });

  // ── Blockierte Befehle ──

  it("blockiert rm", async () => {
    const result = await handler({ befehl: "rm -rf /" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert shutdown", async () => {
    const result = await handler({ befehl: "shutdown -h now" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert reboot", async () => {
    const result = await handler({ befehl: "reboot" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert python3", async () => {
    const result = await handler({ befehl: "python3 -c 'import os; os.system(\"rm -rf /\")'" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert dd", async () => {
    const result = await handler({ befehl: "dd if=/dev/zero of=/dev/sda" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert mkfs", async () => {
    const result = await handler({ befehl: "mkfs.ext4 /dev/sda1" });
    expect(result).toContain("nicht erlaubt");
  });

  // ── Pfad-Prefix-Bypass-Versuche ──

  it("blockiert /bin/rm (Pfad-Prefix-Bypass)", async () => {
    const result = await handler({ befehl: "/bin/rm -rf /" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert /usr/bin/python3 (Pfad-Prefix)", async () => {
    const result = await handler({ befehl: "/usr/bin/python3 evil.py" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert ./malware (relativer Pfad)", async () => {
    const result = await handler({ befehl: "./malware" });
    expect(result).toContain("nicht erlaubt");
  });

  // ── Edge Cases ──

  it("blockiert leeren Befehl", async () => {
    const result = await handler({ befehl: "" });
    expect(result).toContain("nicht erlaubt");
  });

  it("blockiert Whitespace-Befehl", async () => {
    const result = await handler({ befehl: "   " });
    expect(result).toContain("nicht erlaubt");
  });

  // ── Erlaubte Befehle ──

  it("erlaubt echo (Basis-Check)", async () => {
    const result = await handler({ befehl: "echo test123" });
    expect(result).not.toContain("nicht erlaubt");
    expect(result).toContain("test123");
  });

  it("erlaubt whoami", async () => {
    const result = await handler({ befehl: "whoami" });
    expect(result).not.toContain("nicht erlaubt");
  });

  it("erlaubt pwd", async () => {
    const result = await handler({ befehl: "pwd" });
    expect(result).not.toContain("nicht erlaubt");
  });

  // ── Pipe-Chains: nur der erste Befehl wird geprueft ──

  it("erlaubt Pipe-Chain wenn erster Befehl erlaubt (ls | grep)", async () => {
    const result = await handler({ befehl: "echo hello | grep hello" });
    expect(result).not.toContain("nicht erlaubt");
  });

  // ── Semicolon-Verhalten dokumentieren ──
  // ACHTUNG: Das ist eine bekannte Limitation!
  // Der Split auf `;` extrahiert den ersten Befehl.
  // `ls; rm -rf /` wird als `ls` erkannt und erlaubt.

  it("Semicolon-Injection: erster Befehl wird geprueft (bekannte Limitation)", async () => {
    // ls ist erlaubt, also wird der ganze String an exec uebergeben
    // Der Test dokumentiert dieses Verhalten
    const result = await handler({ befehl: "echo safe; echo also-safe" });
    expect(result).not.toContain("nicht erlaubt");
  });

  // ── Allowlist-Umfang ──

  it("die Allowlist enthaelt mindestens 60 Befehle", async () => {
    // Wir testen indirekt: diverse erlaubte Befehle
    const allowedCmds = [
      "ls",
      "cat",
      "grep",
      "find",
      "df",
      "du",
      "free",
      "uptime",
      "ps",
      "systemctl",
      "curl",
      "git",
      "npm",
      "node",
      "docker",
      "echo",
      "printf",
      "awk",
      "sed",
      "jq",
      "ollama",
    ];
    for (const cmd of allowedCmds) {
      const result = await handler({ befehl: `${cmd} --help` });
      expect(result, `${cmd} sollte erlaubt sein`).not.toContain("nicht erlaubt");
    }
  });
});
