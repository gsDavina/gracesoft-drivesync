import { describe, expect, it, vi } from "vitest";
import { driveFile, fakeDriveClient, zipOf } from "./fixtures.testutil.js";
import { createTextExtractor } from "./textExtractor.js";
import { ExtractionFailure } from "./types.js";
import type { Extractor } from "./types.js";
import { readZip } from "./zip.js";

const limits = { maxUncompressedBytes: 1_000, maxEntries: 5 };

function stubExtractor(extract: Extractor["extract"]): Extractor {
  return { name: "stub", mimeTypes: ["text/plain"], extract };
}

describe("size guard (M21)", () => {
  it("fails a file over MAX_EXTRACT_BYTES as file-too-large without downloading it", async () => {
    const driveClient = fakeDriveClient(Buffer.from("hello"));
    const textExtractor = createTextExtractor({ driveClient, pdfParser: { parse: vi.fn() }, limits: { maxBytes: 100 } });

    const result = await textExtractor.extractText(driveFile({ size: 101 }));

    expect(result).toEqual({ ok: false, reason: "file-too-large" });
    expect(driveClient.downloadFile).not.toHaveBeenCalled();
  });

  it("lets a file at exactly the limit through", async () => {
    const driveClient = fakeDriveClient(Buffer.from("hello"));
    const textExtractor = createTextExtractor({ driveClient, pdfParser: { parse: vi.fn() }, limits: { maxBytes: 100 } });

    expect(await textExtractor.extractText(driveFile({ size: 100 }))).toEqual({ ok: true, text: "hello" });
  });

  it("skips the check for Google-native files, which report no size", async () => {
    const driveClient = fakeDriveClient(Buffer.from(""), { exportAsText: vi.fn(async () => "doc text") });
    const textExtractor = createTextExtractor({ driveClient, pdfParser: { parse: vi.fn() }, limits: { maxBytes: 1 } });

    const result = await textExtractor.extractText(driveFile({ mimeType: "application/vnd.google-apps.document" }));

    expect(result).toEqual({ ok: true, text: "doc text" });
  });

  it("reports an unsupported type as unsupported, even when it's also too large", async () => {
    const textExtractor = createTextExtractor({
      driveClient: fakeDriveClient(),
      pdfParser: { parse: vi.fn() },
      limits: { maxBytes: 1 },
    });

    expect(await textExtractor.extractText(driveFile({ mimeType: "video/mp4", size: 10 }))).toEqual({
      ok: false,
      reason: "unsupported-mime-type",
    });
  });
});

describe("timeout (M21)", () => {
  it("fails a never-resolving extraction as extraction-timeout within the window", async () => {
    const textExtractor = createTextExtractor({
      driveClient: fakeDriveClient(),
      pdfParser: { parse: vi.fn() },
      limits: { timeoutMs: 20 },
      extractors: [stubExtractor(() => new Promise(() => {}))],
    });

    const started = Date.now();
    const result = await textExtractor.extractText(driveFile());

    expect(result).toEqual({ ok: false, reason: "extraction-timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("failure classification", () => {
  it("turns a thrown ExtractionFailure into its specific reason", async () => {
    const textExtractor = createTextExtractor({
      driveClient: fakeDriveClient(),
      pdfParser: { parse: vi.fn() },
      extractors: [
        stubExtractor(async () => {
          throw new ExtractionFailure("corrupt-file");
        }),
      ],
    });

    expect(await textExtractor.extractText(driveFile())).toEqual({ ok: false, reason: "corrupt-file" });
  });

  it("rethrows anything else, so transient errors (Drive 5xx) keep their retry-every-run behaviour", async () => {
    const textExtractor = createTextExtractor({
      driveClient: fakeDriveClient(),
      pdfParser: { parse: vi.fn() },
      extractors: [
        stubExtractor(async () => {
          throw new Error("drive 503");
        }),
      ],
    });

    await expect(textExtractor.extractText(driveFile())).rejects.toThrow("drive 503");
  });
});

describe("readZip zip-bomb guard (M21)", () => {
  it("returns the wanted entries of an archive within the caps", () => {
    const entries = readZip(zipOf({ "a.xml": "<a/>", "b.xml": "<b/>" }), limits, (name) => name === "a.xml");
    expect(Object.keys(entries)).toEqual(["a.xml"]);
  });

  it("rejects an archive whose declared uncompressed size exceeds the cap, before inflating it", () => {
    // 5 KB of one repeated byte deflates to a few dozen bytes: a miniature bomb.
    const bomb = zipOf({ "word/document.xml": "A".repeat(5_000) });
    expect(bomb.length).toBeLessThan(200);
    expect(() => readZip(bomb, limits, () => true)).toThrow(expect.objectContaining({ reason: "archive-too-large" }));
  });

  it("rejects an archive with too many entries", () => {
    const many = zipOf(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.xml`, "x"])));
    expect(() => readZip(many, limits, () => false)).toThrow(expect.objectContaining({ reason: "archive-too-large" }));
  });

  it("classifies an OLE-wrapped (encrypted) OOXML file as password-protected", () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(() => readZip(ole, limits, () => true)).toThrow(expect.objectContaining({ reason: "password-protected" }));
  });

  it("classifies non-zip bytes (e.g. a renamed .exe) as corrupt-file", () => {
    expect(() => readZip(Buffer.from("MZ\x90\x00 not a zip"), limits, () => true)).toThrow(
      expect.objectContaining({ reason: "corrupt-file" }),
    );
  });

  it("classifies a truncated zip as corrupt-file", () => {
    const truncated = zipOf({ "a.xml": "<a>hello</a>" }).subarray(0, 20);
    expect(() => readZip(truncated, limits, () => true)).toThrow(expect.objectContaining({ reason: "corrupt-file" }));
  });
});
