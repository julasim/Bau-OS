// ============================================================
// Bau-OS — LLM-Handler: Bautagebuch
// ============================================================
// Drei Tools fuer den klassischen Baustellen-Tageseintrag:
//   - bautagebuch_eintrag: Schreibt/aktualisiert einen Eintrag (UPSERT).
//   - bautagebuch_woche:   Letzte 7 Eintraege eines Projekts (Ueberblick).
//   - bautagebuch_lesen:   Einzelner Eintrag fuer ein Datum.
//
// Datums-Eingabe:
//   - User-Eingabe via LLM ist meist TT.MM.JJJJ (deutsch). Wir akzeptieren
//     beides und konvertieren zu ISO YYYY-MM-DD bevor wir ins Repo gehen.
//   - "heute" als Default wenn kein Datum mitkommt.
//
// User-Scoping:
//   - Wenn UserCtx vorhanden und nicht-Admin: pruefen ob das Projekt
//     sichtbar ist. Sonst zurueckweisen wie bei termine/tasks.
// ============================================================

import type OpenAI from "openai";
import { bautagebuchRepo, projectRepo } from "../../data/index.js";
import { emit } from "../../api/events.js";
import { getCurrentUserCtx } from "../user-context.js";
import { canSeeProjectByName } from "../../data/access.js";
import type { HandlerMap } from "./types.js";
import type { BautagebuchUpsertInput, WeatherType } from "../../data/types.js";

const ALLOWED_WEATHER: WeatherType[] = ["sonnig", "bewoelkt", "regen", "schnee", "sturm", "nebel", "frost", "hagel"];

/** Konvertiert TT.MM.JJJJ → YYYY-MM-DD. Akzeptiert auch ISO-Format unveraendert. */
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

/** Heute im ISO-Format. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hilfsfunktion: Projekt-ID aus Name + ACL-Check.
 *  Liefert {id, name} oder einen Fehlerstring fuer den Agenten. */
async function resolveProject(projektName: string): Promise<{ id: string; name: string } | string> {
  const ctx = getCurrentUserCtx();
  if (ctx && ctx.role !== "admin" && !(await canSeeProjectByName(ctx, projektName))) {
    return `Kein Zugriff auf Projekt "${projektName}".`;
  }
  const info = await projectRepo.getInfo(projektName);
  if (!info?.id) return `Projekt "${projektName}" nicht gefunden.`;
  return { id: info.id, name: info.name };
}

export const bautagebuchSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "bautagebuch_eintrag",
      description:
        "Speichert einen Bautagebuch-Eintrag fuer einen Tag und ein Projekt. Pro Projekt+Datum gibt es genau einen Eintrag — wird ein vorhandener Eintrag aktualisiert. Nutze dieses Tool fuer den taeglichen Baubericht: Wetter, eingesetzte Personen/Trupps, Maschinen, durchgefuehrte Arbeiten und besondere Vorkommnisse.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          datum: {
            type: "string",
            description: "Datum im Format TT.MM.JJJJ. Wenn leer: heute.",
          },
          wetter: {
            type: "string",
            description: "Wetter-Schlagwort: sonnig, bewoelkt, regen, schnee, sturm, nebel, frost, hagel",
            enum: ALLOWED_WEATHER as unknown as string[],
          },
          temperatur_min: { type: "number", description: "Tiefste Temperatur des Tages in °C" },
          temperatur_max: { type: "number", description: "Hoechste Temperatur in °C" },
          personal: {
            type: "string",
            description:
              "Anwesende Personen/Trupps als Freitext. Beispiel: 'Polier Schmidt + 3 Maurer, Subunternehmer Elektro Maier (2 Mann)'",
          },
          maschinen: {
            type: "string",
            description: "Eingesetzte Maschinen/Geraete als Freitext. Beispiel: 'Bagger CAT 320, Mobilkran 50t'",
          },
          taetigkeiten: { type: "string", description: "Was wurde gemacht (Markdown erlaubt)." },
          vorkommnisse: { type: "string", description: "Besondere Vorkommnisse, Behinderungen, Stoerungen, Unfaelle." },
        },
        required: ["projekt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bautagebuch_woche",
      description:
        "Listet die letzten Bautagebuch-Eintraege eines Projekts auf (Standard: 7 Tage). Gibt einen kompakten Ueberblick mit Datum, Wetter, Taetigkeiten und Vorkommnissen.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          tage: { type: "number", description: "Anzahl Eintraege (Default: 7)" },
        },
        required: ["projekt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bautagebuch_lesen",
      description:
        "Liest einen einzelnen Bautagebuch-Eintrag fuer ein bestimmtes Datum und Projekt. Gibt alle Felder im Detail aus.",
      parameters: {
        type: "object",
        properties: {
          projekt: { type: "string", description: "Projektname" },
          datum: { type: "string", description: "Datum im Format TT.MM.JJJJ" },
        },
        required: ["projekt", "datum"],
      },
    },
  },
];

