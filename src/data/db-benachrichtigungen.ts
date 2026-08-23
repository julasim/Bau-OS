// ============================================================
// PATIO — Benachrichtigungen (Migration 058)
// ============================================================
//
// Der Unterschied zur Aktivität: die Aktivität sagt „im Büro ist etwas
// passiert", eine Benachrichtigung sagt „DIR wurde etwas zugewiesen". Das
// erste ist eine Liste, das zweite eine Adressierung — und nur die zweite
// darf man verpassen.
// ============================================================

import { getDb } from "../db/client.js";
import { alsIso, alsIsoOderNull } from "./zeitstempel.js";

/** Woraus eine Meldung entsteht. Jeder Anlass lässt sich je Person
 *  abschalten (`UiPreferences.benachrichtigungen`). */
export type Anlass = "aufgabe-zugewiesen" | "termin-teilnahme" | "besprechung-teilnahme" | "aufgabe-faellig";

export interface Benachrichtigung {
  id: string;
  anlass: Anlass;
  titel: string;
  ausloeser: string | null;
  zielTyp: string | null;
  zielId: string | null;
  projectId: string | null;
  projectName: string | null;
  erstelltAm: string;
  gelesenAm: string | null;
}

export interface NeueBenachrichtigung {
  empfaengerId: string;
  anlass: Anlass;
  titel: string;
  ausloeser?: string | null;
  zielTyp?: string | null;
  zielId?: string | null;
  projectId?: string | null;
}

/**
 * Ordnet jedem Anlass die Einstellung zu, die ihn abschaltet.
 *
 * Die Einstellungen heißen `termine`, `tasks`, `meetings`, `bautagebuch` —
 * sie stammen aus der Zeit, in der die Meldungen per Telegram hinausgingen
 * (siehe `db-ui-preferences.ts`). Die Struktur passt, die Zuordnung steht
 * hier statt in den Aufrufern: sonst hätte jede Schreibstelle ihre eigene
 * Meinung darüber, welcher Schalter greift.
 */
const SCHALTER: Record<Anlass, "termine" | "tasks" | "meetings" | "bautagebuch"> = {
  "aufgabe-zugewiesen": "tasks",
  "aufgabe-faellig": "tasks",
  "termin-teilnahme": "termine",
  "besprechung-teilnahme": "meetings",
};

function zuBenachrichtigung(r: Record<string, unknown>): Benachrichtigung {
  return {
    id: String(r.id),
    anlass: String(r.anlass) as Anlass,
    titel: String(r.titel),
    ausloeser: r.ausloeser ? String(r.ausloeser) : null,
    zielTyp: r.ziel_typ ? String(r.ziel_typ) : null,
    zielId: r.ziel_id ? String(r.ziel_id) : null,
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    erstelltAm: alsIso(r.erstellt_am),
    gelesenAm: alsIsoOderNull(r.gelesen_am),
  };
}

const SELECT = `
  SELECT b.id, b.anlass, b.titel, b.ausloeser, b.ziel_typ, b.ziel_id, b.project_id,
         b.erstellt_am, b.gelesen_am, p.name AS project_name
    FROM benachrichtigungen b
    LEFT JOIN projects p ON p.id = b.project_id`;

