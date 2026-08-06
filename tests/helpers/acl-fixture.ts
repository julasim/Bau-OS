// Gemeinsamer Fixture-Helper fuer ACL-/IDOR-/Auth-Integrationstests (INF-6).
//
// Legt gegen die echte DB drei Nutzer an — A (Ersteller mit Projektzugriff),
// B (Fremder ohne Zugriff), Admin — plus ein Projekt (nur A zugewiesen) und
// liefert je Nutzer Rohdaten (id/username/role) samt fertigem JWT. Das
// Projekt-Cleanup cascadet abhaengige Zeilen weg (time_entries +
// project_invoices sind `project_id NOT NULL ... ON DELETE CASCADE`),
// entity-spezifisches Aufraeumen eruebrigt sich damit.
//
// .env VOR HAS_DB laden: `describe.skipIf` wird zur Collection-Zeit
// ausgewertet, bevor config.ts spaeter dotenv importiert. Da dieser Helper der
// erste Import der Suiten ist, laedt er dotenv frueh genug fuer alle.
import "dotenv/config";

export const HAS_DB = !!process.env.DATABASE_URL;

// Type-Query: exakter App-Typ ohne Laufzeit-Import (kein `any`).
type App = (typeof import("../../src/api/server.js"))["app"];

export interface FixtureUser {
  id: string;
  username: string;
  role: "admin" | "user";
  /** Regulaeres, sofort verwendbares Bearer-JWT (7d). */
  token: string;
}

export interface AclFixture {
  app: App;
  a: FixtureUser; // Ersteller, hat Projektzugriff auf projectId
  b: FixtureUser; // teil-berechtigt: sieht projectBId, NICHT projectId
  admin: FixtureUser; // Admin, sieht alles
  projectId: string;
  projectName: string;
  /** Zweites Projekt, das B gehoert (createdById = B). Macht B teil-berechtigt:
   *  B sieht sein eigenes Projekt, aber nicht A's. Damit greift der eigentliche
   *  IDOR-/Confinement-Test — B hat eine nicht-leere Sichtbarkeit, statt dass
   *  jeder ACL-Check fuer B trivial false ist. */
  projectBId: string;
  projectBName: string;
  cleanup(): Promise<void>;
}

/** Optionen des Fixtures. */
export interface AclFixtureOpts {
  /** Gibt A und B das Geld-Recht (Migration 043).
   *
   *  Voreinstellung ist **false** — genau wie in der Anwendung: neue Konten
   *  sehen keine Betraege. Suiten, die Projekt-Rechte pruefen und dabei
   *  zufaellig mit Rechnungen oder Honoraren arbeiten, setzen es auf `true`;
   *  sonst faellt ihre Pruefung ueber das Geld-Recht statt ueber das, was sie
   *  eigentlich messen wollen. Das Geld-Recht selbst hat eine eigene Suite
   *  (`tests/api-geld-recht.test.ts`), die es ausdruecklich NICHT setzt. */
  geldRecht?: boolean;
}

// `prefix` haelt die Testdaten pro Suite eindeutig (Nutzernamen + Projektname)
// und ermoeglicht gezieltes LIKE-Cleanup.
export async function setupAclFixture(prefix: string, opts: AclFixtureOpts = {}): Promise<AclFixture> {
  const { app } = await import("../../src/api/server.js");
  const { getDb } = await import("../../src/db/client.js");
  const { projectRepo } = await import("../../src/data/index.js");
  const { createDbUser, createToken } = await import("../../src/api/auth.js");

  const suffix = Date.now();
  const uname = (r: string) => `${prefix}-${r}-${suffix}`;
  const projectName = `${prefix}-proj-${suffix}`;
  const projectBName = `${prefix}-bproj-${suffix}`;

  const mk = async (r: string, role: "admin" | "user"): Promise<FixtureUser> => {
    const u = await createDbUser({ username: uname(r), password: "test-pw-123", role });
    return { id: u.id, username: u.username, role: u.role, token: createToken(u.username, u.role, u.id) };
  };

  const a = await mk("a", "user");
  const b = await mk("b", "user");
  const admin = await mk("admin", "admin");

  if (opts.geldRecht) {
    const db = getDb();
    await db`UPDATE users SET can_see_money = true WHERE id IN (${a.id}, ${b.id})`;
  }

  // Projekt nur A zuweisen (createdById) — bleibt bestehen, B darf es per ACL
  // nicht sehen.
  await projectRepo.create(projectName, {}, a.id);
  const info = await projectRepo.getInfo(projectName);
  if (!info?.id) throw new Error("Projekt-Setup fehlgeschlagen");
  const projectId = info.id;

  // Zweites Projekt B zuweisen (createdById = B) — B wird dadurch teil-
  // berechtigt: nicht-leere Sichtbarkeit (sein Projekt), aber weiterhin kein
  // Zugriff auf A's Projekt. Ohne das waere listVisibleProjectIds(B) = [] und
  // jeder ACL-Check fuer B trivial false — ein kaputter Check "hat irgendein
  // Projekt -> darf alles" bliebe unentdeckt.
  await projectRepo.create(projectBName, {}, b.id);
  const infoB = await projectRepo.getInfo(projectBName);
  if (!infoB?.id) throw new Error("Projekt-B-Setup fehlgeschlagen");
  const projectBId = infoB.id;

  return {
    app,
    a,
    b,
    admin,
    projectId,
    projectName,
    projectBId,
    projectBName,
    async cleanup() {
      const db = getDb();
      // Beide Projekte explizit per id loeschen (cascadet abhaengige Zeilen mit
      // project_id NOT NULL ON DELETE CASCADE weg: time_entries, project_invoices,
      // project_phases). Der LIKE-Cleanup deckt danach die Users ab.
      await db`DELETE FROM projects WHERE id = ${projectId}`;
      await db`DELETE FROM projects WHERE id = ${projectBId}`;
      await db`DELETE FROM users WHERE username LIKE ${prefix + "-%-" + suffix}`;
    },
  };
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
export const jsonHeader = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});
