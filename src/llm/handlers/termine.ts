import type OpenAI from "openai";
import { saveTermin, listTermine, deleteTermin } from "../../vault/index.js";
import type { HandlerMap } from "./types.js";

export const terminSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "termin_speichern", description: "Speichert einen neuen Termin, Meeting oder Deadline. Datum immer im Format TT.MM.JJJJ angeben. Relative Angaben wie 'morgen' oder 'naechsten Montag' muessen vorher in ein konkretes Datum umgerechnet werden.", parameters: { type: "object", properties: { datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" }, text: { type: "string", description: "Beschreibung des Termins" }, uhrzeit: { type: "string", description: "Optional: Uhrzeit im Format HH:MM" }, projekt: { type: "string", description: "Optionaler Projektname" } }, required: ["datum", "text"] } } },
  { type: "function", function: { name: "termine_auflisten", description: "Listet alle gespeicherten Termine auf, sortiert nach Datum. Zeigt Datum, Uhrzeit, Beschreibung und Ort an. Optional auf ein Projekt filterbar.", parameters: { type: "object", properties: { projekt: { type: "string", description: "Optional: nur Termine eines Projekts" } }, required: [] } } },
  { type: "function", function: { name: "termin_loeschen", description: "Loescht einen Termin dauerhaft. Der Text muss exakt oder als Teiltext uebereinstimmen. Nutze termine_auflisten um den genauen Text zu finden.", parameters: { type: "object", properties: { text: { type: "string", description: "Text oder Teiltext des Termins" }, projekt: { type: "string", description: "Optionaler Projektname" } }, required: ["text"] } } },
];

export const terminHandlers: HandlerMap = {
  termin_speichern: async (args) => {
    const result = saveTermin(String(args.datum), String(args.text), args.uhrzeit ? String(args.uhrzeit) : undefined, args.projekt ? String(args.projekt) : undefined);
    if (typeof result === "string") return result;
    return `Termin gespeichert: ${result.datum} – ${result.text}`;
  },

  termine_auflisten: async (args) => {
    const termine = listTermine(args.projekt ? String(args.projekt) : undefined);
    return termine.length
      ? termine.map(t => `\u{1F4C5} ${t.datum}${t.uhrzeit ? ` ${t.uhrzeit}` : ""} – ${t.text}${t.location ? ` (${t.location})` : ""}`).join("\n")
      : "Keine Termine.";
  },

  termin_loeschen: async (args) => {
    const ok = deleteTermin(String(args.text), args.projekt ? String(args.projekt) : undefined);
    return ok ? `Termin geloescht: ${args.text}` : `Termin "${args.text}" nicht gefunden. Nutze termine_auflisten um den genauen Text zu sehen.`;
  },
};
