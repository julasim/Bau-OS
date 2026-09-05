#!/usr/bin/env tsx
// ============================================================
// PATIO — Datenübernahme aus PATIO Desktop
// ============================================================
//
// Liest einen Vault von PATIO Desktop (`apps/patio-app-lokal`) und schreibt
// ihn in die PostgreSQL-Datenbank des Firmenservers.
//
//   npm run db:import -- <VAULT-PFAD> [--trocken] [--als <benutzername>]
//
// ── Was hier vorher stand, und warum es ersetzt wurde ──────────────────────
//
// Die Vorgängerfassung (`migrate-vault-to-db.ts`) behauptete, zwei Formate zu
// können: die alte Datei-Ablage des Servers VOR AP0 und den Desktop-Vault.
// Gemessen konnte sie nur das erste. Sie suchte flache Sammeldateien
// (`Projekte/<Name>/tasks.json`), die es im Desktop-Vault nirgends gibt — dort
// liegt JEDER Datensatz einzeln als `<slug>.json`. Aus einem Desktop-Vault
// kamen damit 0 Aufgaben und 0 Termine an, ohne dass irgendwo etwas rot wurde.
//
// Dazu deckte sie 5 der 25 Datenarten ab: genau die Domänen der Stufen 1–6
// (Rechnungen, Entscheidungen, Phasen, Besprechungen, Bautagebuch, Dokumente)
// fehlten. Und die Dublettenprüfung für Notizen lief allein über den Titel —
// projektübergreifend. Bei einem Bestand mit vielen „Aktenvermerk"-Notizen
// landete davon genau eine in der Datenbank.
//
// Der alte Server-Dateimodus ist mit AP0 entfallen und kommt nicht wieder;
// das Format, das es zu übernehmen gilt, ist das des Desktops.
//
// ── Das Vault-Format ───────────────────────────────────────────────────────
//
//   Projekte/<Name>/projekt.json           ← der Projekt-Datensatz
//   Projekte/<Name>/Aufgaben/<slug>.json
//   Projekte/<Name>/Notizen|Termine|Dokumente|Meetings|
//                   Entscheidungen|Bautagebuch|Phasen|Rechnungen/<slug>.json
//   Aufgaben|Notizen|Termine|Dokumente/<slug>.json   ← ohne Projekt
//   Team/<slug>.json · Team/_Firmen/<slug>.json
//
// Jede Datei: { id, type, schemaVersion, data, custom?, meta }
// `meta` trägt createdBy/createdAt/updatedBy/updatedAt/rev.
// Daneben liegt je eine `.md` — die lesbare Spiegelung. Sie wird NICHT
// gelesen: die Wahrheit steht im JSON.
//
// ── Grundsätze ─────────────────────────────────────────────────────────────
//
//  * EINE TRANSAKTION. Bricht der Lauf ab, ist nichts geschrieben. Die
//    Vorgängerfassung schrieb Satz für Satz — ein Fehler in der Mitte hinterließ
//    einen halb gefüllten Bestand, den niemand mehr auseinandersortieren konnte.
//  * WIEDERHOLBAR über `import_zuordnung` (Migration 057), nicht über
//    Textvergleiche. Ein zweiter Lauf überspringt, was schon da ist.
//  * EHRLICHER BERICHT. Gelesen / geschrieben / übersprungen / Fehler je Art,
//    plus die Verzeichnisse, die vorhanden waren und die niemand gelesen hat.
//    Ein „Migration abgeschlossen" über einem halben Bestand ist schlimmer als
//    ein Abbruch.
//  * `--trocken` liest alles und schreibt nichts.
// ============================================================

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DB_ENABLED } from "../src/config.js";
import { getDb, checkDbHealth, closeDb } from "../src/db/index.js";
import { PLATZHALTER_PRAEFIX, pruefeProjektnummer } from "../src/data/projektnummer.js";
import { validateDatum, alsIsoDatum } from "../src/data/termin-validation.js";

// ── Aufruf ──────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const TROCKEN = ARGS.includes("--trocken");
const VAULT = ARGS.find((a) => !a.startsWith("--")) ?? "";
const ALS = (() => {
  const i = ARGS.indexOf("--als");
  return i >= 0 ? ARGS[i + 1] : undefined;
})();

function abbruch(...zeilen: string[]): never {
  for (const z of zeilen) console.error(z);
  process.exit(1);
}

if (!DB_ENABLED) abbruch("❌ DATABASE_URL ist nicht gesetzt.");
if (!VAULT || !fs.existsSync(VAULT)) {
  abbruch(
    "❌ Vault-Pfad fehlt oder existiert nicht: " + (VAULT || "(leer)"),
    "",
    "   Aufruf:  npm run db:import -- <VAULT-PFAD> [--trocken] [--als <benutzername>]",
    "",
    "   --trocken   liest alles und schreibt nichts",
    "   --als       trägt diesen Benutzer als Ersteller ein und gibt ihm",
    "               Zugriff auf alle übernommenen Projekte",
  );
}
if (!fs.existsSync(path.join(VAULT, "Projekte"))) {
  abbruch(
    "❌ Das sieht nicht nach einem PATIO-Desktop-Vault aus:",
    "   " + VAULT,
    "",
    "   Erwartet wird ein Verzeichnis `Projekte/` darin.",
  );
}

/** Kennung dieser Quelle in `import_zuordnung`. Aus dem Vault selbst, damit
 *  zwei Übernahmen aus verschiedenen Ablagen sich nicht überschreiben. */
const QUELLE = (() => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(VAULT, "_Einstellungen", "vault-meta.json"), "utf-8")) as {
      vaultId?: string;
    };
    if (meta.vaultId) return `vault:${meta.vaultId}`;
  } catch {
    // Kein Vault-Marker (ältere Fassung) — dann der Pfad. Der ist schwächer,
    // weil ein Umzug des Ordners ihn ändert; für den Wiederholungsschutz
    // innerhalb einer Übernahme reicht er.
  }
  return `pfad:${path.resolve(VAULT).toLowerCase()}`;
})();

