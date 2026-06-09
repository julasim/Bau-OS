import type OpenAI from "openai";
import { projectRepo, portfolioRepo, phaseRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import type { ProjectCreateOptions, ProjectUpdate } from "../../data/types.js";
import type { HandlerMap } from "./types.js";

// Gemeinsame Property-Definitionen fuer Stammdaten — genutzt von
// projekt_anlegen und projekt_aktualisieren. DRY, damit beide Tools die
// identische Semantik/Beschreibung haben.
const stammdatenProps = {
  projektnummer: {
    type: "string",
    description:
      "Interne fortlaufende Projektnummer, z.B. '2026-037'. Wenn keine bekannt: Nutzer fragen oder weglassen.",
  },
  bauherr: {
    type: "string",
    description:
      "Bauherr-Name plus Kontakt, z.B. 'Stefan und Karin Müller — stefan.mueller@example.at, +43 676 1234567'.",
  },
  standort: {
    type: "string",
    description: "Standort — mindestens Ort/Gemeinde, Adresse wenn vorhanden, z.B. 'Lindenstraße 14, 9020 Klagenfurt'.",
  },
  projektart: {
    type: "string",
    enum: ["Neubau", "Umbau", "Sanierung", "Zubau"],
    description: "Art der baulichen Maßnahme.",
  },
  nutzung: {
    type: "string",
    description: "Geplante Nutzung, z.B. 'Wohnbau', 'Büro', 'Gewerbe', 'Mischnutzung', 'Kindergarten'.",
  },
  phase: {
    type: "string",
    description:
      "Projekt-Phase. Typische Werte: 'Vorentwurf', 'Einreichung', 'Ausfuehrung', 'Baubetreuung', 'Abgeschlossen' — andere Bezeichnungen sind erlaubt.",
  },
  start_date: {
    type: "string",
    description: "Start-Datum im Format YYYY-MM-DD, z.B. '2026-04-01'.",
  },
  end_date: {
    type: "string",
    description: "Geplantes End-Datum im Format YYYY-MM-DD.",
  },
} as const;

export const projectSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "projekte_auflisten",
      description:
        "Listet alle Projekte im Vault auf (Ordner unter Projekte/). Zeigt nur die Namen — fuer Details zu einem Projekt projekt_info verwenden.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "portfolio_uebersicht",
      description:
        "Projektuebergreifendes Cockpit ueber alle sichtbaren Projekte: je Projekt aktuelle Phase, honorargewichteter Fortschritt, fakturierter Betrag vs. Budget, naechste Frist, offene High-Prio-Aufgaben und eine Ampel (rot/gelb/gruen). Nutze dies fuer Fragen wie 'Wie stehen meine Projekte?', 'Wo brennt's?', 'Welche Fristen kommen?'. Nur im DB-Modus verfuegbar.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_info",
      description:
        "Zeigt die Stammdaten eines Projekts (Projektnummer, Bauherr, Standort, Projektart, Nutzung, Phase, Start/Ende) sowie Counts (Notizen, offene Aufgaben, Termine, Dateien). Nutze den exakten Projektnamen aus projekte_auflisten.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Name des Projekts" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_anlegen",
      description:
        "Legt ein neues Projekt in der DB an. WICHTIG — bevor du dieses Tool aufrufst, stelle sicher dass du diese Felder hast (durch Nachfrage beim Nutzer ODER durch Extraktion aus hochgeladenen Dokumenten mit semantisch_suchen): Projektnummer, Bauherr, Standort, Projektart, Nutzung. Fehlende Felder NICHT erfinden, sondern beim Nutzer nachfragen oder spaeter mit projekt_aktualisieren nachtragen. Projekte sind rein logische DB-Entities — KEINE Ordner/Dateien werden angelegt. Idempotent: existiert der Name schon, werden die Stammdaten auf die neuen Werte gepatcht. Name-Regeln: Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen, '-', '_', '.'.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Projektname. Konvention: Bauherr + Ort, z.B. 'EFH Müller Krems' oder 'Umbau Völkendorf 31'.",
          },
          ...stammdatenProps,
          beschreibung: {
            type: "string",
            description: "Optional: freie Kurzbeschreibung (Besonderheiten, Kontext).",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_aktualisieren",
      description:
        "Aktualisiert Stammdaten eines bestehenden Projekts. Nur die im Aufruf gesetzten Felder werden geaendert; weggelassene Felder bleiben unveraendert. Nutze dieses Tool, wenn der Nutzer einen Wert korrigieren oder nachtragen moechte (z.B. 'Bauherr Kontakt hinzufuegen', 'Phase auf Einreichung setzen'). Um ein Feld gezielt zu leeren, gib einen leeren String uebergib.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exakter Projektname (unveraenderlich)." },
          ...stammdatenProps,
          beschreibung: {
            type: "string",
            description: "Freie Beschreibung — ueberschreibt das bestehende description-Feld.",
          },
          status: {
            type: "string",
            enum: ["aktiv", "pausiert", "archiviert"],
            description: "Projekt-Status aendern.",
          },
        },
        required: ["name"],
      },
    },
  },
];

