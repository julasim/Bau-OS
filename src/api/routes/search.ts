import { Hono } from "hono";
import { searchRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx, type Rolle } from "../../data/access.js";
import type { AppEnv } from "../server.js";
import { projektBezugAusQuery } from "../projekt-bezug.js";

export const searchRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/** Laengster akzeptierter Suchbegriff.
 *
 *  Ohne Grenze zwingt ein 10-KB-Begriff Postgres ueber saemtliche
 *  Dokumenttexte (`files.content_text`, ohne Index) und bindet dabei eine der
 *  20 Pool-Verbindungen aus `src/db/client.ts` — ausloesbar von jedem
 *  angemeldeten Nutzer. 200 Zeichen sind fuer eine Suche reichlich; laengere
 *  Eingaben sind Tippfehler oder Absicht.
 *
 *  Zweite Verteidigungslinie ist der `statement_timeout` in
 *  `src/data/db-search.ts` — die Grenze hier ersetzt ihn nicht. */
const SEARCH_QUERY_MAX_LENGTH = 200;

// GET /search?q=…&project=…&limit=…  — Volltextsuche ueber Notizen, Aufgaben,
// Projekte und Dateien. Die frueheren Betriebsarten (`mode=semantic|text|
// hybrid`) sind mit der Embedding-Suche entfallen; es gibt nur noch einen Weg.
searchRoutes.get("/search", async (c) => {
  const q = c.req.query("q");
  if (!q) return c.json({ error: "Suchbegriff erforderlich (?q=...)" }, 400);
  if (q.length > SEARCH_QUERY_MAX_LENGTH) {
    return c.json({ error: `Suchbegriff zu lang (maximal ${SEARCH_QUERY_MAX_LENGTH} Zeichen)` }, 400);
  }

  const bezug = await projektBezugAusQuery(c);
  if (bezug.unbekannt) return c.json({ error: "Projekt nicht gefunden" }, 404);
  const project = bezug.name;
  // Rohwert durchreichen: Vorgabe und Obergrenze legt das Repo fest (eine
  // Stelle fuer alle Aufrufer). `Number("")` waere 0 und `Number(undefined)`
  // NaN — beides faengt clampLimit() dort ab und faellt auf die Vorgabe
  // zurueck, genauso wie negative Werte, die frueher still Treffer
  // verschluckten.
  const limit = Number(c.req.query("limit"));
  const visible = await getVisibleProjectIds(userCtx(c));

  // ── Datei-Treffer nur, wenn das Konto Dateien ueberhaupt sehen darf ──────
  //
  // Die Praesentationsrolle bekommt aus `getVisibleProjectIds` bewusst "all" —
  // das Board zeigt das ganze Haus. Fuer Dateien gilt das ausdruecklich NICHT:
  // `canAccessFile` (routes/files.ts) fragt `user_projects` direkt, und ein
  // Anzeigekonto hat dort keine Zeile.
  //
  // Ueber die Suche lief dieselbe Rolle daran vorbei: Dateinamen UND die
  // ersten 200 Zeichen des extrahierten Dokumenttextes, aus jedem Projekt.
  // Weder `geldFilter` noch `personendatenFilter` helfen — beide entfernen
  // Felder nach NAMEN, der Inhalt steckt hier in einer Freitext-Zeichenkette.
  //
  // Projekte, Notizen und Aufgaben bleiben durchsuchbar: im Besprechungsraum
  // etwas nachzuschlagen ist der Zweck des Geraets.
  const mitDateien = c.var.userRole !== "praesentation";
  const results = await searchRepo.search(q, visible, project, limit, mitDateien);
  return c.json({ query: q, results });
});
