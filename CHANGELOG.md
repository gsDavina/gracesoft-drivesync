# Changelog

All notable changes to GraceSoft DriveSync are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Work in progress toward 2.1.0 (document type expansion). See
`_internal-docs/06-v2.1-milestone-checklist.md`.

## [2.0.0] — 2026-11-20

Baseline entry. The `package.json` version was `0.1.0` throughout the v2
build even though every doc already called it v2; it now says `2.0.0` so
the next release can ship as `2.1.0`. No code changes in this entry.

What v2.0.0 contains (milestones M1–M18 in
`_internal-docs/01-milestone-checklist.md`):

- Multi-tenant accounts with HMAC-peppered API keys.
- Google Drive folder connection through a shared `drive.readonly` service
  account, including every subfolder of the connected folder.
- Change detection, content-hash dedup and stale-vector cleanup.
- Extraction for Google Docs, Sheets (first sheet only), Slides and PDFs
  with a text layer.
- Token-budgeted chunking with section/heading metadata.
- Pluggable `EmbeddingProvider` (OpenAI reference adapter) and
  `VectorStore` (Pinecone reference adapter), namespaced per account.
- Scheduled sync on BullMQ + Redis, with per-account Drive rate limiting.
- REST retrieval (`POST /query`), MCP server (`search`, `fetch_document`),
  and observability endpoints (`GET /status`, `GET /audit`).
- Railway deployment (server, worker and MCP from one image).
