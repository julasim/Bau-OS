import type OpenAI from "openai";
import { listProjects, getProjectInfo } from "../../vault/index.js";
import type { HandlerMap } from "./types.js";

export const projectSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "projekte_auflisten", description: "Listet alle Projekte im Vault auf (Ordner unter Projekte/). Zeigt nur die Namen — fuer Details zu einem Projekt projekt_info verwenden.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "projekt_info", description: "Zeigt eine Uebersicht zu einem Projekt: Anzahl Notizen, offene Aufgaben und anstehende Termine. Nutze den exakten Projektnamen aus projekte_auflisten.", parameters: { type: "object", properties: { name: { type: "string", description: "Name des Projekts" } }, required: ["name"] } } },
];

export const projectHandlers: HandlerMap = {
  projekte_auflisten: async () => {
    const projects = listProjects();
    return projects.length ? projects.join("\n") : "Keine Projekte vorhanden.";
  },

  projekt_info: async (args) => {
    const info = getProjectInfo(String(args.name));
    if (!info) return `Projekt "${args.name}" nicht gefunden. Nutze projekte_auflisten um alle verfuegbaren Projektnamen zu sehen.`;
    return `Projekt: ${info.name}\n\nNotizen: ${info.notes}\nOffene Aufgaben: ${info.openTasks}\nTermine: ${info.termine}`;
  },
};
