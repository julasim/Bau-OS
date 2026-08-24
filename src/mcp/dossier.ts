// ============================================================
// PATIO — KI-Dossier je Projekt
// ============================================================
// Erzeugt aus der Datenbank je freigegebenem Projekt EINE Markdown-Akte, die
// ein Sprachmodell lesen kann. Kein Voll-Abzug, kein JSON.
//
// ── Warum eine Akte und kein Datenabzug ────────────────────────────────────
//
//   * PRÜFBARKEIT. Eine Datei öffnen und lesen, statt einen Ordnerbaum zu
//     inspizieren. Wer wissen will, was die KI sieht, sieht es in einem Blick.
//   * KOSTEN. Eine Markdown-Tabellenzeile ist ein Bruchteil dessen, was
//     dieselbe Zeile als JSON mit Feldnamen, `rev` und `updatedAt` kostet.
//   * EINFACHHEIT. Wer die Akte liest, braucht keine zweite Datenschicht.
//
// ── WHITELIST-RENDERING ────────────────────────────────────────────────────
//
// Jede Kategorie schreibt eine EXPLIZIT aufgezählte Feldliste. Was hier nicht
// angefasst wird, landet nie im Dossier — das deckt `rev`, `such_text`,
// `created_by` (die rohe Konto-UUID) und alles künftig hinzukommende ab, OHNE
// dass die Redaktion jedes einzelne Feld kennen müsste.
//
// Die Umkehrung — „alles rendern, Heikles entfernen" — wäre eine Liste, die
// bei jedem neuen Feld zu ergänzen ist. Genau so entstehen Lecks.
//
// ── STABILE IDs ────────────────────────────────────────────────────────────
//
// Jeder Abschnitt führt die ID mit. Querverweise (Entscheidung → Besprechung,
// Aufgabe → Phase) bleiben IMMER erhalten — weggelassen wird nur der Klartext
// der Ziel-Kategorie, wenn diese nicht freigegeben ist. So bleibt „welche
// Entscheidung fiel in welcher Besprechung" beantwortbar, ohne dass die
// Besprechung selbst mitgeht.
//
// Bei Personendaten-Stufe „keine" erscheint eine Person durchgängig als ihre
// Mitglieds-ID — dasselbe Pseudonym über alle Abschnitte. Ein erfundener
// Platzhalter („Person 1") wäre pro Abschnitt verschieden und damit wertlos.
// ============================================================

import {
  projectRepo,
  taskRepo,
  terminRepo,
  noteRepo,
  teamRepo,
  meetingRepo,
  entscheidungRepo,
  bautagebuchRepo,
  phaseRepo,
  invoiceRepo,
} from "../data/index.js";
import { dbKiFreigabe, KI_KATEGORIEN, type KiFreigabe, type KiKategorie } from "../data/db-ki-freigabe.js";
import { redigiere } from "./redact.js";
import { alsDokumentwert } from "../data/projektnummer.js";

type Satz = Record<string, unknown>;

/** Markdown-sichere Zelle. Ein `|` im Freitext zerlegt sonst die Tabelle. */
function z(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function tabelle(kopf: string[], zeilen: string[][]): string {
  if (zeilen.length === 0) return "_keine Einträge_";
  return [
    `| ${kopf.join(" | ")} |`,
    `|${kopf.map(() => "---").join("|")}|`,
    ...zeilen.map((r) => `| ${r.map(z).join(" | ")} |`),
  ].join("\n");
}

/**
 * Wie eine Person im Dossier erscheint.
 *
 * Bei Stufe „keine" die Mitglieds-ID, sonst der Name. Fehlt beides, ein
 * Gedankenstrich — NICHT der Rohwert: ein leeres Feld sieht in einer Tabelle
 * sonst aus wie ein fehlender Eintrag.
 */
function person(id: string | null | undefined, name: string | null | undefined, stufe: string): string {
  if (stufe === "keine") return id ? String(id) : "—";
  return name ? String(name) : id ? String(id) : "—";
}

const STATUS_TEXT: Record<string, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  done: "Erledigt",
};

export interface DossierErgebnis {
  projectId: string;
  projektname: string;
  dateiname: string;
  text: string;
}

/**
 * Baut das Dossier eines Projekts — oder `null`, wenn es nicht freigegeben ist.
 *
 * Kein Dossier ist die richtige Antwort auf „nicht freigegeben": eine leere
 * Akte mit Überschrift würde die Existenz des Projekts verraten.
 */
