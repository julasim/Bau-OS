import type { Context } from "grammy";
import { saveTask, listTasks, completeTask } from "../obsidian.js";

function parseProjectAndText(args: string): { project?: string; text: string } {
  const colonIndex = args.indexOf(":");
  if (colonIndex > 0) {
    const project = args.slice(0, colonIndex).trim();
    const text = args.slice(colonIndex + 1).trim();
    if (project && text) return { project, text };
  }
  return { text: args.trim() };
}

export async function handleAufgabe(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /aufgabe Text\nMit Projekt: /aufgabe Projektname: Text");
    return;
  }

  const { project, text } = parseProjectAndText(args);
  saveTask(text, project);

  const reply = project
    ? `Aufgabe gespeichert in [${project}]\n☐ ${text}`
    : `Aufgabe gespeichert\n☐ ${text}`;

  await ctx.reply(reply);
}

export async function handleAufgaben(ctx: Context, args: string): Promise<void> {
  const project = args?.trim() || undefined;
  const tasks = listTasks(project);

  if (tasks.length === 0) {
    const msg = project
      ? `Keine offenen Aufgaben in [${project}].`
      : "Keine offenen Aufgaben.";
    await ctx.reply(msg);
    return;
  }

  const list = tasks.map(t => `☐ ${t}`).join("\n");
  const header = project ? `Offene Aufgaben – ${project}:\n\n` : "Offene Aufgaben:\n\n";
  await ctx.reply(header + list);
}

export async function handleErledigt(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /erledigt Aufgabentext\nMit Projekt: /erledigt Projektname: Aufgabentext");
    return;
  }

  const { project, text } = parseProjectAndText(args);
  const success = completeTask(text, project);

  if (!success) {
    await ctx.reply(`Aufgabe nicht gefunden: "${text}"\n\nMit /aufgaben alle offenen Aufgaben anzeigen.`);
    return;
  }

  await ctx.reply(`Erledigt: ✓ ${text}`);
}
