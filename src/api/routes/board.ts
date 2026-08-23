// ============================================================
// PATIO — Board für den Besprechungsraum
// ============================================================
//   GET /api/board/heute      → Termine des Tages, über alle Personen
//   GET /api/board/aufgaben   → offene Aufgaben, über alle Personen
//   GET /api/board/projekte   → Projekte mit Fortschritt
//   GET /api/board/woche      → die nächsten sieben Tage
//
// ── Warum es dafür eigene Endpunkte braucht ────────────────────────────────
//
// Weil `dashboard` und `aufgabensystem` auf `c.var.userId` filtern: sie
// beantworten „was habe ICH zu tun". Ein Gerät im Besprechungsraum ist
// niemandem zugewiesen — es sähe überall leere Listen.
//
// Das Board beantwortet die andere Frage: „was ist heute im Haus los". Es
// aggregiert bewusst über alle Personen.
//
// ── Wer darf hier hinein ───────────────────────────────────────────────────
//
// Jedes angemeldete Konto. Die Rolle `praesentation` ist kein Zugangsschlüssel,
// sondern eine Beschränkung — sie darf nichts schreiben (Middleware in
// `server.ts`), sieht keine Beträge (`geld.ts`) und keine Kontaktdaten
// (`personendaten.ts`).
//
// Ein Projektleiter, der die Wochenansicht am eigenen Bildschirm aufmacht,
// sieht dieselben Daten wie das Board — nur eben mit seinen eigenen Rechten.
// Deshalb steht hier der normale Sichtbarkeitsfilter und keine Sonderregel.
// ============================================================

import { Hono } from "hono";
import { getDb } from "../../db/client.js";
import { getVisibleProjectIds, type UserCtx, type Rolle } from "../../data/access.js";
import { alsIso } from "../../data/zeitstempel.js";
import type { AppEnv } from "../server.js";

export const boardRoutes = new Hono<AppEnv>();

function userCtx(c: { var: { userId: string | null; userRole: Rolle } }): UserCtx {
  return { userId: c.var.userId, role: c.var.userRole };
}

/**
 * Baut die Projekt-Bedingung: `"all"` → keine, sonst `= ANY($1::uuid[])`.
 *
 * Ein Board mit leerer Sichtbarkeitsliste zeigt NICHTS — das ist richtig so
 * und nicht dasselbe wie „alles": `ANY('{}')` trifft keine Zeile.
 *
 * ── Warum `werte` eine PARAMETERLISTE ist und nicht die ID-Liste ───────────
 *
 * Beim ersten Bau stand hier `werte: sichtbar` — die IDs selbst. `db.unsafe()`
 * nimmt eine Parameterliste, also wurde jede ID zu einem eigenen Platzhalter
 * ($1, $2, $3 …), während die Abfrage EIN Array in $1 erwartete. Für Admins
 * fiel das nicht auf (leere Liste, Bedingung `TRUE`); für jedes normale Konto
 * kam ein Fehlerobjekt statt einer Liste zurück.
 */
function bedingung(sichtbar: string[] | "all", spalte = "project_id"): { sql: string; werte: unknown[] } {
  if (sichtbar === "all") return { sql: "TRUE", werte: [] };
  return { sql: `${spalte} = ANY($1::uuid[])`, werte: [sichtbar] };
}

/** Heute in der Zeitzone des Büros — nicht in UTC. Ein Board, das um 01:00
 *  schon den nächsten Tag zeigt, ist falsch. */
async function heuteIso(): Promise<string> {
  const { TIMEZONE } = await import("../../config.js");
  const [z] = await getDb()`SELECT to_char(now() AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS t`;
  return String(z.t);
}

// ── Heute ───────────────────────────────────────────────────────────────────
boardRoutes.get("/board/heute", async (c) => {
  const sichtbar = await getVisibleProjectIds(userCtx(c));
  const b = bedingung(sichtbar, "t.project_id");
  const heute = await heuteIso();
  const db = getDb();

  const termine = await db.unsafe(
    `SELECT t.text, t.datum, t.uhrzeit, t.endzeit, t.location, p.name AS projekt, p.projektnummer
       FROM termine t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND t.datum = $${b.werte.length + 1} AND (${b.sql} OR t.project_id IS NULL)
      ORDER BY t.uhrzeit NULLS LAST
      LIMIT 30`,
    [...(b.werte as never[]), heute],
  );

  const bautage = await db.unsafe(
    `SELECT p.name AS projekt, p.projektnummer, b.activities
       FROM bautagebuch b JOIN projects p ON p.id = b.project_id
      WHERE b.entry_date = $${b.werte.length + 1} AND ${b.sql.replace("project_id", "b.project_id")}
      ORDER BY p.name LIMIT 20`,
    [...(b.werte as never[]), heute],
  );

  return c.json({
    datum: heute,
    termine: termine.map((r) => ({
      text: String(r.text),
      uhrzeit: r.uhrzeit ? String(r.uhrzeit) : null,
      endzeit: r.endzeit ? String(r.endzeit) : null,
      ort: r.location ? String(r.location) : null,
      projekt: r.projekt ? String(r.projekt) : null,
      projektnummer: r.projektnummer ? String(r.projektnummer) : null,
    })),
    bautagebuch: bautage.map((r) => ({
      projekt: String(r.projekt),
      projektnummer: r.projektnummer ? String(r.projektnummer) : null,
      taetigkeiten: r.activities ? String(r.activities) : null,
    })),
  });
});

