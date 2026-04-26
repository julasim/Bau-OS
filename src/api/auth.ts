import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET, USERS_FILE, DB_ENABLED } from "../config.js";
import { getDb } from "../db/client.js";
import { encryptString, decryptString } from "./crypto.js";
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
  // Phase 6: Per-User Bots
  telegramBotToken: string | null;
  telegramBotEnabled: boolean;
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
    // Phase-6-Cleanup: bot_token kann encrypted oder Legacy-plaintext sein.
    // decryptString erkennt das am "enc:v1:"-Prefix und gibt im Plaintext-Fall
    // den Wert unveraendert zurueck.
    telegramBotToken: decryptString(row.telegram_bot_token ? String(row.telegram_bot_token) : null),
    telegramBotEnabled: row.telegram_bot_enabled !== false,
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

/** Liste aller DB-User, fuer Admin-Verwaltung. Sortiert: geschuetzte
 *  Admins zuerst, dann Admins, dann User, alphabetisch. */
export async function listDbUsers(): Promise<DbUser[]> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = await db`
    SELECT * FROM users
    ORDER BY is_protected DESC, role DESC, username ASC
  `;
  return rows.map(rowToDbUser);
}

/** Legt einen neuen DB-User an. Throws bei UNIQUE-Konflikt auf username. */
export async function createDbUser(input: {
  username: string;
  password: string;
  role: "admin" | "user";
  displayName?: string | null;
}): Promise<DbUser> {
  if (!DB_ENABLED) throw new Error("DB-Modus erforderlich");
  const passwordHash = await hashPassword(input.password);
  const db = getDb();
  const [row] = await db`
    INSERT INTO users (username, password_hash, role, display_name, is_protected, settings)
    VALUES (
      ${input.username}, ${passwordHash}, ${input.role},
      ${input.displayName ?? null}, false, '{}'::jsonb
    )
    RETURNING *
  `;
  return rowToDbUser(row);
}

/** Setzt Felder eines DB-Users. NICHT erlaubt: is_protected aufheben/setzen
 *  (das passiert ausschliesslich beim Initial-Setup). Caller muss separat
 *  pruefen, ob der Ziel-User geschuetzt ist.
 *
 *  Race-sicher (Loose-End-Cleanup): wenn die Aenderung den letzten Admin
 *  herabstufen wuerde, wird die Query atomar mit einem WHERE-Subselect
 *  geguardet. Die Route ueberprueft das Ergebnis (rows == 0 → "letzter Admin"). */
