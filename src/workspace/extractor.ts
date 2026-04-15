import fs from "fs";
import path from "path";
import { EXTRACT_MAX_CHARS } from "../config.js";

export interface ExtractionResult {
  text: string;
  format: "pdf" | "docx" | "text" | "unsupported";
}

export async function extractPdf(filePath: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const data = fs.readFileSync(filePath);
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

export async function extractDocx(filePath: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ path: filePath });
  const text = result.value.trim();
  if (text.length > EXTRACT_MAX_CHARS) {
    return text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt – ${text.length - EXTRACT_MAX_CHARS} Zeichen entfernt]`;
  }
  return text;
}

export function extractPlainText(filePath: string): string {
  const text = fs.readFileSync(filePath, "utf-8");
  if (text.length > EXTRACT_MAX_CHARS) {
    return text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt]`;
  }
  return text;
}

// ── Buffer-Varianten (fuer DB-only-Uploads ohne temporaere Datei) ──────────

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

/** Wie extractDocument(), aber ohne temporaere Datei — direkt aus Buffer. */
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

export async function extractDocument(filePath: string, mimeType: string): Promise<ExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();

  if (mimeType === "application/pdf" || ext === ".pdf") {
    return { text: await extractPdf(filePath), format: "pdf" };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    ext === ".docx" ||
    ext === ".doc"
  ) {
    return { text: await extractDocx(filePath), format: "docx" };
  }

  if (mimeType.startsWith("text/") || ext === ".md" || ext === ".txt") {
    return { text: extractPlainText(filePath), format: "text" };
  }

  return { text: "", format: "unsupported" };
}
