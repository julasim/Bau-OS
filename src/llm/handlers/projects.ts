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
        "Legt ein neues Projekt an (Ordner Projekte/<name>/ mit Notizen/-Unterordner und README.md; im DB-Modus zusaetzlich Eintrag in der projects-Tabelle). Idempotent: wenn DB und Vault inkonsistent sind (z.B. nur eine Seite hat das Projekt), wird die fehlende Seite nachgezogen. Gibt einen Fehler zurueck, wenn der Name ungueltige Zeichen enthaelt (erlaubt: Buchstaben inkl. Umlaute, Ziffern, Leerzeichen, '-', '_', '.').",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Projektname (wird auch als Ordnername verwendet)" },
          beschreibung: {
            type: "string",
            description: "Optionale Kurzbeschreibung (landet in der README.md).",
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
        "Loescht ein Projekt komplett: den Vault-Ordner Projekte/<name>/ inkl. aller Notizen, Aufgaben und Termine darin UND den DB-Eintrag. UNWIDERRUFLICH. Nur aufrufen, wenn der Benutzer das explizit verlangt hat.",
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
    return `Projekt "${name}" ist angelegt und synchron (Projekte/${name}/ + DB-Eintrag).`;
  },

  projekt_loeschen: async (args) => {
    const name = String(args.name ?? "").trim();
    if (!name) return "Fehler: Name ist erforderlich.";

    const ok = await projectRepo.delete(name);
    if (!ok) {
      return `Projekt "${name}" konnte nicht geloescht werden (ungueltiger Name oder FS-Fehler).`;
    }
    return `Projekt "${name}" wurde vollstaendig geloescht (Vault-Ordner + DB-Eintrag).`;
  },
};
