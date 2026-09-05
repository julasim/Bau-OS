// ============================================================
// PATIO — Sicherungs-Status
// ============================================================
//   GET /api/sicherung   → Zustand der naechtlichen Sicherung (nur Admin)
//
// Warum das eine eigene Route braucht: die Sicherung laeuft als
// systemd-Timer (`deploy/patio-backup.timer`) und schreibt auf die externe
// Platte. `OnFailure=` meldet einen Fehlschlag ins Journal — nur schaut da
// niemand hinein. **Eine Sicherung, die still seit Wochen scheitert, faellt
// erst auf, wenn man sie braucht.** Genau dieses Muster hat in diesem Projekt
// schon einmal zugeschlagen.
//
// Die Route SCHAUT nur nach, sie sichert nicht. Der App-Container kann und
// soll den Sicherungslauf nicht ausloesen: er hat kein Docker, kein systemd
// und keinen Schreibzugriff auf die Platte. Das Verzeichnis ist nur lesend
// eingehaengt (siehe docker-compose.yml).
//
// Aufbau, den `scripts/backup.sh` erzeugt:
//
//     <BACKUP_DIR>/taeglich/<JJJJMMTT-HHMMSS>/    datenbank.sql.gz,
//     <BACKUP_DIR>/woechentlich/<JJJJ-Wnn>/        dokumente.tar.gz,
//     <BACKUP_DIR>/monatlich/<JJJJ-MM>/           konfiguration.tar.gz,
//                                                 caddy-daten.tar.gz,
//                                                 VOLLSTAENDIG
//
// Der Marker `VOLLSTAENDIG` entscheidet: ein Stand ohne ihn ist abgebrochen.
// Abgebrochene Staende heissen `*.UNVOLLSTAENDIG` und zaehlen nicht.
// ============================================================

import { Hono } from "hono";
import fs from "fs";
import path from "path";
import type { AppEnv } from "../server.js";
import { logError } from "../../logger.js";

export const sicherungRoutes = new Hono<AppEnv>();

/** Wohin die Sicherung schreibt — im Container das schreibgeschuetzt
 *  eingehaengte Verzeichnis. Auf dem Entwicklungsrechner existiert es nicht;
 *  die Route sagt dann „nicht eingerichtet" statt zu scheitern.
 *
 *  Bewusst bei JEDEM Aufruf gelesen und nicht beim Laden des Moduls: sonst
 *  braeuchte eine Aenderung an der Umgebung einen Neustart des Dienstes, und
 *  die Auskunft haette sich still auf einen Pfad festgelegt, den es nicht
 *  mehr gibt. */
function sicherungsVerzeichnis(): string {
  return process.env.SICHERUNG_DIR ?? "/opt/patio/backup";
}

const STUFEN = ["taeglich", "woechentlich", "monatlich"] as const;
type Stufe = (typeof STUFEN)[number];

interface Stand {
  stufe: Stufe;
  name: string;
  /** Zeitpunkt aus dem VOLLSTAENDIG-Marker; sonst die Ordnerzeit. */
  zeitpunkt: string;
  /** Summe der Dateien im Stand, in Byte. */
  groesse: number;
  vollstaendig: boolean;
}

function ordnerGroesse(p: string): number {
  let summe = 0;
  for (const eintrag of fs.readdirSync(p, { withFileTypes: true })) {
    const voll = path.join(p, eintrag.name);
    try {
      if (eintrag.isDirectory()) summe += ordnerGroesse(voll);
      else summe += fs.statSync(voll).size;
    } catch {
      // Einzelne unlesbare Datei darf die Auskunft nicht kippen.
    }
  }
  return summe;
}

function leseStufe(stufe: Stufe): Stand[] {
  const verzeichnis = path.join(sicherungsVerzeichnis(), stufe);
  if (!fs.existsSync(verzeichnis)) return [];
  const staende: Stand[] = [];
  for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    if (!eintrag.isDirectory()) continue;
    const voll = path.join(verzeichnis, eintrag.name);
    const markerPfad = path.join(voll, "VOLLSTAENDIG");
    let zeitpunkt = "";
    let vollstaendig = false;
    try {
      if (fs.existsSync(markerPfad)) {
        vollstaendig = true;
        // Das Skript schreibt den ISO-Zeitpunkt in den Marker.
        zeitpunkt = fs.readFileSync(markerPfad, "utf8").trim();
      }
      if (!zeitpunkt) zeitpunkt = fs.statSync(voll).mtime.toISOString();
    } catch {
      continue;
    }
    staende.push({
      stufe,
      name: eintrag.name,
      zeitpunkt,
      groesse: ordnerGroesse(voll),
      vollstaendig: vollstaendig && !eintrag.name.endsWith(".UNVOLLSTAENDIG"),
    });
  }
  return staende.sort((a, b) => b.zeitpunkt.localeCompare(a.zeitpunkt));
}

sicherungRoutes.get("/sicherung", async (c) => {
  // Eine Sicherung enthaelt den GESAMTEN Bestand — auch die Projekte, die
  // fuer diese Person ausgeblendet sind. Schon die Auskunft darueber, wie
  // gross sie ist und wann sie lief, gehoert deshalb der Verwaltung.
  if (c.var.userRole !== "admin") return c.json({ error: "Admin-Rechte erforderlich" }, 403);

  const verzeichnis = sicherungsVerzeichnis();
  if (!fs.existsSync(verzeichnis)) {
    return c.json({
      eingerichtet: false,
      hinweis:
        `Kein Sicherungsverzeichnis unter ${verzeichnis}. Auf dem Firmenserver haengt es ` +
        `schreibgeschuetzt im Container (docker-compose.yml); auf einem Entwicklungsrechner ist das normal.`,
      staende: [],
    });
  }

  try {
    const staende = STUFEN.flatMap(leseStufe);
    const vollstaendige = staende.filter((s) => s.vollstaendig);
    const juengste = vollstaendige[0] ?? null;

    // Die eigentliche Frage, die diese Seite beantworten soll.
    const stundenHer = juengste ? Math.floor((Date.now() - new Date(juengste.zeitpunkt).getTime()) / 3_600_000) : null;
    // Der Timer laeuft naechtlich. Mehr als 48 Stunden heisst: mindestens ein
    // Lauf ist ausgefallen, und niemand hat es bemerkt.
    const inOrdnung = stundenHer !== null && stundenHer <= 48;

    return c.json({
      eingerichtet: true,
      inOrdnung,
      juengste,
      stundenHer,
      anzahl: {
        taeglich: vollstaendige.filter((s) => s.stufe === "taeglich").length,
        woechentlich: vollstaendige.filter((s) => s.stufe === "woechentlich").length,
        monatlich: vollstaendige.filter((s) => s.stufe === "monatlich").length,
        abgebrochen: staende.length - vollstaendige.length,
      },
      staende: staende.slice(0, 40),
    });
  } catch (err) {
    logError("[Sicherung] Status", err);
    return c.json({ error: "Sicherungsverzeichnis nicht lesbar" }, 500);
  }
});
