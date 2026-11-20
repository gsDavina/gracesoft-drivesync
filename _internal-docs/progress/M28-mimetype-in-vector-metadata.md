# M28 — `mimeType` in vector metadata

Status: **Done**

## What was built

- `src/sync/syncFolder.ts` writes `mimeType` into every upserted vector's metadata.
- `src/retrieval/retrievalService.ts` returns it as `RetrievedChunk.mimeType` (optional). `POST /query` and MCP `search` both serialise `RetrievedChunk`, so both gain it; the MCP `search` tool description lists it.
- `src/mcp/documentService.ts` — `fetch_document` returns `mimeType`, read from the `DriveFile` tracking row rather than vector metadata.
- `docs/api-reference.md` and `docs/index.html` show the new field.

## Decisions

- **`fetch_document` takes `mimeType` from Postgres, not from vectors.** The tracking row always has it, so documents indexed before v2.1 get it too.
- **No backfill for existing vectors.** Pre-v2.1 vectors gain `mimeType` the next time their file is re-embedded (or on a full resync); until then retrieval omits the field. Documented in the API reference, CHANGELOG and runbook. Additive: Sentinel Chat ignores unknown fields.

## Verified locally

- `syncFolder.test.ts`: every upserted vector carries `mimeType`.
- `retrievalService.test.ts`: `mimeType` returned when present; a pre-v2.1 chunk with no `mimeType` still returns normally with the field undefined.
- `documentService.test.ts` and `mcpServer.test.ts` updated for the new field.

## Explicitly not covered by this pass

- Sentinel Chat against the upgraded service (regression item, staging).

## Next

M29 — docs & release.
