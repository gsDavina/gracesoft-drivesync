import { google } from "googleapis";
import { loadEnv } from "../config/env.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

export type FolderAccessResult =
  | { accessible: true }
  | { accessible: false; reason: "not-found-or-not-shared" | "not-a-folder" };

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  /** ISO 8601, as returned by the Drive API. */
  modifiedTime: string;
  /**
   * Size in bytes as reported by Drive. Absent for Google-native files
   * (Docs/Sheets/Slides have no stored binary), which skip the
   * `MAX_EXTRACT_BYTES` pre-download check.
   */
  size?: number;
  /**
   * Slash-separated location relative to the connected folder, ending in the
   * file name (`"a.pdf"` at the top level, `"Reports/2026/b.pdf"` nested).
   * Informational only — vectors stay flat, keyed by `fileId`.
   */
  path?: string;
}

/** One raw child of a Drive folder, before folders are split from files. */
export type DriveChildEntry = Omit<DriveFileMeta, "path">;

/**
 * Walks the connected folder and every folder beneath it (breadth-first),
 * returning one flat list of the files found anywhere in the tree.
 *
 * - Each folder is visited at most once, so a folder reachable by more than
 *   one route (Drive allows multiple parents) can't loop or double-list.
 * - A file reachable by more than one route is listed once (first path
 *   wins): vector IDs are keyed by `fileId`, so a duplicate would just
 *   re-embed the same content twice in one run.
 * - Shortcuts aren't folders by mimeType, so they're never followed.
 */
export async function walkFolderTree(
  rootFolderId: string,
  listChildren: (folderId: string) => Promise<DriveChildEntry[]>,
): Promise<DriveFileMeta[]> {
  const files: DriveFileMeta[] = [];
  const seenFileIds = new Set<string>();
  const visitedFolders = new Set<string>([rootFolderId]);
  const queue: Array<{ folderId: string; prefix: string }> = [{ folderId: rootFolderId, prefix: "" }];

  while (queue.length > 0) {
    const { folderId, prefix } = queue.shift()!;
    for (const child of await listChildren(folderId)) {
      if (child.mimeType === FOLDER_MIME_TYPE) {
        if (visitedFolders.has(child.id)) continue;
        visitedFolders.add(child.id);
        queue.push({ folderId: child.id, prefix: `${prefix}${child.name}/` });
        continue;
      }
      if (seenFileIds.has(child.id)) continue;
      seenFileIds.add(child.id);
      files.push({ ...child, path: `${prefix}${child.name}` });
    }
  }

  return files;
}

export interface DriveClient {
  verifyFolderAccess(folderId: string): Promise<FolderAccessResult>;
  /**
   * Every file in the folder *and all of its subfolders*, flattened into one
   * list (see `walkFolderTree`). Trashed items are excluded; folders
   * themselves are traversed, never returned (only actual files are sync
   * candidates).
   */
  listFiles(folderId: string): Promise<DriveFileMeta[]>;
  /** Google-native files (Docs/Sheets/Slides) only — export as another format. */
  exportAsText(fileId: string, exportMimeType: string): Promise<string>;
  /**
   * Google-native files only — export to a *binary* format (e.g. a Google
   * Sheet as xlsx). `exportAsText` would mangle binary bytes by decoding
   * them as text.
   */
  exportFile(fileId: string, exportMimeType: string): Promise<Buffer>;
  /** Raw file bytes (PDFs and other non-Google-native files). */
  downloadFile(fileId: string): Promise<Buffer>;
}

function statusCodeOf(err: unknown): number | undefined {
  const candidate = err as { code?: number | string; response?: { status?: number } };
  if (typeof candidate?.response?.status === "number") return candidate.response.status;
  if (typeof candidate?.code === "number") return candidate.code;
  return undefined;
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (typeof status === "number" && status >= 500);
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A carried-forward gap from v1: Drive API 429s/5xxs had no retry at all,
 * so a transient rate-limit response counted as a permanent sync failure
 * for that run instead of resolving itself. Non-retryable errors (404/403,
 * which `verifyFolderAccess` classifies itself) pass straight through on
 * the first attempt.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  sleepFn: (ms: number) => Promise<void>,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isRetryableStatus(statusCodeOf(err))) throw err;
      await sleepFn(backoffMs(attempt));
    }
  }
}

export interface GoogleDriveClientOptions {
  maxRetries?: number;
  /** Test-only hook to avoid real timers in retry/backoff tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

export function createGoogleDriveClient(options: GoogleDriveClientOptions = {}): DriveClient {
  const env = loadEnv();
  const maxRetries = options.maxRetries ?? 3;
  const sleepFn = options.sleepFn ?? sleep;
  const retrying = <T>(fn: () => Promise<T>): Promise<T> => withRetry(fn, maxRetries, sleepFn);

  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    // The env var stores the private key with literal "\n" sequences (see
    // .env.example) since real newlines don't survive most .env formats.
    key: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const drive = google.drive({ version: "v3", auth });

  return {
    async verifyFolderAccess(folderId: string): Promise<FolderAccessResult> {
      try {
        const res = await retrying(() =>
          drive.files.get({
            fileId: folderId,
            fields: "id,mimeType",
            supportsAllDrives: true,
          }),
        );

        if (res.data.mimeType !== FOLDER_MIME_TYPE) {
          return { accessible: false, reason: "not-a-folder" };
        }

        return { accessible: true };
      } catch (err) {
        const status = statusCodeOf(err);
        // 404: doesn't exist, or exists but isn't shared with the service
        // account (Drive returns 404, not 403, for the latter — the API
        // won't confirm a folder's existence to a caller without access).
        if (status === 404 || status === 403) {
          return { accessible: false, reason: "not-found-or-not-shared" };
        }
        throw err;
      }
    },

    async listFiles(folderId: string): Promise<DriveFileMeta[]> {
      return walkFolderTree(folderId, async (parentId) => {
        const children: DriveChildEntry[] = [];
        let pageToken: string | undefined;

        do {
          const res = await retrying(() =>
            drive.files.list({
              // Folders are included here (unlike the old single-level
              // listing) so walkFolderTree can descend into them.
              q: `'${parentId}' in parents and trashed = false`,
              fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size)",
              pageSize: 1000,
              pageToken,
              supportsAllDrives: true,
              includeItemsFromAllDrives: true,
            }),
          );

          for (const file of res.data.files ?? []) {
            if (!file.id || !file.name || !file.mimeType || !file.modifiedTime) continue;
            const size = file.size != null ? Number(file.size) : undefined;
            children.push({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              modifiedTime: file.modifiedTime,
              ...(size !== undefined && Number.isFinite(size) ? { size } : {}),
            });
          }

          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);

        return children;
      });
    },

    async exportAsText(fileId: string, exportMimeType: string): Promise<string> {
      const res = await retrying(() =>
        drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "text" }),
      );
      return res.data as unknown as string;
    },

    async exportFile(fileId: string, exportMimeType: string): Promise<Buffer> {
      const res = await retrying(() =>
        drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "arraybuffer" }),
      );
      return Buffer.from(res.data as unknown as ArrayBuffer);
    },

    async downloadFile(fileId: string): Promise<Buffer> {
      const res = await retrying(() =>
        drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }),
      );
      return Buffer.from(res.data as ArrayBuffer);
    },
  };
}
