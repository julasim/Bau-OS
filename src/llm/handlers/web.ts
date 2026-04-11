import type OpenAI from "openai";
import { HTTP_REQUEST_TIMEOUT_MS, HTTP_RESPONSE_MAX_CHARS } from "../../config.js";
import type { HandlerMap } from "./types.js";

export const webSchemas: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "http_anfrage",
      description:
        "Sendet eine HTTP-Anfrage an eine beliebige URL. Fuer: REST APIs aufrufen, Webhooks triggern, Daten von externen Diensten abrufen, JSON APIs abfragen.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die Ziel-URL (z.B. 'https://api.example.com/data')" },
          methode: { type: "string", description: "HTTP-Methode: GET, POST, PUT, PATCH, DELETE (Standard: GET)" },
          body: { type: "string", description: "Request-Body als JSON-String (fuer POST/PUT/PATCH)" },
          headers: {
            type: "string",
            description: 'Zusaetzliche Headers als JSON-String (z.B. \'{"Authorization": "Bearer xxx"}\')',
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_suchen",
      description:
        "Sucht im Internet via DuckDuckGo nach Informationen. Gibt Titel, URL und Kurzbeschreibung zurueck. Fuer Recherche, aktuelle Preise, Normen, Vorschriften etc. Fuer den vollstaendigen Inhalt einer gefundenen URL dann webseite_lesen verwenden.",
      parameters: {
        type: "object",
        properties: {
          suchbegriff: { type: "string", description: "Der Suchbegriff (z.B. 'OENORM B 1801 Kalkulation')" },
          anzahl: { type: "number", description: "Anzahl Ergebnisse (Standard: 5, max 10)" },
        },
        required: ["suchbegriff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "nachrichten_suchen",
      description:
        "Sucht aktuelle Nachrichten und Meldungen im Internet (Google News, Region Oesterreich). Gibt Titel, URL, Quelle und Datum zurueck. Ideal fuer: aktuelle Bauvorschriften, Foerderungen, Marktpreise, Branchen-News, lokale Nachrichten. Fuer allgemeine Recherche web_suchen verwenden.",
      parameters: {
        type: "object",
        properties: {
          suchbegriff: {
            type: "string",
            description: "Der Suchbegriff (z.B. 'Baukosten Oesterreich 2026', 'Foerderung Sanierung Steiermark')",
          },
          anzahl: { type: "number", description: "Anzahl Ergebnisse (Standard: 5, max 10)" },
        },
        required: ["suchbegriff"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "webseite_lesen",
      description:
        "Liest den Hauptinhalt einer Webseite und gibt ihn als strukturiertes Markdown zurueck (Navigation, Footer, Werbung werden entfernt). Max 10.000 Zeichen. Ideal in Kombination mit web_suchen oder nachrichten_suchen: erst suchen, dann relevante URL lesen.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die URL der Webseite (z.B. 'https://example.com/artikel')" },
        },
        required: ["url"],
      },
    },
  },
];

function isPrivateUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
    const parts = host.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    return false;
  } catch {
    return true;
  }
}

export const webHandlers: HandlerMap = {
  http_anfrage: async (args) => {
    const url = String(args.url);
    if (isPrivateUrl(url)) return "Zugriff auf interne/private Adressen nicht erlaubt.";
    const method = (args.methode ? String(args.methode) : "GET").toUpperCase();

    const options: RequestInit = {
      method,
      signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "Bau-OS/1.0" },
    };

    if (args.headers) {
      try {
        Object.assign(options.headers!, JSON.parse(String(args.headers)));
      } catch {
        return "Fehler: headers ist kein gueltiges JSON.";
      }
    }

    if (args.body && ["POST", "PUT", "PATCH"].includes(method)) {
      options.body = String(args.body);
      (options.headers as Record<string, string>)["Content-Type"] ??= "application/json";
    }

    try {
      const resp = await fetch(url, options);
      const text = await resp.text();
      const status = `HTTP ${resp.status} ${resp.statusText}`;

      if (text.length > HTTP_RESPONSE_MAX_CHARS) {
        return `${status}\n\n${text.slice(0, HTTP_RESPONSE_MAX_CHARS)}\n\n[... gekuerzt, ${text.length - HTTP_RESPONSE_MAX_CHARS} Zeichen entfernt]`;
      }
      return `${status}\n\n${text}`;
    } catch (err) {
      return `HTTP-Fehler: ${err}`;
    }
  },

  web_suchen: async (args) => {
    const { webSearch } = await import("../../web.js");
    const results = await webSearch(String(args.suchbegriff), Number(args.anzahl) || 5);
    if (!results.length) return `Keine Ergebnisse fuer "${args.suchbegriff}".`;
    return results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
  },

  nachrichten_suchen: async (args) => {
    const { newsSearch } = await import("../../web.js");
    const results = await newsSearch(String(args.suchbegriff), Number(args.anzahl) || 5);
    if (!results.length)
      return `Keine Nachrichten gefunden fuer "${args.suchbegriff}". Versuche einen breiteren Suchbegriff oder nutze web_suchen fuer allgemeine Ergebnisse.`;
    return results
      .map(
        (r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.source}${r.date ? ` — ${r.date}` : ""}${r.snippet ? `\n   ${r.snippet}` : ""}`,
      )
      .join("\n\n");
  },

  webseite_lesen: async (args) => {
    const { fetchPage } = await import("../../web.js");
    return await fetchPage(String(args.url));
  },
};
