// ============================================================
// Bau-OS — LLM-Handler: Stundenerfassung
// ============================================================
// Drei Tools fuer den Stunden-Workflow:
//   - stunden_eintragen: Schreibt einen Stunden-Eintrag.
//   - stunden_woche:     Liste der letzten Eintraege eines Projekts.
//   - stunden_summe:     Aggregat pro Mitarbeiter im Zeitraum.
//
// Datums-Eingabe: TT.MM.JJJJ → ISO YYYY-MM-DD.
// Mitarbeiter: name → resolveMember (fuzzy match) → memberId.
// ============================================================

import type OpenAI from "openai";
import { timeEntryRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { canSeeProjectByName } from "../../data/access.js";
import type { HandlerMap } from "./types.js";
import type { TimeEntryInput } from "../../data/types.js";
import { resolveMember, formatCandidates } from "./team.js";

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
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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

export const timeEntrySchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "stunden_eintragen",
      description:
        "Erfasst Arbeitsstunden pro Mitarbeiter, Tag und Projekt. Standardfall: 'Polier Schmidt heute 8.5h auf Hofweg, Schalung'. Optional Beginn/Ende fuer rechtskonforme Erfassung. Mitarbeiter wird per Name-Match auf das Team aufgeloest — externe Personen ohne Stammdatensatz koennen nur als Freitext-Name angegeben werden.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          mitarbeiter: { type: "string", description: "Name des Mitarbeiters (Team-Mitglied oder Freitext)" },
          stunden: { type: "number", description: "Gearbeitete Stunden (Dezimal, z.B. 8.5)" },
          datum: { type: "string", description: "Datum TT.MM.JJJJ. Wenn leer: heute." },
          beginn: { type: "string", description: "Optional Startzeit HH:MM" },
          ende: { type: "string", description: "Optional Endzeit HH:MM" },
          pause_minuten: { type: "number", description: "Optional Pause in Minuten (Default 0)" },
          taetigkeit: { type: "string", description: "Optional Taetigkeit (z.B. 'Schalung EG', 'Maurerarbeiten')" },
          notiz: { type: "string", description: "Optionale Anmerkung" },
        },
        required: ["projekt", "mitarbeiter", "stunden"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stunden_woche",
      description:
        "Listet die Stunden-Eintraege eines Projekts der letzten N Tage (Default 7). Zeigt Datum, Mitarbeiter, Stunden und Taetigkeit.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          tage: { type: "number", description: "Anzahl Tage zurueck (Default 7)" },
        },
        required: ["projekt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stunden_summe",
      description:
        "Aggregiert Stunden pro Mitarbeiter fuer ein Projekt in einem Zeitraum (Default: laufender Monat). Antwortet 'Polier Schmidt 42h, Lehrling Maier 28h, ...'.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          von: { type: "string", description: "Optional Start TT.MM.JJJJ. Default: 1. des Monats." },
          bis: { type: "string", description: "Optional Ende TT.MM.JJJJ. Default: heute." },
        },
        required: ["projekt"],
      },
    },
  },
];

function firstOfMonthIso(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export const timeEntryHandlers: HandlerMap = {
  stunden_eintragen: async (args) => {
    if (!timeEntryRepo) return "Stundenerfassung erfordert DB-Modus.";

    const projektName = String(args.projekt ?? "").trim();
    const mitarbeiterRaw = String(args.mitarbeiter ?? "").trim();
    const stunden = Number(args.stunden);
    if (!projektName || !mitarbeiterRaw) return "Projekt und Mitarbeiter sind erforderlich.";
    if (!Number.isFinite(stunden) || stunden <= 0 || stunden > 24) {
      return `Ungueltige Stundenanzahl "${args.stunden}" (muss zwischen 0 und 24 liegen).`;
    }

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    // Mitarbeiter resolven; Freitext-Fallback wenn Name-Match scheitert.
    let memberId: string | null = null;
    let memberName: string = mitarbeiterRaw;
    const r = await resolveMember(mitarbeiterRaw);
    if (!r.ok && r.reason === "ambiguous") {
      return `Mehrere Mitarbeiter passen auf "${mitarbeiterRaw}": ${formatCandidates(r.candidates ?? [])}. Bitte genauer angeben.`;
    }
    if (r.ok) {
      memberId = r.member.id;
      memberName = r.member.name;
    }

    const datumRaw = args.datum ? String(args.datum) : todayIso();
    const iso = toIsoDate(datumRaw);
    if (!iso) return `Ungueltiges Datum "${datumRaw}". Bitte TT.MM.JJJJ verwenden.`;

    const input: TimeEntryInput = {
      date: iso,
      hours: stunden,
      memberId,
      memberName,
    };
    if ("beginn" in args) input.startTime = String(args.beginn);
    if ("ende" in args) input.endTime = String(args.ende);
    if ("pause_minuten" in args) input.breakMinutes = Number(args.pause_minuten) || 0;
    if ("taetigkeit" in args) input.activity = String(args.taetigkeit);
    if ("notiz" in args) input.notes = String(args.notiz);

    const ctx = getCurrentUserCtx();
    const result = await timeEntryRepo.create(proj.id, input, ctx?.userId ?? null);
    if (typeof result === "string") return result;
    emit({ type: "time", action: "created", id: result.id, project: proj.name });
    return `Stunden gespeichert: ${memberName} ${stunden}h auf ${proj.name} am ${iso}${input.activity ? ` (${input.activity})` : ""}.`;
  },

  stunden_woche: async (args) => {
    if (!timeEntryRepo) return "Stundenerfassung erfordert DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    if (!projektName) return "Projektname fehlt.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const tage = Math.min(Math.max(Number(args.tage) || 7, 1), 90);
    const from = isoDaysAgo(tage);
    const to = todayIso();

    const list = await timeEntryRepo.list(proj.id, { from, to, limit: 200 });
    if (list.length === 0) return `Keine Stunden-Eintraege fuer "${proj.name}" in den letzten ${tage} Tagen.`;

    const total = list.reduce((sum, e) => sum + e.hours, 0);
    const lines = list.map((e) => {
      const t = e.activity ? ` · ${e.activity}` : "";
      return `${e.date} · ${e.memberName ?? "—"} · ${e.hours.toFixed(1)}h${t}`;
    });
    lines.push(`\nTotal: ${total.toFixed(1)}h über ${list.length} Eintraege`);
    return lines.join("\n");
  },

  stunden_summe: async (args) => {
    if (!timeEntryRepo) return "Stundenerfassung erfordert DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    if (!projektName) return "Projektname fehlt.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const fromRaw = args.von ? String(args.von) : null;
    const toRaw = args.bis ? String(args.bis) : null;
    const from = fromRaw ? toIsoDate(fromRaw) : firstOfMonthIso();
    const to = toRaw ? toIsoDate(toRaw) : todayIso();
    if (fromRaw && !from) return `Ungueltiges Datum "von" = "${fromRaw}".`;
    if (toRaw && !to) return `Ungueltiges Datum "bis" = "${toRaw}".`;

    const summary = await timeEntryRepo.summaryByMember(proj.id, from!, to!);
    if (summary.length === 0) return `Keine Stunden fuer "${proj.name}" zwischen ${from} und ${to}.`;

    const total = summary.reduce((s, r) => s + r.hours, 0);
    const lines = [
      `Stunden fuer ${proj.name} (${from} – ${to}):`,
      ...summary.map((r) => `· ${r.label}: ${r.hours.toFixed(1)}h (${r.entries} Eintraege)`),
      `\nTotal: ${total.toFixed(1)}h`,
    ];
    return lines.join("\n");
  },
};
