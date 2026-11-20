import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { htmlToText } from "../html.js";
import { ExtractionFailure } from "../types.js";
import type { Extractor } from "../types.js";
import { isOleCompoundFile, readZip, repackStored } from "../zip.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const DOC_MIME = "application/msword";

/** docx bytes → HTML. Injected so unit tests don't need mammoth. */
export interface DocxConverter {
  toHtml(buffer: Buffer): Promise<string>;
}

/** Legacy `.doc` bytes → plain text. Injected so unit tests don't need word-extractor. */
export interface DocTextReader {
  toText(buffer: Buffer): Promise<string>;
}

export function createMammothDocxConverter(): DocxConverter {
  return {
    async toHtml(buffer) {
      const result = await mammoth.convertToHtml(
        { buffer },
        {
          // Never follow links to files outside the document, and don't
          // inline images as base64 (only text is indexed).
          externalFileAccess: false,
          convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
        },
      );
      return result.value;
    },
  };
}

export function createWordExtractorDocReader(): DocTextReader {
  const extractor = new WordExtractor();
  return {
    async toText(buffer) {
      const doc = await extractor.extract(buffer);
      return doc.getBody();
    },
  };
}

/**
 * `.docx` via mammoth, converted to HTML and then to text with Markdown
 * headings, so real Word heading styles become `#` sections for M6's
 * chunker (better than the Title Case heuristic used for plain text).
 *
 * The zip is opened with the zip-bomb guard first and re-packed uncompressed
 * before mammoth (JSZip) sees it; see `repackStored`.
 */
export function createDocxExtractor(converter: DocxConverter = createMammothDocxConverter()): Extractor {
  return {
    name: "docx",
    mimeTypes: [DOCX_MIME],
    async extract(file, { driveClient, archiveLimits }) {
      const buffer = await driveClient.downloadFile(file.id);
      const entries = readZip(buffer, archiveLimits, () => true);
      if (!entries["word/document.xml"]) throw new ExtractionFailure("corrupt-file", "missing word/document.xml");

      let html: string;
      try {
        html = await converter.toHtml(repackStored(entries));
      } catch (err) {
        throw new ExtractionFailure("corrupt-file", err instanceof Error ? err.message : String(err));
      }
      return { ok: true, text: htmlToText(html) };
    },
  };
}

/** Legacy Word 97–2003 `.doc` via word-extractor: plain text only, so headings fall back to the chunker's heuristic. */
export function createDocExtractor(reader: DocTextReader = createWordExtractorDocReader()): Extractor {
  return {
    name: "doc",
    mimeTypes: [DOC_MIME],
    async extract(file, { driveClient }) {
      const buffer = await driveClient.downloadFile(file.id);
      if (!isOleCompoundFile(buffer)) throw new ExtractionFailure("corrupt-file", "not an OLE compound file");

      let text: string;
      try {
        text = await reader.toText(buffer);
      } catch (err) {
        throw new ExtractionFailure("corrupt-file", err instanceof Error ? err.message : String(err));
      }
      return { ok: true, text: text.trim() };
    },
  };
}
