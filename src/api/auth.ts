import fs from "fs";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { JWT_SECRET, USERS_FILE } from "../config.js";
import type { Context, Next } from "hono";

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  username: string;
  passwordHash: string;
  role: string;
  createdAt: string;
}

export interface JwtPayload {
  username: string;
  role: string;
}

// ── Users ────────────────────────────────────────────────────────────────────

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

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function createToken(username: string, role: string): string {
  return jwt.sign({ username, role } as JwtPayload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// ── Hono Middleware ──────────────────────────────────────────────────────────

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  // 1. Authorization Header (Standard)
  const header = c.req.header("Authorization");
  let token: string | undefined;

  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  }

  // 2. Fallback: Query-Parameter ?token= (fuer EventSource/SSE)
  if (!token) {
    token = c.req.query("token") ?? undefined;
  }

  if (!token) {
    return c.json({ error: "Nicht autorisiert" }, 401);
  }

  try {
    const payload = verifyToken(token);
    c.set("user", payload);
    await next();
  } catch {
    return c.json({ error: "Token ungueltig oder abgelaufen" }, 401);
  }
}
