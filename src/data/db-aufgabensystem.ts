// ============================================================
// PATIO — Aufgabensystem: die rechnende Schicht
// ============================================================
// Umsetzung von „Aufgabensystem — Prinzip und Spezifikation", Baustufe 1.
//
// Der Zweck dieser Datei in einem Satz: **nicht Aufgaben verwalten, sondern
// die Auswahl belastbar machen.** Das Verwalten kann `db-tasks.ts` längst.
// Was fehlte, ist die Schicht darüber — die rechnet und Grenzen sichtbar
// macht.
//
// ── Warum das eine eigene Datei ist ─────────────────────────────────────────
//
// `db-tasks.ts` beantwortet „welche Aufgaben gibt es". Hier geht es um
// „welche fünf nehme ich heute" — andere Fragen, andere Abfragen, andere
// Lebensdauer. In `db-tasks` gemischt wäre beides schwerer zu lesen und die
// Grenzwerte lägen mitten im CRUD.
//
// ── Das durchgängige Prinzip ────────────────────────────────────────────────
//
// **Sichtbar machen, bestätigen lassen, nie blockieren.** Keine Funktion hier
// verweigert etwas. Sie liefern Zahlen; ob eine Grenze überschritten wird,
// steht in der Antwort, und die Oberfläche verlangt dafür eine bewusste
// Bestätigung. Eine harte Sperre wird nach der zweiten Umgehung zur
// Gewohnheit — und dann ist das ganze System entwertet.
//
// ── Rechte ──────────────────────────────────────────────────────────────────
//
// Alle Abfragen nehmen `sichtbareProjekte` entgegen und wenden es an, wie es
// in diesem Projekt üblich ist: die ROUTE ermittelt die Liste, das Repository
// wendet sie nur an (siehe `src/data/access.ts`). Aufgaben OHNE Projekt sind
// persönlich und gehören ihrem Ersteller — deshalb steht in jeder Abfrage
// zusätzlich `created_by`.
// ============================================================

import { getDb } from "../db/client.js";
import { rowToTask, TASK_SELECT } from "./db-tasks.js";
import { RANG_GRENZEN, type Task } from "./types.js";

/** Eine Spalte der Matrix. */
export interface MatrixSpalte {
  rang: 1 | 2 | 3 | 4;
  /** Anzahl offener Aufgaben in diesem Rang. */
  anzahl: number;
  /** Summe der geschätzten Aufwände in Minuten. Aufgaben ohne Schätzung
   *  zählen mit 0 — die Zahl ist damit eine Untergrenze, nicht die Wahrheit.
   *  `ohneSchaetzung` sagt, wie viele fehlen. */
  summeMin: number;
  ohneSchaetzung: number;
  /** Nur bei Rang 1 gesetzt: Grenze überschritten? */
  ueberGrenze?: boolean;
}

export interface Matrix {
  spalten: MatrixSpalte[];
  /** Die Grenzwerte mitliefern, damit die Oberfläche sie nicht doppelt
   *  vorhalten muss und beide nie auseinanderlaufen. */
  grenzen: typeof RANG_GRENZEN;
}

export interface TagesplanBudget {
  /** Summe der geschätzten Aufwände im Tagesplan, in Minuten. */
  belegtMin: number;
  /** Das Tagesbudget, in Minuten (5 Fokusstunden). */
  budgetMin: number;
  /** Anteil in Prozent, gerundet. Kann über 100 gehen — das ist der Punkt. */
  auslastung: number;
  /** Anteil, der auf Rang 3 entfällt. Eigener Abschnitt im Balken. */
  rang3Min: number;
  /** Ist die Rang-3-Grenze überschritten? */
  rang3UeberGrenze: boolean;
  /** Ist mindestens eine Rang-2-Aufgabe dabei? Fehlt sie, erinnert die
   *  Oberfläche einmal täglich daran — die Spezifikation macht das zur
   *  Pflicht, weil sonst nur noch Dringendes abgearbeitet wird. */
  hatRang2: boolean;
  /** Wie viele Aufgaben im Plan haben gar keine Schätzung? Ohne diese Zahl
   *  liest sich ein zu niedriger Balken wie „noch viel Platz". */
  ohneSchaetzung: number;
}

/** Was eine Abfrage über die Sichtbarkeit mitbekommt. */
export interface Sichtbarkeit {
  /** Sichtbare Projekt-IDs, oder `"all"` für Admins. */
  sichtbareProjekte: string[] | "all";
  /** users.id des Fragenden — für die persönlichen Aufgaben ohne Projekt
   *  und für den eigenen Tagesplan. */
  benutzerId: string;
}

