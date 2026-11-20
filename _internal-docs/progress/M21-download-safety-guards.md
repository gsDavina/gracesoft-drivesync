# M21 — Download safety guards

Status: **Done**

## What was built

- **`size` on Drive listings** — `files(... , size)` added to the `listFiles` fields; `DriveFileMeta.size?: number` (absent for Google-native files, which have no stored binary).
- **`DriveClient.exportFile(fileId, mimeType): Buffer`** — binary export (`responseType: "arraybuffer"`). Needed for M24: `exportAsText` decodes the response as text, which would corrupt an xlsx export. All `DriveClient` test fakes gained the method.
- **Env vars** (`src/config/env.ts`, all optional): `MAX_EXTRACT_BYTES` (default 25 MiB), `EXTRACT_TIMEOUT_MS` (default 30 000), and M26's `GOOGLE_DOCS_EXPORT_FORMAT`. Invalid values (negative, zero, non-numeric, unknown format) fail at startup naming the variable.
- **Dispatcher guards** (`src/extraction/textExtractor.ts`):
  - unclaimed MIME type → `unsupported-mime-type` (checked first, so an unsupported file is never reported as "too large");
  - `file.size > maxBytes` → `file-too-large`, **before** the extractor (and so `downloadFile`) runs; exactly-at-limit passes;
  - extraction wrapped in a timeout → `extraction-timeout`;
  - `ExtractionFailure` thrown anywhere inside an extractor → `{ ok: false, reason }`; any other error is rethrown, so Drive 5xx/network errors keep their existing transient behaviour.
- **Zip-bomb guard** (`src/extraction/zip.ts`, `readZip`): every OOXML/ODF format goes through it. Before inflating an entry it counts entries (`maxEntries`, default 10 000) and sums **declared** uncompressed sizes (`maxUncompressedBytes`, default 100 MiB) → `archive-too-large`. OLE-wrapped input → `password-protected` (that's how Office stores an encrypted docx/xlsx/pptx); non-zip input → `corrupt-file`; any fflate error → `corrupt-file`.
- **New reasons** in `ExtractionFailureReason`: `file-too-large`, `extraction-timeout`, `archive-too-large`, `corrupt-file`, `password-protected`, `unsupported-encoding`. `PERMANENT_FAILURE_REASONS` / `isPermanentFailure` (used by M27) live next to them.

## Decisions

- **Declared sizes are enough to bound actual output.** fflate's `unzipSync` inflates each entry into a buffer of exactly its declared size, so an entry that lies about its size can't expand beyond it. Capping the declared total therefore caps real memory, without a streaming decompressor.
- **Third-party parsers that open the zip themselves get a re-packed copy.** mammoth (JSZip) trusts the archive's own headers. The docx extractor inflates through `readZip` first, then hands mammoth `repackStored(entries)`, an uncompressed zip of the already-bounded entries, so mammoth can't be bombed either.
- **The archive caps aren't env vars.** The checklist only asked for the two size/time vars; the archive caps are constants (`DEFAULT_EXTRACTION_LIMITS`) overridable through `createTextExtractor({ limits })`. 100 MiB uncompressed is generous for real Office files and keeps worker memory bounded.
- **The timeout covers download + parse, and doesn't cancel the abandoned work.** None of the parsers take an `AbortSignal`, and the in-house OOXML/ODF readers are synchronous, so a timer can't interrupt them mid-parse. The timeout catches slow downloads and hung async parsers; the archive caps are what bound synchronous work. Recorded as a known limitation.
- **`extraction-timeout` is the only transient reason.** Everything else fails identically on retry until the file changes (see M27).

## Verified locally

- `src/extraction/guards.test.ts` (13 tests): size guard (over, exactly-at, Google-native, unsupported-wins), timeout returns within the window for a never-resolving extractor, `ExtractionFailure` vs plain errors, and `readZip` against a real miniature bomb (5 KB → under 200 bytes compressed), too many entries, OLE magic, a renamed `.exe`, and a truncated zip.
- `src/config/env.test.ts`: defaults and invalid values for the three new vars.

## Explicitly not covered by this pass

- A real crafted high-ratio zip bomb against the real worker's memory, and an oversized real Drive file confirmed never downloaded (via logs / API call counts). Both need the staging run (testing checklist, Security section).

## Next

M22 — Word documents.
