// ============================================================
// PATIO — Redaktion für die KI-Dossiers
// ============================================================
// DIE EINZIGE Stelle, die personenbezogene Daten entfernt — angewandt auf
// jeden Datensatz VOR dem Rendern ins Dossier (`src/mcp/dossier.ts`).
//
// ── Warum das explizit je Datenart steht ───────────────────────────────────
//
// Weil Personennamen quer über die Domänen verteilt liegen und NICHT nur an
// den Team-Mitgliedern hängen:
//
//   Task.assignee          Freitext-Name neben der Zuweisung
//   Termin.assignees       Namensliste neben den IDs
//   BautagebuchPersonnel   Name UND geleistete Stunden je Person
//   Meeting.attendeesExternal      externe Teilnehmer, reine Namen
//   Entscheidung.beteiligteExtern  dito
//   Project.bauherr        Freitext-Name neben `bauherr_id`
//   …createdByUsername     in fast jedem Datensatz aus dem Join
//
// Wer nur die Team-Tabelle filtert, hat nichts erreicht.
//
// ── Die drei Stufen ────────────────────────────────────────────────────────
//
//   "alle"                — unverändert.
//   "namen-ohne-kontakt"  — Namen bleiben (Protokolle bleiben lesbar), aber
//                           KEINE E-Mail, Telefonnummer, Kontakt-Log,
//                           Stundensätze und keine Personal-Stunden im
//                           Bautagebuch.
//   "keine"               — zusätzlich alle Klarnamen weg. Personen erscheinen
//                           nur noch über ihre stabile Mitglieds-ID — ein
//                           Pseudonym, das über Projekte hinweg gleich bleibt.
//                           Externe ohne ID (reine Namen) entfallen ersatzlos.
//
// ── Eine bewusste Grenze ───────────────────────────────────────────────────
//
// FREITEXTE werden NICHT durchsucht: Notiz-Inhalt, Protokoll-Prosa,
// Bautagebuch-Tätigkeiten. Die Stufe wirkt auf FELDER, nicht auf Prosa. In
// einem Protokoll steht „Hr. Müller wünscht Sichtbeton" — das lässt sich nicht
// zuverlässig erkennen und wäre bei jedem Versuch entweder löchrig oder
// zerstörerisch.
//
// Wer das nicht will, gibt die Freitext-Kategorien nicht frei. Die Oberfläche
// sagt das dazu.
// ============================================================

import type { PersonendatenStufe } from "../data/db-ki-freigabe.js";

/** Was hier hineingeht, ist immer ein DTO aus `src/data/` — ein flaches
 *  Objekt, kein Datenbankfeld. */
type Satz = Record<string, unknown>;

/** Felder, die in JEDER Datenart einen Klarnamen tragen können (aus dem
 *  Join). Sie fallen einheitlich, statt in zehn `case`-Zweigen einzeln. */
const NAMENSFELDER_UEBERALL = ["createdByUsername", "updatedByUsername", "assigneeName", "memberName"];

/**
 * Redigiert einen Datensatz für das Dossier.
 *
 * Gibt IMMER eine Kopie zurück. Eine Redaktion an Ort und Stelle würde die
 * Daten verfälschen, die dieselbe Anfrage gerade sonst noch verwendet.
 */
export function redigiere(art: string, satz: Satz, stufe: PersonendatenStufe): Satz {
  if (stufe === "alle") return { ...satz };
  const d: Satz = structuredClone(satz);

  if (stufe === "keine") {
    for (const f of NAMENSFELDER_UEBERALL) if (f in d) d[f] = null;
  }

  switch (art) {
    case "team": {
      // Kontaktwege sind ab „namen-ohne-kontakt" tabu.
      d.email = null;
      d.phone = null;
      d.contactLog = [];
      d.hourlyRate = null;
      if (stufe === "keine") {
        // Die stabile Mitglieds-ID ersetzt den Namen (Pseudonym).
        d.name = String(d.id ?? "");
        // Eine Ein-Personen-Firma identifiziert genauso gut wie ein Name.
        d.company = null;
        d.companyName = null;
      }
      break;
    }
    case "task": {
      if (stufe === "keine") d.assignee = null; // Freitext-Name; die ID bleibt
      break;
    }
    case "termin": {
      if (stufe === "keine") {
        d.assignees = []; // Namensliste; die IDs bleiben
        d.assigneesResolved = [];
      }
      break;
    }
    case "bautagebuch": {
      const personal = Array.isArray(d.personnel) ? (d.personnel as Satz[]) : [];
      let liste = personal;
      if (stufe === "keine") {
        // Externe ohne Mitglieds-ID entfallen ersatzlos; mit ID → ID statt Name.
        liste = personal
          .filter((p) => typeof p.memberId === "string" && p.memberId)
          .map((p) => ({ ...p, name: String(p.memberId) }));
      }
      // Geleistete Stunden je Person — ab „namen-ohne-kontakt" tabu.
      d.personnel = liste.map((p) => ({ ...p, hours: null }));
      break;
    }
    case "meeting": {
      if (stufe === "keine") {
        d.attendeesExternal = [];
        d.attendeesResolved = [];
      }
      break;
    }
    case "entscheidung": {
      if (stufe === "keine") {
        d.beteiligteExtern = [];
        d.beteiligteResolved = [];
      }
      break;
    }
    case "project": {
      if (stufe === "keine") {
        d.bauherr = null; // Freitext-Name neben der Bauherr-ID
        d.bauherrName = null;
      }
      break;
    }
    // note / phase / invoice: keine strukturierten Personenfelder.
    default:
      break;
  }
  return d;
}
