// ============================================================
// PATIO — Volldump: der ganze Bestand als Markdown-Ordnerbaum
// ============================================================
//
// ── Wozu ───────────────────────────────────────────────────────────────────
//
// Das ist die Lock-in-Versicherung. Alles, was das Büro in PATIO eingegeben
// hat, in einem Format, das jeder Texteditor öffnet, ohne PATIO, ohne
// PostgreSQL, ohne Docker. Ein Ordnerbaum aus `.md`-Dateien, gezippt.
//
// Der Unterschied zur Sicherung: eine Sicherung ist ein Datenbankabzug — sie
// hilft, wenn PATIO wieder aufgesetzt wird. Der Volldump hilft, wenn PATIO
// NICHT mehr aufgesetzt wird. Beides ist nötig, keins ersetzt das andere.
//
// ── Warum nicht der vorhandene `export.md` ─────────────────────────────────
//
// `GET /projects/:name/export.md` ist ein kompaktes Dossier eines Projekts:
// Stammdaten, Notiz-TITEL, Aufgaben, Termine, Team. Fünf von fünfzehn
// Datenbereichen, und von den Notizen nur die Überschriften. Ihn stillschweigend
// zu erweitern hiesse, aus einer Übersicht ein Archiv zu machen — zwei Zwecke
// in einer Ausgabe, die dann für keinen mehr taugt.
// ============================================================

// archiver@8 bietet die Archiv-Klassen einzeln an; die frueher uebliche
// Aufruf-Form `archiver("zip", …)` gibt es in den Typen nicht mehr.
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { getDb } from "../db/client.js";
import { alsDokumentwert, alsDateinamensteil } from "../data/projektnummer.js";
import { alsIso } from "../data/zeitstempel.js";

