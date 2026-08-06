import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET, USERS_FILE, BCRYPT_ROUNDS } from "../config.js";
import { getDb } from "../db/client.js";
import { encryptString, decryptString } from "./crypto.js";
import { peekTicket } from "./sse-tickets.js";
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
  /** Darf Betraege sehen — Stundensaetze, Rechnungen, Budgets,
   *  Deckungsbeitrag (Migration 043). Voreinstellung geschlossen; Admins sind
   *  im Code implizit berechtigt, nicht ueber diese Spalte. */
  canSeeMoney: boolean;
  // TOTP liegt still, bis es einen Zugang von aussen gibt (VPN). Die Spalte
  // und src/api/totp.ts bleiben dafuer unberuehrt.
  totpEnabled: boolean;
  // Reine Kontaktinformation. War bis zum Umbau auf den Firmenserver der
  // Zustellweg fuer Login-Codes und damit Pflicht — heute optional und ohne
  // Sicherheitsfunktion.
  email: string | null;
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
    canSeeMoney: row.can_see_money === true,
    totpEnabled: row.totp_enabled === true,
    email: row.email ? String(row.email) : null,
    settings,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function findDbUserByUsername(username: string): Promise<DbUser | null> {
  const db = getDb();
  const [row] = await db`SELECT * FROM users WHERE username = ${username} LIMIT 1`;
  return row ? rowToDbUser(row) : null;
}

