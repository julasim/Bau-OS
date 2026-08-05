import fs from "fs";
import path from "path";
import { LOG_FILE, MAX_LOG_LINES, TIMEZONE, LOG_JSONL_MAX_BYTES, LOG_JSONL_KEEP_FILES } from "./config.js";

// ── INF-13: non-blocking Logging ─────────────────────────────────────────────
//
// console.* schreibt sofort nach stdout/stderr — das ist die primaere
// Observability im Container (Docker/journald sammeln es). Die Datei-Persistenz
// (patio.log fuer readRecentLogs + patio.jsonl maschinenlesbar) laeuft ueber eine
// SERIALISIERTE Async-Queue: kein fs.*Sync mehr im Hot-Path, der Event-Loop
// blockiert nicht mehr bei jedem Log-Aufruf. Ein einziger Consumer arbeitet die
// Queue der Reihe nach ab — das garantiert Log-Reihenfolge und verhindert Races
// zwischen Append, Trim und Rotation. Bei Prozess-Ende wird der Rest synchron
// geflusht (flushLogsSync), damit die letzten Zeilen nicht verloren gehen.

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

const jsonlPath = LOG_FILE.replace(/\.log$/, ".jsonl");

// ── Async Write-Queue ─────────────────────────────────────────────────────────

/** Ein Queue-Eintrag: eine human-lesbare Zeile (patio.log) und/oder eine
 *  JSONL-Zeile (patio.jsonl). Beide OHNE abschliessendes "\n" — das setzt der
 *  Writer. */
interface LogJob {
  human?: string;
  jsonl?: string;
}

const queue: LogJob[] = [];
let draining = false;

function ensureLogDir(): void {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Zeilenzahl der patio.log einmalig ermitteln (fuer das Trim-Limit). */
async function initLineCount(): Promise<void> {
  if (lineCount >= 0) return;
  try {
    const content = await fs.promises.readFile(LOG_FILE, "utf-8");
    lineCount = content.split("\n").filter(Boolean).length;
  } catch {
    lineCount = 0;
  }
}

/** Serieller Consumer. Laeuft immer nur EINMAL (draining-Flag) und arbeitet die
 *  Queue leer; kommen waehrenddessen neue Jobs, haengt er einen weiteren Lauf an.
 *  Fire-and-forget aufgerufen (void) — der Aufrufer wartet nie. */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    ensureLogDir();
    await initLineCount();
    while (queue.length > 0) {
      const job = queue.shift()!;
      if (job.human !== undefined) {
        await fs.promises.appendFile(LOG_FILE, job.human + "\n", "utf-8");
        lineCount++;
        if (lineCount > MAX_LOG_LINES) await trimLog();
      }
      if (job.jsonl !== undefined) {
        if (jsonlAppendsSinceCheck >= JSONL_CHECK_EVERY) {
          jsonlAppendsSinceCheck = 0;
          await rotateJsonlIfNeeded();
        } else {
          jsonlAppendsSinceCheck++;
        }
        await fs.promises.appendFile(jsonlPath, job.jsonl + "\n", "utf-8");
      }
    }
  } catch {
    /* Datei-Logging ist best-effort — ein Schreibfehler darf nie fatal sein. */
  } finally {
    draining = false;
    if (queue.length > 0) void drain();
  }
}

function enqueue(job: LogJob): void {
  queue.push(job);
  void drain();
}

