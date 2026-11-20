# M29 — Docs & release

Status: **In progress** — docs done; staging and production deploy not started

## What was built

- **README** — "Supported file types" table (one row per format, every MIME type the registry claims), what happens to everything else (skipped, with a reason), updated Extraction feature bullet, build status, and a link to the new extractor guide.
- **`src/extraction/supportedTypes.test.ts`** — parses the README table and asserts its MIME types equal `registry.mimeTypes()` exactly, so the table can't drift from the code.
- **`docs/architecture.md`** — extraction section rewritten (registry, guards, in-house OOXML/ODF reader, fail-closed reasons) plus a skipped-files paragraph.
- **`docs/adding-an-extractor.md`** — new, following `adding-a-provider.md`: the `Extractor` interface, the guards the dispatcher gives for free, `readZip`, structure as Markdown, never executing/fetching, registration, README table, test fixtures, and when to bump `EXTRACTION_REVISION`.
- **`docs/api-reference.md`, `docs/index.html`** — `mimeType` on `/query` and `fetch_document`; skipped fields on `/status` and `/audit`.
- **`.env.example`** — `MAX_EXTRACT_BYTES`, `EXTRACT_TIMEOUT_MS`, `GOOGLE_DOCS_EXPORT_FORMAT`, all commented out with their defaults (none required).
- **`docs/deployment-runbook.md`** — env table row and an "Upgrading to 2.1" section: migration, the Sheets re-embed (always), the Docs re-embed (flag only), cost guidance, `mimeType` on old vectors, and rolling back to 2.0.
- **`CHANGELOG.md`** — `2.1.0` entry (Unreleased) with Added / Changed / Upgrade notes, including both re-embed notes with rough costs.

## Decisions

- **Cost guidance uses `text-embedding-3-small` at $0.02 per 1M tokens** with a pointer to check current pricing, plus a quick estimate from `GET /audit` (`totalChunks` × ~400 tokens, since chunks are capped at 500).
- **`package.json` is not bumped to `2.1.0` yet.** That happens with the release, after the staging run.

## Remaining

- [ ] Deploy to Railway **staging**, apply the migration on a copy of populated v2 data, run the real-Drive fixtures (testing checklist integration and security sections), watch worker memory.
- [ ] Walk through `docs/adding-an-extractor.md` for real with a throwaway extractor (testing checklist Docs item).
- [ ] Bump `package.json` to `2.1.0`, date the CHANGELOG entry, deploy to production.