export async function findDbUserById(id: string): Promise<DbUser | null> {
  const db = getDb();
  const [row] = await db`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
  return row ? rowToDbUser(row) : null;
}

export async function countDbAdmins(): Promise<number> {
  const db = getDb();
  const [row] = await db`SELECT count(*)::int as c FROM users WHERE role = 'admin'`;
  return Number(row?.c ?? 0);
}

export async function countDbUsers(): Promise<number> {
  const db = getDb();
  const [row] = await db`SELECT count(*)::int as c FROM users`;
  return Number(row?.c ?? 0);
}

/** Liste aller DB-User, fuer Admin-Verwaltung. Sortiert: geschuetzte
 *  Admins zuerst, dann Admins, dann User, alphabetisch. */
export async function listDbUsers(): Promise<DbUser[]> {
  const db = getDb();
  const rows = await db`
    SELECT * FROM users
    ORDER BY is_protected DESC, role DESC, username ASC
  `;
  return rows.map(rowToDbUser);
}

/** Legt einen neuen DB-User an. Throws bei UNIQUE-Konflikt auf username.
 *
 *  Auto-Link Migration 013: nach erfolgreichem INSERT prueft die Funktion,
 *  ob ein team_member mit passendem Namen (case-insensitive auf username
 *  oder displayName) existiert UND noch keinen user_id hat. Falls ja UND
 *  eindeutig, wird die Verknuepfung gesetzt. Damit kommen Notifications
 *  automatisch beim neuen User an, sobald er gepairt ist — kein manueller
 *  Klick im TeamDetailView noetig.
 *
 *  Konservativ: bei Mehrdeutigkeit (mehrere team_members mit gleichem Namen)
 *  wird NICHT verlinkt. Admin muss in dem Fall manuell setzen.
 */
export async function createDbUser(input: {
  username: string;
  password: string;
  role: "admin" | "user";
  displayName?: string | null;
  /** Optional. Wenn gesetzt: User ueberspringt den Email-Setup-Gate beim
   *  ersten Login — Admin hat die Email schon hinterlegt. */
  email?: string | null;
}): Promise<DbUser> {
  const passwordHash = await hashPassword(input.password);
  const db = getDb();
  const normalizedEmail = input.email?.trim().toLowerCase() || null;
  const [row] = await db`
    INSERT INTO users (username, password_hash, role, display_name, email, is_protected, settings)
    VALUES (
      ${input.username}, ${passwordHash}, ${input.role},
      ${input.displayName ?? null}, ${normalizedEmail}, false, '{}'::jsonb
    )
    RETURNING *
  `;
  const user = rowToDbUser(row);

  // Auto-Link: gibt es ein team_member ohne user_id, dessen Name zum
  // neuen User passt? Wenn EINDEUTIG (Count=1), dann verlinken.
  // CTE prueft erst ob Match eindeutig ist, bevor das UPDATE feuert —
  // sonst werden bei "Max Mueller" + zwei team_members beide gewildert.
  try {
    await db`
      WITH candidates AS (
        SELECT id FROM team_members
         WHERE user_id IS NULL
           AND (
             LOWER(TRIM(name)) = LOWER(TRIM(${user.username}))
             OR LOWER(TRIM(name)) = LOWER(TRIM(${user.displayName ?? ""}))
           )
      )
      UPDATE team_members
         SET user_id = ${user.id}
       WHERE id IN (SELECT id FROM candidates)
         AND (SELECT COUNT(*) FROM candidates) = 1
    `;
  } catch {
    // Tabelle team_members existiert evtl. nicht (FS-Mode-Mix) — egal,
    // dann gibt es eben keinen Auto-Link.
  }

  return user;
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
  patch: {
    username?: string;
    role?: "admin" | "user";
    displayName?: string | null;
    email?: string | null;
    canSeeMoney?: boolean;
  },
): Promise<DbUser | null | "last-admin"> {
  const db = getDb();
  const [current] = await db`SELECT * FROM users WHERE id = ${id}`;
  if (!current) return null;

  const username = "username" in patch ? patch.username : current.username;
  const role = "role" in patch ? patch.role : current.role;
  const displayName = "displayName" in patch ? patch.displayName : current.display_name;
  // Email normalisiert (lowercase, trimmed) damit UNIQUE-Index sauber matcht.
  const email = "email" in patch ? patch.email?.trim().toLowerCase() || null : current.email;
  const canSeeMoney = "canSeeMoney" in patch ? patch.canSeeMoney === true : current.can_see_money === true;

  // Atomarer Last-Admin-Schutz: wenn das ein Admin-Demote ist, MUSS noch
  // mindestens ein anderer Admin uebrig bleiben. Sonst RETURNING bleibt leer.
  const isDemote = current.role === "admin" && role !== "admin";
  if (isDemote) {
    const rows = await db`
      UPDATE users SET
        username = ${username},
        role = ${role},
        display_name = ${displayName},
        email = ${email},
        can_see_money = ${canSeeMoney}
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
      display_name = ${displayName},
      email = ${email},
      can_see_money = ${canSeeMoney}
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
export async function createInitialAdmin(username: string, password: string, email?: string): Promise<DbUser> {
  const passwordHash = await hashPassword(password);
  const normalizedEmail = email?.trim().toLowerCase() || null;
  const db = getDb();
  const rows = await db`
    INSERT INTO users (username, password_hash, role, email, is_protected, settings)
    SELECT ${username}, ${passwordHash}, 'admin', ${normalizedEmail}, true, '{}'::jsonb
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

/** Hasht ein Passwort mit dem konfigurierten Kostenfaktor.
 *
 *  Bestehende Hashes tragen ihren Kostenfaktor in sich ($2b$10$...) und
 *  bleiben gueltig — bcrypt.compare liest ihn aus dem Hash. Ein Konto von
 *  vor der Anhebung wird also weiter angenommen und erst beim naechsten
 *  Passwortwechsel auf den neuen Faktor gehoben. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
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
  const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtPayload & { aud?: string };
  // Whitelist: reguläre Auth-Tokens dürfen KEIN audience-Feld haben.
  // Deckt alle Ticket-Typen ab (2fa, 2fa-setup, password-reset, magic-link, …)
  // ohne dass jede neue Audience einzeln blacklisted werden muss.
  if (decoded.aud !== undefined) {
    throw new Error("Kein reguläres Auth-Token — Ticket-Token ist nicht für API-Zugriff gültig");
  }
  return decoded;
}

// ── Hono Middleware ──────────────────────────────────────────────────────────

/**
 * Auth-Middleware. Setzt:
 *   c.var.user      → JwtPayload (Legacy — nicht erweitert)
 *   c.var.userId    → string | null  (UUID, falls in JWT oder DB-Lookup ergibt eine)
 *   c.var.userRole  → 'admin' | 'user'
 *   c.var.dbUser    → DbUser (immer gesetzt; ohne Konto kommt 401)
 *
 * Ablauf:
 *   1. JWT verifizieren
 *   2. Wenn JWT.sub vorhanden → Datenbank-Suche ueber die id
 *   3. Sonst → Datenbank-Suche ueber den Benutzernamen (aeltere JWTs ohne sub)
 *   4. userId / dbUser entsprechend setzen
 *
 * Findet sich kein Konto, wird das Token abgewiesen (401). Einen Rueckfall
 * auf `data/users.json` gibt es nicht mehr.
 */
export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header("Authorization");
  let token: string | undefined;

  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  }
  if (!token) {
    // Query-Parameter nur für Streaming/Download-Endpoints erlauben
    // (EventSource und Browser-Downloads können keine Custom-Header setzen).
    // Sonst landen JWTs in Server-Logs, Browser-History und Referer-Headern.
    const path = c.req.path;
    const allowQueryToken = path.startsWith("/api/events") || path.startsWith("/api/files/download");
    if (allowQueryToken) {
      token = c.req.query("token") ?? undefined;
    }
  }
  if (!token) {
    // SSE-Verbindungsaufbau via One-Time-Ticket: Der Client holt sich per
    // authentifiziertem POST /api/events/ticket ein kurzlebiges Ticket und
    // haengt es an die EventSource-URL. Ein gueltiges Ticket ersetzt hier
    // den fehlenden JWT-Query-Param — eingeloest (und damit entwertet) wird
    // es erst in der GET /events-Route selbst.
    if (c.req.path === "/api/events") {
      const ticket = c.req.query("ticket");
      if (ticket) {
        if (peekTicket(ticket)) {
          return next();
        }
      }
    }
    return c.json({ error: "Nicht autorisiert" }, 401);
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return c.json({ error: "Token ungueltig oder abgelaufen" }, 401);
  }

  c.set("user", payload);

  let dbUser: DbUser | null = null;
  // `sub` ist erst seit Phase 1 gesetzt — aeltere JWTs ohne sub fallen sauber
  // auf die Suche ueber den Benutzernamen zurueck. Ohne diesen Guard fuehrte
  // postgres.js ein `WHERE id = NULL` aus: kein Absturz, aber sinnlos.
  if (payload.sub && typeof payload.sub === "string") {
    dbUser = await findDbUserById(payload.sub);
  }
  if (!dbUser && payload.username) {
    dbUser = await findDbUserByUsername(payload.username);
  }

  // Ein Token, das auf ein nicht (mehr) vorhandenes Konto zeigt, wird
  // abgewiesen. Sonst behielte es seine im JWT eingebackene Rolle — und ein
  // geloeschter Admin haette bis zu sieben Tage lang weiter Admin-Zugriff.
  //
  // Frueher stand hier ein Rueckfall auf `data/users.json`. Er ist mit den
  // JSON-Konten entfallen; bestehende Eintraege gehen beim Start in die
  // Datenbank ueber (`importLegacyJsonUsers()`).
  if (!dbUser) {
    return c.json({ error: "Konto nicht mehr vorhanden" }, 401);
  }
  c.set("userId", dbUser.id);
  c.set("dbUser", dbUser);

  // Die Rolle kommt IMMER aus der Datenbank, nie aus dem JWT — sonst behielte
  // ein altes Admin-Token nach einer Herabstufung sieben Tage lang seine
  // Rechte.
  const userRole = dbUser.role === "admin" ? "admin" : "user";
  c.set("userRole", userRole);

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

// ── 2FA / TOTP (Phase 7 Pre-Production) ─────────────────────────────────────
//
// Lifecycle:
//   1. Setup-Schritt 1: User klickt "2FA aktivieren". POST /auth/2fa/setup
//      generiert einen frischen Secret, verschluesselt + speichert ihn,
//      liefert otpauth-URI fuer QR-Code-Anzeige zurueck. totp_enabled
//      bleibt false.
//   2. Setup-Schritt 2: User scannt QR, gibt aktuellen 6-stelligen Token
//      ein. POST /auth/2fa/verify prueft den Token, setzt totp_enabled=true,
//      generiert 10 Backup-Codes (Plaintext einmalig im Response, Hashes
//      in der DB). Ab jetzt verlangt der Login das 2. Token.
//   3. Login-Flow: nach erfolgreichem Passwort liefert /auth/login statt
//      einem JWT ein kurzes "Ticket" (5 Minuten gueltig, audience='2fa'),
//      mit dem POST /auth/login/2fa eingeloest werden kann.
//   4. Disable: POST /auth/2fa/disable braucht aktuelles Passwort + gueltigen
//      TOTP-Token (Self-Lockout-Vermeidung). Loescht Secret + Backup-Codes.

/** Liest den entschluesselten TOTP-Secret eines Users. Nur fuer Server-
 *  interne Verifikation — der Plaintext-Secret verlaesst nie die API.
 *  Liefert null wenn 2FA noch gar nicht eingerichtet wurde. */
export async function getTotpSecretPlain(userId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db`
    SELECT totp_secret_encrypted FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (!row?.totp_secret_encrypted) return null;
  return decryptString(String(row.totp_secret_encrypted));
}

/** Speichert einen frischen Base32-Secret. Setzt totp_enabled NICHT —
 *  das passiert erst bei der Verifikation. Falls schon einer drin war,
 *  ueberschreiben (der User klickt "Setup wiederholen"). */
export async function storeTotpSecret(userId: string, secretBase32: string): Promise<boolean> {
  const db = getDb();
  const encrypted = encryptString(secretBase32);
  const result = await db`
    UPDATE users
       SET totp_secret_encrypted = ${encrypted},
           totp_enabled = false,
           totp_backup_codes = '[]'::jsonb,
           totp_verified_at = NULL
     WHERE id = ${userId}
  `;
  return result.count > 0;
}

/** Aktiviert 2FA. Backup-Codes als bcrypt-Hashes (jeweils $2b$10$...).
 *  Caller hat den Token bereits verifiziert. */
export async function enableTotp(userId: string, backupCodeHashes: string[]): Promise<boolean> {
  const db = getDb();
  const result = await db`
    UPDATE users
       SET totp_enabled = true,
           totp_backup_codes = ${JSON.stringify(backupCodeHashes)}::jsonb,
           totp_verified_at = now()
     WHERE id = ${userId}
       AND totp_secret_encrypted IS NOT NULL
  `;
  return result.count > 0;
}

/** Deaktiviert 2FA komplett. Caller hat Passwort + Token verifiziert. */
export async function disableTotp(userId: string): Promise<boolean> {
  const db = getDb();
  const result = await db`
    UPDATE users
       SET totp_secret_encrypted = NULL,
           totp_enabled = false,
           totp_backup_codes = '[]'::jsonb,
           totp_verified_at = NULL
     WHERE id = ${userId}
  `;
  return result.count > 0;
}

/** Prueft einen Backup-Code gegen die gespeicherten Hashes. Bei Treffer
 *  wird der Hash entfernt (Einmalverwendung). Liefert true bei Erfolg. */
export async function consumeBackupCode(userId: string, code: string): Promise<boolean> {
  const cleaned = code.trim().toLowerCase();
  if (!cleaned) return false;
  const db = getDb();
  const [row] = await db`
    SELECT totp_backup_codes FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (!row?.totp_backup_codes || !Array.isArray(row.totp_backup_codes)) return false;
  const hashes = row.totp_backup_codes as string[];
  for (let i = 0; i < hashes.length; i++) {
    const ok = await bcrypt.compare(cleaned, hashes[i]!);
    if (ok) {
      const remaining = hashes.filter((_, j) => j !== i);
      await db`
        UPDATE users SET totp_backup_codes = ${JSON.stringify(remaining)}::jsonb
        WHERE id = ${userId}
      `;
      return true;
    }
  }
  return false;
}

/** Hasht eine Liste Backup-Codes mit bcrypt. Bewusst sequentiell, weil
 *  10 Codes * ~50ms = 500ms — kein Problem im Setup-Flow. */
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const c of codes) {
    out.push(await bcrypt.hash(c.toLowerCase(), 10));
  }
  return out;
}

// ── 2FA-Login-Ticket (kurzlebiges JWT zwischen Schritt 1 und 2) ─────────────
//
// Nach erfolgreichem Passwort kriegt der User ein "Ticket" — JWT mit
// audience='2fa' und 5-Min-Ablauf. Damit kann er POST /auth/login/2fa
// aufrufen ohne erneutes Passwort. Das Ticket ist NICHT als regulaeres
// JWT gueltig (audience-Check verhindert das).

interface TwoFactorTicketPayload {
  sub: string;
  username: string;
  role: string;
  aud: "2fa";
}

export function create2faTicket(user: DbUser): string {
  const payload: TwoFactorTicketPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    aud: "2fa",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "5m" });
}

export function verify2faTicket(ticket: string): TwoFactorTicketPayload | null {
  try {
    const decoded = jwt.verify(ticket, JWT_SECRET, {
      audience: "2fa",
      algorithms: ["HS256"],
    }) as TwoFactorTicketPayload;
    if (decoded.aud !== "2fa") return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Liefert true wenn die Email-Adresse schon einem ANDEREN User gehoert.
 *  Fuer Pre-Check beim Email-Setup, damit der UNIQUE-Constraint nicht
 *  ueberraschend kracht. */
export async function isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();
  const rows = await db`
    SELECT 1 FROM users
     WHERE LOWER(email) = ${normalized}
       ${exceptUserId ? db`AND id <> ${exceptUserId}` : db``}
     LIMIT 1
  `;
  return rows.length > 0;
}