/** Baut die WHERE-Bedingung für „darf ich das sehen".
 *  Bewusst als Fragment mit Parametern, nicht als String-Verkettung.
 *
 *  `ab` sagt, bei welcher Parameternummer das Fragment anfangen darf. Ohne
 *  diesen Parameter müsste jede Abfrage, die noch eigene Werte mitbringt, die
 *  Nummerierung im Kopf nachrechnen — und die zweite, die das tut, rechnet
 *  falsch. */
function sichtbarkeitsBedingung(s: Sichtbarkeit, ab = 1): { sql: string; werte: unknown[] } {
  if (s.sichtbareProjekte === "all") {
    // Admin: alles, auch fremde persönliche Aufgaben. Das ist dieselbe
    // Entscheidung wie überall sonst im System (siehe Papierkorb, Suche).
    return { sql: "TRUE", werte: [] };
  }
  // Projektaufgaben nur aus sichtbaren Projekten; Aufgaben ohne Projekt nur
  // die eigenen. Ohne den zweiten Teil verschwänden die persönlichen
  // Aufgaben komplett — `project_id = ANY(...)` ist bei NULL nicht wahr.
  return {
    sql: `(t.project_id = ANY($${ab}::uuid[]) OR (t.project_id IS NULL AND t.created_by = $${ab + 1}::uuid))`,
    werte: [s.sichtbareProjekte, s.benutzerId],
  };
}

/** Gemeinsamer Filter: offen, nicht im Papierkorb, nicht auf Wiedervorlage.
 *  `status <> 'done'` statt `= 'offen'`, weil es auch `inArbeit` gibt. */
const OFFEN = "t.status <> 'done' AND t.deleted_at IS NULL";

