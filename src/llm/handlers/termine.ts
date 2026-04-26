import type OpenAI from "openai";
import { terminRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { getVisibleProjectIds } from "../../data/access.js";
import type { HandlerMap } from "./types.js";
import { resolveMember, formatCandidates } from "./team.js";
import { notifyTerminInvited, resolveUserIdsFromMembers } from "../../notifications.js";

export const terminSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "termin_speichern",
      description:
        "Speichert einen neuen Termin, Meeting oder Deadline. Datum immer im Format TT.MM.JJJJ angeben. Relative Angaben wie 'morgen' oder 'naechsten Montag' muessen vorher in ein konkretes Datum umgerechnet werden. Optional Team-Mitglieder als Teilnehmer einladen — die bekommen dann automatisch eine Telegram-Benachrichtigung (sofern verlinkt).",
      parameters: {
        type: "object",
        properties: {
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          text: { type: "string", description: "Beschreibung des Termins" },
          uhrzeit: { type: "string", description: "Optional: Uhrzeit im Format HH:MM" },
          projekt: { type: "string", description: "Optionaler Projektname" },
          teilnehmer: {
            type: "string",
            description:
              "Optional: Team-Mitglieder als Teilnehmer (komma-getrennt). Beispiel: 'Polier Schmidt, Architekt Mueller'. Nicht erkannte Namen werden als Freitext-Teilnehmer gespeichert.",
          },
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
    const datum = String(args.datum);
    const text = String(args.text);
    const uhrzeit = args.uhrzeit ? String(args.uhrzeit) : undefined;
    const projekt = args.projekt ? String(args.projekt) : undefined;

    // Optional: Teilnehmer-Liste resolven. Treffer → assigneeIds (UUIDs),
    // nicht-aufloesbare Namen → assignees (Freitext-Array). Mehrdeutige
    // Treffer brechen ab und fragen den Agenten um Klaerung.
    const assigneeIds: string[] = [];
    const assigneeNames: string[] = [];
    const assigneeFreeText: string[] = [];
    if (args.teilnehmer) {
      const names = String(args.teilnehmer)
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      for (const name of names) {
        const r = await resolveMember(name);
        if (!r.ok && r.reason === "ambiguous") {
          return `Mehrere Team-Mitglieder passen auf "${name}": ${formatCandidates(r.candidates ?? [])}. Bitte genauer angeben.`;
        }
        if (r.ok) {
          assigneeIds.push(r.member.id);
          assigneeNames.push(r.member.name);
        } else {
          // Nicht erkannt → als Freitext beibehalten, kein Notification.
          assigneeFreeText.push(name);
        }
      }
    }

    const result = await terminRepo.save(datum, text, uhrzeit, projekt);
    if (typeof result === "string") return result;

    if (assigneeIds.length > 0 || assigneeFreeText.length > 0) {
      await terminRepo.update(
        result.id,
        {
          assigneeIds,
          // assignees laeuft als Mix aus Member-Namen + Freitext.
          assignees: [...assigneeNames, ...assigneeFreeText],
        },
        projekt,
      );
    }

    emit({ type: "termin", action: "created", id: result.id, project: projekt ?? null });

    // Notification an verlinkte Teilnehmer.
    if (assigneeIds.length > 0) {
      void (async () => {
        const ctx = getCurrentUserCtx();
        const userIds = await resolveUserIdsFromMembers(assigneeIds);
        if (userIds.length > 0) {
          await notifyTerminInvited(
            userIds,
            { text, datum: result.datum, uhrzeit: result.uhrzeit, project: projekt ?? null },
            ctx?.userId ?? null,
            null,
          );
        }
      })();
    }

    const tnTail = assigneeNames.length > 0 ? ` mit ${assigneeNames.join(", ")}` : "";
    const extTail = assigneeFreeText.length > 0 ? ` (extern: ${assigneeFreeText.join(", ")})` : "";
    return `Termin gespeichert: ${result.datum} – ${result.text}${tnTail}${extTail}`;
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
