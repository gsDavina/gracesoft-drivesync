# API reference

All endpoints except `GET /health` require `Authorization: Bearer <api-key>`. A missing, malformed, unknown, or revoked key all return the identical `401 {"error": "unauthorized"}` — the response never signals *why* a key was rejected.

Base URL: `http://localhost:${PORT}` (default `3000`) for REST; `http://localhost:${MCP_SERVER_PORT}` (default `3001`) for MCP.

## REST

### `GET /health`

No auth required.

```json
{ "status": "ok" }
```

### `GET /me`

```json
{ "account": { "id": "acct_...", "name": "My Company" } }
```

### `POST /folders`

Connect a Drive folder. Verifies the shared service account can list it before persisting.

**Request**
```json
{ "folderId": "1AbCdEfGhIjKlMnOpQrStUvWxYz" }
```

**Responses**
- `201` — `{ "folder": { "id": "...", "folderId": "...", "status": "CONNECTED", "connectedAt": "...", "lastVerifiedAt": "..." } }`
- `400` — invalid/missing `folderId`
- `422` — `{ "error": "Folder not found or not accessible yet. Share it with <service-account-email> ..." }`, or a "that's a file, not a folder" message

### `GET /folders`

```json
{ "folders": [ { "id": "...", "folderId": "...", "status": "CONNECTED", "...": "..." } ] }
```

### `POST /folders/:id/verify`

Re-checks an already-connected folder's access.

- `200` — `{ "folder": { "...", "status": "CONNECTED" } }` on success, or `{ "folder": { "...", "status": "NOT_ACCESSIBLE" }, "error": "..." }` if access was revoked (still `200` — the verify request itself succeeded)
- `404` — `{ "error": "folder not found" }` for an ID that doesn't belong to the caller's account

### `POST /query`

Retrieval: embeds the query, searches the caller's own account namespace, returns chunk text plus attribution.

**Request**
```json
{ "query": "what does this say about pricing?", "topK": 5 }
```
`topK` is optional (default `5`, max `50`).

`filePath` is the file's location within the connected folder (subfolders included). It's omitted for chunks synced before subfolder support; those gain it the next time the file changes and is re-embedded.

`mimeType` (since 2.1) is the source file's Drive MIME type, for filtering or labelling results by file type. Like `filePath`, it's omitted for chunks embedded before 2.1 until the file is next re-embedded.

**Response**
```json
{
  "results": [
    { "text": "...", "score": 0.87, "fileId": "...", "fileName": "pricing.docx", "filePath": "Sales/pricing.docx", "section": "Enterprise tier", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
  ]
}
```

### `GET /status`

Per-folder sync health for the caller's account.

```json
{
  "folders": [
    {
      "driveFolderId": "...",
      "folderId": "...",
      "status": "CONNECTED",
      "lastSyncedAt": "2026-01-01T00:00:00.000Z",
      "lastSyncStatus": "SUCCESS",
      "lastSyncError": null,
      "consecutiveFailures": 0,
      "fileCount": 42,
      "skippedCount": 3,
      "skippedByReason": { "unsupported-mime-type": 2, "password-protected": 1 }
    }
  ]
}
```

`fileCount` counts synced files. `skippedCount` / `skippedByReason` (since 2.1) count files that can't be indexed for a permanent reason (`unsupported-mime-type`, `file-too-large`, `password-protected`, `corrupt-file`, `archive-too-large`, `unsupported-encoding`, `scanned-pdf-ocr-not-implemented`). A skipped file is retried when it changes in Drive.

### `GET /audit`

Full index state for the caller's account.

```json
{
  "totalFiles": 42,
  "totalChunks": 310,
  "totalSkipped": 3,
  "skippedByReason": { "unsupported-mime-type": 2, "password-protected": 1 },
  "folders": [ { "driveFolderId": "...", "folderId": "...", "fileCount": 42, "chunkCount": 310, "skippedCount": 3, "skippedByReason": { "unsupported-mime-type": 2, "password-protected": 1 } } ]
}
```

The skipped fields are new in 2.1; `totalFiles` still counts synced files only.

## MCP

Served over [streamable HTTP](https://modelcontextprotocol.io) at `POST /mcp`, stateless (no session state between calls). Authenticate the same way as REST: `Authorization: Bearer <api-key>` on the HTTP request. Two tools:

### `search`

| param | type | required |
|---|---|---|
| `query` | string | yes |
| `topK` | number (max 50) | no, default 5 |

Returns the same shape as `POST /query`'s `results` array, as a JSON string in the tool result's text content.

### `fetch_document`

| param | type | required |
|---|---|---|
| `fileId` | string | yes — from a prior `search` result's `fileId` |

Returns `{ "fileId": "...", "fileName": "...", "mimeType": "...", "text": "..." }` (the full reconstructed document) as a JSON string, or an error result (`isError: true`) if the file doesn't exist or doesn't belong to the caller's account — the same message either way, no signal leak about which.
