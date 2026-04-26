// ============================================================
// Bau-OS — LLM-Handler: Meetings / Protokolle
// ============================================================
// Drei Tools fuer den Sitzungs-Workflow:
//   - meeting_anlegen: Neues Meeting (typischerweise nach der Sitzung
//     mit Protokoll, kann aber auch vorher mit nur Agenda/Datum sein).
//   - meetings_auflisten: Meetings eines Projekts, neueste zuerst.
//   - meeting_lesen: Volle Detail-Ausgabe fuer ein Meeting.
//
// Datums-Handling:
//   - User-Eingabe TT.MM.JJJJ wird zu YYYY-MM-DD konvertiert.
// User-Scoping wie Bautagebuch ueber Projekt-ACL.
// ============================================================

import type OpenAI from "openai";
import { meetingRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { canSeeProjectByName } from "../../data/access.js";
import type { HandlerMap } from "./types.js";
import type { MeetingType, MeetingInput } from "../../data/types.js";
import { resolveMember, formatCandidates } from "./team.js";
import { notifyMeetingInvited, resolveUserIdsFromMembers } from "../../notifications.js";

const ALLOWED_TYPES: MeetingType[] = [
  "Bauherrenmeeting",
  "Baubesprechung",
  "Subunternehmer",
  "Planung",
  "Behoerde",
  "Abnahme",
  "Sonstiges",
];

function toIsoDate(input: string): string | null {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function toHHMM(input: string): string | null {
  const s = input.trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

async function resolveProject(projektName: string): Promise<{ id: string; name: string } | string> {
  const ctx = getCurrentUserCtx();
  if (ctx && ctx.role !== "admin" && !(await canSeeProjectByName(ctx, projektName))) {
    return `Kein Zugriff auf Projekt "${projektName}".`;
  }
  const info = await projectRepo.getInfo(projektName);
  if (!info?.id) return `Projekt "${projektName}" nicht gefunden.`;
  return { id: info.id, name: info.name };
}

export const meetingSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "meeting_anlegen",
      description:
        "Legt ein neues Meeting / eine Besprechung fuer ein Projekt an. Nutze dieses Tool fuer Bauherrenmeetings, Baubesprechungen, Subunternehmer-Abstimmungen, Behoerden-Termine, Abnahmen. Kann mit Agenda vorab oder mit Protokoll im Nachhinein angelegt werden.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          titel: { type: "string", description: "Kurzer Titel der Sitzung" },
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          startzeit: { type: "string", description: "Optional Startzeit HH:MM" },
          endzeit: { type: "string", description: "Optional Endzeit HH:MM" },
          typ: {
            type: "string",
            description: "Meeting-Typ",
            enum: ALLOWED_TYPES as unknown as string[],
          },
          ort: { type: "string", description: "Optional: Ort der Sitzung" },
          teilnehmer: {
            type: "string",
            description:
              "Teilnehmer (komma-getrennt). Beispiel: 'Bauherr Mueller, Architekt Schmidt, Polier Maier'. Erkannte Team-Mitglieder werden als interne Teilnehmer verlinkt und benachrichtigt; nicht erkannte Namen bleiben als Freitext.",
          },
          agenda: { type: "string", description: "Tagesordnung (Markdown erlaubt)" },
          protokoll: { type: "string", description: "Protokoll der Sitzung (Markdown erlaubt)" },
          beschluesse: { type: "string", description: "Getroffene Beschluesse" },
          folgetermin: { type: "string", description: "Optional Folgetermin im Format TT.MM.JJJJ" },
        },
        required: ["projekt", "titel", "datum"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "meetings_auflisten",
      description:
        "Listet die letzten Meetings eines Projekts auf, neueste zuerst. Zeigt Datum, Titel, Typ und Anzahl Teilnehmer.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          anzahl: { type: "number", description: "Anzahl Meetings (Default: 10)" },
        },
        required: ["projekt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "meeting_lesen",
      description:
        "Gibt die vollstaendigen Details eines Meetings aus: Agenda, Protokoll, Beschluesse, To-Dos und Folgetermin. Vorher mit meetings_auflisten den genauen Titel + Datum finden.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
          titel: {
            type: "string",
            description: "Titel oder Teiltitel des Meetings — bei Mehrdeutigkeit zeigt das Tool eine Auswahl.",
          },
        },
        required: ["projekt", "datum"],
      },
    },
  },
];

