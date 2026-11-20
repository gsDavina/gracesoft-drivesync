import { strToU8, zipSync } from "fflate";
import { vi } from "vitest";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";

/** Test-only: builds a real zip (deflated) from `path → text` entries. */
export function zipOf(files: Record<string, string>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
}

export function driveFile(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: "file_1",
    name: "file",
    mimeType: "text/plain",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function fakeDriveClient(download: Buffer = Buffer.from(""), overrides: Partial<DriveClient> = {}): DriveClient {
  return {
    verifyFolderAccess: vi.fn(),
    listFiles: vi.fn(),
    exportAsText: vi.fn(async () => ""),
    exportFile: vi.fn(async () => Buffer.from("")),
    downloadFile: vi.fn(async () => download),
    ...overrides,
  };
}

const XLSX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`;

/** A minimal, valid xlsx package: sheets given as rows of inline strings (or numbers), plus optional extras. */
export function xlsxOf(
  sheets: Array<{ name: string; state?: string; rows: Array<Array<string | number>> }>,
  extraEntries: Record<string, string> = {},
): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": XLSX_CONTENT_TYPES,
    "xl/workbook.xml": `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (s, i) =>
          `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ""} r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships>${sheets
      .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}</Relationships>`,
    ...extraEntries,
  };
  sheets.forEach((sheet, i) => {
    if (extraEntries[`xl/worksheets/sheet${i + 1}.xml`]) return;
    const rows = sheet.rows
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((cell, c) => {
              const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
              return typeof cell === "number"
                ? `<c r="${ref}"><v>${cell}</v></c>`
                : `<c r="${ref}" t="inlineStr"><is><t>${cell}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zipOf(files);
}
