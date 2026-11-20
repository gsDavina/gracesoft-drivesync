import { htmlToText } from "../html.js";
import { ExtractionFailure } from "../types.js";
import type { Extractor } from "../types.js";

export const PLAIN_TEXT_MIMES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "text/tab-separated-values",
] as const;
export const JSON_MIME = "application/json";
export const HTML_MIME = "text/html";

// `fatal` makes invalid UTF-8 throw instead of decoding to U+FFFD mojibake;
// a leading BOM is stripped by default (`ignoreBOM: false`).
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

export function decodeUtf8(buffer: Uint8Array): string {
  try {
    return strictUtf8.decode(buffer);
  } catch {
    throw new ExtractionFailure("unsupported-encoding", "not valid UTF-8");
  }
}

/**
 * JSON is pretty-printed so token boundaries fall on readable lines. A file
 * Drive labels JSON that doesn't parse is still text, so it's indexed as-is
 * rather than failed.
 */
export function prettyPrintJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** txt, md, csv, tsv, json and html: decoded as UTF-8 (M23). */
export function createPlainTextExtractor(): Extractor {
  return {
    name: "plain-text",
    mimeTypes: [...PLAIN_TEXT_MIMES, JSON_MIME, HTML_MIME],
    async extract(file, { driveClient }) {
      const text = decodeUtf8(await driveClient.downloadFile(file.id));
      if (file.mimeType === JSON_MIME) return { ok: true, text: prettyPrintJson(text) };
      if (file.mimeType === HTML_MIME) return { ok: true, text: htmlToText(text) };
      return { ok: true, text };
    },
  };
}
