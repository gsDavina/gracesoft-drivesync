import type { Unzipped } from "fflate";
import { ExtractionFailure } from "../types.js";
import type { ArchiveLimits, Extractor } from "../types.js";
import { attr, decodeXmlEntities, elements, odfInlineText, readRelationships } from "../xml.js";
import { entryText, readZip, requireEntryText } from "../zip.js";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const ODS_MIME = "application/vnd.oasis.opendocument.spreadsheet";

export interface Sheet {
  name: string;
  hidden: boolean;
  rows: string[][];
}

/** Guards against a single sparse/repeated cell or row expanding into an enormous output. */
const MAX_COLUMNS = 16_384; // Excel's own column limit (XFD)
const MAX_REPEAT = 1_000;

function columnIndex(cellRef: string | undefined): number | undefined {
  const letters = cellRef ? /^([A-Z]+)/i.exec(cellRef)?.[1] : undefined;
  if (!letters) return undefined;
  let index = 0;
  for (const ch of letters.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function trimRow(row: string[]): string[] {
  let end = row.length;
  while (end > 0 && row[end - 1]!.trim() === "") end -= 1;
  return row.slice(0, end);
}

function runText(inner: string): string {
  // Phonetic guide runs (<rPh>) are furigana annotations, not cell content.
  const withoutPhonetic = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return elements(withoutPhonetic, "t")
    .map((t) => decodeXmlEntities(t.inner))
    .join("");
}

/**
 * Reads every worksheet of an xlsx package, in workbook order. Formula cells
 * yield the value Excel last cached for them (`<v>`): formulas are never
 * evaluated, so nothing can be computed against external sources.
 * Dates come out as Excel serial numbers (number formats aren't applied).
 */
export function parseXlsx(entries: Unzipped): Sheet[] {
  const workbook = requireEntryText(entries, "xl/workbook.xml");
  const rels = readRelationships(entryText(entries, "xl/_rels/workbook.xml.rels"), "xl");
  const sharedStrings = elements(entryText(entries, "xl/sharedStrings.xml") ?? "", "si").map((si) => runText(si.inner));

  const sheets: Sheet[] = [];
  for (const sheet of elements(workbook, "sheet")) {
    const name = attr(sheet.attributes, "name") ?? `Sheet ${sheets.length + 1}`;
    const state = attr(sheet.attributes, "state");
    const relId = attr(sheet.attributes, "r:id");
    const target = relId ? rels.get(relId)?.target : undefined;
    const xml = target ? entryText(entries, target) : undefined;
    if (!xml) continue; // chartsheets / dialog sheets have no cell data

    const rows: string[][] = [];
    for (const row of elements(xml, "row")) {
      const cells: string[] = [];
      for (const cell of elements(row.inner, "c")) {
        const col = columnIndex(attr(cell.attributes, "r")) ?? cells.length;
        if (col >= MAX_COLUMNS) continue;
        const type = attr(cell.attributes, "t");
        const raw = elements(cell.inner, "v")[0]?.inner;
        let value: string;
        if (type === "s") value = sharedStrings[Number(raw)] ?? "";
        else if (type === "inlineStr") value = runText(elements(cell.inner, "is")[0]?.inner ?? "");
        else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
        else value = raw !== undefined ? decodeXmlEntities(raw) : "";
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      const trimmed = trimRow(cells);
      if (trimmed.length > 0) rows.push(trimmed);
    }
    sheets.push({ name, hidden: state === "hidden" || state === "veryHidden", rows });
  }
  return sheets;
}

/** Reads every table of an ODF spreadsheet's `content.xml`, in document order. */
export function parseOdsContent(content: string): Sheet[] {
  // Hidden tables are marked through their automatic style (table:display="false").
  const hiddenStyles = new Set(
    elements(content, "style:style")
      .filter((s) => attr(s.attributes, "style:family") === "table" && /table:display\s*=\s*"false"/.test(s.inner))
      .map((s) => attr(s.attributes, "style:name"))
      .filter((n): n is string => Boolean(n)),
  );

  const cellRe =
    /<table:(covered-table-cell|table-cell)(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/table:(?:covered-table-cell|table-cell)>)/g;

  const sheets: Sheet[] = [];
  for (const table of elements(content, "table:table")) {
    const name = attr(table.attributes, "table:name") ?? `Sheet ${sheets.length + 1}`;
    const styleName = attr(table.attributes, "table:style-name");
    const rows: string[][] = [];

    for (const row of elements(table.inner, "table:table-row")) {
      const cells: string[] = [];
      for (const match of row.inner.matchAll(cellRe)) {
        const attributes = match[2] ?? "";
        const inner = match[3] ?? "";
        const repeat = Math.min(Math.max(Number(attr(attributes, "table:number-columns-repeated") ?? "1") || 1, 1), MAX_REPEAT);
        let value = elements(inner, "text:p")
          .map((p) => odfInlineText(p.inner))
          .join("\n");
        if (!value) value = attr(attributes, "office:value") ?? attr(attributes, "office:boolean-value") ?? "";
        for (let i = 0; i < repeat && cells.length < MAX_COLUMNS; i++) cells.push(value);
      }
      const trimmed = trimRow(cells);
      if (trimmed.length === 0) continue;
      const repeatRows = Math.min(Math.max(Number(attr(row.attributes, "table:number-rows-repeated") ?? "1") || 1, 1), MAX_REPEAT);
      for (let i = 0; i < repeatRows; i++) rows.push(trimmed);
    }
    sheets.push({ name, hidden: styleName !== undefined && hiddenStyles.has(styleName), rows });
  }
  return sheets;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One Markdown section per visible, non-empty sheet (`## <Sheet name>` then
 * CSV rows), so each sheet becomes its own chunk section. Hidden sheets are
 * left out: they're usually lookup tables or scratch data a reader of the
 * workbook never sees.
 */
export function renderSheets(sheets: Sheet[]): string {
  return sheets
    .filter((sheet) => !sheet.hidden && sheet.rows.length > 0)
    .map((sheet) => `## ${sheet.name}\n\n${sheet.rows.map((row) => row.map(csvField).join(",")).join("\n")}`)
    .join("\n\n");
}

export function xlsxBufferToText(buffer: Uint8Array, limits: ArchiveLimits): string {
  const entries = readZip(buffer, limits, (name) => name.startsWith("xl/") && name.endsWith(".xml") || name.endsWith(".rels"));
  return renderSheets(parseXlsx(entries));
}

export function odsBufferToText(buffer: Uint8Array, limits: ArchiveLimits): string {
  const entries = readZip(buffer, limits, (name) => name === "content.xml" || name === "META-INF/manifest.xml");
  assertOdfNotEncrypted(entries);
  return renderSheets(parseOdsContent(requireEntryText(entries, "content.xml")));
}

/** ODF encryption is per-entry and declared in the manifest; the zip itself opens fine. */
export function assertOdfNotEncrypted(entries: Unzipped): void {
  if (/<manifest:encryption-data\b/.test(entryText(entries, "META-INF/manifest.xml") ?? "")) {
    throw new ExtractionFailure("password-protected", "ODF package declares encrypted entries");
  }
}

/** `.xlsx` and `.ods`, every sheet (M24). Legacy `.xls` stays unsupported for now (see the M24 progress doc). */
export function createSpreadsheetExtractor(): Extractor {
  return {
    name: "spreadsheet",
    mimeTypes: [XLSX_MIME, ODS_MIME],
    async extract(file, { driveClient, archiveLimits }) {
      const buffer = await driveClient.downloadFile(file.id);
      const text = file.mimeType === ODS_MIME ? odsBufferToText(buffer, archiveLimits) : xlsxBufferToText(buffer, archiveLimits);
      return { ok: true, text };
    },
  };
}
