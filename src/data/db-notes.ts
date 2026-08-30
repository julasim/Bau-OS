// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { escapeLike } from "./sql-like.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { NoteMeta, NoteRepository } from "./types.js";
import { alsIso } from "./zeitstempel.js";

/** Loest eine Angabe auf GENAU EINE Notiz auf — oder auf keine.
 *
 *  Alle vier Zugriffe (`read`, `append`, `update`, `delete`) suchten die
 *  Notiz vorher jeder fuer sich mit derselben Bedingung:
 *
 *      WHERE id::text = $1 OR title = $1 OR title LIKE $1 || '%'
 *      ORDER BY created_at DESC LIMIT 1
 *
 *  Daraus folgten zwei Fehler, die beide STILL zuschlugen:
 *
 *  1. **Der Anfangs-Treffer schlug den exakten.** Sortiert wurde nur nach
 *     Alter. Gibt es „Besprechung" und „Besprechung Bauherr", traf
 *     `update("Besprechung", …)` die juengere der beiden — also womoeglich
 *     die falsche. Der Aufrufer bekam `true` und hielt es fuer erledigt.
 *  2. **`delete` hatte gar kein `LIMIT`.** Die Bedingung traf beide, geloescht
 *     wurden beide, zurueckgemeldet nur die erste. Wer „Abnahme" loeschte,
 *     verlor „Abnahme Rohbau" und „Abnahme Fenster" gleich mit.
 *
 *  Die Aufloesung ist jetzt gestuft und liefert immer eine ID, mit der die
 *  eigentliche Anweisung dann punktgenau arbeitet:
 *
 *      Rang 0  die ID selbst
 *      Rang 1  der exakte Titel
 *      Rang 2  ein eindeutiger Titelanfang
 *
 *  **Bei mehrdeutigem Anfang wird nicht geraten**, sondern `null` geliefert.
 *  Das ist die pragmatische Entscheidung an dieser Stelle: eine Notiz nicht zu
 *  finden ist ein sichtbarer, korrigierbarer Zustand — die falsche zu
 *  ueberschreiben ist ein unsichtbarer Datenverlust. Der Aufrufer kann den
 *  vollen Titel oder die ID nachreichen.
 *
 *  Die Maskierung von `%` und `_` ist kein Randfall: Notiztitel wie
 *  `Rohbau_Ost` oder `LP3_Einreichung` sind im Buero der Normalfall, und `_`
 *  matcht sonst jedes beliebige Zeichen.
 *
 *  BEWUSST OFFEN — zwei Notizen mit dem GLEICHEN Titel: dann gewinnt die
 *  juengere, ohne Rueckfrage. Anders als beim mehrdeutigen Anfang ist das hier
 *  die bessere Wahl: die Oberflaeche adressiert Notizen ueber ihren Titel
 *  (`web/src/views/notes-v2/NoteDetail.vue`), ein `null` wuerde also BEIDE
 *  Notizen unerreichbar machen statt nur die eine zu schuetzen.
 *
 *  Sauber loesen laesst sich das erst, wenn die Oberflaeche ueber die ID
 *  adressiert — dafuer muesste `listDetailed()` die ID mitliefern, was sie
 *  heute nicht tut. Bis dahin ist der Zustand dokumentiert und durch einen
 *  Test festgehalten, statt sich zufaellig zu ergeben. */
