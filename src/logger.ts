import fs from "fs";
import path from "path";
import { LOG_FILE } from "./config.js";

const MAX_LINES = 500;

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp(): string {
  return new Date().toLocaleString("de-AT", { timeZone: "Europe/Vienna" });
}

function append(line: string): void {
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  trimIfNeeded();
}

function trimIfNeeded(): void {
  const content = fs.readFileSync(LOG_FILE, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  if (lines.length > MAX_LINES) {
    fs.writeFileSync(LOG_FILE, lines.slice(-MAX_LINES).join("\n") + "\n", "utf-8");
  }
}

export function logInfo(msg: string): void {
  const line = `[${timestamp()}] INFO  ${msg}`;
  console.log(line);
  append(line);
}

export function logError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const line = `[${timestamp()}] ERROR ${context}: ${msg}`;
  console.error(line);
  append(line);
}

export function readRecentLogs(n = 20): string {
  if (!fs.existsSync(LOG_FILE)) return "Keine Logs vorhanden.";
  const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  return lines.slice(-n).join("\n") || "Keine Logs vorhanden.";
}
