import { describe, expect, it, vi } from "vitest";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import type { PdfParser } from "./textExtractor.js";
import { createTextExtractor } from "./textExtractor.js";
import { xlsxOf } from "./fixtures.testutil.js";

function file(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: "file_1",
    name: "doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDriveClient(overrides: Partial<DriveClient> = {}): DriveClient {
  return {
    verifyFolderAccess: vi.fn(),
    listFiles: vi.fn(),
    exportAsText: vi.fn(async () => ""),
    exportFile: vi.fn(async () => Buffer.from("")),
    downloadFile: vi.fn(async () => Buffer.from("")),
    ...overrides,
  };
}

function makePdfParser(text: string): PdfParser {
  return { parse: vi.fn(async () => ({ text })) };
}

describe("createTextExtractor", () => {
  it("exports Google Docs as plain text", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "hello doc") });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.document" }));

    expect(result).toEqual({ ok: true, text: "hello doc" });
    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/plain");
  });

  it("exports Google Slides as plain text", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "hello slides") });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.presentation" }));

    expect(result).toEqual({ ok: true, text: "hello slides" });
    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/plain");
  });

  // v2.1 (M24): was "exports Google Sheets as CSV" (exportAsText + text/csv,
  // first sheet only). Sheets now export as xlsx through the spreadsheet
  // parser, so every sheet is indexed.
  it("exports Google Sheets as xlsx and reads every sheet", async () => {
    const driveClient = makeDriveClient({
      exportFile: vi.fn(async () =>
        xlsxOf([
          { name: "Tab A", rows: [["a", "b"], [1, 2]] },
          { name: "Tab B", rows: [["c"]] },
        ]),
      ),
    });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.spreadsheet" }));

    expect(result).toEqual({ ok: true, text: "## Tab A\n\na,b\n1,2\n\n## Tab B\n\nc" });
    expect(driveClient.exportFile).toHaveBeenCalledWith(
      "file_1",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(driveClient.exportAsText).not.toHaveBeenCalled();
  });

  it("exports Google Docs as Markdown when GOOGLE_DOCS_EXPORT_FORMAT=markdown (M26)", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "# Heading\n\nBody") });
    const extractor = createTextExtractor({
      driveClient,
      pdfParser: makePdfParser(""),
      googleDocsExportFormat: "markdown",
    });

    const result = await extractor.extractText(file({ mimeType: "application/vnd.google-apps.document" }));

    expect(result).toEqual({ ok: true, text: "# Heading\n\nBody" });
    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/markdown");
  });

  it("leaves Google Slides on plain text even when the Docs Markdown flag is on (M26)", async () => {
    const driveClient = makeDriveClient({ exportAsText: vi.fn(async () => "slides") });
    const extractor = createTextExtractor({
      driveClient,
      pdfParser: makePdfParser(""),
      googleDocsExportFormat: "markdown",
    });

    await extractor.extractText(file({ mimeType: "application/vnd.google-apps.presentation" }));

    expect(driveClient.exportAsText).toHaveBeenCalledWith("file_1", "text/plain");
  });

  it("downloads and parses PDFs with a text layer", async () => {
    const driveClient = makeDriveClient({ downloadFile: vi.fn(async () => Buffer.from("pdf-bytes")) });
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("  real pdf text  ") });

    const result = await extractor.extractText(file({ mimeType: "application/pdf" }));

    expect(result).toEqual({ ok: true, text: "real pdf text" });
  });

  it("fails closed with a specific reason for a scanned PDF (no text layer)", async () => {
    const driveClient = makeDriveClient();
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("   ") });

    const result = await extractor.extractText(file({ mimeType: "application/pdf" }));

    expect(result).toEqual({ ok: false, reason: "scanned-pdf-ocr-not-implemented" });
  });

  it("fails closed for an unsupported mime type instead of silently returning nothing", async () => {
    const driveClient = makeDriveClient();
    const extractor = createTextExtractor({ driveClient, pdfParser: makePdfParser("") });

    const result = await extractor.extractText(file({ mimeType: "image/png" }));

    expect(result).toEqual({ ok: false, reason: "unsupported-mime-type" });
  });
});
