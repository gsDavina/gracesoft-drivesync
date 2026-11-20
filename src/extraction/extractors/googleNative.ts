import type { Extractor } from "../types.js";
import { XLSX_MIME, xlsxBufferToText } from "./spreadsheet.js";

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

export type GoogleDocsExportFormat = "text" | "markdown";

/**
 * Google Docs, exported by Drive. `text` (the default) is the v2 behaviour.
 * `markdown` (M26, opt-in through `GOOGLE_DOCS_EXPORT_FORMAT`) uses Drive's
 * `text/markdown` export so real heading styles reach the chunker as `#`
 * headings; switching it changes every Doc's content hash (one re-embed).
 */
export function createGoogleDocsExtractor(format: GoogleDocsExportFormat = "text"): Extractor {
  const exportMimeType = format === "markdown" ? "text/markdown" : "text/plain";
  return {
    name: "google-docs",
    mimeTypes: [GOOGLE_DOC_MIME],
    async extract(file, { driveClient }) {
      return { ok: true, text: await driveClient.exportAsText(file.id, exportMimeType) };
    },
  };
}

/** Google Slides, exported by Drive as plain text (unaffected by the Docs export flag). */
export function createGoogleSlidesExtractor(): Extractor {
  return {
    name: "google-slides",
    mimeTypes: [GOOGLE_SLIDES_MIME],
    async extract(file, { driveClient }) {
      return { ok: true, text: await driveClient.exportAsText(file.id, "text/plain") };
    },
  };
}

/**
 * Google Sheets, exported as xlsx and read by the same parser as uploaded
 * workbooks, so *every* sheet is indexed (M24). Before v2.1 this used
 * Drive's CSV export, which only ever returned the first sheet.
 */
export function createGoogleSheetsExtractor(): Extractor {
  return {
    name: "google-sheets",
    mimeTypes: [GOOGLE_SHEET_MIME],
    async extract(file, { driveClient, archiveLimits }) {
      const buffer = await driveClient.exportFile(file.id, XLSX_MIME);
      return { ok: true, text: xlsxBufferToText(buffer, archiveLimits) };
    },
  };
}