export async function dossierFuerProjekt(projectId: string, freigabe?: KiFreigabe): Promise<DossierErgebnis | null> {
  const f = freigabe ?? (await dbKiFreigabe.lesen());
  if (!f.aktiv) return null;

  const kategorien = f.projekte[projectId] ?? [];
  if (kategorien.length === 0) return null;
  const frei = (k: KiKategorie) => kategorien.includes(k);
  const stufe = f.personendaten;

  const name = await projectRepo.nameById?.(projectId);
  if (!name) return null;
  // `getInfo` liefert gelöschte Projekte gar nicht erst — der Papierkorb ist
  // im Repository gefiltert (Migration 044).
  const info = await projectRepo.getInfo(name);
  if (!info) return null;

  const teile: string[] = [];
  const nummer = alsDokumentwert(info.projektnummer ?? null);
  teile.push(`# ${name}${nummer ? ` (${nummer})` : ""}`);
  teile.push("");
  teile.push(`_Projekt-ID: ${projectId}_`);
  teile.push("");
  teile.push(
    "> Diese Akte ist ein **Auszug**. Sie enthält nur die freigegebenen Bereiche " +
      `(${kategorien.join(", ")}) und die Personendaten-Stufe „${stufe}".`,
  );

  // ── Stammdaten ────────────────────────────────────────────────────────────
  if (frei("stammdaten")) {
    const p = redigiere("project", info as unknown as Satz, stufe);
    const zeilen: [string, unknown][] = [
      ["Projektnummer", nummer],
      ["Status", p.status],
      ["Beschreibung", p.description],
      ["Standort", p.standort],
      ["Projektart", p.projektart],
      ["Nutzung", p.nutzung],
      ["Phase", p.phase],
      ["Start", p.startDate],
      ["Ende", p.endDate],
      ["Bauherr", p.bauherr],
    ];
    teile.push("\n## Stammdaten\n");
    const gefuellt = zeilen.filter(([, v]) => v !== null && v !== undefined && v !== "");
    teile.push(gefuellt.length ? gefuellt.map(([k, v]) => `- **${k}:** ${z(v)}`).join("\n") : "_keine Stammdaten_");
  }

  // ── Leistungsphasen ───────────────────────────────────────────────────────
  const phasen = frei("phasen") || frei("aufgaben") ? await phaseRepo.list(projectId) : [];
  const phaseName = new Map(phasen.map((p) => [p.id, p.name]));
  if (frei("phasen")) {
    teile.push("\n## Leistungsphasen\n");
    teile.push(
      tabelle(
        ["ID", "Phase", "Status", "Soll-Start", "Soll-Ende", "Fortschritt %"],
        phasen.map((p) => [
          p.id,
          p.name,
          p.status,
          p.sollStart ?? "",
          p.sollEnde ?? "",
          String(p.progressManual ?? ""),
        ]),
      ),
    );
  }

  // ── Aufgaben ──────────────────────────────────────────────────────────────
  if (frei("aufgaben")) {
    const roh = await taskRepo.list(name);
    teile.push("\n## Aufgaben\n");
    teile.push(
      tabelle(
        ["ID", "Aufgabe", "Status", "Fällig", "Zuständig", "Phase"],
        roh.map((t) => {
          const r = redigiere("task", t as unknown as Satz, stufe);
          // Der Verweis auf die Phase bleibt IMMER — nur ihr Name fällt weg,
          // wenn die Kategorie nicht frei ist.
          const ph = t.phaseId ? (frei("phasen") ? (phaseName.get(t.phaseId) ?? t.phaseId) : t.phaseId) : "—";
          return [
            t.id,
            String(r.text ?? ""),
            STATUS_TEXT[String(t.status)] ?? String(t.status),
            String(r.date ?? ""),
            person(t.assigneeId, r.assigneeName as string | null, stufe),
            ph,
          ];
        }),
      ),
    );
  }

  // ── Termine ───────────────────────────────────────────────────────────────
  if (frei("termine")) {
    const roh = await terminRepo.list(name);
    teile.push("\n## Termine\n");
    teile.push(
      tabelle(
        ["ID", "Datum", "Zeit", "Termin", "Ort", "Teilnehmer"],
        roh.map((t) => {
          const r = redigiere("termin", t as unknown as Satz, stufe);
          const teilnehmer =
            stufe === "keine"
              ? (t.assigneeIds ?? []).join(", ")
              : ((r.assignees as string[]) ?? []).join(", ") ||
                ((r.assigneesResolved as { name: string }[]) ?? []).map((x) => x.name).join(", ");
          return [
            t.id,
            String(r.datum ?? ""),
            String(r.uhrzeit ?? ""),
            String(r.text ?? ""),
            String(r.location ?? ""),
            teilnehmer,
          ];
        }),
      ),
    );
  }

  // ── Notizen ───────────────────────────────────────────────────────────────
  if (frei("notizen") && noteRepo.listDetailed) {
    const alle = await noteRepo.listDetailed(500);
    const eigene = alle.filter((n) => n.project === name);
    teile.push("\n## Notizen\n");
    if (eigene.length === 0) {
      teile.push("_keine Einträge_");
    } else {
      for (const n of eigene) {
        teile.push(`\n### ${z(n.title)}\n`);
        // Der Inhalt geht MIT — eine Akte aus Notiz-Überschriften wäre
        // wertlos. Wer das nicht will, gibt die Kategorie nicht frei; genau
        // dafür ist sie einzeln schaltbar.
        // `listDetailed` liefert nur die Kopfdaten; der Text kommt einzeln
        // nach. Das kostet eine Abfrage je Notiz — bei einer Akte, die selten
        // und nicht im Anfragepfad gebaut wird, ist das der richtige Tausch
        // gegen eine zweite Leseschicht.
        const text = await noteRepo.read(n.title);
        teile.push((text ?? "").trim() || "_leer_");
      }
    }
  }

  // ── Besprechungen ─────────────────────────────────────────────────────────
  const meetings = frei("meetings") || frei("entscheidungen") ? await meetingRepo.list(projectId, 200) : [];
  const meetingTitel = new Map(meetings.map((m) => [m.id, m.title]));
  if (frei("meetings")) {
    teile.push("\n## Besprechungen\n");
    if (meetings.length === 0) {
      teile.push("_keine Einträge_");
    } else {
      for (const m of meetings) {
        const r = redigiere("meeting", m as unknown as Satz, stufe);
        teile.push(`\n### ${z(m.date)} — ${z(m.title)}  \`${m.id}\`\n`);
        const teilnehmer =
          stufe === "keine"
            ? (m.attendeeIds ?? []).join(", ")
            : [
                ...((r.attendeesResolved as { name: string }[]) ?? []).map((x) => x.name),
                ...((r.attendeesExternal as string[]) ?? []),
              ].join(", ");
        if (teilnehmer) teile.push(`**Teilnehmer:** ${z(teilnehmer)}`);
        if (m.agenda) teile.push(`\n**Agenda**\n\n${m.agenda}`);
        if (m.minutes) teile.push(`\n**Protokoll**\n\n${m.minutes}`);
        if (m.decisions) teile.push(`\n**Beschlüsse**\n\n${m.decisions}`);
      }
    }
  }

  // ── Entscheidungen ────────────────────────────────────────────────────────
  if (frei("entscheidungen")) {
    const roh = await entscheidungRepo.list(projectId);
    teile.push("\n## Entscheidungen\n");
    if (roh.length === 0) {
      teile.push("_keine Einträge_");
    } else {
      for (const e of roh) {
        const r = redigiere("entscheidung", e as unknown as Satz, stufe);
        teile.push(`\n### ${z(e.datum)} — ${z(e.titel)}  \`${e.id}\`\n`);
        teile.push(`**Status:** ${z(e.status)}`);
        if (e.relatedMeetingId) {
          // Der Verweis bleibt, der Titel nur bei freigegebener Kategorie.
          const t = frei("meetings")
            ? (meetingTitel.get(e.relatedMeetingId) ?? e.relatedMeetingId)
            : e.relatedMeetingId;
          teile.push(`**Aus Besprechung:** ${z(t)}`);
        }
        const beteiligte =
          stufe === "keine"
            ? (e.beteiligteIds ?? []).join(", ")
            : [
                ...((r.beteiligteResolved as { name: string }[]) ?? []).map((x) => x.name),
                ...((r.beteiligteExtern as string[]) ?? []),
              ].join(", ");
        if (beteiligte) teile.push(`**Beteiligt:** ${z(beteiligte)}`);
        if (e.begruendung) teile.push(`\n${e.begruendung}`);
        const alt = e.alternativen ?? [];
        if (alt.length) {
          teile.push("\n**Verworfene Alternativen:**");
          for (const a of alt)
            teile.push(`- ${z(a.text)}${a.verworfenWeil ? ` — verworfen: ${z(a.verworfenWeil)}` : ""}`);
        }
      }
    }
  }

  // ── Bautagebuch ───────────────────────────────────────────────────────────
  if (frei("bautagebuch")) {
    const roh = await bautagebuchRepo.list(projectId, 365);
    teile.push("\n## Bautagebuch\n");
    if (roh.length === 0) {
      teile.push("_keine Einträge_");
    } else {
      for (const b of roh) {
        const r = redigiere("bautagebuch", b as unknown as Satz, stufe);
        teile.push(`\n### ${z(b.date)}\n`);
        const personal = ((r.personnel as Satz[]) ?? []).map((p) => z(p.name)).filter(Boolean);
        const kopf: string[] = [];
        if (b.weather) kopf.push(`Wetter: ${z(b.weather)}`);
        if (personal.length) kopf.push(`Personal: ${personal.join(", ")}`);
        if (b.machines) kopf.push(`Maschinen: ${z(b.machines)}`);
        if (kopf.length) teile.push(kopf.join(" · "));
        if (b.activities) teile.push(`\n**Tätigkeiten:** ${b.activities}`);
        if (b.incidents) teile.push(`\n**Vorkommnisse:** ${b.incidents}`);
      }
    }
  }

  // ── Rechnungen ────────────────────────────────────────────────────────────
  if (frei("rechnungen")) {
    const roh = await invoiceRepo.list(projectId);
    teile.push("\n## Rechnungen\n");
    teile.push(
      tabelle(
        ["ID", "Nummer", "Datum", "Status", "Betrag", "Phase"],
        roh.map((r) => [
          r.id,
          r.nummer ?? "",
          r.datum ?? "",
          r.status,
          String(r.betrag ?? ""),
          r.phaseId ? (frei("phasen") ? (phaseName.get(r.phaseId) ?? r.phaseId) : r.phaseId) : "—",
        ]),
      ),
    );
  }

  // ── Beteiligte ────────────────────────────────────────────────────────────
  if (frei("beteiligte")) {
    const alle = await teamRepo.list("all");
    const eigene = alle.filter((m) => (m.projects ?? []).some((p) => p.id === projectId));
    teile.push("\n## Beteiligte\n");
    // E-Mail und Telefon stehen in der Spaltenliste — sie erscheinen aber nur
    // bei Stufe „alle": ab „namen-ohne-kontakt" hat die Redaktion sie bereits
    // geleert. Die Spalten trotzdem zu führen ist Absicht: wer die Akte liest,
    // sieht, DASS es diese Angaben gibt und dass sie zurückgehalten wurden.
    teile.push(
      tabelle(
        ["ID", "Name", "Rolle", "Projektrolle", "Art", "Firma", "E-Mail", "Telefon"],
        eigene.map((m) => {
          const r = redigiere("team", m as unknown as Satz, stufe);
          const zuordnung = (m.projects ?? []).find((p) => p.id === projectId);
          return [
            m.id,
            String(r.name ?? ""),
            String(r.role ?? ""),
            String(zuordnung?.projectRole ?? ""),
            String(r.memberType ?? ""),
            String(r.companyName ?? r.company ?? ""),
            String(r.email ?? ""),
            String(r.phone ?? ""),
          ];
        }),
      ),
    );
  }

  const slug = `${nummer ? nummer + " " : ""}${name}`.replace(/[\\/:*?"<>|]/g, "-").trim();
  return {
    projectId,
    projektname: name,
    dateiname: `${slug}.md`,
    text: teile.join("\n") + "\n",
  };
}

/** Alle freigegebenen Projekte. Leer, wenn der Hauptschalter aus ist. */
export async function alleDossiers(): Promise<DossierErgebnis[]> {
  const f = await dbKiFreigabe.lesen();
  if (!f.aktiv) return [];
  const raus: DossierErgebnis[] = [];
  for (const projectId of Object.keys(f.projekte)) {
    const d = await dossierFuerProjekt(projectId, f);
    if (d) raus.push(d);
  }
  return raus;
}

export { KI_KATEGORIEN };
export type { KiKategorie };
