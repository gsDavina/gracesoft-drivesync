# Adding an extractor

Text extraction is a registry of small, independent extractors, one per file family. Adding support for a new file type means writing one extractor, registering it, and testing it against fakes. Nothing downstream (chunking, dedup, embeddings, the vector store) needs to change: it only ever sees `{ ok, text }`.

## The `Extractor` interface

```typescript
// src/extraction/types.ts
export interface Extractor {
  name: string;                    // short, stable, used in logs and docs, e.g. "odt"
  mimeTypes: readonly string[];    // the Drive MIME types this extractor claims
  extract(file: DriveFileMeta, ctx: ExtractorContext): Promise<ExtractionResult>;
}

export interface ExtractorContext {
  driveClient: DriveClient;        // downloadFile / exportFile / exportAsText
  archiveLimits: ArchiveLimits;    // pass these to readZip for any zip-based format
}

export type ExtractionResult = { ok: true; text: string } | { ok: false; reason: ExtractionFailureReason };
```

You get these guards for free, from the dispatcher in `src/extraction/textExtractor.ts`, without writing anything:

- **Unclaimed types** fail as `unsupported-mime-type` and are never downloaded.
- **Size**: a file Drive reports as larger than `MAX_EXTRACT_BYTES` fails as `file-too-large` before your extractor runs.
- **Timeout**: extraction past `EXTRACT_TIMEOUT_MS` fails as `extraction-timeout`.
- **Failing closed**: throw `new ExtractionFailure("corrupt-file", "detail")` from anywhere in your extractor and it becomes `{ ok: false, reason: "corrupt-file" }`. Any *other* error is treated as transient and the file is retried next run, so only throw a plain `Error` for things that might succeed on retry (network, Drive 5xx).

Which reasons count as permanent (the file is recorded as `SKIPPED` and left alone until it changes) is decided in one place, `PERMANENT_FAILURE_REASONS` in `types.ts`. If you need a new reason, add it to the `ExtractionFailureReason` union and decide there whether it's permanent.

## Steps

1. **Create `src/extraction/extractors/yourFormat.ts`.** Export the MIME type constant(s) and a `createYourFormatExtractor()` factory. If you wrap a third-party parsing library, put it behind a small injected interface with a real default, the same seam as `PdfParser` (`extractors/pdf.ts`) and `DocxConverter` (`extractors/word.ts`), so unit tests can use a fake.
2. **Zip-based formats** (anything OOXML or ODF): open the bytes with `readZip(buffer, ctx.archiveLimits, want)` from `src/extraction/zip.ts`, never with a library that opens the zip itself. `readZip` enforces the entry-count and uncompressed-size caps, and classifies OLE-wrapped (encrypted) and non-zip input for you. If a library insists on opening the zip, give it `repackStored(entries)` (see the docx extractor).
3. **Produce Markdown-ish text where the format has structure.** Headings as `#` lines on their own paragraph (blank line before and after) become chunk sections in `chunkText`. Sections that aren't headings in the source (sheets, slides) use `## <name>`.
4. **Never execute or fetch anything.** Don't evaluate formulas, run macros or scripts, follow external relationships, or resolve external entities. `src/extraction/xml.ts` has text-only XML helpers that do none of these.
5. **Register it** in `defaultExtractors()` in `src/extraction/textExtractor.ts`. The registry throws at startup if your MIME type is already claimed by another extractor.
6. **Add the type to the README's "Supported file types" table.** `src/extraction/supportedTypes.test.ts` fails until the table and the registry agree.
7. **Write tests** next to your extractor (`yourFormat.test.ts`, or add a `describe` to `extractors/formats.test.ts`). Build small fixtures in code: `zipOf()` and `xlsxOf()` in `src/extraction/fixtures.testutil.ts` make real zips in memory, and `fakeDriveClient(buffer)` serves them. Cover at least: known text and headings come out, a corrupt input fails closed with a specific reason (and doesn't throw), and, for zips, an over-limit archive is rejected.

That's all. Registering a new MIME type changes the extractor registry's `capabilityVersion`, so files previously skipped as `unsupported-mime-type` are re-evaluated automatically on the first sync after you deploy; nobody has to touch them in Drive.

## When you improve an existing extractor

If a change means files that used to fail might now succeed (a parser fix, a new fallback), bump `EXTRACTION_REVISION` in `src/extraction/textExtractor.ts`. That changes `capabilityVersion` and gives every skipped file one more attempt. If your change alters the text produced for files that already extract fine, every such file's content hash changes and it is re-embedded once; call that out in the CHANGELOG.
