import type { Context } from "grammy";
import { vaultExists, getVaultPath, inspectAgentWorkspace, estimateTokens, clearAgentToday, listAgents, getAgentPath, loadAgentHistory } from "../obsidian.js";
import fs from "fs";
import path from "path";

const HILFE = `
Bau-OS

Schreib einfach mit mir – ich erledige alles via KI.
Notizen, Aufgaben, Termine, Projekte, Suche → einfach tippen.

System-Commands
/heute    Tages-Briefing
/status   Bot-Status
/config   Konfiguration
/kontext  Kontext-Auslastung
/kompakt  Log komprimieren
/neu      Kontext zurücksetzen
/agents   Sub-Agents
/model    Modell wechseln
/fast     Fast-Modus
/export   Session exportieren
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
  const files = inspectAgentWorkspace("Main", "full");

  if (!files.length) {
    await ctx.reply("Kein Workspace gefunden (Agents/Main/).");
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
    "📊 Main Agent Kontext",
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
  const cleared = clearAgentToday("Main");
  await ctx.reply(cleared
    ? "Gesprächskontext zurückgesetzt. Ich starte frisch."
    : "Kein heutiger Verlauf gefunden – bin bereits frisch."
  );
}

export async function handleKompakt(ctx: Context): Promise<void> {
  const { compactNow } = await import("../llm.js");
  await ctx.replyWithChatAction("typing");
  const result = await compactNow("Main");
  await ctx.reply(result);
}

export async function handleCommands(ctx: Context): Promise<void> {
  const out = `
Bau-OS – System-Commands

/heute        Tages-Briefing (Termine + Aufgaben)
/config       Konfiguration anzeigen
/status       Bot-Status
/kontext      Kontext-Auslastung
/kompakt      Log komprimieren
/neu          Gesprächskontext zurücksetzen
/whoami       Meine Chat-ID anzeigen
/agents       Sub-Agents auflisten
/export       Session-Log exportieren
/model        Modell anzeigen oder wechseln
/fast         Fast-Modus umschalten
/sprache      Whisper-Sprache (de|en|auto)
  `.trim();
  await ctx.reply(out);
}

export async function handleWhoami(ctx: Context): Promise<void> {
  const user = ctx.from;
  const chatId = ctx.chat?.id;
  const lines = [
    `Chat-ID: ${chatId}`,
    user?.username ? `Username: @${user.username}` : null,
    user?.first_name ? `Name: ${user.first_name}${user.last_name ? " " + user.last_name : ""}` : null,
  ].filter(Boolean);
  await ctx.reply(lines.join("\n"));
}

export async function handleAgents(ctx: Context): Promise<void> {
  const agents = listAgents();
  if (!agents.length) {
    await ctx.reply("Keine Sub-Agents vorhanden.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = agents.map(name => {
    const logPath = path.join(getAgentPath(name), "MEMORY_LOGS", `${today}.md`);
    const aktiv = fs.existsSync(logPath) ? "● aktiv" : "○";
    return `${aktiv} ${name}`;
  });

  await ctx.reply(`Sub-Agents:\n\n${lines.join("\n")}`);
}

export async function handleExportSession(ctx: Context): Promise<void> {
  const history = loadAgentHistory("Main", 100);
  if (!history.length) {
    await ctx.reply("Kein Gesprächsverlauf für heute.");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = history.map(h => `User: ${h.user}\nAgent: ${h.assistant}`).join("\n\n---\n\n");
  const content = `# Session Export – ${today}\n\n${lines}\n`;

  const exportPath = path.join(getVaultPath(), "Exports", `session_${today}.md`);
  const exportDir = path.dirname(exportPath);
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(exportPath, content, "utf-8");

  await ctx.reply(`✅ Exportiert nach:\nExports/session_${today}.md`);
}

export async function handleModel(ctx: Context, args: string): Promise<void> {
  const { getModel, getSubagentModel, isFastMode, setModel } = await import("../llm.js");
  const name = args?.trim();

  if (!name) {
    await ctx.reply(
      `Aktives Modell: ${getModel()}\nSub-Agent Modell: ${getSubagentModel()}\nFast-Modus: ${isFastMode() ? "an" : "aus"}\n\nWechseln: /model <modellname>`
    );
    return;
  }

  setModel(name);
  await ctx.reply(`✅ Modell gewechselt auf: ${name}`);
}

export async function handleFast(ctx: Context): Promise<void> {
  const { toggleFast, getModel } = await import("../llm.js");
  const isNowFast = toggleFast();
  await ctx.reply(
    isNowFast
      ? `⚡ Fast-Modus an — aktives Modell: ${getModel()}`
      : `🐢 Fast-Modus aus — aktives Modell: ${getModel()}`
  );
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

export async function handleHeute(ctx: Context): Promise<void> {
  const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), 4000);
  await ctx.replyWithChatAction("typing");
  try {
    const { processAgent } = await import("../llm.js");
    const { fmt, stripMarkdown } = await import("../format.js");
    const prompt = "Erstelle ein Tages-Briefing: (1) Heutige Termine, (2) Offene Aufgaben, (3) Relevantes aus MEMORY.md. Nur was heute relevant ist. Kurz und strukturiert.";
    const antwort = await processAgent("Main", prompt, "full");
    clearInterval(typing);
    try {
      await ctx.reply(fmt(antwort), { parse_mode: "HTML" });
    } catch {
      await ctx.reply(stripMarkdown(antwort));
    }
  } catch (err) {
    clearInterval(typing);
    console.error("Heute Fehler:", err);
    await ctx.reply("Fehler beim Briefing – ist Ollama erreichbar?");
  }
}

export async function handleConfig(ctx: Context): Promise<void> {
  const token = process.env.BOT_TOKEN ?? "–";
  const masked = token.length > 10 ? token.slice(0, 8) + "..." + token.slice(-4) : "–";

  const out = [
    "Bau-OS Konfiguration",
    "",
    `BOT_TOKEN:  ${masked}`,
    `VAULT_PATH: ${process.env.VAULT_PATH ?? "–"}`,
    `OLLAMA_URL: ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1"}`,
    `MODELL:     ${process.env.OLLAMA_MODEL ?? "qwen2.5:7b"}`,
    `DASHBOARD:  Port ${process.env.DASHBOARD_PORT ?? "3000"}`,
    "",
    "Bearbeitung nur über Web-Dashboard möglich.",
  ].join("\n");

  await ctx.reply(out);
}
