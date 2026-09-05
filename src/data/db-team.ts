// Datenbank-Implementation: PostgreSQL via postgres.js
//
// Ab Migration 006 ist dieses Repo hybrid:
//   - Legacy-Felder (company TEXT, project_id UUID) bleiben fuer
//     Backward-Compat weiterhin befuellt.
//   - Neue Quellen sind companies (FK) und project_team_members (M:N).
// Schreiben: legacy-Felder werden aus den neuen Werten abgeleitet gesetzt,
//           damit aeltere Queries/UI noch konsistent bleiben.
// Lesen:    bevorzugt companyName aus Join, projects-Array aus Junction.
import crypto from "crypto";
import { getDb, jsonb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { Company, ContactLogEntry, MemberType, TeamMember, TeamMemberProject, TeamRepository } from "./types.js";
import { alsIso } from "./zeitstempel.js";

// ── Row-Mapper ──────────────────────────────────────────────

/**
 * Der Kontaktverlauf eines Mitglieds — aus drei moeglichen Formen.
 *
 * ── Warum drei ────────────────────────────────────────────────────────────
 *
 * `appendLog()` schrieb bis zum 02.09.2026 mit `${JSON.stringify(...)}::jsonb`.
 * postgres.js serialisiert die uebergebene Zeichenkette dabei ein zweites Mal
 * — in der Spalte landet ein JSON-String statt eines Arrays. Am System
 * nachgemessen: **223 von 223 Zeilen** standen auf `"[]"`.
 *
 * Der Leser hier prueft frueher `Array.isArray` und fiel damit auf `[]`
 * zurueck. Ergebnis: **jeder ueber `appendLog()` geschriebene Vermerk war
 * unsichtbar** — geschrieben, gespeichert, nie angezeigt.
 *
 * ⚠ Und es gibt eine ZWEITE Altbestand-Form, die man leicht uebersieht. Der
 * Anhaenge-Operator `||` auf zwei jsonb-ZEICHENKETTEN ergibt ein Array aus
 * zwei Zeichenketten, nicht das erwartete Objekt-Array:
 *
 *   '"[]"'::jsonb || '"[{…}]"'::jsonb   ->   ["[]", "[{…}]"]
 *
 * Ein toleranter Leser, der nur „ist es eine Zeichenkette?" prueft, laeuft
 * daran vorbei: `Array.isArray` ist wahr, und `.map` auf einer Zeichenkette
 * ergibt lauter `undefined`. Deshalb werden Zeichenketten-Elemente einzeln
 * geparst und flach gezogen.
 *
 * Kein `throw`: ein unlesbarer Vermerk darf die Team-Seite nicht abschiessen.
 */
export function alsKontaktverlauf(roh: unknown): ContactLogEntry[] {
  const alsEintrag = (e: unknown): ContactLogEntry[] => {
    // Eine Zeichenkette ist entweder ein doppelt kodiertes Array oder ein
    // doppelt kodierter Einzeleintrag — beides parsen und flach ziehen.
    if (typeof e === "string") {
      try {
        return alsKontaktverlauf(JSON.parse(e));
      } catch {
        return [];
      }
    }
    if (!e || typeof e !== "object") return [];
    const o = e as Record<string, unknown>;
    return [
      {
        ts: String(o.ts ?? ""),
        text: String(o.text ?? ""),
        author: o.author ? String(o.author) : undefined,
      },
    ];
  };

  if (typeof roh === "string") {
    try {
      return alsKontaktverlauf(JSON.parse(roh));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(roh)) return [];
  return roh.flatMap(alsEintrag);
}

function rowToMember(row: Record<string, unknown>): TeamMember {
  // projects_json kommt als json_agg der Junction; kann null sein wenn
  // keine Projekte zugeordnet (LEFT JOIN + aggregate).
  const projectsRaw = row.projects_json;
  const projects: TeamMemberProject[] = Array.isArray(projectsRaw)
    ? (projectsRaw as Array<Record<string, unknown>>)
        .filter((p) => p && p.id)
        .map((p) => ({
          id: String(p.id),
          name: String(p.name),
          projectRole: p.project_role ? String(p.project_role) : null,
        }))
    : [];

  const contactLog = alsKontaktverlauf(row.contact_log);

  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role ? String(row.role) : null,
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    hourlyRate: row.hourly_rate != null ? Number(row.hourly_rate) : null,
    company: row.company ? String(row.company) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    memberType: (row.member_type as MemberType | null) ?? null,
    projects,
    contactLog,
    userId: row.user_id ? String(row.user_id) : null,
    username: row.username ? String(row.username) : null,
    createdAt: alsIso(row.created_at),
    updatedAt: alsIso(row.updated_at),
    /** Konflikt-Zaehler (Migration 042) — die Oberflaeche schickt ihn beim
     *  Speichern zurueck. Fehlt er im DTO, ist der Schutz von aussen unerreichbar. */
    rev: Number(row.rev ?? 1),
  };
}

function rowToCompany(row: Record<string, unknown>): Company {
  return {
    id: String(row.id),
    name: String(row.name),
    address: row.address ? String(row.address) : null,
    website: row.website ? String(row.website) : null,
    notes: row.notes ? String(row.notes) : null,
    memberCount: row.member_count !== undefined ? Number(row.member_count) : undefined,
    createdAt: alsIso(row.created_at),
    updatedAt: alsIso(row.updated_at),
  };
}

// Gemeinsame SELECT-Klausel fuer Members mit Joins + Aggregat.
// Wird in list()/get() identisch genutzt; als Template-String fuer postgres.js
// nicht moeglich, deshalb als WHERE-Suffix-Funktion.
const MEMBER_SELECT = `
  SELECT
    tm.id,
    tm.rev,
    tm.name,
    tm.role,
    tm.email,
    tm.phone,
    tm.hourly_rate,
    tm.company,
    tm.project_id,
    tm.company_id,
    tm.member_type,
    tm.contact_log,
    tm.user_id,
    tm.created_at,
    tm.updated_at,
    c.name as company_name,
    u.username,
    COALESCE(
      (SELECT json_agg(
        json_build_object(
          'id', p.id,
          'name', p.name,
          'project_role', ptm.project_role
        ) ORDER BY p.name
      )
      FROM project_team_members ptm
      JOIN projects p ON p.id = ptm.project_id
      WHERE ptm.member_id = tm.id),
      '[]'::json
    ) as projects_json
  FROM team_members tm
  LEFT JOIN companies c ON c.id = tm.company_id
  LEFT JOIN users u ON u.id = tm.user_id
`;

// ── Companies-Helper ─────────────────────────────────────────

/** Findet eine Company per Name (case-insensitive, getrimmt). Legt sie an,
 *  wenn noch nicht vorhanden. Gibt die id zurueck, oder null wenn name leer.
 *
 *  Atomar via "ON CONFLICT DO UPDATE ... RETURNING id" — dadurch gibt es
 *  keinen Zeitraum zwischen Insert-Versuch und Re-Select, in dem eine
 *  andere Transaktion ein Duplikat einbauen koennte. DO UPDATE (statt DO
 *  NOTHING) ist hier wichtig, weil nur bei DO UPDATE das RETURNING den
 *  Konflikt-Winner-Datensatz liefert. */
async function resolveCompanyId(db: ReturnType<typeof getDb>, name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // Fast-Path: exakter case-insensitive Match existiert bereits.
  const [existing] = await db`
    SELECT id FROM companies WHERE LOWER(name) = LOWER(${trimmed}) LIMIT 1
  `;
  if (existing) return String(existing.id);

  // Slow-Path: atomisches Upsert. Bei Konflikt aktualisieren wir updated_at
  // auf sich selbst (no-op Update), damit RETURNING trotzdem feuert und wir
  // die ID des Konflikt-Winners zurueckbekommen.
  const id = crypto.randomUUID();
  const [row] = await db`
    INSERT INTO companies (id, name) VALUES (${id}, ${trimmed})
    ON CONFLICT (name) DO UPDATE SET updated_at = companies.updated_at
    RETURNING id
  `;
  return row ? String(row.id) : null;
}

// `findMembersByEmails()` und `findEmailsForMembers()` standen hier: sie
// uebersetzten zwischen E-Mail-Adressen und Team-Mitgliedern und wurden
// ausschliesslich vom Outlook-Abgleich gebraucht. Der ist mit AP0 entfallen.

/** Entfernt Projektzuordnungen, die der Fragende nicht sehen darf.
 *
 *  Die Team-Abfrage haengt jedem Mitglied seine Projekte an (Name + Rolle).
 *  Ungefiltert liess sich damit ueber einen einzigen Aufruf die vollstaendige
 *  Projektliste des Bueros abfragen — auch die Projekte, auf die der Fragende
 *  keinen Zugriff hat. Bei einem Buero, das fuer konkurrierende Bauherren
 *  arbeitet, ist schon der Projektname eine Auskunft.
 *
 *  Bewusst hier und nicht in der SQL-Klausel: `MEMBER_SELECT` wird von vier
 *  Stellen benutzt, und ein zusaetzlicher Parameter in der korrelierten
 *  Unterabfrage waere an jeder davon eine eigene Fehlerquelle. Die Zahl der
 *  Zuordnungen je Mitglied liegt im einstelligen Bereich. */
function nurSichtbareProjekte(member: TeamMember, sichtbar: string[] | "all"): TeamMember {
  if (sichtbar === "all") return member;
  const erlaubt = new Set(sichtbar);
  return { ...member, projects: (member.projects ?? []).filter((p) => erlaubt.has(p.id)) };
}

export const dbTeam: TeamRepository = {
  async list(sichtbareProjekte = "all") {
    const db = getDb();
    const rows = await db.unsafe(`${MEMBER_SELECT} ORDER BY tm.name`);
    return rows.map((r) => nurSichtbareProjekte(rowToMember(r as Record<string, unknown>), sichtbareProjekte));
  },

  async get(id, sichtbareProjekte = "all") {
    const db = getDb();
    const rows = await db.unsafe(`${MEMBER_SELECT} WHERE tm.id = $1 LIMIT 1`, [id]);
    if (!rows[0]) return null;
    return nurSichtbareProjekte(rowToMember(rows[0] as Record<string, unknown>), sichtbareProjekte);
  },

  async add(member) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const name = member.name;
    const role = member.role ?? null;
    const email = member.email ?? null;
    const phone = member.phone ?? null;
    const hourlyRate = member.hourlyRate ?? null;
    const projectId = member.projectId ?? null;
    const memberType = member.memberType ?? null;

    // Company-Auflosung: companyId hat Vorrang, dann companyName (auto-create),
    // dann legacy company-Feld (auto-create).
    let companyId: string | null = null;
    let companyText: string | null = member.company ?? null;
    if (member.companyId) {
      companyId = member.companyId;
      const [c] = await db`SELECT name FROM companies WHERE id = ${companyId}`;
      if (c) companyText = String(c.name);
    } else {
      const lookupName = member.companyName ?? member.company ?? null;
      companyId = await resolveCompanyId(db, lookupName);
      if (companyId) companyText = lookupName?.trim() ?? companyText;
    }

    // Auto-Link: wenn der Caller keinen userId mitgibt, suchen wir nach einem
    // passenden User-Account (Migration 013). EINDEUTIGER Match auf Username
    // oder DisplayName (case-insensitive) wird verlinkt — dann kommen
    // Notifications fuer Tasks/Termine/Meetings automatisch beim User an,
    // sobald er gepairt ist. Konservativ: bei Mehrdeutigkeit kein Link.
    let userId = member.userId ?? null;
    if (userId === null) {
      try {
        const matches = await db`
          SELECT id FROM users
           WHERE LOWER(TRIM(username)) = LOWER(TRIM(${name}))
              OR LOWER(TRIM(COALESCE(display_name, ''))) = LOWER(TRIM(${name}))
        `;
        if (matches.length === 1) {
          // Eindeutigkeit auf der Team-Member-Seite: ist dieser User schon mit
          // einem anderen team_member verlinkt? Wenn ja, NICHT auto-linken
          // (UNIQUE-Constraint wuerde sonst den INSERT killen).
          const [conflict] = await db`
            SELECT 1 FROM team_members WHERE user_id = ${String(matches[0]!.id)} LIMIT 1
          `;
          if (!conflict) {
            userId = String(matches[0]!.id);
          }
        }
      } catch {
        // Fail-soft — User-Tabelle nicht da o.ae. Kein Crash.
      }
    }

    const [row] = await db`
      INSERT INTO team_members (
        id, name, role, email, phone, hourly_rate, company, project_id,
        company_id, member_type, contact_log, user_id,
        created_at, updated_at
      ) VALUES (
        ${id}, ${name}, ${role}, ${email}, ${phone}, ${hourlyRate}, ${companyText}, ${projectId},
        ${companyId}, ${memberType}, ${jsonb([])}, ${userId},
        ${now}, ${now}
      )
      RETURNING id
    `;
    const inserted = await this.get(String(row.id));
    if (!inserted) throw new Error("Team-Mitglied nach INSERT nicht lesbar");
    return inserted;
  },

  async update(id, updates) {
    const db = getDb();
    const [current] = await db`SELECT * FROM team_members WHERE id = ${id}`;
    if (!current) return null;

    // Konfliktschutz (Migration 042): schickt der Aufrufer einen Zaehler mit,
    // muss er noch stimmen — sonst hat in der Zwischenzeit jemand anderes
    // gespeichert. Ohne Zaehler gilt weiterhin „zuletzt gewinnt".
    pruefeRev(rowToMember(current), current.rev, (updates as { rev?: number }).rev);

    // Company-Auflosung: explizite companyId > companyName > company-Legacy-Feld.
    // Wenn nichts spezifiziert, bleibt alles unveraendert.
    let companyId: string | null | undefined = undefined;
    let companyText: string | null | undefined = undefined;
    if ("companyId" in updates) {
      companyId = updates.companyId ?? null;
      if (companyId) {
        const [c] = await db`SELECT name FROM companies WHERE id = ${companyId}`;
        companyText = c ? String(c.name) : null;
      } else {
        companyText = null;
      }
    } else if ("companyName" in updates) {
      companyId = await resolveCompanyId(db, updates.companyName);
      companyText = updates.companyName?.trim() || null;
    } else if ("company" in updates) {
      // Legacy-Pfad: Caller setzt company-Text ohne zu wissen dass es eine FK
      // gibt — wir legen/holen die Company und synchronisieren beides.
      companyId = await resolveCompanyId(db, updates.company);
      companyText = updates.company?.trim() || null;
    }

    const name = "name" in updates ? updates.name : current.name;
    const role = "role" in updates ? updates.role : current.role;
    const email = "email" in updates ? updates.email : current.email;
    const phone = "phone" in updates ? updates.phone : current.phone;
    const hourlyRate = "hourlyRate" in updates ? updates.hourlyRate : current.hourly_rate;
    const projectId = "projectId" in updates ? updates.projectId : current.project_id;
    const memberType = "memberType" in updates ? updates.memberType : current.member_type;
    const userId = "userId" in updates ? updates.userId : current.user_id;

    const resolvedCompanyText = companyText !== undefined ? companyText : current.company;
    const resolvedCompanyId = companyId !== undefined ? companyId : current.company_id;

    const betroffen = await db`
      UPDATE team_members SET
        name = ${name ?? current.name},
        role = ${role},
        email = ${email},
        phone = ${phone},
        hourly_rate = ${hourlyRate},
        company = ${resolvedCompanyText},
        project_id = ${projectId},
        company_id = ${resolvedCompanyId},
        member_type = ${memberType},
        user_id = ${userId},
        rev = rev + 1
      WHERE id = ${id} AND rev = ${current.rev}
      RETURNING id
    `;
    // Keine Zeile getroffen heisst: zwischen Lesen und Schreiben hat jemand
    // anderes gespeichert. Ohne diese Pruefung taete die Anweisung STILL
    // nichts und meldete trotzdem Erfolg.
    if (betroffen.length === 0) {
      const [jetzt] = await db`SELECT * FROM team_members WHERE id = ${id}`;
      if (!jetzt) return null; // in der Zwischenzeit geloescht
      throw new KonfliktFehler(rowToMember(jetzt), Number(current.rev), Number(jetzt.rev));
    }
    return this.get(id);
  },

  /** Entfernt ein Mitglied — endgueltig, es gibt keinen Papierkorb dafuer.
   *
   *  ── Was hier stand ───────────────────────────────────────────────────────
   *
   *  `DELETE … WHERE id::text = $1 OR name = $1`, ohne Limit. Bei zwei
   *  gleichnamigen Mitgliedern — im Bauwesen keine Seltenheit — gingen beide,
   *  und gemeldet wurde nur, dass „mindestens eines" betroffen war. Daran
   *  haengen zwei Trigger und vier Fremdschluessel.
   *
   *  Jetzt wie bei den Notizen: ueber einen Auflöser mit Rang, danach nur
   *  noch ueber die ID. Bei Mehrdeutigkeit wird NICHT geraten — die Funktion
   *  gibt `false` zurueck, und der Aufrufer muss die ID nennen. Lieber ein
   *  Loeschvorgang, der nicht stattfindet, als der falsche. */
  async remove(nameOrId) {
    const db = getDb();
    const treffer = await db`
      SELECT id,
             CASE WHEN id::text = ${nameOrId} THEN 0 ELSE 1 END AS rang
        FROM team_members
       WHERE id::text = ${nameOrId} OR name = ${nameOrId}
       ORDER BY rang, created_at DESC, id DESC`;
    if (treffer.length === 0) return false;

    // Ein Treffer ueber die ID ist immer eindeutig (Primaerschluessel). Nur
    // beim Namensweg kann es mehrere geben — und dann wird nichts geloescht.
    const ueberId = Number(treffer[0].rang) === 0;
    if (!ueberId && treffer.length > 1) return false;

    const result = await db`DELETE FROM team_members WHERE id = ${String(treffer[0].id)}`;
    return result.count > 0;
  },

  // ── Junction (M:N Projekte) ─────────────────────────────────

  async assignToProject(memberId, projectId, projectRole) {
    const db = getDb();
    // ON CONFLICT: wenn bereits zugeordnet, nur project_role aktualisieren
    // (wenn neuer Wert uebergeben wurde). Sonst no-op.
    if (projectRole !== undefined) {
      await db`
        INSERT INTO project_team_members (project_id, member_id, project_role)
        VALUES (${projectId}, ${memberId}, ${projectRole ?? null})
        ON CONFLICT (project_id, member_id)
          DO UPDATE SET project_role = EXCLUDED.project_role
      `;
    } else {
      await db`
        INSERT INTO project_team_members (project_id, member_id)
        VALUES (${projectId}, ${memberId})
        ON CONFLICT (project_id, member_id) DO NOTHING
      `;
    }
    return true;
  },

  async unassignFromProject(memberId, projectId) {
    const db = getDb();
    const result = await db`
      DELETE FROM project_team_members
       WHERE member_id = ${memberId} AND project_id = ${projectId}
    `;
    return result.count > 0;
  },

  async updateProjectRole(memberId, projectId, projectRole) {
    const db = getDb();
    const result = await db`
      UPDATE project_team_members
         SET project_role = ${projectRole}
       WHERE member_id = ${memberId} AND project_id = ${projectId}
    `;
    return result.count > 0;
  },

  // ── Kontakt-Log (Phase 4) ───────────────────────────────────

  async appendLog(memberId, entry) {
    const db = getDb();
    // Append via jsonb concat (|| Operator) — atomar, keine Race-Conditions.
    const result = await db`
      UPDATE team_members
         SET contact_log = COALESCE(contact_log, '[]'::jsonb) || ${jsonb([entry])}
       WHERE id = ${memberId}
    `;
    return result.count > 0;
  },

  // ── Companies ───────────────────────────────────────────────

  async listCompanies() {
    const db = getDb();
    const rows = await db`
      SELECT
        c.*,
        (SELECT count(*) FROM team_members tm WHERE tm.company_id = c.id) as member_count
      FROM companies c
      ORDER BY c.name
    `;
    return rows.map((r) => rowToCompany(r));
  },

  async getCompany(id) {
    const db = getDb();
    const [row] = await db`
      SELECT
        c.*,
        (SELECT count(*) FROM team_members tm WHERE tm.company_id = c.id) as member_count
      FROM companies c
      WHERE c.id = ${id}
      LIMIT 1
    `;
    return row ? rowToCompany(row) : null;
  },

  async addCompany(input) {
    const db = getDb();
    const id = crypto.randomUUID();
    await db`
      INSERT INTO companies (id, name, address, website, notes)
      VALUES (${id}, ${input.name}, ${input.address ?? null}, ${input.website ?? null}, ${input.notes ?? null})
    `;
    const c = await this.getCompany!(id);
    if (!c) throw new Error("Company nach INSERT nicht lesbar");
    return c;
  },

  async updateCompany(id, updates) {
    const db = getDb();
    const [current] = await db`SELECT * FROM companies WHERE id = ${id}`;
    if (!current) return null;
    const name = "name" in updates ? updates.name : current.name;
    const address = "address" in updates ? updates.address : current.address;
    const website = "website" in updates ? updates.website : current.website;
    const notes = "notes" in updates ? updates.notes : current.notes;
    await db`
      UPDATE companies SET
        name = ${name ?? current.name},
        address = ${address},
        website = ${website},
        notes = ${notes}
      WHERE id = ${id}
    `;
    return this.getCompany!(id);
  },

  async mergeCompany(vonId, nachId) {
    if (vonId === nachId) return null;
    const db = getDb();
    const [von] = await db`SELECT id FROM companies WHERE id = ${vonId}`;
    const [nach] = await db`SELECT id, name FROM companies WHERE id = ${nachId}`;
    if (!von || !nach) return null;

    // In EINER Transaktion, sonst haengen die Mitglieder bei einem Abbruch
    // zwischen zwei Firmen — oder an einer, die es nicht mehr gibt.
    return db.begin(async (tx) => {
      const umgehaengt = await tx`
        UPDATE team_members
           SET company_id = ${nachId},
               -- Das Freitextfeld company wird mitgezogen: es ist der
               -- Altbestand, aus dem die Dubletten ueberhaupt entstanden
               -- sind, und aeltere Ansichten lesen noch daraus.
               company = ${String(nach.name)}
         WHERE company_id = ${vonId}
        RETURNING id
      `;
      await tx`DELETE FROM companies WHERE id = ${vonId}`;
      return umgehaengt.length;
    });
  },

  async deleteCompany(id) {
    const db = getDb();
    // ON DELETE SET NULL in team_members.company_id sorgt dafuer, dass
    // Mitglieder erhalten bleiben, nur die Verknuepfung verschwindet.
    const result = await db`DELETE FROM companies WHERE id = ${id}`;
    return result.count > 0;
  },
};
