import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET, USERS_FILE, DB_ENABLED } from "../config.js";
import { getDb } from "../db/client.js";
import type { Context, Next } from "hono";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserSettings {
  displayName?: string;
  notificationsEnabled?: boolean;
  defaultProject?: string | null;
  chatSearchMode?: boolean;
}

/** User-Objekt im JSON-Fallback (legacy). */
export interface User {
  username: string;
  passwordHash: string;
  role: string;
  createdAt: string;
  settings?: UserSettings;
}

/** Vollstaendiger DB-User. id ist die Source-of-Truth fuer alles, was an
 *  einen User gebunden ist (created_by, user_projects, file_shares, ...). */
export interface DbUser {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  role: "admin" | "user";
  isProtected: boolean;
  telegramChatId: string | null;
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
}

/** JWT-Payload. sub ist die User-UUID (JWT-Standard). username + role
 *  redundant fuer Legacy-Reader, werden aber nie als Source-of-Truth
 *  verwendet — bei jedem Request wird c.var.user aus DB nachgeladen. */
export interface JwtPayload {
  sub?: string;
  username: string;
  role: string;
}

// ── DB-Helper ────────────────────────────────────────────────────────────────

function rowToDbUser(row: Record<string, unknown>): DbUser {
  const settings = row.settings && typeof row.settings === "object" ? (row.settings as UserSettings) : {};
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    displayName: row.display_name ? String(row.display_name) : null,
    role: (row.role === "admin" ? "admin" : "user") as DbUser["role"],
    isProtected: row.is_protected === true,
    telegramChatId:
      row.telegram_chat_id !== null && row.telegram_chat_id !== undefined ? String(row.telegram_chat_id) : null,
    settings,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findDbUserByUsername(username: string): Promise<DbUser | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`SELECT * FROM users WHERE username = ${username} LIMIT 1`;
  return row ? rowToDbUser(row) : null;
}

export async function findDbUserById(id: string): Promise<DbUser | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return row ? rowToDbUser(row) : null;
}

export async function countDbAdmins(): Promise<number> {
  if (!DB_ENABLED) return 0;
  const db = getDb();
  const [row] = await db`SELECT count(*)::int as c FROM users WHERE role = 'admin'`;
  return Number(row?.c ?? 0);
}

export async function countDbUsers(): Promise<number> {
  if (!DB_ENABLED) return 0;
  const db = getDb();
  const [row] = await db`SELECT count(*)::int as c FROM users`;
  return Number(row?.c ?? 0);
}

/** Aktualisiert Settings eines DB-Users. Settings werden gemerged, nicht
 *  ueberschrieben — kompatibel zur JSON-Variante in updateUser(). */
export async function updateDbUserSettings(userId: string, patch: UserSettings): Promise<DbUser | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [current] = await db`SELECT settings FROM users WHERE id = ${userId} LIMIT 1`;
  if (!current) return null;
  const existing = (current.settings && typeof current.settings === "object" ? current.settings : {}) as UserSettings;
  const merged: UserSettings = { ...existing, ...patch };
  const [row] = await db`
    UPDATE users SET settings = ${JSON.stringify(merged)}::jsonb
    WHERE id = ${userId} RETURNING *
  `;
  return row ? rowToDbUser(row) : null;
}

/** Setzt das Passwort eines DB-Users (bcrypt-Hash bereits gemacht). */
export async function updateDbUserPassword(userId: string, hash: string): Promise<boolean> {
  if (!DB_ENABLED) return false;
  const db = getDb();
  const result = await db`UPDATE users SET password_hash = ${hash} WHERE id = ${userId}`;
  return result.count > 0;
}

/** Setup: legt den Erst-Admin an. Race-sicher — selbst zwei parallele
 *  Aufrufe koennen nicht beide einen geschuetzten Admin erzeugen.
 *
 *  Atomic: SELECT ... WHERE NOT EXISTS-Pattern. Wenn beim INSERT bereits
 *  ein Admin existiert, gibt RETURNING leer zurueck → wir werfen. Der
 *  username-UNIQUE-Constraint ist eine zweite Verteidigungslinie. */
