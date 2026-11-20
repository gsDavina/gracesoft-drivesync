# Changelog

All notable changes to GraceSoft DriveSync are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [2.1.0] — Unreleased

Document type expansion. Code complete; not yet deployed to staging or
production, and `package.json` stays at `2.0.0` until it is. See
`_internal-docs/06-v2.1-milestone-checklist.md`.

### Added

- Extraction for Word (`.docx` with real headings, legacy `.doc`), Excel
  (`.xlsx`), PowerPoint (`.pptx`, with slide titles and speaker notes),
  OpenDocument (`.odt`, `.ods`, `.odp`), and plain text, Markdown, CSV,
  TSV, JSON and HTML. See "Supported file types" in the README.
- Every tab of a Google Sheet is now indexed (one `## <Sheet>` section
  each). Previously only the first tab was.
- `GOOGLE_DOCS_EXPORT_FORMAT=text|markdown` (default `text`): export
  Google Docs as Markdown so their headings become chunk sections.
- Safety guards: `MAX_EXTRACT_BYTES` (default 25 MB, checked before
  download), `EXTRACT_TIMEOUT_MS` (default 30 s), and zip-bomb protection
  for every Office/OpenDocument file.
- Skipped files: a file that can't be indexed for a permanent reason is
  recorded once as skipped and left alone until it changes in Drive (or an
  upgrade adds support for it), instead of failing and being logged on
  every run. `GET /status` and `GET /audit` gain `skippedCount` /
  `skippedByReason` (and `totalSkipped` on `/audit`).
- `mimeType` on retrieval results (`POST /query`, MCP `search`) and on MCP
  `fetch_document`.
- New fail-closed reasons: `file-too-large`, `extraction-timeout`,
  `archive-too-large`, `corrupt-file`, `password-protected`,
  `unsupported-encoding`.
- `docs/adding-an-extractor.md`.

### Changed

- Extraction is now a MIME type → extractor registry
  (`src/extraction/registry.ts`, one extractor per file family).
- The Drive listing requests each file's `size`.

### Upgrade notes

- **Migration** `20261121000000_add_drive_file_skip_status` (additive;
  existing rows default to `SYNCED`).
- **Every Google Sheet is re-embedded once** on the first sync after
  deploy, because its extracted text now covers every tab. Rough cost with
  `text-embedding-3-small` ($0.02 per 1M tokens): about $0.40 per 1,000
  Sheets averaging 20k tokens.
- **Every Google Doc is re-embedded once** only if you set
  `GOOGLE_DOCS_EXPORT_FORMAT=markdown`. The default leaves Docs, Slides and
  PDFs unchanged (same content hashes, no re-embed).
- Vectors written before 2.1 have no `mimeType` until their file is next
  re-embedded.
- Not supported yet (recorded as skipped): OCR for scanned PDFs and
  images, legacy `.xls` and `.ppt`, `.rtf`, `.epub`, Apple iWork.

## [2.0.0] — 2026-11-20

Baseline entry. The `package.json` version was `0.1.0` throughout the v2
build even though every doc already called it v2; it now says `2.0.0` so
the next release can ship as `2.1.0`. No code changes in this entry.

What v2.0.0 contains (milestones M1–M18 in
`_internal-docs/01-milestone-checklist.md`):

- Multi-tenant accounts with HMAC-peppered API keys.
- Google Drive folder connection through a shared `drive.readonly` service
  account, including every subfolder of the connected folder.
- Change detection, content-hash dedup and stale-vector cleanup.
- Extraction for Google Docs, Sheets (first sheet only), Slides and PDFs
  with a text layer.
- Token-budgeted chunking with section/heading metadata.
- Pluggable `EmbeddingProvider` (OpenAI reference adapter) and
  `VectorStore` (Pinecone reference adapter), namespaced per account.
- Scheduled sync on BullMQ + Redis, with per-account Drive rate limiting.
- REST retrieval (`POST /query`), MCP server (`search`, `fetch_document`),
  and observability endpoints (`GET /status`, `GET /audit`).
- Railway deployment (server, worker and MCP from one image).
