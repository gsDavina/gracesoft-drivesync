import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import { createGoogleDocsSlidesExtractor, createGoogleSheetsCsvExtractor } from "./extractors/googleNative.js";
import { createPdfExtractor } from "./extractors/pdf.js";
import type { PdfParser } from "./extractors/pdf.js";
import { createExtractorRegistry } from "./registry.js";
import type { ExtractionResult, Extractor } from "./types.js";

export type { ExtractionFailureReason, ExtractionResult, Extractor } from "./types.js";
export type { PdfParser } from "./extractors/pdf.js";
export { createPdfParser } from "./extractors/pdf.js";

export interface TextExtractor {
  extractText(file: DriveFileMeta): Promise<ExtractionResult>;
}

export interface TextExtractorDeps {
  driveClient: DriveClient;
  pdfParser: PdfParser;
}

/** The production extractor set, in registration order. */
export function defaultExtractors(deps: TextExtractorDeps): Extractor[] {
  return [createGoogleDocsSlidesExtractor(), createGoogleSheetsCsvExtractor(), createPdfExtractor(deps.pdfParser)];
}

/**
 * A thin dispatcher: look the file's MIME type up in the extractor registry
 * and hand it over, or fail closed as `unsupported-mime-type` (without ever
 * downloading the file) when nothing claims it.
 */
export function createTextExtractor(deps: TextExtractorDeps): TextExtractor {
  const registry = createExtractorRegistry(defaultExtractors(deps));
  const ctx = { driveClient: deps.driveClient };

  return {
    async extractText(file) {
      const extractor = registry.lookup(file.mimeType);
      if (!extractor) return { ok: false, reason: "unsupported-mime-type" };
      return extractor.extract(file, ctx);
    },
  };
}
