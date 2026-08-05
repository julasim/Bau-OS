import { Hono } from "hono";
import { searchRepo } from "../../data/index.js";
import { getVisibleProjectIds, type UserCtx } from "../../data/access.js";
import type { AppEnv } from "../server.js";

export const searchRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: "admin" | "user" } }): UserCtx {
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

  const project = c.req.query("project") ?? null;
  // Rohwert durchreichen: Vorgabe und Obergrenze legt das Repo fest (eine
  // Stelle fuer alle Aufrufer). `Number("")` waere 0 und `Number(undefined)`
  // NaN — beides faengt clampLimit() dort ab und faellt auf die Vorgabe
  // zurueck, genauso wie negative Werte, die frueher still Treffer
  // verschluckten.
  const limit = Number(c.req.query("limit"));
  const visible = await getVisibleProjectIds(userCtx(c));

  const results = await searchRepo.search(q, visible, project, limit);
  return c.json({ query: q, results });
});
