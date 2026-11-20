import type { Extractor } from "../types.js";

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDES_MIME = "application/vnd.google-apps.presentation";

/** Google Docs and Slides, exported by Drive itself as plain text. */
export function createGoogleDocsSlidesExtractor(): Extractor {
  return {
    name: "google-docs-slides",
    mimeTypes: [GOOGLE_DOC_MIME, GOOGLE_SLIDES_MIME],
    async extract(file, { driveClient }) {
      const text = await driveClient.exportAsText(file.id, "text/plain");
      return { ok: true, text };
    },
  };
}

/**
 * Google Sheets via Drive's CSV export, which only captures the first sheet
 * of a multi-sheet spreadsheet — a known limitation carried forward from v1
 * (see the M5 progress doc).
 */
export function createGoogleSheetsCsvExtractor(): Extractor {
  return {
    name: "google-sheets",
    mimeTypes: [GOOGLE_SHEET_MIME],
    async extract(file, { driveClient }) {
      const text = await driveClient.exportAsText(file.id, "text/csv");
      return { ok: true, text };
    },
  };
}
