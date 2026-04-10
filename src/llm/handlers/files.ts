import type OpenAI from "openai";
import {
  readFile, createFile, listFolder,
  editFile, globFiles, grepFiles,
  searchVault,
} from "../../vault/index.js";
import { HTTP_RESPONSE_MAX_CHARS } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const fileSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  { type: "function", function: { name: "datei_lesen", description: "Liest den vollstaendigen Inhalt einer beliebigen Datei im Vault. Pfad ist relativ zum Vault-Root. Nutze dateien_suchen oder ordner_auflisten um den Pfad zu finden wenn du ihn nicht kennst.", parameters: { type: "object", properties: { pfad: { type: "string", description: "Relativer Pfad im Vault, z.B. 'Projekte/Alpha/README.md'" } }, required: ["pfad"] } } },
  { type: "function", function: { name: "datei_erstellen", description: "Erstellt eine neue Datei im Vault oder ueberschreibt eine bestehende. Pfad ist relativ zum Vault-Root. Fehlende Ordner werden automatisch erstellt. Fuer Aenderungen an bestehenden Dateien besser datei_bearbeiten nutzen.", parameters: { type: "object", properties: { pfad: { type: "string", description: "Relativer Pfad im Vault" }, inhalt: { type: "string", description: "Dateiinhalt" } }, required: ["pfad", "inhalt"] } } },
  { type: "function", function: { name: "ordner_auflisten", description: "Listet den Inhalt eines Ordners im Vault auf (Dateien und Unterordner). Zeigt nur eine Ebene — nicht rekursiv. Fuer rekursive Suche dateien_suchen verwenden.", parameters: { type: "object", properties: { pfad: { type: "string", description: "Relativer Pfad (leer = Vault-Wurzel)" } }, required: [] } } },
  { type: "function", function: { name: "vault_suchen", description: "Schnelle Freitextsuche in allen .md-Dateien des Vaults. Gibt Dateiname und erste Trefferzeile zurueck (max 10 Ergebnisse). Fuer Regex oder alle Dateitypen regex_suchen verwenden.", parameters: { type: "object", properties: { suchbegriff: { type: "string", description: "Der Suchbegriff" }, projekt: { type: "string", description: "Optional: Suche auf ein Projekt begrenzen" } }, required: ["suchbegriff"] } } },
  { type: "function", function: { name: "datei_bearbeiten", description: "Sucht Text in einer Vault-Datei und ersetzt ihn (Find-and-Replace). Fuer praezise Aenderungen an bestehenden Dateien. Unterstuetzt exakte Textsuche und Regex-Muster. Nicht fuer Notiz-Nachtraege — dafuer notiz_bearbeiten nutzen.", parameters: { type: "object", properties: { pfad: { type: "string", description: "Relativer Pfad im Vault (z.B. 'Projekte/Alpha/README.md')" }, suchen: { type: "string", description: "Text der gesucht wird (exakt oder Regex)" }, ersetzen: { type: "string", description: "Ersetzungstext" }, regex: { type: "boolean", description: "true = suchen ist ein Regex-Muster (Standard: false)" }, alle: { type: "boolean", description: "true = alle Vorkommen ersetzen (Standard: false, nur erstes)" } }, required: ["pfad", "suchen", "ersetzen"] } } },
  { type: "function", function: { name: "dateien_suchen", description: "Sucht Dateien im Vault nach Name/Muster (Glob). Unterstuetzt * und ** Platzhalter. Beispiele: '**/*.md', 'Projekte/*/README.md', 'Inbox/*.md'.", parameters: { type: "object", properties: { muster: { type: "string", description: "Glob-Muster (z.B. '**/*.md', 'Projekte/*/*.md')" }, ordner: { type: "string", description: "Optional: Startordner (Standard: Vault-Wurzel)" }, limit: { type: "number", description: "Max. Ergebnisse (Standard: 50)" } }, required: ["muster"] } } },
  { type: "function", function: { name: "regex_suchen", description: "Durchsucht Dateiinhalte im Vault mit Regex-Mustern (wie grep). Gibt Treffer mit Zeilennummern zurueck. Durchsucht alle Dateitypen, nicht nur .md. Fuer einfache Textsuche in Notizen ist vault_suchen schneller.", parameters: { type: "object", properties: { muster: { type: "string", description: "Regex-Suchmuster (z.B. 'OENORM.*B\\\\s?1801', 'TODO|FIXME')" }, ordner: { type: "string", description: "Optional: Unterordner (Standard: gesamter Vault)" }, kontext: { type: "number", description: "Zeilen Kontext vor/nach Treffer (Standard: 0)" }, dateifilter: { type: "string", description: "Optional: Datei-Glob (z.B. '*.md', '*.json')" }, limit: { type: "number", description: "Max. Treffer gesamt (Standard: 20)" } }, required: ["muster"] } } },
];

