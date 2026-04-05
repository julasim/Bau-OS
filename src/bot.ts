import { Bot } from "grammy";
import fs from "fs";
import { saveNote } from "./obsidian.js";
import { downloadFile, transcribeAudio, getTempPath } from "./transcribe.js";
import { processMessage } from "./llm.js";
import { handleNotiz, handleNotizen, handleLesen, handleBearbeiten, handleLoeschen } from "./commands/notiz.js";
import { handleAufgabe, handleAufgaben, handleErledigt } from "./commands/aufgaben.js";
import { handleTermin, handleTermine, handleTerminLoeschen } from "./commands/termine.js";
import { handleProjekt, handleProjekte, handleProjektInfo } from "./commands/projekte.js";
import { handleDateiLesen, handleDateiErstellen, handleDateiLoeschen, handleOrdnerListe, handleExportieren } from "./commands/dateien.js";
import { handleSuchen } from "./commands/suchen.js";
import { handleHilfe, handleStatus, handleSprache } from "./commands/system.js";

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // ─── System ────────────────────────────────────────────────────────────────
  bot.command("start",   (ctx) => handleHilfe(ctx));
  bot.command("hilfe",   (ctx) => handleHilfe(ctx));
  bot.command("status",  (ctx) => handleStatus(ctx));
  bot.command("sprache", (ctx) => handleSprache(ctx, ctx.match));

  // ─── Notizen ───────────────────────────────────────────────────────────────
  bot.command("notiz",      (ctx) => handleNotiz(ctx, ctx.match));
  bot.command("notizen",    (ctx) => handleNotizen(ctx));
  bot.command("lesen",      (ctx) => handleLesen(ctx, ctx.match));
  bot.command("bearbeiten", (ctx) => handleBearbeiten(ctx, ctx.match));
  bot.command("loschen",    (ctx) => handleLoeschen(ctx, ctx.match));
  bot.command("löschen",    (ctx) => handleLoeschen(ctx, ctx.match));

  // ─── Aufgaben ──────────────────────────────────────────────────────────────
  bot.command("aufgabe",  (ctx) => handleAufgabe(ctx, ctx.match));
  bot.command("aufgaben", (ctx) => handleAufgaben(ctx, ctx.match));
  bot.command("erledigt", (ctx) => handleErledigt(ctx, ctx.match));

  // ─── Termine ───────────────────────────────────────────────────────────────
  bot.command("termin",          (ctx) => handleTermin(ctx, ctx.match));
  bot.command("termine",         (ctx) => handleTermine(ctx, ctx.match));
  bot.command("termin_loschen",  (ctx) => handleTerminLoeschen(ctx, ctx.match));
  bot.command("termin_löschen",  (ctx) => handleTerminLoeschen(ctx, ctx.match));

  // ─── Projekte ──────────────────────────────────────────────────────────────
  bot.command("projekt",      (ctx) => handleProjekt(ctx, ctx.match));
  bot.command("projekte",     (ctx) => handleProjekte(ctx));
  bot.command("projekt_info", (ctx) => handleProjektInfo(ctx, ctx.match));

  // ─── Dateien ───────────────────────────────────────────────────────────────
  bot.command("datei_lesen",     (ctx) => handleDateiLesen(ctx, ctx.match));
  bot.command("datei_erstellen", (ctx) => handleDateiErstellen(ctx, ctx.match));
  bot.command("datei_loschen",   (ctx) => handleDateiLoeschen(ctx, ctx.match));
  bot.command("datei_löschen",   (ctx) => handleDateiLoeschen(ctx, ctx.match));
  bot.command("ordner",          (ctx) => handleOrdnerListe(ctx, ctx.match));
  bot.command("exportieren",     (ctx) => handleExportieren(ctx, ctx.match));

  // ─── Suche ─────────────────────────────────────────────────────────────────
  bot.command("suchen", (ctx) => handleSuchen(ctx, ctx.match));

  // ─── Textnachrichten → LLM ────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    await ctx.reply("⏳");

    try {
      const antwort = await processMessage(text);
      await ctx.reply(antwort);
    } catch (err: unknown) {
      console.error("LLM Fehler:", err);
      // Fallback: direkt als Notiz speichern wenn LLM nicht erreichbar
      try {
        const filepath = saveNote(text);
        const filename = filepath.split(/[\\/]/).pop();
        await ctx.reply(`LLM nicht erreichbar – als Notiz gespeichert: ${filename}`);
      } catch {
        await ctx.reply("Fehler – ist Ollama gestartet? (ollama serve)");
      }
    }
  });

  // ─── Sprachnachrichten → Whisper ───────────────────────────────────────────
  bot.on("message:voice", async (ctx) => {
    await ctx.reply("Transkribiere...");

    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const tempPath = getTempPath(`voice_${Date.now()}.ogg`);

    try {
      await downloadFile(fileUrl, tempPath);
      const text = await transcribeAudio(tempPath);

      if (!text) {
        await ctx.reply("Transkription leer – bitte nochmal versuchen.");
        return;
      }

      // Transkription durch LLM verarbeiten (wie normale Textnachricht)
      const antwort = await processMessage(text);
      await ctx.reply(`🎤 "${text}"\n\n${antwort}`);
    } catch (err) {
      console.error("Fehler bei Transkription:", err);
      await ctx.reply("Fehler bei der Transkription.");
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  });

  return bot;
}
