import fs from "fs";
import path from "path";
import { EXTRACT_MAX_CHARS } from "../config.js";

export interface ExtractionResult {
  text: string;
  format: "pdf" | "docx" | "text" | "unsupported";
}

export async function extractPdf(filePath: string): Promise<string> {
  const pdfModule = await import("pdf-parse");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = ((pdfModule as any).default ?? pdfModule) as (buf: Buffer) => Promise<{ text: string }>;
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(buffer);
  const text = parsed.text.trim();
  if (text.length > EXTRACT_MAX_CHARS) {
    return text.slice(0, EXTRACT_MAX_CHARS) + `\n\n[... gekürzt – ${text.length - EXTRACT_MAX_CHARS} Zeichen entfernt]`;
  }
  return text;
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