export const dbBenachrichtigungen = {
  /**
   * Legt Meldungen an — für mehrere Empfänger auf einmal.
   *
   * ── Warum das Anlegen die Einstellungen selbst prüft ─────────────────────
   *
   * Weil sonst jede Schreibstelle daran denken müsste, und die vergisst es
   * irgendwann. Hier steht die Prüfung einmal, und eine neue Schreibstelle
   * bekommt sie geschenkt.
   *
   * Empfänger ohne Konto, doppelte Empfänger und der Auslöser selbst fallen
   * heraus: eine Meldung „Sie haben sich selbst etwas zugewiesen" ist Lärm.
   */
  async anlegen(meldungen: NeueBenachrichtigung[], ausloeserId?: string | null): Promise<number> {
    const gefiltert = meldungen.filter((m) => m.empfaengerId && m.empfaengerId !== ausloeserId);
    if (gefiltert.length === 0) return 0;

    const db = getDb();
    // Die Einstellungen aller betroffenen Konten in EINER Abfrage — sonst
    // wäre jede Zuweisung an ein fünfköpfiges Team fünf Rundreisen.
    const ids = [...new Set(gefiltert.map((m) => m.empfaengerId))];
    const zeilen = await db`SELECT id, ui_preferences FROM users WHERE id = ANY(${ids}::uuid[])`;
    const prefs = new Map(zeilen.map((z) => [String(z.id), (z.ui_preferences ?? {}) as Record<string, unknown>]));

    let geschrieben = 0;
    for (const m of gefiltert) {
      const p = prefs.get(m.empfaengerId);
      if (!p) continue; // Kein Konto mit dieser ID.
      // Beide Schlüssel lesen: `telegramNotifications` ist der alte Name und
      // steht in den Präferenzen jedes Kontos, das vor der Umbenennung
      // angelegt wurde.
      const schalter = ((p.benachrichtigungen ?? p.telegramNotifications ?? {}) as Record<string, unknown>)[
        SCHALTER[m.anlass]
      ];
      // Voreinstellung ist AN: eine Meldung, die niemand bestellt hat, ist
      // besser als eine verpasste Zuweisung. Nur ein ausdrückliches `false`
      // schaltet ab.
      if (schalter === false) continue;

      await db`
        INSERT INTO benachrichtigungen (empfaenger_id, anlass, titel, ausloeser, ziel_typ, ziel_id, project_id)
        VALUES (${m.empfaengerId}::uuid, ${m.anlass}, ${m.titel}, ${m.ausloeser ?? null},
                ${m.zielTyp ?? null}, ${m.zielId ?? null}, ${m.projectId ?? null})`;
      geschrieben++;
    }
    return geschrieben;
  },

  async liste(empfaengerId: string, nurUngelesen = false, limit = 50): Promise<Benachrichtigung[]> {
    const db = getDb();
    const rows = nurUngelesen
      ? await db.unsafe(
          `${SELECT} WHERE b.empfaenger_id = $1 AND b.gelesen_am IS NULL ORDER BY b.erstellt_am DESC LIMIT $2`,
          [empfaengerId, limit],
        )
      : await db.unsafe(`${SELECT} WHERE b.empfaenger_id = $1 ORDER BY b.erstellt_am DESC LIMIT $2`, [
          empfaengerId,
          limit,
        ]);
    return rows.map((r) => zuBenachrichtigung(r as Record<string, unknown>));
  },

  async zaehleUngelesen(empfaengerId: string): Promise<number> {
    const db = getDb();
    const [z] = await db`
      SELECT count(*)::int AS n FROM benachrichtigungen
       WHERE empfaenger_id = ${empfaengerId}::uuid AND gelesen_am IS NULL`;
    return Number(z?.n ?? 0);
  },

  /** Markiert eine Meldung als gelesen. `false`, wenn sie einem anderen
   *  gehört — der Empfänger steht in der Bedingung, nicht in einer separaten
   *  Prüfung davor. */
  async alsGelesen(id: string, empfaengerId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db`
      UPDATE benachrichtigungen SET gelesen_am = now()
       WHERE id = ${id}::uuid AND empfaenger_id = ${empfaengerId}::uuid AND gelesen_am IS NULL
       RETURNING id`;
    return rows.length > 0;
  },

  async alleAlsGelesen(empfaengerId: string): Promise<number> {
    const db = getDb();
    const rows = await db`
      UPDATE benachrichtigungen SET gelesen_am = now()
       WHERE empfaenger_id = ${empfaengerId}::uuid AND gelesen_am IS NULL
       RETURNING id`;
    return rows.length;
  },

  /**
   * Räumt Gelesenes weg, das älter ist als `tage`.
   *
   * Ungelesenes bleibt — eine Meldung, die niemand gesehen hat, verschwindet
   * nicht, nur weil sie alt ist. Genau das ist ihr Sinn gegenüber dem
   * flüchtigen Live-Kanal.
   */
  async aufraeumen(tage: number): Promise<number> {
    if (!Number.isFinite(tage) || tage <= 0) return 0;
    const db = getDb();
    const rows = await db`
      DELETE FROM benachrichtigungen
       WHERE gelesen_am IS NOT NULL AND gelesen_am < now() - make_interval(days => ${Math.floor(tage)})
       RETURNING id`;
    return rows.length;
  },
};
