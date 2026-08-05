#!/usr/bin/env node
/**
 * PATIO — Ersteinrichtung
 *
 * Schreibt die `.env` fuer eine lauffaehige Installation und legt das
 * Workspace-Verzeichnis an. Laeuft einmalig beim Aufsetzen, ist aber
 * gefahrlos wiederholbar.
 *
 * WAS HIER GEFRAGT WIRD, UND WARUM GENAU DAS:
 * `src/index.ts` bricht den Boot mit Exit-Code 1 ab, wenn WORKSPACE_PATH,
 * DATABASE_URL oder JWT_SECRET fehlen. Ein Setup, das diese drei nicht
 * erfragt, erzeugt eine Installation, die garantiert nicht startet — genau
 * das war der Zustand dieses Skripts vor dem Umbau zum Firmenserver (es
 * fragte BOT_TOKEN und OLLAMA_*, beides gibt es seit AP0 nicht mehr).
 *
 * WARUM DIE .env ZEILENWEISE GESCHRIEBEN WIRD:
 * Die frueheren readEnv()/writeEnv() haben die Datei mit `split("=")`
 * zerlegt und komplett neu geschrieben. Folge: alle Kommentare weg, und
 * jeder Wert mit "=" darin (Base64-Secrets enden auf "=" oder "==") wurde
 * beim ersten "=" abgeschnitten. Da JWT_SECRET laut src/config.ts auch der
 * Rueckfall-Schluessel der Feld-Verschluesselung ist, waren verschluesselte
 * Felder danach nicht mehr lesbar. Deshalb: nur die Zeilen anfassen, deren
 * Wert sich wirklich aendert; alles andere bleibt Byte fuer Byte stehen.
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");

// ─────────────────────────────────────────────────────────────────────────────
// .env lesen und schreiben (zeilenerhaltend)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnvFile {
  /** Die Datei so, wie sie auf der Platte steht — inklusive Kommentaren. */
  lines: string[];
  /** Ausgewertete Schluessel/Werte, nur zum Anzeigen und Pruefen. */
  values: Record<string, string>;
}

// Ein Zuweisungs-Zeile: optionales "export ", Schluesselname, "=", Rest.
// Der Rest wird NICHT weiter zerlegt — "=" im Wert ist voellig zulaessig.
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Entfernt genau EIN Paar umschliessender Anfuehrungszeichen, so wie dotenv
 * es tut. Der Inhalt bleibt unangetastet — auch "=", "+" und "/".
 */
function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Wertet eine einzelne Zeile aus. Kommentare und Leerzeilen ergeben null. */
export function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const m = ENV_LINE.exec(line);
  if (!m) return null;
  return { key: m[1], value: unquote(m[2]) };
}

export function parseEnv(text: string): EnvFile {
  // Zeilenenden normalisieren, aber sonst nichts anfassen.
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const values: Record<string, string> = {};
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    // Bei doppelten Schluesseln gewinnt der letzte — so liest dotenv es auch.
    if (parsed) values[parsed.key] = parsed.value;
  }
  return { lines, values };
}

/**
 * Quotet nur, wenn es sein muss: Leerzeichen, "#" oder ein fuehrendes
 * Anfuehrungszeichen wuerden den Wert sonst verkuerzen. "=", "+" und "/"
 * brauchen KEINE Quotes — Base64-Secrets bleiben damit unveraendert lesbar.
 */
