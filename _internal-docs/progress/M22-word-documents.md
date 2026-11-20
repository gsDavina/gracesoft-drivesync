# M22 — Word documents

Status: **Done**

## What was built

- `src/extraction/extractors/word.ts`:
  - **`.docx`** — download → `readZip` (zip-bomb guard, OLE → `password-protected`) → require `word/document.xml` → `repackStored` → mammoth `convertToHtml` → `htmlToText` (`src/extraction/html.ts`), which renders `<h1>`–`<h6>` as `#`–`######` paragraphs. Converter errors → `corrupt-file`.
  - **`.doc`** — download → must start with the OLE magic, else `corrupt-file` → `word-extractor` `getBody()`. Reader errors → `corrupt-file`.
  - Both libraries sit behind injected interfaces (`DocxConverter`, `DocTextReader`) with real defaults.
- `src/types/word-extractor.d.ts` — minimal declarations (the package ships none).
- Dependencies: `mammoth@1.13.0`, `word-extractor@1.0.4`, `html-to-text@10.0.1` (+ `@types/html-to-text`).

## Decisions

- **docx goes HTML → text, not mammoth's `convertToMarkdown`.** `convertToMarkdown` is deprecated in mammoth and untyped. Going through HTML reuses the exact converter the HTML extractor (M23) uses, so headings, tables and link handling behave the same for both formats.
- **mammoth is configured to never touch anything outside the file** (`externalFileAccess: false`) and to drop images instead of inlining them as base64 (`convertImage` returns an empty `src`), since only text is indexed.
- **Tables** come out through html-to-text's `dataTable` formatter (cells aligned with spaces) — readable and searchable, not CSV.
- **Encrypted `.doc` isn't detected specially.** Legacy Word encryption lives in a FIB flag inside the OLE stream; word-extractor either throws (→ `corrupt-file`) or returns garbage. Rare enough in practice to accept; noted.

## Verified locally

- `src/extraction/extractors/formats.test.ts`, docx block, against the **real mammoth** with a minimal docx built in code (content types, rels, `styles.xml` mapping `Heading1`/`Heading2`, a table, an `&amp;` entity): `# Quarterly report` and `## Outlook` come out as headings, body and table text survive, and the text run through the real `chunkText` gives chunks whose `section` is the Word heading.
- Truncated docx and a zip without `word/document.xml` → `corrupt-file`; OLE bytes → `password-protected`; converter throwing → `corrupt-file`. None throw.
- `.doc`: fake reader happy path; non-OLE bytes never reach the reader; the **real word-extractor** on a broken OLE header → `corrupt-file`.

## Explicitly not covered by this pass

- A real Word-produced `.docx`/`.doc` (lists, footnotes, tracked changes). There's no generator for real `.doc` files here; covered by the testing checklist's real-fixture integration item.

## Next

M23 — plain-text family.
