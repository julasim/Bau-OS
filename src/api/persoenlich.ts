// ============================================================
// PATIO — Persoenliche Datensaetze: gehoert der mir?
// ============================================================
//
// ── Der Fehler, gegen den diese Datei steht ─────────────────────────────────
//
// Ein Datensatz OHNE Projekt ist persoenlich. Ob er mir gehoert, beantworten
// zwei Fragen: habe ich ihn angelegt, oder ist er mir zugewiesen?
//
// Die zweite ist die Falle. `tasks.assignee_id` und `termine.assignee_ids`
// zeigen auf **team_members.id** (Migrationen 007/013), `ctx.userId` ist eine
// **users.id** — zwei disjunkte UUID-Raeume. Ein Direktvergleich trifft nie.
// Die Bruecke ist `team_members.user_id`.
//
// `tasks.ts` und `termine.ts` machen das seit laengerem richtig, jeweils mit
// einer eigenen Kopie der Logik. Im Dashboard stand der Direktvergleich noch:
// `t.assigneeId === me`. Folge — die Startseite zeigte „0 offene Aufgaben",
// waehrend die Aufgabenliste welche auflistete. Kein Fehler, keine Meldung,
// nur eine Zahl, die immer null war.
//
// Eine dritte Kopie waere eine dritte Gelegenheit fuer denselben Fehler.
// Deshalb hier, an einer Stelle.
// ============================================================

import { teamRepo } from "../data/index.js";
import type { UserCtx } from "../data/access.js";

/** Ein Datensatz, wie ihn die Zugehoerigkeitspruefung braucht. */
export interface PersoenlicherDatensatz {
  createdById?: string | null;
  assigneeId?: string | null;
  assigneeIds?: string[] | null;
}

/**
 * Baut einen Pruefer fuer EINEN Aufruf (eine Liste, eine Anfrage).
 *
 * ── Warum ein Pruefer und keine Funktion ────────────────────────────────────
 *
 * Weil derselbe Test ueber viele Zeilen laeuft und jede Aufloesung sonst ein
 * eigener Datenbankzugriff waere. Der Pruefer merkt sich, was er schon weiss.
 *
 * Zusaetzlich greift `uq_team_members_user_id` (Migration 013): je Konto gibt
 * es hoechstens EIN Team-Mitglied. Sobald das eigene gefunden ist, kann jede
 * andere Zuweisung nur noch fremd sein — dann braucht es gar keine Abfrage
 * mehr.
 */
export function gehoertMirPruefer(ctx: UserCtx): (d: PersoenlicherDatensatz) => Promise<boolean> {
  const bekannt = new Map<string, boolean>();
  let eigenesMitglied: string | null = null;

  const zugewiesen = async (id: string | null | undefined): Promise<boolean> => {
    if (!id || !ctx.userId) return false;
    if (eigenesMitglied) return id === eigenesMitglied;
    const gemerkt = bekannt.get(id);
    if (gemerkt !== undefined) return gemerkt;
    const mitglied = await teamRepo.get(id);
    const meins = !!mitglied?.userId && mitglied.userId === ctx.userId;
    bekannt.set(id, meins);
    if (meins) eigenesMitglied = id;
    return meins;
  };

  return async (d) => {
    if (!ctx.userId) return false;
    // Der Ersteller-Vergleich steht zuerst: er kommt ohne Datenbank aus.
    if (d.createdById && d.createdById === ctx.userId) return true;
    if (await zugewiesen(d.assigneeId)) return true;
    for (const id of d.assigneeIds ?? []) {
      if (await zugewiesen(id)) return true;
    }
    return false;
  };
}

/** Einzelfall-Variante fuer Routen, die genau einen Datensatz pruefen. */
export function gehoertMir(ctx: UserCtx, d: PersoenlicherDatensatz): Promise<boolean> {
  return gehoertMirPruefer(ctx)(d);
}
