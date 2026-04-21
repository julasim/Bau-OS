import type OpenAI from "openai";
import { teamRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import type { HandlerMap } from "./types.js";

export const teamSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "team_auflisten",
      description: "Listet alle Team-Mitglieder auf (Namen und ggf. Rolle / Firma).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "team_anlegen",
      description:
        "Legt ein neues Team-Mitglied an. Mindestens der Name ist erforderlich. Rolle, E-Mail, Telefon und Firma sind optional und werden nur im DB-Modus gespeichert (im Filesystem-Modus nur der Name).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Vor- und Nachname" },
          rolle: { type: "string", description: "Optional: z.B. Polier, Techniker, Buchhaltung" },
          email: { type: "string", description: "Optional: E-Mail-Adresse" },
          telefon: { type: "string", description: "Optional: Telefonnummer" },
          firma: { type: "string", description: "Optional: Firma / Subunternehmer" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_entfernen",
      description: "Entfernt ein Team-Mitglied per Name oder ID.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Name oder ID des Mitglieds" } },
        required: ["name"],
      },
    },
  },
];

export const teamHandlers: HandlerMap = {
  team_auflisten: async () => {
    const members = await teamRepo.list();
    if (members.length === 0) return "Keine Team-Mitglieder vorhanden.";
    return members
      .map((m) => {
        const extras = [m.role, m.company, m.email, m.phone].filter(Boolean).join(" \u2022 ");
        return extras ? `- ${m.name} (${extras})` : `- ${m.name}`;
      })
      .join("\n");
  },

  team_anlegen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    try {
      const member = await teamRepo.add({
        name,
        role: args.rolle ? String(args.rolle) : null,
        email: args.email ? String(args.email) : null,
        phone: args.telefon ? String(args.telefon) : null,
        company: args.firma ? String(args.firma) : null,
        projectId: null,
      });
      emit({ type: "team", action: "created", id: member.id });
      return `Team-Mitglied "${member.name}" angelegt.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Konnte "${name}" nicht anlegen: ${msg}`;
    }
  },

  team_entfernen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";
    const ok = await teamRepo.remove(name);
    if (!ok) return `"${name}" nicht im Team gefunden.`;
    emit({ type: "team", action: "deleted" });
    return `"${name}" aus dem Team entfernt.`;
  },
};
