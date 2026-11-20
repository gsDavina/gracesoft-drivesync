# M24 — Spreadsheets (all sheets)

Status: **Done** (`.xls` deferred, see Decisions)

## What was built

- `src/extraction/extractors/spreadsheet.ts`:
  - `parseXlsx(entries)` — reads `xl/workbook.xml` (sheet order, names, `state`), resolves each sheet through `xl/_rels/workbook.xml.rels`, reads `xl/sharedStrings.xml` (rich-text runs joined, phonetic `<rPh>` runs dropped) and every `<row>`/`<c>`: shared strings, inline strings, booleans (`TRUE`/`FALSE`), errors and numbers. Column positions come from cell references, so sparse rows keep their gaps.
  - `parseOdsContent(content.xml)` — every `table:table`, honouring `number-columns-repeated` / `number-rows-repeated` (capped at 1 000) and hidden tables (`table:display="false"` on the table's automatic style). Encrypted ODF (declared in `META-INF/manifest.xml`) → `password-protected`.
  - `renderSheets` — one `## <Sheet name>` section per visible, non-empty sheet, rows as CSV (quoted where needed), trailing empty cells and empty rows dropped.
  - `createSpreadsheetExtractor()` for `.xlsx` and `.ods`.
- **Google Sheets re-routed** (`extractors/googleNative.ts`): `exportFile(id, xlsx MIME)` → the same xlsx reader. Replaces the v1/v2 `text/csv` export, which only ever returned the first sheet.
- `src/extraction/xml.ts` — small text-only XML helpers (entity decoding, attribute lookup, non-nesting element matcher, OPC relationship resolution, ODF inline text).
- `fflate@0.8.3` added (zero dependencies).

## Decisions

- **Parser choice: an in-house reader on `fflate`, not SheetJS, `exceljs` or `officeparser`.**
  - SheetJS from its own CDN (the maintained build) can't be installed here: this environment's npm config refuses remote tarballs (`EALLOWREMOTE`), and that policy shouldn't be overridden for one dependency. The npm-registry `xlsx@0.18.5` is unmaintained with known CVEs, as the checklist warned.
  - `exceljs` reads `.xlsx` only, pulls in an older zip stack, and would still need a second library for `.ods`.
  - `officeparser@8.x` needs Node 22+ (this project runs Node 20 in CI and Docker) and drags in `pdfjs-dist` and `tesseract.js`.
  - The parts that matter for text are small and well specified: cell values live in `<c>`/`<v>`, shared strings in `<si>`, sheet order in `workbook.xml`. Reading them directly keeps every byte behind the M21 zip guard, adds one zero-dependency package, and evaluates nothing.
- **`.xls` (BIFF8) is deferred.** It's a binary OLE format with no small reader; supporting it means taking on SheetJS. Legacy `.xls` files stay `unsupported-mime-type` (and are recorded as skipped, M27), so when support lands they're picked up automatically.
- **Formula cells give their cached value (`<v>`), never the formula.** Nothing is ever evaluated, so external references (`WEBSERVICE`, links to other workbooks) can't fetch anything. A workbook saved by a tool that doesn't cache values would give empty cells for formulas; Excel and Google Sheets both cache.
- **Hidden sheets are left out.** They're usually lookup tables or scratch data a reader of the workbook never sees, and leaving them out errs on the side of not surfacing content the author hid.
- **Number formats aren't applied.** Dates come out as Excel serial numbers and numbers in their stored precision. Applying formats needs `styles.xml` number-format parsing; a candidate refinement.
- **Release note:** every Google Sheet's extracted text changes (all tabs, `##` sections), so every Sheet re-embeds once on the first sync after deploy. Written up in the CHANGELOG and the runbook's "Upgrading to 2.1".

## Verified locally

- `formats.test.ts`, spreadsheets block: a four-sheet workbook gives `## Summary` and `## Detail` in workbook order, with the empty and the `hidden` sheet omitted and CSV quoting applied; shared strings, rich-text runs, phonetic runs dropped, booleans, sparse columns, and a `WEBSERVICE` formula yielding only its cached `42`; an `.ods` with a 16 000-column repeated empty cell and a 1 048 000-row repeated empty row (the shape LibreOffice really writes) renders as two short rows and skips its hidden table; encrypted `.ods` → `password-protected`; a zip with no workbook → `corrupt-file`.
- `textExtractor.test.ts`: Google Sheets now call `exportFile(id, xlsx MIME)` (not `exportAsText`) and return every tab. This replaces the v2 "exports Google Sheets as CSV" test, deliberately: it's the one behaviour change in this release.

## Explicitly not covered by this pass

- A real multi-tab Google Sheet exported by Drive, and real Excel/LibreOffice-saved files (testing checklist integration items).

## Next

M25 — presentations & OpenDocument.