async function findeNotiz(nameOrPath: string): Promise<{ id: string; title: string; rev: number } | null> {
  const db = getDb();
  // id::text statt id — sonst wirft Postgres bei Nicht-UUID-Eingaben
  // "invalid input syntax for type uuid", und die Notiz waere weder ueber
  // ihren Titel noch ueber ihren Dateinamen erreichbar.
  //
  // `id DESC` als letztes Sortierkriterium: ohne einen Tiebreaker hat die
  // Abfrage bei gleichem `created_at` KEIN definiertes Ergebnis — Postgres
  // darf die Zeilen dann in beliebiger Reihenfolge liefern, und welche Notiz
  // getroffen wird, haengt am Ausfuehrungsplan. Seit `save()` den Zeitstempel
  // der Datenbank ueberlaesst (Mikrosekunden statt Millisekunden) ist eine
  // Kollision praktisch ausgeschlossen; der Tiebreaker macht das Ergebnis
  // auch im Rest der Faelle STABIL statt zufaellig. Welche der beiden dann
  // gewinnt, ist willkuerlich — aber vorhersagbar, und darauf kommt es an.
  const rows = await db`
    SELECT id, title, rev,
           CASE WHEN id::text = ${nameOrPath} THEN 0
                WHEN title = ${nameOrPath} THEN 1
                ELSE 2 END AS rang
      FROM notes
     WHERE deleted_at IS NULL
       AND (id::text = ${nameOrPath}
        OR title = ${nameOrPath}
        OR title LIKE ${escapeLike(nameOrPath) + "%"})
     ORDER BY rang, created_at DESC, id DESC
  `;
  if (rows.length === 0) return null;

  const beste = rows[0];
  if (Number(beste.rang) === 2) {
    const anfangsTreffer = rows.filter((r) => Number(r.rang) === 2).length;
    if (anfangsTreffer > 1) return null; // mehrdeutig → nicht raten
  }
  return { id: String(beste.id), title: String(beste.title), rev: Number(beste.rev ?? 1) };
}

