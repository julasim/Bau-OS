// ============================================================
// PATIO — Portfolio-Cockpit-Repository (DB-Backend)
// ============================================================
// Aggregiert je Projekt die PM-Kennzahlen fuer die projektuebergreifende
// Leitungssicht. Die Ampel (health) ist eine serverseitige Heuristik aus
// Frist-Status + Budget-Health + offenen Hoch-Prio-Aufgaben.
// DB-only.
// ============================================================

import { getDb } from "../db/client.js";
import { dbPhases } from "./db-phases.js";
import type { PortfolioEntry, PortfolioRepository } from "./types.js";

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
    const projects =
      visibleProjectIds === "all"
        ? await db`SELECT id, name, projektnummer, status, budget FROM projects ORDER BY name`
        : visibleProjectIds.length === 0
          ? []
          : await db`SELECT id, name, projektnummer, status, budget FROM projects WHERE id = ANY(${visibleProjectIds}::uuid[]) ORDER BY name`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const out: PortfolioEntry[] = [];
    for (const p of projects) {
      const projectId = String(p.id);
      const phases = await dbPhases.list(projectId);
      const progress = await dbPhases.projectProgress(projectId);

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
        const [t] = await db`
          SELECT text, datum FROM termine
           WHERE project_id = ${projectId} AND datum >= ${todayStr}
           ORDER BY datum ASC LIMIT 1
        `;
        if (t) {
          nextDeadline = String(t.datum).slice(0, 10);
          nextDeadlineLabel = String(t.text);
        }
      }

      // Fakturiert (gestellt + bezahlt).
      const [inv] = await db`
        SELECT COALESCE(SUM(betrag), 0) AS sum FROM project_invoices
         WHERE project_id = ${projectId} AND status IN ('gestellt','bezahlt')
      `;
      const invoiced = Number(inv?.sum ?? 0);

      // Offene Hoch-Prio-Aufgaben.
      const [hp] = await db`
        SELECT COUNT(*) AS c FROM tasks
         WHERE project_id = ${projectId}
           AND status <> 'done'
           AND LOWER(COALESCE(priority, '')) IN ('hoch','high','dringend')
      `;
      const openHighPrio = Number(hp?.c ?? 0);

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
