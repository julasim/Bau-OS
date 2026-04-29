import fs from "fs";
import path from "path";
import { LOG_FILE, MAX_LOG_LINES, TIMEZONE, LOG_JSONL_MAX_BYTES, LOG_JSONL_KEEP_FILES } from "./config.js";

let lineCount = -1; // -1 = noch nicht initialisiert

// ── Structured Log Format ────────────────────────────────────────────────────

export interface LogEntry {
  ts: string; // ISO 8601
  level: "info" | "error" | "warn";
  ctx?: string; // Kontext (Agent-Name, Modul etc.)
  msg: string;
  err?: string; // Error-Message bei Fehlern
}

function isoNow(): string {
  return new Date().toISOString();
}

function humanTimestamp(): string {
  return new Date().toLocaleString("de-AT", { timeZone: TIMEZONE });
}

// ── File I/O ─────────────────────────────────────────────────────────────────

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function initLineCount(): void {
  if (lineCount >= 0) return;
  try {
    if (fs.existsSync(LOG_FILE)) {
      lineCount = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean).length;
    } else {
      lineCount = 0;
    }
  } catch {
    lineCount = 0;
  }
}

function append(line: string): void {
  ensureLogDir();
  initLineCount();
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
  lineCount++;
  if (lineCount > MAX_LOG_LINES) trimLog();
}

function trimLog(): void {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const trimmed = lines.slice(-MAX_LOG_LINES);
    fs.writeFileSync(LOG_FILE, trimmed.join("\n") + "\n", "utf-8");
    lineCount = trimmed.length;
  } catch {
    /* Fehler beim Trimmen ist nicht kritisch */
  }
}

// ── JSONL-Log (maschinenlesbar) ──────────────────────────────────────────────

const jsonlPath = LOG_FILE.replace(/\.log$/, ".jsonl");

/** Rotiert bot.jsonl groessenbasiert: bot.jsonl → .1, .1 → .2, ...,
 *  aelteste wird geloescht. Wird vor jedem Append gepruef-/aufgerufen,
 *  aber teure stat()-Calls werden auf einen pro 500 Append-Operationen
 *  begrenzt — sonst kostet jeder Log-Aufruf einen Syscall.
 *  In-Memory-Counter fuer den Fast-Path. */
let jsonlAppendsSinceCheck = 0;
const JSONL_CHECK_EVERY = 500;

function rotateJsonlIfNeeded(): void {
  try {
    if (!fs.existsSync(jsonlPath)) return;
    const size = fs.statSync(jsonlPath).size;
    if (size < LOG_JSONL_MAX_BYTES) return;

    // Aelteste loeschen (falls vorhanden), dann durchschieben.
    const oldest = `${jsonlPath}.${LOG_JSONL_KEEP_FILES}`;
    if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    for (let i = LOG_JSONL_KEEP_FILES - 1; i >= 1; i--) {
      const src = `${jsonlPath}.${i}`;
      const dst = `${jsonlPath}.${i + 1}`;
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    fs.renameSync(jsonlPath, `${jsonlPath}.1`);
  } catch {
    /* Rotation-Fehler darf den Logging-Pfad nicht killen */
  }
}

function appendJsonl(entry: LogEntry): void {
  try {
    ensureLogDir();
    if (jsonlAppendsSinceCheck >= JSONL_CHECK_EVERY) {
      jsonlAppendsSinceCheck = 0;
      rotateJsonlIfNeeded();
    } else {
      jsonlAppendsSinceCheck++;
    }
    fs.appendFileSync(jsonlPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    /* JSONL-Fehler ist nicht kritisch */
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function logInfo(msg: string, ctx?: string): void {
  const humanLine = `[${humanTimestamp()}] INFO  ${ctx ? `[${ctx}] ` : ""}${msg}`;
  console.log(humanLine);
  append(humanLine);
  appendJsonl({ ts: isoNow(), level: "info", ctx, msg });
}

export function logWarn(msg: string, ctx?: string): void {
  const humanLine = `[${humanTimestamp()}] WARN  ${ctx ? `[${ctx}] ` : ""}${msg}`;
  console.warn(humanLine);
  append(humanLine);
  appendJsonl({ ts: isoNow(), level: "warn", ctx, msg });
}

export function logError(context: string, err: unknown): void {
  const errMsg = err instanceof Error ? err.message : String(err);
  const humanLine = `[${humanTimestamp()}] ERROR [${context}] ${errMsg}`;
  console.error(humanLine);
  append(humanLine);
  appendJsonl({
    ts: isoNow(),
    level: "error",
    ctx: context,
    msg: errMsg,
    err: err instanceof Error ? err.stack : undefined,
  });
}

export function readRecentLogs(n = 20): string {
  if (!fs.existsSync(LOG_FILE)) return "Keine Logs vorhanden.";
  const lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
  return lines.slice(-n).join("\n") || "Keine Logs vorhanden.";
}
