import type { Context } from "grammy";
import { InputFile } from "grammy";
import { readFile, createFile, deleteFile, listFolder, getAbsolutePath } from "../obsidian.js";
import fs from "fs";

export async function handleDateiLesen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /datei-lesen Pfad/zur/Datei.md");
    return;
  }

  const content = readFile(args.trim());
  if (!content) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  const text = content.length > 3800
    ? content.slice(0, 3800) + "\n\n… (gekürzt)"
    : content;

  await ctx.reply(text);
}

export async function handleDateiErstellen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /datei-erstellen Pfad/Datei.md: Inhalt");
    return;
  }

  const colonIndex = args.indexOf(":");
  if (colonIndex < 0) {
    await ctx.reply("Format: /datei-erstellen Pfad/Datei.md: Inhalt");
    return;
  }

  const relativePath = args.slice(0, colonIndex).trim();
  const content = args.slice(colonIndex + 1).trim();

  const filepath = createFile(relativePath, content);
  const filename = filepath.split(/[\\/]/).pop();
  await ctx.reply(`Datei erstellt: ${filename}`);
}

export async function handleDateiLoeschen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /datei-löschen Pfad/zur/Datei.md");
    return;
  }

  const success = deleteFile(args.trim());
  if (!success) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  await ctx.reply(`Gelöscht: ${args.trim()}`);
}

export async function handleOrdnerListe(ctx: Context, args: string): Promise<void> {
  const relativePath = args?.trim() || "";
  const entries = listFolder(relativePath);

  if (entries.length === 0) {
    const label = relativePath || "Vault-Root";
    await ctx.reply(`${label} ist leer oder nicht gefunden.`);
    return;
  }

  const header = relativePath ? `Inhalt von ${relativePath}:\n\n` : "Vault-Root:\n\n";
  await ctx.reply(header + entries.join("\n"));
}

export async function handleExportieren(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /exportieren Pfad/zur/Datei.md");
    return;
  }

  const absolutePath = getAbsolutePath(args.trim());

  if (!fs.existsSync(absolutePath)) {
    await ctx.reply(`Datei nicht gefunden: ${args}`);
    return;
  }

  const filename = absolutePath.split(/[\\/]/).pop()!;
  await ctx.replyWithDocument(new InputFile(absolutePath, filename));
}