// ── Offene Aufgaben, über alle Personen ─────────────────────────────────────
boardRoutes.get("/board/aufgaben", async (c) => {
  const sichtbar = await getVisibleProjectIds(userCtx(c));
  const b = bedingung(sichtbar, "t.project_id");
  const db = getDb();

  const zeilen = await db.unsafe(
    `SELECT t.text, t.date, t.rang, tm.name AS zugewiesen, p.name AS projekt, p.projektnummer
       FROM tasks t
       LEFT JOIN team_members tm ON tm.id = t.assignee_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status <> 'done' AND t.deleted_at IS NULL AND (${b.sql} OR t.project_id IS NULL)
      ORDER BY t.rang, t.date NULLS LAST
      LIMIT 40`,
    b.werte as never[],
  );

  return c.json(
    zeilen.map((r) => ({
      text: String(r.text),
      faellig: r.date ? String(r.date) : null,
      rang: Number(r.rang ?? 3),
      zugewiesen: r.zugewiesen ? String(r.zugewiesen) : null,
      projekt: r.projekt ? String(r.projekt) : null,
      projektnummer: r.projektnummer ? String(r.projektnummer) : null,
    })),
  );
});

// ── Projekte ────────────────────────────────────────────────────────────────
boardRoutes.get("/board/projekte", async (c) => {
  const sichtbar = await getVisibleProjectIds(userCtx(c));
  const b = bedingung(sichtbar, "p.id");
  const db = getDb();

  // Bewusst OHNE Budget und Honorar: die stehen im Portfolio, und das Board
  // hängt in einem Raum, in dem auch Bauherren sitzen. Der Geld-Filter würde
  // sie ohnehin entfernen — sie hier gar nicht erst abzufragen ist ehrlicher
  // als sich auf den Filter zu verlassen.
  const zeilen = await db.unsafe(
    `SELECT p.name, p.projektnummer, p.status, p.phase, p.standort,
            (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done' AND t.deleted_at IS NULL)::int AS offen
       FROM projects p
      WHERE p.deleted_at IS NULL AND ${b.sql}
      ORDER BY p.name
      LIMIT 40`,
    b.werte as never[],
  );

  return c.json(
    zeilen.map((r) => ({
      name: String(r.name),
      projektnummer: r.projektnummer ? String(r.projektnummer) : null,
      status: r.status ? String(r.status) : null,
      phase: r.phase ? String(r.phase) : null,
      standort: r.standort ? String(r.standort) : null,
      offeneAufgaben: Number(r.offen ?? 0),
    })),
  );
});

// ── Die nächsten sieben Tage ────────────────────────────────────────────────
boardRoutes.get("/board/woche", async (c) => {
  const sichtbar = await getVisibleProjectIds(userCtx(c));
  const b = bedingung(sichtbar, "t.project_id");
  const heute = await heuteIso();
  const db = getDb();

  const zeilen = await db.unsafe(
    `SELECT t.text, t.datum, t.uhrzeit, t.location, p.name AS projekt, p.projektnummer
       FROM termine t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL
        AND t.datum >= $${b.werte.length + 1}
        AND t.datum < ($${b.werte.length + 1}::date + 7)::text
        AND (${b.sql} OR t.project_id IS NULL)
      ORDER BY t.datum, t.uhrzeit NULLS LAST
      LIMIT 60`,
    [...(b.werte as never[]), heute],
  );

  // Nach Tag gruppiert — das Board zeigt sieben Spalten, keine flache Liste.
  const tage = new Map<string, { text: string; uhrzeit: string | null; projekt: string | null }[]>();
  for (const r of zeilen) {
    const tag = String(r.datum);
    if (!tage.has(tag)) tage.set(tag, []);
    tage.get(tag)!.push({
      text: String(r.text),
      uhrzeit: r.uhrzeit ? String(r.uhrzeit) : null,
      projekt: r.projekt ? String(r.projekt) : null,
    });
  }
  return c.json({
    von: heute,
    tage: [...tage.entries()].map(([datum, termine]) => ({ datum, termine })),
    stand: alsIso(new Date()),
  });
});
