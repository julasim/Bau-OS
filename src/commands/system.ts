import type { Context } from "grammy";
import { vaultExists, getVaultPath, inspectAgentWorkspace, estimateTokens, clearAgentToday } from "../obsidian.js";
import fs from "fs";

const HILFE = `
Bau-OS – Befehle

Notizen
/notiz Text
/notiz Projekt: Text
/notizen
/lesen Dateiname
/bearbeiten Dateiname: Text
/löschen Dateiname

Aufgaben
/aufgabe Text
/aufgabe Projekt: Text
/aufgaben
/aufgaben Projekt
/erledigt Text

Termine
/termin 10.04.2026 09:00 Text
/termin Projekt: 10.04.2026 Text
/termine
/termine Projekt
/termin_löschen Text

Projekte
/projekt Name
/projekte
/projekt_info Name

Dateien
/datei_lesen Pfad/Datei.md
/datei_erstellen Pfad/Datei.md: Inhalt
/datei_löschen Pfad/Datei.md
/ordner (Pfad)
/exportieren Pfad/Datei.md

Suche
/suchen Begriff
/suchen Projekt: Begriff

System
/status
/kontext
/kompakt
/neu
/sprache de|en|auto

Audio → automatisch transkribieren & speichern
`.trim();

export async function handleHilfe(ctx: Context): Promise<void> {
  await ctx.reply(HILFE);
}

export async function handleStatus(ctx: Context): Promise<void> {
  const vault = vaultExists();
  const vaultPath = getVaultPath();
  const whisperLang = process.env.WHISPER_LANG ?? "de";
  const pythonPath = process.env.PYTHON_PATH ?? "python";

  let inboxCount = 0;
  let taskCount = 0;

  if (vault) {
    const inboxPath = `${vaultPath}/Inbox`;
    const tasksPath = `${vaultPath}/Aufgaben.md`;

    if (fs.existsSync(inboxPath)) {
      inboxCount = fs.readdirSync(inboxPath).filter(f => f.endsWith(".md")).length;
    }
    if (fs.existsSync(tasksPath)) {
      taskCount = fs.readFileSync(tasksPath, "utf-8")
        .split("\n")
        .filter(l => l.startsWith("- [ ]")).length;
    }
  }

  const status = `
Bau-OS Status

Vault: ${vault ? "✓ erreichbar" : "✗ nicht gefunden"}
Pfad: ${vaultPath}
Notizen in Inbox: ${inboxCount}
Offene Aufgaben: ${taskCount}

Whisper-Sprache: ${whisperLang}
Python: ${pythonPath}
  `.trim();

  await ctx.reply(status);
}

export async function handleKontext(ctx: Context): Promise<void> {
  const files = inspectAgentWorkspace("BauOS", "full");

  if (!files.length) {
    await ctx.reply("Kein Workspace gefunden (Agents/BauOS/).");
    return;
  }

  const totalInjected = files.filter(f => f.loaded).reduce((s, f) => s + f.injectedChars, 0);
  const totalTokens = files.filter(f => f.loaded).reduce((s, f) => s + f.tokens, 0);
  const limitTokens = estimateTokens(150_000 + ""); // 37.500 tok

  const lines = files.map(f => {
    const size = f.rawChars >= 1000
      ? `${(f.rawChars / 1000).toFixed(1)}k`
      : `${f.rawChars}`;
    const flags = [
      !f.loaded   ? "SKIP" : "",
      f.truncated ? "TRUNCATED" : "",
    ].filter(Boolean).join(" ");
    return `${f.name.padEnd(12)} ${size.padStart(5)} Z  (~${f.tokens} tok)${flags ? "  ⚠ " + flags : ""}`;
  });

  const out = [
    "📊 BauOS Kontext",
    "─".repeat(36),
    ...lines,
    "─".repeat(36),
    `Gesamt:      ${(totalInjected / 1000).toFixed(1)}k Z  (~${totalTokens} tok)`,
    `Limit:       150k Z  (~37.500 tok)`,
    `Auslastung:  ${Math.round((totalInjected / 150_000) * 100)}%`,
  ].join("\n");

  await ctx.reply(out);
}

export async function handleNeu(ctx: Context): Promise<void> {
  const cleared = clearAgentToday("BauOS");
  await ctx.reply(cleared
    ? "Gesprächskontext zurückgesetzt. Ich starte frisch."
    : "Kein heutiger Verlauf gefunden – bin bereits frisch."
  );
}

export async function handleKompakt(ctx: Context): Promise<void> {
  const { compactNow } = await import("../llm.js");
  await ctx.replyWithChatAction("typing");
  const result = await compactNow("BauOS");
  await ctx.reply(result);
}

export async function handleSprache(ctx: Context, args: string): Promise<void> {
  const lang = args?.trim().toLowerCase();

  if (!["de", "en", "auto"].includes(lang)) {
    await ctx.reply("Verwendung: /sprache de|en|auto");
    return;
  }

  process.env.WHISPER_LANG = lang;
  await ctx.reply(`Whisper-Sprache geändert auf: ${lang}`);
}