export async function createInitialAdmin(username: string, password: string): Promise<DbUser> {
  if (!DB_ENABLED) throw new Error("Setup benoetigt DB-Modus");

  const passwordHash = await hashPassword(password);
  const db = getDb();
  const rows = await db`
    INSERT INTO users (username, password_hash, role, is_protected, settings)
    SELECT ${username}, ${passwordHash}, 'admin', true, '{}'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM users)
    RETURNING *
  `;
  if (rows.length === 0) {
    throw new Error("Setup bereits abgeschlossen");
  }
  return rowToDbUser(rows[0]!);
}

// ── Legacy JSON-Helper (Fallback solange noch keine DB-User) ────────────────

export function loadUsers(): User[] {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveUsers(users: User[]): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

export function findUser(username: string): User | undefined {
  return loadUsers().find((u) => u.username === username);
}

export function updateUser(username: string, patch: Partial<User>): User | undefined {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return undefined;
  const next: User = {
    ...users[idx],
    ...patch,
    settings: patch.settings ? { ...users[idx].settings, ...patch.settings } : users[idx].settings,
  };
  users[idx] = next;
  saveUsers(users);
  return next;
}

// ── Crypto ───────────────────────────────────────────────────────────────────

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// ── JWT ──────────────────────────────────────────────────────────────────────

/** Token-Erstellung. id ist optional (Migration-Kompat — Legacy-JSON-User
 *  haben keine UUID), aber neue Tokens haben es immer. */
export function createToken(username: string, role: string, id?: string): string {
  const payload: JwtPayload = { username, role };
  if (id) payload.sub = id;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// ── Hono Middleware ──────────────────────────────────────────────────────────

/**
 * Auth-Middleware. Setzt:
 *   c.var.user      → JwtPayload (Legacy — nicht erweitert)
 *   c.var.userId    → string | null  (UUID, falls in JWT oder DB-Lookup ergibt eine)
 *   c.var.userRole  → 'admin' | 'user'
 *   c.var.dbUser    → DbUser | null  (vollstaendig, nur wenn DB_ENABLED + Match)
 *
 * Ablauf:
 *   1. JWT verifizieren
 *   2. Wenn JWT.sub vorhanden → DB lookup by id
 *   3. Sonst → DB lookup by username (Legacy-JWTs ohne sub)
 *   4. Wenn keine DB → JSON-User aus loadUsers()
 *   5. userId / dbUser entsprechend setzen
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header("Authorization");
  let token: string | undefined;

  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  }
  if (!token) {
    token = c.req.query("token") ?? undefined;
  }
  if (!token) {
    return c.json({ error: "Nicht autorisiert" }, 401);
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return c.json({ error: "Token ungueltig oder abgelaufen" }, 401);
  }

  c.set("user", payload);
  c.set("userRole", payload.role === "admin" ? "admin" : "user");

  if (DB_ENABLED) {
    let dbUser: DbUser | null = null;
    // sub ist erst seit Phase 1 gesetzt — alte JWTs ohne sub fallen sauber
    // auf username-Lookup zurueck. Ohne diesen Guard wuerde postgres.js
    // WHERE id = NULL ausfuehren, was zwar nicht crashed aber unnoetig ist.
    if (payload.sub && typeof payload.sub === "string") {
      dbUser = await findDbUserById(payload.sub);
    }
    if (!dbUser && payload.username) {
      dbUser = await findDbUserByUsername(payload.username);
    }
    if (dbUser) {
      c.set("userId", dbUser.id);
      c.set("userRole", dbUser.role);
      c.set("dbUser", dbUser);
    } else {
      c.set("userId", null);
      c.set("dbUser", null);
    }
  } else {
    c.set("userId", null);
    c.set("dbUser", null);
  }

  await next();
}

/**
 * Admin-Guard fuer privilegierte Routes (Phase 2: /admin/users etc.).
 * Setzt voraus, dass authMiddleware bereits gelaufen ist.
 */
export async function adminMiddleware(c: Context, next: Next): Promise<Response | void> {
  const role = c.var.userRole as string | undefined;
  if (role !== "admin") {
    return c.json({ error: "Admin-Rechte erforderlich" }, 403);
  }
  await next();
}
