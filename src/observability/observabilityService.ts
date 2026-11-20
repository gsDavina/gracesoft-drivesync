import type { FolderStatus, SyncStatus } from "@prisma/client";
import type { FolderRepository } from "../folders/folderRepository.js";
import type { FileRecord, FileRepository } from "../sync/fileRepository.js";

export interface FolderStatusEntry {
  driveFolderId: string;
  folderId: string;
  status: FolderStatus;
  lastSyncedAt: Date | null;
  lastSyncStatus: SyncStatus | null;
  lastSyncError: string | null;
  consecutiveFailures: number;
  /** Files currently synced in this folder — not "files touched in the last run" (that's ephemeral, only logged, not persisted; see M15 decisions). Skipped files aren't counted here. */
  fileCount: number;
  /** v2.1 (M27): files recorded as SKIPPED (permanently unextractable until they change). */
  skippedCount: number;
  /** v2.1 (M27): `skippedCount` broken down by reason, e.g. `{ "unsupported-mime-type": 12 }`. */
  skippedByReason: Record<string, number>;
}

export interface AuditFolderSummary {
  driveFolderId: string;
  folderId: string;
  fileCount: number;
  chunkCount: number;
  skippedCount: number;
  skippedByReason: Record<string, number>;
}

export interface AuditSummary {
  /** Synced files only, as before v2.1. */
  totalFiles: number;
  totalChunks: number;
  /** v2.1 (M27). */
  totalSkipped: number;
  skippedByReason: Record<string, number>;
  folders: AuditFolderSummary[];
}

interface FolderTally {
  fileCount: number;
  chunkCount: number;
  skippedCount: number;
  skippedByReason: Record<string, number>;
}

function emptyTally(): FolderTally {
  return { fileCount: 0, chunkCount: 0, skippedCount: 0, skippedByReason: {} };
}

function tallyByFolder(files: FileRecord[]): Map<string, FolderTally> {
  const byFolder = new Map<string, FolderTally>();
  for (const file of files) {
    const tally = byFolder.get(file.driveFolderId) ?? emptyTally();
    if (file.status === "SKIPPED") {
      const reason = file.skipReason ?? "unknown";
      tally.skippedCount += 1;
      tally.skippedByReason[reason] = (tally.skippedByReason[reason] ?? 0) + 1;
    } else {
      tally.fileCount += 1;
      tally.chunkCount += file.chunkCount;
    }
    byFolder.set(file.driveFolderId, tally);
  }
  return byFolder;
}

export interface ObservabilityService {
  /** Scoped strictly to the caller's own account — never another account's folders. */
  getStatus(accountId: string): Promise<FolderStatusEntry[]>;
  /** Full index state (total files/chunks), scoped strictly to the caller's own account. */
  getAudit(accountId: string): Promise<AuditSummary>;
}

export function createObservabilityService(deps: {
  folderRepository: FolderRepository;
  fileRepository: FileRepository;
}): ObservabilityService {
  return {
    async getStatus(accountId) {
      const [folders, files] = await Promise.all([
        deps.folderRepository.listForAccount(accountId),
        deps.fileRepository.listForAccount(accountId),
      ]);

      const byFolder = tallyByFolder(files);

      return folders.map((folder) => {
        const tally = byFolder.get(folder.id) ?? emptyTally();
        return {
        driveFolderId: folder.id,
        folderId: folder.folderId,
        status: folder.status,
        lastSyncedAt: folder.lastSyncedAt,
        lastSyncStatus: folder.lastSyncStatus,
        lastSyncError: folder.lastSyncError,
        consecutiveFailures: folder.consecutiveFailures,
        fileCount: tally.fileCount,
        skippedCount: tally.skippedCount,
        skippedByReason: tally.skippedByReason,
        };
      });
    },

    async getAudit(accountId) {
      const [folders, files] = await Promise.all([
        deps.folderRepository.listForAccount(accountId),
        deps.fileRepository.listForAccount(accountId),
      ]);

      const byFolder = tallyByFolder(files);
      const folderSummaries = folders.map((folder) => ({
        driveFolderId: folder.id,
        folderId: folder.folderId,
        ...(byFolder.get(folder.id) ?? emptyTally()),
      }));

      const skippedByReason: Record<string, number> = {};
      for (const tally of byFolder.values()) {
        for (const [reason, count] of Object.entries(tally.skippedByReason)) {
          skippedByReason[reason] = (skippedByReason[reason] ?? 0) + count;
        }
      }
      const tallies = [...byFolder.values()];

      return {
        totalFiles: tallies.reduce((sum, t) => sum + t.fileCount, 0),
        totalChunks: tallies.reduce((sum, t) => sum + t.chunkCount, 0),
        totalSkipped: tallies.reduce((sum, t) => sum + t.skippedCount, 0),
        skippedByReason,
        folders: folderSummaries,
      };
    },
  };
}