export const dbNotes: NoteRepository = {
  async save(content, project, createdById = null) {
    const db = getDb();
    const id = crypto.randomUUID();
    const title =
      content
        .split("\n")[0]
        .replace(/^#+\s*/, "")
        .slice(0, 100) || "Notiz";

    let projectId: string | null = null;
    if (project) {
      const [p] = await db`SELECT id FROM projects WHERE name = ${project} LIMIT 1`;
      projectId = p?.id ?? null;
    }

    // `source` stand hier auf 'bot' — ein Rest aus der Telegram-Aera, die mit
    // AP0 entfallen ist. Alles, was heute eine Notiz anlegt, kommt ueber die
    // Weboberflaeche; die Spalte hat dafuer bereits 'web' als Vorgabe.
    // `created_at`/`updated_at` bewusst NICHT mitgeben: die Spalten haben
    // `DEFAULT now()`, und Postgres liefert damit MIKROSEKUNDEN. Hier stand
    // ein JS-Zeitstempel (`new Date().toISOString()`) mit nur Millisekunden —
    // zwei schnell aufeinanderfolgende Notizen bekamen dadurch denselben
    // Wert, und `findeNotiz` (unten) konnte die juengere nicht mehr von der
    // aelteren unterscheiden.
    //
    // Gemessen am 30.08.2026 mit Postgres auf demselben Host, wie in der CI:
    // 20 von 20 Paaren hatten denselben `created_at`. Der zugehoerige Test
    // („nimmt bei zwei GLEICHEN Titeln die juengere") lief trotzdem lange
    // gruen — bei einem Seq-Scan liefert Postgres die Einfuegereihenfolge.
    // Verlassen kann man sich darauf nicht: in der CI ist es gekippt.
    await db`
      INSERT INTO notes (id, title, content, project_id, source, created_by, created_at, updated_at)
      VALUES (${id}, ${title}, ${content}, ${projectId}, 'web', ${createdById},
              clock_timestamp(), clock_timestamp())
    `;

    return id;
  },

  async list(limit = 10) {
    const db = getDb();
    const rows = await db`
      SELECT title, created_at FROM notes
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => String(r.title));
  },

  async listDetailed(limit = 50) {
    const db = getDb();
    const rows = await db`
      SELECT n.title, p.name as project_name, p.projektnummer AS project_nummer, n.created_by,
             n.created_at, n.updated_at, length(n.content) as size
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      WHERE n.deleted_at IS NULL
      ORDER BY n.updated_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      title: String(r.title),
      project: r.project_name ? String(r.project_name) : null,
      /** Die Projektnummer des Projekts (Migration 052). Sie steht neben
       *  dem Namen, weil die Oberflaeche sie ueberall dort zeigt, wo heute
       *  nur der Name stand — ohne sie muesste jede Ansicht sie einzeln
       *  nachschlagen. */
      projektnummer: r.project_nummer ? String(r.project_nummer) : null,
      createdAt: alsIso(r.created_at),
      updatedAt: alsIso(r.updated_at),
      size: Number(r.size || 0),
      createdById: r.created_by ? String(r.created_by) : null,
    }));
  },

  /** Der EINE Aufloeser. Alles, was eine Notiz ueber ihren Namen sucht, geht
   *  hierdurch — die Rechtepruefung ebenso wie das Lesen. Vorher gab es zwei
   *  Wege mit unterschiedlicher Sortierung, und bei gleichnamigen Notizen
   *  entschieden sie ueber verschiedene Zeilen. */
  async resolve(nameOrPath): Promise<NoteMeta | null> {
    const treffer = await findeNotiz(nameOrPath);
    if (!treffer) return null;
    const db = getDb();
    const [row] = await db`
      SELECT n.id, n.title, n.created_by, n.rev, p.name AS project_name, p.projektnummer AS project_nummer
        FROM notes n LEFT JOIN projects p ON p.id = n.project_id
       WHERE n.id = ${treffer.id} AND n.deleted_at IS NULL
       LIMIT 1
    `;
    if (!row) return null;
    return {
      id: String(row.id),
      title: String(row.title),
      project: row.project_name ? String(row.project_name) : null,
      /** Die Projektnummer des Projekts (Migration 052). Sie steht neben
       *  dem Namen, weil die Oberflaeche sie ueberall dort zeigt, wo heute
       *  nur der Name stand — ohne sie muesste jede Ansicht sie einzeln
       *  nachschlagen. */
      projektnummer: row.project_nummer ? String(row.project_nummer) : null,
      createdById: row.created_by ? String(row.created_by) : null,
      rev: Number(row.rev ?? 1),
    };
  },

  async readById(id) {
    const db = getDb();
    const [row] = await db`SELECT content, rev FROM notes WHERE id = ${id} AND deleted_at IS NULL`;
    return row ? { content: String(row.content), rev: Number(row.rev ?? 1) } : null;
  },

  async updateById(id, content, expectedRev) {
    const db = getDb();
    const [current] = await db`SELECT id, title, rev FROM notes WHERE id = ${id}`;
    if (!current) return false;

    // Konfliktschutz (Migration 042). Siehe src/data/konflikt.ts.
    const istRev = Number(current.rev ?? 1);
    pruefeRev({ id: String(current.id), title: String(current.title), rev: istRev }, istRev, expectedRev);

    const betroffen = await db`
      UPDATE notes SET content = ${content}, rev = rev + 1, updated_at = ${new Date().toISOString()}
      WHERE id = ${id} AND rev = ${istRev}
      RETURNING id
    `;
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT id, title, rev FROM notes WHERE id = ${id}`;
      if (!jetzt) return false;
      throw new KonfliktFehler(
        { id: String(jetzt.id), title: String(jetzt.title), rev: Number(jetzt.rev) },
        istRev,
        Number(jetzt.rev),
      );
    }
    return true;
  },

  /** Legt die Notiz in den Papierkorb (Migration 049) — sie verschwindet aus
   *  allen Listen und aus der Aufloesung, bleibt aber liegen. Endgueltig
   *  entfernt wird sie erst mit `purge()`. */
  async deleteById(id) {
    const db = getDb();
    const [row] = await db`
      UPDATE notes SET deleted_at = now()
       WHERE id = ${id} AND deleted_at IS NULL
      RETURNING title
    `;
    return row ? String(row.title) : null;
  },

  async listDeleted(sichtbareProjekte) {
    const db = getDb();
    const eingeschraenkt = Array.isArray(sichtbareProjekte);
    if (eingeschraenkt && sichtbareProjekte.length === 0) return [];
    const rows = eingeschraenkt
      ? await db`
          SELECT n.id, n.title AS titel, p.name AS project_name, p.projektnummer AS project_nummer, n.deleted_at, n.created_by
            FROM notes n LEFT JOIN projects p ON p.id = n.project_id
           WHERE n.deleted_at IS NOT NULL
             AND (n.project_id = ANY(${db.array(sichtbareProjekte)}::uuid[])
                  -- Datensaetze OHNE Projekt sind persoenlich. Sie muessen hier
                  -- durch, damit die Route sie ihrem Verfasser zeigen kann; wem
                  -- sie NICHT gehoeren, den filtert die Route heraus.
                  OR n.project_id IS NULL)
           ORDER BY n.deleted_at DESC`
      : await db`
          SELECT n.id, n.title AS titel, p.name AS project_name, p.projektnummer AS project_nummer, n.deleted_at, n.created_by
            FROM notes n LEFT JOIN projects p ON p.id = n.project_id
           WHERE n.deleted_at IS NOT NULL
           ORDER BY n.deleted_at DESC`;
    return rows.map((r) => ({
      id: String(r.id),
      titel: String(r.titel),
      projectName: r.project_name ? String(r.project_name) : null,
      projektnummer: r.project_nummer ? String(r.project_nummer) : null,
      geloeschtAm: alsIso(r.deleted_at),
      createdById: r.created_by ? String(r.created_by) : null,
    }));
  },

  async restore(id) {
    const db = getDb();
    const res = await db`UPDATE notes SET deleted_at = NULL WHERE id = ${id} AND deleted_at IS NOT NULL`;
    return res.count > 0;
  },

  async purge(id) {
    const db = getDb();
    const res = await db`DELETE FROM notes WHERE id = ${id} AND deleted_at IS NOT NULL`;
    return res.count > 0;
  },

  async read(nameOrPath) {
    const treffer = await findeNotiz(nameOrPath);
    if (!treffer) return null;
    const db = getDb();
    const [row] = await db`SELECT content FROM notes WHERE id = ${treffer.id}`;
    return row ? String(row.content) : null;
  },

  async readWithRev(nameOrPath) {
    const treffer = await findeNotiz(nameOrPath);
    if (!treffer) return null;
    const db = getDb();
    const [row] = await db`SELECT content, rev FROM notes WHERE id = ${treffer.id}`;
    return row ? { content: String(row.content), rev: Number(row.rev ?? 1) } : null;
  },

  async append(nameOrPath, content) {
    const db = getDb();
    const found = await findeNotiz(nameOrPath);
    if (!found) return false;
    const now = new Date();
    const time = now.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    const appendText = `\n**Nachtrag ${time}:** ${content}\n`;
    // Bewusst OHNE Konfliktschutz: Anhaengen ist vertauschbar. Zwei
    // gleichzeitige Nachtraege stoeren einander nicht, beide landen im Text.
    // `rev` steigt trotzdem, damit ein parallel offener Editor merkt, dass
    // sich etwas getan hat.
    await db`
      UPDATE notes SET
        content = content || ${appendText},
        rev = rev + 1,
        updated_at = ${now.toISOString()}
      WHERE id = ${found.id}
    `;
    return true;
  },

  async update(nameOrPath, content, expectedRev) {
    const db = getDb();
    const found = await findeNotiz(nameOrPath);
    if (!found) return false;

    // Konfliktschutz (Migration 042). Siehe src/data/konflikt.ts.
    pruefeRev({ id: found.id, title: found.title, rev: found.rev }, found.rev, expectedRev);

    const now = new Date().toISOString();
    const betroffen = await db`
      UPDATE notes SET content = ${content}, rev = rev + 1, updated_at = ${now}
      WHERE id = ${found.id} AND rev = ${found.rev}
      RETURNING id
    `;
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT id, title, rev FROM notes WHERE id = ${found.id}`;
      if (!jetzt) return false; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(
        { id: String(jetzt.id), title: String(jetzt.title), rev: Number(jetzt.rev) },
        found.rev,
        Number(jetzt.rev),
      );
    }
    return true;
  },

  async delete(nameOrPath) {
    const treffer = await findeNotiz(nameOrPath);
    if (!treffer) return null;
    const db = getDb();
    // Ueber die ID — die vorherige Fassung loeschte JEDE passende Zeile und
    // gab nur die erste zurueck.
    const [row] = await db`
      UPDATE notes SET deleted_at = now()
       WHERE id = ${treffer.id} AND deleted_at IS NULL
      RETURNING title
    `;
    return row ? String(row.title) : null;
  },
};
