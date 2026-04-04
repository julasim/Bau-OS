import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

const pythonPath = process.env.PYTHON_PATH || "python";
const scriptPath = path.join(process.cwd(), "whisper_transcribe.py");

export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    `"${pythonPath}" "${scriptPath}" "${audioPath}"`,
    { timeout: 120_000, env: { ...process.env, PYTHONIOENCODING: "utf-8", WHISPER_LANG: process.env.WHISPER_LANG ?? "de" } }
  );
  if (stderr) console.error("Whisper stderr:", stderr);
  return stdout.trim();
}

export function getTempPath(filename: string): string {
  return path.join(os.tmpdir(), filename);
}
