import { Bot } from "grammy";
import { saveNote, isMainWorkspaceConfigured } from "./workspace/index.js";
import { processMessage, processBtw, processAgent } from "./llm/runtime.js";
import { processSetup, isSetupActive, activateSetup } from "./llm/setup.js";
import { setReplyContext } from "./llm/executor.js";
import { logError } from "./logger.js";
import { enqueue } from "./queue.js";
import { fmt, stripMarkdown } from "./format.js";
import { saveChatId } from "./heartbeat.js";
import { TYPING_INTERVAL_MS } from "./config.js";
import {
  handleHilfe,
  handleStatus,
  handleSprache,
  handleKontext,
  handleKompakt,
  handleNeu,
  handleCommands,
  handleWhoami,
  handleAgents,
  handleExportSession,
  handleModel,
  handleFast,
  handleHeute,
  handleConfig,
  handleRestart,
  handleLogs,
} from "./commands/system.js";

// Sendet mit HTML-Formatting, faellt bei Telegram-Fehler auf Plaintext zurueck
async function safeReply(
  ctx: { reply: (text: string, opts?: object) => Promise<unknown> },
  text: string,
): Promise<void> {
  try {
    await ctx.reply(fmt(text), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(stripMarkdown(text));
  }
}

// Typing-Indicator starten — gibt clearInterval-Funktion zurueck
function startTyping(ctx: { replyWithChatAction: (action: "typing") => Promise<unknown> }): () => void {
  ctx.replyWithChatAction("typing").catch(() => {});
  const timer = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), TYPING_INTERVAL_MS);
  return () => clearInterval(timer);
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // --- System ---
  bot.command("start", (ctx) => handleHilfe(ctx));
  bot.command("hilfe", (ctx) => handleHilfe(ctx));
  bot.command("commands", (ctx) => handleCommands(ctx));
  bot.command("status", (ctx) => handleStatus(ctx));
  bot.command("kontext", (ctx) => handleKontext(ctx));
  bot.command("kompakt", (ctx) => handleKompakt(ctx));
  bot.command("neu", (ctx) => handleNeu(ctx));
  bot.command("whoami", (ctx) => handleWhoami(ctx));
  bot.command("agents", (ctx) => handleAgents(ctx));
  bot.command("export", (ctx) => handleExportSession(ctx));
  bot.command("model", (ctx) => handleModel(ctx, ctx.match));
  bot.command("fast", (ctx) => handleFast(ctx));
  bot.command("sprache", (ctx) => handleSprache(ctx, ctx.match));
  bot.command("heute", (ctx) => handleHeute(ctx));
  bot.command("config", (ctx) => handleConfig(ctx));
  bot.command("restart", (ctx) => handleRestart(ctx));
  bot.command("logs", (ctx) => handleLogs(ctx, ctx.match));

  // --- Textnachrichten -> LLM ---
  bot.on("message:text", (ctx) => {
    enqueue(ctx.chat.id, async () => {
      saveChatId(ctx.chat.id);
      const raw = ctx.message.text;

      // Setup-Wizard (Erster Start)
      if (!isMainWorkspaceConfigured() || isSetupActive()) {
        if (!isSetupActive()) activateSetup();
        const stopTyping = startTyping(ctx);
        try {
          const antwort = await processSetup(raw);
          stopTyping();
          await safeReply(ctx, antwort);
        } catch (err) {
          stopTyping();
          logError("Setup", err);
          await ctx.reply("Fehler beim Setup – ist das LLM gestartet?");
        }
        return;
      }

      // /btw Direktive
      const btwMatch = raw.match(/^\/btw\s+(.+)/is);
      if (btwMatch) {
        const stopTyping = startTyping(ctx);
        try {
          const antwort = await processBtw(btwMatch[1].trim());
          stopTyping();
          await safeReply(ctx, antwort);
        } catch {
          stopTyping();
          await ctx.reply("Fehler bei /btw – ist Ollama gestartet?");
        }
        return;
      }

      const text = raw;
      const stopTyping = startTyping(ctx);

      try {
        setReplyContext((msg) => safeReply(ctx, msg).then(() => {}));
        const antwort = await processMessage(text);
        stopTyping();
        await safeReply(ctx, antwort);
      } catch (err: unknown) {
        stopTyping();
        logError("LLM", err);
        try {
          const filepath = saveNote(text);
          const filename = filepath.split(/[\\/]/).pop();
          await ctx.reply(`LLM nicht erreichbar – als Notiz gespeichert: ${filename}`);
        } catch {
          await ctx.reply("Fehler – ist Ollama gestartet? (ollama serve)");
        }
      }
    });
  });

  bot.on("message:voice", (ctx) => {
    ctx.reply("\u{1F3A4} Sprachnachrichten werden derzeit nicht unterstuetzt. Bitte als Text schreiben.");
  });

  return bot;
}
