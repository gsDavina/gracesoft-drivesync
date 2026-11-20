import { describe, expect, it, vi } from "vitest";
import type { DriveClient } from "../drive/driveClient.js";
import { createExtractorRegistry } from "./registry.js";
import { createPdfParser, createTextExtractor, defaultExtractors } from "./textExtractor.js";
import type { Extractor } from "./types.js";

function extractor(name: string, mimeTypes: string[]): Extractor {
  return { name, mimeTypes, extract: vi.fn(async () => ({ ok: true as const, text: name })) };
}

function makeDriveClient(): DriveClient {
  return {
    verifyFolderAccess: vi.fn(),
    listFiles: vi.fn(),
    exportAsText: vi.fn(async () => ""),
    exportFile: vi.fn(async () => Buffer.from("")),
    downloadFile: vi.fn(async () => Buffer.from("")),
  };
}

describe("createExtractorRegistry", () => {
  it("routes each registered MIME type to exactly the extractor that claimed it", () => {
    const a = extractor("a", ["text/a", "text/a2"]);
    const b = extractor("b", ["text/b"]);
    const registry = createExtractorRegistry([a, b]);

    expect(registry.lookup("text/a")).toBe(a);
    expect(registry.lookup("text/a2")).toBe(a);
    expect(registry.lookup("text/b")).toBe(b);
    expect(registry.lookup("text/c")).toBeUndefined();
    expect(registry.mimeTypes()).toEqual(["text/a", "text/a2", "text/b"]);
  });

  it("refuses two extractors claiming the same MIME type", () => {
    expect(() => createExtractorRegistry([extractor("a", ["text/x"]), extractor("b", ["text/x"])])).toThrow(
      /claimed by both the "a" and "b" extractors/,
    );
  });

  it("the production extractor set has no duplicate claims", () => {
    expect(() =>
      createExtractorRegistry(defaultExtractors({ driveClient: makeDriveClient(), pdfParser: createPdfParser() })),
    ).not.toThrow();
  });
});

describe("createTextExtractor dispatch", () => {
  it("never downloads or exports a file whose MIME type nothing claims", async () => {
    const driveClient = makeDriveClient();
    const textExtractor = createTextExtractor({ driveClient, pdfParser: { parse: vi.fn() } });

    const result = await textExtractor.extractText({
      id: "f",
      name: "video.mp4",
      mimeType: "video/mp4",
      modifiedTime: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: false, reason: "unsupported-mime-type" });
    expect(driveClient.downloadFile).not.toHaveBeenCalled();
    expect(driveClient.exportAsText).not.toHaveBeenCalled();
  });
});
