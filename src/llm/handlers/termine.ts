import type OpenAI from "openai";
import { terminRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { getVisibleProjectIds } from "../../data/access.js";
import type { HandlerMap } from "./types.js";

export const terminSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "termin_speichern",
      description:
        "Speichert einen neuen Termin, Meeting oder Deadline. Datum immer im Format TT.MM.JJJJ angeben. Relative Angaben wie 'morgen' oder 'naechsten Montag' muessen vorher in ein konkretes Datum umgerechnet werden.",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          text: { type: "string", description: "Beschreibung des Termins" },
          uhrzeit: { type: "string", description: "Optional: Uhrzeit im Format HH:MM" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["datum", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termine_auflisten",
      description:
        "Listet alle gespeicherten Termine auf, sortiert nach Datum. Zeigt Datum, Uhrzeit, Beschreibung und Ort an. Optional auf ein Projekt filterbar.",
      parameters: {
        type: "object",
        properties: { projekt: { type: "string", description: "Optional: nur Termine eines Projekts" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "termin_loeschen",
      description:
        "Loescht einen Termin dauerhaft. Der Text muss exakt oder als Teiltext uebereinstimmen. Nutze termine_auflisten um den genauen Text zu finden.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text oder Teiltext des Termins" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
];

export const terminHandlers: HandlerMap = {
  termin_speichern: async (args) => {
    const result = await terminRepo.save(
      String(args.datum),
      String(args.text),
      args.uhrzeit ? String(args.uhrzeit) : undefined,
      args.projekt ? String(args.projekt) : undefined,
    );
    if (typeof result === "string") return result;
    emit({
      type: "termin",
      action: "created",
      id: result.id,
      project: args.projekt ? String(args.projekt) : null,
    });
    return `Termin gespeichert: ${result.datum} – ${result.text}`;
  },

  termine_auflisten: async (args) => {
    const all = await terminRepo.list(args.projekt ? String(args.projekt) : undefined);
    // Phase 6: User-Scope. Termin sichtbar wenn Projekt erlaubt ODER
    // (kein Projekt UND ich bin Teilnehmer).
    const ctx = getCurrentUserCtx();
    let termine = all;
    if (ctx && ctx.role !== "admin") {
      const visible = await getVisibleProjectIds(ctx);
      const visibleNames = visible === "all" ? null : new Set(await projectRepo.list(visible));
      termine = all.filter((t) => {
        if (visibleNames === null) return true;
        if (t.project) return visibleNames.has(t.project);
        return ctx.userId !== null && Array.isArray(t.assigneeIds) && t.assigneeIds.includes(ctx.userId);
      });
    }
    return termine.length
      ? termine
          .map(
            (t) =>
              `\u{1F4C5} ${t.datum}${t.uhrzeit ? ` ${t.uhrzeit}` : ""} – ${t.text}${t.location ? ` (${t.location})` : ""}`,
          )
          .join("\n")
      : "Keine Termine.";
  },

  termin_loeschen: async (args) => {
    const ok = await terminRepo.delete(String(args.text), args.projekt ? String(args.projekt) : undefined);
    if (!ok) {
      return `Termin "${args.text}" nicht gefunden. Nutze termine_auflisten um den genauen Text zu sehen.`;
    }
    emit({ type: "termin", action: "deleted", project: args.projekt ? String(args.projekt) : null });
    return `Termin geloescht: ${args.text}`;
  },
};
