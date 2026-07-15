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
  a: FixtureUser; // Ersteller, hat Projektzugriff
  b: FixtureUser; // Fremder, kein Projektzugriff
  admin: FixtureUser; // Admin, sieht alles
  projectId: string;
  projectName: string;
  cleanup(): Promise<void>;
}

// `prefix` haelt die Testdaten pro Suite eindeutig (Nutzernamen + Projektname)
// und ermoeglicht gezieltes LIKE-Cleanup.
export async function setupAclFixture(prefix: string): Promise<AclFixture> {
  const { app } = await import("../../src/api/server.js");
  const { getDb } = await import("../../src/db/client.js");
  const { projectRepo } = await import("../../src/data/index.js");
  const { createDbUser, createToken } = await import("../../src/api/auth.js");

  const suffix = Date.now();
  const uname = (r: string) => `${prefix}-${r}-${suffix}`;
  const projectName = `${prefix}-proj-${suffix}`;

  const mk = async (r: string, role: "admin" | "user"): Promise<FixtureUser> => {
    const u = await createDbUser({ username: uname(r), password: "test-pw-123", role });
    return { id: u.id, username: u.username, role: u.role, token: createToken(u.username, u.role, u.id) };
  };

  const a = await mk("a", "user");
  const b = await mk("b", "user");
  const admin = await mk("admin", "admin");

  // Projekt nur A zuweisen (createdById) — bleibt bestehen, B darf es per ACL
  // nicht sehen.
  await projectRepo.create(projectName, {}, a.id);
  const info = await projectRepo.getInfo(projectName);
  if (!info?.id) throw new Error("Projekt-Setup fehlgeschlagen");
  const projectId = info.id;

  return {
    app,
    a,
    b,
    admin,
    projectId,
    projectName,
    async cleanup() {
      const db = getDb();
      await db`DELETE FROM projects WHERE id = ${projectId}`;
      await db`DELETE FROM users WHERE username LIKE ${prefix + "-%-" + suffix}`;
    },
  };
}

export const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });
export const jsonHeader = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});
