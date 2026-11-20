# M19 — Version & release framing

Status: **Done**

## What was built

- `package.json` (and `package-lock.json`) version `0.1.0` → `2.0.0`, matching how every doc already refers to the shipped system as v2. v2.1 can now ship as `2.1.0`.
- `CHANGELOG.md` (Keep a Changelog format) with a `2.0.0` baseline entry summarising M1–M18. The `2.1.0` entry was added in M29.
- The MCP server's advertised version (`src/mcp/mcpServer.ts`) moved from the stale `"0.1.0"` to `"2.0.0"` in M28, for the same reason.

## Decisions

- **`package.json` stays at `2.0.0` until 2.1 is actually deployed.** The CHANGELOG's `2.1.0` entry is marked "Unreleased"; the version bump belongs to the release step in M29 (after the staging run), so the version in the repo never claims a release that hasn't happened.
- **The 2.0.0 date is the last v2 commit (2026-11-20)**, not the original M18 date, because subfolder sync landed after M18.

## Verified locally

- `npm install --package-lock-only` updated the lockfile's root version; no dependency changes from this milestone.

## Next

M20 — extractor registry refactor.
