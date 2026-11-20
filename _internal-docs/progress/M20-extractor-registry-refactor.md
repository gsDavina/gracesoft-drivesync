# M20 — Extractor registry refactor

Status: **Done**

## What was built

- `src/extraction/types.ts` — `Extractor` (`name`, `mimeTypes`, `extract(file, ctx)`), `ExtractorContext`, `ExtractionResult`.
- `src/extraction/registry.ts` — `createExtractorRegistry(extractors)`: MIME type → extractor lookup. Throws if two extractors claim the same MIME type, naming both. `mimeTypes()` returns the sorted list (used by the README drift test and the M27 capability version).
- `src/extraction/extractors/googleNative.ts` and `extractors/pdf.ts` — the v2 behaviour moved out of the old `switch`, unchanged. `PdfParser` / `createPdfParser` moved with the PDF extractor and are re-exported from `textExtractor.ts`, so no import site changed.
- `src/extraction/textExtractor.ts` — `createTextExtractor` became a thin dispatcher: look up by `mimeType`, otherwise `unsupported-mime-type` (without downloading). `defaultExtractors(deps)` is the production set.
- `src/extraction/registry.test.ts` — routing, duplicate-claim refusal, the production set has no duplicates, and an unclaimed type never touches `downloadFile`/`exportAsText`.

## Decisions

- **Landed as its own commit** (`3009726`) before any new format, as the checklist asked, so the behaviour-neutral claim is checkable in history.
- **Each extractor gets its parsing library through its factory**, not through `ExtractorContext`. The context only carries what *every* extractor needs (the Drive client, and from M21 the archive limits).

## Verified locally

- All six pre-existing `textExtractor.test.ts` cases passed **unmodified** against the registry dispatcher at the M20 commit. (The Sheets case was later rewritten in M24 because the behaviour deliberately changed; see M24.)
- `npm run typecheck`, `npm run lint`, `npx vitest run src/extraction` (10 tests) clean.

## Next

M21 — download safety guards.
