// ============================================================
// PATIO — 2FA / TOTP Setup-Routes
// ============================================================
// Drei Endpunkte fuer den Setup-Flow:
//   POST /auth/2fa/setup    → frischen Secret + QR-URI generieren
//   POST /auth/2fa/verify   → Token bestaetigen, 2FA aktivieren,
//                             Backup-Codes ausliefern (einmalig)
//   POST /auth/2fa/disable  → Passwort + Token verifizieren, 2FA aus
//
// Alle drei brauchen einen eingeloggten User (authMiddleware vorgeschaltet).
// Status-Endpunkt /auth/2fa/status liefert nur das totpEnabled-Flag —
// nicht den Secret, nicht die Backup-Codes.
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import {
  verifyPassword,
  storeTotpSecret,
  enableTotp,
  disableTotp,
  hashBackupCodes,
  getTotpSecretPlain,
  findDbUserById,
} from "../auth.js";
import { generateSecret, buildOtpAuthUri, verifyToken as verifyTotpToken, generateBackupCodes } from "../totp.js";
import { logInfo } from "../../logger.js";
import { logEvent as audit } from "../../data/db-audit.js";

function reqMeta(c: { req: { header(name: string): string | undefined } }): { ip: string; userAgent: string } {
  const ipRaw = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";
  const ua = (c.req.header("user-agent") ?? "").slice(0, 256);
  return { ip: ipRaw, userAgent: ua };
}

export const auth2faRoutes = new Hono<AppEnv>();

// ── GET /auth/2fa/status ────────────────────────────────────────────────────
auth2faRoutes.get("/auth/2fa/status", (c) => {
  const dbUser = c.get("dbUser");
  if (!dbUser) {
    // Legacy-JSON-User koennen 2FA nicht aktivieren — kein DB-Eintrag.
    return c.json({ enabled: false, available: false });
  }
  return c.json({ enabled: dbUser.totpEnabled, available: true });
});

// ── POST /auth/2fa/setup ────────────────────────────────────────────────────
// Generiert einen frischen Secret. Falls bereits ein nicht-aktivierter
// Secret in der DB liegt, wird er ueberschrieben — das ist der Fall wenn
// der User den Setup-Wizard mehrfach oeffnet ohne ihn abzuschliessen.
// Falls 2FA bereits aktiv ist: 409, der User soll erst disable.
auth2faRoutes.post("/auth/2fa/setup", async (c) => {
  const dbUser = c.get("dbUser");
  if (!dbUser) return c.json({ error: "2FA nur fuer DB-User verfuegbar" }, 400);
  if (dbUser.totpEnabled) {
    return c.json({ error: "2FA ist bereits aktiv. Bitte zuerst deaktivieren." }, 409);
  }

  const secret = generateSecret();
  const ok = await storeTotpSecret(dbUser.id, secret);
  if (!ok) return c.json({ error: "Speichern fehlgeschlagen" }, 500);

  const meta = reqMeta(c);
  void audit({
    event: "2fa.setup.start",
    actorUserId: dbUser.id,
    actorUsername: dbUser.username,
    actorRole: dbUser.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  const uri = buildOtpAuthUri(secret, dbUser.username, "PATIO");
  return c.json({ secret, otpauthUri: uri });
});

// ── POST /auth/2fa/verify ───────────────────────────────────────────────────
// Bestaetigt den Setup mit einem ersten gueltigen Token. Generiert die
// Backup-Codes — diese werden im Response zurueckgegeben (einmalig im
// Klartext) und nur als Hashes gespeichert.
auth2faRoutes.post("/auth/2fa/verify", async (c) => {
  const dbUser = c.get("dbUser");
  if (!dbUser) return c.json({ error: "2FA nur fuer DB-User verfuegbar" }, 400);
  if (dbUser.totpEnabled) {
    return c.json({ error: "2FA ist bereits aktiv" }, 409);
  }

  let body: { token: string };
  try {
    body = await c.req.json<{ token: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.token) return c.json({ error: "Token erforderlich" }, 400);

  const secret = await getTotpSecretPlain(dbUser.id);
  if (!secret) {
    return c.json({ error: "Kein Setup gestartet — bitte zuerst /setup aufrufen" }, 400);
  }
  if (!verifyTotpToken(secret, body.token)) {
    return c.json({ error: "Token ungueltig — Uhr stimmt nicht oder falscher Code?" }, 401);
  }

  const codes = generateBackupCodes(10);
  const hashes = await hashBackupCodes(codes);
  const ok = await enableTotp(dbUser.id, hashes);
  if (!ok) return c.json({ error: "Aktivierung fehlgeschlagen" }, 500);

  logInfo(`[2FA] ${dbUser.username} hat 2FA aktiviert`);
  const meta = reqMeta(c);
  void audit({
    event: "2fa.enable",
    actorUserId: dbUser.id,
    actorUsername: dbUser.username,
    actorRole: dbUser.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { backupCodes: codes.length },
  });
  return c.json({ ok: true, backupCodes: codes });
});

// ── POST /auth/2fa/disable ──────────────────────────────────────────────────
// Self-Lockout-Schutz: Passwort + entweder TOTP-Token oder Backup-Code.
// Damit kann jemand ohne Authenticator-App noch deaktivieren wenn er
// einen Backup-Code hat, aber niemand kann von "auf der anderen Seite
// des Schreibtisches" 2FA abschalten ohne die Faktoren.
auth2faRoutes.post("/auth/2fa/disable", async (c) => {
  const dbUser = c.get("dbUser");
  if (!dbUser) return c.json({ error: "2FA nur fuer DB-User verfuegbar" }, 400);
  if (!dbUser.totpEnabled) {
    return c.json({ error: "2FA ist nicht aktiv" }, 400);
  }

  let body: { password: string; token?: string; backupCode?: string };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  if (!body.password) return c.json({ error: "Passwort erforderlich" }, 400);
  if (!body.token && !body.backupCode) {
    return c.json({ error: "TOTP-Token oder Backup-Code erforderlich" }, 400);
  }

  const fresh = await findDbUserById(dbUser.id);
  if (!fresh) return c.json({ error: "User nicht gefunden" }, 404);
  const pwOk = await verifyPassword(body.password, fresh.passwordHash);
  if (!pwOk) return c.json({ error: "Passwort falsch" }, 401);

  if (body.token) {
    const secret = await getTotpSecretPlain(dbUser.id);
    if (!secret) return c.json({ error: "Kein Secret hinterlegt" }, 500);
    if (!verifyTotpToken(secret, body.token)) {
      return c.json({ error: "TOTP-Token ungueltig" }, 401);
    }
  } else if (body.backupCode) {
    const { consumeBackupCode } = await import("../auth.js");
    const ok = await consumeBackupCode(dbUser.id, body.backupCode);
    if (!ok) return c.json({ error: "Backup-Code ungueltig" }, 401);
  }

  const ok = await disableTotp(dbUser.id);
  if (!ok) return c.json({ error: "Deaktivierung fehlgeschlagen" }, 500);

  logInfo(`[2FA] ${dbUser.username} hat 2FA deaktiviert`);
  const meta = reqMeta(c);
  void audit({
    event: "2fa.disable",
    actorUserId: dbUser.id,
    actorUsername: dbUser.username,
    actorRole: dbUser.role,
    ip: meta.ip,
    userAgent: meta.userAgent,
    details: { method: body.token ? "totp" : "backup-code" },
  });
  return c.json({ ok: true });
});
