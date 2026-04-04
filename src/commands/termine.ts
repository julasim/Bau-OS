import type { Context } from "grammy";
import { saveTermin, listTermine, deleteTermin } from "../obsidian.js";

// Parst: "10.04.2026 09:00 Baubesprechung" oder "10.04.2026 Abnahme"
// Mit Projekt: "Wohnbau-Linz: 10.04.2026 09:00 Text"
function parseTermin(args: string): {
  project?: string;
  datum: string;
  uhrzeit?: string;
  text: string;
} | null {
  let input = args.trim();
  let project: string | undefined;

  const colonIndex = input.indexOf(":");
  if (colonIndex > 0 && colonIndex < 30) {
    project = input.slice(0, colonIndex).trim();
    input = input.slice(colonIndex + 1).trim();
  }

  const parts = input.split(/\s+/);
  if (parts.length < 2) return null;

  const datum = parts[0];
  const timeRegex = /^\d{1,2}:\d{2}$/;

  if (parts.length >= 3 && timeRegex.test(parts[1])) {
    return { project, datum, uhrzeit: parts[1], text: parts.slice(2).join(" ") };
  }

  return { project, datum, text: parts.slice(1).join(" ") };
}

export async function handleTermin(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply(
      "Verwendung:\n/termin 10.04.2026 09:00 Baubesprechung\n/termin 10.04.2026 Abnahme Elektrik\nMit Projekt: /termin Projektname: 10.04.2026 Text"
    );
    return;
  }

  const parsed = parseTermin(args);
  if (!parsed) {
    await ctx.reply("Format nicht erkannt. Beispiel: /termin 10.04.2026 09:00 Baubesprechung");
    return;
  }

  const { project, datum, uhrzeit, text } = parsed;
  saveTermin(datum, text, uhrzeit, project);

  const display = uhrzeit ? `${datum} um ${uhrzeit} – ${text}` : `${datum} – ${text}`;
  const reply = project
    ? `Termin gespeichert in [${project}]\n📅 ${display}`
    : `Termin gespeichert\n📅 ${display}`;

  await ctx.reply(reply);
}

export async function handleTermine(ctx: Context, args: string): Promise<void> {
  const project = args?.trim() || undefined;
  const termine = listTermine(project);

  if (termine.length === 0) {
    const msg = project ? `Keine Termine in [${project}].` : "Keine Termine vorhanden.";
    await ctx.reply(msg);
    return;
  }

  const list = termine.map(t => `📅 ${t}`).join("\n");
  const header = project ? `Termine – ${project}:\n\n` : "Termine:\n\n";
  await ctx.reply(header + list);
}

export async function handleTerminLoeschen(ctx: Context, args: string): Promise<void> {
  if (!args) {
    await ctx.reply("Verwendung: /termin-löschen Suchbegriff\nMit Projekt: /termin-löschen Projektname: Suchbegriff");
    return;
  }

  let project: string | undefined;
  let text = args.trim();

  const colonIndex = args.indexOf(":");
  if (colonIndex > 0) {
    project = args.slice(0, colonIndex).trim();
    text = args.slice(colonIndex + 1).trim();
  }

  const success = deleteTermin(text, project);
  if (!success) {
    await ctx.reply(`Termin nicht gefunden: "${text}"`);
    return;
  }

  await ctx.reply(`Termin gelöscht: ${text}`);
}
