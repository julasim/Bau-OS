// ============================================================
// PATIO — KI-Freigabe (Migration 059)
// ============================================================
// Was darf ein Sprachmodell sehen? Diese Datei ist die EINZIGE Stelle, die
// das beantwortet. Das Dossier (`src/mcp/dossier.ts`) fragt hier und nirgends
// sonst.
//
// DENY BY DEFAULT: kein Eintrag heisst nicht freigegeben.
// ============================================================

import { getDb } from "../db/client.js";

/** Datenkategorien je Projekt — entlang der bestehenden Domänen. */
export const KI_KATEGORIEN = [
  "stammdaten",
  "phasen",
  "aufgaben",
  "termine",
  "notizen",
  "meetings",
  "bautagebuch",
  "entscheidungen",
  "rechnungen",
  "beteiligte",
] as const;
export type KiKategorie = (typeof KI_KATEGORIEN)[number];

/**
 * Umgang mit personenbezogenen Daten. Wirkt **quer über alle** freigegebenen
 * Kategorien — eine Freigabe für „Besprechungen" gibt sonst über die
 * Teilnehmerlisten das halbe Adressbuch mit heraus.
 */
export type PersonendatenStufe = "keine" | "namen-ohne-kontakt" | "alle";

export interface KiFreigabe {
  /** Hauptschalter. Aus = es entsteht kein Dossier, egal was sonst eingestellt ist. */
  aktiv: boolean;
  personendaten: PersonendatenStufe;
  /** projectId → freigegebene Kategorien. Kein Eintrag = gesperrt. */
  projekte: Record<string, KiKategorie[]>;
}

// `standardFreigabe()` stand hier und hatte keinen Aufrufer: `lesen()` baut
// den Standard selbst aus den gelesenen Werten (aus = gesperrt,
// „namen-ohne-kontakt" als Stufe). Zwei Quellen fuer dieselbe Vorgabe sind
// eine zu viel.

function istStufe(v: unknown): v is PersonendatenStufe {
  return v === "keine" || v === "namen-ohne-kontakt" || v === "alle";
}

function istKategorie(v: unknown): v is KiKategorie {
  return typeof v === "string" && (KI_KATEGORIEN as readonly string[]).includes(v);
}

export const dbKiFreigabe = {
  /**
   * Liest die Freigabe.
   *
   * Unbekannte Kategorien und Stufen werden beim LESEN verworfen — nicht erst
   * beim Schreiben. Der Grund: ein Stand, den eine neuere PATIO-Version
   * geschrieben hat (oder jemand von Hand in der Datenbank), darf nicht mehr
   * freigeben, als DIESE Version versteht. Die CHECK-Bedingungen in Migration
   * 059 decken den Regelfall ab; das hier ist die zweite Linie.
   */
  async lesen(): Promise<KiFreigabe> {
    const db = getDb();
    const [kopf] = await db`SELECT aktiv, personendaten FROM ki_freigabe WHERE id = 1`;
    const zeilen = await db`SELECT project_id, kategorie FROM ki_freigabe_projekt`;

    const projekte: Record<string, KiKategorie[]> = {};
    for (const z of zeilen) {
      if (!istKategorie(z.kategorie)) continue;
      const pid = String(z.project_id);
      (projekte[pid] ??= []).push(z.kategorie);
    }

    return {
      aktiv: kopf?.aktiv === true,
      personendaten: istStufe(kopf?.personendaten) ? kopf.personendaten : "namen-ohne-kontakt",
      projekte,
    };
  },

  /** Hauptschalter und Personendaten-Stufe. */
  async kopfSchreiben(patch: { aktiv?: boolean; personendaten?: PersonendatenStufe }): Promise<KiFreigabe> {
    const db = getDb();
    if (patch.aktiv !== undefined) {
      await db`UPDATE ki_freigabe SET aktiv = ${patch.aktiv}, aktualisiert_am = now() WHERE id = 1`;
    }
    if (patch.personendaten !== undefined && istStufe(patch.personendaten)) {
      await db`UPDATE ki_freigabe SET personendaten = ${patch.personendaten}, aktualisiert_am = now() WHERE id = 1`;
    }
    return this.lesen();
  },

  /**
   * Setzt die Kategorien EINES Projekts — als Ganzes.
   *
   * Ersetzen statt Ergänzen: die Oberfläche zeigt eine Kreuztabelle, und was
   * dort abgehakt ist, ist die Wahrheit. Ein „Ergänzen" ließe entzogene
   * Kategorien stehen, wenn ein Häkchen beim Senden verlorengeht.
   */
  async projektSchreiben(projectId: string, kategorien: KiKategorie[]): Promise<void> {
    const gueltig = [...new Set(kategorien.filter(istKategorie))];
    const db = getDb();
    await db.begin(async (sql) => {
      await sql`DELETE FROM ki_freigabe_projekt WHERE project_id = ${projectId}::uuid`;
      for (const k of gueltig) {
        await sql`INSERT INTO ki_freigabe_projekt (project_id, kategorie) VALUES (${projectId}::uuid, ${k})`;
      }
    });
  },

  /** Ist diese Kategorie für dieses Projekt frei? Berücksichtigt den
   *  Hauptschalter — er sticht alles. */
  async istFrei(freigabe: KiFreigabe, projectId: string, kategorie: KiKategorie): Promise<boolean> {
    if (!freigabe.aktiv) return false;
    return (freigabe.projekte[projectId] ?? []).includes(kategorie);
  },
};
