import type OpenAI from "openai";
import { taskRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { getVisibleProjectIds } from "../../data/access.js";
import type { HandlerMap } from "./types.js";

export const taskSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "aufgabe_speichern",
      description:
        "Speichert eine neue Aufgabe (Todo) im Vault. Aufgaben immer mit konkretem Verb beginnen (z.B. 'Angebot fuer Fenster einholen'). Optional einem Projekt zuordnen. Nutze vault_suchen vorher um Duplikate zu vermeiden.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Beschreibung der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgaben_auflisten",
      description:
        "Listet alle offenen (nicht erledigten) Aufgaben auf. Optional auf ein Projekt filterbar. Zeigt Aufgabentext, Verantwortlichen und Faelligkeitsdatum an.",
      parameters: {
        type: "object",
        properties: { projekt: { type: "string", description: "Optional: nur Aufgaben eines Projekts" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "aufgabe_erledigen",
      description:
        "Markiert eine Aufgabe als erledigt (done). Der Text muss exakt uebereinstimmen — nutze aufgaben_auflisten um den genauen Text zu finden.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Exakter Text der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
];

export const taskHandlers: HandlerMap = {
  aufgabe_speichern: async (args) => {
    await taskRepo.save(String(args.text), args.projekt ? String(args.projekt) : undefined);
    emit({ type: "task", action: "created", project: args.projekt ? String(args.projekt) : null });
    return `Aufgabe gespeichert: ${args.text}`;
  },

  aufgaben_auflisten: async (args) => {
    const tasks = await taskRepo.list(args.projekt ? String(args.projekt) : undefined);
    // Phase 6: User-Scope. Aufgaben nur sichtbar wenn Projekt erlaubt
    // ODER (kein Projekt UND ich bin Assignee).
    const ctx = getCurrentUserCtx();
    let scoped = tasks;
    if (ctx && ctx.role !== "admin") {
      const visible = await getVisibleProjectIds(ctx);
      const visibleNames = visible === "all" ? null : new Set(await projectRepo.list(visible));
      scoped = tasks.filter((t) => {
        if (visibleNames === null) return true;
        if (t.project) return visibleNames.has(t.project);
        return ctx.userId !== null && t.assigneeId === ctx.userId;
      });
    }
    const open = scoped.filter((t) => t.status !== "done");
    return open.length
      ? open
          .map((t) => `\u2022 ${t.text}${t.assignee ? ` (@${t.assignee})` : ""}${t.date ? ` [${t.date}]` : ""}`)
          .join("\n")
      : "Keine offenen Aufgaben.";
  },

  aufgabe_erledigen: async (args) => {
    const ok = await taskRepo.complete(String(args.text), args.projekt ? String(args.projekt) : undefined);
    if (!ok) {
      return `Aufgabe nicht gefunden: "${args.text}". Der Text muss exakt uebereinstimmen — nutze aufgaben_auflisten um den genauen Text zu sehen.`;
    }
    emit({ type: "task", action: "completed", project: args.projekt ? String(args.projekt) : null });
    return `Erledigt: ${args.text}`;
  },
};
