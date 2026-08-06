// Datenbank-Implementation: PostgreSQL via postgres.js
import crypto from "crypto";
import { getDb } from "../db/client.js";
import { escapeLike } from "./sql-like.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { NoteRepository } from "./types.js";

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
  const rows = await db`
    SELECT id, title, rev,
           CASE WHEN id::text = ${nameOrPath} THEN 0
                WHEN title = ${nameOrPath} THEN 1
                ELSE 2 END AS rang
      FROM notes
     WHERE id::text = ${nameOrPath}
        OR title = ${nameOrPath}
        OR title LIKE ${escapeLike(nameOrPath) + "%"}
     ORDER BY rang, created_at DESC
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
    const now = new Date().toISOString();
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
    await db`
      INSERT INTO notes (id, title, content, project_id, source, created_by, created_at, updated_at)
      VALUES (${id}, ${title}, ${content}, ${projectId}, 'web', ${createdById}, ${now}, ${now})
    `;

    return id;
  },

  async list(limit = 10) {
    const db = getDb();
    const rows = await db`
      SELECT title, created_at FROM notes
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => String(r.title));
  },

  async listDetailed(limit = 50) {
    const db = getDb();
    const rows = await db`
      SELECT n.title, p.name as project_name, n.created_at, n.updated_at, length(n.content) as size
      FROM notes n
      LEFT JOIN projects p ON n.project_id = p.id
      ORDER BY n.updated_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      title: String(r.title),
      project: r.project_name ? String(r.project_name) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      size: Number(r.size || 0),
    }));
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
    const [row] = await db`DELETE FROM notes WHERE id = ${treffer.id} RETURNING title`;
    return row ? String(row.title) : null;
  },
};