// ── Vault lesen ─────────────────────────────────────────────────────────────

interface VaultMeta {
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  rev?: number;
}
interface VaultRecord<T = Record<string, unknown>> {
  id: string;
  type: string;
  schemaVersion?: number;
  data: T;
  custom?: Record<string, unknown>;
  meta: VaultMeta;
}

const fehler: string[] = [];
const ungelesen: string[] = [];

function unterordner(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Liest alle Record-JSONs eines Verzeichnisses (nicht rekursiv).
 *
 *  Ein kaputter Datensatz bricht den Lauf NICHT ab — er landet im Bericht.
 *  Sonst entscheidet eine einzelne unlesbare Datei über die ganze Übernahme. */
function records<T>(relDir: string, erwarteterTyp: string): VaultRecord<T>[] {
  const dir = path.join(VAULT, relDir);
  let dateien: string[];
  try {
    dateien = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const raus: VaultRecord<T>[] = [];
  for (const f of dateien.sort()) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as VaultRecord<T>;
      if (!rec?.id || !rec.data) {
        fehler.push(`${relDir}/${f}: kein Record (id oder data fehlt)`);
        continue;
      }
      if (rec.type !== erwarteterTyp) {
        fehler.push(`${relDir}/${f}: Typ "${rec.type}" statt "${erwarteterTyp}"`);
        continue;
      }
      raus.push(rec);
    } catch (e) {
      fehler.push(`${relDir}/${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return raus;
}

/** Die Modulverzeichnisse, die es je Projekt geben kann. Was daneben liegt,
 *  wird im Bericht als ungelesen genannt — stillschweigend zu übergehen, was
 *  man nicht kennt, ist die häufigste Art, einen Import für vollständig zu
 *  halten. */
const PROJEKT_MODULE = [
  "Aufgaben",
  "Notizen",
  "Termine",
  "Dokumente",
  "Meetings",
  "Entscheidungen",
  "Bautagebuch",
  "Phasen",
  "Rechnungen",
] as const;

// ── Zähler ──────────────────────────────────────────────────────────────────

interface Zaehler {
  gelesen: number;
  geschrieben: number;
  uebersprungen: number;
}
const zaehler = new Map<string, Zaehler>();
/**
 * Ein Datumsfeld aus dem Vault, geprueft — oder `null` mit Meldung.
 *
 * ── Warum das noetig ist, und zwar dringend ────────────────────────────────
 *
 * Die INSERTs schrieben rohe Zeichenketten in `date`-Spalten. postgres.js
 * serialisiert die ueber `new Date(x).toISOString()`, und `new Date()` liest
 * einen Punkt-getrennten Wert in US-Notation. Am 01.09.2026 am Treiber
 * nachgemessen:
 *
 *   "05.10.2026"  (5. Oktober)  ->  in der Spalte steht 2026-05-09
 *   "31.12.2026"                ->  RangeError: Invalid time value
 *   ""                          ->  RangeError: Invalid time value
 *
 * Der erste Fall ist der schlimmere: **fuenf Monate falsch, ohne jede
 * Meldung.** Eine Rechnung steht danach im falschen Quartal und in jeder
 * Sortierung an der falschen Stelle, und niemand hat einen Anlass
 * nachzusehen.
 *
 * Der zweite und dritte reissen die GESAMTE Uebernahme ab — sie laeuft in
 * einer Transaktion —, und im Terminal steht nur `Invalid time value`, ohne
 * Datei, ohne Feld, ohne Tabelle.
 *
 * Deshalb: pruefen, umwandeln, und im Zweifel den einzelnen Datensatz
 * ueberspringen und benennen. Ein fehlender Datensatz mit Meldung ist besser
 * als ein falscher ohne.
 */
function pruefeDatum(roh: unknown, art: string, quellId: string): string | null {
  const wert = String(roh ?? "");
  const fehler = validateDatum(wert);
  if (fehler) {
    console.warn(`  ⚠ ${art} ${quellId} uebersprungen — ${fehler}`);
    return null;
  }
  return alsIsoDatum(wert);
}

/**
 * Ein OPTIONALES Datumsfeld: leer bleibt leer, falsch wird gemeldet und leer.
 *
 * Anders als bei `pruefeDatum` wird der Datensatz hier NICHT uebersprungen.
 * Ein Projekt ohne Enddatum ist ein gueltiges Projekt; es wegen eines
 * unlesbaren Nebenfeldes ganz zu verlieren waere schlimmer als das Feld leer
 * zu lassen. Gemeldet wird es trotzdem — sonst faellt es niemandem auf.
 */
function datumOptional(roh: unknown, art: string, quellId: string): string | null {
  if (roh == null || roh === "") return null;
  const wert = String(roh);
  const fehler = validateDatum(wert);
  if (fehler) {
    console.warn(`  ⚠ ${art} ${quellId}: Datumsfeld leer gelassen — ${fehler}`);
    return null;
  }
  return alsIsoDatum(wert);
}

function zaehl(art: string): Zaehler {
  let z = zaehler.get(art);
  if (!z) {
    z = { gelesen: 0, geschrieben: 0, uebersprungen: 0 };
    zaehler.set(art, z);
  }
  return z;
}

// ── Hauptlauf ───────────────────────────────────────────────────────────────

const db = getDb();
if (!(await checkDbHealth())) abbruch("❌ Datenbank nicht erreichbar.");

console.log("\n📦 Datenübernahme aus PATIO Desktop");
console.log(`   Vault:  ${path.resolve(VAULT)}`);
console.log(`   Quelle: ${QUELLE}`);
if (TROCKEN) console.log("   MODUS:  Trockenlauf — es wird nichts geschrieben.");
console.log("");

/** users.id des Kontos aus `--als`, oder null. */
let alsBenutzerId: string | null = null;
if (ALS) {
  const [u] = await db`SELECT id FROM users WHERE username = ${ALS}`;
  if (!u) {
    // Die Konten WIRKLICH auflisten. Hier stand bis zum 29.08.2026 der Satz
    // "Vorhandene Konten: SELECT username FROM users;" — also die Abfrage als
    // Text statt ihres Ergebnisses. Wer den Fehler sieht, bekommt damit genau
    // die Auskunft nicht, die er braucht, und eine Datenuebernahme laeuft im
    // Ernstfall einmal, unter Zeitdruck, auf fremden Daten.
    const konten = await db`SELECT username FROM users ORDER BY username`;
    const liste =
      konten.length > 0
        ? konten.map((k) => `     · ${String(k.username)}`).join("\n")
        : "     (keine — die Datenbank hat noch gar kein Konto)";
    await closeDb();
    abbruch(`❌ Benutzer "${ALS}" gibt es nicht.`, "   Vorhandene Konten:", liste);
  }
  alsBenutzerId = String(u.id);
  console.log(`   Als:    ${ALS}`);
}

// Zuordnung Quell-ID → Ziel-UUID, im Speicher gehalten und am Ende geschrieben.
const zuordnung = new Map<string, string>(); // `${typ}:${quellId}` → uuid
const schluessel = (typ: string, quellId: string) => `${typ}:${quellId}`;

// Bereits vorhandene Zuordnungen laden — das ist der Wiederholungsschutz.
for (const r of await db`SELECT typ, quell_id, ziel_id FROM import_zuordnung WHERE quelle = ${QUELLE}`) {
  zuordnung.set(schluessel(String(r.typ), String(r.quell_id)), String(r.ziel_id));
}
if (zuordnung.size > 0) {
  console.log(`   ↻ ${zuordnung.size} Datensätze wurden schon einmal übernommen — sie werden übersprungen.\n`);
}

/** Neue Zuordnungen dieses Laufs (werden am Ende gemeinsam geschrieben). */
const neueZuordnungen: { typ: string; quellId: string; zielId: string }[] = [];

function merke(typ: string, quellId: string, zielId: string): void {
  zuordnung.set(schluessel(typ, quellId), zielId);
  neueZuordnungen.push({ typ, quellId, zielId });
}

/** Übersetzt eine Quell-ID in die UUID hier. `null`, wenn der Verweis ins
 *  Leere zeigt — das kommt vor (gelöschtes Ziel, Verweis über Vault-Grenzen)
 *  und darf den Import nicht abbrechen. */
function ziel(typ: string, quellId: string | null | undefined): string | null {
  if (!quellId) return null;
  return zuordnung.get(schluessel(typ, quellId)) ?? null;
}

// ── Werte, die die Datenbank nur in bestimmten Auspraegungen annimmt ────────
//
// Datenbank-CHECKs sind hier keine Formalie: die Schreibweisen der beiden
// Programme sind IDENTISCH gedacht, aber ein Vault ist eine Ansammlung von
// Dateien, die jemand von Hand bearbeitet haben kann. Ein `intern` statt
// `Intern` in einer einzigen Team-Datei liess den ganzen Import mit einem
// Postgres-Stacktrace abbrechen — gemessen beim ersten Lauf gegen den
// Beispiel-Vault.
//
// Deshalb: was passt, wird uebernommen; was nicht passt, wird auf den Ersatz
// gesetzt UND im Bericht genannt. Ein stillschweigend verworfener Wert waere
// schlimmer als der Abbruch.
function nurErlaubt<T extends string>(
  wert: unknown,
  erlaubte: readonly T[],
  ersatz: T | null,
  kontext: string,
): T | null {
  const s = typeof wert === "string" ? wert.trim() : "";
  if (!s) return ersatz;
  if ((erlaubte as readonly string[]).includes(s)) return s as T;
  // Gross-/Kleinschreibung ist der haeufigste Fall — die stillschweigend zu
  // korrigieren ist richtig, sie zu verwerfen waere Datenverlust.
  const treffer = erlaubte.find((e) => e.toLowerCase() === s.toLowerCase());
  if (treffer) return treffer;
  fehler.push(`${kontext}: Wert "${s}" ist hier nicht erlaubt → ${ersatz === null ? "leer" : ersatz}`);
  return ersatz;
}

const MITGLIEDSART = ["Intern", "Planer", "Ausführende", "Behörde", "Lieferant", "Bauherr"] as const;
const BESPRECHUNGSART = [
  "Bauherrenmeeting",
  "Baubesprechung",
  "Subunternehmer",
  "Planung",
  "Behoerde",
  "Abnahme",
  "Sonstiges",
] as const;
const PHASENSTATUS = ["offen", "aktiv", "fertig"] as const;
const RECHNUNGSSTATUS = ["entwurf", "gestellt", "bezahlt"] as const;
const ENTSCHEIDUNGSSTATUS = ["entwurf", "bestaetigt"] as const;
const AUFGABENSTATUS = ["open", "in_progress", "done"] as const;

const jetzt = new Date().toISOString();
const zeit = (m: VaultMeta) => ({ erstellt: m.createdAt || jetzt, geaendert: m.updatedAt || m.createdAt || jetzt });

// ── Alles in EINER Transaktion ──────────────────────────────────────────────
//
// `db.begin()` gibt eine eigene Verbindung; alle Schreibvorgänge laufen über
// `sql`. Wirft irgendetwas, rollt Postgres das Ganze zurück.
try {
  await db.begin(async (sql) => {
  // ── 1. Firmen ─────────────────────────────────────────────────────────────
  {
    const z = zaehl("Firmen");
    for (const rec of records<{ name: string; address?: string; website?: string; notes?: string }>(
      "Team/_Firmen",
      "company",
    )) {
      z.gelesen++;
      if (ziel("company", rec.id)) {
        z.uebersprungen++;
        continue;
      }
      const id = crypto.randomUUID();
      const t = zeit(rec.meta);
      if (!TROCKEN) {
        await sql`
          INSERT INTO companies (id, name, address, website, notes, created_at, updated_at)
          VALUES (${id}, ${rec.data.name}, ${rec.data.address ?? null}, ${rec.data.website ?? null},
                  ${rec.data.notes ?? null}, ${t.erstellt}, ${t.geaendert})`;
      }
      merke("company", rec.id, id);
      z.geschrieben++;
    }
  }

  // ── 2. Team ───────────────────────────────────────────────────────────────
  {
    const z = zaehl("Team");
    for (const rec of records<{
      name: string;
      role?: string | null;
      email?: string | null;
      phone?: string | null;
      company?: string | null;
      companyId?: string | null;
      memberType?: string | null;
      hourlyRate?: number | null;
      contactLog?: unknown[];
    }>("Team", "team")) {
      z.gelesen++;
      if (ziel("team", rec.id)) {
        z.uebersprungen++;
        continue;
      }
      const id = crypto.randomUUID();
      const t = zeit(rec.meta);
      // ── Prüfen VOR dem Schreiben, nicht darin ────────────────────────────
      //
      // Beim ersten Bau standen die `nurErlaubt()`-Aufrufe innerhalb des
      // INSERT-Ausdrucks. Im Trockenlauf wird der übersprungen — also lief die
      // Prüfung dort nicht, und der Trockenlauf meldete WENIGER Probleme als
      // der echte Lauf danach fand. Ein Trockenlauf, dessen Bericht vom echten
      // abweicht, ist schlechter als keiner.
      const art = nurErlaubt(rec.data.memberType, MITGLIEDSART, null, `Team "${rec.data.name}"`);
      if (!TROCKEN) {
        await sql`
          INSERT INTO team_members (id, name, role, email, phone, company, company_id, member_type,
                                    hourly_rate, contact_log, created_at, updated_at)
          VALUES (${id}, ${rec.data.name}, ${rec.data.role ?? null}, ${rec.data.email ?? null},
                  ${rec.data.phone ?? null}, ${rec.data.company ?? null},
                  ${ziel("company", rec.data.companyId)}, ${art},
                  ${rec.data.hourlyRate ?? null}, ${JSON.stringify(rec.data.contactLog ?? [])}::jsonb,
                  ${t.erstellt}, ${t.geaendert})`;
      }
      merke("team", rec.id, id);
      z.geschrieben++;
    }
  }

  // ── 3. Projekte ───────────────────────────────────────────────────────────
  //
  // Zwei Durchgänge: erst alle Projekte anlegen, dann die Verweise
  // untereinander (`parentId`) nachziehen. Ein Unterprojekt kann vor seinem
  // Elternprojekt in der Liste stehen.
  const projektNamen = unterordner(path.join(VAULT, "Projekte"));
  const projektRecords: { name: string; rec: VaultRecord<Record<string, unknown>> }[] = [];
  {
    const z = zaehl("Projekte");
    for (const name of projektNamen) {
      const datei = path.join(VAULT, "Projekte", name, "projekt.json");
      if (!fs.existsSync(datei)) {
        fehler.push(`Projekte/${name}: keine projekt.json — Ordner übersprungen`);
        continue;
      }
      let rec: VaultRecord<Record<string, unknown>>;
      try {
        rec = JSON.parse(fs.readFileSync(datei, "utf-8")) as VaultRecord<Record<string, unknown>>;
      } catch (e) {
        fehler.push(`Projekte/${name}/projekt.json: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      z.gelesen++;
      projektRecords.push({ name, rec });

      if (ziel("project", rec.id)) {
        z.uebersprungen++;
        continue;
      }

      const d = rec.data as Record<string, unknown>;
      const id = crypto.randomUUID();
      const t = zeit(rec.meta);

      // Die Projektnummer ist Pflicht und eindeutig (Migration 052). Der Vault
      // führt sie als optionales Feld — was fehlt oder unbrauchbar ist, bekommt
      // denselben Platzhalter wie ein Bestandsprojekt. Eine erfundene Nummer
      // wäre schlimmer als ein sichtbares Loch: sie sähe aus wie eine Aktennummer.
      const gepruefte = pruefeProjektnummer(d.projektnummer);
      let nummer = gepruefte.ok ? gepruefte.nummer : `${PLATZHALTER_PRAEFIX}${id.slice(0, 8)}`;
      // Und sie muss hier eindeutig sein: zwei Vaults können dieselbe Nummer
      // führen. Kollidiert sie, bekommt das Projekt den Platzhalter und der
      // Bericht nennt beide.
      if (gepruefte.ok && !TROCKEN) {
        const [belegt] = await sql`SELECT name FROM projects WHERE lower(projektnummer) = lower(${nummer}) LIMIT 1`;
        if (belegt) {
          fehler.push(
            `Projekt "${name}": Nummer ${nummer} ist hier schon an "${String(belegt.name)}" vergeben — ` +
              `Platzhalter gesetzt, bitte nachtragen`,
          );
          nummer = `${PLATZHALTER_PRAEFIX}${id.slice(0, 8)}`;
        }
      }

      // Ein gleichnamiges Projekt im PAPIERKORB blockiert den eindeutigen
      // Namen genauso wie ein aktives — deshalb ohne `deleted_at`-Filter
      // prüfen und den Namen sonst eindeutig machen, statt abzubrechen.
      let projektName = String(d.name ?? name);
      if (!TROCKEN) {
        const [gleich] = await sql`SELECT id FROM projects WHERE name = ${projektName} LIMIT 1`;
        if (gleich) {
          projektName = `${projektName} (übernommen ${id.slice(0, 4)})`;
          fehler.push(`Projekt "${String(d.name ?? name)}" existiert hier bereits — übernommen als "${projektName}"`);
        }
      }

      if (!TROCKEN) {
        await sql`
          INSERT INTO projects (id, name, description, status, color, tags, projektnummer, bauherr, standort,
                                projektart, nutzung, phase, start_date, end_date, budget, budget_used,
                                created_by, created_at, updated_at)
          VALUES (${id}, ${projektName}, ${(d.description as string) ?? null}, ${(d.status as string) || "aktiv"},
                  ${(d.color as string) ?? null}, ${(d.tags as string[]) ?? []}, ${nummer},
                  ${(d.bauherr as string) ?? null}, ${(d.standort as string) ?? null},
                  ${(d.projektart as string) ?? null}, ${(d.nutzung as string) ?? null},
                  ${(d.phase as string) ?? null}, ${datumOptional(d.startDate, "Projekt", projektName)},
                  ${datumOptional(d.endDate, "Projekt", projektName)}, ${(d.budget as number) ?? null},
                  ${(d.budgetUsed as number) ?? null}, ${alsBenutzerId}, ${t.erstellt}, ${t.geaendert})`;
      }
      merke("project", rec.id, id);
      z.geschrieben++;
    }

    // Verweise untereinander nachziehen.
    if (!TROCKEN) {
      for (const { rec } of projektRecords) {
        const eigen = ziel("project", rec.id);
        if (!eigen) continue;
        const d = rec.data as Record<string, unknown>;
        const eltern = ziel("project", d.parentId as string);
        // `bauherr_id` zeigt auf ein TEAM-MITGLIED, nicht auf eine Firma —
        // beim ersten Bau stand hier `ziel("company", …)`, und der
        // Fremdschluessel hat es sofort abgelehnt. Der Desktop haelt es
        // genauso (`nameOfTeam(d.bauherrId)`).
        const bauherr = ziel("team", d.bauherrId as string);
        if (eltern || bauherr) {
          await sql`UPDATE projects SET parent_id = COALESCE(${eltern}, parent_id),
                                        bauherr_id = COALESCE(${bauherr}, bauherr_id)
                     WHERE id = ${eigen}::uuid`;
        }
      }
    }
  }

  /** Projekt-UUID zu einem Vault-Ordnernamen. */
  function projektIdVon(ordner: string): string | null {
    const rec = projektRecords.find((p) => p.name === ordner);
    return rec ? ziel("project", rec.rec.id) : null;
  }

  // ── 4. Phasen ─────────────────────────────────────────────────────────────
  {
    const z = zaehl("Phasen");
    for (const ordner of projektNamen) {
      const projektId = projektIdVon(ordner);
      for (const rec of records<Record<string, unknown>>(`Projekte/${ordner}/Phasen`, "phase")) {
        z.gelesen++;
        if (!projektId || ziel("phase", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        const status = nurErlaubt(d.status, PHASENSTATUS, "offen", `Phase "${String(d.name)}"`);
        if (!TROCKEN) {
          await sql`
            INSERT INTO project_phases (id, project_id, name, sort_order, status, progress_manual, fee_share,
                                        soll_start, soll_ende, ist_start, ist_ende, created_at, updated_at)
            VALUES (${id}, ${projektId}::uuid, ${String(d.name ?? "Phase")}, ${Number(d.sortOrder ?? 0)},
                    ${status}, ${(d.progressManual as number) ?? null},
                    ${Number(d.feeShare ?? 0)}, ${datumOptional(d.sollStart, "Phase", rec.id)},
                    ${datumOptional(d.sollEnde, "Phase", rec.id)},
                    ${datumOptional(d.istStart, "Phase", rec.id)},
                    ${datumOptional(d.istEnde, "Phase", rec.id)}, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("phase", rec.id, id);
        z.geschrieben++;
      }
    }
    // Phasen-Abhängigkeiten erst danach — sie zeigen auf andere Phasen.
    if (!TROCKEN) {
      for (const ordner of projektNamen) {
        for (const rec of records<Record<string, unknown>>(`Projekte/${ordner}/Phasen`, "phase")) {
          const eigen = ziel("phase", rec.id);
          const abhaengig = ziel("phase", rec.data.dependsOnPhaseId as string);
          if (eigen && abhaengig) {
            await sql`UPDATE project_phases SET depends_on_phase_id = ${abhaengig}::uuid WHERE id = ${eigen}::uuid`;
          }
        }
      }
    }
  }

  // ── 5. Aufgaben ───────────────────────────────────────────────────────────
  {
    const z = zaehl("Aufgaben");
    const quellen: { relDir: string; projektId: string | null }[] = [
      { relDir: "Aufgaben", projektId: null },
      ...projektNamen.map((o) => ({ relDir: `Projekte/${o}/Aufgaben`, projektId: projektIdVon(o) })),
    ];
    for (const { relDir, projektId } of quellen) {
      for (const rec of records<Record<string, unknown>>(relDir, "task")) {
        z.gelesen++;
        if (ziel("task", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        // Migration 051 hat einen CHECK auf den Status. Der Vault führt
        // dieselben drei Werte; alles andere wird auf `open` gesetzt statt den
        // Import daran scheitern zu lassen.
        const status = nurErlaubt(d.status, AUFGABENSTATUS, "open", `Aufgabe "${String(d.text).slice(0, 40)}"`);
        // (siehe den Kasten bei Team: die Prüfung steht bewusst VOR dem INSERT)
        if (!TROCKEN) {
          await sql`
            INSERT INTO tasks (id, text, status, priority, assignee, assignee_id, date, location,
                               project_id, phase_id, sort_order, completed_at, created_by, created_at, updated_at)
            VALUES (${id}, ${String(d.text ?? "")}, ${status}, ${(d.priority as string) ?? "mittel"},
                    ${(d.assignee as string) ?? null}, ${ziel("team", d.assigneeId as string)},
                    ${datumOptional(d.date, "Aufgabe", rec.id)}, ${(d.location as string) ?? null},
                    ${projektId}, ${ziel("phase", d.phaseId as string)}, ${Number(d.sortOrder ?? 0)},
                    ${(d.completedAt as string) ?? null}, ${alsBenutzerId}, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("task", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 6. Termine ────────────────────────────────────────────────────────────
  {
    const z = zaehl("Termine");
    const quellen: { relDir: string; projektId: string | null }[] = [
      { relDir: "Termine", projektId: null },
      ...projektNamen.map((o) => ({ relDir: `Projekte/${o}/Termine`, projektId: projektIdVon(o) })),
    ];
    for (const { relDir, projektId } of quellen) {
      for (const rec of records<Record<string, unknown>>(relDir, "termin")) {
        z.gelesen++;
        if (ziel("termin", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        const teilnehmer = ((d.assigneeIds as string[]) ?? []).map((q) => ziel("team", q)).filter(Boolean) as string[];

        // ── Die Quelle des Mischbestands ────────────────────────────────────
        //
        // Hier stand `String(d.datum ?? "")` — ungeprueft. Was im Vault stand,
        // stand danach in der Datenbank: `''`, `morgen`, `2026-04`, alles.
        // Solange `termine.datum` TEXT war, fiel das nie auf; seit Migration
        // 060 ist die Spalte `date`, und eine unlesbare Zeile brechte die
        // ganze Uebernahme ab.
        //
        // Uebersprungen und GEMELDET, nicht stillschweigend geraten: ein
        // Datum zu erfinden waere schlimmer als ein fehlender Termin, und
        // ohne Meldung wuesste niemand, dass etwas fehlt.
        const datum = pruefeDatum(d.datum, "Termin", rec.id);
        if (datum === null) {
          z.uebersprungen++;
          continue;
        }

        if (!TROCKEN) {
          await sql`
            INSERT INTO termine (id, text, datum, uhrzeit, endzeit, location, assignees, assignee_ids,
                                 project_id, phase_id, recurring, color, is_milestone, created_by, created_at, updated_at)
            VALUES (${id}, ${String(d.text ?? "")}, ${datum}, ${(d.uhrzeit as string) ?? null},
                    ${(d.endzeit as string) ?? null}, ${(d.location as string) ?? null},
                    ${(d.assignees as string[]) ?? []}, ${teilnehmer}::uuid[], ${projektId},
                    ${ziel("phase", d.phaseId as string)}, ${(d.recurring as string) ?? null},
                    ${(d.color as string) ?? null}, ${d.isMilestone === true}, ${alsBenutzerId},
                    ${t.erstellt}, ${t.geaendert})`;
        }
        merke("termin", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 7. Notizen ────────────────────────────────────────────────────────────
  {
    const z = zaehl("Notizen");
    const quellen: { relDir: string; projektId: string | null }[] = [
      { relDir: "Notizen", projektId: null },
      ...projektNamen.map((o) => ({ relDir: `Projekte/${o}/Notizen`, projektId: projektIdVon(o) })),
    ];
    for (const { relDir, projektId } of quellen) {
      for (const rec of records<Record<string, unknown>>(relDir, "note")) {
        z.gelesen++;
        // Geprüft wird über die QUELL-ID, nicht über den Titel. Die
        // Vorgängerfassung verglich Titel — projektübergreifend und ohne
        // Papierkorb-Filter. Bei einem Bestand mit vielen „Aktenvermerk"-Notizen
        // landete davon genau eine.
        if (ziel("note", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        if (!TROCKEN) {
          await sql`
            INSERT INTO notes (id, title, content, project_id, tags, source, created_by, created_at, updated_at)
            VALUES (${id}, ${String(d.title ?? "Ohne Titel")}, ${String(d.content ?? "")}, ${projektId},
                    ${(d.tags as string[]) ?? []}, ${(d.source as string) ?? "uebernahme"}, ${alsBenutzerId},
                    ${t.erstellt}, ${t.geaendert})`;
        }
        merke("note", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 8. Besprechungen ──────────────────────────────────────────────────────
  {
    const z = zaehl("Besprechungen");
    for (const ordner of projektNamen) {
      const projektId = projektIdVon(ordner);
      for (const rec of records<Record<string, unknown>>(`Projekte/${ordner}/Meetings`, "meeting")) {
        z.gelesen++;
        if (!projektId || ziel("meeting", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        const teilnehmer = ((d.attendeeIds as string[]) ?? []).map((q) => ziel("team", q)).filter(Boolean) as string[];
        const art = nurErlaubt(d.meetingType, BESPRECHUNGSART, null, `Besprechung "${String(d.title)}"`);
        const meetingDatum = pruefeDatum(d.date, "Besprechung", rec.id);
        if (meetingDatum === null) {
          z.uebersprungen++;
          continue;
        }
        if (!TROCKEN) {
          await sql`
            INSERT INTO meetings (id, project_id, meeting_date, start_time, end_time, title, meeting_type,
                                  location, attendee_ids, attendees_external, agenda, minutes, decisions,
                                  action_items, next_meeting_date, created_by, created_at, updated_at)
            VALUES (${id}, ${projektId}::uuid, ${meetingDatum}, ${(d.startTime as string) ?? null},
                    ${(d.endTime as string) ?? null}, ${String(d.title ?? "Besprechung")},
                    ${art}, ${(d.location as string) ?? null},
                    ${teilnehmer}::uuid[], ${(d.attendeesExternal as string[]) ?? []},
                    ${(d.agenda as string) ?? null}, ${(d.minutes as string) ?? null},
                    ${(d.decisions as string) ?? null},
                    ${JSON.stringify(d.actionItems ?? [])}::jsonb,
                    ${datumOptional(d.nextMeetingDate, "Besprechung", rec.id)},
                    ${alsBenutzerId}, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("meeting", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 9. Entscheidungen ─────────────────────────────────────────────────────
  {
    const z = zaehl("Entscheidungen");
    for (const ordner of projektNamen) {
      const projektId = projektIdVon(ordner);
      for (const rec of records<Record<string, unknown>>(`Projekte/${ordner}/Entscheidungen`, "entscheidung")) {
        z.gelesen++;
        if (!projektId || ziel("entscheidung", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        const beteiligte = ((d.beteiligteIds as string[]) ?? []).map((q) => ziel("team", q)).filter(Boolean) as string[];
        const status = nurErlaubt(d.status, ENTSCHEIDUNGSSTATUS, "entwurf", `Entscheidung "${String(d.titel)}"`);
        const entscheidungDatum = pruefeDatum(d.datum, "Entscheidung", rec.id);
        if (entscheidungDatum === null) {
          z.uebersprungen++;
          continue;
        }
        if (!TROCKEN) {
          await sql`
            INSERT INTO entscheidungen (id, project_id, datum, titel, begruendung, alternativen, beteiligte_ids,
                                        beteiligte_extern, status, related_meeting_id, created_by, created_at, updated_at)
            VALUES (${id}, ${projektId}::uuid, ${entscheidungDatum}, ${String(d.titel ?? "Entscheidung")},
                    ${(d.begruendung as string) ?? null}, ${JSON.stringify(d.alternativen ?? [])}::jsonb,
                    ${beteiligte}::uuid[], ${(d.beteiligteExtern as string[]) ?? []},
                    ${status}, ${ziel("meeting", d.relatedMeetingId as string)},
                    ${alsBenutzerId}, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("entscheidung", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 10. Bautagebuch ───────────────────────────────────────────────────────
  {
    const z = zaehl("Bautagebuch");
    for (const ordner of projektNamen) {
      const projektId = projektIdVon(ordner);
      for (const rec of records<Record<string, unknown>>(`Projekte/${ordner}/Bautagebuch`, "bautagebuch")) {
        z.gelesen++;
        if (!projektId || ziel("bautagebuch", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        const bautagDatum = pruefeDatum(d.date, "Bautagebuch-Eintrag", rec.id);
        if (bautagDatum === null) {
          z.uebersprungen++;
          continue;
        }
        if (!TROCKEN) {
          await sql`
            INSERT INTO bautagebuch (id, project_id, entry_date, weather, temperature_min, temperature_max,
                                     personnel, machines, activities, incidents, created_by, created_at, updated_at)
            VALUES (${id}, ${projektId}::uuid, ${bautagDatum}, ${(d.weather as string) ?? null},
                    ${(d.temperatureMin as number) ?? null}, ${(d.temperatureMax as number) ?? null},
                    ${JSON.stringify(d.personnel ?? [])}::jsonb, ${(d.machines as string) ?? null},
                    ${(d.activities as string) ?? null}, ${(d.incidents as string) ?? null},
                    ${alsBenutzerId}, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("bautagebuch", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 11. Rechnungen ────────────────────────────────────────────────────────
  {
    const z = zaehl("Rechnungen");
    for (const ordner of projektNamen) {
      const projektId = projektIdVon(ordner);
      for (const rec of records<Record<string, unknown>>(`Projekte/${ordner}/Rechnungen`, "invoice")) {
        z.gelesen++;
        if (!projektId || ziel("invoice", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        // Der Vault nennt die Positionen `positions`, das Schema hier
        // `positionen`. Wer das übersieht, bekommt Rechnungen ohne eine
        // einzige Position — ohne Fehler, ohne Meldung.
        const positionen = (d.positions as unknown[]) ?? [];
        const status = nurErlaubt(d.status, RECHNUNGSSTATUS, "entwurf", `Rechnung "${String(d.nummer ?? "")}"`);
        // `project_invoices.datum` darf leer sein — ein fehlendes Datum ist
        // hier kein Fehler, ein FALSCHES waere einer.
        const rechnungDatum = datumOptional(d.datum, "Rechnung", rec.id);
        if (!TROCKEN) {
          await sql`
            INSERT INTO project_invoices (id, project_id, phase_id, nummer, betrag, datum, status, note,
                                          positionen, created_at, updated_at)
            VALUES (${id}, ${projektId}::uuid, ${ziel("phase", d.phaseId as string)},
                    ${(d.nummer as string) ?? null}, ${Number(d.betrag ?? 0)}, ${rechnungDatum},
                    ${status}, ${(d.note as string) ?? null},
                    ${JSON.stringify(positionen)}::jsonb, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("invoice", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 12. Dokumente ─────────────────────────────────────────────────────────
  //
  // Der Vault legt die Datei selbst neben den Record; hier liegt sie als
  // `bytea` in der Datenbank. Fehlt die Datei, wird der Datensatz trotzdem
  // übernommen (Name, Projekt, Metadaten) und der Bericht nennt sie.
  {
    const z = zaehl("Dokumente");
    const quellen: { relDir: string; projektId: string | null }[] = [
      { relDir: "Dokumente", projektId: null },
      ...projektNamen.map((o) => ({ relDir: `Projekte/${o}/Dokumente`, projektId: projektIdVon(o) })),
    ];
    for (const { relDir, projektId } of quellen) {
      for (const rec of records<Record<string, unknown>>(relDir, "file")) {
        z.gelesen++;
        if (ziel("file", rec.id)) {
          z.uebersprungen++;
          continue;
        }
        const d = rec.data;
        const id = crypto.randomUUID();
        const t = zeit(rec.meta);
        const dateiname = String(d.filename ?? "unbenannt");
        const aufPlatte = path.join(VAULT, relDir, dateiname);
        let blob: Buffer | null = null;
        try {
          if (fs.existsSync(aufPlatte)) blob = fs.readFileSync(aufPlatte);
          else fehler.push(`${relDir}/${dateiname}: Datei fehlt — nur die Metadaten übernommen`);
        } catch (e) {
          fehler.push(`${relDir}/${dateiname}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!TROCKEN) {
          await sql`
            INSERT INTO files (id, project_id, filename, filepath, filetype, filesize, mime_type,
                               content_text, tags, uploaded_by, blob, created_at, updated_at)
            VALUES (${id}, ${projektId}, ${dateiname}, ${dateiname},
                    ${path.extname(dateiname).slice(1).toLowerCase() || null},
                    ${blob ? blob.length : Number(d.filesize ?? 0)}, ${(d.mimeType as string) ?? null},
                    ${(d.contentText as string) ?? null}, ${(d.tags as string[]) ?? []}, ${alsBenutzerId},
                    ${blob}, ${t.erstellt}, ${t.geaendert})`;
        }
        merke("file", rec.id, id);
        z.geschrieben++;
      }
    }
  }

  // ── 13. Projektzugriff ────────────────────────────────────────────────────
  //
  // Ohne diesen Schritt sieht nach dem Import NUR der Administrator etwas:
  // die Sichtbarkeit hängt an `user_projects`, und dort steht nichts.
  if (alsBenutzerId && !TROCKEN) {
    for (const { rec } of projektRecords) {
      const pid = ziel("project", rec.id);
      if (!pid) continue;
      await sql`
        INSERT INTO user_projects (user_id, project_id)
        VALUES (${alsBenutzerId}::uuid, ${pid}::uuid)
        ON CONFLICT DO NOTHING`;
    }
  }

  // ── 14. Zuordnung festhalten ──────────────────────────────────────────────
  if (!TROCKEN) {
    for (const z of neueZuordnungen) {
      await sql`
        INSERT INTO import_zuordnung (quelle, typ, quell_id, ziel_id)
        VALUES (${QUELLE}, ${z.typ}, ${z.quellId}, ${z.zielId}::uuid)
        ON CONFLICT DO NOTHING`;
    }
  }

  // ── Ungelesene Verzeichnisse sammeln ──────────────────────────────────────
  const bekannt = new Set<string>([...PROJEKT_MODULE]);
  for (const ordner of projektNamen) {
    for (const sub of unterordner(path.join(VAULT, "Projekte", ordner))) {
      if (!bekannt.has(sub)) ungelesen.push(`Projekte/${ordner}/${sub}`);
    }
  }
  const obenBekannt = new Set(["Projekte", "Aufgaben", "Notizen", "Termine", "Dokumente", "Team", "_Einstellungen"]);
  for (const sub of unterordner(VAULT)) {
    if (!obenBekannt.has(sub)) ungelesen.push(sub);
  }
  });
} catch (e) {
  // ── Warum das hier abgefangen wird ────────────────────────────────────────
  //
  // Postgres wirft bei einer verletzten CHECK-Bedingung eine Ausnahme mit
  // vollem Stacktrace. Ungefangen sah der erste Lauf gegen den Beispiel-Vault
  // so aus, als sei das Programm kaputt — dabei war es genau umgekehrt: die
  // Transaktion hatte sauber zurueckgerollt und nichts geschrieben.
  //
  // Genau das muss die Meldung sagen.
  console.error("\n❌ Die Übernahme ist abgebrochen. Es wurde NICHTS geschrieben —");
  console.error("   die Transaktion ist vollständig zurückgerollt."+"\n");
  console.error("   Ursache: " + (e instanceof Error ? e.message : String(e)));
  if (fehler.length > 0) {
    console.error(`\n   Bis dahin gesammelte Hinweise (${fehler.length}):`);
    for (const f of fehler.slice(0, 20)) console.error("   " + f);
  }
  await closeDb();
  process.exit(1);
}

// ── Bericht ─────────────────────────────────────────────────────────────────

console.log("┌───────────────────┬──────────┬──────────────┬────────────────┐");
console.log("│ Art               │  gelesen │  geschrieben │  übersprungen  │");
console.log("├───────────────────┼──────────┼──────────────┼────────────────┤");
let summeGelesen = 0;
let summeGeschrieben = 0;
for (const [art, z] of zaehler) {
  summeGelesen += z.gelesen;
  summeGeschrieben += z.geschrieben;
  console.log(
    `│ ${art.padEnd(17)} │ ${String(z.gelesen).padStart(8)} │ ${String(z.geschrieben).padStart(12)} │ ${String(z.uebersprungen).padStart(14)} │`,
  );
}
console.log("└───────────────────┴──────────┴──────────────┴────────────────┘");

if (ungelesen.length > 0) {
  console.log(`\n⚠️  ${ungelesen.length} Verzeichnis(se) im Vault wurden NICHT gelesen:`);
  for (const u of [...new Set(ungelesen)].sort()) console.log(`   ${u}`);
  console.log("   Wenn dort Daten liegen, fehlen sie nach der Übernahme.");
}

if (fehler.length > 0) {
  console.log(`\n⚠️  ${fehler.length} Hinweis(e) und Fehler:`);
  for (const f of fehler.slice(0, 50)) console.log(`   ${f}`);
  if (fehler.length > 50) console.log(`   … und ${fehler.length - 50} weitere.`);
}

if (TROCKEN) {
  console.log(`\n🔍 Trockenlauf: ${summeGelesen} Datensätze gelesen, NICHTS geschrieben.`);
  console.log("   Für den echten Lauf dasselbe Kommando ohne --trocken.");
} else {
  console.log(`\n✅ Übernahme abgeschlossen: ${summeGeschrieben} von ${summeGelesen} Datensätzen geschrieben.`);
  if (!alsBenutzerId) {
    console.log("\n   ⚠️  Ohne --als hat kein Konto Zugriff auf die übernommenen Projekte");
    console.log("      und kein Datensatz hat einen Ersteller. Sichtbar ist alles nur");
    console.log("      für Administratoren. Das lässt sich später nur von Hand nachziehen.");
  }
}

await closeDb();
