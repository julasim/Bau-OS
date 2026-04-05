#!/usr/bin/env node
/**
 * Bau-OS Installer
 * Läuft einmalig beim ersten Aufsetzen auf einem neuen Server/PC.
 * Erstellt .env und den Agents/Main/ Workspace.
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".env");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    fs.readFileSync(ENV_PATH, "utf-8")
      .split("\n")
      .filter(l => l.includes("=") && !l.startsWith("#"))
      .map(l => l.split("=").map(s => s.trim()) as [string, string])
  );
}

function writeEnv(values: Record<string, string>): void {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

function createWorkspace(vaultPath: string): void {
  const agentPath = path.join(vaultPath, "Agents", "Main");
  const memLogsPath = path.join(agentPath, "MEMORY_LOGS");

  fs.mkdirSync(memLogsPath, { recursive: true });

  const files: Record<string, string> = {
    "IDENTITY.md": `# Identity\n\n## Name: Main Agent\n## Emoji: 🤖\n## Vibe: Hilfsbereit, präzise, zuverlässig.\n## Kontext: Allgemeiner KI-Assistent für Büro und Unternehmen.\n`,
    "SOUL.md": `# Main Agent – Soul\n\n## Identität\nDu bist der Main Agent — ein KI-Assistent für Büro und Unternehmen.\nHilfsbereit, präzise, zuverlässig — immer auf den Punkt.\n\n## Aufgaben\n- Notizen, Aufgaben und Termine verwalten\n- Informationen abrufen und speichern\n- Im Vault suchen und Dateien lesen\n- Bei Bedarf spezialisierte Sub-Agenten starten\n\n## Ton & Stil\n- Immer auf Deutsch\n- Kurz und direkt — wir sind in Telegram, kein Fließtext\n- Bestätigung: kurz ("✅ gespeichert")\n- Unsicherheit: nachfragen statt raten\n\n## Langzeitgedächtnis (MEMORY.md)\nNutze memory_speichern proaktiv wenn der Benutzer sagt "merk dir", "vergiss nicht" oder eine Information dauerhaft relevant ist.\n`,
    "USER.md": `# User\n\nNoch nicht eingerichtet.\n`,
    "AGENTS.md": `# Main Agent – Betriebsanweisungen\n\n## Rolle & Auftrag\nDu bist der Main Agent — der einzige Agent der direkt mit dem Benutzer kommuniziert.\nDu koordinierst alle anderen Agents und entscheidest selbst wann du sie brauchst.\n\n## Prioritäten\n1. Explizite Aufgaben sofort erledigen\n2. Wichtige Informationen in MEMORY.md speichern\n3. Bei komplexen Aufgaben Sub-Agents spawnen\n4. Kurz und direkt antworten\n\n## Memory\n- MEMORY.md — dauerhaftes Wissen\n- MEMORY_LOGS/ — Tages-Logs\n\n## Sub-Agents\nNeue Agents mit agent_erstellen anlegen.\n`,
    "BOOT.md": `# Main Agent – Boot\n\nWird bei jedem Bot-Neustart ausgeführt.\n\n## Startup-Checkliste\n- Heutige Termine prüfen → bei Terminen heute kurz erwähnen\n- Überfällige Aufgaben prüfen → wenn vorhanden hinweisen\n- MEMORY.md auf aktuelle Relevanz prüfen\n`,
    "BOOTSTRAP.md": `# Main Agent – Bootstrap\n\nDu bist ein freundlicher Einrichtungsassistent für diesen KI-Agenten.\nDeine Aufgabe: Den Benutzer durch eine kurze Einrichtung führen.\nStelle je eine Frage pro Nachricht und warte auf die Antwort.\nSei kurz und freundlich. Antworte immer auf Deutsch.\n\n## Fragen (der Reihe nach)\n1. Wie soll der Assistent heißen? (Beispiel: Bau-OS)\n2. Welches Emoji passt dazu? (Beispiel: 🏗️)\n3. Wie soll sein Charakter sein? (Beispiel: Präzise, verlässlich, direkt)\n4. Für was für ein Unternehmen ist er? (Beispiel: Architekturbüro in Wien)\n5. Wie heißt du? (Vorname reicht)\n6. Name des Unternehmens?\n\n## Abschluss\nSobald du alle 6 Antworten hast, rufe setup_abschliessen auf mit:\n- name, emoji, vibe, context, userName, userCompany\n\n## Dateien die erstellt werden\n- IDENTITY.md — Name, Emoji, Vibe, Kontext\n- SOUL.md — Identität und Charakter\n- USER.md — Profil des Benutzers\n`,
    "TOOLS.md": `# Main Agent – Tool-Konventionen\n\n## Wann welches Tool\n- notiz_speichern → freie Gedanken, Beobachtungen, Ideen\n- aufgabe_speichern → konkrete To-dos\n- termin_speichern → Meetings, Deadlines\n- memory_speichern → dauerhaft wichtige Fakten\n- vault_suchen → vor dem Erstellen erst suchen\n- agent_spawnen_async → für längere Aufgaben\n- agent_spawnen → für kurze Sub-Aufgaben\n\n## Regeln\n- Nie doppelt speichern\n- Aufgaben mit konkretem Verb beginnen\n- Termine immer mit Datum TT.MM.JJJJ\n`,
    "MEMORY.md": `# Memory – Main Agent\n\nHier werden dauerhafte Erkenntnisse, Entscheidungen und wichtige Fakten gespeichert.\n`,
    "HEARTBEAT.md": `# Main Agent – Heartbeat\n\nWird für periodische automatische Checks genutzt (Cron).\n\n## Bei jedem Heartbeat-Run\n- Offene Aufgaben prüfen — bei überfälligen den Benutzer informieren\n- Heutige Termine prüfen — Erinnerung senden wenn nötig\n- MEMORY.md auf Vollständigkeit prüfen\n`,
  };

  let created = 0;
  for (const [filename, content] of Object.entries(files)) {
    const fp = path.join(agentPath, filename);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, content, "utf-8");
      created++;
    }
  }

  console.log(`  Workspace: ${agentPath}`);
  console.log(`  ${created} Dateien angelegt${created < Object.keys(files).length ? `, ${Object.keys(files).length - created} bereits vorhanden` : ""}`);
}

async function main() {
  console.log("\n╔══════════════════════════════╗");
  console.log("║       Bau-OS Installer       ║");
  console.log("╚══════════════════════════════╝\n");

  const env = readEnv();

  // ─── BOT_TOKEN ──────────────────────────────────────────────────────────────
  let botToken = env["BOT_TOKEN"] || "";
  if (botToken) {
    console.log(`BOT_TOKEN: bereits vorhanden ✓`);
  } else {
    console.log("Erstelle einen Telegram Bot via @BotFather und füge den Token hier ein.");
    botToken = await ask("BOT_TOKEN: ");
    if (!botToken) { console.error("BOT_TOKEN darf nicht leer sein."); process.exit(1); }
  }

  // ─── VAULT_PATH ─────────────────────────────────────────────────────────────
  let vaultPath = env["VAULT_PATH"] || "";
  if (vaultPath) {
    console.log(`VAULT_PATH: bereits vorhanden ✓ (${vaultPath})`);
  } else {
    console.log("\nPfad zum Obsidian Vault (wo Notizen, Aufgaben etc. gespeichert werden).");
    console.log("Beispiel Windows: C:\\Users\\Name\\Obsidian\\Vault");
    vaultPath = await ask("VAULT_PATH: ");
    if (!vaultPath) { console.error("VAULT_PATH darf nicht leer sein."); process.exit(1); }
    if (!fs.existsSync(vaultPath)) {
      const create = await ask(`Pfad existiert nicht. Anlegen? (j/n): `);
      if (create.toLowerCase() === "j") {
        fs.mkdirSync(vaultPath, { recursive: true });
        console.log("  Ordner angelegt ✓");
      } else {
        console.error("Abgebrochen."); process.exit(1);
      }
    }
  }

  // ─── OLLAMA ─────────────────────────────────────────────────────────────────
  let ollamaUrl = env["OLLAMA_BASE_URL"] || "";
  if (ollamaUrl) {
    console.log(`OLLAMA_BASE_URL: bereits vorhanden ✓ (${ollamaUrl})`);
  } else {
    console.log("\nOllama API URL (Standard: http://localhost:11434/v1)");
    const input = await ask("OLLAMA_BASE_URL [Enter für Standard]: ");
    ollamaUrl = input || "http://localhost:11434/v1";
  }

  let model = env["OLLAMA_MODEL"] || "";
  if (model) {
    console.log(`OLLAMA_MODEL: bereits vorhanden ✓ (${model})`);
  } else {
    const input = await ask("OLLAMA_MODEL [Enter für qwen2.5:7b]: ");
    model = input || "qwen2.5:7b";
  }

  // ─── .env schreiben ─────────────────────────────────────────────────────────
  writeEnv({ ...env, BOT_TOKEN: botToken, VAULT_PATH: vaultPath, OLLAMA_BASE_URL: ollamaUrl, OLLAMA_MODEL: model });
  console.log("\n.env gespeichert ✓");

  // ─── Workspace anlegen ──────────────────────────────────────────────────────
  console.log("\nAgent-Workspace anlegen...");
  createWorkspace(vaultPath);

  // ─── Fertig ─────────────────────────────────────────────────────────────────
  console.log("\n✅ Installation abgeschlossen!");
  console.log("\nStarten mit:");
  console.log("  npm run dev    (Entwicklung, mit Auto-Reload)");
  console.log("  npm start      (Produktion, nach npm run build)\n");

  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
