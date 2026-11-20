import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DriveClient } from "../drive/driveClient.js";
import { createExtractorRegistry } from "./registry.js";
import { defaultExtractors } from "./textExtractor.js";

/** Every backticked MIME type in the README's "Supported file types" table. */
function readmeMimeTypes(): string[] {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const section = /## Supported file types\r?\n([\s\S]*?)\r?\n## /.exec(readme)?.[1] ?? "";
  const tableRows = section.split(/\r?\n/).filter((line) => line.startsWith("|"));
  return tableRows.flatMap((row) => [...row.matchAll(/`([a-z]+\/[a-z0-9.+-]+)`/g)].map((m) => m[1]!)).sort();
}

describe("README supported file types", () => {
  it("lists exactly the MIME types the production extractor registry handles", () => {
    const driveClient = {} as DriveClient;
    const registry = createExtractorRegistry(defaultExtractors({ driveClient, pdfParser: { parse: vi.fn() } }));

    expect(readmeMimeTypes()).toEqual(registry.mimeTypes());
  });
});
