import { chunkText } from "../chunking/chunkText.js";
import type { ChunkOptions, Tokenizer } from "../chunking/chunkText.js";
import { computeContentHash, hasContentChanged } from "../dedup/contentHash.js";
import { buildVectorId, computeStaleVectorIds } from "../dedup/vectorIds.js";
import type { DriveClient, DriveFileMeta } from "../drive/driveClient.js";
import type { EmbeddingProvider } from "../embeddings/embeddingProvider.js";
import { logger } from "../lib/logger.js";
import { isPermanentFailure } from "../extraction/textExtractor.js";
import type { TextExtractor } from "../extraction/textExtractor.js";
import { detectChanges } from "./changeDetection.js";
import type { FileRecord, FileRepository } from "./fileRepository.js";
import type { VectorStore } from "../vectorstore/vectorStore.js";

export interface FolderSyncSummary {
  added: number;
  updated: number;
  deleted: number;
  skippedUnchanged: number;
  /** Transient failures (thrown errors, timeouts): retried on every run, as before v2.1. */
  failedFiles: Array<{ fileId: string; reason: string }>;
  /**
   * v2.1 (M27): files newly recorded as `SKIPPED` this run for a permanent
   * reason. A file appears here once, not on every run.
   */
  skippedFiles: Array<{ fileId: string; reason: string }>;
}

export interface FolderSyncDeps {
  driveClient: DriveClient;
  fileRepository: FileRepository;
  textExtractor: TextExtractor;
  tokenizer: Tokenizer;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  chunkOptions: ChunkOptions;
}

export interface FolderSyncer {
  /**
   * Syncs one connected folder: lists its current Drive contents, diffs
   * against what was previously synced (M4), extracts/chunks/embeds/upserts
   * anything new or changed (M5-M8), skips re-embedding unchanged content
   * (M10), cleans up vectors for deleted files and files that now chunk
   * into fewer pieces (M10), and records the new state (M11).
   *
   * Files that can't be extracted for a permanent reason are recorded as
   * `SKIPPED` (M27) and left alone until they change in Drive or the
   * extractor's `capabilityVersion` changes.
   *
   * The vector store namespace is the account ID — per-account isolation
   * (M8's whole reason for namespace-scoping every operation).
   */
  syncFolder(accountId: string, driveFolder: { id: string; folderId: string }): Promise<FolderSyncSummary>;
}

