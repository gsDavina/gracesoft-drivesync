import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";

/**
 * Every specific reason an extraction can fail closed. Adding a reason is an
 * additive change (consumers already treat `reason` as an opaque string), in
 * keeping with M5's "fail closed with a specific reason" principle.
 */
export type ExtractionFailureReason =
  | "unsupported-mime-type"
  | "scanned-pdf-ocr-not-implemented"
  // v2.1 (M21–M23)
  | "file-too-large"
  | "extraction-timeout"
  | "archive-too-large"
  | "corrupt-file"
  | "password-protected"
  | "unsupported-encoding";

export type ExtractionResult = { ok: true; text: string } | { ok: false; reason: ExtractionFailureReason };

/**
 * Reasons that will fail identically on every retry until the file itself
 * changes (or this service gains a capability — see `capabilityVersion`).
 * M27 records these as `SKIPPED` instead of retrying them every run. The
 * only transient reason is `extraction-timeout` (it can depend on load);
 * thrown errors (Drive 5xx, network) are transient too and never reach here
 * as a reason.
 */
export const PERMANENT_FAILURE_REASONS: ReadonlySet<ExtractionFailureReason> = new Set<ExtractionFailureReason>([
  "unsupported-mime-type",
  "scanned-pdf-ocr-not-implemented",
  "file-too-large",
  "archive-too-large",
  "corrupt-file",
  "password-protected",
  "unsupported-encoding",
]);

export function isPermanentFailure(reason: string): boolean {
  return PERMANENT_FAILURE_REASONS.has(reason as ExtractionFailureReason);
}

/**
 * Thrown from anywhere inside an extractor (or a helper it calls, like the
 * zip reader) to fail closed with a specific reason. The dispatcher turns it
 * into `{ ok: false, reason }`; any *other* thrown error propagates as a
 * transient failure, exactly as before v2.1.
 */
export class ExtractionFailure extends Error {
  constructor(
    readonly reason: ExtractionFailureReason,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "ExtractionFailure";
  }
}

export interface ArchiveLimits {
  /** Cap on the summed *declared* uncompressed size of every entry in an OOXML/ODF zip. */
  maxUncompressedBytes: number;
  maxEntries: number;
}

/** What every extractor gets handed besides the file itself. */
export interface ExtractorContext {
  driveClient: DriveClient;
  archiveLimits: ArchiveLimits;
}

/**
 * One file family's extractor. Each claims the MIME types it handles; the
 * registry (see `registry.ts`) refuses two extractors claiming the same one.
 * Parsing libraries are injected through each extractor's factory (the same
 * seam as M5's `PdfParser`), so unit tests never need the real library.
 */
export interface Extractor {
  /** Short, stable identifier used in logs and docs, e.g. `"pdf"`. */
  name: string;
  mimeTypes: readonly string[];
  extract(file: DriveFileMeta, ctx: ExtractorContext): Promise<ExtractionResult>;
}
