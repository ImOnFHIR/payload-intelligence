# Synthetic protocol-harness recording

SPDX-License-Identifier: Apache-2.0

`synthetic-mcp-workbench-demo.mp4` is a viewport-only, no-audio walkthrough generated from the built-in synthetic FHIR JSON case.

The recording uses the real stdio MCP protocol and coordinator path. A deterministic harness supplies closed-code hypotheses so that the recording is reproducible. It does **not** demonstrate Codex, Claude, a trained healthcare model, model quality, or model inference.

This is a U1 artifact and does not satisfy the U2 real-host gate. The U2 release
asset must be captured only after both actual host modes submit to the same case,
must carry the exact in-frame label `REAL HOST MCP HANDOFF · SYNTHETIC ONLY · NOT
A MODEL QUALITY TEST`, and must pass `npm run media:verify` plus human frame review.

Regenerate only this U1 protocol-harness artifact with `npm run demo:record`.
That command cannot create or replace the U2 real-host asset. The U1 generator
masks opaque case, submission, and record identifiers before capture, strips media
metadata, scans visible DOM text and the final artifact for known forbidden
strings, and writes a SHA-256 receipt. A human must still visually review any
candidate media.