async function trimLog(): Promise<void> {
  try {
    const content = await fs.promises.readFile(LOG_FILE, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const trimmed = lines.slice(-MAX_LOG_LINES);
    await fs.promises.writeFile(LOG_FILE, trimmed.join("\n") + "\n", "utf-8");
    lineCount = trimmed.length;
  } catch {
    /* Fehler beim Trimmen ist nicht kritisch */
  }
}

// ── JSONL-Rotation (groessenbasiert) ──────────────────────────────────────────
// Teure stat()-Calls werden auf einen pro JSONL_CHECK_EVERY Appends begrenzt.

let jsonlAppendsSinceCheck = 0;
const JSONL_CHECK_EVERY = 500;

async function rotateJsonlIfNeeded(): Promise<void> {
  try {
    const st = await fs.promises.stat(jsonlPath).catch(() => null);
    if (!st || st.size < LOG_JSONL_MAX_BYTES) return;

    // Aelteste loeschen (falls vorhanden), dann durchschieben.
    await fs.promises.rm(`${jsonlPath}.${LOG_JSONL_KEEP_FILES}`, { force: true });
    for (let i = LOG_JSONL_KEEP_FILES - 1; i >= 1; i--) {
      await fs.promises.rename(`${jsonlPath}.${i}`, `${jsonlPath}.${i + 1}`).catch(() => {});
    }
    await fs.promises.rename(jsonlPath, `${jsonlPath}.1`).catch(() => {});
  } catch {
    /* Rotation-Fehler darf den Logging-Pfad nicht killen */
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function logInfo(msg: string, ctx?: string): void {
  const humanLine = `[${humanTimestamp()}] INFO  ${ctx ? `[${ctx}] ` : ""}${msg}`;
  console.log(humanLine);
  enqueue({ human: humanLine, jsonl: JSON.stringify({ ts: isoNow(), level: "info", ctx, msg } satisfies LogEntry) });
}

export function logWarn(msg: string, ctx?: string): void {
  const humanLine = `[${humanTimestamp()}] WARN  ${ctx ? `[${ctx}] ` : ""}${msg}`;
  console.warn(humanLine);
  enqueue({ human: humanLine, jsonl: JSON.stringify({ ts: isoNow(), level: "warn", ctx, msg } satisfies LogEntry) });
}

export function logError(context: string, err: unknown): void {
  const errMsg = err instanceof Error ? err.message : String(err);
  const humanLine = `[${humanTimestamp()}] ERROR [${context}] ${errMsg}`;
  console.error(humanLine);
  enqueue({
    human: humanLine,
    jsonl: JSON.stringify({
      ts: isoNow(),
      level: "error",
      ctx: context,
      msg: errMsg,
      err: err instanceof Error ? err.stack : undefined,
    } satisfies LogEntry),
  });
}

export function readRecentLogs(n = 20): string {
  // Bereits geschriebene Zeilen …
  let lines: string[] = [];
  try {
    if (fs.existsSync(LOG_FILE)) {
      lines = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  // … plus noch nicht geflushte Zeilen aus der Queue, damit /logs auch die
  // allerletzten Eintraege zeigt.
  for (const job of queue) {
    if (job.human !== undefined) lines.push(job.human);
  }
  if (lines.length === 0) return "Keine Logs vorhanden.";
  return lines.slice(-n).join("\n") || "Keine Logs vorhanden.";
}

/** Synchroner Notfall-Flush bei Prozess-Ende: der Async-Consumer kommt beim
 *  Exit nicht mehr durch, also schreiben wir die Rest-Queue direkt raus.
 *  In index.ts an process.on("exit"/SIGINT/SIGTERM) haengen. */
export function flushLogsSync(): void {
  if (queue.length === 0) return;
  try {
    ensureLogDir();
    const humanRest = queue
      .map((j) => j.human)
      .filter((l): l is string => l !== undefined)
      .join("\n");
    const jsonlRest = queue
      .map((j) => j.jsonl)
      .filter((l): l is string => l !== undefined)
      .join("\n");
    if (humanRest) fs.appendFileSync(LOG_FILE, humanRest + "\n", "utf-8");
    if (jsonlRest) fs.appendFileSync(jsonlPath, jsonlRest + "\n", "utf-8");
    queue.length = 0;
  } catch {
    /* letzter Rettungsversuch — Fehler hier ignorieren */
  }
}
