// ============================================================
// PATIO — Positionskatalog (Migration 046)
// ============================================================
// Wiederkehrende Leistungen, damit sie nicht bei jeder Rechnung neu getippt
// werden muessen: „Einreichplanung, Stunde", „Bauaufsicht, Pauschale".
//
// Anders als die Rechnungspositionen (JSONB an der Rechnung) ist der Katalog
// eine eigene Tabelle: er wird einzeln bearbeitet, sortiert und durchsucht.
//
// Portiert aus `apps/patio-app-lokal`, wo er als JSON-Datei unter
// `_Einstellungen/` lag — uebernommen sind Feldschnitt und Semantik.
// ============================================================

import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { PositionskatalogItem, PositionskatalogInput, PositionskatalogRepository } from "./types.js";

function rowToItem(row: Record<string, unknown>): PositionskatalogItem {
  return {
    id: String(row.id),
    text: String(row.text),
    einheit: row.einheit ? String(row.einheit) : null,
    // NUMERIC kommt bei postgres.js als String — ohne Number() liefe die
    // Summenbildung in der Oberflaeche auf Zeichenverkettung hinaus.
    einzelpreis: Number(row.einzelpreis ?? 0),
    ustSatz: Number(row.ust_satz ?? 20),
    sortOrder: Number(row.sort_order ?? 0),
    rev: Number(row.rev ?? 1),
  };
}

/** Prueft die Eingabe und liefert im Fehlerfall den Text fuer den Benutzer. */
function pruefeEingabe(input: PositionskatalogInput, istNeu: boolean): string | null {
  if (istNeu || input.text !== undefined) {
    if (!input.text || !String(input.text).trim()) return "Ein Text ist erforderlich";
  }
  if (input.einzelpreis !== undefined && !Number.isFinite(input.einzelpreis)) {
    return "Einzelpreis muss eine Zahl sein";
  }
  if (input.ustSatz !== undefined) {
    if (!Number.isFinite(input.ustSatz) || input.ustSatz < 0 || input.ustSatz > 100) {
      return "Steuersatz muss zwischen 0 und 100 liegen";
    }
  }
  return null;
}

export const dbPositionskatalog: PositionskatalogRepository = {
  async list() {
    const db = getDb();
    const rows = await db`SELECT * FROM positionskatalog ORDER BY sort_order, text`;
    return rows.map((r) => rowToItem(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const [row] = await db`SELECT * FROM positionskatalog WHERE id = ${id} LIMIT 1`;
    return row ? rowToItem(row as Record<string, unknown>) : null;
  },

  async create(input) {
    const fehler = pruefeEingabe(input, true);
    if (fehler) return fehler;
    const db = getDb();
    const [row] = await db`
      INSERT INTO positionskatalog (text, einheit, einzelpreis, ust_satz, sort_order)
      VALUES (
        ${input.text!.trim()}, ${input.einheit ?? null},
        ${input.einzelpreis ?? 0}, ${input.ustSatz ?? 20}, ${input.sortOrder ?? 0}
      )
      RETURNING *
    `;
    return rowToItem(row as Record<string, unknown>);
  },

  async update(id, input) {
    const fehler = pruefeEingabe(input, false);
    if (fehler) return fehler;

    const db = getDb();
    const [current] = await db`SELECT * FROM positionskatalog WHERE id = ${id}`;
    if (!current) return null;

    // Konfliktschutz (Migration 042). Siehe src/data/konflikt.ts.
    pruefeRev(rowToItem(current as Record<string, unknown>), current.rev, input.rev);

    const text = input.text !== undefined ? input.text.trim() : current.text;
    const einheit = "einheit" in input ? (input.einheit ?? null) : current.einheit;
    const einzelpreis = input.einzelpreis !== undefined ? input.einzelpreis : current.einzelpreis;
    const ustSatz = input.ustSatz !== undefined ? input.ustSatz : current.ust_satz;
    const sortOrder = input.sortOrder !== undefined ? input.sortOrder : current.sort_order;

    const betroffen = await db`
      UPDATE positionskatalog SET
        text = ${text}, einheit = ${einheit}, einzelpreis = ${einzelpreis},
        ust_satz = ${ustSatz}, sort_order = ${sortOrder},
        rev = rev + 1, updated_at = NOW()
      WHERE id = ${id} AND rev = ${current.rev}
      RETURNING *
    `;
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT * FROM positionskatalog WHERE id = ${id}`;
      if (!jetzt) return null;
      throw new KonfliktFehler(rowToItem(jetzt as Record<string, unknown>), Number(current.rev), Number(jetzt.rev));
    }
    return rowToItem(betroffen[0] as Record<string, unknown>);
  },

  async delete(id) {
    const db = getDb();
    // Eintraege aus dem Katalog werden beim Uebernehmen in die Rechnung
    // KOPIERT, nicht referenziert. Ein geloeschter Katalogeintrag beruehrt
    // bestehende Rechnungen deshalb nicht — genau dafuer sind die Positionen
    // an der Rechnung eigenstaendig.
    const betroffen = await db`DELETE FROM positionskatalog WHERE id = ${id} RETURNING id`;
    return betroffen.length > 0;
  },
};