/** Markdown-sichere Zelle. Ein `|` im Freitext zerlegt sonst die Tabelle. */
function zelle(v: unknown): string {
  const s = v === null || v === undefined || v === "" ? "—" : String(v);
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tabelle(zeilen: [string, unknown][]): string {
  return ["| Feld | Wert |", "|---|---|", ...zeilen.map(([k, v]) => `| ${k} | ${zelle(v)} |`)].join("\n");
}

function datum(v: unknown): string {
  const iso = alsIso(v);
  if (!iso) return "—";
  const t = iso.slice(0, 10);
  return `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}`;
}

/**
 * Ein `jsonb`-Feld als Liste.
 *
 * Der Treiber liefert `jsonb` je nach Spalte mal als Array, mal als
 * Zeichenkette — beim ersten Lauf ist `personnel.map is not a function`
 * geflogen, obwohl dieselbe Bauform bei `positionen` funktionierte. Ein
 * Volldump, der an einem einzelnen Bautagebuch-Eintrag abbricht, wäre die
 * schlechteste Stelle dafür.
 */
function alsListe<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const g = JSON.parse(v);
      return Array.isArray(g) ? (g as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Dateiname für einen Ordner- oder Dateieintrag im Archiv. */
function sicher(name: string, ersatz = "ohne-namen"): string {
  const s = alsDateinamensteil(String(name ?? "")).trim();
  return s || ersatz;
}

/**
 * Schreibt den gesamten sichtbaren Bestand als ZIP in einen Stream.
 *
 * @param sichtbareProjekte `"all"` für Administratoren, sonst die Liste der
 *        Projekt-IDs. Der Volldump ist KEIN Weg an den Rechten vorbei — er
 *        enthält genau das, was der Fragende auch einzeln abrufen dürfte.
 * @param mitGeld Ob Beträge mitgehen (Geld-Recht, Migration 043). Ein ZIP ist
 *        kein JSON: der Antwort-Filter sieht es nicht.
 */
export async function volldumpAlsZip(sichtbareProjekte: string[] | "all", mitGeld: boolean): Promise<PassThrough> {
  const db = getDb();
  const strom = new PassThrough();
  const zip = new ZipArchive({ zlib: { level: 9 } });
  zip.pipe(strom);

  // Der Aufbau läuft asynchron weiter, während der Aufrufer schon streamt.
  void (async () => {
    try {
      const nurSichtbar = sichtbareProjekte !== "all";
      const ids = nurSichtbar ? (sichtbareProjekte as string[]) : [];

      const projekte = nurSichtbar
        ? await db`SELECT * FROM projects WHERE deleted_at IS NULL AND id = ANY(${ids}::uuid[]) ORDER BY name`
        : await db`SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY name`;

      const heute = new Date().toISOString().slice(0, 10);
      zip.append(
        [
          "# PATIO — Volldump",
          "",
          `Erzeugt am ${datum(heute)}.`,
          "",
          `${projekte.length} Projekt(e). Ein Ordner je Projekt, darin eine Datei je Bereich.`,
          "",
          "Dieser Ordnerbaum ist bewusst **ohne PATIO lesbar**: reiner Text, keine",
          "Datenbank, kein Programm. Er ersetzt keine Sicherung — eine Sicherung",
          "hilft, wenn PATIO wieder aufgesetzt wird; dieser Baum hilft, wenn es",
          "nicht mehr aufgesetzt wird.",
          "",
          mitGeld ? "" : "> Beträge fehlen: das ausführende Konto hat kein Geld-Recht.",
        ].join("\n"),
        { name: "LIESMICH.md" },
      );

      for (const p of projekte) {
        const pid = String(p.id);
        const nummer = alsDokumentwert(p.projektnummer ? String(p.projektnummer) : null);
        const ordner = sicher(`${nummer ? nummer + " " : ""}${String(p.name)}`, "projekt");

        // ── Stammdaten ────────────────────────────────────────────────────
        zip.append(
          [
            `# ${p.name}`,
            "",
            tabelle([
              ["Projektnummer", nummer || "—"],
              ["Status", p.status],
              ["Bauherr", p.bauherr],
              ["Standort", p.standort],
              ["Projektart", p.projektart],
              ["Nutzung", p.nutzung],
              ["Phase", p.phase],
              ["Start", datum(p.start_date)],
              ["Ende", datum(p.end_date)],
              ...(mitGeld ? ([["Budget", p.budget]] as [string, unknown][]) : []),
            ]),
            "",
            p.description ? `## Beschreibung\n\n${p.description}` : "",
          ].join("\n"),
          { name: `${ordner}/Stammdaten.md` },
        );

        // ── Notizen: jede als eigene Datei, MIT Inhalt ─────────────────────
        //
        // Der kompakte `export.md` liefert von Notizen nur die Titel. Für ein
        // Archiv ist das wertlos: der Inhalt IST die Notiz.
        const notizen = await db`
          SELECT title, content, created_at FROM notes
           WHERE project_id = ${pid}::uuid AND deleted_at IS NULL ORDER BY created_at`;
        notizen.forEach((n, i) => {
          const dateiname = sicher(`${String(i + 1).padStart(3, "0")} ${String(n.title)}`, `notiz-${i + 1}`);
          zip.append(`# ${n.title}\n\n_${datum(n.created_at)}_\n\n${n.content ?? ""}\n`, {
            name: `${ordner}/Notizen/${dateiname}.md`,
          });
        });

        // ── Die Listen: je Bereich eine Datei ──────────────────────────────
        const aufgaben = await db`
          SELECT t.text, t.status, t.date, t.assignee, tm.name AS zugewiesen
            FROM tasks t LEFT JOIN team_members tm ON tm.id = t.assignee_id
           WHERE t.project_id = ${pid}::uuid AND t.deleted_at IS NULL
           ORDER BY t.status, t.date NULLS LAST`;
        if (aufgaben.length) {
          zip.append(
            [
              "# Aufgaben",
              "",
              "| Aufgabe | Status | Fällig | Zugewiesen |",
              "|---|---|---|---|",
              ...aufgaben.map(
                (t) =>
                  `| ${zelle(t.text)} | ${zelle(t.status)} | ${t.date ? datum(t.date) : "—"} | ${zelle(t.zugewiesen ?? t.assignee)} |`,
              ),
            ].join("\n"),
            { name: `${ordner}/Aufgaben.md` },
          );
        }

        const termine = await db`
          SELECT text, datum, uhrzeit, endzeit, location FROM termine
           WHERE project_id = ${pid}::uuid AND deleted_at IS NULL ORDER BY datum`;
        if (termine.length) {
          zip.append(
            [
              "# Termine",
              "",
              "| Datum | Zeit | Termin | Ort |",
              "|---|---|---|---|",
              ...termine.map(
                (t) =>
                  `| ${zelle(t.datum)} | ${zelle([t.uhrzeit, t.endzeit].filter(Boolean).join("–"))} | ${zelle(t.text)} | ${zelle(t.location)} |`,
              ),
            ].join("\n"),
            { name: `${ordner}/Termine.md` },
          );
        }

        // ── Besprechungen: je Protokoll eine Datei ─────────────────────────
        const meetings = await db`
          SELECT title, meeting_date, start_time, end_time, location, agenda, minutes, decisions, attendees_external
            FROM meetings WHERE project_id = ${pid}::uuid ORDER BY meeting_date`;
        meetings.forEach((m) => {
          const dateiname = sicher(`${alsIso(m.meeting_date)?.slice(0, 10) ?? ""} ${String(m.title)}`, "besprechung");
          zip.append(
            [
              `# ${m.title}`,
              "",
              tabelle([
                ["Datum", datum(m.meeting_date)],
                ["Zeit", [m.start_time, m.end_time].filter(Boolean).join("–")],
                ["Ort", m.location],
                ["Externe Teilnehmer", alsListe<string>(m.attendees_external).join(", ")],
              ]),
              m.agenda ? `\n## Agenda\n\n${m.agenda}` : "",
              m.minutes ? `\n## Protokoll\n\n${m.minutes}` : "",
              m.decisions ? `\n## Beschlüsse\n\n${m.decisions}` : "",
            ].join("\n"),
            { name: `${ordner}/Besprechungen/${dateiname}.md` },
          );
        });

        // ── Entscheidungen ────────────────────────────────────────────────
        const entscheidungen = await db`
          SELECT datum, titel, begruendung, status, beteiligte_extern FROM entscheidungen
           WHERE project_id = ${pid}::uuid ORDER BY datum`;
        if (entscheidungen.length) {
          zip.append(
            [
              "# Entscheidungen",
              "",
              ...entscheidungen.flatMap((e) => [
                `## ${datum(e.datum)} — ${e.titel}`,
                "",
                `Status: ${zelle(e.status)}`,
                alsListe<string>(e.beteiligte_extern).length
                  ? `Beteiligt: ${alsListe<string>(e.beteiligte_extern).join(", ")}`
                  : "",
                "",
                e.begruendung ? String(e.begruendung) : "_ohne Begründung_",
                "",
              ]),
            ].join("\n"),
            { name: `${ordner}/Entscheidungen.md` },
          );
        }

        // ── Bautagebuch: je Tag ein Abschnitt ─────────────────────────────
        const bautage = await db`
          SELECT entry_date, weather, temperature_min, temperature_max, machines, activities, incidents, personnel
            FROM bautagebuch WHERE project_id = ${pid}::uuid ORDER BY entry_date`;
        if (bautage.length) {
          zip.append(
            [
              "# Bautagebuch",
              "",
              ...bautage.flatMap((b) => {
                const personal = alsListe<{ name?: string; hours?: number }>(b.personnel);
                return [
                  `## ${datum(b.entry_date)}`,
                  "",
                  tabelle([
                    ["Wetter", b.weather],
                    ["Temperatur", [b.temperature_min, b.temperature_max].filter((x) => x !== null).join(" bis ")],
                    ["Maschinen", b.machines],
                    ["Personal", personal.map((p) => `${p.name}${p.hours ? ` (${p.hours} h)` : ""}`).join(", ")],
                  ]),
                  b.activities ? `\n**Tätigkeiten:** ${b.activities}` : "",
                  b.incidents ? `\n**Vorkommnisse:** ${b.incidents}` : "",
                  "",
                ];
              }),
            ].join("\n"),
            { name: `${ordner}/Bautagebuch.md` },
          );
        }

        // ── Leistungsphasen ───────────────────────────────────────────────
        const phasen = await db`
          SELECT name, status, sort_order, fee_share, soll_start, soll_ende, ist_start, ist_ende
            FROM project_phases WHERE project_id = ${pid}::uuid ORDER BY sort_order`;
        if (phasen.length) {
          zip.append(
            [
              "# Leistungsphasen",
              "",
              `| Phase | Status | Soll | Ist |${mitGeld ? " Anteil |" : ""}`,
              `|---|---|---|---|${mitGeld ? "---|" : ""}`,
              ...phasen.map(
                (f) =>
                  `| ${zelle(f.name)} | ${zelle(f.status)} | ${datum(f.soll_start)} – ${datum(f.soll_ende)} | ` +
                  `${datum(f.ist_start)} – ${datum(f.ist_ende)} |${mitGeld ? ` ${zelle(f.fee_share)} % |` : ""}`,
              ),
            ].join("\n"),
            { name: `${ordner}/Leistungsphasen.md` },
          );
        }

        // ── Rechnungen — nur mit Geld-Recht ───────────────────────────────
        if (mitGeld) {
          const rechnungen = await db`
            SELECT nummer, datum, status, betrag, note, positionen FROM project_invoices
             WHERE project_id = ${pid}::uuid ORDER BY datum NULLS LAST, nummer`;
          if (rechnungen.length) {
            zip.append(
              [
                "# Rechnungen",
                "",
                ...rechnungen.flatMap((r) => {
                  const pos = alsListe<{ text?: string; menge?: number; einzelpreis?: number }>(r.positionen);
                  return [
                    `## ${r.nummer ?? "(ohne Nummer)"}`,
                    "",
                    tabelle([
                      ["Datum", datum(r.datum)],
                      ["Status", r.status],
                      ["Betrag (netto)", r.betrag],
                      ["Anmerkung", r.note],
                    ]),
                    ...(pos.length
                      ? [
                          "",
                          "| Position | Menge | Einzelpreis |",
                          "|---|---|---|",
                          ...pos.map((x) => `| ${zelle(x.text)} | ${zelle(x.menge)} | ${zelle(x.einzelpreis)} |`),
                        ]
                      : []),
                    "",
                  ];
                }),
              ].join("\n"),
              { name: `${ordner}/Rechnungen.md` },
            );
          }
        }

        // ── Dokumente: die Dateien selbst ─────────────────────────────────
        //
        // Ein Archiv ohne die Pläne wäre kein Archiv. Der Inhalt liegt als
        // `bytea` in der Datenbank — hier geht er als echte Datei mit.
        const dateien = await db`
          SELECT filename, blob FROM files WHERE project_id = ${pid}::uuid AND blob IS NOT NULL ORDER BY filename`;
        for (const d of dateien) {
          zip.append(Buffer.from(d.blob as Uint8Array), { name: `${ordner}/Dokumente/${sicher(String(d.filename))}` });
        }
      }

      // ── Team und Firmen: einmal fürs ganze Haus ───────────────────────────
      const team = await db`SELECT name, role, email, phone, company, member_type FROM team_members ORDER BY name`;
      if (team.length) {
        zip.append(
          [
            "# Team",
            "",
            "| Name | Rolle | E-Mail | Telefon | Firma | Art |",
            "|---|---|---|---|---|---|",
            ...team.map(
              (m) =>
                `| ${zelle(m.name)} | ${zelle(m.role)} | ${zelle(m.email)} | ${zelle(m.phone)} | ` +
                `${zelle(m.company)} | ${zelle(m.member_type)} |`,
            ),
          ].join("\n"),
          { name: "Team.md" },
        );
      }

      await zip.finalize();
    } catch (err) {
      // `archiver` bricht den Stream ab; der Aufrufer sieht ein unvollständiges
      // ZIP statt einer fertigen Datei. Das ist richtig so: ein Archiv, dem
      // stillschweigend die Hälfte fehlt, wäre schlimmer.
      zip.abort();
      strom.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return strom;
}
