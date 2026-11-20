import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type FileStatus = "SYNCED" | "SKIPPED";

export interface FileRecord {
  id: string;
  accountId: string;
  driveFolderId: string;
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  contentHash: string | null;
  chunkCount: number;
  lastSyncedAt: Date;
  /** v2.1 (M27). Rows written before the migration default to `SYNCED`. */
  status: FileStatus;
  skipReason: string | null;
  skipCapabilityVersion: string | null;
}

export interface UpsertSyncedFileParams {
  accountId: string;
  driveFolderId: string;
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  contentHash: string;
  chunkCount: number;
}

export interface UpsertSkippedFileParams {
  accountId: string;
  driveFolderId: string;
  fileId: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  reason: string;
  capabilityVersion: string;
}

export interface FileRepository {
  /** Last-known state for every file previously synced (or skipped) under this folder — feeds M4's detectChanges. */
  listForFolder(driveFolderId: string): Promise<FileRecord[]>;
  upsertSynced(params: UpsertSyncedFileParams): Promise<FileRecord>;
  /**
   * M27: records a permanently-unextractable file so later runs leave it
   * alone until its `modifiedTime` (or the service's extraction capability)
   * changes. Clears any content hash/chunk count from an earlier successful
   * sync; the caller deletes that sync's vectors first.
   */
  upsertSkipped(params: UpsertSkippedFileParams): Promise<FileRecord>;
  /** Removes tracking rows for files no longer present (M4's `deleted` list). */
  deleteByFileIds(driveFolderId: string, fileIds: string[]): Promise<void>;
  /** Scoped to the account, regardless of which of its folders the file lives in — what M14's document fetch looks up chunkCount by. */
  findByFileId(accountId: string, fileId: string): Promise<FileRecord | null>;
  /** Every tracked file (synced and skipped) across every one of the account's folders — what M15's /status and /audit aggregate over. */
  listForAccount(accountId: string): Promise<FileRecord[]>;
}

export function createPrismaFileRepository(client: PrismaClient = prisma): FileRepository {
  return {
    async listForFolder(driveFolderId) {
      return client.driveFile.findMany({ where: { driveFolderId } });
    },

    async upsertSynced(params) {
      const synced = {
        name: params.name,
        mimeType: params.mimeType,
        modifiedTime: params.modifiedTime,
        contentHash: params.contentHash,
        chunkCount: params.chunkCount,
        lastSyncedAt: new Date(),
        status: "SYNCED" as const,
        skipReason: null,
        skipCapabilityVersion: null,
      };
      return client.driveFile.upsert({
        where: { driveFolderId_fileId: { driveFolderId: params.driveFolderId, fileId: params.fileId } },
        create: { accountId: params.accountId, driveFolderId: params.driveFolderId, fileId: params.fileId, ...synced },
        update: synced,
      });
    },

    async upsertSkipped(params) {
      const skipped = {
        name: params.name,
        mimeType: params.mimeType,
        modifiedTime: params.modifiedTime,
        contentHash: null,
        chunkCount: 0,
        lastSyncedAt: new Date(),
        status: "SKIPPED" as const,
        skipReason: params.reason,
        skipCapabilityVersion: params.capabilityVersion,
      };
      return client.driveFile.upsert({
        where: { driveFolderId_fileId: { driveFolderId: params.driveFolderId, fileId: params.fileId } },
        create: { accountId: params.accountId, driveFolderId: params.driveFolderId, fileId: params.fileId, ...skipped },
        update: skipped,
      });
    },

    async deleteByFileIds(driveFolderId, fileIds) {
      if (fileIds.length === 0) return;
      await client.driveFile.deleteMany({ where: { driveFolderId, fileId: { in: fileIds } } });
    },

    async findByFileId(accountId, fileId) {
      return client.driveFile.findFirst({ where: { accountId, fileId } });
    },

    async listForAccount(accountId) {
      return client.driveFile.findMany({ where: { accountId } });
    },
  };
}
