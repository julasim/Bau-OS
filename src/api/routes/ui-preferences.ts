// ============================================================
// Bau-OS — UI-Preferences-Routes (Phase 6f)
// ============================================================
//   GET   /api/me/preferences   → aktuelle User-Praeferenzen
//   PATCH /api/me/preferences   → Updaten (Deep-Merge)
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import { getUiPreferences, updateUiPreferences, type UiPreferences } from "../../data/db-ui-preferences.js";

export const uiPreferencesRoutes = new Hono<AppEnv>();

uiPreferencesRoutes.get("/me/preferences", async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  const prefs = await getUiPreferences(userId);
  return c.json(prefs);
});

uiPreferencesRoutes.patch("/me/preferences", async (c) => {
  const userId = c.var.userId;
  if (!userId) return c.json({ error: "Nicht eingeloggt" }, 401);
  let patch: Partial<UiPreferences> & {
    telegramNotifications?: Partial<UiPreferences["telegramNotifications"]>;
  };
  try {
    patch = await c.req.json<typeof patch>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }

  // Validation: Akzentfarbe muss ein hex-Color sein. Andere Felder lassen
  // wir vom JSONB-Default-Schema absichern (fehlerhafte Werte werden beim
  // Read normalisiert). Hier nur die offensichtlichen Sicherheits-Checks.
  if (patch.accentColor !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(patch.accentColor)) {
    return c.json({ error: "accentColor muss Hex-Farbe sein (z.B. #f59e0b)" }, 400);
  }
  if (patch.theme && !["light", "dark", "system"].includes(patch.theme)) {
    return c.json({ error: "theme muss light/dark/system sein" }, 400);
  }
  if (patch.fontSize && !["small", "medium", "large"].includes(patch.fontSize)) {
    return c.json({ error: "fontSize muss small/medium/large sein" }, 400);
  }

  const updated = await updateUiPreferences(userId, patch);
  return c.json(updated);
});
