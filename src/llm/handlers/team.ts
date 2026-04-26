import type OpenAI from "openai";
import { teamRepo, projectRepo } from "../../data/index.js";
import type { MemberType, TeamMember } from "../../data/types.js";
import { emit } from "../../api/events.js";
import type { HandlerMap } from "./types.js";

const ALLOWED_MEMBER_TYPES: MemberType[] = ["Intern", "Planer", "Ausführende", "Behörde", "Lieferant", "Bauherr"];

function normalizeMemberType(v: unknown): MemberType | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return (ALLOWED_MEMBER_TYPES as string[]).includes(t) ? (t as MemberType) : null;
}

// ── Name-Resolution ─────────────────────────────────────────────────────────
// Agent gibt haeufig nur Namen weiter ("Peter Mueller"), keine UUID. Dieser
// Helper loest den Namen gegen die Team-Liste auf — mit Fallback-Strategie:
//   1. Exact match (case-insensitive, trimmed)
//   2. starts-with
//   3. contains
// Bei >1 Treffer in Stufe 2/3 wird "ambiguous" zurueckgegeben, damit der
// Agent nachfragen kann. UUID-Strings werden direkt durchgereicht.
export async function resolveMember(
  query: string,
): Promise<
  { ok: true; member: TeamMember } | { ok: false; reason: "not-found" | "ambiguous"; candidates?: TeamMember[] }
> {
  const q = query.trim();
  if (!q) return { ok: false, reason: "not-found" };

  // UUID-Pattern direkt akzeptieren
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(q)) {
    const member = await teamRepo.get(q);
    if (member) return { ok: true, member };
    return { ok: false, reason: "not-found" };
  }

  const all = await teamRepo.list();
  const qLower = q.toLowerCase();

  const exact = all.filter((m) => m.name.toLowerCase() === qLower);
  if (exact.length === 1) return { ok: true, member: exact[0]! };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact };

  const startsWith = all.filter((m) => m.name.toLowerCase().startsWith(qLower));
  if (startsWith.length === 1) return { ok: true, member: startsWith[0]! };
  if (startsWith.length > 1) return { ok: false, reason: "ambiguous", candidates: startsWith };

  const contains = all.filter((m) => m.name.toLowerCase().includes(qLower));
  if (contains.length === 1) return { ok: true, member: contains[0]! };
  if (contains.length > 1) return { ok: false, reason: "ambiguous", candidates: contains };

  return { ok: false, reason: "not-found" };
}

// Formatiert eine Liste gefundener Kandidaten fuer den Agenten — damit der
// eine klare Rueckfrage formulieren kann ("meinst du X oder Y?").
export function formatCandidates(candidates: TeamMember[]): string {
  return candidates
    .map((m) => {
      const extras = [m.role, m.companyName ?? m.company, m.email].filter(Boolean).join(" · ");
      return extras ? `"${m.name}" (${extras})` : `"${m.name}"`;
    })
    .join(", ");
}

// Loest einen Projekt-Namen zu seiner UUID auf. Primaer exakt; wenn kein
// Treffer, versuchen wir case-insensitive (projekt-namen sind praktisch
// eindeutig, aber der Agent tippt haeufig kleingeschrieben).
async function resolveProjectId(query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;
  const info = await projectRepo.getInfo(q);
  if (info?.id) return info.id;
  // Fallback: durch alle Namen iterieren (kleine Datenmenge, ok).
  const names = await projectRepo.list();
  const match = names.find((n) => n.toLowerCase() === q.toLowerCase());
  if (!match) return null;
  const info2 = await projectRepo.getInfo(match);
  return info2?.id ?? null;
}

