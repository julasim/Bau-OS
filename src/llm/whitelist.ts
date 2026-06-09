// ============================================================
// Bau-OS — Tool-Whitelist fuer den System-Prompt
// Liefert eine kompakte, gruppierte Liste aller verfuegbaren
// Tool-Namen + Kurzbeschreibungen, die direkt in den
// System-Prompt eingeblendet wird. Damit kann das LLM keine
// Tools mehr erfinden ("halluzinieren") und sieht sofort,
// welche Aktionen tatsaechlich existieren.
// ============================================================

import type OpenAI from "openai";
import { TOOLS } from "./tools.js";
import { getDynamicToolSchemas } from "../tools.js";
import { getMcpToolSchemas } from "../mcp.js";

// Gruppierungs-Heuristik: Tools werden nach Namens-Praefix kategorisiert.
// Reihenfolge bestimmt die Anzeige im Prompt.
const GROUPS: { title: string; match: (name: string) => boolean }[] = [
  { title: "Antwort", match: (n) => n === "antworten" },
  { title: "Notizen", match: (n) => n.startsWith("notiz") },
  { title: "Aufgaben", match: (n) => n.startsWith("aufgab") },
  { title: "Termine", match: (n) => n.startsWith("termin") },
  { title: "Projekte", match: (n) => n.startsWith("projekt") || n.startsWith("portfolio") },
  { title: "Team", match: (n) => n.startsWith("team") },
  { title: "Dateien & Suche", match: (n) => /^(datei|ordner|vault|semantisch|dateien|regex|pdf|docx)/.test(n) },
  { title: "Web", match: (n) => /^(http|web|nachrichten|webseite)/.test(n) },
  { title: "Agenten & Memory", match: (n) => n.startsWith("agent") || n.startsWith("memory") },
  { title: "Tools (dynamisch)", match: (n) => n.startsWith("tool") },
  { title: "MCP", match: (n) => n.startsWith("mcp") },
  { title: "System", match: (n) => /^(befehl|code)/.test(n) },
];

function shorten(desc: string | undefined, maxLen = 90): string {
  if (!desc) return "";
  const firstSentence = desc.split(/[.!?]\s/)[0];
  const trimmed = firstSentence.length > maxLen ? firstSentence.slice(0, maxLen - 1) + "\u2026" : firstSentence;
  return trimmed;
}

function categorize(schemas: OpenAI.Chat.ChatCompletionTool[]): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const g of GROUPS) buckets.set(g.title, []);
  buckets.set("Sonstiges", []);

  for (const schema of schemas) {
    if (schema.type !== "function") continue;
    const name = schema.function.name;
    const desc = shorten(schema.function.description);
    const line = desc ? `- \`${name}\` — ${desc}` : `- \`${name}\``;

    const group = GROUPS.find((g) => g.match(name));
    const key = group ? group.title : "Sonstiges";
    buckets.get(key)!.push(line);
  }
  return buckets;
}

/**
 * Baut die Whitelist als Markdown-Block, der in den System-Prompt
 * eingebunden wird. Enthaelt eine harte Regel: nur diese Tools nutzen.
 */
export function buildToolWhitelist(): string {
  const allSchemas = [...TOOLS, ...getDynamicToolSchemas(), ...getMcpToolSchemas()];
  const buckets = categorize(allSchemas);

  const sections: string[] = [];
  for (const [title, lines] of buckets) {
    if (lines.length === 0) continue;
    sections.push(`**${title}**\n${lines.join("\n")}`);
  }

  return [
    "## Verfuegbare Tools (Whitelist)",
    "",
    "**Eiserne Regel — keine Ausnahmen:**",
    "1. Wenn der Benutzer eine Aktion verlangt (\u201Eleg an\u201C, \u201Eerstelle\u201C,",
    "   \u201Espeichere\u201C, \u201Eloesche\u201C, \u201Eaendere\u201C ...), MUSST du das",
    "   passende Tool aus der Liste unten WIRKLICH aufrufen.",
    "2. Du darfst NIEMALS behaupten, etwas getan zu haben, ohne das",
    "   entsprechende Tool aufgerufen zu haben. Halluzinierte Erfolgs-",
    "   meldungen sind ein schwerer Fehler.",
    "3. Wenn ein Tool einen Fehler zurueckgibt (\u201EFEHLER\u201C, \u201Enicht",
    "   gefunden\u201C, \u201Eexistiert bereits\u201C ...), wiederhole NICHT stumm,",
    "   sondern melde den Fehler dem Benutzer ueber das antworten-Tool.",
    "4. Wenn fuer eine Anfrage KEIN passendes Tool existiert, sage ehrlich:",
    "   \u201EDafuer habe ich aktuell kein Tool.\u201C",
    "5. Tool-Namen sind exakt wie hier geschrieben aufzurufen — keine",
    "   Aliase, keine englischen Varianten, keine Phantasie-Namen.",
    "6. **Such-Regel** fuer User-Inhalte (Notizen, Dateien, Angebote,",
    "   Protokolle, Kontakte, Projektdaten, Termine im Text, technische",
    "   Details, Zahlen aus Dokumenten):",
    "   a) ZUERST `semantisch_suchen` (Bedeutungs-basiert, trifft meist).",
    "   b) Keine oder unpassende Treffer? Dann `dateien_suchen` mit einem",
    "      Stichwort aus dem Dateinamen (z.B. \u201EAngebot\u201C, \u201EMeeting\u201C,",
    "      \u201EVoelkendorf\u201C) \u2014 Name-basierter Fallback.",
    "   c) Wenn eine konkrete Datei gefunden ist aber der Inhalt fehlt,",
    "      gezielt `datei_lesen` mit dem Dateinamen aufrufen.",
    "   d) Fuer Bezug auf vergangene Gespraeche: `chat_suchen`.",
    "   **NIE** `vault_suchen` fuer User-Inhalte \u2014 das findet nur",
    "   System-Dateien (Agent-Config wie IDENTITY.md, BOOT.md).",
    "",
    sections.join("\n\n"),
  ].join("\n");
}
