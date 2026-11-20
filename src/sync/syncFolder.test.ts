import { beforeEach, describe, expect, it } from "vitest";
import type { Tokenizer } from "../chunking/chunkText.js";
import { computeContentHash } from "../dedup/contentHash.js";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import type { ExtractionResult, TextExtractor } from "../extraction/textExtractor.js";
import type { VectorRecord, VectorStore } from "../vectorstore/vectorStore.js";
import type { FileRecord, FileRepository } from "./fileRepository.js";
import { createFolderSyncer } from "./syncFolder.js";

const ACCOUNT_ID = "acct_1";
const DRIVE_FOLDER = { id: "folder_row_1", folderId: "drive-folder-abc" };

function file(overrides: Partial<DriveFileMeta> = {}): DriveFileMeta {
  return {
    id: "file-1",
    name: "doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fileRecord(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "row_1",
    accountId: ACCOUNT_ID,
    driveFolderId: DRIVE_FOLDER.id,
    fileId: "file-1",
    name: "doc",
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: "2026-01-01T00:00:00.000Z",
    contentHash: null,
    chunkCount: 0,
    lastSyncedAt: new Date(),
    status: "SYNCED",
    skipReason: null,
    skipCapabilityVersion: null,
    ...overrides,
  };
}

// Word-level fake tokenizer — deterministic and easy to reason about chunk
// counts with, same approach as chunkText.test.ts.
function makeWordTokenizer(): Tokenizer {
  const vocab: string[] = [];
  const lookup = new Map<string, number>();
  return {
    encode: (text) =>
      text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => {
          let id = lookup.get(word);
          if (id === undefined) {
            id = vocab.length;
            vocab.push(word);
            lookup.set(word, id);
          }
          return id;
        }),
    decode: (tokens) => tokens.map((id) => vocab[id]).join(" "),
  };
}

function makeFakeFileRepository(seed: FileRecord[] = []): FileRepository {
  const rows = new Map(seed.map((r) => [`${r.driveFolderId}:${r.fileId}`, r]));
  return {
    async listForFolder(driveFolderId) {
      return [...rows.values()].filter((r) => r.driveFolderId === driveFolderId);
    },
    async upsertSynced(params) {
      const key = `${params.driveFolderId}:${params.fileId}`;
      const record: FileRecord = { ...fileRecord(), ...params, id: rows.get(key)?.id ?? `row_${rows.size + 1}`, lastSyncedAt: new Date() };
      rows.set(key, record);
      return record;
    },
    async upsertSkipped(params) {
      const key = `${params.driveFolderId}:${params.fileId}`;
      const { reason, capabilityVersion, ...rest } = params;
      const record: FileRecord = {
        ...fileRecord(),
        ...rest,
        id: rows.get(key)?.id ?? `row_${rows.size + 1}`,
        contentHash: null,
        chunkCount: 0,
        status: "SKIPPED",
        skipReason: reason,
        skipCapabilityVersion: capabilityVersion,
        lastSyncedAt: new Date(),
      };
      rows.set(key, record);
      return record;
    },
    async deleteByFileIds(driveFolderId, fileIds) {
      for (const fileId of fileIds) rows.delete(`${driveFolderId}:${fileId}`);
    },
    async findByFileId(accountId, fileId) {
      return [...rows.values()].find((r) => r.accountId === accountId && r.fileId === fileId) ?? null;
    },
    async listForAccount(accountId) {
      return [...rows.values()].filter((r) => r.accountId === accountId);
    },
  };
}

function makeFakeVectorStore(): VectorStore & { upserted: Array<{ namespace: string; records: VectorRecord[] }>; deleted: Array<{ namespace: string; ids: string[] }> } {
  const upserted: Array<{ namespace: string; records: VectorRecord[] }> = [];
  const deleted: Array<{ namespace: string; ids: string[] }> = [];
  return {
    upserted,
    deleted,
    async upsert(namespace, records) {
      upserted.push({ namespace, records });
    },
    async query() {
      return [];
    },
    async delete(namespace, ids) {
      deleted.push({ namespace, ids });
    },
    async fetch() {
      return [];
    },
    async getDimension() {
      return undefined;
    },
  };
}

function makeFakeEmbeddingProvider(): EmbeddingProvider {
  return {
    dimensions: 3,
    embed: async (texts) => texts.map(() => [1, 0, 0]),
  };
}

function makeFakeDriveClient(files: DriveFileMeta[]): DriveClient {
  return {
    verifyFolderAccess: async () => ({ accessible: true }),
    listFiles: async () => files,
    exportAsText: async () => "",
    exportFile: async () => Buffer.from(""),
    downloadFile: async () => Buffer.from(""),
  };
}

