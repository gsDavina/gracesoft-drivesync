import type { Extractor } from "./types.js";

export interface ExtractorRegistry {
  lookup(mimeType: string): Extractor | undefined;
  /** Every registered MIME type, sorted — what docs and the capability version are derived from. */
  mimeTypes(): string[];
}

/**
 * Builds the MIME type → extractor lookup. Throws on a duplicate claim
 * rather than letting a later extractor silently shadow an earlier one.
 */
export function createExtractorRegistry(extractors: readonly Extractor[]): ExtractorRegistry {
  const byMimeType = new Map<string, Extractor>();
  for (const extractor of extractors) {
    for (const mimeType of extractor.mimeTypes) {
      const existing = byMimeType.get(mimeType);
      if (existing) {
        throw new Error(
          `MIME type "${mimeType}" is claimed by both the "${existing.name}" and "${extractor.name}" extractors`,
        );
      }
      byMimeType.set(mimeType, extractor);
    }
  }

  return {
    lookup: (mimeType) => byMimeType.get(mimeType),
    mimeTypes: () => [...byMimeType.keys()].sort(),
  };
}
