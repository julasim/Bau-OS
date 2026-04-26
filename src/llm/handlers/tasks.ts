import type OpenAI from "openai";
import { taskRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { getVisibleProjectIds } from "../../data/access.js";
import type { HandlerMap } from "./types.js";
import { resolveMember, formatCandidates } from "./team.js";
import { notifyTaskAssigned, resolveUserIdFromMember } from "../../notifications.js";

export const taskSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "aufgabe_speichern",
      description:
        "Speichert eine neue Aufgabe (Todo). Aufgaben immer mit konkretem Verb beginnen (z.B. 'Angebot fuer Fenster einholen'). Optional einem Projekt und einem Team-Mitglied zuordnen. Wenn ein Mitglied zugewiesen wird, bekommt es automatisch eine Telegram-Benachrichtigung (sofern verlinkt).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Beschreibung der Aufgabe" },
          projekt: { type: "string", description: "Optionaler Projektname" },
          zuweisung: {
            type: "string",
            description:
              "Optional: Team-Mitglied dem die Aufgabe zugewiesen wird (Name oder Teilname). Wird ueber das Team aufgeloest. Beispiel: 'Polier Schmidt' oder 'Mueller'.",
          },
          faellig: {
            type: "string",
            description: "Optional: Faelligkeitsdatum im Format TT.MM.JJJJ",
          },
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
    const text = String(args.text);
    const projekt = args.projekt ? String(args.projekt) : undefined;
    const fallig = args.faellig ? String(args.faellig) : undefined;

    // Optional: Team-Mitglied resolven (fuzzy match auf Name/Teilname).
    let assigneeId: string | null = null;
    let assigneeName: string | null = null;
    if (args.zuweisung) {
      const r = await resolveMember(String(args.zuweisung));
      if (!r.ok && r.reason === "ambiguous") {
        return `Mehrere Team-Mitglieder passen auf "${args.zuweisung}": ${formatCandidates(r.candidates ?? [])}. Bitte genauer angeben.`;
      }
      if (!r.ok) {
        return `Team-Mitglied "${args.zuweisung}" nicht gefunden. Mit team_anlegen zuerst hinzufuegen oder Zuweisung weglassen.`;
      }
      assigneeId = r.member.id;
      assigneeName = r.member.name;
    }

    const task = await taskRepo.save(text, projekt);
    if (assigneeId || fallig) {
      // db-tasks update schreibt nur `date` — nicht dueDate. Wir mappen
      // beide auf das gleiche Feld; das DTO unterscheidet das in der UI.
      await taskRepo.update(
        task.id,
        {
          assigneeId,
          assignee: assigneeName,
          date: fallig ?? null,
        },
        projekt,
      );
    }
    emit({ type: "task", action: "created", id: task.id, project: projekt ?? null });

    // Notification feuern, wenn ein Mitglied zugewiesen wurde + es einen
    // verlinkten User-Account hat + es nicht der aktuelle User ist.
    if (assigneeId) {
      void (async () => {
        const ctx = getCurrentUserCtx();
        const targetUserId = await resolveUserIdFromMember(assigneeId);
        if (targetUserId && targetUserId !== ctx?.userId) {
          await notifyTaskAssigned(
            targetUserId,
            { text, project: projekt ?? null, date: fallig ?? null },
            null, // Akteur ist der LLM-Agent — kein "von"-Hinweis
          );
        }
      })();
    }

    const tail = assigneeName ? ` (zugewiesen an ${assigneeName})` : "";
    return `Aufgabe gespeichert: ${text}${tail}`;
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