export const meetingHandlers: HandlerMap = {
  meeting_anlegen: async (args) => {
    if (!meetingRepo) return "Meetings erfordern DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    const titel = String(args.titel ?? "").trim();
    const datumRaw = String(args.datum ?? "").trim();
    if (!projektName || !titel || !datumRaw) {
      return "Projekt, Titel und Datum sind erforderlich.";
    }

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const iso = toIsoDate(datumRaw);
    if (!iso) return `Ungueltiges Datum "${datumRaw}". Bitte TT.MM.JJJJ verwenden.`;

    const input: MeetingInput = { date: iso, title: titel };

    if ("startzeit" in args) {
      const t = toHHMM(String(args.startzeit));
      if (!t) return `Ungueltige Startzeit "${args.startzeit}". Bitte HH:MM verwenden.`;
      input.startTime = t;
    }
    if ("endzeit" in args) {
      const t = toHHMM(String(args.endzeit));
      if (!t) return `Ungueltige Endzeit "${args.endzeit}". Bitte HH:MM verwenden.`;
      input.endTime = t;
    }
    if ("typ" in args) {
      const t = String(args.typ);
      if (!ALLOWED_TYPES.includes(t as MeetingType)) {
        return `Ungueltiger Typ "${t}". Erlaubt: ${ALLOWED_TYPES.join(", ")}.`;
      }
      input.meetingType = t as MeetingType;
    }
    if ("ort" in args) input.location = String(args.ort);
    if ("teilnehmer" in args) {
      // Resolver-Pattern wie bei termin_speichern: Treffer → attendeeIds,
      // nicht erkannte Namen → attendeesExternal. Mehrdeutige Treffer
      // brechen ab und fragen nach.
      const names = String(args.teilnehmer)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const ids: string[] = [];
      const ext: string[] = [];
      for (const name of names) {
        const r = await resolveMember(name);
        if (!r.ok && r.reason === "ambiguous") {
          return `Mehrere Team-Mitglieder passen auf "${name}": ${formatCandidates(r.candidates ?? [])}. Bitte genauer angeben.`;
        }
        if (r.ok) ids.push(r.member.id);
        else ext.push(name);
      }
      input.attendeeIds = ids;
      input.attendeesExternal = ext;
    }
    if ("agenda" in args) input.agenda = String(args.agenda);
    if ("protokoll" in args) input.minutes = String(args.protokoll);
    if ("beschluesse" in args) input.decisions = String(args.beschluesse);
    if ("folgetermin" in args) {
      const ft = toIsoDate(String(args.folgetermin));
      if (!ft) return `Ungueltiger Folgetermin "${args.folgetermin}". Bitte TT.MM.JJJJ verwenden.`;
      input.nextMeetingDate = ft;
    }

    const ctx = getCurrentUserCtx();
    const result = await meetingRepo.create(proj.id, input, ctx?.userId ?? null);
    if (typeof result === "string") return result;
    emit({ type: "meeting", action: "created", id: result.id, project: proj.name });

    // Notification an verlinkte Teilnehmer.
    if (result.attendeeIds.length > 0) {
      void (async () => {
        const userIds = await resolveUserIdsFromMembers(result.attendeeIds);
        if (userIds.length > 0) {
          await notifyMeetingInvited(
            userIds,
            {
              title: result.title,
              date: result.date,
              startTime: result.startTime,
              location: result.location,
              meetingType: result.meetingType,
              project: proj.name,
            },
            ctx?.userId ?? null,
            null,
          );
        }
      })();
    }

    return `Meeting "${result.title}" am ${result.date} fuer ${proj.name} angelegt.`;
  },

  meetings_auflisten: async (args) => {
    if (!meetingRepo) return "Meetings erfordern DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    if (!projektName) return "Projektname fehlt.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const limit = Math.min(Math.max(Number(args.anzahl) || 10, 1), 50);
    const list = await meetingRepo.list(proj.id, limit);
    if (list.length === 0) return `Keine Meetings fuer "${proj.name}".`;

    return list
      .map((m) => {
        const t = m.startTime ? ` ${m.startTime}` : "";
        const typeStr = m.meetingType ? ` [${m.meetingType}]` : "";
        const teilnehmer =
          m.attendeesResolved && m.attendeesResolved.length > 0
            ? ` · ${m.attendeesResolved.length} TN`
            : m.attendeesExternal.length > 0
              ? ` · ${m.attendeesExternal.length} TN (extern)`
              : "";
        return `${m.date}${t}${typeStr} — ${m.title}${teilnehmer}`;
      })
      .join("\n");
  },

  meeting_lesen: async (args) => {
    if (!meetingRepo) return "Meetings erfordern DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    const datumRaw = String(args.datum ?? "").trim();
    const titelTeil = args.titel ? String(args.titel).toLowerCase().trim() : "";
    if (!projektName || !datumRaw) return "Projekt und Datum sind erforderlich.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const iso = toIsoDate(datumRaw);
    if (!iso) return `Ungueltiges Datum "${datumRaw}". Bitte TT.MM.JJJJ verwenden.`;

    const list = await meetingRepo.list(proj.id, 200);
    let matches = list.filter((m) => m.date === iso);
    if (titelTeil) matches = matches.filter((m) => m.title.toLowerCase().includes(titelTeil));

    if (matches.length === 0) {
      return `Kein Meeting fuer ${proj.name} am ${iso}${titelTeil ? ` mit Titel "${args.titel}"` : ""}.`;
    }
    if (matches.length > 1 && !titelTeil) {
      return `Mehrere Meetings fuer ${iso} gefunden — bitte Titel angeben:\n${matches
        .map((m) => `· ${m.startTime ?? "—"} ${m.title}`)
        .join("\n")}`;
    }

    const m = matches[0];
    const lines: string[] = [];
    lines.push(
      `📋 ${m.title} — ${proj.name} (${m.date}${m.startTime ? ` ${m.startTime}` : ""}${m.endTime ? `–${m.endTime}` : ""})`,
    );
    if (m.meetingType) lines.push(`Typ: ${m.meetingType}`);
    if (m.location) lines.push(`Ort: ${m.location}`);
    const tnNamen = [...(m.attendeesResolved ?? []).map((a) => a.name), ...m.attendeesExternal];
    if (tnNamen.length > 0) lines.push(`Teilnehmer: ${tnNamen.join(", ")}`);
    if (m.agenda) lines.push(`\n— Agenda —\n${m.agenda}`);
    if (m.minutes) lines.push(`\n— Protokoll —\n${m.minutes}`);
    if (m.decisions) lines.push(`\n— Beschluesse —\n${m.decisions}`);
    if (m.actionItems.length > 0) {
      const items = m.actionItems
        .map((a) => `· ${a.done ? "[x]" : "[ ]"} ${a.text}${a.dueDate ? ` (bis ${a.dueDate})` : ""}`)
        .join("\n");
      lines.push(`\n— To-Dos —\n${items}`);
    }
    if (m.nextMeetingDate) lines.push(`\nFolgetermin: ${m.nextMeetingDate}`);
    return lines.join("\n");
  },
};
