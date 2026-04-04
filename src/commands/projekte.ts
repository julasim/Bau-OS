import type { Context } from "grammy";
import { createProject, listProjects, getProjectInfo } from "../obsidian.js";

export async function handleProjekt(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /projekt Projektname");
    return;
  }

  const name = args.trim();
  const projectPath = createProject(name);

  await ctx.reply(
    `Projekt angelegt: ${name}\n\nOrdnerstruktur erstellt:\n📁 Notizen/\n📄 Aufgaben.md\n📄 Termine.md\n📄 README.md`
  );
}

export async function handleProjekte(ctx: Context): Promise<void> {
  const projects = listProjects();

  if (projects.length === 0) {
    await ctx.reply("Keine Projekte vorhanden.\n\nMit /projekt Name ein neues anlegen.");
    return;
  }

  const list = projects.map((p, i) => `${i + 1}. ${p}`).join("\n");
  await ctx.reply(`Projekte:\n\n${list}`);
}

export async function handleProjektInfo(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /projekt-info Projektname");
    return;
  }

  const info = getProjectInfo(args.trim());
  if (!info) {
    await ctx.reply(`Projekt nicht gefunden: ${args}\n\nMit /projekte alle Projekte anzeigen.`);
    return;
  }

  await ctx.reply(info);
}
