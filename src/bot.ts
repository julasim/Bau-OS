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
import { findDbUserByChatId, redeemPairToken, countDbUsers, type DbUser } from "./api/auth.js";
import { runWithUserCtx } from "./llm/user-context.js";
import type { UserCtx } from "./data/access.js";
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

/**
 * Erzeugt eine Bot-Instanz.
 *   - Ohne ownerUser: Shared-Bot via env BOT_TOKEN. Nutzt Phase-5-Pairing
 *     (chat_id muss zu einem User-Konto gemapped sein).
 *   - Mit ownerUser: Per-User-Bot (Phase 6). Bot ist fest an ownerUser.id
 *     gebunden. Erste Nachricht setzt chat_id automatisch (auto-pair),
 *     spaetere Nachrichten von anderen Chats werden abgewiesen.
 *
 * In beiden Faellen wird processMessage in runWithUserCtx() eingebettet,
 * damit Tool-Handler den User-Kontext via getCurrentUserCtx() lesen koennen.
 */
export function createBot(token: string, ownerUser?: DbUser | null): Bot {
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
    const result = await redeemPairToken(arg.toUpperCase(), String(ctx.chat.id));
    if (!result.ok) {
      if (result.reason === "chat-id-taken") {
        await ctx.reply(
          `Dieser Telegram-Account ist bereits mit dem Bau-OS-User "${result.existingUsername}" verknuepft. Pro Bau-OS-Konto braucht es einen eigenen Telegram-Account. Falls das ein Versehen war: Admin kann das alte Pairing aufloesen.`,
        );
        return;
      }
      await ctx.reply("Ungueltiger oder abgelaufener Code. Bitte beim Admin einen neuen anfordern.");
      return;
    }
    const user = result.user;
    await ctx.reply(
      `Erfolgreich verknuepft mit "${user.displayName ?? user.username}".\nAb jetzt antwortet der Bot auf deine Nachrichten. /hilfe zeigt die verfuegbaren Befehle.`,
    );
  });

  // Helper: identifiziert den User hinter dem Chat. Gibt entweder einen
  // gefundenen DbUser zurueck oder null (mit User-Hinweis im Reply).
  //
  // Drei Modi:
  //   1) Per-User-Bot (ownerUser gesetzt): Bot gehoert nur diesem User.
  //      Erste Nachricht: chat_id wird auto-gespeichert. Spaetere Nachrichten
  //      von anderen Chat-IDs werden abgewiesen.
  //   2) Shared-Bot (kein ownerUser) im DB-Mode mit Usern: Phase-5-Pairing.
  //   3) Shared-Bot ohne DB / vor Setup: alles erlaubt (Legacy).
  async function checkAuth(ctx: {
    chat: { id: number };
    reply: (msg: string) => Promise<unknown>;
  }): Promise<DbUser | null> {
    if (ownerUser) {
      // Per-User-Bot.
      const expectedChat = ownerUser.telegramChatId;
      if (!expectedChat) {
        // Erste Nachricht — chat_id auto-pairen via direktem DB-Update.
        // Aber: nur wenn die chat_id NICHT schon einem anderen User gehoert.
        // Sonst wuerde der UNIQUE-Index aus Migration 015 einen Fehler werfen.
        if (DB_ENABLED) {
          const { getDb } = await import("./db/client.js");
          const db = getDb();
          // Pruefen ob chat_id schon vergeben ist.
          const conflict = await db`
            SELECT username FROM users
             WHERE telegram_chat_id = ${String(ctx.chat.id)} AND id <> ${ownerUser.id}
             LIMIT 1
          `;
          if (conflict.length > 0) {
            await ctx.reply(
              `Dieser Telegram-Account ist bereits mit "${conflict[0]!.username}" verknuepft. Bitte einen eigenen Telegram-Account fuer dein Bau-OS-Konto verwenden.`,
            );
            return null;
          }
          await db`UPDATE users SET telegram_chat_id = ${String(ctx.chat.id)} WHERE id = ${ownerUser.id}`;
          ownerUser.telegramChatId = String(ctx.chat.id);
        }
        return ownerUser;
      }
      if (expectedChat !== String(ctx.chat.id)) {
        await ctx.reply("Dieser Bot gehoert einem anderen Konto.");
        return null;
      }
      return ownerUser;
    }

    // Shared-Bot Pfad.
    if (!DB_ENABLED) return null; // FS-Mode → kein scoping, processMessage laeuft ohne ctx
    const userCount = await countDbUsers();
    if (userCount === 0) return null;
    const user = await findDbUserByChatId(ctx.chat.id);
    if (!user) {
      await ctx.reply(
        "Nicht autorisiert. Bitte deinen Admin um einen Pair-Code (Web → Nutzer → Telegram pairen) und sende dann /pair <code>.",
      );
      return null;
    }
    return user;
  }

  // Hilfs-Wrapper: laedt processMessage mit User-Kontext, wenn vorhanden.
  // Sonst direkt aufrufen (Legacy/FS-Mode).
  async function runScoped<T>(user: DbUser | null, fn: () => Promise<T>): Promise<T> {
    if (!user) return fn();
    const ctx: UserCtx = { userId: user.id, role: user.role };
    return runWithUserCtx(ctx, fn);
  }

  // --- Textnachrichten -> LLM ---
  bot.on("message:text", (ctx) => {
    enqueue(ctx.chat.id, async () => {
      saveChatId(ctx.chat.id);
      const raw = ctx.message.text;

      // Auth + User-Kontext bestimmen.
      let scopeUser: DbUser | null = null;
      if (!raw.startsWith("/")) {
        scopeUser = await checkAuth(ctx);
        if (ownerUser && !scopeUser) return; // Per-User-Bot, falscher Chat
        if (!ownerUser && DB_ENABLED && (await countDbUsers()) > 0 && !scopeUser) return;
      } else if (ownerUser) {
        // Auch fuer Slash-Commands an einem Per-User-Bot: nur Owner-Chat erlaubt.
        scopeUser = await checkAuth(ctx);
        if (!scopeUser) return;
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
          const antwort = await runScoped(scopeUser, () => processBtw(btwMatch[1].trim()));
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
        // runScoped umhuellt processMessage mit dem User-AsyncLocalStorage.
        // Tools wie projekte_auflisten lesen den Kontext und scopen ihre
        // Repo-Aufrufe entsprechend (User sieht nur seine Daten).
        const antwort = await runScoped(scopeUser, () => processMessage(text));
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
      // Auth + User-Kontext. Per-User-Bots sind ueber owner gebunden;
      // Shared-Bot braucht gepairten Chat (siehe checkAuth).
      const scopeUser = await checkAuth(ctx);
      if (ownerUser && !scopeUser) return;
      if (!ownerUser && DB_ENABLED && (await countDbUsers()) > 0 && !scopeUser) return;
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
        const antwort = await runScoped(scopeUser, () => processMessage(prompt));

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
