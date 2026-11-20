# M23 — Plain-text family

Status: **Done**

## What was built

- `src/extraction/extractors/plainText.ts` — one extractor for `text/plain`, `text/markdown`, `text/x-markdown`, `text/csv`, `text/tab-separated-values`, `application/json` and `text/html`.
  - Decoded with `new TextDecoder("utf-8", { fatal: true })`: a BOM is stripped, invalid UTF-8 throws → `unsupported-encoding`.
  - JSON is pretty-printed (2-space indent).
  - HTML goes through `htmlToText` (`src/extraction/html.ts`): headings as Markdown, `script`/`style`/`noscript`/`template`/`iframe`/`img` dropped, link targets dropped (`ignoreHref`), no word wrapping.

## Decisions

- **`text/x-markdown` is registered alongside `text/markdown`.** Drive reports either depending on how the file was uploaded.
- **JSON that doesn't parse is indexed as plain text, not failed.** It's still readable text a user put in their folder, and "fail closed" is about not inventing content, not about rejecting imperfect files. Valid JSON is pretty-printed so token boundaries fall on readable lines.
- **No encoding sniffing.** Non-UTF-8 text (Latin-1, UTF-16) fails as `unsupported-encoding` rather than guessing, per the checklist. A candidate fast-follow if it turns up in real folders.
- **An empty file is `{ ok: true, text: "" }`**, which chunks to zero chunks and is recorded as synced with `chunkCount: 0`.

## Verified locally

- `formats.test.ts`, plain-text block: BOM and no-BOM decode identically; Latin-1 `café` → `unsupported-encoding`; empty file → empty text and zero chunks; md/x-markdown/csv/tsv pass through; JSON pretty-printed and broken JSON kept as-is; HTML drops script/style content, link targets and image URLs while keeping `# Title` / `## Sub` and link text.

## Next

M24 — spreadsheets.
