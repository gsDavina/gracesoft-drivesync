import { createHash } from "node:crypto";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import {
  createGoogleDocsExtractor,
  createGoogleSheetsExtractor,
  createGoogleSlidesExtractor,
} from "./extractors/googleNative.js";
import type { GoogleDocsExportFormat } from "./extractors/googleNative.js";
import { createPdfExtractor } from "./extractors/pdf.js";
import type { PdfParser } from "./extractors/pdf.js";
import { createPlainTextExtractor } from "./extractors/plainText.js";
import { createOdtExtractor, createPresentationExtractor } from "./extractors/presentation.js";
import { createSpreadsheetExtractor } from "./extractors/spreadsheet.js";
import { createDocExtractor, createDocxExtractor } from "./extractors/word.js";
import type { DocTextReader, DocxConverter } from "./extractors/word.js";
import { createExtractorRegistry } from "./registry.js";
import type { ExtractorRegistry } from "./registry.js";
import { ExtractionFailure } from "./types.js";
import type { ArchiveLimits, ExtractionResult, Extractor, ExtractorContext } from "./types.js";

export type { ArchiveLimits, ExtractionFailureReason, ExtractionResult, Extractor } from "./types.js";
export { isPermanentFailure, PERMANENT_FAILURE_REASONS } from "./types.js";
export type { PdfParser } from "./extractors/pdf.js";
export { createPdfParser } from "./extractors/pdf.js";

/**
 * Bump when an *existing* extractor improves enough that files it used to
 * skip might now succeed (a parser fix, a new fallback). Adding a MIME type
 * changes `capabilityVersion` on its own, without a bump.
 */
const EXTRACTION_REVISION = 1;

export interface ExtractionLimits {
  /** Files whose Drive-reported size exceeds this fail as `file-too-large` before download. */
  maxBytes: number;
  /** Whole-extraction (download + parse) budget; past it, `extraction-timeout`. */
  timeoutMs: number;
  archive: ArchiveLimits;
}

export const DEFAULT_EXTRACTION_LIMITS: ExtractionLimits = {
  maxBytes: 25 * 1024 * 1024,
  timeoutMs: 30_000,
  archive: { maxUncompressedBytes: 100 * 1024 * 1024, maxEntries: 10_000 },
};

export interface TextExtractor {
  extractText(file: DriveFileMeta): Promise<ExtractionResult>;
  /**
   * Identifies what this build can extract. M27 stores it on every `SKIPPED`
   * file and retries those whose version differs, so a deploy that adds a
   * type (or fixes a parser) picks up previously-skipped files without
   * anyone touching them in Drive.
   */
  readonly capabilityVersion: string;
}

export interface TextExtractorDeps {
  driveClient: DriveClient;
  pdfParser: PdfParser;
  docxConverter?: DocxConverter;
  docTextReader?: DocTextReader;
  googleDocsExportFormat?: GoogleDocsExportFormat;
  limits?: Partial<Omit<ExtractionLimits, "archive">> & { archive?: Partial<ArchiveLimits> };
  /** Override the whole extractor set (tests, or a deployment that wants fewer types). */
  extractors?: Extractor[];
}

/** The production extractor set, in registration order. */
export function defaultExtractors(deps: TextExtractorDeps): Extractor[] {
  return [
    createGoogleDocsExtractor(deps.googleDocsExportFormat),
    createGoogleSlidesExtractor(),
    createGoogleSheetsExtractor(),
    createPdfExtractor(deps.pdfParser),
    createDocxExtractor(deps.docxConverter),
    createDocExtractor(deps.docTextReader),
    createPlainTextExtractor(),
    createSpreadsheetExtractor(),
    createPresentationExtractor(),
    createOdtExtractor(),
  ];
}

export function computeCapabilityVersion(registry: ExtractorRegistry): string {
  const digest = createHash("sha256").update(registry.mimeTypes().join("\n")).digest("hex").slice(0, 12);
  return `${EXTRACTION_REVISION}-${digest}`;
}

const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A thin dispatcher: look the file's MIME type up in the extractor registry
 * and hand it over, or fail closed as `unsupported-mime-type` (without ever
 * downloading the file) when nothing claims it. Around every extractor:
 *
 * - **Size guard** — a file Drive reports as larger than `maxBytes` fails as
 *   `file-too-large` before `downloadFile` is ever called. Google-native
 *   files report no size and skip this check.
 * - **Timeout** — past `timeoutMs` the file fails as `extraction-timeout`
 *   and the sync run moves on. The abandoned work isn't cancelled (no parser
 *   here takes an AbortSignal), and synchronous parsing can't be interrupted
 *   mid-way; the archive caps are what bound that work.
 * - **`ExtractionFailure`** thrown anywhere inside becomes `{ ok: false }`
 *   with its reason; anything else is rethrown as a transient failure.
 */
export function createTextExtractor(deps: TextExtractorDeps): TextExtractor {
  const registry = createExtractorRegistry(deps.extractors ?? defaultExtractors(deps));
  const limits: ExtractionLimits = {
    maxBytes: deps.limits?.maxBytes ?? DEFAULT_EXTRACTION_LIMITS.maxBytes,
    timeoutMs: deps.limits?.timeoutMs ?? DEFAULT_EXTRACTION_LIMITS.timeoutMs,
    archive: { ...DEFAULT_EXTRACTION_LIMITS.archive, ...deps.limits?.archive },
  };
  const ctx: ExtractorContext = { driveClient: deps.driveClient, archiveLimits: limits.archive };

  return {
    capabilityVersion: computeCapabilityVersion(registry),

    async extractText(file) {
      const extractor = registry.lookup(file.mimeType);
      if (!extractor) return { ok: false, reason: "unsupported-mime-type" };
      if (file.size !== undefined && file.size > limits.maxBytes) return { ok: false, reason: "file-too-large" };

      try {
        const result = await withTimeout(extractor.extract(file, ctx), limits.timeoutMs);
        if (result === TIMED_OUT) return { ok: false, reason: "extraction-timeout" };
        return result;
      } catch (err) {
        if (err instanceof ExtractionFailure) return { ok: false, reason: err.reason };
        throw err;
      }
    },
  };
}
