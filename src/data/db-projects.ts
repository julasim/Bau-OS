// Datenbank-Implementation: PostgreSQL via postgres.js
//
// Projekte sind rein logische DB-Entities — es werden KEINE Vault-Ordner
// mehr angelegt oder geloescht. User-Daten liegen komplett in Postgres
// (Notizen, Tasks, Termine, Files als bytea). Der Vault speichert nur
// noch System-Dateien (Agenten-Workspace, users.json, Tools, Logs).
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { Project, ProjectAccessEntry, ProjectCreateOptions, ProjectRepository, ProjectUpdate } from "./types.js";
import { alsIso } from "./zeitstempel.js";
import { pruefeProjektnummer, vergleichbar, istNummerVergeben, istPlatzhalter } from "./projektnummer.js";

// Mapping: camelCase-API-Feld ↔ snake_case-Spaltenname.
// Wird beim dynamischen UPDATE genutzt, um tippfest aus dem Patch auf
// die DB-Spalten zu kommen — ohne dass der Caller snake_case kennen muss.
const UPDATE_COLUMNS: Record<keyof ProjectUpdate, string> = {
  description: "description",
  status: "status",
  color: "color",
  projektnummer: "projektnummer",
  projektnummerFrueher: "projektnummer_frueher",
  bauherr: "bauherr",
  standort: "standort",
  projektart: "projektart",
  nutzung: "nutzung",
  phase: "phase",
  startDate: "start_date",
  endDate: "end_date",
  bauherrId: "bauherr_id",
  parentId: "parent_id",
  budget: "budget",
  budgetUsed: "budget_used",
};

function isValidName(name: string): boolean {
  return /^[\p{L}\p{N}_\-. ]+$/u.test(name) && !name.includes("..");
}

// Gemeinsames Row→Project-Mapping fuer getInfo (Einzelprojekt) und listInfos
// (Mehrprojekt-Aggregat, PERF-1). Beide SELECTs muessen dieselben Spalten-
// Aliase liefern — wird hier zentral gemappt, damit die Feldlogik nicht
// dupliziert und auseinanderlaeuft (vgl. INFO-1).
function rowToProjectInfo(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    /** Konflikt-Zaehler (Migration 042). Fehlt er im DTO, kann die Oberflaeche
     *  ihn nicht zurueckschicken und der Schutz ist von aussen unerreichbar. */
    rev: Number(row.rev ?? 1),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    status: String(row.status),
    color: row.color ? String(row.color) : null,
    projektnummer: row.projektnummer ? String(row.projektnummer) : null,
    projektnummerFrueher: Array.isArray(row.projektnummer_frueher) ? row.projektnummer_frueher.map(String) : [],
    bauherr: row.bauherr ? String(row.bauherr) : null,
    standort: row.standort ? String(row.standort) : null,
    projektart: row.projektart ? String(row.projektart) : null,
    nutzung: row.nutzung ? String(row.nutzung) : null,
    phase: row.phase ? String(row.phase) : null,
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
    bauherrId: row.bauherr_id ? String(row.bauherr_id) : null,
    bauherrName: row.bauherr_name ? String(row.bauherr_name) : null,
    parentId: row.parent_id ? String(row.parent_id) : null,
    parentName: row.parent_name ? String(row.parent_name) : null,
    createdById: row.created_by ? String(row.created_by) : null,
    createdByUsername: row.created_by_username ? String(row.created_by_username) : null,
    notes: Number(row.notes),
    openTasks: Number(row.open_tasks),
    doneTasks: Number(row.done_tasks),
    highPriorityCount: Number(row.high_priority_count ?? 0),
    termine: Number(row.termine),
    files: Number(row.files),
    childrenCount: Number(row.children_count),
    budget: row.budget ? Number(row.budget) : null,
    budgetUsed: row.budget_used ? Number(row.budget_used) : null,
    createdAt: row.created_at ? alsIso(row.created_at) : undefined,
    updatedAt: row.updated_at ? alsIso(row.updated_at) : undefined,
  };
}

