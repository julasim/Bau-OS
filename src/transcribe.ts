import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { PYTHON_PATH, WHISPER_SCRIPT, WHISPER_MODEL } from "./config.js";

const execAsync = promisify(exec);

export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(
      `"${PYTHON_PATH}" "${WHISPER_SCRIPT}" "${audioPath}" ${WHISPER_MODEL}`,
      { timeout: 120_000, env: { ...process.env, PYTHONIOENCODING: "utf-8", WHISPER_LANG: process.env.WHISPER_LANG ?? "de" } }
    );
    if (stderr) console.warn("Whisper stderr:", stderr);
    return stdout.trim();
  } catch (err: unknown) {
    // execAsync wirft auch wenn nur stderr da ist — stdout trotzdem auslesen
    const e = err as { stdout?: string; stderr?: string; message?: string };
    if (e.stdout?.trim()) return e.stdout.trim();
    throw new Error(e.stderr || e.message || String(err));
  }
}

export function getTempPath(filename: string): string {
  return path.join(os.tmpdir(), filename);
}
