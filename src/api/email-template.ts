// ============================================================
// Bau-OS — Email-Template-Renderer
// ============================================================
// Liest die HTML-Templates aus src/emails/ und ersetzt {{var}}-
// Platzhalter mit den uebergebenen Werten. Keine Logik-Engine, kein
// Handlebars — die Templates haben bewusst nur einfache Platzhalter,
// damit sie auch ohne Build-Step lesbar bleiben.
//
// Sicherheit:
//   - HTML-Variablen werden HTML-escaped (verhindert <script>-Injection
//     wenn jemand 'Max <evil>Mueller' als displayName setzt).
//   - URL-Variablen werden NICHT escaped — sie kommen aus dem Backend
//     selbst (createToken etc.) und sind URL-safe per Design.
//
// Das __dirname-Problem in ESM ist via fileURLToPath geloest. Templates
// liegen relativ zum kompilierten Output (dist/api/email-template.js),
// daher das relative join("../../src/emails") nach oben aus dist/.
// Lookup-Strategie: erst dist/emails (aus npm run build), dann
// src/emails (Dev-Mode mit tsx). Beides funktioniert.
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mehrere Pfad-Kandidaten in Priority-Reihenfolge:
//   1. dist/emails/ (production, neben dem kompilierten JS)
//   2. src/emails/  (dev mode mit tsx)
//   3. cwd/src/emails (Fallback)
const TEMPLATE_DIR_CANDIDATES = [
  join(__dirname, "../emails"),
  join(__dirname, "../../src/emails"),
  join(process.cwd(), "src/emails"),
];

function resolveTemplateDir(): string {
  for (const dir of TEMPLATE_DIR_CANDIDATES) {
    if (existsSync(join(dir, "verification.html"))) return dir;
  }
  throw new Error(`[Email] Templates nicht gefunden. Versucht: ${TEMPLATE_DIR_CANDIDATES.join(", ")}`);
}

let _templateDir: string | null = null;
function templateDir(): string {
  if (!_templateDir) _templateDir = resolveTemplateDir();
  return _templateDir;
}

export type TemplateName = "verification" | "magic-link" | "password-reset" | "welcome";

// In-Memory-Cache, damit nicht jede Mail die Datei neu liest.
const _cache = new Map<TemplateName, string>();

function loadTemplate(name: TemplateName): string {
  const cached = _cache.get(name);
  if (cached) return cached;
  const raw = readFileSync(join(templateDir(), `${name}.html`), "utf8");
  _cache.set(name, raw);
  return raw;
}

/** Render ein Email-Template mit den angegebenen Variablen.
 *  Variablen werden HTML-escaped, AUSSER URL-Variablen (magic_link_url,
 *  reset_url, workspace_url) — die kommen aus Backend-Code und sind
 *  bereits URL-safe konstruiert.
 *
 *  Throws wenn eine im Template benutzte Variable nicht uebergeben wurde —
 *  besser frueh und laut crashen als eine Mail mit "Hallo {{user_name}}"
 *  rauszuschicken. */
export function renderEmail(name: TemplateName, vars: Record<string, string>): string {
  const URL_VARS = new Set(["magic_link_url", "reset_url", "workspace_url"]);
  const raw = loadTemplate(name);
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`[Email] Template "${name}" referenziert unbekannte Variable: ${key}`);
    }
    return URL_VARS.has(key) ? String(value) : escapeHtml(String(value));
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Plaintext-Fallbacks ─────────────────────────────────────────────────────
// Spam-Filter mögen reine HTML-Mails nicht. nodemailer schickt beides mit,
// wenn wir text+html geben. Plaintext-Versionen sind kompakt und
// zweckmäßig — kein Marketing-Text.

export function plaintextVerification(opts: { user_name: string; code: string }): string {
  return [
    `Hallo ${opts.user_name},`,
    "",
    "bestätige deine Email-Adresse mit folgendem Code:",
    "",
    `    ${opts.code}`,
    "",
    "Der Code ist 10 Minuten gültig und kann genau einmal verwendet werden.",
    "",
    "Falls du dich nicht selbst anzumelden versuchst, ignoriere diese Mail",
    "und ändere dein Passwort.",
    "",
    "—",
    "Bau-OS · automatisch versendet, bitte nicht antworten.",
  ].join("\n");
}

export function plaintextMagicLink(opts: { user_name: string; magic_link_url: string }): string {
  return [
    `Hallo ${opts.user_name},`,
    "",
    "klicke auf den folgenden Link, um dich bei Bau-OS anzumelden:",
    "",
    opts.magic_link_url,
    "",
    "Der Link ist 15 Minuten gültig und kann nur einmal verwendet werden.",
    "",
    "—",
    "Bau-OS",
  ].join("\n");
}

export function plaintextPasswordReset(opts: { user_name: string; reset_url: string }): string {
  return [
    `Hallo ${opts.user_name},`,
    "",
    "du hast ein neues Passwort angefordert. Setze es hier zurück:",
    "",
    opts.reset_url,
    "",
    "Der Link ist 60 Minuten gültig.",
    "Falls du das nicht warst, ignoriere diese Mail.",
    "",
    "—",
    "Bau-OS",
  ].join("\n");
}

export function plaintextWelcome(opts: { user_name: string; workspace_url: string }): string {
  return [
    `Willkommen, ${opts.user_name}.`,
    "",
    "Dein Bau-OS Workspace ist eingerichtet:",
    opts.workspace_url,
    "",
    "—",
    "Bau-OS",
  ].join("\n");
}