function makeFakeTextExtractor(
  resultsByFileId: Record<string, ExtractionResult>,
  capabilityVersion = "test-v1",
): TextExtractor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    extractText: async (file) => {
      calls.push(file.id);
      return resultsByFileId[file.id] ?? { ok: false, reason: "unsupported-mime-type" };
    },
    capabilityVersion,
  };
}

describe("createFolderSyncer", () => {
  const chunkOptions = { maxTokens: 3, overlapTokens: 1 };
  let tokenizer: Tokenizer;

  beforeEach(() => {
    tokenizer = makeWordTokenizer();
  });

  it("embeds and upserts a brand-new file, recording it as added", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1" })]);
    const fileRepository = makeFakeFileRepository([]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "one two three four five six" } });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary).toEqual({ added: 1, updated: 0, deleted: 0, skippedUnchanged: 0, failedFiles: [], skippedFiles: [] });
    expect(vectorStore.upserted).toHaveLength(1);
    expect(vectorStore.upserted[0]?.namespace).toBe(ACCOUNT_ID);
    expect(vectorStore.upserted[0]?.records.map((r) => r.id)).toEqual(
      vectorStore.upserted[0]?.records.map((_, i) => `file-1-${i}`),
    );

    const stored = await fileRepository.listForFolder(DRIVE_FOLDER.id);
    expect(stored[0]?.chunkCount).toBe(vectorStore.upserted[0]?.records.length);
  });

  it("writes files from subfolders as flat vectors, carrying the subfolder path in metadata", async () => {
    const driveClient = makeFakeDriveClient([
      file({ id: "top", name: "top.txt", path: "top.txt" }),
      file({ id: "nested", name: "deep.txt", path: "Reports/2026/deep.txt" }),
    ]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({
      top: { ok: true, text: "alpha beta" },
      nested: { ok: true, text: "gamma delta" },
    });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository: makeFakeFileRepository([]),
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.added).toBe(2);
    const records = vectorStore.upserted.flatMap((u) => u.records);
    // Same namespace, same `{fileId}-{chunkIndex}` IDs regardless of depth.
    expect(vectorStore.upserted.every((u) => u.namespace === ACCOUNT_ID)).toBe(true);
    expect(records.map((r) => r.id)).toEqual(["top-0", "nested-0"]);
    expect(records.map((r) => r.metadata?.path)).toEqual(["top.txt", "Reports/2026/deep.txt"]);
  });

  it("deletes vectors for a file that left the folder tree (e.g. its subfolder was removed)", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "top", path: "top.txt" })]);
    const fileRepository = makeFakeFileRepository([
      fileRecord({ id: "row_1", fileId: "top", contentHash: computeContentHash("kept"), chunkCount: 1 }),
      fileRecord({ id: "row_2", fileId: "was-nested", chunkCount: 2 }),
    ]);
    const vectorStore = makeFakeVectorStore();

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor: makeFakeTextExtractor({}),
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.deleted).toBe(1);
    expect(vectorStore.deleted).toEqual([{ namespace: ACCOUNT_ID, ids: ["was-nested-0", "was-nested-1"] }]);
    expect((await fileRepository.listForFolder(DRIVE_FOLDER.id)).map((r) => r.fileId)).toEqual(["top"]);
  });

  it("skips re-embedding when the content hash is unchanged, but still updates modifiedTime", async () => {
    const unchangedText = "same content every time";
    const contentHash = computeContentHash(unchangedText);

    const driveClient = makeFakeDriveClient([file({ id: "file-1", modifiedTime: "2026-02-01T00:00:00.000Z" })]);
    const fileRepository = makeFakeFileRepository([
      fileRecord({ fileId: "file-1", modifiedTime: "2026-01-01T00:00:00.000Z", contentHash, chunkCount: 1 }),
    ]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: unchangedText } });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary).toEqual({ added: 0, updated: 0, deleted: 0, skippedUnchanged: 1, failedFiles: [], skippedFiles: [] });
    expect(vectorStore.upserted).toEqual([]);

    const stored = await fileRepository.listForFolder(DRIVE_FOLDER.id);
    expect(stored[0]?.modifiedTime).toBe("2026-02-01T00:00:00.000Z");
  });

  it("re-embeds when content actually changed, records it as updated, and cleans up shrunk chunk counts", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1", modifiedTime: "2026-02-01T00:00:00.000Z" })]);
    const fileRepository = makeFakeFileRepository([
      fileRecord({ fileId: "file-1", modifiedTime: "2026-01-01T00:00:00.000Z", contentHash: "old-hash", chunkCount: 5 }),
    ]);
    const vectorStore = makeFakeVectorStore();
    // 4 words / maxTokens=3, overlap=1 -> chunks at [0-3) and [2-4): 2 chunks, fewer than the previous 5.
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "one two three four" } });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(0);
    const newChunkCount = vectorStore.upserted[0]?.records.length ?? 0;
    expect(newChunkCount).toBeLessThan(5);

    expect(vectorStore.deleted).toHaveLength(1);
    expect(vectorStore.deleted[0]?.namespace).toBe(ACCOUNT_ID);
    expect(vectorStore.deleted[0]?.ids).toEqual(
      Array.from({ length: 5 - newChunkCount }, (_, i) => `file-1-${newChunkCount + i}`),
    );
  });

  it("deletes vectors and the file record for a file removed from Drive", async () => {
    const driveClient = makeFakeDriveClient([]); // file-1 no longer present
    const fileRepository = makeFakeFileRepository([fileRecord({ fileId: "file-1", chunkCount: 3 })]);
    const vectorStore = makeFakeVectorStore();

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor: makeFakeTextExtractor({}),
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary).toEqual({ added: 0, updated: 0, deleted: 1, skippedUnchanged: 0, failedFiles: [], skippedFiles: [] });
    expect(vectorStore.deleted).toEqual([{ namespace: ACCOUNT_ID, ids: ["file-1-0", "file-1-1", "file-1-2"] }]);
    expect(await fileRepository.listForFolder(DRIVE_FOLDER.id)).toEqual([]);
  });

  it("records an extraction failure without throwing, and continues syncing other files", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1" }), file({ id: "file-2", name: "other" })]);
    const fileRepository = makeFakeFileRepository([]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({
      "file-1": { ok: false, reason: "scanned-pdf-ocr-not-implemented" },
      "file-2": { ok: true, text: "one two three" },
    });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.added).toBe(1);
    // v2.1 (M27): a permanent reason is a skip, not a failure.
    expect(summary.skippedFiles).toEqual([{ fileId: "file-1", reason: "scanned-pdf-ocr-not-implemented" }]);
    expect(summary.failedFiles).toEqual([]);
  });

  it("records an unexpected error without throwing, and continues syncing other files", async () => {
    const driveClient = makeFakeDriveClient([file({ id: "file-1" }), file({ id: "file-2", name: "other" })]);
    const fileRepository = makeFakeFileRepository([]);
    const vectorStore: VectorStore = {
      upsert: async () => {
        throw new Error("vector store is down");
      },
      query: async () => [],
      delete: async () => {},
      fetch: async () => [],
      getDimension: async () => undefined,
    };
    const textExtractor = makeFakeTextExtractor({
      "file-1": { ok: true, text: "one two three" },
      "file-2": { ok: true, text: "four five six" },
    });

    const syncer = createFolderSyncer({
      driveClient,
      fileRepository,
      textExtractor,
      tokenizer,
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });

    const summary = await syncer.syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.added).toBe(0);
    expect(summary.failedFiles).toHaveLength(2);
    expect(summary.failedFiles.every((f) => f.reason === "vector store is down")).toBe(true);
  });
});