export const bautagebuchHandlers: HandlerMap = {
  bautagebuch_eintrag: async (args) => {
    if (!bautagebuchRepo) return "Bautagebuch erfordert DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    if (!projektName) return "Projektname fehlt.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const datumRaw = args.datum ? String(args.datum) : todayIso();
    const iso = toIsoDate(datumRaw);
    if (!iso) return `Ungueltiges Datum "${datumRaw}". Bitte TT.MM.JJJJ verwenden.`;

    // Personal als Freitext-String → ein einzelner personnel-Eintrag mit
    // name=<Freitext>. Strukturiertere Eintraege machen sinnvoll nur ueber
    // die Web-UI mit TeamPicker; das LLM-Tool waere zu komplex.
    const patch: BautagebuchUpsertInput = {};
    if ("wetter" in args) {
      const w = String(args.wetter).toLowerCase();
      if (!ALLOWED_WEATHER.includes(w as WeatherType)) {
        return `Ungueltiges Wetter "${w}". Erlaubt: ${ALLOWED_WEATHER.join(", ")}.`;
      }
      patch.weather = w as WeatherType;
    }
    if ("temperatur_min" in args) patch.temperatureMin = Number(args.temperatur_min);
    if ("temperatur_max" in args) patch.temperatureMax = Number(args.temperatur_max);
    if ("maschinen" in args) patch.machines = String(args.maschinen);
    if ("taetigkeiten" in args) patch.activities = String(args.taetigkeiten);
    if ("vorkommnisse" in args) patch.incidents = String(args.vorkommnisse);
    if ("personal" in args) {
      const text = String(args.personal).trim();
      if (text) patch.personnel = [{ name: text }];
    }

    const ctx = getCurrentUserCtx();
    const result = await bautagebuchRepo.upsert(proj.id, iso, patch, ctx?.userId ?? null);
    if (typeof result === "string") return result;
    emit({ type: "bautagebuch", action: "saved", id: result.id, project: proj.name, data: { date: iso } });
    return `Bautagebuch fuer ${proj.name} am ${iso} gespeichert.`;
  },

  bautagebuch_woche: async (args) => {
    if (!bautagebuchRepo) return "Bautagebuch erfordert DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    if (!projektName) return "Projektname fehlt.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const tage = Math.min(Math.max(Number(args.tage) || 7, 1), 30);
    const entries = await bautagebuchRepo.list(proj.id, tage);
    if (entries.length === 0) return `Keine Bautagebuch-Eintraege fuer "${proj.name}".`;

    return entries
      .map((e) => {
        const wetterStr = e.weather
          ? `${e.weather}${e.temperatureMin !== null && e.temperatureMax !== null ? ` (${e.temperatureMin}/${e.temperatureMax}°C)` : ""}`
          : "—";
        const tat = (e.activities ?? "").split("\n")[0].slice(0, 80) || "(keine Eintragung)";
        const vor = e.incidents ? ` ⚠ ${e.incidents.split("\n")[0].slice(0, 60)}` : "";
        return `${e.date} · ${wetterStr} · ${tat}${vor}`;
      })
      .join("\n");
  },

  bautagebuch_lesen: async (args) => {
    if (!bautagebuchRepo) return "Bautagebuch erfordert DB-Modus.";
    const projektName = String(args.projekt ?? "").trim();
    const datumRaw = String(args.datum ?? "").trim();
    if (!projektName || !datumRaw) return "Projekt und Datum sind erforderlich.";

    const proj = await resolveProject(projektName);
    if (typeof proj === "string") return proj;

    const iso = toIsoDate(datumRaw);
    if (!iso) return `Ungueltiges Datum "${datumRaw}". Bitte TT.MM.JJJJ verwenden.`;

    const entry = await bautagebuchRepo.get(proj.id, iso);
    if (!entry) return `Kein Bautagebuch-Eintrag fuer ${proj.name} am ${iso}.`;

    const lines: string[] = [];
    lines.push(`📅 Bautagebuch ${proj.name} — ${entry.date}`);
    if (entry.weather) {
      const t =
        entry.temperatureMin !== null && entry.temperatureMax !== null
          ? ` (${entry.temperatureMin} bis ${entry.temperatureMax}°C)`
          : "";
      lines.push(`Wetter: ${entry.weather}${t}`);
    }
    if (entry.personnel.length > 0) {
      lines.push(`Personal: ${entry.personnel.map((p) => p.name + (p.removed ? " (entfernt)" : "")).join(", ")}`);
    }
    if (entry.machines) lines.push(`Maschinen: ${entry.machines}`);
    if (entry.activities) lines.push(`Taetigkeiten:\n${entry.activities}`);
    if (entry.incidents) lines.push(`Vorkommnisse:\n${entry.incidents}`);
    return lines.join("\n");
  },
};
