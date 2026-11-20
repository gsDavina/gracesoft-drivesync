import { PDFParse } from "pdf-parse";
import type { Extractor } from "../types.js";

export const PDF_MIME = "application/pdf";

export interface PdfParser {
  parse(buffer: Buffer): Promise<{ text: string }>;
}

export function createPdfExtractor(pdfParser: PdfParser): Extractor {
  return {
    name: "pdf",
    mimeTypes: [PDF_MIME],
    async extract(file, { driveClient }) {
      const buffer = await driveClient.downloadFile(file.id);
      const { text } = await pdfParser.parse(buffer);
      const trimmed = text.trim();
      if (!trimmed) {
        // A PDF with no extractable text layer is (almost always) a scanned
        // image. OCR is an explicit fast-follow, not in scope — fail closed
        // with a specific reason instead of silently returning empty text
        // that downstream stages would mistake for "this file has no content."
        return { ok: false, reason: "scanned-pdf-ocr-not-implemented" };
      }
      return { ok: true, text: trimmed };
    },
  };
}

export function createPdfParser(): PdfParser {
  return {
    async parse(buffer: Buffer): Promise<{ text: string }> {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return { text: result.text };
      } finally {
        await parser.destroy();
      }
    },
  };
}
