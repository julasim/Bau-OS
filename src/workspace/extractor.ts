import path from "path";
import { EXTRACT_MAX_CHARS } from "../config.js";

export interface ExtractionResult {
  text: string;
  format: "pdf" | "docx" | "text" | "unsupported";
}

// ── Was hier stand: der pfadbasierte Zweig ────────────────────────────────
//
// `extractPdf`, `extractDocx`, `extractPlainText` und `extractDocument`
// nahmen einen DATEIPFAD und lasen die Datei selbst. Sie stammen aus der
// Zeit, in der Uploads erst auf der Platte landeten und danach ausgelesen
// wurden.
//
// Heute kommt der Upload als Buffer an und wird direkt daraus gelesen — ohne
// temporaere Datei. Der pfadbasierte Zweig hatte keinen Aufrufer mehr, sah
// aber wie die Haupt-Fassung aus (die Buffer-Varianten standen darunter als
// „Varianten"). Genau die Sorte Code, die beim naechsten Umbau versehentlich
// wieder benutzt wird.

// ── Text aus einem Buffer ziehen — der einzige Weg ────────────────────────

export async function extractPdfFromBuffer(data: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data, verbosity: 0 });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (text.length > EXTRACT_MAX_CHARS) {
      return (
        text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt – ${text.length - EXTRACT_MAX_CHARS} Zeichen entfernt]`
      );
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

export async function extractDocxFromBuffer(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (text.length > EXTRACT_MAX_CHARS) {
    return text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt – ${text.length - EXTRACT_MAX_CHARS} Zeichen entfernt]`;
  }
  return text;
}

export function extractPlainTextFromBuffer(buffer: Buffer): string {
  const text = buffer.toString("utf-8");
  if (text.length > EXTRACT_MAX_CHARS) {
    return text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt]`;
  }
  return text;
}

/** Zieht Text aus einem hochgeladenen Buffer. Nichts landet auf der Platte. */
export async function extractDocumentFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ExtractionResult> {
  const ext = path.extname(filename).toLowerCase();

  if (mimeType === "application/pdf" || ext === ".pdf") {
    return { text: await extractPdfFromBuffer(buffer), format: "pdf" };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    ext === ".docx" ||
    ext === ".doc"
  ) {
    return { text: await extractDocxFromBuffer(buffer), format: "docx" };
  }

  if (mimeType.startsWith("text/") || ext === ".md" || ext === ".txt") {
    return { text: extractPlainTextFromBuffer(buffer), format: "text" };
  }

  return { text: "", format: "unsupported" };
}
