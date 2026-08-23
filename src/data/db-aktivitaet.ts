// ============================================================
// PATIO — Aktivität: „was hat sich zuletzt getan"
// ============================================================
// Auf einem Firmenserver arbeiten mehrere Leute am selben Bestand. Die Frage
// „was ist seit gestern passiert?" ist damit alltäglich — und heute nur zu
// beantworten, indem man jeden Reiter einzeln durchgeht.
//
// ── Warum keine eigene Tabelle ──────────────────────────────────────────────
//
// Jede Datenart trägt bereits `updated_at`. Ein zusätzliches Ereignisprotokoll
// bräuchte einen Schreibpfad an JEDER Änderungsstelle — und genau dort geht so
// etwas kaputt: eine neue Route vergisst den Eintrag, und der Feed behauptet,
// es sei nichts passiert. Abgeleitet kann er nicht divergieren, und er
// funktioniert rückwirkend für den gesamten Bestand.
//
// Der Preis, offen gesagt: es ist kein Verlauf. Man sieht den LETZTEN Stand je
// Datensatz, nicht jede einzelne Änderung — wer eine Notiz dreimal bearbeitet,
// erscheint einmal. Für „was hat sich getan" ist das genau richtig; für „wer
// hat wann was geändert" gibt es das Audit-Log (Migration 018), das
// Anmeldungen und Kontenänderungen protokolliert.
//
// Zweiter Preis: es gibt kein `updated_by`. Die Tabellen führen nur
// `created_by`. Der Feed nennt deshalb, wer den Datensatz ANGELEGT hat, und
// sagt das auch so — eine erfundene Zuordnung wäre schlimmer als keine.
// ============================================================

import { getDb } from "../db/client.js";

export interface AktivitaetsEintrag {
  /** Datenart — dieselben Bezeichner wie im Live-Kanal. */
  typ: "note" | "task" | "termin" | "meeting" | "bautagebuch" | "phase" | "invoice" | "entscheidung" | "file";
  id: string;
  titel: string;
  projectId: string | null;
  projectName: string | null;
  /** Projektnummer des zugehoerigen Projekts (Migration 052) — die Kennung,
   *  unter der es im Haus gefuehrt wird. Steht neben dem Namen, damit jede
   *  Ansicht sie zeigen kann, ohne sie einzeln nachzuschlagen. */
  projektnummer?: string | null;
  /** Zuletzt geändert. */
  geaendertAm: string;
  /** Wer den Datensatz ANGELEGT hat — nicht, wer zuletzt gespeichert hat.
   *  Ein `updated_by` führen die Tabellen nicht. */
  angelegtVon: string | null;
}

/** Ein Zweig der UNION je Datenart.
 *
 *  `NULL::uuid AS created_by` bei Dateien, Phasen und Rechnungen: diese
 *  Tabellen führen die Spalte nicht. Der Typ muss trotzdem in jedem Zweig
 *  derselbe sein, sonst weist Postgres die UNION zurück. */
const ZWEIGE = [
  `SELECT 'note' AS typ, n.id::text, COALESCE(NULLIF(n.title,''), 'Notiz') AS titel,
          n.project_id, n.updated_at, n.created_by FROM notes n`,
  `SELECT 'task', t.id::text, COALESCE(NULLIF(t.text,''), 'Aufgabe'),
          t.project_id, t.updated_at, t.created_by FROM tasks t`,
  `SELECT 'termin', te.id::text, COALESCE(NULLIF(te.text,''), 'Termin'),
          te.project_id, te.updated_at, te.created_by FROM termine te`,
  `SELECT 'meeting', m.id::text, COALESCE(NULLIF(m.title,''), 'Besprechung'),
          m.project_id, m.updated_at, m.created_by FROM meetings m`,
  `SELECT 'bautagebuch', b.id::text, 'Bautagebuch ' || to_char(b.entry_date, 'DD.MM.YYYY'),
          b.project_id, b.updated_at, b.created_by FROM bautagebuch b`,
  `SELECT 'phase', ph.id::text, COALESCE(NULLIF(ph.name,''), 'Leistungsphase'),
          ph.project_id, ph.updated_at, NULL::uuid FROM project_phases ph`,
  `SELECT 'invoice', i.id::text, 'Rechnung ' || COALESCE(NULLIF(i.nummer,''), '(ohne Nummer)'),
          i.project_id, i.updated_at, NULL::uuid FROM project_invoices i`,
  `SELECT 'entscheidung', e.id::text, COALESCE(NULLIF(e.titel,''), 'Entscheidung'),
          e.project_id, e.updated_at, e.created_by FROM entscheidungen e`,
  `SELECT 'file', f.id::text, COALESCE(NULLIF(f.filename,''), 'Datei'),
          f.project_id, f.updated_at, NULL::uuid FROM files f`,
];

export const dbAktivitaet = {
  /** Zuletzt geänderte Datensätze, neueste zuerst.
   *
   *  `sichtbareProjekte` ist derselbe Maßstab wie überall: `"all"` für
   *  Admins, sonst die Liste der sichtbaren Projekt-IDs. Datensätze OHNE
   *  Projekt erscheinen nur für Admins — ihre Sichtbarkeit hängt an keinem
   *  Projekt, und sie einfach durchzulassen wäre ein Loch. */
  async list(sichtbareProjekte: string[] | "all", limit = 50): Promise<AktivitaetsEintrag[]> {
    const db = getDb();
    const grenze = Math.min(Math.max(limit, 1), 200);

    const eingeschraenkt = Array.isArray(sichtbareProjekte);
    if (eingeschraenkt && sichtbareProjekte.length === 0) return [];

    // Die Projektbedingung steht in JEDEM Zweig, nicht nur außen: sonst
    // sammelte Postgres erst den gesamten Bestand ein und filterte danach.
    //
    // Datensätze OHNE Projekt fallen für eingeschränkte Konten dabei heraus —
    // `NULL = ANY(…)` ist nicht wahr. Das ist beabsichtigt: ihre Sichtbarkeit
    // hängt an keinem Projekt, sie einfach durchzulassen wäre ein Loch.
    const wo = eingeschraenkt ? `WHERE project_id = ANY($1::uuid[])` : "";

    const roh = ZWEIGE.map(
      (z) => `SELECT * FROM (${z}) AS q(typ, id, titel, project_id, updated_at, created_by) ${wo}`,
    ).join(" UNION ALL ");

    // Datensätze aus Projekten im Papierkorb (Migration 044) bleiben draußen.
    const sql = `
      SELECT a.*, p.name AS project_name, p.projektnummer AS project_nummer, u.username AS angelegt_von
        FROM (${roh}) a
        LEFT JOIN projects p ON p.id = a.project_id
        LEFT JOIN users u ON u.id = a.created_by
       WHERE a.project_id IS NULL OR p.deleted_at IS NULL
       -- Zweitkriterium ist PFLICHT (Begruendung im Kommentar ueber der Funktion).
       ORDER BY a.updated_at DESC, a.id DESC
       LIMIT ${grenze}
    `;

    const rows = eingeschraenkt ? await db.unsafe(sql, [sichtbareProjekte as unknown as string]) : await db.unsafe(sql);
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        typ: String(row.typ) as AktivitaetsEintrag["typ"],
        id: String(row.id),
        titel: String(row.titel),
        projectId: row.project_id ? String(row.project_id) : null,
        projectName: row.project_name ? String(row.project_name) : null,
        projektnummer: row.project_nummer ? String(row.project_nummer) : null,
        geaendertAm: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ""),
        angelegtVon: row.angelegt_von ? String(row.angelegt_von) : null,
      };
    });
  },
};