export async function updateDbUser(
  id: string,
  patch: { username?: string; role?: "admin" | "user"; displayName?: string | null },
): Promise<DbUser | null | "last-admin"> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [current] = await db`SELECT * FROM users WHERE id = ${id}`;
  if (!current) return null;

  const username = "username" in patch ? patch.username : current.username;
  const role = "role" in patch ? patch.role : current.role;
  const displayName = "displayName" in patch ? patch.displayName : current.display_name;

  // Atomarer Last-Admin-Schutz: wenn das ein Admin-Demote ist, MUSS noch
  // mindestens ein anderer Admin uebrig bleiben. Sonst RETURNING bleibt leer.
  const isDemote = current.role === "admin" && role !== "admin";
  if (isDemote) {
    const rows = await db`
      UPDATE users SET
        username = ${username},
        role = ${role},
        display_name = ${displayName}
      WHERE id = ${id}
        AND EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND id <> ${id})
      RETURNING *
    `;
    if (rows.length === 0) return "last-admin";
    return rowToDbUser(rows[0]!);
  }

  const [row] = await db`
    UPDATE users SET
      username = ${username},
      role = ${role},
      display_name = ${displayName}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ? rowToDbUser(row) : null;
}

/** Loescht einen DB-User. Caller muss is_protected vorher pruefen.
 *
 *  Race-sicher (Loose-End-Cleanup): wenn das Ziel ein Admin ist, MUSS noch
 *  mindestens ein weiterer Admin existieren. Atomic via WHERE-Subselect.
 *  Returns "last-admin" wenn die Query nichts geloescht hat, weil der
 *  Last-Admin-Schutz gegriffen hat. */
export async function deleteDbUser(id: string): Promise<boolean | "last-admin"> {
  if (!DB_ENABLED) return false;
  const db = getDb();
  const [target] = await db`SELECT role FROM users WHERE id = ${id}`;
  if (!target) return false;

  if (String(target.role) === "admin") {
    const result = await db`
      DELETE FROM users
       WHERE id = ${id}
         AND EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND id <> ${id})
    `;
    if (result.count === 0) return "last-admin";
    return true;
  }
  const result = await db`DELETE FROM users WHERE id = ${id}`;
  return result.count > 0;
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

// ── Telegram-Pair-Tokens (Phase 5) ──────────────────────────────────────────

/** Erzeugt einen 8-stelligen alphanumerischen Pair-Token mit 10-Min-Ablauf
 *  und schreibt ihn in telegram_pair_tokens. Caller muss admin sein.
 *  Rueckgabe: {token, expiresAt} fuer das UI. */
export async function createPairToken(userId: string): Promise<{ token: string; expiresAt: string }> {
  if (!DB_ENABLED) throw new Error("Pair-Token benoetigt DB-Modus");
  const db = getDb();
  // Vorhandene abgelaufene Tokens des Users gleich aufraeumen.
  await db`DELETE FROM telegram_pair_tokens WHERE user_id = ${userId} OR expires_at < now()`;

  // 8 Bytes random → 11 Base64-Zeichen → wir schneiden auf 8 ASCII-Zeichen
  // (gross+klein+zahlen) — gut tippbar im Telegram-Chat.
  const raw = crypto.randomBytes(6).toString("base64").replace(/[/+=]/g, "");
  const token = raw.slice(0, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await db`
    INSERT INTO telegram_pair_tokens (token, user_id, expires_at)
    VALUES (${token}, ${userId}, ${expiresAt})
  `;
  return { token, expiresAt };
}

/** Loest einen Pair-Token ein: prueft Existenz + Ablauf, setzt
 *  users.telegram_chat_id = chatId, loescht den Token. Gibt den verlinkten
 *  User zurueck oder null bei ungueltigem/abgelaufenem Token.
 *
 *  Atomar: der gesamte Validate+UPDATE+DELETE-Zyklus laeuft in einer
 *  Transaktion. Wuerde der Lookup ausserhalb stattfinden, koennte ein
 *  paralleler Redeem desselben Tokens beide chat_ids ueberschreiben. */
export async function redeemPairToken(token: string, chatId: string): Promise<DbUser | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  // Lazy-Cleanup von abgelaufenen Tokens — eine Aufraeumstelle reicht.
  await db`DELETE FROM telegram_pair_tokens WHERE expires_at < now()`;

  // Validate + UPDATE + DELETE in einer Transaktion. Wenn der SELECT 0 Rows
  // findet (paralleler Redeem hat den Token schon weg), brechen wir sauber ab.
  let userId: string | null = null;
  try {
    await db.begin(async (tx) => {
      const rows = await tx`
        SELECT user_id FROM telegram_pair_tokens
        WHERE token = ${token} AND expires_at >= now()
        LIMIT 1
      `;
      if (rows.length === 0) {
        throw new Error("__token_invalid__");
      }
      userId = String(rows[0]!.user_id);
      await tx`UPDATE users SET telegram_chat_id = ${chatId} WHERE id = ${userId}`;
      // Alle Tokens dieses Users werden invalidiert — ein User pairt sich
      // genau einmal, alte Codes braucht niemand.
      await tx`DELETE FROM telegram_pair_tokens WHERE user_id = ${userId}`;
    });
  } catch (err) {
    // Sentinel-Fehler aus dem Inneren der TX = "token not found", andere
    // Fehler bubblen weiter.
    if (err instanceof Error && err.message === "__token_invalid__") return null;
    throw err;
  }
  return userId ? findDbUserById(userId) : null;
}

/** Lookup eines Users anhand seiner verknuepften Telegram-Chat-ID.
 *  Wird vom Bot vor jeder LLM-Antwort genutzt, um nicht-gepairte Chats
 *  abzulehnen. */
export async function findDbUserByChatId(chatId: string | number): Promise<DbUser | null> {
  if (!DB_ENABLED) return null;
  const db = getDb();
  const [row] = await db`
    SELECT * FROM users WHERE telegram_chat_id = ${String(chatId)} LIMIT 1
  `;
  return row ? rowToDbUser(row) : null;
}

// ── Per-User Telegram-Bots (Phase 6) ────────────────────────────────────────

/** Setzt das persoenliche Telegram-Bot-Token eines Users.
 *  - token = null  → Bot wird entfernt (auch chat_id wird gewischt)
 *  - token gleich altem Wert → no-op (kein Bot-Restart noetig)
 *  - token != alter Wert → chat_id wird mit gewischt (frischer Bot, frische
 *    Zuordnung; Phase-6-D-Entscheidung)
 *
 *  Returns true bei Erfolg, false wenn kein User mit dieser id existiert.
 *  Der Bot-Manager pollt diese Aenderungen alle paar Sekunden. */
export async function setUserBotToken(userId: string, token: string | null): Promise<boolean> {
  if (!DB_ENABLED) return false;
  const trimmed = token?.trim() || null;
  const db = getDb();
  const [current] = await db`SELECT telegram_bot_token FROM users WHERE id = ${userId} LIMIT 1`;
  if (!current) return false;

  // Vergleich auf Plaintext-Ebene (current kann encrypted sein → erst entschluesseln).
  const oldPlain = decryptString(current.telegram_bot_token ? String(current.telegram_bot_token) : null);
  if (oldPlain === trimmed) return true; // no-op

  // Phase-6-Cleanup: ab jetzt verschluesselt in der DB. Bei null bleibt's null.
  const encrypted = trimmed ? encryptString(trimmed) : null;
  const result = await db`
    UPDATE users
       SET telegram_bot_token = ${encrypted},
           telegram_chat_id = NULL
     WHERE id = ${userId}
  `;
  return result.count > 0;
}

/** Aktiviert/deaktiviert den Bot eines Users ohne den Token zu loeschen. */
export async function setUserBotEnabled(userId: string, enabled: boolean): Promise<boolean> {
  if (!DB_ENABLED) return false;
  const db = getDb();
  const result = await db`
    UPDATE users SET telegram_bot_enabled = ${enabled} WHERE id = ${userId}
  `;
  return result.count > 0;
}

/** Liefert alle User mit aktivem Bot-Token — vom Bot-Manager beim Boot
 *  und bei Refresh-Polls genutzt. */
export async function listBotEnabledUsers(): Promise<DbUser[]> {
  if (!DB_ENABLED) return [];
  const db = getDb();
  const rows = await db`
    SELECT * FROM users
    WHERE telegram_bot_token IS NOT NULL
      AND telegram_bot_enabled = true
    ORDER BY id
  `;
  return rows.map(rowToDbUser);
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

// ── Auto-Import: Legacy-JSON-User in die DB nachziehen ────────────────────
//
// Beim Boot wird einmalig fuer jeden User aus users.json geprueft, ob er
// schon in der DB ist. Falls nicht, wird der Eintrag importiert — bcrypt-
// Hash wird 1:1 uebernommen (wurde schon mit derselben bcrypt.hash() Logik
// erzeugt), Login funktioniert ohne Unterbrechung weiter.
//
// Der erste importierte Admin wird is_protected=true, falls in der DB noch
// kein anderer geschuetzter Admin existiert. Das stellt sicher, dass die
// Firma nie alle Admin-Konten verlieren kann (siehe Schutzregeln in
// admin-users.ts).
//
// Idempotent: User die schon in der DB existieren, werden uebersprungen.
// users.json bleibt erhalten — forward-only Kultur, JSON ist Recovery-
// Fallback. Sobald ein User in DB ist, gewinnt der DB-Pfad (Login-Flow
// in server.ts prueft DB zuerst).
export async function importLegacyJsonUsers(): Promise<{ imported: number; skipped: number }> {
  if (!DB_ENABLED) return { imported: 0, skipped: 0 };
  const jsonUsers = loadUsers();
  if (jsonUsers.length === 0) return { imported: 0, skipped: 0 };

  const db = getDb();
  let imported = 0;
  let skipped = 0;

  // Wenn die DB noch keinen geschuetzten Admin hat, machen wir den ersten
  // importierten Admin protected.
  const [{ c: protectedCount }] = await db`
    SELECT count(*)::int AS c FROM users WHERE is_protected = true
  `;
  let needsProtected = Number(protectedCount) === 0;

  for (const ju of jsonUsers) {
    const existing = await findDbUserByUsername(ju.username);
    if (existing) {
      skipped++;
      continue;
    }

    const isAdmin = ju.role === "admin";
    const role: "admin" | "user" = isAdmin ? "admin" : "user";
    const shouldProtect = isAdmin && needsProtected;
    if (shouldProtect) needsProtected = false; // nur den ersten

    await db`
      INSERT INTO users (
        username, password_hash, role, display_name,
        is_protected, settings, created_at
      ) VALUES (
        ${ju.username},
        ${ju.passwordHash},
        ${role},
        ${ju.settings?.displayName ?? null},
        ${shouldProtect},
        ${JSON.stringify(ju.settings ?? {})}::jsonb,
        ${ju.createdAt ?? new Date().toISOString()}
      )
    `;
    imported++;
  }

  return { imported, skipped };
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
