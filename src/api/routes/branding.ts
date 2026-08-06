// ============================================================
// PATIO — Branding-Routes (Phase 6b)
// ============================================================
// Endpoints fuer Logo-Upload und Stammdaten-Pflege:
//
//   GET    /api/branding         → Stammdaten + Logo-URL (kein Blob)
//   PATCH  /api/branding         → Stammdaten aktualisieren
//   POST   /api/branding/logo    → Logo hochladen (multipart/form-data)
//   DELETE /api/branding/logo    → Logo entfernen
//   GET    /api/branding/logo    → Logo-Bytes als Image
//                                    NICHT auth-protected (damit das
//                                    Image-Tag im PDF-Export laedt).
// ============================================================

import { Hono } from "hono";
import type { AppEnv } from "../server.js";
import { getBranding, updateBranding, setLogo, loadLogo } from "../../data/db-branding.js";
import { logError } from "../../logger.js";
import { adminMiddleware } from "../auth.js";

export const brandingRoutes = new Hono<AppEnv>();

// ── Wer darf hier schreiben? ─────────────────────────────────────────────────
//
// Diese Daten gelten fuer das ganze Buero. Wer sie aendert, aendert sie fuer
// alle — bis hin zum Loeschen der einzigen Word-Vorlage, mit der Rechnungen
// erzeugt werden. Bis hierher konnte das JEDER angemeldete Nutzer.
//
// Lesen bleibt offen: ohne diese Daten laesst sich die Oberflaeche nicht
// aufbauen, und ein Rechte-Dialog fuer Textbausteine waere Buerokratie ohne
// Gegenwert. Geschrieben wird nur vom Admin.
//
// Der Guard steht bewusst VOR den Routen — Hono wendet Middleware in
// Registrierungsreihenfolge an; danach eingehaengt wuerde er die darueber
// stehenden Handler nicht mehr erfassen.
brandingRoutes.on(["POST", "PATCH", "DELETE"], ["/branding", "/branding/*"], adminMiddleware);

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_LOGO_MIMES = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp"]);

// ── GET /branding ──────────────────────────────────────────────────────────
brandingRoutes.get("/branding", async (c) => {
  const data = await getBranding();
  return c.json(data ?? null);
});

// ── PATCH /branding ────────────────────────────────────────────────────────
brandingRoutes.patch("/branding", async (c) => {
  let body: {
    companyName?: string | null;
    primaryColor?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  };
  try {
    body = await c.req.json<typeof body>();
  } catch {
    return c.json({ error: "Ungueltiger JSON-Body" }, 400);
  }
  const updated = await updateBranding(body);
  if (!updated) return c.json({ error: "Branding-Tabelle nicht initialisiert" }, 500);
  return c.json(updated);
});

// ── POST /branding/logo ────────────────────────────────────────────────────
brandingRoutes.post("/branding/logo", async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: "Multipart-Body erwartet" }, 400);
  }
  const file = formData.get("logo") as File | null;
  if (!file || !file.name) {
    return c.json({ error: "Feld 'logo' fehlt" }, 400);
  }
  if (file.size > MAX_LOGO_BYTES) {
    return c.json({ error: `Logo zu gross (max ${MAX_LOGO_BYTES / 1024 / 1024} MB)` }, 413);
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_LOGO_MIMES.has(mime)) {
    return c.json({ error: `Format nicht erlaubt: ${mime}. Erlaubt: PNG, JPEG, SVG, WebP.` }, 415);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await setLogo(buffer, mime, file.name);
    const updated = await getBranding();
    return c.json(updated, 201);
  } catch (err) {
    logError("[Branding] Logo-Upload fehlgeschlagen", err);
    return c.json({ error: "Upload fehlgeschlagen" }, 500);
  }
});

// ── DELETE /branding/logo ──────────────────────────────────────────────────
brandingRoutes.delete("/branding/logo", async (c) => {
  await setLogo(null, null, null);
  const updated = await getBranding();
  return c.json(updated);
});

// ── GET /branding/logo (PUBLIC — Image-Tag) ────────────────────────────────
//
// Wird in server.ts VOR der globalen authMiddleware registriert,
// damit das <img src="/api/branding/logo"> auch im Word-Export oder
// in einer Anonymous-Login-Seite (ohne JWT) laedt. Die Information
// ist nicht sensibel — Branding ist per Definition oeffentlich.
export const publicBrandingRoutes = new Hono<AppEnv>();

publicBrandingRoutes.get("/branding/logo", async (c) => {
  const logo = await loadLogo();
  if (!logo) return c.json({ error: "Kein Logo gesetzt" }, 404);
  c.header("Content-Type", logo.mimeType);
  c.header("Cache-Control", "public, max-age=300"); // 5min Browser-Cache
  if (logo.filename) {
    c.header("Content-Disposition", `inline; filename="${logo.filename.replace(/"/g, "")}"`);
  }
  // Buffer ist eine Subclass von Uint8Array — Hono auf @hono/node-server
  // akzeptiert Uint8Array direkt. Der frueher verwendete .buffer.slice()-
  // Workaround konnte mit SharedArrayBuffer-Resultaten kollidieren.
  return c.body(new Uint8Array(logo.buffer));
});
