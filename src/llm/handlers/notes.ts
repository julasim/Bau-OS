import type OpenAI from "openai";
import { noteRepo } from "../../data/index.js";
import type { HandlerMap } from "./types.js";

export const noteSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "notiz_speichern",
      description:
        "Speichert eine freie Notiz im Vault (Inbox oder Projektordner). Nutze dieses Tool fuer Gedanken, Beobachtungen, Ideen und Informationen die keine konkrete Aufgabe oder Termin sind. Ohne Projekt landet die Notiz in der Inbox.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Inhalt der Notiz" },
          projekt: { type: "string", description: "Optionaler Projektname" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notizen_auflisten",
      description:
        "Listet die letzten Notizen aus der Inbox auf, sortiert nach Datum. Nutze dieses Tool um einen Ueberblick ueber aktuelle Notizen zu bekommen oder eine bestimmte Notiz zu finden.",
      parameters: {
        type: "object",
        properties: { anzahl: { type: "number", description: "Wie viele Notizen anzeigen (Standard: 5)" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_lesen",
      description:
        "Liest den vollstaendigen Inhalt einer Notiz-Datei. Nutze notizen_auflisten um zuerst den genauen Dateinamen zu finden.",
      parameters: {
        type: "object",
        properties: { dateiname: { type: "string", description: "Name der Notiz-Datei" } },
        required: ["dateiname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_loeschen",
      description:
        "Loescht eine Notiz dauerhaft aus dem Vault. Achtung: nicht rueckgaengig machbar. Stelle sicher dass du den richtigen Dateinamen hast.",
      parameters: {
        type: "object",
        properties: { dateiname: { type: "string", description: "Name der Notiz-Datei" } },
        required: ["dateiname"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "notiz_bearbeiten",
      description:
        "Fuegt einer bestehenden Notiz am Ende einen Nachtrag hinzu (Append). Nicht fuer Ersetzen — dafuer datei_bearbeiten verwenden. Der Nachtrag wird mit Zeitstempel angehaengt.",
      parameters: {
        type: "object",
        properties: {
          dateiname: { type: "string", description: "Name der Notiz-Datei" },
          text: { type: "string", description: "Inhalt des Nachtrags" },
        },
        required: ["dateiname", "text"],
      },
    },
  },
];

export const noteHandlers: HandlerMap = {
  notiz_speichern: async (args) => {
    const filepath = await noteRepo.save(String(args.text), args.projekt ? String(args.projekt) : undefined);
    return `Notiz gespeichert: ${filepath.split(/[\\/]/).pop()}`;
  },

  notizen_auflisten: async (args) => {
    const notes = await noteRepo.list(Number(args.anzahl) || 5);
    return notes.length ? notes.join("\n") : "Keine Notizen gefunden.";
  },

  notiz_lesen: async (args) => {
    const content = await noteRepo.read(String(args.dateiname));
    return (
      content ??
      `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`
    );
  },

  notiz_loeschen: async (args) => {
    const deleted = await noteRepo.delete(String(args.dateiname));
    return deleted
      ? `Notiz geloescht: ${deleted}`
      : `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
  },

  notiz_bearbeiten: async (args) => {
    const ok = await noteRepo.append(String(args.dateiname), String(args.text));
    return ok
      ? `Nachtrag gespeichert in: ${args.dateiname}`
      : `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
  },
};
