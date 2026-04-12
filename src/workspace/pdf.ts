import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { WORKSPACE_PATH } from "../config.js";

/**
 * Erstellt eine einfache PDF-Datei und speichert sie unter Exports/<dateiname>.
 * Gibt den relativen Pfad zurueck (z.B. "Exports/Bericht_2026-04-12.pdf").
 */
export async function createPdf(options: { titel: string; inhalt: string; dateiname: string }): Promise<string> {
  // Dateiname absichern
  const safeName = options.dateiname.replace(/[<>:"|?*]/g, "_");
  const filename = safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`;
  const exportsDir = path.join(WORKSPACE_PATH, "Exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const absPath = path.join(exportsDir, filename);
  const relativePath = `Exports/${filename}`;

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: "A4" });
    const stream = fs.createWriteStream(absPath);
    doc.pipe(stream);
    stream.on("finish", resolve);
    stream.on("error", reject);

    // Header: Titel
    doc.fontSize(20).font("Helvetica-Bold").text(options.titel, { align: "center" });

    // Datum
    const heute = new Date().toLocaleDateString("de-AT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    doc.moveDown(0.5).fontSize(10).font("Helvetica").fillColor("#666666").text(heute, { align: "center" });

    // Trennlinie
    doc
      .moveDown(1)
      .moveTo(60, doc.y)
      .lineTo(doc.page.width - 60, doc.y)
      .strokeColor("#cccccc")
      .stroke();

    // Inhalt
    doc.moveDown(1).fontSize(11).font("Helvetica").fillColor("#000000").text(options.inhalt, { lineGap: 4 });

    doc.end();
  });

  return relativePath;
}
