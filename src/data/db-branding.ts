// ============================================================
// PATIO — Branding-Repository (Phase 6b)
// ============================================================
// CRUD fuer org_branding (Singleton-Tabelle). Logo wird als BYTEA
// gespeichert; getBranding liefert NIE den Blob (haette in JSON-
// Responses keinen Sinn — der Blob wird ueber GET /api/branding/logo
// als raw image ausgeliefert).
//
// loadLogo() ist die Schnittstelle fuer das Logo-Streaming.
// ============================================================

import { getDb } from "../db/client.js";

export interface BrandingPublic {
  companyName: string | null;
  logoUrl: string | null; // "/api/branding/logo" wenn Logo gesetzt, sonst null
  logoMimeType: string | null;
  logoFilename: string | null;
  primaryColor: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  updatedAt: string;
}

export interface BrandingUpdate {
  companyName?: string | null;
  primaryColor?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
}

function rowToBranding(row: Record<string, unknown>): BrandingPublic {
  const hasLogo = !!row.logo_blob;
  return {
    companyName: row.company_name ? String(row.company_name) : null,
    logoUrl: hasLogo ? "/api/branding/logo" : null,
    logoMimeType: row.logo_mime_type ? String(row.logo_mime_type) : null,
    logoFilename: row.logo_filename ? String(row.logo_filename) : null,
    primaryColor: row.primary_color ? String(row.primary_color) : null,
    address: row.address ? String(row.address) : null,
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    website: row.website ? String(row.website) : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** Liest die Branding-Felder ohne Logo-Blob — fuer Settings-View und
 *  fuer alle Stellen die das Logo als URL referenzieren wollen. */
export async function getBranding(): Promise<BrandingPublic | null> {
  const db = getDb();
  const [row] = await db`
    SELECT id, company_name, logo_mime_type, logo_filename, primary_color,
           address, phone, email, website, updated_at,
           (logo_blob IS NOT NULL) as has_logo_blob
      FROM org_branding WHERE id = 1
  `;
  if (!row) return null;
  // Wir brauchen "has_logo_blob" um logoUrl korrekt zu setzen — der
  // Mapper erwartet logo_blob als truthy/falsy.
  return rowToBranding({ ...row, logo_blob: row.has_logo_blob });
}

/** Aktualisiert Stammdaten (ohne Logo). Logo geht ueber separaten Endpoint. */
export async function updateBranding(patch: BrandingUpdate): Promise<BrandingPublic | null> {
  const db = getDb();
  const [current] = await db`SELECT * FROM org_branding WHERE id = 1`;
  if (!current) return null;
  const next = {
    companyName: "companyName" in patch ? patch.companyName : current.company_name,
    primaryColor: "primaryColor" in patch ? patch.primaryColor : current.primary_color,
    address: "address" in patch ? patch.address : current.address,
    phone: "phone" in patch ? patch.phone : current.phone,
    email: "email" in patch ? patch.email : current.email,
    website: "website" in patch ? patch.website : current.website,
  };
  await db`
    UPDATE org_branding SET
      company_name  = ${next.companyName},
      primary_color = ${next.primaryColor},
      address       = ${next.address},
      phone         = ${next.phone},
      email         = ${next.email},
      website       = ${next.website}
    WHERE id = 1
  `;
  return getBranding();
}

/** Speichert ein neues Logo. Wenn buffer null ist → Logo loeschen. */
export async function setLogo(buffer: Buffer | null, mimeType: string | null, filename: string | null): Promise<void> {
  const db = getDb();
  if (!buffer) {
    await db`UPDATE org_branding SET logo_blob = NULL, logo_mime_type = NULL, logo_filename = NULL WHERE id = 1`;
    return;
  }
  await db`
    UPDATE org_branding SET
      logo_blob       = ${buffer},
      logo_mime_type  = ${mimeType},
      logo_filename   = ${filename}
    WHERE id = 1
  `;
}

/** Liefert den Logo-Blob fuer das Streaming via GET /api/branding/logo. */
export async function loadLogo(): Promise<{ buffer: Buffer; mimeType: string; filename: string | null } | null> {
  const db = getDb();
  const [row] = await db`
    SELECT logo_blob, logo_mime_type, logo_filename FROM org_branding WHERE id = 1
  `;
  if (!row || !row.logo_blob) return null;
  const buffer = Buffer.isBuffer(row.logo_blob) ? row.logo_blob : Buffer.from(row.logo_blob as Uint8Array);
  return {
    buffer,
    mimeType: row.logo_mime_type ? String(row.logo_mime_type) : "application/octet-stream",
    filename: row.logo_filename ? String(row.logo_filename) : null,
  };
}