export const teamSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "team_auflisten",
      description:
        "Listet alle Team-Mitglieder auf. Pro Mitglied: Name, Rolle, Firma, Kategorie (Intern/Planer/Ausführende/Behörde/Lieferant/Bauherr), E-Mail, Telefon und wie vielen Projekten sie zugeordnet sind.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "team_anlegen",
      description:
        "Legt ein neues Team-Mitglied an. Vor dem INSERT wird nach Duplikaten gesucht (gleiche E-Mail ODER gleicher Name + gleiche Firma) — bei Treffer kommt ein Warnhinweis mit den Kandidaten zurueck, statt dass doppelt angelegt wird. Falls Firma nicht existiert, wird sie automatisch angelegt.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Vor- und Nachname (Pflicht)" },
          rolle: { type: "string", description: "Beruf/Rolle, z.B. Statiker, Polier, Architekt" },
          email: { type: "string" },
          telefon: { type: "string" },
          firma: { type: "string", description: "Firmenname — wird auto-angelegt wenn neu" },
          kategorie: {
            type: "string",
            enum: ALLOWED_MEMBER_TYPES,
            description: "Optional: Intern / Planer / Ausführende / Behörde / Lieferant / Bauherr",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_aktualisieren",
      description:
        "Aktualisiert Stammdaten eines bestehenden Team-Mitglieds. Referenzierung per Name oder ID. Alle Felder optional — nur explizit gesetzte werden geaendert.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Name oder UUID des Mitglieds" },
          rolle: { type: "string" },
          email: { type: "string" },
          telefon: { type: "string" },
          firma: { type: "string" },
          kategorie: { type: "string", enum: ALLOWED_MEMBER_TYPES },
        },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_zuordnen",
      description:
        "Ordnet ein Team-Mitglied einem Projekt zu (M:N). Optional kann eine projekt-spezifische Rolle gesetzt werden (z.B. 'Statiker' fuer dieses Projekt, auch wenn die generische Rolle 'Dipl.-Ing.' ist). Idempotent — bestehende Zuordnungen werden nicht dupliziert.",
      parameters: {
        type: "object",
        properties: {
          mitglied: { type: "string", description: "Name oder UUID des Mitglieds" },
          projekt: { type: "string", description: "Projekt-Name" },
          projekt_rolle: { type: "string", description: "Optional: Rolle nur fuer dieses Projekt" },
        },
        required: ["mitglied", "projekt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_entfernen_aus_projekt",
      description: "Hebt die Zuordnung eines Mitglieds zu einem Projekt auf — das Mitglied bleibt im Team-Verzeichnis.",
      parameters: {
        type: "object",
        properties: {
          mitglied: { type: "string" },
          projekt: { type: "string" },
        },
        required: ["mitglied", "projekt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_projektrolle_setzen",
      description: "Setzt oder aendert die projekt-spezifische Rolle eines bereits zugeordneten Mitglieds.",
      parameters: {
        type: "object",
        properties: {
          mitglied: { type: "string" },
          projekt: { type: "string" },
          rolle: { type: "string", description: "Leerer String = Rolle loeschen" },
        },
        required: ["mitglied", "projekt", "rolle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_log_eintrag",
      description:
        "Fuegt einen Eintrag ins Kontakt-Log eines Mitglieds ein — fuer Gespraechsnotizen, Telefonate, Vereinbarungen. Zeitstempel wird automatisch gesetzt.",
      parameters: {
        type: "object",
        properties: {
          mitglied: { type: "string" },
          text: { type: "string", description: "Inhalt des Eintrags" },
          autor: { type: "string", description: "Optional: wer den Eintrag verfasst" },
        },
        required: ["mitglied", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "team_entfernen",
      description: "Loescht ein Team-Mitglied komplett (inkl. aller Projekt-Zuordnungen). Vorsicht — irreversibel.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Name oder UUID des Mitglieds" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "firma_auflisten",
      description: "Listet alle Firmen mit Anzahl der zugeordneten Mitglieder.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "firma_anlegen",
      description:
        "Legt eine neue Firma an. Wird auch automatisch bei team_anlegen/team_aktualisieren aufgerufen, wenn der Firmenname neu ist — dieses Tool ist nur noetig, um zusaetzlich Adresse/Website zu hinterlegen.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          adresse: { type: "string" },
          website: { type: "string" },
          notizen: { type: "string" },
        },
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
        const cat = m.memberType ? `[${m.memberType}]` : "";
        const company = m.companyName ?? m.company;
        const contact = [m.role, company, m.email, m.phone].filter(Boolean).join(" · ");
        const projCount =
          m.projects.length > 0 ? ` — ${m.projects.length} Projekt${m.projects.length === 1 ? "" : "e"}` : "";
        return `- ${m.name}${cat ? " " + cat : ""}${contact ? ` (${contact})` : ""}${projCount}`;
      })
      .join("\n");
  },

  team_anlegen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    const email = args.email ? String(args.email).trim() : null;
    const companyName = args.firma ? String(args.firma).trim() : null;

    // Duplicate-Detection: Email-Treffer oder (Name+Firma)-Treffer.
    const all = await teamRepo.list();
    const emailDuplicates = email ? all.filter((m) => m.email && m.email.toLowerCase() === email.toLowerCase()) : [];
    const nameCompanyDuplicates =
      companyName != null
        ? all.filter(
            (m) =>
              m.name.toLowerCase() === name.toLowerCase() &&
              (m.companyName ?? m.company)?.toLowerCase() === companyName.toLowerCase(),
          )
        : [];
    const duplicates = [...new Set([...emailDuplicates, ...nameCompanyDuplicates])];

    if (duplicates.length > 0) {
      return (
        `Moegliches Duplikat: ${formatCandidates(duplicates)}. ` +
        "Willst du wirklich neu anlegen oder den bestehenden Eintrag aktualisieren? " +
        "Falls aktualisieren: nutze team_aktualisieren mit ref='<Name>'."
      );
    }

    try {
      const member = await teamRepo.add({
        name,
        role: args.rolle ? String(args.rolle) : null,
        email,
        phone: args.telefon ? String(args.telefon) : null,
        companyName,
        memberType: normalizeMemberType(args.kategorie),
        projectId: null,
      });
      emit({ type: "team", action: "created", id: member.id });
      const extras: string[] = [];
      if (member.memberType) extras.push(`Kategorie: ${member.memberType}`);
      if (member.companyName) extras.push(`Firma: ${member.companyName}`);
      return `Team-Mitglied "${member.name}" angelegt.${extras.length ? " " + extras.join(", ") + "." : ""}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Konnte "${name}" nicht anlegen: ${msg}`;
    }
  },

  team_aktualisieren: async (args) => {
    const ref = String(args.ref ?? "").trim();
    if (!ref) return "Fehler: ref (Name oder ID) ist erforderlich.";

    const r = await resolveMember(ref);
    if (!r.ok) {
      if (r.reason === "ambiguous") {
        return `Mehrere Treffer fuer "${ref}": ${formatCandidates(r.candidates!)}. Bitte praeziser oder mit ID.`;
      }
      return `Kein Mitglied mit "${ref}" gefunden.`;
    }

    const updates: Record<string, unknown> = {};
    if ("rolle" in args) updates.role = args.rolle ? String(args.rolle) : null;
    if ("email" in args) updates.email = args.email ? String(args.email) : null;
    if ("telefon" in args) updates.phone = args.telefon ? String(args.telefon) : null;
    if ("firma" in args) updates.companyName = args.firma ? String(args.firma) : null;
    if ("kategorie" in args) updates.memberType = normalizeMemberType(args.kategorie);

    if (Object.keys(updates).length === 0) {
      return `Nichts zu aendern fuer "${r.member.name}" — keine Felder im Aufruf.`;
    }

    const updated = await teamRepo.update(r.member.id, updates);
    if (!updated) return `Update fuer "${r.member.name}" fehlgeschlagen.`;
    emit({ type: "team", action: "updated", id: r.member.id });
    return `"${updated.name}" aktualisiert.`;
  },

  team_zuordnen: async (args) => {
    const memberQuery = String(args.mitglied ?? "").trim();
    const projectQuery = String(args.projekt ?? "").trim();
    const projektRolle = args.projekt_rolle ? String(args.projekt_rolle).trim() : null;
    if (!memberQuery || !projectQuery) return "Fehler: mitglied und projekt sind erforderlich.";

    const r = await resolveMember(memberQuery);
    if (!r.ok) {
      if (r.reason === "ambiguous") {
        return `Mehrere Treffer fuer "${memberQuery}": ${formatCandidates(r.candidates!)}. Bitte praeziser oder mit ID.`;
      }
      return `Kein Mitglied "${memberQuery}" gefunden.`;
    }

    const projectId = await resolveProjectId(projectQuery);
    if (!projectId) return `Projekt "${projectQuery}" nicht gefunden.`;

    if (!teamRepo.assignToProject) return "Zuordnung in diesem Modus nicht unterstuetzt (Filesystem).";
    await teamRepo.assignToProject(r.member.id, projectId, projektRolle);
    emit({ type: "team", action: "updated", id: r.member.id });
    emit({ type: "project", action: "updated", id: projectId });
    const roleInfo = projektRolle ? ` als ${projektRolle}` : "";
    return `"${r.member.name}" ist jetzt dem Projekt "${projectQuery}"${roleInfo} zugeordnet.`;
  },

  team_entfernen_aus_projekt: async (args) => {
    const memberQuery = String(args.mitglied ?? "").trim();
    const projectQuery = String(args.projekt ?? "").trim();
    if (!memberQuery || !projectQuery) return "Fehler: mitglied und projekt sind erforderlich.";

    const r = await resolveMember(memberQuery);
    if (!r.ok) return `Kein Mitglied "${memberQuery}" gefunden.`;
    const projectId = await resolveProjectId(projectQuery);
    if (!projectId) return `Projekt "${projectQuery}" nicht gefunden.`;

    if (!teamRepo.unassignFromProject) return "Nicht unterstuetzt im Filesystem-Modus.";
    const ok = await teamRepo.unassignFromProject(r.member.id, projectId);
    if (!ok) return `"${r.member.name}" war dem Projekt "${projectQuery}" nicht zugeordnet.`;
    emit({ type: "team", action: "updated", id: r.member.id });
    emit({ type: "project", action: "updated", id: projectId });
    return `"${r.member.name}" aus Projekt "${projectQuery}" entfernt.`;
  },

  team_projektrolle_setzen: async (args) => {
    const memberQuery = String(args.mitglied ?? "").trim();
    const projectQuery = String(args.projekt ?? "").trim();
    const rolle = args.rolle !== undefined ? String(args.rolle).trim() : "";
    if (!memberQuery || !projectQuery) return "Fehler: mitglied und projekt sind erforderlich.";

    const r = await resolveMember(memberQuery);
    if (!r.ok) return `Kein Mitglied "${memberQuery}" gefunden.`;
    const projectId = await resolveProjectId(projectQuery);
    if (!projectId) return `Projekt "${projectQuery}" nicht gefunden.`;

    if (!teamRepo.updateProjectRole) return "Nicht unterstuetzt im Filesystem-Modus.";
    const ok = await teamRepo.updateProjectRole(r.member.id, projectId, rolle || null);
    if (!ok)
      return `"${r.member.name}" ist dem Projekt "${projectQuery}" nicht zugeordnet — zuerst team_zuordnen nutzen.`;
    emit({ type: "team", action: "updated", id: r.member.id });
    return rolle
      ? `Rolle "${rolle}" fuer "${r.member.name}" im Projekt "${projectQuery}" gesetzt.`
      : `Rolle fuer "${r.member.name}" im Projekt "${projectQuery}" entfernt.`;
  },

  team_log_eintrag: async (args) => {
    const memberQuery = String(args.mitglied ?? "").trim();
    const text = String(args.text ?? "").trim();
    if (!memberQuery || !text) return "Fehler: mitglied und text sind erforderlich.";

    const r = await resolveMember(memberQuery);
    if (!r.ok) return `Kein Mitglied "${memberQuery}" gefunden.`;
    if (!teamRepo.appendLog) return "Nicht unterstuetzt im Filesystem-Modus.";

    const ok = await teamRepo.appendLog(r.member.id, {
      ts: new Date().toISOString(),
      text,
      author: args.autor ? String(args.autor).trim() : undefined,
    });
    if (!ok) return "Eintrag konnte nicht hinzugefuegt werden.";
    emit({ type: "team", action: "updated", id: r.member.id });
    return `Log-Eintrag fuer "${r.member.name}" hinzugefuegt.`;
  },

  team_entfernen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";
    const ok = await teamRepo.remove(name);
    if (!ok) return `"${name}" nicht im Team gefunden.`;
    emit({ type: "team", action: "deleted" });
    return `"${name}" aus dem Team entfernt.`;
  },

  firma_auflisten: async () => {
    if (!teamRepo.listCompanies) return "Firmen-Verzeichnis im Filesystem-Modus nicht verfuegbar.";
    const list = await teamRepo.listCompanies();
    if (list.length === 0) return "Keine Firmen vorhanden.";
    return list
      .map((c) => {
        const count = c.memberCount ?? 0;
        return `- ${c.name} (${count} Mitglied${count === 1 ? "" : "er"})`;
      })
      .join("\n");
  },

  firma_anlegen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";
    if (!teamRepo.addCompany) return "Nicht unterstuetzt im Filesystem-Modus.";

    try {
      const company = await teamRepo.addCompany({
        name,
        address: args.adresse ? String(args.adresse).trim() : null,
        website: args.website ? String(args.website).trim() : null,
        notes: args.notizen ? String(args.notizen).trim() : null,
      });
      emit({ type: "team", action: "created", id: company.id });
      return `Firma "${company.name}" angelegt.`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
        return `Firma "${name}" existiert bereits.`;
      }
      return `Konnte Firma nicht anlegen: ${msg}`;
    }
  },
};