// SELECT-Liste, die rowToProjectInfo erwartet. Als postgres.js-Fragment
// geteilt, damit die 25 Spalten + 8 Aggregat-Subqueries nur an EINER Stelle
// stehen (getInfo und listInfos setzen nur unterschiedliche WHERE/ORDER an).
function projectInfoSelect(db: ReturnType<typeof getDb>) {
  return db`
    SELECT
      p.id, p.rev, p.name, p.description, p.status, p.color,
      p.projektnummer, p.projektnummer_frueher, p.bauherr, p.standort, p.projektart, p.nutzung,
      p.phase, p.start_date, p.end_date,
      p.bauherr_id, p.parent_id,
      p.created_by,
      bm.name as bauherr_name,
      parent.name as parent_name,
      creator.username as created_by_username,
      p.created_at, p.updated_at,
      (SELECT count(*) FROM notes n WHERE n.project_id = p.id) as notes,
      (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done') as open_tasks,
      (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') as done_tasks,
      (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.priority = 'hoch') as high_priority_count,
      (SELECT count(*) FROM termine te WHERE te.project_id = p.id) as termine,
      (SELECT count(*) FROM files f WHERE f.project_id = p.id) as files,
      (SELECT count(*) FROM projects child WHERE child.parent_id = p.id) as children_count,
      p.budget,
      p.budget_used
    FROM projects p
    LEFT JOIN team_members bm ON bm.id = p.bauherr_id
    LEFT JOIN projects parent ON parent.id = p.parent_id
    LEFT JOIN users creator ON creator.id = p.created_by
  `;
}

