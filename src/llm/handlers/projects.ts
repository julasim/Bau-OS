import type OpenAI from "openai";
import { projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import type { HandlerMap } from "./types.js";

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
      name: "projekt_info",
      description:
        "Zeigt eine Uebersicht zu einem Projekt: Anzahl Notizen, offene Aufgaben und anstehende Termine. Nutze den exakten Projektnamen aus projekte_auflisten.",
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
        "Legt ein neues Projekt in der DB an. WICHTIG — bevor du dieses Tool aufrufst, stelle sicher dass du diese 6 Felder hast (durch Nachfrage beim Nutzer ODER durch Extraktion aus hochgeladenen Dokumenten mit semantisch_suchen). Fehlende Felder NICHT erfinden, sondern beim Nutzer nachfragen. Projekte sind rein logische DB-Entities — KEINE Ordner/Dateien werden angelegt, behaupte das niemals. Idempotent: existiert der Name schon, heilt der Call Inkonsistenzen. Name-Regeln: Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen, '-', '_', '.'.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Projektname. Konvention: Bauherr + Ort, z.B. 'EFH Müller Krems' oder 'Umbau Völkendorf 31'. Keine Anführungszeichen im Namen.",
          },
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
            description:
              "Standort — mindestens Ort/Gemeinde, Adresse wenn vorhanden, z.B. 'Lindenstraße 14, 9020 Klagenfurt'.",
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
          beschreibung: {
            type: "string",
            description:
              "Optional: freie Kurzbeschreibung (Besonderheiten, Kontext). Wird unter den Stammdaten abgelegt.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "projekt_loeschen",
      description:
        "Loescht ein Projekt aus der Datenbank. Damit werden auch alle Notizen des Projekts geloescht (FK-CASCADE). Aufgaben, Termine, Dateien und Team-Mitglieder bleiben erhalten, verlieren aber den Projekt-Bezug (FK SET NULL). UNWIDERRUFLICH. Nur aufrufen, wenn der Benutzer das explizit verlangt hat.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exakter Projektname" },
        },
        required: ["name"],
      },
    },
  },
];

export const projectHandlers: HandlerMap = {
  projekte_auflisten: async () => {
    const projects = await projectRepo.list();
    return projects.length ? projects.join("\n") : "Keine Projekte vorhanden.";
  },

  projekt_info: async (args) => {
    const info = await projectRepo.getInfo(String(args.name));
    if (!info)
      return `Projekt "${args.name}" nicht gefunden. Nutze projekte_auflisten um alle verfuegbaren Projektnamen zu sehen.`;
    return `Projekt: ${info.name}\n\nNotizen: ${info.notes}\nOffene Aufgaben: ${info.openTasks}\nTermine: ${info.termine}`;
  },

  projekt_anlegen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    // Stammdaten-Block aus den 5 strukturierten Feldern bauen (Projektnummer,
    // Bauherr, Standort, Projektart, Nutzung). Reihenfolge ist stabil, damit
    // der Block vorhersagbar lesbar bleibt.
    const stammdaten: [string, string | null][] = [
      ["Projektnummer", args.projektnummer ? String(args.projektnummer).trim() : null],
      ["Bauherr", args.bauherr ? String(args.bauherr).trim() : null],
      ["Standort", args.standort ? String(args.standort).trim() : null],
      ["Projektart", args.projektart ? String(args.projektart).trim() : null],
      ["Nutzung", args.nutzung ? String(args.nutzung).trim() : null],
    ];
    const gesetzt = stammdaten.filter(([, v]) => v && v.length > 0) as [string, string][];
    const fehlen = stammdaten.filter(([, v]) => !v || v.length === 0).map(([k]) => k);
    const stammBlock = gesetzt.map(([k, v]) => `${k}: ${v}`).join("\n");
    const freeText = args.beschreibung ? String(args.beschreibung).trim() : "";
    const beschreibung = stammBlock && freeText ? `${stammBlock}\n\n${freeText}` : stammBlock || freeText || null;

    // Kein Pre-Check — create() ist idempotent und heilt DB/Vault-
    // Inkonsistenzen automatisch. Wenn wir hier vorher "existiert bereits"
    // zurueckgeben, sperren wir uns gegen genau die Inkonsistenz aus, die
    // wir eigentlich heilen wollen (DB sagt ja, Ordner fehlt — oder umgekehrt).
    const ok = await projectRepo.create(name, beschreibung);
    if (!ok) {
      return `Projekt "${name}" konnte nicht angelegt werden. Erlaubt sind Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen, '-', '_' und '.'.`;
    }
    emit({ type: "project", action: "created", id: name });

    // Rueckmeldung listet explizit, was gesetzt ist und was noch fehlt — so
    // weiss das LLM, ob es beim Nutzer nachfragen muss. Formulierung bewusst
    // so, dass das LLM keine FS-Details erfindet: kein "Ordner", keine "README.md".
    const gesetztLine = gesetzt.length ? `Gesetzt: ${gesetzt.map(([k]) => k).join(", ")}` : "Gesetzt: (nur Name)";
    const fehlenLine = fehlen.length
      ? `Fehlen noch: ${fehlen.join(", ")} — beim Nutzer nachfragen oder aus Dokumenten extrahieren.`
      : "Alle Stammdaten vollstaendig.";
    return `Projekt "${name}" ist in der Datenbank angelegt. Kein Ordner/keine Datei erzeugt (Projekte sind rein logische DB-Entities).\n\n${gesetztLine}\n${fehlenLine}`;
  },

  projekt_loeschen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    const ok = await projectRepo.delete(name);
    if (!ok) {
      return `Projekt "${name}" konnte nicht geloescht werden (ungueltiger Name).`;
    }
    emit({ type: "project", action: "deleted", id: name });
    return `Projekt "${name}" wurde aus der Datenbank geloescht. Notizen wurden per FK-CASCADE mitgeloescht; Aufgaben, Termine, Dateien und Team-Mitglieder bleiben erhalten (Projekt-Bezug auf NULL gesetzt).`;
  },
};
