import type OpenAI from "openai";
import { projectRepo } from "../../data/index.js";
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
        "Legt ein neues Projekt in der Datenbank an. Es werden KEINE Ordner oder Dateien auf der Festplatte erzeugt — Projekte sind rein logische DB-Entities. Notizen, Aufgaben und Termine zu einem Projekt landen ebenfalls in der DB, nicht im Dateisystem. Idempotent: existiert der Projektname schon, wird 'true' zurueckgegeben. Fehler nur bei ungueltigem Namen (erlaubt: Buchstaben inkl. Umlaute, Ziffern, Leerzeichen, '-', '_', '.'). Behaupte NIE, dass ein Ordner, eine README.md oder eine Datei-Struktur angelegt wurde — das stimmt nicht.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Projektname" },
          beschreibung: {
            type: "string",
            description: "Optionale Kurzbeschreibung (landet in der projects.description-Spalte).",
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
    const beschreibung = args.beschreibung ? String(args.beschreibung) : null;

    // Kein Pre-Check — create() ist idempotent und heilt DB/Vault-
    // Inkonsistenzen automatisch. Wenn wir hier vorher "existiert bereits"
    // zurueckgeben, sperren wir uns gegen genau die Inkonsistenz aus, die
    // wir eigentlich heilen wollen (DB sagt ja, Ordner fehlt — oder umgekehrt).
    const ok = await projectRepo.create(name, beschreibung);
    if (!ok) {
      return `Projekt "${name}" konnte nicht angelegt werden. Erlaubt sind Buchstaben (inkl. Umlaute), Ziffern, Leerzeichen, '-', '_' und '.'.`;
    }
    // Formulierung bewusst so, dass das LLM keine FS-Details erfindet:
    // kein "Ordner", keine "README.md", keine "Struktur".
    return `Projekt "${name}" ist in der Datenbank angelegt. Kein Ordner/keine Datei erzeugt (Projekte sind rein logische DB-Entities).`;
  },

  projekt_loeschen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    const ok = await projectRepo.delete(name);
    if (!ok) {
      return `Projekt "${name}" konnte nicht geloescht werden (ungueltiger Name).`;
    }
    return `Projekt "${name}" wurde aus der Datenbank geloescht. Notizen wurden per FK-CASCADE mitgeloescht; Aufgaben, Termine, Dateien und Team-Mitglieder bleiben erhalten (Projekt-Bezug auf NULL gesetzt).`;
  },
};
