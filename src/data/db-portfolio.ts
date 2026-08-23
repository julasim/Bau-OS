// ============================================================
// PATIO — Portfolio-Cockpit-Repository (DB-Backend)
// ============================================================
// Aggregiert je Projekt die PM-Kennzahlen fuer die projektuebergreifende
// Leitungssicht. Die Ampel (health) ist eine serverseitige Heuristik aus
// Frist-Status + Budget-Health + offenen Hoch-Prio-Aufgaben.
// DB-only.
// ============================================================

import { getDb } from "../db/client.js";
import { listPhasesForProjects, weightedProgress } from "./db-phases.js";
import type { PortfolioEntry, PortfolioRepository, ProjectPhase } from "./types.js";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export const dbPortfolio: PortfolioRepository = {
  async list(visibleProjectIds) {
    const db = getDb();

    // Projekt-Grunddaten (gefiltert auf Sichtbarkeit).
    // `deleted_at IS NULL` in BEIDEN Zweigen. Es fehlte hier ganz — seit
    // Migration 044 loescht PATIO nur noch weich, und das Portfolio-Cockpit
    // zeigte darum weiterhin Projekte, die im Papierkorb liegen. Betroffen war
    // nicht nur die Verwaltung: `"all"` liefert `access.ts` auch dann, wenn
    // das Repository kein `listVisibleProjectIds` hat.
    const projects =
      visibleProjectIds === "all"
        ? await db`SELECT id, name, projektnummer, status, budget FROM projects WHERE deleted_at IS NULL ORDER BY name`
        : visibleProjectIds.length === 0
          ? []
          : await db`SELECT id, name, projektnummer, status, budget FROM projects WHERE id = ANY(${visibleProjectIds}::uuid[]) AND deleted_at IS NULL ORDER BY name`;

    if (projects.length === 0) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const ids = projects.map((p) => String(p.id));

    // ── Alle Aggregate in je EINER Query (kein N+1) ────────────────────────
    // Phasen aller Projekte, in JS nach projectId gruppiert.
    const allPhases = await listPhasesForProjects(ids);
    const phasesByProject = new Map<string, ProjectPhase[]>();
    for (const ph of allPhases) {
      const arr = phasesByProject.get(ph.projectId) ?? [];
      arr.push(ph);
      phasesByProject.set(ph.projectId, arr);
    }

    // Fakturiert (gestellt + bezahlt) je Projekt.
    const invRows = await db`
      SELECT project_id, COALESCE(SUM(betrag), 0) AS sum FROM project_invoices
       WHERE project_id = ANY(${ids}::uuid[]) AND status IN ('gestellt','bezahlt')
       GROUP BY project_id
    `;
    const invByProject = new Map<string, number>();
    for (const r of invRows) invByProject.set(String(r.project_id), Number(r.sum ?? 0));

    // Offene Hoch-Prio-Aufgaben je Projekt.
    const hpRows = await db`
      SELECT project_id, COUNT(*) AS c FROM tasks
       WHERE project_id = ANY(${ids}::uuid[])
         AND status <> 'done'
         AND LOWER(COALESCE(priority, '')) IN ('hoch','high','dringend')
       GROUP BY project_id
    `;
    const hpByProject = new Map<string, number>();
    for (const r of hpRows) hpByProject.set(String(r.project_id), Number(r.c ?? 0));

    // Naechster zukuenftiger Termin je Projekt (Fallback-Frist).
    const tRows = await db`
      SELECT DISTINCT ON (project_id) project_id, text, datum FROM termine
       WHERE project_id = ANY(${ids}::uuid[]) AND datum >= ${todayStr}
       ORDER BY project_id, datum ASC
    `;
    const terminByProject = new Map<string, { text: string; datum: string }>();
    for (const r of tRows)
      terminByProject.set(String(r.project_id), { text: String(r.text), datum: String(r.datum).slice(0, 10) });

    const out: PortfolioEntry[] = [];
    for (const p of projects) {
      const projectId = String(p.id);
      const phases = phasesByProject.get(projectId) ?? [];
      const progress = weightedProgress(phases);

      // Aktuelle Phase: erste 'aktiv', sonst letzte 'fertig', sonst erste offene.
      const active = phases.find((ph) => ph.status === "aktiv");
      const lastDone = [...phases].reverse().find((ph) => ph.status === "fertig");
      const firstOpen = phases.find((ph) => ph.status === "offen");
      const currentPhase = active?.name ?? lastDone?.name ?? firstOpen?.name ?? null;

      // Naechste Frist: frühestes soll_ende einer noch nicht fertigen Phase.
      let nextDeadline: string | null = null;
      let nextDeadlineLabel: string | null = null;
      for (const ph of phases) {
        if (ph.status !== "fertig" && ph.sollEnde) {
          if (!nextDeadline || ph.sollEnde < nextDeadline) {
            nextDeadline = ph.sollEnde;
            nextDeadlineLabel = ph.name;
          }
        }
      }
      // Fallback: naechster zukuenftiger Termin, falls keine Phasen-Frist.
      if (!nextDeadline) {
        const t = terminByProject.get(projectId);
        if (t) {
          nextDeadline = t.datum;
          nextDeadlineLabel = t.text;
        }
      }

      const invoiced = invByProject.get(projectId) ?? 0;
      const openHighPrio = hpByProject.get(projectId) ?? 0;
      const budget = p.budget === null || p.budget === undefined ? null : Number(p.budget);
      const budgetRatio = budget && budget > 0 ? invoiced / budget : 0;
      const dleft = daysUntil(nextDeadline);

      // Ampel-Heuristik.
      let health: PortfolioEntry["health"] = "green";
      if ((dleft !== null && dleft < 0) || budgetRatio > 0.9) {
        health = "red";
      } else if ((dleft !== null && dleft <= 7) || budgetRatio > 0.8 || openHighPrio > 0) {
        health = "amber";
      }

      out.push({
        projectId,
        name: String(p.name),
        projektnummer: p.projektnummer ? String(p.projektnummer) : null,
        status: p.status ? String(p.status) : null,
        currentPhase,
        progress,
        budget,
        invoiced,
        nextDeadline,
        nextDeadlineLabel,
        openHighPrio,
        health,
      });
    }
    return out;
  },
};