export const dbProjects: ProjectRepository = {
  async list(visibleIds) {
    const db = getDb();
    // Phase 4: wenn visibleIds ein Array ist, nur diese Projekte zurueckgeben.
    // "all" oder undefined = kein Filter (Admin / Legacy-Caller).
    if (Array.isArray(visibleIds)) {
      if (visibleIds.length === 0) return [];
      const rows = await db`
        SELECT name FROM projects
        WHERE status = 'aktiv' AND deleted_at IS NULL AND id = ANY(${visibleIds})
        ORDER BY name
      `;
      return rows.map((r) => String(r.name));
    }
    const rows = await db`SELECT name FROM projects WHERE status = 'aktiv' AND deleted_at IS NULL ORDER BY name`;
    return rows.map((r) => String(r.name));
  },

  async getInfo(name) {
    const db = getDb();
    // Projekte im Papierkorb sind nicht auffindbar — sonst liesse sich ein
    // geloeschtes Projekt weiter bearbeiten, und die Oberflaeche zeigte es an
    // Stellen, an denen es nicht mehr sein soll.
    const [row] = await db`${projectInfoSelect(db)} WHERE p.name = ${name} AND p.deleted_at IS NULL LIMIT 1`;
    return row ? rowToProjectInfo(row) : null;
  },

  // PERF-1: Alle sichtbaren Projekte mit voller Info in EINER Query — ersetzt
  // das N+1 aus GET /projects (frueher list() + getInfo() je Name). Menge und
  // Reihenfolge sind identisch zu list(visibleIds): aktive Projekte, optional
  // auf sichtbare IDs gefiltert, nach Name sortiert.
  async listInfos(visibleIds) {
    const db = getDb();
    if (Array.isArray(visibleIds)) {
      if (visibleIds.length === 0) return [];
      const rows = await db`
        ${projectInfoSelect(db)}
        WHERE p.status = 'aktiv' AND p.deleted_at IS NULL AND p.id = ANY(${visibleIds})
        ORDER BY p.name
      `;
      return rows.map(rowToProjectInfo);
    }
    const rows = await db`
      ${projectInfoSelect(db)}
      WHERE p.status = 'aktiv' AND p.deleted_at IS NULL
      ORDER BY p.name
    `;
    return rows.map(rowToProjectInfo);
  },

  async listNotes(name) {
    const db = getDb();
    const rows = await db`
      SELECT n.title FROM notes n
      JOIN projects p ON n.project_id = p.id
      WHERE p.name = ${name}
      ORDER BY n.created_at DESC
    `;
    return rows.map((r) => String(r.title));
  },

  async readNote(project, noteName) {
    const db = getDb();
    const [row] = await db`
      SELECT n.content FROM notes n
      JOIN projects p ON n.project_id = p.id
      WHERE p.name = ${project} AND (n.title = ${noteName} OR n.title LIKE ${noteName + "%"})
      LIMIT 1
    `;
    return row ? String(row.content) : null;
  },

  async create(name, options, createdById) {
    // Gleiche Unicode-Regel wie vorher (Umlaute erlaubt, "..", Slashes nicht).
    if (!isValidName(name)) return "ungueltiger-name";

    // Rueckwaertskompatibilitaet: frueher wurde description als String uebergeben.
    const opts: ProjectCreateOptions =
      typeof options === "string" || options === null || options === undefined
        ? { description: options ?? null }
        : options;

    const db = getDb();

    // ── Die Projektnummer (Migration 052) ─────────────────────────────────
    //
    // Sie ist Pflicht — aber NUR bei echter Neuanlage. Ein `create()` auf ein
    // bestehendes Projekt heisst in diesem Repository „stelle sicher, dass es
    // existiert" und patcht die mitgegebenen Stammdaten durch; dort waere eine
    // Pflichtabfrage falsch, weil der Aufrufer die Nummer gar nicht meint.
    const bestehend = await db`SELECT id, deleted_at FROM projects WHERE name = ${name} LIMIT 1`;
    const [existing] = bestehend;

    let nummer: string | null = null;
    if (opts.projektnummer !== undefined && opts.projektnummer !== null) {
      const geprueft = pruefeProjektnummer(opts.projektnummer);
      if (!geprueft.ok) return "nummer-fehlt";
      nummer = geprueft.nummer;
    }
    if (!existing && nummer === null) return "nummer-fehlt";

    // Frei? Der eindeutige Index liegt auf `lower(projektnummer)`, der
    // Vergleich hier muss dazu passen. Projekte im Papierkorb zaehlen mit —
    // sonst scheiterte spaeter das Zurueckholen (siehe Migration 052).
    if (nummer !== null) {
      const [belegt] = await db`
        SELECT id FROM projects
         WHERE lower(projektnummer) = ${vergleichbar(nummer)}
           ${existing ? db`AND id <> ${String(existing.id)}` : db``}
         LIMIT 1`;
      if (belegt) return "nummer-vergeben";
    }

    // Idempotent: existiert der Name schon, ist das kein Fehler — "create"
    // heisst hier "stelle sicher dass es existiert". Falls bereits vorhanden,
    // patchen wir die Stammdaten durch (nur Felder die im Patch gesetzt sind).
    if (existing) {
      // ── Ein bestehender Name ist KEIN Beitritt ──────────────────────────
      //
      // Diese Funktion patcht bestehende Projekte durch — das ist gewollt und
      // heisst „stelle sicher, dass es existiert". Sie hat dabei aber zwei
      // Dinge getan, die niemand verlangt hatte:
      //
      //   1. Sie trug den Aufrufer in `user_projects` ein.
      //   2. Sie holte ein geloeschtes Projekt aus dem Papierkorb.
      //
      // Beides ohne jede Rechtepruefung, und die Route reichte den
      // angemeldeten Benutzer als `createdById` durch. Nachgemessen am
      // 2026-08-23: ein Konto ohne jedes Recht bekam auf `GET` das erwartete
      // 403 — und war nach einem `POST /api/projects {"name": "<fremdes
      // Projekt>"}` Mitglied, konnte Notizen lesen, das Dossier laden und die
      // Projektnummer ueberschreiben. In einem Buero mit acht Arbeitsplaetzen
      // genuegt dafuer der Projektname.
      //
      // Damit war auch der Rechte-Fix an den acht Unterrouten umgehbar: was
      // die verwehren, holte man sich mit einem POST davor.
      //
      // Beide Schritte sind hier ersatzlos entfallen. Zugriff vergibt die
      // Verwaltung ueber `POST /projects/:name/access`, zurueckgeholt wird
      // ueber `POST /projects/:name/wiederherstellen` — beide mit
      // Rechtepruefung. WER hier ueberhaupt patchen darf, entscheidet die
      // Route (src/api/routes/projects.ts), wie ueberall in diesem Projekt.
      if (existing.deleted_at) return "name-im-papierkorb";

      const patch: ProjectUpdate = {
        description: opts.description,
        bauherr: opts.bauherr,
        standort: opts.standort,
        projektart: opts.projektart,
        nutzung: opts.nutzung,
        phase: opts.phase,
        startDate: opts.startDate,
        endDate: opts.endDate,
        // Die Nummer NUR aufnehmen, wenn wirklich eine mitkam.
        //
        // Vorher stand hier `projektnummer: nummer ?? undefined` — der
        // Schluessel war damit IMMER vorhanden, und `update()` prueft mit
        // `"projektnummer" in patch`. Das ist auch bei `undefined` wahr:
        // jeder POST OHNE Nummer lief in „nummer-fehlt", `update()` brach ab,
        // bevor irgendetwas geschrieben wurde — und weil das Ergebnis unten
        // weggeworfen wurde, meldete die Route trotzdem Erfolg. Der
        // dokumentierte Zweck dieses Zweigs war damit wirkungslos.
        ...(nummer !== null ? { projektnummer: nummer } : {}),
      };
      // Nur patchen, wenn mindestens ein Wert gesetzt ist — sonst no-op
      // (sonst wuerde ein nackter create()-Aufruf alle Spalten auf null
      // zuruecksetzen, wenn man das aus Versehen wieder bei bestehendem
      // Projekt aufruft).
      const hasAny = Object.values(patch).some((v) => v !== undefined);
      if (hasAny) {
        // Ergebnis auswerten, nicht wegwerfen: `update()` kann „Nummer
        // vergeben" melden, und das muss der Aufrufer erfahren.
        const ergebnis = await this.update(name, patch);
        if (ergebnis === "nummer-vergeben") return "nummer-vergeben";
        if (ergebnis === "nummer-fehlt") return "nummer-fehlt";
        // `false` heisst hier „nichts zu tun oder Zeile verschwunden" — das
        // ist kein Fehler des Aufrufers und bleibt „ok".
      }
      return "ok";
    }

    // folder_path ist seit migration 003 nullable — Projekte sind rein logisch.
    //
    // Der try/catch ist der Rueckfall zum Freigabe-Check oben: zwischen
    // „Nummer ist frei" und diesem INSERT liegt ein Moment, und auf einem
    // Server mit acht Arbeitsplaetzen reicht der. Ohne ihn waere das Ergebnis
    // ein 500 statt eines Hinweises, dass jemand schneller war.
    let inserted: { id: unknown } | undefined;
    try {
      [inserted] = await db`
      INSERT INTO projects (
        name, description, status,
        projektnummer, bauherr, standort, projektart, nutzung,
        phase, start_date, end_date,
        created_by
      )
      VALUES (
        ${name}, ${opts.description ?? null}, 'aktiv',
        ${nummer}, ${opts.bauherr ?? null}, ${opts.standort ?? null},
        ${opts.projektart ?? null}, ${opts.nutzung ?? null},
        ${opts.phase ?? null}, ${opts.startDate ?? null}, ${opts.endDate ?? null},
        ${createdById ?? null}
      )
      RETURNING id
    `;
    } catch (fehler) {
      if (istNummerVergeben(fehler)) return "nummer-vergeben";
      throw fehler;
    }
    // Ersteller automatisch in user_projects — ohne diesen Eintrag wuerde
    // ein Nicht-Admin sein eben angelegtes Projekt direkt nicht mehr sehen.
    if (createdById && inserted) {
      await db`
        INSERT INTO user_projects (user_id, project_id)
        VALUES (${createdById}, ${String(inserted.id)})
        ON CONFLICT DO NOTHING
      `;
    }
    return "ok";
  },

  async update(name, patch, expectedRev) {
    if (!isValidName(name)) return false;
    const db = getDb();

    // ── Die Projektnummer (Migration 052), Teil 1: pruefen und bereinigen ──
    //
    // Muss VOR dem Bau von `entries` stehen. Die Liste unten wird EINMAL aus
    // dem Patch gebaut und danach nur noch gelesen — wer den Patch spaeter
    // ersetzt, aendert am geschriebenen UPDATE nichts mehr. Die bereinigte
    // Nummer landete dann nie in der Datenbank, und zwar still.
    //
    // Aendern ist ausdruecklich erlaubt: die Nummer ist von Hand vergeben,
    // also wird sie irgendwann korrigiert. Genau dafuer ist sie NICHT der
    // Primaerschluessel — die Korrektur kostet ein UPDATE auf eine Zeile, und
    // kein einziger Verweis bricht.
    //
    // Leeren ist NICHT erlaubt: die Spalte ist seit 052 NOT NULL. Ohne diese
    // Pruefung waere ein `projektnummer: null` ein Datenbankfehler statt eines
    // sauberen „geht nicht".
    if ("projektnummer" in patch) {
      const geprueft = pruefeProjektnummer(patch.projektnummer);
      if (!geprueft.ok) return "nummer-fehlt";
      patch = { ...patch, projektnummer: geprueft.nummer };
    }

    // Ist ueberhaupt etwas zu tun? Die eigentliche Feldliste wird ERST WEITER
    // UNTEN gebaut, wenn der Patch endgueltig ist — dazwischen ergaenzt ihn
    // die Historie der Projektnummer (Migration 053).
    //
    // Diese Reihenfolge ist mit Absicht so und hat mich zweimal erwischt: eine
    // Liste, die aus dem Patch gebaut und danach nur noch gelesen wird, nimmt
    // spaetere Ergaenzungen NICHT mit — still, ohne Fehler, ohne Test, der
    // ohne Datenbank anschlaegt.
    if (Object.values(patch).every((v) => v === undefined)) return false;

    // Existenz pruefen (sonst wuerde UPDATE stillschweigend 0 Zeilen aendern).
    const [existing] = await db`SELECT id, rev FROM projects WHERE name = ${name} LIMIT 1`;
    if (!existing) return false;

    // Konfliktschutz (Migration 042). Siehe src/data/konflikt.ts.
    const istRev = Number(existing.rev ?? 1);
    pruefeRev({ id: String(existing.id), name, rev: istRev }, istRev, expectedRev);

    // Loop-Schutz fuer parent_id: ein Projekt darf nicht sein eigenes Parent
    // werden. Tiefer liegende Zyklen (A → B → A) werden im Frontend vor dem
    // Auswaehlen verhindert — die DB hat dafuer keine CHECK-Semantik.
    if (patch.parentId && String(patch.parentId) === String(existing.id)) {
      return false;
    }

    // ── Die Projektnummer, Teil 2a: die alte aufheben (Migration 053) ─────
    //
    // Direkt hier und nicht als eigener Aufruf: die Historie muss in DERSELBEN
    // Anweisung fortgeschrieben werden wie die Nummer selbst. Zwei getrennte
    // UPDATEs koennten zwischen sich scheitern, und dann stuende die neue
    // Nummer da, ohne dass die alte irgendwo auffindbar waere.
    //
    // Nicht aufgehoben werden: der Platzhalter aus 052 (er war nie eine
    // Aktennummer) und eine Nummer, die schon in der Liste steht (Hin- und
    // Zurueckkorrigieren soll sie nicht doppelt eintragen).
    if (patch.projektnummer) {
      const [alt] =
        await db`SELECT projektnummer, projektnummer_frueher FROM projects WHERE id = ${String(existing.id)}`;
      const alteNummer = alt?.projektnummer ? String(alt.projektnummer) : null;
      const bisher: string[] = Array.isArray(alt?.projektnummer_frueher) ? alt.projektnummer_frueher.map(String) : [];
      // Die Liste beantwortet EINE Frage: welche Nummern trug dieses Projekt
      // einmal und traegt sie nicht mehr? Daraus folgen beide Schritte.
      //
      // Anhaengen: die bisherige Nummer, sofern sie eine echte war (nicht der
      // Platzhalter aus 052) und noch nicht drinsteht.
      //
      // Entfernen: die NEUE Nummer, falls sie schon einmal drin war. Ohne
      // diesen Schritt stuende nach einer Rueckkorrektur (016 → 014 → 016) die
      // aktuelle Nummer unter „frueher: …" — gemessen, so ist dieser Fall
      // aufgefallen.
      const anhaengen = alteNummer && !istPlatzhalter(alteNummer) && !bisher.includes(alteNummer) ? [alteNummer] : [];
      const neueListe = [...bisher, ...anhaengen].filter((n) => n !== patch.projektnummer);
      // Nur schreiben, wenn sich wirklich etwas aendert — sonst zaehlt jeder
      // Speichervorgang den Konflikt-Zaehler hoch, ohne dass etwas passiert.
      const gleich = neueListe.length === bisher.length && neueListe.every((n, i) => n === bisher[i]);
      if (alteNummer !== patch.projektnummer && !gleich) {
        patch = { ...patch, projektnummerFrueher: neueListe };
      }
    }

    // ── Die Projektnummer, Teil 2: ist sie frei? ──────────────────────────
    // Erst hier, weil dafuer die eigene ID bekannt sein muss — sonst meldete
    // jedes Speichern ohne Nummernaenderung „schon vergeben", naemlich an
    // sich selbst. Projekte im Papierkorb zaehlen mit (siehe Migration 052).
    if (patch.projektnummer) {
      const [belegt] = await db`
        SELECT id FROM projects
         WHERE lower(projektnummer) = ${vergleichbar(String(patch.projektnummer))}
           AND id <> ${String(existing.id)}
         LIMIT 1`;
      if (belegt) return "nummer-vergeben";
    }

    // Jetzt ist der Patch endgueltig: Nummer geprueft und bereinigt, Historie
    // ergaenzt, Eindeutigkeit bestaetigt.
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [
      keyof ProjectUpdate,
      ProjectUpdate[keyof ProjectUpdate],
    ][];
    if (entries.length === 0) return false;

    // Dynamisches UPDATE per postgres.js — fuer jede Spalte ein eigener
    // Parameter, damit SQL-Injection ausgeschlossen ist. Spaltennamen
    // kommen aus der fix gemappten UPDATE_COLUMNS-Tabelle (Whitelist).
    //
    // postgres.js bietet kein natives "dynamic SET" — wir bauen das manuell
    // mit db.unsafe fuer die Spaltennamen + geparametrisierte Werte.
    const setFragments: string[] = [];
    // postgres.js unsafe() erwartet konkrete SQL-Parameter-Typen. Bis
    // Migration 053 war das ausnahmslos `string | null` — seither gibt es mit
    // `projektnummer_frueher` eine Feld-Spalte (`text[]`).
    //
    // Das `String(val)` unten haette daraus stillschweigend eine Zeichenkette
    // gemacht: aus `["SAZTG-2026-014"]` wird `"SAZTG-2026-014"`, und aus zwei
    // Eintraegen eine komma-getrennte Zeichenkette. Postgres haette das
    // zurueckgewiesen — oder, schlimmer, als einelementiges Feld angenommen
    // und die Historie beim zweiten Aendern zusammengeschoben.
    const values: (string | string[] | null)[] = [];
    for (const [key, val] of entries) {
      const col = UPDATE_COLUMNS[key];
      if (!col) continue; // sollte nicht passieren (Typ-Guard)
      values.push(val == null ? null : Array.isArray(val) ? val.map(String) : String(val));
      setFragments.push(`${col} = $${values.length}`);
    }
    // Kein einziges Feld war patchbar (z.B. nur unbekannte Schluessel im
    // Body). Ohne diese Bremse entstuende `SET  WHERE …` — ein Syntaxfehler.
    if (setFragments.length === 0) return false;

    // updated_at Trigger setzt das Feld automatisch (siehe migration 001).
    // `rev = rev + 1` und die rev-Bedingung im WHERE machen daraus EIN
    // atomares Kommando: wer mit veraltetem Zaehler kommt, trifft keine Zeile.
    const nameIdx = values.length + 1;
    values.push(name);
    const revIdx = values.length + 1;
    values.push(String(istRev));
    const sql =
      `UPDATE projects SET ${setFragments.join(", ")}, rev = rev + 1 ` +
      `WHERE name = $${nameIdx} AND rev = $${revIdx} RETURNING id`;

    const betroffen = await db.unsafe(sql, values);
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT id, name, rev FROM projects WHERE id = ${String(existing.id)}`;
      if (!jetzt) return false; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(
        { id: String(jetzt.id), name: String(jetzt.name), rev: Number(jetzt.rev) },
        istRev,
        Number(jetzt.rev),
      );
    }
    return true;
  },

  // ── ACL (Phase 3) ──────────────────────────────────────────

  async listAccess(projectId): Promise<ProjectAccessEntry[]> {
    const db = getDb();
    const rows = await db`
      SELECT u.id, u.username, u.display_name, u.role, up.added_at
      FROM user_projects up
      JOIN users u ON u.id = up.user_id
      WHERE up.project_id = ${projectId}
      ORDER BY u.username
    `;
    return rows.map((r) => ({
      userId: String(r.id),
      username: String(r.username),
      displayName: r.display_name ? String(r.display_name) : null,
      role: r.role === "admin" ? "admin" : "user",
      addedAt: alsIso(r.added_at),
    }));
  },

  async grantAccess(projectId, userId) {
    const db = getDb();
    await db`
      INSERT INTO user_projects (user_id, project_id)
      VALUES (${userId}, ${projectId})
      ON CONFLICT DO NOTHING
    `;
    // Idempotent: nach Aufruf ist die Zuordnung garantiert vorhanden, egal
    // ob neu eingefuegt oder schon da. Daher immer true.
    return true;
  },

  async revokeAccess(projectId, userId) {
    const db = getDb();
    const result = await db`
      DELETE FROM user_projects
      WHERE user_id = ${userId} AND project_id = ${projectId}
    `;
    return result.count > 0;
  },

  async listVisibleProjectIds(userId) {
    const db = getDb();
    const rows = await db`
      SELECT up.project_id
        FROM user_projects up
        JOIN projects p ON p.id = up.project_id
       WHERE up.user_id = ${userId} AND p.deleted_at IS NULL
    `;
    return rows.map((r) => String(r.project_id));
  },

  async listChildren(parentName) {
    const db = getDb();
    const rows = await db`
      SELECT child.id, child.name, child.status, child.projektnummer
      FROM projects parent
      JOIN projects child ON child.parent_id = parent.id
      WHERE parent.name = ${parentName} AND child.deleted_at IS NULL
      ORDER BY child.name
    `;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      status: r.status ? String(r.status) : null,
    }));
  },

  async rename(oldName, newName) {
    const trimmed = newName.trim();
    if (!isValidName(trimmed)) return "invalid";
    if (trimmed === oldName) return "ok"; // No-op
    const db = getDb();
    const [existing] = await db`SELECT id FROM projects WHERE name = ${oldName} AND deleted_at IS NULL LIMIT 1`;
    if (!existing) return "not-found";
    // Auch ein Projekt im Papierkorb belegt den Namen — die Spalte ist
    // eindeutig, ein Umbenennen darauf liefe in einen Datenbankfehler.
    const [conflict] = await db`SELECT id FROM projects WHERE name = ${trimmed} LIMIT 1`;
    if (conflict) return "conflict";
    // id bleibt; FK-Konsistenz ist gewahrt, weil alle Child-Eintraege (notes,
    // tasks, termine, files, team_members) an projects.id haengen.
    await db`UPDATE projects SET name = ${trimmed} WHERE name = ${oldName}`;
    return "ok";
  },

  /** Legt das Projekt in den Papierkorb (Migration 044).
   *
   *  Frueher stand hier ein echtes `DELETE`. Was daran haengt, wurde an den
   *  Fremdschluesseln der laufenden Datenbank nachgemessen, nicht aus dem
   *  Kommentar uebernommen — der stimmte naemlich nicht:
   *
   *    zerstoert  bautagebuch, meetings, time_entries, project_phases,
   *               project_invoices (ON DELETE CASCADE)
   *    verwaist   notes, tasks, termine, files, team_members.project_id
   *               (ON DELETE SET NULL)
   *
   *  Der alte Kommentar behauptete das Gegenteil („notes: CASCADE") — Notizen
   *  ueberlebten in Wahrheit ohne Projektbezug, Rechnungen und Stunden nicht.
   *
   *  Jetzt wird nichts geloescht, sondern nur ein Zeitstempel gesetzt. Alle
   *  Bezuege bleiben, das Zurueckholen ist ein Federstrich. */
  async delete(name) {
    if (!isValidName(name)) return false;
    const db = getDb();
    await db`UPDATE projects SET deleted_at = now() WHERE name = ${name} AND deleted_at IS NULL`;
    return true; // idempotent — auch ohne Treffer ist der Zustand der gewuenschte
  },

  async nameByNummer(nummer) {
    // Der Vergleich muss zum eindeutigen Index aus Migration 052 passen
    // (`lower(projektnummer)`) — sonst faende diese Abfrage `saztg-2026-014`
    // nicht, obwohl die Datenbank es fuer dieselbe Nummer haelt.
    const geprueft = pruefeProjektnummer(nummer);
    if (!geprueft.ok) return null;
    const db = getDb();
    const [row] = await db`
      SELECT name FROM projects
       WHERE lower(projektnummer) = ${vergleichbar(geprueft.nummer)}
         AND deleted_at IS NULL
       LIMIT 1`;
    return row ? String(row.name) : null;
  },

  async nameById(id) {
    // Ohne die UUID-Form waere das ein Datenbankfehler statt eines sauberen
    // „nicht gefunden" — Clients schicken irgendwann irgendetwas.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const db = getDb();
    const [row] = await db`SELECT name FROM projects WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
    return row ? String(row.name) : null;
  },

  async listDeleted() {
    const db = getDb();
    const rows = await db`
      SELECT id, name, projektnummer, deleted_at FROM projects
       WHERE deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
    `;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      projektnummer: r.projektnummer ? String(r.projektnummer) : null,
      deletedAt: alsIso(r.deleted_at),
    }));
  },

  async restore(name) {
    if (!isValidName(name)) return false;
    const db = getDb();
    const betroffen = await db`
      UPDATE projects SET deleted_at = NULL
       WHERE name = ${name} AND deleted_at IS NOT NULL
       RETURNING id
    `;
    return betroffen.length > 0;
  },

  /** Endgueltig entfernen. HIER feuern die Kaskaden wie frueher — und das ist
   *  an dieser Stelle richtig, denn genau das ist gemeint.
   *
   *  Nur aus dem Papierkorb heraus: endgueltiges Loeschen soll nie ein
   *  Einzelschritt sein, sondern immer zwei bewusste Entscheidungen. */
  async purge(name) {
    if (!isValidName(name)) return false;
    const db = getDb();
    const betroffen = await db`
      DELETE FROM projects WHERE name = ${name} AND deleted_at IS NOT NULL RETURNING id
    `;
    return betroffen.length > 0;
  },
};