// Hilfsfunktionen ------------------------------------------------------------

/** String aus Tool-Argumenten sicher trimmen; leeren String → null. */
function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Liste der in einem Patch gesetzten Stammdaten-Felder (fuer Rueckmeldung). */
function listedFields(patch: Record<string, unknown>): string[] {
  return Object.keys(patch).filter((k) => patch[k] !== undefined);
}

// Handlers -------------------------------------------------------------------

import { getCurrentUserCtx } from "../user-context.js";
import { getVisibleProjectIds, canSeeProjectByName } from "../../data/access.js";

export const projectHandlers: HandlerMap = {
  projekte_auflisten: async () => {
    // Phase 6: scoped per User. getCurrentUserCtx() liefert null wenn der
    // Aufrufer keinen Bot/API-Wrapper hat (z.B. Heartbeat) — dann verhaelt
    // sich projectRepo.list() wie vorher (alles).
    const ctx = getCurrentUserCtx();
    const visible = ctx ? await getVisibleProjectIds(ctx) : "all";
    const projects = await projectRepo.list(visible);
    return projects.length ? projects.join("\n") : "Keine Projekte vorhanden.";
  },

  portfolio_uebersicht: async () => {
    if (!portfolioRepo) return "Das Portfolio-Cockpit ist nur im DB-Modus verfuegbar.";
    const ctx = getCurrentUserCtx();
    const visible = ctx ? await getVisibleProjectIds(ctx) : "all";
    const rows = await portfolioRepo.list(visible);
    if (rows.length === 0) return "Keine Projekte im Portfolio.";
    // Ampel: rot zuerst (Handlungsbedarf oben).
    const order = { red: 0, amber: 1, green: 2 } as const;
    const label = { red: "ROT", amber: "GELB", green: "GRUEN" } as const;
    const sorted = [...rows].sort((a, b) => order[a.health] - order[b.health]);
    const dash = "—";
    const money = (n: number | null) =>
      n === null || n === undefined ? dash : n.toLocaleString("de-AT", { maximumFractionDigits: 0 }) + " €";
    const lines = sorted.map((p) => {
      const head = `[${label[p.health]}] ${p.name}${p.projektnummer ? ` (${p.projektnummer})` : ""}`;
      const parts = [
        `Phase: ${p.currentPhase ?? dash}`,
        `Fortschritt: ${p.progress}%`,
        `Honorar: ${money(p.invoiced)} fakturiert / ${money(p.budget)} Budget`,
      ];
      if (p.nextDeadline) {
        parts.push(`naechste Frist: ${p.nextDeadline}${p.nextDeadlineLabel ? ` (${p.nextDeadlineLabel})` : ""}`);
      }
      if (p.openHighPrio > 0) parts.push(`offene High-Prio: ${p.openHighPrio}`);
      return `${head}\n  ${parts.join(" · ")}`;
    });
    const counts = sorted.reduce(
      (acc, p) => ((acc[p.health] = (acc[p.health] ?? 0) + 1), acc),
      {} as Record<string, number>,
    );
    const summary = `Portfolio (${rows.length} Projekte) — rot: ${counts.red ?? 0}, gelb: ${counts.amber ?? 0}, gruen: ${counts.green ?? 0}`;
    return `${summary}\n\n${lines.join("\n\n")}`;
  },

  projekt_info: async (args) => {
    const ctx = getCurrentUserCtx();
    if (ctx && !(await canSeeProjectByName(ctx, String(args.name)))) {
      return `Kein Zugriff auf Projekt "${args.name}".`;
    }
    const info = await projectRepo.getInfo(String(args.name));
    if (!info) {
      return `Projekt "${args.name}" nicht gefunden. Nutze projekte_auflisten um alle verfuegbaren Projektnamen zu sehen.`;
    }
    // Stammdaten kompakt darstellen — leere Felder explizit als "—", damit
    // der Agent sieht, was noch fehlt.
    const dash = "—";
    const lines = [
      `Projekt: ${info.name}`,
      `Status: ${info.status ?? "aktiv"}`,
      `Projektnummer: ${info.projektnummer ?? dash}`,
      `Bauherr: ${info.bauherr ?? dash}`,
      `Standort: ${info.standort ?? dash}`,
      `Projektart: ${info.projektart ?? dash}`,
      `Nutzung: ${info.nutzung ?? dash}`,
      `Phase: ${info.phase ?? dash}`,
    ];
    if (info.startDate || info.endDate) {
      lines.push(`Zeitraum: ${info.startDate ?? dash} bis ${info.endDate ?? dash}`);
    }
    lines.push("");
    lines.push(
      `Notizen: ${info.notes} · Offene Aufgaben: ${info.openTasks} · Termine: ${info.termine} · Dateien: ${info.files ?? 0}`,
    );
    // Leistungsphasen (Migration 035, nur DB-Modus): honorargewichteter
    // Fortschritt, aktive Phase und naechste Phasen-Frist.
    if (phaseRepo && info.id) {
      const phases = await phaseRepo.list(info.id);
      if (phases.length > 0) {
        const progress = await phaseRepo.projectProgress(info.id);
        const active = phases.find((p) => p.status === "aktiv");
        const nextDue = phases
          .filter((p) => p.status !== "fertig" && p.sollEnde)
          .map((p) => ({ ende: p.sollEnde as string, name: p.name }))
          .sort((a, b) => a.ende.localeCompare(b.ende))[0];
        lines.push("");
        lines.push(`Leistungsphasen: ${phases.length} · Fortschritt (honorargewichtet): ${progress}%`);
        lines.push(`Aktive Phase: ${active ? active.name : dash}`);
        if (nextDue) lines.push(`Naechste Phasen-Frist: ${nextDue.ende} (${nextDue.name})`);
      }
    }
    if (info.description) {
      lines.push("");
      lines.push(`Beschreibung: ${info.description}`);
    }
    return lines.join("\n");
  },

  projekt_anlegen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    // Strukturierte Stammdaten (Migration 004) — landen ab jetzt in eigenen
    // Spalten, nicht mehr als Textblock in description.
    const opts: ProjectCreateOptions = {
      description: strOrNull(args.beschreibung),
      projektnummer: strOrNull(args.projektnummer),
      bauherr: strOrNull(args.bauherr),
      standort: strOrNull(args.standort),
      projektart: strOrNull(args.projektart),
      nutzung: strOrNull(args.nutzung),
      phase: strOrNull(args.phase),
      startDate: strOrNull(args.start_date),
      endDate: strOrNull(args.end_date),
    };

    // create() ist idempotent und patcht bei bestehendem Projekt die Felder,
    // die im Aufruf gesetzt sind — keine Pre-Existenz-Pruefung noetig.
    const ok = await projectRepo.create(name, opts);
    if (!ok) {
      return `Projekt "${name}" konnte nicht angelegt werden. Erlaubt sind Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen, '-', '_' und '.'.`;
    }
    emit({ type: "project", action: "created", id: name });

    // Rueckmeldung: was ist gesetzt, was fehlt noch?
    const stammdaten = [
      ["Projektnummer", opts.projektnummer],
      ["Bauherr", opts.bauherr],
      ["Standort", opts.standort],
      ["Projektart", opts.projektart],
      ["Nutzung", opts.nutzung],
    ] as const;
    const gesetzt = stammdaten.filter(([, v]) => v && v.length > 0).map(([k]) => k);
    const fehlen = stammdaten.filter(([, v]) => !v || v.length === 0).map(([k]) => k);
    const gesetztLine = gesetzt.length ? `Gesetzt: ${gesetzt.join(", ")}` : "Gesetzt: (nur Name)";
    const fehlenLine = fehlen.length
      ? `Fehlen noch: ${fehlen.join(", ")} — beim Nutzer nachfragen oder aus Dokumenten extrahieren und mit projekt_aktualisieren nachtragen.`
      : "Alle Stammdaten vollstaendig.";
    return `Projekt "${name}" ist in der Datenbank angelegt. Kein Ordner/keine Datei erzeugt (Projekte sind rein logische DB-Entities).\n\n${gesetztLine}\n${fehlenLine}`;
  },

  projekt_aktualisieren: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    // Patch-Objekt bauen — nur Felder aufnehmen, die im Aufruf tatsaechlich
    // gesetzt sind (auch leerer String erlaubt, er bedeutet "leeren").
    const patch: ProjectUpdate = {};
    const mapping: [keyof ProjectUpdate, keyof typeof args][] = [
      ["description", "beschreibung"],
      ["status", "status"],
      ["projektnummer", "projektnummer"],
      ["bauherr", "bauherr"],
      ["standort", "standort"],
      ["projektart", "projektart"],
      ["nutzung", "nutzung"],
      ["phase", "phase"],
      ["startDate", "start_date"],
      ["endDate", "end_date"],
    ];
    for (const [patchKey, argKey] of mapping) {
      if (argKey in args) {
        // Leerer String → null (Feld leeren). Sonst Trim.
        const raw = args[argKey];
        if (raw === null || raw === undefined) {
          (patch as Record<string, string | null>)[patchKey] = null;
        } else {
          const trimmed = String(raw).trim();
          (patch as Record<string, string | null>)[patchKey] = trimmed === "" ? null : trimmed;
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return `Fehler: Kein Feld zum Aktualisieren uebergeben. Nutze projekt_info, um zu sehen welche Felder gesetzt sind.`;
    }

    const ok = await projectRepo.update(name, patch);
    if (!ok) {
      return `Projekt "${name}" nicht gefunden oder Update fehlgeschlagen. Pruefe den Namen mit projekte_auflisten.`;
    }
    emit({ type: "project", action: "updated", id: name });

    const fields = listedFields(patch as Record<string, unknown>);
    return `Projekt "${name}" aktualisiert. Geaenderte Felder: ${fields.join(", ")}.`;
  },
};