export function createFolderSyncer(deps: FolderSyncDeps): FolderSyncer {
  const capabilityVersion = deps.textExtractor.capabilityVersion;

  return {
    async syncFolder(accountId, driveFolder) {
      const [currentFiles, previousFiles] = await Promise.all([
        deps.driveClient.listFiles(driveFolder.folderId),
        deps.fileRepository.listForFolder(driveFolder.id),
      ]);

      const previousByFileId = new Map(previousFiles.map((f) => [f.fileId, f]));
      const changes = detectChanges(
        previousFiles.map((f) => ({ id: f.fileId, modifiedTime: f.modifiedTime })),
        currentFiles,
      );

      // An unchanged file skipped by an older build gets one more attempt
      // when this build's extraction capability differs (a new type, a
      // parser fix), so it's picked up without anyone touching it in Drive.
      const changedIds = new Set([...changes.added, ...changes.updated].map((f) => f.id));
      const skippedToRetry = currentFiles.filter((file) => {
        const previous = previousByFileId.get(file.id);
        return (
          previous?.status === "SKIPPED" &&
          !changedIds.has(file.id) &&
          previous.skipCapabilityVersion !== capabilityVersion
        );
      });

      const summary: FolderSyncSummary = {
        added: 0,
        updated: 0,
        deleted: 0,
        skippedUnchanged: 0,
        failedFiles: [],
        skippedFiles: [],
      };

      for (const file of [...changes.added, ...changes.updated, ...skippedToRetry]) {
        const previous = previousByFileId.get(file.id);
        const logContext = {
          accountId,
          driveFolderId: driveFolder.id,
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
        };
        try {
          const extraction = await deps.textExtractor.extractText(file);
          if (!extraction.ok) {
            if (isPermanentFailure(extraction.reason)) {
              await recordSkipped(accountId, driveFolder.id, file, previous, extraction.reason);
              summary.skippedFiles.push({ fileId: file.id, reason: extraction.reason });
              logger.warn({ ...logContext, reason: extraction.reason }, "file skipped");
            } else {
              summary.failedFiles.push({ fileId: file.id, reason: extraction.reason });
              logger.warn({ ...logContext, reason: extraction.reason }, "file sync failed");
            }
            continue;
          }

          const contentHash = computeContentHash(extraction.text);

          if (previous && !hasContentChanged(previous.contentHash ?? undefined, contentHash)) {
            summary.skippedUnchanged++;
            await deps.fileRepository.upsertSynced({
              accountId,
              driveFolderId: driveFolder.id,
              fileId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              modifiedTime: file.modifiedTime,
              contentHash,
              chunkCount: previous.chunkCount,
            });
            logger.debug(logContext, "file unchanged, skipped");
            continue;
          }

          const chunks = chunkText(extraction.text, deps.tokenizer, deps.chunkOptions);
          const vectors = chunks.length > 0 ? await deps.embeddingProvider.embed(chunks.map((c) => c.text)) : [];

          if (chunks.length > 0) {
            await deps.vectorStore.upsert(
              accountId,
              chunks.map((chunk, i) => ({
                id: buildVectorId(file.id, chunk.index),
                values: vectors[i]!,
                metadata: {
                  fileId: file.id,
                  name: file.name,
                  // v2.1 (M28): lets retrieval/MCP clients filter or label by type.
                  mimeType: file.mimeType,
                  ...(file.path !== undefined ? { path: file.path } : {}),
                  text: chunk.text,
                  ...(chunk.section !== undefined ? { section: chunk.section } : {}),
                },
              })),
            );
          }

          if (previous) {
            const staleIds = computeStaleVectorIds(file.id, previous.chunkCount, chunks.length);
            if (staleIds.length > 0) await deps.vectorStore.delete(accountId, staleIds);
          }

          await deps.fileRepository.upsertSynced({
            accountId,
            driveFolderId: driveFolder.id,
            fileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            contentHash,
            chunkCount: chunks.length,
          });

          // A file that was only ever skipped had nothing indexed: syncing
          // it now is an add, not an update.
          const wasIndexed = previous !== undefined && previous.status !== "SKIPPED";
          if (wasIndexed) summary.updated++;
          else summary.added++;
          logger.info({ ...logContext, chunkCount: chunks.length }, wasIndexed ? "file updated" : "file added");
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          summary.failedFiles.push({ fileId: file.id, reason });
          logger.warn({ ...logContext, reason }, "file sync failed");
        }
      }

      for (const deletedFileId of changes.deleted) {
        try {
          const previous = previousByFileId.get(deletedFileId);
          if (previous && previous.chunkCount > 0) {
            const staleIds = computeStaleVectorIds(deletedFileId, previous.chunkCount, 0);
            await deps.vectorStore.delete(accountId, staleIds);
          }
          await deps.fileRepository.deleteByFileIds(driveFolder.id, [deletedFileId]);
          summary.deleted++;
          logger.info({ accountId, driveFolderId: driveFolder.id, fileId: deletedFileId }, "file deleted");
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          summary.failedFiles.push({ fileId: deletedFileId, reason });
          logger.warn({ accountId, driveFolderId: driveFolder.id, fileId: deletedFileId, reason }, "file delete failed");
        }
      }

      return summary;
    },
  };

  /**
   * A file that was indexed before and now can't be extracted (e.g. it grew
   * past MAX_EXTRACT_BYTES, or was password-protected after the fact) has
   * its old vectors removed: they no longer reflect the file's content.
   */
  async function recordSkipped(
    accountId: string,
    driveFolderId: string,
    file: DriveFileMeta,
    previous: FileRecord | undefined,
    reason: string,
  ): Promise<void> {
    if (previous && previous.chunkCount > 0) {
      await deps.vectorStore.delete(accountId, computeStaleVectorIds(file.id, previous.chunkCount, 0));
    }
    await deps.fileRepository.upsertSkipped({
      accountId,
      driveFolderId,
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      reason,
      capabilityVersion,
    });
  }
}
