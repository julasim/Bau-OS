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
import { getDb } from "../db/client.js";
import { pruefeRev, KonfliktFehler } from "./konflikt.js";
import type { Company, ContactLogEntry, MemberType, TeamMember, TeamMemberProject, TeamRepository } from "./types.js";

// ── Row-Mapper ──────────────────────────────────────────────

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

  const contactLogRaw = row.contact_log;
  const contactLog: ContactLogEntry[] = Array.isArray(contactLogRaw)
    ? (contactLogRaw as Array<Record<string, unknown>>).map((e) => ({
        ts: String(e.ts ?? ""),
        text: String(e.text ?? ""),
        author: e.author ? String(e.author) : undefined,
      }))
    : [];

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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
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

/** Bulk-Lookup: gegeben eine Liste Email-Adressen, finde die zugehoerigen
 *  Team-Mitglieder. Used vom Microsoft-Sync um Outlook-Attendees auf
 *  PATIO-team_members zu mappen. Email-Vergleich case-insensitive +
 *  getrimmt, damit Schreibvarianten ("  user@x.at  " vs "User@X.at")
 *  noch matchen. Liefert eine Map fuer O(1)-Lookup im Caller. */
export async function findMembersByEmails(emails: string[]): Promise<Map<string, { id: string; name: string }>> {
  const result = new Map<string, { id: string; name: string }>();
  if (emails.length === 0) return result;
  const db = getDb();
  const normalized = emails.map((e) => (e || "").trim().toLowerCase()).filter((e) => e.length > 0);
  if (normalized.length === 0) return result;

  const rows = await db`
    SELECT id, name, email FROM team_members
     WHERE email IS NOT NULL
       AND LOWER(TRIM(email)) = ANY(${normalized})
  `;
  for (const row of rows) {
    const key = String(row.email).trim().toLowerCase();
    result.set(key, { id: String(row.id), name: String(row.name) });
  }
  return result;
}

/** Inverse von findMembersByEmails: gegeben Member-IDs, liefere die Emails
 *  + Namen fuer den Push zu Outlook. Mitglieder ohne Email werden
 *  uebersprungen — Outlook kann mit ihnen nichts anfangen. */
export async function findEmailsForMembers(
  memberIds: string[],
): Promise<Array<{ id: string; name: string; email: string }>> {
  if (memberIds.length === 0) return [];
  const db = getDb();
  const rows = await db`
    SELECT id, name, email FROM team_members
     WHERE id = ANY(${memberIds})
       AND email IS NOT NULL
       AND TRIM(email) <> ''
  `;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    email: String(r.email).trim(),
  }));
}

export const dbTeam: TeamRepository = {
  async list() {
    const db = getDb();
    const rows = await db.unsafe(`${MEMBER_SELECT} ORDER BY tm.name`);
    return rows.map((r) => rowToMember(r as Record<string, unknown>));
  },

  async get(id) {
    const db = getDb();
    const rows = await db.unsafe(`${MEMBER_SELECT} WHERE tm.id = $1 LIMIT 1`, [id]);
    return rows[0] ? rowToMember(rows[0] as Record<string, unknown>) : null;
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
        ${companyId}, ${memberType}, ${"[]"}::jsonb, ${userId},
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

  async remove(nameOrId) {
    const db = getDb();
    const result = await db`
      DELETE FROM team_members WHERE id::text = ${nameOrId} OR name = ${nameOrId}
    `;
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
         SET contact_log = COALESCE(contact_log, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb
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

  async deleteCompany(id) {
    const db = getDb();
    // ON DELETE SET NULL in team_members.company_id sorgt dafuer, dass
    // Mitglieder erhalten bleiben, nur die Verknuepfung verschwindet.
    const result = await db`DELETE FROM companies WHERE id = ${id}`;
    return result.count > 0;
  },
};
