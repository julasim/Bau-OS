import type { Context } from "grammy";
import { searchVault } from "../obsidian.js";

export async function handleSuchen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /suchen Begriff\nIn Projekt: /suchen Projektname: Begriff");
    return;
  }

  let project: string | undefined;
  let query = args.trim();

  const colonIndex = args.indexOf(":");
  if (colonIndex > 0) {
    project = args.slice(0, colonIndex).trim();
    query = args.slice(colonIndex + 1).trim();
  }

  const results = searchVault(query, project);

  if (results.length === 0) {
    const msg = project
      ? `Keine Treffer für "${query}" in [${project}].`
      : `Keine Treffer für "${query}".`;
    await ctx.reply(msg);
    return;
  }

  const lines = results.map(r => `📄 ${r.file}\n   ${r.line}`).join("\n\n");
  const header = `${results.length} Treffer für "${query}":\n\n`;
  await ctx.reply(header + lines);
}