describe("skipped-file state (M27) and mimeType metadata (M28)", () => {
  const chunkOptions = { maxTokens: 3, overlapTokens: 1 };

  function syncerWith(
    files: DriveFileMeta[],
    fileRepository: FileRepository,
    textExtractor: TextExtractor,
    vectorStore = makeFakeVectorStore(),
  ) {
    return createFolderSyncer({
      driveClient: makeFakeDriveClient(files),
      fileRepository,
      textExtractor,
      tokenizer: makeWordTokenizer(),
      embeddingProvider: makeFakeEmbeddingProvider(),
      vectorStore,
      chunkOptions,
    });
  }

  it("records a permanent failure as SKIPPED with its modifiedTime and reason", async () => {
    const fileRepository = makeFakeFileRepository([]);
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: false, reason: "password-protected" } });

    await syncerWith([file({ modifiedTime: "t1" })], fileRepository, textExtractor).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    const [row] = await fileRepository.listForFolder(DRIVE_FOLDER.id);
    expect(row).toMatchObject({
      status: "SKIPPED",
      skipReason: "password-protected",
      skipCapabilityVersion: "test-v1",
      modifiedTime: "t1",
      chunkCount: 0,
    });
  });

  it("doesn't re-extract or re-report an unchanged SKIPPED file on the next run", async () => {
    const fileRepository = makeFakeFileRepository([]);
    const textExtractor = makeFakeTextExtractor({});
    const files = [file({ mimeType: "video/mp4", modifiedTime: "t1" })];

    const first = await syncerWith(files, fileRepository, textExtractor).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);
    const second = await syncerWith(files, fileRepository, textExtractor).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(first.skippedFiles).toEqual([{ fileId: "file-1", reason: "unsupported-mime-type" }]);
    expect(second).toEqual({ added: 0, updated: 0, deleted: 0, skippedUnchanged: 0, failedFiles: [], skippedFiles: [] });
    expect(textExtractor.calls).toEqual(["file-1"]);
  });

  it("retries a SKIPPED file once its modifiedTime changes", async () => {
    const fileRepository = makeFakeFileRepository([
      fileRecord({ status: "SKIPPED", skipReason: "file-too-large", skipCapabilityVersion: "test-v1", modifiedTime: "t1" }),
    ]);
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "one two" } });

    const summary = await syncerWith([file({ modifiedTime: "t2" })], fileRepository, textExtractor).syncFolder(
      ACCOUNT_ID,
      DRIVE_FOLDER,
    );

    expect(summary.added).toBe(1); // nothing was indexed before, so it's an add
    expect((await fileRepository.listForFolder(DRIVE_FOLDER.id))[0]).toMatchObject({ status: "SYNCED", skipReason: null });
  });

  it("re-evaluates an unchanged SKIPPED file after a deploy changes the extraction capability", async () => {
    const fileRepository = makeFakeFileRepository([
      fileRecord({ status: "SKIPPED", skipReason: "unsupported-mime-type", skipCapabilityVersion: "old-build", modifiedTime: "t1" }),
    ]);
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "now supported" } }, "new-build");

    const summary = await syncerWith([file({ modifiedTime: "t1" })], fileRepository, textExtractor).syncFolder(
      ACCOUNT_ID,
      DRIVE_FOLDER,
    );

    expect(textExtractor.calls).toEqual(["file-1"]);
    expect(summary.added).toBe(1);
  });

  it("never marks a transient failure SKIPPED, and retries it every run", async () => {
    const fileRepository = makeFakeFileRepository([]);
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: false, reason: "extraction-timeout" } });
    const files = [file({ modifiedTime: "t1" })];

    const first = await syncerWith(files, fileRepository, textExtractor).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);
    await syncerWith(files, fileRepository, textExtractor).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(first.failedFiles).toEqual([{ fileId: "file-1", reason: "extraction-timeout" }]);
    expect(first.skippedFiles).toEqual([]);
    expect(await fileRepository.listForFolder(DRIVE_FOLDER.id)).toEqual([]);
    expect(textExtractor.calls).toEqual(["file-1", "file-1"]);
  });

  it("removes an indexed file's old vectors when an edit makes it unextractable", async () => {
    const fileRepository = makeFakeFileRepository([fileRecord({ chunkCount: 2, contentHash: "h", modifiedTime: "t1" })]);
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: false, reason: "file-too-large" } });

    await syncerWith([file({ modifiedTime: "t2" })], fileRepository, textExtractor, vectorStore).syncFolder(
      ACCOUNT_ID,
      DRIVE_FOLDER,
    );

    expect(vectorStore.deleted).toEqual([{ namespace: ACCOUNT_ID, ids: ["file-1-0", "file-1-1"] }]);
    expect((await fileRepository.listForFolder(DRIVE_FOLDER.id))[0]).toMatchObject({ status: "SKIPPED", chunkCount: 0 });
  });

  it("deletes the tracking row of a SKIPPED file removed from Drive", async () => {
    const fileRepository = makeFakeFileRepository([fileRecord({ status: "SKIPPED", skipReason: "corrupt-file" })]);

    const summary = await syncerWith([], fileRepository, makeFakeTextExtractor({})).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    expect(summary.deleted).toBe(1);
    expect(await fileRepository.listForFolder(DRIVE_FOLDER.id)).toEqual([]);
  });

  it("writes the file's mimeType into every upserted vector's metadata", async () => {
    const vectorStore = makeFakeVectorStore();
    const textExtractor = makeFakeTextExtractor({ "file-1": { ok: true, text: "one two three four five" } });

    await syncerWith(
      [file({ mimeType: "application/pdf" })],
      makeFakeFileRepository([]),
      textExtractor,
      vectorStore,
    ).syncFolder(ACCOUNT_ID, DRIVE_FOLDER);

    const records = vectorStore.upserted.flatMap((u) => u.records);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.metadata?.mimeType === "application/pdf")).toBe(true);
  });
});
