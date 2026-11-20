# M27 — Skipped-file state

Status: **Done** (migration not yet applied to a real database)

## What was built

- **Migration** `prisma/migrations/20261121000000_add_drive_file_skip_status`: enum `DriveFileStatus` (`SYNCED`, `SKIPPED`), and on `drive_files` the columns `status` (`NOT NULL DEFAULT 'SYNCED'`), `skipReason`, `skipCapabilityVersion`. Additive; existing rows become `SYNCED`. Generated with `prisma migrate diff` from the previous schema to the new one (no database needed), so it matches Prisma's own output.
- `FileRepository.upsertSkipped(...)` — records `SKIPPED` with the file's `modifiedTime`, the reason and the extractor's `capabilityVersion`; clears `contentHash` and sets `chunkCount` to 0. `upsertSynced` now also resets `status`/`skipReason`/`skipCapabilityVersion`.
- `TextExtractor.capabilityVersion` — `"<EXTRACTION_REVISION>-<sha256 of the sorted registered MIME types, 12 hex>"`.
- `src/sync/syncFolder.ts`:
  - permanent failure (`isPermanentFailure(reason)`) → `upsertSkipped`, `summary.skippedFiles`, one `file skipped` warn log with `fileName`, `mimeType` and `reason`;
  - transient failure (`extraction-timeout`, or any thrown error) → `summary.failedFiles` and `file sync failed`, no row written, retried next run (unchanged behaviour);
  - an unchanged `SKIPPED` file whose `skipCapabilityVersion` differs from the running build's is retried once (alongside added/updated files);
  - a previously indexed file that becomes unextractable has its old vectors deleted before it's recorded as skipped;
  - a file that was only ever skipped and now syncs counts as `added`, not `updated`;
  - every per-file log line now carries `mimeType`.
- `FolderSyncSummary.skippedFiles` (new); `syncAllFolders` logs `skippedFileCount` per folder; the worker's run summary logs `newlySkippedFileCount`.
- `/status` per folder: `skippedCount`, `skippedByReason`. `/audit`: `totalSkipped`, `skippedByReason`, and the same two per folder. `fileCount` / `totalFiles` / `totalChunks` keep counting synced files only.

## Decisions

- **Which reasons are permanent:** every specific fail-closed reason except `extraction-timeout`: the checklist's four (`unsupported-mime-type`, `file-too-large`, `password-protected`, `scanned-pdf-ocr-not-implemented`) plus `archive-too-large`, `corrupt-file` and `unsupported-encoding`. All seven fail identically on the same bytes, so retrying them every 15 minutes is pure noise. The risk with `corrupt-file` (a parser bug misclassifying a good file) is covered by the next decision.
- **Skipped → supported mechanism: a capability version, not a reason-specific rule.** The checklist suggested re-evaluating `unsupported-mime-type` rows when the registry gains that type. Storing a capability version on every skipped row generalises that: adding a MIME type changes the hash automatically, and a parser fix is one `EXTRACTION_REVISION` bump. Either way every skipped file gets exactly one more attempt after the deploy, then is skipped again (once) if it still fails. Cost: after such a deploy, the first sync re-downloads every skipped file once (unsupported types still return before downloading).
- **An indexed file that becomes unextractable loses its vectors.** Before v2.1, its stale vectors stayed searchable forever while the file failed every run. Now the index matches what the file is.
- **`fileCount` stays "synced files".** Changing it to include skipped files would silently change the meaning of an existing field; skipped counts are separate, additive fields.
- **The `FileRecord` interface lists the new fields as required**, matching what Prisma returns after the migration (the column is `NOT NULL`).

## Verified locally

- `src/sync/syncFolder.test.ts` (new block, 8 tests): permanent failure recorded as `SKIPPED` with `modifiedTime`/reason/version; an unchanged skipped file isn't re-extracted or re-reported on the next run; a changed `modifiedTime` retries it (and counts as added); a different capability version retries an unchanged one; a timeout is never marked skipped and is retried every run; an indexed file that becomes too large has its vectors deleted; a skipped file deleted from Drive loses its row.
- `src/observability/observabilityService.test.ts`: skipped counts grouped by reason, per folder and in `/audit` totals, without inflating `fileCount`/`totalFiles`.
- `npx prisma migrate diff` output reviewed; `npx prisma generate` succeeds.

## Explicitly not covered by this pass

- **Applying the migration to a real Postgres** (fresh, and on a copy of a populated v2 database). No local Postgres or Docker is available in this session; CI runs `prisma migrate deploy` against a fresh database on push, which covers the fresh case. The populated-copy check is a staging step.

## Next

M28 — `mimeType` in vector metadata.
