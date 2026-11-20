import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";

/**
 * Every specific reason an extraction can fail closed. Adding a reason is an
 * additive change (consumers already treat `reason` as an opaque string), in
 * keeping with M5's "fail closed with a specific reason" principle.
 */
export type ExtractionFailureReason = "unsupported-mime-type" | "scanned-pdf-ocr-not-implemented";

export type ExtractionResult = { ok: true; text: string } | { ok: false; reason: ExtractionFailureReason };

/** What every extractor gets handed besides the file itself. */
export interface ExtractorContext {
  driveClient: DriveClient;
}

/**
 * One file family's extractor. Each claims the MIME types it handles; the
 * registry (see `registry.ts`) refuses two extractors claiming the same one.
 * Parsing libraries are injected through each extractor's factory (the same
 * seam as M5's `PdfParser`), so unit tests never need real bytes.
 */
export interface Extractor {
  /** Short, stable identifier used in logs and docs, e.g. `"pdf"`. */
  name: string;
  mimeTypes: readonly string[];
  extract(file: DriveFileMeta, ctx: ExtractorContext): Promise<ExtractionResult>;
}
