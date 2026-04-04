import type { Context } from "grammy";
import { saveNote, listNotes, readNote, appendToNote, deleteNote } from "../obsidian.js";

// Parst "Projekt: Text" oder nur "Text"
function parseProjectAndText(args: string): { project?: string; text: string } {
  const colonIndex = args.indexOf(":");
  if (colonIndex > 0) {
    const project = args.slice(0, colonIndex).trim();
    const text = args.slice(colonIndex + 1).trim();
    if (project && text) return { project, text };
  }
  return { text: args.trim() };
}

export async function handleNotiz(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /notiz Text\nMit Projekt: /notiz Projektname: Text");
    return;
  }

  const { project, text } = parseProjectAndText(args);
  const filepath = saveNote(text, project);
  const filename = filepath.split(/[\\/]/).pop();

  const reply = project
    ? `Notiz gespeichert in [${project}]\n${filename}`
    : `Notiz gespeichert\n${filename}`;

  await ctx.reply(reply);
}

export async function handleNotizen(ctx: Context): Promise<void> {
  const notes = listNotes(10);

  if (notes.length === 0) {
    await ctx.reply("Keine Notizen gefunden.");
    return;
  }

  const list = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
  await ctx.reply(`Letzte Notizen:\n\n${list}`);
}

export async function handleLesen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /lesen Dateiname");
    return;
  }

  const content = readNote(args.trim());
  if (!content) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  // Telegram Limit: 4096 Zeichen
  const text = content.length > 3800
    ? content.slice(0, 3800) + "\n\n… (gekürzt)"
    : content;

  await ctx.reply(text);
}

export async function handleBearbeiten(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /bearbeiten Dateiname: Nachtrag-Text");
    return;
  }

  const colonIndex = args.indexOf(":");
  if (colonIndex < 0) {
    await ctx.reply("Format: /bearbeiten Dateiname: Nachtrag-Text");
    return;
  }

  const filename = args.slice(0, colonIndex).trim();
  const nachtrag = args.slice(colonIndex + 1).trim();

  const success = appendToNote(filename, nachtrag);
  if (!success) {
    await ctx.reply(`Datei nicht gefunden: ${filename}`);
    return;
  }

  await ctx.reply(`Nachtrag gespeichert in: ${filename}`);
}

export async function handleLoeschen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /löschen Dateiname");
    return;
  }

  const deleted = deleteNote(args.trim());
  if (!deleted) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  await ctx.reply(`Gelöscht: ${deleted}`);
}
