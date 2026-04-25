// ============================================================
// Bau-OS — User-Settings-Route
// Profil, Passwort aendern, LLM-Runtime, Praeferenzen.
// Einstellungen, die keine grossen Systemauswirkungen haben.
// ============================================================

import { Hono } from "hono";
import {
  findUser,
  updateUser,
  hashPassword,
  verifyPassword,
  updateDbUserSettings,
  updateDbUserPassword,
  type UserSettings,
  type DbUser,
  type JwtPayload,
} from "../auth.js";

type AppEnv = {
  Variables: {
    user: JwtPayload;
    userId: string | null;
    userRole: "admin" | "user";
    dbUser: DbUser | null;
  };
};
import { getModel, isFastMode, setModel, toggleFast } from "../../llm/client.js";
import {
  DEFAULT_MODEL,
  FAST_MODEL,
  SUBAGENT_MODEL,
  OLLAMA_BASE_URL,
  LANGUAGE,
  LOCALE,
  TIMEZONE,
  DB_ENABLED,
  COMPACT_THRESHOLD,
} from "../../config.js";
import { logInfo } from "../../logger.js";

export const settingsRoutes = new Hono<AppEnv>();

// ── Whitelist: nur diese Keys duerfen per PATCH geaendert werden ─────────────
const ALLOWED_SETTING_KEYS = new Set<keyof UserSettings>([
  "displayName",
  "notificationsEnabled",
  "defaultProject",
  "chatSearchMode",
]);

// ── GET /settings — Profil + Settings + Runtime-Info ─────────────────────────
settingsRoutes.get("/settings", (c) => {
  const dbUser = c.get("dbUser");
  const jwtUser = c.get("user");

  // DB-User hat Vorrang — Profil/Settings kommen aus der DB. Nur wenn kein
  // DB-User da ist (FS-Mode oder Legacy-JSON-Konto), faellt's auf JSON zurueck.
  let profile: { username: string; role: string; createdAt: string };
  let settings: UserSettings;
  if (dbUser) {
    profile = { username: dbUser.username, role: dbUser.role, createdAt: dbUser.createdAt };
    settings = dbUser.settings ?? {};
  } else {
    const user = findUser(jwtUser.username);
    if (!user) return c.json({ error: "User nicht gefunden" }, 404);
    profile = { username: user.username, role: user.role, createdAt: user.createdAt };
    settings = user.settings ?? {};
  }

  return c.json({
    profile,
    settings,
    runtime: {
      currentModel: getModel(),
      fastMode: isFastMode(),
      dbEnabled: DB_ENABLED,
    },
    system: {
      defaultModel: DEFAULT_MODEL,
      fastModel: FAST_MODEL,
      subagentModel: SUBAGENT_MODEL,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      language: LANGUAGE,
      locale: LOCALE,
      timezone: TIMEZONE,
      compactThreshold: COMPACT_THRESHOLD,
    },
  });
});

// ── PATCH /settings — Profil + Settings-Werte aendern ────────────────────────
settingsRoutes.patch("/settings", async (c) => {
  const dbUser = c.get("dbUser");
  const jwtUser = c.get("user");

  let body: { settings?: Record<string, unknown> };
  try {
    body = await c.req.json<{ settings?: Record<string, unknown> }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  if (!body.settings || typeof body.settings !== "object") {
    return c.json({ error: "settings-Objekt erforderlich" }, 400);
  }

  // Nur erlaubte Keys uebernehmen
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body.settings)) {
    if (ALLOWED_SETTING_KEYS.has(key as keyof UserSettings)) {
      filtered[key] = value;
    }
  }

  // DB-User: in DB schreiben. JSON-User: in JSON-Datei.
  if (dbUser) {
    const updated = await updateDbUserSettings(dbUser.id, filtered as UserSettings);
    if (!updated) return c.json({ error: "User nicht gefunden" }, 404);
    logInfo(`[Settings] ${dbUser.username} hat Einstellungen aktualisiert: ${Object.keys(filtered).join(", ")}`);
    return c.json({ ok: true, settings: updated.settings ?? {} });
  }

  const updated = updateUser(jwtUser.username, { settings: filtered as UserSettings });
  if (!updated) return c.json({ error: "User nicht gefunden" }, 404);
  logInfo(`[Settings] ${jwtUser.username} hat Einstellungen aktualisiert: ${Object.keys(filtered).join(", ")}`);
  return c.json({ ok: true, settings: updated.settings ?? {} });
});

// ── POST /auth/password — Passwort aendern ───────────────────────────────────
settingsRoutes.post("/auth/password", async (c) => {
  const jwtUser = c.get("user");

  let body: { oldPassword: string; newPassword: string };
  try {
    body = await c.req.json<{ oldPassword: string; newPassword: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }

  if (!body.oldPassword || !body.newPassword) {
    return c.json({ error: "Altes und neues Passwort erforderlich" }, 400);
  }
  if (body.newPassword.length < 6) {
    return c.json({ error: "Neues Passwort muss mindestens 6 Zeichen haben" }, 400);
  }

  const dbUser = c.get("dbUser");
  if (dbUser) {
    const valid = await verifyPassword(body.oldPassword, dbUser.passwordHash);
    if (!valid) return c.json({ error: "Altes Passwort falsch" }, 401);
    const newHash = await hashPassword(body.newPassword);
    const ok = await updateDbUserPassword(dbUser.id, newHash);
    if (!ok) return c.json({ error: "Update fehlgeschlagen" }, 500);
    logInfo(`[Settings] ${dbUser.username} hat Passwort geaendert`);
    return c.json({ ok: true });
  }

  const user = findUser(jwtUser.username);
  if (!user) return c.json({ error: "User nicht gefunden" }, 404);
  const valid = await verifyPassword(body.oldPassword, user.passwordHash);
  if (!valid) return c.json({ error: "Altes Passwort falsch" }, 401);
  const newHash = await hashPassword(body.newPassword);
  updateUser(jwtUser.username, { passwordHash: newHash });
  logInfo(`[Settings] ${jwtUser.username} hat Passwort geaendert`);
  return c.json({ ok: true });
});

// ── POST /settings/model — Laufendes LLM-Modell setzen (Bot-weit) ────────────
settingsRoutes.post("/settings/model", async (c) => {
  let body: { model: string };
  try {
    body = await c.req.json<{ model: string }>();
  } catch {
    return c.json({ error: "Ungueltiger Request-Body" }, 400);
  }
  const name = String(body.model || "").trim();
  if (!name) return c.json({ error: "Modell-Name erforderlich" }, 400);

  setModel(name);
  logInfo(`[Settings] Modell via Web-UI gesetzt: ${name}`);
  return c.json({ ok: true, currentModel: getModel() });
});

// ── POST /settings/fast — Fast-Mode togglen (Bot-weit) ───────────────────────
settingsRoutes.post("/settings/fast", (c) => {
  const active = toggleFast();
  logInfo(`[Settings] Fast-Mode via Web-UI: ${active ? "AN" : "AUS"}`);
  return c.json({ ok: true, fastMode: active, currentModel: getModel() });
});
