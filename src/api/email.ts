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

/** OTP fuer Login. Kompakte Mail, kein HTML-Bling — soll auch durch
 *  strikte Spam-Filter durch und in Plaintext-Clients lesbar sein. */
export function buildLoginOtpMail(opts: {
  code: string;
  username: string;
  ip?: string | null;
  userAgent?: string | null;
}): {
  subject: string;
  text: string;
  html: string;
} {
  const { code, username, ip, userAgent } = opts;
  const subject = `Bau-OS Login-Code: ${code}`;
  const lines = [
    `Hallo ${username},`,
    "",
    `dein Login-Code für Bau-OS lautet:`,
    "",
    `    ${code}`,
    "",
    "Der Code ist 10 Minuten gültig und kann genau einmal verwendet werden.",
    "",
    `Falls du dich nicht selbst anzumelden versuchst, ignoriere diese Mail`,
    `und ändere dein Passwort.`,
    "",
    "Anfrage von:",
    `  IP:         ${ip ?? "—"}`,
    `  User-Agent: ${userAgent ?? "—"}`,
    "",
    "—",
    "Bau-OS · automatisch versendet, bitte nicht antworten.",
  ];
  const text = lines.join("\n");
  const html = [
    `<p>Hallo <strong>${escHtml(username)}</strong>,</p>`,
    `<p>dein Login-Code für Bau-OS lautet:</p>`,
    `<p style="font-size:24px;font-weight:600;letter-spacing:0.15em;font-family:'JetBrains Mono',monospace;background:#f4f4f5;padding:14px 20px;border-radius:6px;display:inline-block;">${escHtml(code)}</p>`,
    `<p style="color:#52525b;font-size:13px;">Der Code ist 10 Minuten gültig und kann genau einmal verwendet werden.</p>`,
    `<p style="color:#52525b;font-size:13px;">Falls du dich nicht selbst anzumelden versuchst, ignoriere diese Mail und ändere dein Passwort.</p>`,
    `<hr style="border:0;border-top:1px solid #e4e4e7;margin:20px 0;">`,
    `<p style="color:#71717a;font-size:11px;font-family:'JetBrains Mono',monospace;">Anfrage von: IP ${escHtml(ip ?? "—")} · ${escHtml(userAgent ?? "—")}</p>`,
    `<p style="color:#a1a1aa;font-size:11px;">Bau-OS · automatisch versendet, bitte nicht antworten.</p>`,
  ].join("");
  return { subject, text, html };
}

/** OTP fuer Email-Verifikation (Setup oder Wechsel). */
export function buildEmailVerifyMail(opts: { code: string; username: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const { code, username } = opts;
  const subject = `Bau-OS Email-Verifikation: ${code}`;
  const text = [
    `Hallo ${username},`,
    "",
    "bestätige deine Email-Adresse mit folgendem Code:",
    "",
    `    ${code}`,
    "",
    "Der Code ist 10 Minuten gültig.",
    "",
    "—",
    "Bau-OS",
  ].join("\n");
  const html = [
    `<p>Hallo <strong>${escHtml(username)}</strong>,</p>`,
    `<p>bestätige deine Email-Adresse mit folgendem Code:</p>`,
    `<p style="font-size:24px;font-weight:600;letter-spacing:0.15em;font-family:'JetBrains Mono',monospace;background:#f4f4f5;padding:14px 20px;border-radius:6px;display:inline-block;">${escHtml(code)}</p>`,
    `<p style="color:#52525b;font-size:13px;">Der Code ist 10 Minuten gültig.</p>`,
  ].join("");
  return { subject, text, html };
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
