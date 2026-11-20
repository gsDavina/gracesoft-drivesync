# M26 — Google Docs Markdown export (flagged)

Status: **Done**

## What was built

- `GOOGLE_DOCS_EXPORT_FORMAT=text|markdown` in `src/config/env.ts` (default `text`; anything else fails at startup).
- `extractors/googleNative.ts` — the old combined Docs/Slides extractor split in two: `createGoogleDocsExtractor(format)` exports `text/plain` or `text/markdown`; `createGoogleSlidesExtractor()` always exports `text/plain`.
- `src/worker.ts` passes the env value (and M21's limits) into `createTextExtractor`.
- `.env.example` and the deployment runbook document the flag and its one-time re-embed, with cost guidance (runbook "Upgrading to 2.1").

## Decisions

- **Default `text`, so an upgraded deployment sees no change to Docs** (same content hashes, no re-embed) unless someone opts in.
- **The flag only affects Docs.** Slides have no Markdown export with useful structure; they stay on plain text either way.
- **The flag isn't part of the M27 capability version.** Docs never get skipped (export either works or throws transiently), so it has no bearing on which skipped files deserve a retry.

## Verified locally

- `textExtractor.test.ts`: the unmodified v2 Docs test still calls `exportAsText(id, "text/plain")` with the default; `markdown` calls `exportAsText(id, "text/markdown")`; Slides call `text/plain` with the flag on.
- `env.test.ts`: default `text`, `markdown` accepted, `html` rejected.

## Explicitly not covered by this pass

- A real Doc with H1/H2 headings exported through Drive's `text/markdown` export, checked for correct `section` metadata end-to-end (testing checklist integration item). The chunker side is covered: Markdown headings become sections (verified with docx output in M22).

## Next

M27 — skipped-file state.