export function formatValue(value: string): string {
  const needsQuotes = /\s|#/.test(value) || /^["']/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Setzt einen Wert und laesst den Rest der Datei unberuehrt.
 * Mehrfach vorkommende Schluessel werden auf eine Zeile reduziert — sonst
 * haengt der wirksame Wert davon ab, welche Zeile zuletzt gelesen wird.
 */
export function setEnvValue(file: EnvFile, key: string, value: string): void {
  const newLine = `${key}=${formatValue(value)}`;
  const out: string[] = [];
  let replaced = false;
  for (const line of file.lines) {
    if (parseEnvLine(line)?.key === key) {
      if (!replaced) {
        out.push(newLine);
        replaced = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!replaced) {
    // Ans Ende haengen, aber keine Leerzeile davor verschlucken.
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
    out.push(newLine);
  }
  file.lines = out;
  file.values[key] = value;
}

export function serializeEnv(file: EnvFile): string {
  return file.lines.join("\n").replace(/\n*$/, "\n");
}

export function readEnvFile(envPath: string): EnvFile {
  if (!fs.existsSync(envPath)) return { lines: [], values: {} };
  return parseEnv(fs.readFileSync(envPath, "utf-8"));
}

/**
 * Schreibt die .env atomar (tmp + rename) und legt vorher eine
 * Sicherungskopie an. Die .env traegt Zugangsdaten — Rechte 0600.
 */
export function writeEnvFile(envPath: string, file: EnvFile): string | null {
  let backup: string | null = null;
  if (fs.existsSync(envPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = `${envPath}.bak-${stamp}`;
    fs.copyFileSync(envPath, backup);
  }
  const tmp = `${envPath}.tmp`;
  fs.writeFileSync(tmp, serializeEnv(file), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, envPath);
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    /* Windows kennt keine POSIX-Rechte — kein Grund abzubrechen. */
  }
  return backup;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eingabe-Helfer
// ─────────────────────────────────────────────────────────────────────────────

function createPrompt(): { ask: (q: string) => Promise<string>; close: () => void } {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question: string) => new Promise<string>((resolve) => rl.question(question, (a) => resolve(a.trim()))),
    close: () => rl.close(),
  };
}

/** Kuerzt ein Secret fuer die Anzeige — nichts Geheimes ins Terminal. */
function mask(value: string): string {
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} Zeichen)`;
}

/** Zeigt eine DATABASE_URL ohne Passwort an. */
function maskDbUrl(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]*@/, "://$1:***@");
}

function isValidDbUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/[^\s]+$/.test(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hauptprogramm
// ─────────────────────────────────────────────────────────────────────────────

const HEADER = [
  "# PATIO Konfiguration (angelegt von npm run setup)",
  "# Vollstaendige Liste aller Schluessel mit Erklaerung: .env.example",
  "",
];

async function main(): Promise<void> {
  const { ask, close } = createPrompt();

  console.log("\n╔════════════════════════════════╗");
  console.log("║      PATIO Ersteinrichtung     ║");
  console.log("╚════════════════════════════════╝\n");
  console.log("PATIO laeuft als Web-Dienst gegen PostgreSQL.");
  console.log("Ohne WORKSPACE_PATH, DATABASE_URL und JWT_SECRET startet der Dienst nicht.\n");

  const env = readEnvFile(ENV_PATH);
  if (env.lines.length === 0) env.lines = [...HEADER];

  // ── WORKSPACE_PATH ─────────────────────────────────────────────────────────
  // Hier liegen die Dokumente als Dateien. Alles andere (Projekte, Notizen,
  // Aufgaben, Termine, Team) steht in der Datenbank.
  let workspacePath = env.values["WORKSPACE_PATH"] || "";
  const legacyVaultPath = env.values["VAULT_PATH"] || "";

  if (!workspacePath && legacyVaultPath) {
    // Altbestand: frueher hiess der Schluessel VAULT_PATH. src/config.ts liest
    // ihn noch als Rueckfall, aber der kanonische Name ist WORKSPACE_PATH.
    console.log(`Gefunden: VAULT_PATH=${legacyVaultPath} (alter Name).`);
    const take = await ask("Als WORKSPACE_PATH uebernehmen? (j/n): ");
    if (take.toLowerCase() === "j") workspacePath = legacyVaultPath;
  }

  if (workspacePath) {
    console.log(`WORKSPACE_PATH: bereits gesetzt ✓ (${workspacePath})`);
  } else {
    console.log("\nVerzeichnis fuer die Dokumentenablage.");
    console.log("Beispiel Linux:   /opt/patio-workspace");
    console.log("Beispiel Windows: C:\\Users\\Name\\PATIO");
    workspacePath = await ask("WORKSPACE_PATH: ");
    if (!workspacePath) {
      console.error("WORKSPACE_PATH darf nicht leer sein — der Dienst bricht sonst beim Start ab.");
      close();
      process.exit(1);
    }
  }

  if (!fs.existsSync(workspacePath)) {
    const create = await ask(`Pfad existiert nicht. Anlegen? (j/n): `);
    if (create.toLowerCase() === "j") {
      fs.mkdirSync(workspacePath, { recursive: true });
      console.log("  Verzeichnis angelegt ✓");
    } else {
      console.error("Abgebrochen — ohne existierendes Verzeichnis kann PATIO keine Dateien ablegen.");
      close();
      process.exit(1);
    }
  }

  // ── DATABASE_URL ───────────────────────────────────────────────────────────
  let databaseUrl = env.values["DATABASE_URL"] || "";
  if (databaseUrl) {
    console.log(`DATABASE_URL: bereits gesetzt ✓ (${maskDbUrl(databaseUrl)})`);
  } else {
    console.log("\nVerbindung zur PostgreSQL-Datenbank.");
    console.log("Format: postgres://BENUTZER:PASSWORT@HOST:5432/DATENBANK");
    console.log("Bei Docker-Compose bleibt der Wert leer — docker-compose.yml setzt ihn selbst.");
    while (true) {
      const input = await ask("DATABASE_URL (leer = Docker-Compose): ");
      if (!input) {
        console.log("  uebersprungen — docker-compose.yml setzt DATABASE_URL aus POSTGRES_*.");
        break;
      }
      if (isValidDbUrl(input)) {
        databaseUrl = input;
        break;
      }
      console.log("  Das sieht nicht nach einem Connection-String aus (postgres://…). Bitte erneut.");
    }
  }

  // ── JWT_SECRET ─────────────────────────────────────────────────────────────
  // Zweitverwendung beachten: solange ENCRYPTION_KEY leer ist, verschluesselt
  // src/crypto.ts mit dem JWT_SECRET. Ein Austausch macht dann bestehende
  // verschluesselte Felder unlesbar — deshalb wird ein vorhandener Wert hier
  // niemals ungefragt ersetzt.
  let jwtSecret = env.values["JWT_SECRET"] || "";
  if (jwtSecret) {
    console.log(`JWT_SECRET: bereits gesetzt ✓ (${mask(jwtSecret)})`);
    if (jwtSecret.length < 32) {
      console.log("  ! Kuerzer als 32 Zeichen — in Produktion verweigert der Dienst den Start.");
    }
  } else {
    console.log("\nJWT_SECRET fuer den Web-Login (mind. 32 Zeichen).");
    const input = await ask("JWT_SECRET [Enter = neu erzeugen]: ");
    if (input) {
      jwtSecret = input;
      if (jwtSecret.length < 32) {
        console.log("  ! Kuerzer als 32 Zeichen — in Produktion verweigert der Dienst den Start.");
      }
    } else {
      jwtSecret = crypto.randomBytes(48).toString("base64");
      console.log(`  Erzeugt ✓ (${mask(jwtSecret)})`);
    }
  }

  // ── ENCRYPTION_KEY ─────────────────────────────────────────────────────────
  // Nur bei einer frischen Installation automatisch erzeugen. Kommt der
  // Schluessel spaeter dazu, muessen die bereits verschluesselten Felder mit
  // `npm run db:reencrypt` umgeschluesselt werden — das darf dieses Skript
  // nicht im Vorbeigehen ausloesen.
  const encryptionKey = env.values["ENCRYPTION_KEY"] || "";
  let newEncryptionKey = "";
  const freshInstall = !fs.existsSync(ENV_PATH);
  if (encryptionKey) {
    console.log(`ENCRYPTION_KEY: bereits gesetzt ✓ (${mask(encryptionKey)})`);
  } else if (freshInstall) {
    newEncryptionKey = crypto.randomBytes(32).toString("base64");
    console.log(`ENCRYPTION_KEY: erzeugt ✓ (${mask(newEncryptionKey)})`);
  } else {
    console.log("ENCRYPTION_KEY: nicht gesetzt — Feld-Verschluesselung nutzt das JWT_SECRET.");
    console.log("  Eigenen Schluessel nachziehen: docs/sec-4-crypto-migration.md + npm run db:reencrypt");
  }

  // ── API_PORT ───────────────────────────────────────────────────────────────
  let apiPort = env.values["API_PORT"] || "";
  if (apiPort) {
    console.log(`API_PORT: bereits gesetzt ✓ (${apiPort})`);
  } else {
    const input = await ask("API_PORT [Enter fuer 3000]: ");
    apiPort = input || "3000";
  }

  // ── .env schreiben ─────────────────────────────────────────────────────────
  setEnvValue(env, "WORKSPACE_PATH", workspacePath);
  if (databaseUrl) setEnvValue(env, "DATABASE_URL", databaseUrl);
  setEnvValue(env, "JWT_SECRET", jwtSecret);
  if (newEncryptionKey) setEnvValue(env, "ENCRYPTION_KEY", newEncryptionKey);
  setEnvValue(env, "API_PORT", apiPort);

  const backup = writeEnvFile(ENV_PATH, env);
  console.log(`\n.env gespeichert ✓ (${ENV_PATH})`);
  if (backup) console.log(`Sicherungskopie der vorigen Fassung: ${path.basename(backup)}`);

  // ── Naechste Schritte ──────────────────────────────────────────────────────
  console.log("\nFertig. Weiter geht es mit:");
  if (!databaseUrl) {
    console.log("  docker compose up -d          (Datenbank + Dienst als Container)");
  } else {
    console.log("  npm run db:status            Verbindung + Migrationsstand pruefen");
    console.log("  npm run dev                  Entwicklung (Auto-Reload)");
    console.log("  npm run build && npm start   Produktion");
  }
  console.log("");
  console.log("Hinweis: Der Login schickt 6-stellige Codes per E-Mail. Ohne SMTP_* in der");
  console.log(".env landet der Code im Server-Log (siehe .env.example, Abschnitt SMTP).");
  console.log("");

  close();
}

// Nur ausfuehren, wenn direkt aufgerufen — beim Import (Tests) passiert nichts.
const invokedDirectly =
  !!process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
