import { unzipSync, zipSync } from "fflate";
import type { Unzipped } from "fflate";
import { ExtractionFailure } from "./types.js";
import type { ArchiveLimits } from "./types.js";

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Local-file header or (for an empty archive) end-of-central-directory record. */
export function isZip(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06))
  );
}

/**
 * OLE2 compound file (CFB): the container for legacy `.doc`/`.xls`/`.ppt`,
 * and also what Office wraps an *encrypted* docx/xlsx/pptx in, so a "docx"
 * that starts with these bytes is password-protected, not a zip.
 */
export function isOleCompoundFile(buffer: Uint8Array): boolean {
  return buffer.length >= OLE_MAGIC.length && OLE_MAGIC.every((byte, i) => buffer[i] === byte);
}

/**
 * Opens an OOXML/ODF container (all of which are zips) with zip-bomb
 * protection, returning only the entries `want` selects.
 *
 * - An encrypted OOXML file (OLE container) fails as `password-protected`;
 *   anything else that isn't a zip fails as `corrupt-file`.
 * - Every entry counts toward `maxEntries`, and every entry's *declared*
 *   uncompressed size counts toward `maxUncompressedBytes`, checked from the
 *   central directory before that entry is inflated, so an archive over
 *   either cap fails as `archive-too-large` without being decompressed.
 * - fflate inflates each entry into a buffer of exactly its declared size,
 *   so an entry that lies about its size (the classic bomb) can't expand
 *   past it: actual output is bounded by the declared total.
 */
export function readZip(buffer: Uint8Array, limits: ArchiveLimits, want: (name: string) => boolean): Unzipped {
  if (isOleCompoundFile(buffer)) throw new ExtractionFailure("password-protected", "OLE-wrapped (encrypted) package");
  if (!isZip(buffer)) throw new ExtractionFailure("corrupt-file", "not a zip archive");

  let entries = 0;
  let declaredTotal = 0;
  try {
    return unzipSync(buffer, {
      filter(entry) {
        entries += 1;
        declaredTotal += entry.originalSize;
        if (entries > limits.maxEntries) {
          throw new ExtractionFailure("archive-too-large", `more than ${limits.maxEntries} entries`);
        }
        if (declaredTotal > limits.maxUncompressedBytes) {
          throw new ExtractionFailure(
            "archive-too-large",
            `more than ${limits.maxUncompressedBytes} bytes uncompressed`,
          );
        }
        return want(entry.name);
      },
    });
  } catch (err) {
    if (err instanceof ExtractionFailure) throw err;
    throw new ExtractionFailure("corrupt-file", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Re-packs already-bounded entries into an uncompressed ("stored") zip, for
 * third-party parsers that open the zip themselves (mammoth, via JSZip).
 * Those parsers trust the archive's own sizes; handing them a stored copy of
 * entries `readZip` already inflated within the caps means they can't be
 * bombed either.
 */
export function repackStored(entries: Unzipped): Buffer {
  return Buffer.from(zipSync(entries, { level: 0 }));
}

const utf8 = new TextDecoder("utf-8");

export function entryText(entries: Unzipped, name: string): string | undefined {
  const bytes = entries[name];
  return bytes ? utf8.decode(bytes) : undefined;
}

export function requireEntryText(entries: Unzipped, name: string): string {
  const text = entryText(entries, name);
  if (text === undefined) throw new ExtractionFailure("corrupt-file", `missing ${name}`);
  return text;
}
