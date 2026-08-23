// ============================================================
// PATIO — Wer bekommt wovon eine Meldung?
// ============================================================
//
// ── Warum die Meldungen hier entstehen und nicht am Event-Bus ──────────────
//
// Der Live-Kanal trägt bewusst KEINE Nutzdaten mehr: nur `type`, `action`,
// `id`, `projectId` (siehe `src/api/events.ts`). Ein Zuhörer daran könnte
// also nicht sagen, WEM etwas zugewiesen wurde und WIE die Aufgabe heißt — er
// müsste alles nachladen, für jedes Ereignis, auch für die 95 %, aus denen
// keine Meldung wird.
//
// Deshalb hier, an den wenigen Stellen, an denen wirklich jemand ADRESSIERT
// wird. Das sind vier, nicht 62:
//
//   * eine Aufgabe wird jemandem zugewiesen
//   * jemand wird zu einem Termin eingetragen
//   * jemand wird zu einer Besprechung eingetragen
//   * eine zugewiesene Aufgabe wird heute fällig (Wartungslauf)
//
// Alles andere ist Aktivität, keine Adressierung — und gehört in die
// Aktivitätsliste, nicht in die Glocke.
//
// ── Die Brücke, an der schon zweimal etwas hing ────────────────────────────
//
// Zuweisungen zeigen auf `team_members.id`, ein Konto ist eine `users.id` —
// zwei disjunkte UUID-Räume. Verbunden sind sie nur über
// `team_members.user_id` (Migration 013). Wer das übersieht, baut eine
// Meldung, die niemanden erreicht, ohne dass irgendwo etwas rot wird.
// ============================================================

import { teamRepo, benachrichtigungenRepo, type NeueBenachrichtigung } from "../data/index.js";
import { logError } from "../logger.js";

/** Übersetzt Team-Mitglieder in Konten. Wer kein verknüpftes Konto hat
 *  (Externe, Firmen, Behörden), fällt still heraus — für sie gibt es nichts
 *  zuzustellen. */
async function kontenVon(mitgliedIds: (string | null | undefined)[]): Promise<string[]> {
  const konten: string[] = [];
  for (const id of new Set(mitgliedIds.filter(Boolean) as string[])) {
    const m = await teamRepo.get(id);
    if (m?.userId) konten.push(m.userId);
  }
  return konten;
}

/**
 * Schreibt Meldungen — und lässt den Aufrufer NIE scheitern.
 *
 * Eine Benachrichtigung ist Beiwerk. Wenn ihr Schreiben fehlschlägt, darf das
 * nicht die Zuweisung mitnehmen, die der Nutzer gerade gespeichert hat. Der
 * Fehler geht ins Log, die Antwort bleibt ein Erfolg.
 */
async function still(meldungen: NeueBenachrichtigung[], ausloeserId?: string | null): Promise<void> {
  try {
    await benachrichtigungenRepo.anlegen(meldungen, ausloeserId);
  } catch (err) {
    logError("[Benachrichtigung]", err);
  }
}

/** Kürzt einen Titel auf Meldungslänge, ohne mitten im Wort zu schneiden. */
function kurz(text: string, max = 60): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const s = t.slice(0, max);
  const l = s.lastIndexOf(" ");
  return (l > max * 0.6 ? s.slice(0, l) : s) + "…";
}

export async function meldeAufgabeZugewiesen(opts: {
  aufgabeId: string;
  text: string;
  mitgliedId: string | null | undefined;
  projectId?: string | null;
  ausloeserId: string | null;
  ausloeserName: string | null;
}): Promise<void> {
  const konten = await kontenVon([opts.mitgliedId]);
  if (konten.length === 0) return;
  await still(
    konten.map((k) => ({
      empfaengerId: k,
      anlass: "aufgabe-zugewiesen" as const,
      titel: `Ihnen wurde zugewiesen: ${kurz(opts.text)}`,
      ausloeser: opts.ausloeserName,
      zielTyp: "task",
      zielId: opts.aufgabeId,
      projectId: opts.projectId ?? null,
    })),
    opts.ausloeserId,
  );
}

export async function meldeTerminTeilnahme(opts: {
  terminId: string;
  text: string;
  datum: string;
  mitgliedIds: string[];
  projectId?: string | null;
  ausloeserId: string | null;
  ausloeserName: string | null;
}): Promise<void> {
  const konten = await kontenVon(opts.mitgliedIds);
  if (konten.length === 0) return;
  await still(
    konten.map((k) => ({
      empfaengerId: k,
      anlass: "termin-teilnahme" as const,
      titel: `Termin am ${opts.datum}: ${kurz(opts.text)}`,
      ausloeser: opts.ausloeserName,
      zielTyp: "termin",
      zielId: opts.terminId,
      projectId: opts.projectId ?? null,
    })),
    opts.ausloeserId,
  );
}

export async function meldeBesprechungTeilnahme(opts: {
  meetingId: string;
  titel: string;
  datum: string;
  mitgliedIds: string[];
  projectId: string;
  ausloeserId: string | null;
  ausloeserName: string | null;
}): Promise<void> {
  const konten = await kontenVon(opts.mitgliedIds);
  if (konten.length === 0) return;
  await still(
    konten.map((k) => ({
      empfaengerId: k,
      anlass: "besprechung-teilnahme" as const,
      titel: `Besprechung am ${opts.datum}: ${kurz(opts.titel)}`,
      ausloeser: opts.ausloeserName,
      zielTyp: "meeting",
      zielId: opts.meetingId,
      projectId: opts.projectId,
    })),
    opts.ausloeserId,
  );
}
