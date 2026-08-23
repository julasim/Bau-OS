import { describe, it, expect, beforeEach } from "vitest";
import { docxNachPdf, pdfMoeglich, PdfNichtMoeglich, _pdfVerfuegbarkeitVergessen } from "../src/export/pdf.js";

// Die PDF-Ausgabe.
//
// ── Was hier NICHT geprüft wird ────────────────────────────────────────────
//
// Ob LibreOffice eine schöne PDF erzeugt. Das hängt an der Vorlage des Büros
// und lässt sich nur am Ergebnis beurteilen.
//
// Geprüft wird der Teil, der schiefgeht, wenn niemand hinsieht: dass auf einem
// Server OHNE LibreOffice eine verständliche Absage kommt statt eines
// Serverfehlers. Der Firmenserver kann bewusst ohne gebaut werden
// (`--build-arg MIT_PDF=nein`, rund 350 MB), und jedes Offline-Update trägt
// die Last mit — dieser Fall ist also kein Randfall.
describe("PDF-Ausgabe", () => {
  beforeEach(() => _pdfVerfuegbarkeitVergessen());

  it("meldet ehrlich, ob dieser Rechner es kann", async () => {
    const kann = await pdfMoeglich();
    expect(typeof kann).toBe("boolean");
  });

  it("ohne LibreOffice kommt eine Absage in Klartext, kein Absturz", async () => {
    const kann = await pdfMoeglich();
    if (kann) {
      // Auf einem Rechner MIT LibreOffice lässt sich der Fall nicht
      // herstellen, ohne das Programm zu verstecken. Dann wenigstens: eine
      // kaputte Word-Datei ergibt ebenfalls eine PdfNichtMoeglich-Absage und
      // keinen rohen Fehler.
      await expect(docxNachPdf(Buffer.from("das ist kein docx"), "test.docx")).rejects.toBeInstanceOf(PdfNichtMoeglich);
      return;
    }
    await expect(docxNachPdf(Buffer.from("egal"), "test.docx")).rejects.toBeInstanceOf(PdfNichtMoeglich);
    await expect(docxNachPdf(Buffer.from("egal"), "test.docx")).rejects.toThrow(/LibreOffice fehlt/);
  });

  it("die Absage nennt den Weg, der trotzdem funktioniert", async () => {
    if (await pdfMoeglich()) return;
    // Eine Fehlermeldung, die nur „geht nicht" sagt, lässt den Nutzer stehen.
    await expect(docxNachPdf(Buffer.from("egal"), "test.docx")).rejects.toThrow(/Word-Datei/);
  });
});
