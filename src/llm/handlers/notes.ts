import type OpenAI from "openai";
import { noteRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { getVisibleProjectIds, canSeeProjectByName } from "../../data/access.js";
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
    const id = filepath.split(/[\\/]/).pop();
    emit({ type: "note", action: "created", id, project: args.projekt ? String(args.projekt) : null });
    return `Notiz gespeichert: ${id}`;
  },

  notizen_auflisten: async (args) => {
    const limit = Number(args.anzahl) || 5;
    // Phase-6-Cleanup: User-Scope. Wenn der Caller einen User-Kontext hat,
    // filtern wir auf seine sichtbaren Projekte. Notizen ohne Projekt sind
    // weiterhin nur fuer Admin sichtbar (Notizen haben kein assignee/owner-
    // Konzept im DTO).
    const ctx = getCurrentUserCtx();
    if (!ctx || ctx.role === "admin") {
      const notes = await noteRepo.list(limit);
      return notes.length ? notes.join("\n") : "Keine Notizen gefunden.";
    }
    const visible = await getVisibleProjectIds(ctx);
    if (visible === "all") {
      const notes = await noteRepo.list(limit);
      return notes.length ? notes.join("\n") : "Keine Notizen gefunden.";
    }
    if (!noteRepo.listDetailed) {
      // Im FS-Mode haben wir kein listDetailed — fall back auf "alles" weil
      // FS keine Multi-User-Trennung unterstuetzt.
      const notes = await noteRepo.list(limit);
      return notes.length ? notes.join("\n") : "Keine Notizen gefunden.";
    }
    const visibleNames = new Set(await projectRepo.list(visible));
    const detailed = await noteRepo.listDetailed(2000);
    const filtered = detailed
      .filter((n) => n.project && visibleNames.has(n.project))
      .slice(0, limit)
      .map((n) => n.title);
    return filtered.length ? filtered.join("\n") : "Keine Notizen gefunden.";
  },

  notiz_lesen: async (args) => {
    // Wir muessen die Notiz selbst lesen, um project_id zu erfahren — und
    // dann pruefen ob der User Zugriff auf das Projekt hat. Bei project=null
    // (persoenliche Notiz): nur Admin sieht.
    const content = await noteRepo.read(String(args.dateiname));
    if (content === null) {
      return `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
    }
    const ctx = getCurrentUserCtx();
    if (ctx && ctx.role !== "admin" && noteRepo.listDetailed) {
      // Project-Lookup ueber listDetailed — kein get(name)-API verfuegbar.
      const detailed = await noteRepo.listDetailed(2000);
      const meta = detailed.find((n) => n.title === String(args.dateiname));
      if (!meta || !meta.project) return `Kein Zugriff auf "${args.dateiname}".`;
      if (!(await canSeeProjectByName(ctx, meta.project))) {
        return `Kein Zugriff auf "${args.dateiname}".`;
      }
    }
    return content;
  },

  notiz_loeschen: async (args) => {
    // Schreibschutz: nur Admin oder Mitglied des Projekts der Notiz darf
    // loeschen. Im FS-Mode ohne listDetailed: nur Admin.
    const ctx = getCurrentUserCtx();
    if (ctx && ctx.role !== "admin") {
      if (!noteRepo.listDetailed) return `Kein Zugriff zum Loeschen von "${args.dateiname}".`;
      const detailed = await noteRepo.listDetailed(2000);
      const meta = detailed.find((n) => n.title === String(args.dateiname));
      if (!meta?.project || !(await canSeeProjectByName(ctx, meta.project))) {
        return `Kein Zugriff zum Loeschen von "${args.dateiname}".`;
      }
    }
    const deleted = await noteRepo.delete(String(args.dateiname));
    if (!deleted) {
      return `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
    }
    emit({ type: "note", action: "deleted", id: String(deleted) });
    return `Notiz geloescht: ${deleted}`;
  },

  notiz_bearbeiten: async (args) => {
    const ok = await noteRepo.append(String(args.dateiname), String(args.text));
    if (!ok) {
      return `Notiz "${args.dateiname}" nicht gefunden. Nutze notizen_auflisten um den genauen Dateinamen zu finden.`;
    }
    emit({ type: "note", action: "updated", id: String(args.dateiname) });
    return `Nachtrag gespeichert in: ${args.dateiname}`;
  },
};
