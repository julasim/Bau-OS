// ============================================================
// Bau-OS — SMTP/Email-Service (Migration 020 — Email-2FA)
// ============================================================
// Schickt 6-stellige OTP-Codes via SMTP. Lazy-Initialisiert beim
// ersten Aufruf — wenn SMTP_HOST nicht gesetzt ist, faellt die Funktion
// auf einen Console-Log-Modus zurueck (Dev-Pfad), damit lokale
// Smoke-Tests ohne SMTP-Server laufen.
//
// In Production: SMTP MUSS konfiguriert sein. Ein Boot-Check in
// index.ts verweigert den Start wenn SMTP fehlt UND es User mit
// Email-Adressen gibt (sonst koennten die nicht mehr einloggen).
//
// Anti-Spam: kein eigener From-Header-Magic, kein DKIM-Versuch,
// keine Reply-To. Wir vertrauen dem konfigurierten SMTP-Server (Office365,
// Gmail-App-Password, Mailgun, etc.). User muss SPF/DKIM auf seinem
// Domain-Setup machen — Doku in .env.example.
// ============================================================

import nodemailer, { type Transporter } from "nodemailer";
import {
  SMTP_ENABLED,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_SECURE,
  IS_PRODUCTION,
} from "../config.js";
import { logInfo, logError } from "../logger.js";
import {
  renderEmail,
  plaintextVerification,
  plaintextMagicLink,
  plaintextPasswordReset,
  plaintextWelcome,
} from "./email-template.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!SMTP_ENABLED) return null;
  if (transporter) return transporter;
  // secure=auto: TLS bei 465, STARTTLS bei 587/25.
  const secure = SMTP_SECURE === "auto" ? SMTP_PORT === 465 : SMTP_SECURE === "true";
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  /** Optional HTML-Variante. Default: kein HTML, nur plaintext. */
  html?: string;
  /** Reply-To-Header. Default: SMTP_USER (oder SMTP_FROM). User-Antworten
   *  landen damit beim Operator, nicht im Void des SMTP-Accounts. */
  replyTo?: string;
}

/** Versendet eine Email. Liefert true wenn versendet, false wenn nur
 *  geloggt (Dev-Modus ohne SMTP). Wirft NIE — Fehler werden geloggt
 *  damit Login-Flows nicht crashen wenn der SMTP-Server kurz hick-up hat. */
export async function sendMail(opts: SendMailOptions): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    if (IS_PRODUCTION) {
      logError(
        "[Email] Production ohne SMTP-Konfiguration",
        new Error("SMTP_HOST nicht gesetzt — 2FA-Codes koennen nicht zugestellt werden"),
      );
      return false;
    }
    // Dev-Pfad: Code ins Log, damit Tester ohne SMTP arbeiten koennen.
    logInfo(`[Email-DEV] An: ${opts.to} · Betreff: ${opts.subject}\n${opts.text}`);
    return false;
  }

  try {
    const info = await tx.sendMail({
      from: SMTP_FROM,
      to: opts.to,
      // Reply-To explizit setzen — sonst wuerden User-Antworten ins Leere
      // gehen (SMTP_FROM ist oft "noreply@..."). Default: SMTP_USER.
      replyTo: opts.replyTo ?? (SMTP_USER || SMTP_FROM),
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    logInfo(`[Email] gesendet an ${opts.to} (messageId=${info.messageId ?? "?"})`);
    return true;
  } catch (err) {
    logError(`[Email] Versand an ${opts.to} fehlgeschlagen`, err);
    return false;
  }
}

// ── Templates ───────────────────────────────────────────────────────────────
// Alle HTML-Templates leben in src/emails/*.html (Email-sicher: Tabellen-
// Layout, inline Styles, 600px Container, Outlook-kompatibel, mobile-fähig).
// Die hier definierten Builder sind ein duenner Wrapper: rendern HTML aus
// dem Template + bauen die Plaintext-Variante zusammen.
//
// IP- und User-Agent-Anhang aus der Vor-Version ist im neuen Design absicht-
// lich nicht mehr im HTML — der Reply-To gibt dem User Anker fuer Rueck-
// fragen, und die zusaetzliche Forensik-Info ist im Audit-Log nachvollziehbar.

/** Code-Mail fuer Email-Verifikation oder Login (beide nutzen jetzt das
 *  gleiche "verification"-Template — der einzige Unterschied war kosmetisch
 *  im Subject-Line). */
export function buildLoginOtpMail(opts: {
  code: string;
  username: string;
  /** Bleibt im Interface fuer Backward-Compat. Werden im neuen Design
   *  nicht mehr ins HTML eingebettet — Forensik im Audit-Log. */
  ip?: string | null;
  userAgent?: string | null;
}): { subject: string; text: string; html: string } {
  return {
    subject: "Bau-OS · Bestätigungscode",
    html: renderEmail("verification", { user_name: opts.username, code: opts.code }),
    text: plaintextVerification({ user_name: opts.username, code: opts.code }),
  };
}

/** OTP fuer Email-Verifikation (Setup oder Wechsel) — selbes Template wie
 *  oben. Subject leicht anders, damit User den Kontext erkennt. */
export function buildEmailVerifyMail(opts: { code: string; username: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Bau-OS · Email bestätigen",
    html: renderEmail("verification", { user_name: opts.username, code: opts.code }),
    text: plaintextVerification({ user_name: opts.username, code: opts.code }),
  };
}

/** Magic-Link fuer Ein-Klick-Anmeldung. Aktuell nicht im Login-Flow
 *  verwendet, aber bereit fuer das spaetere Feature. */
export function buildMagicLinkMail(opts: { username: string; magicLinkUrl: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Bau-OS · Anmelde-Link",
    html: renderEmail("magic-link", {
      user_name: opts.username,
      magic_link_url: opts.magicLinkUrl,
    }),
    text: plaintextMagicLink({ user_name: opts.username, magic_link_url: opts.magicLinkUrl }),
  };
}

/** Passwort-Reset-Link. Bereit fuer "Passwort vergessen"-Flow. */
export function buildPasswordResetMail(opts: { username: string; resetUrl: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Bau-OS · Passwort zurücksetzen",
    html: renderEmail("password-reset", {
      user_name: opts.username,
      reset_url: opts.resetUrl,
    }),
    text: plaintextPasswordReset({ user_name: opts.username, reset_url: opts.resetUrl }),
  };
}

/** Welcome-Mail nach erfolgreicher Erstanmeldung. Bereit fuer Onboarding-
 *  Flow — kann nach erstem Login (oder nach abgeschlossenem Email-Setup)
 *  ausgeloest werden. */
export function buildWelcomeMail(opts: { username: string; workspaceUrl: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: "Willkommen bei Bau-OS",
    html: renderEmail("welcome", {
      user_name: opts.username,
      workspace_url: opts.workspaceUrl,
    }),
    text: plaintextWelcome({ user_name: opts.username, workspace_url: opts.workspaceUrl }),
  };
}