export const dbAufgabensystem = {
  /**
   * Die Matrix über ALLE sichtbaren Projekte — der Arbeitsblick am Morgen.
   *
   * Bewusst projektübergreifend: die Grenzen gelten insgesamt, nicht je
   * Baustelle. Wer den Tag aus der Projektansicht füllt, füllt ihn dreimal.
   */
  async matrix(s: Sichtbarkeit): Promise<Matrix> {
    const db = getDb();
    const b = sichtbarkeitsBedingung(s);
    const sql = `
      SELECT t.rang,
             count(*)::int                                            AS anzahl,
             COALESCE(sum(t.aufwand_min), 0)::int                     AS summe_min,
             count(*) FILTER (WHERE t.aufwand_min IS NULL)::int        AS ohne_schaetzung
        FROM tasks t
       WHERE ${OFFEN} AND ${b.sql}
       GROUP BY t.rang
    `;
    const rows = b.werte.length ? await db.unsafe(sql, b.werte as never[]) : await db.unsafe(sql);

    const proRang = new Map<number, { anzahl: number; summeMin: number; ohneSchaetzung: number }>();
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      proRang.set(Number(row.rang), {
        anzahl: Number(row.anzahl),
        summeMin: Number(row.summe_min),
        ohneSchaetzung: Number(row.ohne_schaetzung),
      });
    }

    // Immer alle vier Spalten liefern, auch leere — eine fehlende Spalte
    // wäre in der Oberfläche eine Lücke statt einer Null.
    const spalten: MatrixSpalte[] = ([1, 2, 3, 4] as const).map((rang) => {
      const d = proRang.get(rang) ?? { anzahl: 0, summeMin: 0, ohneSchaetzung: 0 };
      return {
        rang,
        ...d,
        ...(rang === 1 ? { ueberGrenze: d.anzahl > RANG_GRENZEN.maxRang1 } : {}),
      };
    });

    return { spalten, grenzen: RANG_GRENZEN };
  },

  /**
   * Der Tagesplan des Fragenden, mit dem gerechneten Budget.
   *
   * `tagesplan_von = benutzerId` ist der Kern: der Plan ist persönlich. Auf
   * einem Server mit acht Arbeitsplätzen wäre ein gemeinsamer Tagesplan
   * unbrauchbar — der eine räumte dem anderen den Tag ab.
   */
  async tagesplanBudget(s: Sichtbarkeit): Promise<TagesplanBudget> {
    const db = getDb();
    const [row] = await db`
      SELECT COALESCE(sum(aufwand_min), 0)::int                                   AS belegt,
             COALESCE(sum(aufwand_min) FILTER (WHERE rang = 3), 0)::int           AS rang3,
             count(*) FILTER (WHERE rang = 2)::int                                AS anzahl_rang2,
             count(*) FILTER (WHERE aufwand_min IS NULL)::int                     AS ohne_schaetzung
        FROM tasks
       WHERE im_tagesplan = true
         AND tagesplan_von = ${s.benutzerId}
         AND status <> 'done'
         AND deleted_at IS NULL
    `;
    const belegtMin = Number(row?.belegt ?? 0);
    const rang3Min = Number(row?.rang3 ?? 0);
    return {
      belegtMin,
      budgetMin: RANG_GRENZEN.tagesbudgetMin,
      auslastung: Math.round((belegtMin / RANG_GRENZEN.tagesbudgetMin) * 100),
      rang3Min,
      rang3UeberGrenze: rang3Min > RANG_GRENZEN.maxRang3Min,
      hatRang2: Number(row?.anzahl_rang2 ?? 0) > 0,
      ohneSchaetzung: Number(row?.ohne_schaetzung ?? 0),
    };
  },

  /**
   * Nimmt eine Aufgabe in den Tagesplan oder heraus.
   *
   * Liefert `false`, wenn es die Aufgabe nicht gibt — die Rechteprüfung
   * macht die Route, wie überall in diesem Projekt.
   */
  async setzeTagesplan(id: string, benutzerId: string, drin: boolean): Promise<boolean> {
    const db = getDb();
    // `updated_at` wird bewusst NICHT angefasst: die Auswahl für heute ist
    // keine Änderung an der Aufgabe. Sonst stünde jede Morgenauswahl in der
    // Aktivität und verdeckte dort die echten Änderungen.
    const rows = await db`
      UPDATE tasks
         SET im_tagesplan = ${drin},
             tagesplan_von = ${drin ? benutzerId : null}
       WHERE id = ${id} AND deleted_at IS NULL
       RETURNING id
    `;
    return rows.length > 0;
  },

  /**
   * Die Aufgaben im Tagesplan des Fragenden — nach Rang, dann nach Aufwand.
   *
   * Warum die Route das nicht aus `GET /tasks` filtert: dort steht zwar
   * `tagesplanVon`, aber die Oberflaeche kennt die eigene `users.id` nicht.
   * Sie muesste sie erst irgendwo herholen und dann selbst vergleichen — ein
   * Filter, der bei jedem zweiten Aufrufer anders falsch waere. Hier weiss
   * der Server ohnehin, wer fragt.
   *
   * `sichtbareProjekte` wird trotzdem angewandt: eine Aufgabe kann nach der
   * Auswahl aus einem Projekt herausfallen, das man nicht mehr sehen darf.
   */
  async tagesplanAufgaben(s: Sichtbarkeit): Promise<Task[]> {
    const db = getDb();
    // Der eigene Benutzer ist $1, die Sichtbarkeit faengt darum bei $2 an.
    const b = sichtbarkeitsBedingung(s, 2);
    const sql = `
      ${TASK_SELECT}
       WHERE t.im_tagesplan = true
         AND t.tagesplan_von = $1::uuid
         AND ${OFFEN}
         AND ${b.sql}
       ORDER BY t.rang ASC, t.aufwand_min ASC NULLS LAST, t.created_at ASC
    `;
    const werte = [s.benutzerId, ...b.werte];
    const rows = await db.unsafe(sql, werte as never[]);
    return rows.map((r) => rowToTask(r as Record<string, unknown>));
  },

  /**
   * Der Tageswechsel: `im_tagesplan` für alle zurücksetzen.
   *
   * Keine Rückstandsliste, keine Übertragung — der neue Tag beginnt leer.
   * Nicht Erledigtes fällt in sein Projekt zurück und gilt ausdrücklich
   * NICHT als Rückstand. Genau das hält das System glaubwürdig: eine
   * wachsende Liste von „gestern nicht geschafft" ist der schnellste Weg,
   * ein Aufgabensystem aufzugeben.
   *
   * Liefert die Anzahl zurückgesetzter Aufgaben (fürs Protokoll).
   */
  async tagesplanZuruecksetzen(): Promise<number> {
    const db = getDb();
    const rows = await db`
      UPDATE tasks
         SET im_tagesplan = false, tagesplan_von = NULL
       WHERE im_tagesplan = true
       RETURNING id
    `;
    return rows.length;
  },
};
