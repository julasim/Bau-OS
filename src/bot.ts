import fs from "fs";
import path from "path";
import { Bot, InputFile } from "grammy";
import { saveNote, isMainWorkspaceConfigured } from "./workspace/index.js";
import { processMessage, processBtw, processAgent } from "./llm/runtime.js";
import { processSetup, isSetupActive, activateSetup } from "./llm/setup.js";
import { setReplyContext, setSendFileContext, setSendBufferContext } from "./llm/executor.js";
import { logError } from "./logger.js";
import { enqueue } from "./queue.js";
import { fmt, stripMarkdown } from "./format.js";
import { saveChatId } from "./heartbeat.js";
import { TYPING_INTERVAL_MS, WORKSPACE_PATH, DB_ENABLED, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./config.js";
import { fileRepo } from "./data/index.js";
import { findDbUserByChatId, redeemPairToken, countDbUsers } from "./api/auth.js";
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

  // --- Telegram-Pairing (Phase 5) ---
  // /pair <token> verknuepft die Telegram-Chat-ID mit einem User-Konto.
  // Funktioniert auch fuer noch nicht autorisierte Chats — sonst koennten
  // sich neue User nie einloggen.
  bot.command("pair", async (ctx) => {
    const arg = (ctx.match ?? "").trim();
    if (!arg) {
      await ctx.reply(
        "Nutzung: /pair <code>\n\nDen Code generiert dein Admin in der Web-Oberflaeche unter Nutzer → Telegram pairen. Er ist 10 Minuten gueltig.",
      );
      return;
    }
    if (!DB_ENABLED) {
      await ctx.reply("Pairing benoetigt DB-Modus.");
      return;
    }
    const user = await redeemPairToken(arg.toUpperCase(), String(ctx.chat.id));
    if (!user) {
      await ctx.reply("Ungueltiger oder abgelaufener Code. Bitte beim Admin einen neuen anfordern.");
      return;
    }
    await ctx.reply(
      `Erfolgreich verknuepft mit "${user.displayName ?? user.username}".\nAb jetzt antwortet der Bot auf deine Nachrichten. /hilfe zeigt die verfuegbaren Befehle.`,
    );
  });

  // Helper: prueft ob die Chat-ID einem User-Konto zugeordnet ist.
  // Gibt User zurueck oder null bei nicht-autorisierten Chats.
  // Im Pre-Setup-Modus (keine User in DB) und im FS-Mode wird die Pruefung
  // uebersprungen — der Bot funktioniert wie vor Phase 5, damit der erste
  // Setup-Lauf nicht aussperrt.
  async function checkAuth(ctx: { chat: { id: number }; reply: (msg: string) => Promise<unknown> }): Promise<boolean> {
    if (!DB_ENABLED) return true;
    const userCount = await countDbUsers();
    if (userCount === 0) return true;
    const user = await findDbUserByChatId(ctx.chat.id);
    if (!user) {
      await ctx.reply(
        "Nicht autorisiert. Bitte deinen Admin um einen Pair-Code (Web → Nutzer → Telegram pairen) und sende dann /pair <code>.",
      );
      return false;
    }
    return true;
  }

  // --- Textnachrichten -> LLM ---
  bot.on("message:text", (ctx) => {
    enqueue(ctx.chat.id, async () => {
      saveChatId(ctx.chat.id);
      const raw = ctx.message.text;

      // Auth-Gate: Slash-Commands wurden bereits oben verdrahtet (inkl.
      // /pair). Alles was hier landet ist freier Text fuer das LLM —
      // gepairte Chats erforderlich. Ausnahmen: /pair selbst (haetten
      // wir oben behandelt, faellt aber durch grammy auch hierdurch),
      // /hilfe, /start. Fuer alle non-Command-Texte: Auth-Gate.
      if (!raw.startsWith("/")) {
        const authOk = await checkAuth(ctx);
        if (!authOk) return;
      }

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
        setSendFileContext(async (absPath) => {
          await ctx.replyWithDocument(new InputFile(absPath), { caption: path.basename(absPath) });
        });
        setSendBufferContext(async (buffer, filename) => {
          await ctx.replyWithDocument(new InputFile(buffer, filename), { caption: filename });
        });
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

  // --- Dokumente / PDFs ---
  bot.on("message:document", (ctx) => {
    enqueue(ctx.chat.id, async () => {
      saveChatId(ctx.chat.id);
      // Auth-Gate auch fuer Datei-Uploads — sonst koennten unautorisierte
      // Chats Dateien hochladen, die der Bot dann analysieren wuerde.
      const authOk = await checkAuth(ctx);
      if (!authOk) return;
      const doc = ctx.message.document;

      // Size-Limit VOR dem Download pruefen — sonst laden wir GBs umsonst.
      if (doc.file_size && doc.file_size > MAX_UPLOAD_BYTES) {
        await ctx.reply(
          `Die Datei "${doc.file_name || "Dokument"}" ist zu groß (max ${MAX_UPLOAD_MB} MB). Bitte kleinere Datei senden.`,
        );
        return;
      }

      const stopTyping = startTyping(ctx);

      try {
        // Datei von Telegram herunterladen
        const fileInfo = await ctx.getFile();
        if (!fileInfo.file_path) throw new Error("Telegram lieferte keinen Dateipfad.");
        const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`Telegram-Download fehlgeschlagen: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());

        const safeName = (doc.file_name || `upload_${Date.now()}`).replace(/[<>:"|?*]/g, "_");

        // Text aus Buffer extrahieren (kein Temp-File noetig)
        const { extractDocumentFromBuffer, extractDocument } = await import("./workspace/extractor.js");
        let extraction: { text: string; format: "pdf" | "docx" | "text" | "unsupported" };
        try {
          extraction = await extractDocumentFromBuffer(buffer, safeName, doc.mime_type || "");
        } catch {
          extraction = { text: "", format: "unsupported" };
        }

        // DB-Modus: direkt als Blob in die DB, kein Vault-Write.
        // FS-Modus (Legacy, kein DATABASE_URL gesetzt): in Uploads/ speichern,
        // damit Telegram ohne DB nicht komplett den File-Support verliert.
        if (DB_ENABLED && fileRepo) {
          try {
            await fileRepo.save({
              filename: safeName,
              filepath: safeName, // nur logischer Name, kein Pfad
              filesize: doc.file_size || buffer.length,
              mimeType: doc.mime_type || undefined,
              contentText: extraction.text || undefined,
              blob: buffer,
            });
          } catch (err) {
            logError("[Telegram Upload DB]", err);
          }
        } else {
          // Legacy-Fallback ohne DB: in Uploads/ legen
          const destDir = path.join(WORKSPACE_PATH, "Uploads");
          fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(path.join(destDir, safeName), buffer);
          // Extractor wurde oben schon mit Buffer aufgerufen — wir brauchen den
          // extractDocument()-File-Pfad-Variant hier nicht mehr.
          void extractDocument;
        }

        // Reply- und File-Context setzen
        setReplyContext((msg) => safeReply(ctx, msg).then(() => {}));
        setSendFileContext(async (absPath) => {
          await ctx.replyWithDocument(new InputFile(absPath), { caption: path.basename(absPath) });
        });
        setSendBufferContext(async (buffer, filename) => {
          await ctx.replyWithDocument(new InputFile(buffer, filename), { caption: filename });
        });

        // LLM mit Dateiinhalt aufrufen
        const extractedInfo =
          extraction.format === "unsupported"
            ? `[Format wird nicht unterstützt: ${path.extname(safeName)}]`
            : extraction.text || "[Kein Textinhalt extrahierbar]";

        const prompt = `Der Nutzer hat die Datei "${safeName}" hochgeladen.\n\nInhalt:\n${extractedInfo}`;
        const antwort = await processMessage(prompt);

        stopTyping();
        await safeReply(ctx, antwort);
      } catch (err) {
        stopTyping();
        logError("Dokument-Upload", err);
        await ctx.reply("Fehler beim Verarbeiten der Datei.");
      }
    });
  });

  return bot;
}
