import fs from "fs";
import path from "path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import { WORKSPACE_PATH } from "../config.js";

/**
 * Erstellt eine Word-Datei (.docx) und speichert sie unter Exports/<dateiname>.
 * Gibt den relativen Pfad zurueck (z.B. "Exports/Bericht_2026-04-12.docx").
 */
export async function createDocx(options: { titel: string; inhalt: string; dateiname: string }): Promise<string> {
  // Dateiname absichern
  const safeName = options.dateiname.replace(/[<>:"|?*]/g, "_");
  const filename = safeName.endsWith(".docx") ? safeName : `${safeName}.docx`;
  const exportsDir = path.join(WORKSPACE_PATH, "Exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const absPath = path.join(exportsDir, filename);
  const relativePath = `Exports/${filename}`;

  const heute = new Date().toLocaleDateString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // Inhalt in Absaetze aufteilen (Leerzeilen = Absatz-Trenner)
  const contentParagraphs = options.inhalt.split(/\n/).map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 24, font: "Arial" })],
        spacing: { after: line.trim() === "" ? 0 : 120 },
      }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Arial", size: 24 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          // Titel
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: options.titel, bold: true, size: 36, font: "Arial" })],
            spacing: { after: 200 },
          }),
          // Datum
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: heute, size: 20, color: "666666", font: "Arial" })],
            spacing: { after: 240 },
          }),
          // Trennlinie (via Absatz-Border)
          new Paragraph({
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 },
            },
            spacing: { after: 240 },
            children: [],
          }),
          // Inhalt
          ...contentParagraphs,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(absPath, buffer);

  return relativePath;
}
