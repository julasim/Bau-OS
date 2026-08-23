// ============================================================
// PATIO — PDF aus einer fertigen Word-Datei
// ============================================================
//
// ── Warum über LibreOffice und nicht über eine PDF-Bibliothek ──────────────
//
// Weil sonst ein ZWEITES Layoutsystem entstünde. Die Word-Vorlagen sind das,
// was das Büro pflegt: Logo, Schrift, Kopfzeile, Fußzeile, Positionstabelle.
// Eine PDF-Bibliothek könnte davon nichts lesen — sie bräuchte ein eigenes
// Layout, das dann irgendwann anders aussieht als der Word-Export. Zwei
// Ausgaben desselben Dokuments, die sich unterscheiden, sind schlimmer als
// eine.
//
// `soffice --convert-to pdf` nimmt genau die Datei, die der Word-Export
// erzeugt hat. Dieselbe Vorlage, dasselbe Ergebnis, nur ein anderes Format.
//
// ── Warum das optional ist ─────────────────────────────────────────────────
//
// LibreOffice wiegt rund 350 MB installiert. Der Firmenserver wird über
// Datenträger aktualisiert (`scripts/release-offline.sh`), und dieses Paket
// misst heute rund 170 MiB — die Last trägt jedes Update mit.
//
// Deshalb: ist `soffice` da, gibt es PDF; ist es nicht da, sagt die Antwort
// das in einem Satz, statt einen 500er zu werfen. Der Word-Export bleibt in
// jedem Fall vollständig.
// ============================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { logError } from "../logger.js";

const ausfuehren = promisify(execFile);

/** Wie lange eine Umwandlung dauern darf. LibreOffice bleibt in seltenen
 *  Fällen hängen (kaputte Schrift, defektes Profil) — ohne Zeitlimit stünde
 *  dann ein Prozess für immer im Container. */
const ZEITLIMIT_MS = 60_000;

let verfuegbarkeit: boolean | null = null;

/** Ist LibreOffice auf diesem Rechner? Wird einmal je Prozess ermittelt. */
export async function pdfMoeglich(): Promise<boolean> {
  if (verfuegbarkeit !== null) return verfuegbarkeit;
  try {
    await ausfuehren("soffice", ["--version"], { timeout: 15_000 });
    verfuegbarkeit = true;
  } catch {
    verfuegbarkeit = false;
  }
  return verfuegbarkeit;
}

/** Nur für Tests — die gemerkte Verfügbarkeit verwerfen. */
export function _pdfVerfuegbarkeitVergessen(): void {
  verfuegbarkeit = null;
}

export class PdfNichtMoeglich extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfNichtMoeglich";
  }
}

/**
 * Wandelt eine Word-Datei in eine PDF um.
 *
 * ── Warum jede Umwandlung ihr eigenes Profil bekommt ───────────────────────
 *
 * LibreOffice hält ein Benutzerprofil und verträgt es nicht, wenn zwei
 * Prozesse gleichzeitig auf dasselbe zugreifen: der zweite Aufruf endet dann
 * wortlos ohne Ausgabedatei. Auf einem Server, an dem acht Leute sitzen, ist
 * das kein Randfall, sondern der Normalfall.
 *
 * `-env:UserInstallation` gibt jedem Lauf ein eigenes, das danach wieder
 * verschwindet. Das kostet etwas Startzeit und spart eine Sperre, die man
 * sonst über den ganzen Dienst legen müsste.
 */
export async function docxNachPdf(docx: Buffer, dateiname: string): Promise<Buffer> {
  if (!(await pdfMoeglich())) {
    throw new PdfNichtMoeglich(
      "PDF-Umwandlung ist auf diesem Server nicht eingerichtet (LibreOffice fehlt). " +
        "Die Word-Datei lässt sich weiterhin herunterladen und im Programm als PDF speichern.",
    );
  }

  const arbeitsordner = await fs.mkdtemp(path.join(os.tmpdir(), "patio-pdf-"));
  const profil = path.join(arbeitsordner, "profil");
  // Der Name der Zwischendatei bestimmt den Namen der PDF — er muss also
  // brauchbar sein, darf aber keine Pfadanteile enthalten.
  const basis = path.basename(dateiname, path.extname(dateiname)).replace(/[\\/:*?"<>|]/g, "-") || "dokument";
  const quelle = path.join(arbeitsordner, `${basis}.docx`);
  const ziel = path.join(arbeitsordner, `${basis}.pdf`);

  try {
    await fs.writeFile(quelle, docx);
    await ausfuehren(
      "soffice",
      [
        `-env:UserInstallation=file:///${profil.replace(/\\/g, "/")}`,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        arbeitsordner,
        quelle,
      ],
      { timeout: ZEITLIMIT_MS },
    );
    return await fs.readFile(ziel);
  } catch (err) {
    logError("[PDF] Umwandlung fehlgeschlagen", err);
    // ENOENT auf die Zieldatei heisst: soffice ist durchgelaufen, hat aber
    // nichts erzeugt. Das ist der Fall, den ein blosses „Fehler" verschleiern
    // würde — er sieht von aussen wie ein Programmfehler aus und ist meist ein
    // Vorlagenproblem.
    const code = (err as NodeJS.ErrnoException)?.code;
    throw new PdfNichtMoeglich(
      code === "ENOENT"
        ? "LibreOffice hat keine PDF erzeugt. Meist liegt es an der Word-Vorlage — bitte den Testdruck der Vorlage prüfen."
        : `PDF-Umwandlung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    // Der Arbeitsordner MUSS weg, auch im Fehlerfall: er enthält das Dokument
    // im Klartext, und auf dem Firmenserver stehen darin Honorare.
    await fs.rm(arbeitsordner, { recursive: true, force: true }).catch(() => {});
  }
}