export const fileHandlers: HandlerMap = {
  datei_lesen: async (args) => {
    const content = readFile(String(args.pfad));
    return content ?? `Datei nicht gefunden: ${args.pfad}. Nutze dateien_suchen oder ordner_auflisten um den richtigen Pfad zu finden.`;
  },

  datei_erstellen: async (args) => {
    const fp = createFile(String(args.pfad), String(args.inhalt));
    return `Datei erstellt: ${fp.split(/[\\/]/).pop()}`;
  },

  ordner_auflisten: async (args) => {
    const entries = listFolder(args.pfad ? String(args.pfad) : "");
    return entries.length
      ? entries.map(e => e.type === "folder" ? `\u{1F4C1} ${e.name}` : `\u{1F4C4} ${e.name}`).join("\n")
      : `Ordner "${args.pfad || '/'}" leer oder nicht gefunden. Nutze ordner_auflisten ohne Pfad fuer die Vault-Wurzel.`;
  },

  vault_suchen: async (args) => {
    const results = searchVault(String(args.suchbegriff), args.projekt ? String(args.projekt) : undefined);
    if (!results.length) return `Keine Treffer fuer "${args.suchbegriff}".`;
    return results.map(r => `\u{1F4C4} ${r.file}\n   ${r.line}`).join("\n\n");
  },

  datei_bearbeiten: async (args) => {
    const result = editFile(
      String(args.pfad),
      String(args.suchen),
      String(args.ersetzen),
      {
        regex: String(args.regex) === "true",
        all: String(args.alle) === "true",
      },
    );
    if (!result) return `Datei nicht gefunden oder Pfad ungueltig: ${args.pfad}. Nutze dateien_suchen um den richtigen Pfad zu finden.`;
    if (result.count === 0) return `Kein Treffer fuer "${args.suchen}" in ${args.pfad}. Nutze datei_lesen um den aktuellen Inhalt zu pruefen, oder regex_suchen um den Text im Vault zu finden.`;
    return `${result.count} Ersetzung(en) in ${args.pfad}.\n${result.preview}`;
  },

  dateien_suchen: async (args) => {
    const files = globFiles(String(args.muster), {
      limit: Number(args.limit) || 50,
      subdir: args.ordner ? String(args.ordner) : undefined,
    });
    if (!files.length) return `Keine Dateien gefunden fuer "${args.muster}".`;
    return files.join("\n") + `\n\n[${files.length} Datei(en)]`;
  },

  regex_suchen: async (args) => {
    const result = grepFiles(String(args.muster), {
      subdir: args.ordner ? String(args.ordner) : undefined,
      context: Number(args.kontext) || 0,
      maxMatches: Number(args.limit) || 20,
      fileGlob: args.dateifilter ? String(args.dateifilter) : undefined,
    });
    if (!result.matches.length) return `Keine Treffer fuer "${args.muster}".`;

    const grouped = new Map<string, Array<{ line: number; text: string }>>();
    for (const m of result.matches) {
      const arr = grouped.get(m.file) || [];
      arr.push({ line: m.line, text: m.text });
      grouped.set(m.file, arr);
    }

    const parts: string[] = [];
    for (const [file, matches] of grouped) {
      const lines = matches.map(m => `${m.line}: ${m.text}`).join("\n");
      parts.push(`=== ${file} ===\n${lines}`);
    }

    let output = parts.join("\n\n");
    const summary = `[${result.matches.length} Treffer in ${result.totalFiles} Datei(en)]`;
    output += result.truncated ? `\n\n${summary} (gekuerzt)` : `\n\n${summary}`;

    return output.length > HTTP_RESPONSE_MAX_CHARS ? output.slice(0, HTTP_RESPONSE_MAX_CHARS) + "\n[... gekuerzt]" : output;
  },
};
