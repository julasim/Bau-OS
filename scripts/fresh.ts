#!/usr/bin/env node
/**
 * Setzt den Main-Agent Workspace zurück auf den Ausgangszustand.
 * Nur für Entwicklung/Testing — simuliert einen frischen Erststart.
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> => new Promise(r => rl.question(q, r));

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) { console.error("VAULT_PATH nicht gesetzt. Erst npm run setup ausführen."); process.exit(1); }

  const agentPath = path.join(vaultPath, "Agents", "Main");
  if (!fs.existsSync(agentPath)) { console.error("Kein Workspace gefunden."); process.exit(1); }

  console.log("\n⚠️  Workspace zurücksetzen?");
  console.log("  IDENTITY.md, SOUL.md, USER.md werden auf Standard zurückgesetzt.");
  console.log("  MEMORY.md und MEMORY_LOGS/ bleiben erhalten.\n");

  const confirm = await ask("Fortfahren? (j/n): ");
  if (confirm.toLowerCase() !== "j") { console.log("Abgebrochen."); rl.close(); return; }

  // Kein "## Name:" → isMainWorkspaceConfigured() gibt false zurück → Wizard startet
  fs.writeFileSync(path.join(agentPath, "IDENTITY.md"),
    `# Identity\n\nNoch nicht eingerichtet.\n`, "utf-8");

  fs.writeFileSync(path.join(agentPath, "SOUL.md"),
    `# Main Agent – Soul\n\n## Identität\nDu bist der Main Agent — ein KI-Assistent für Büro und Unternehmen.\nHilfsbereit, präzise, zuverlässig — immer auf den Punkt.\n\n## Ton & Stil\n- Immer auf Deutsch\n- Kurz und direkt\n- Unsicherheit: nachfragen statt raten\n`, "utf-8");

  fs.writeFileSync(path.join(agentPath, "USER.md"),
    `# User\n\nNoch nicht eingerichtet.\n`, "utf-8");

  console.log("\n✅ Workspace zurückgesetzt. Setup-Wizard startet beim nächsten Bot-Start.\n");
  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
