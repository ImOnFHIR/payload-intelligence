# Synthetic workbench recording

SPDX-License-Identifier: Apache-2.0

`synthetic-mcp-workbench-demo.mp4` is a viewport-only, no-audio walkthrough generated from the built-in synthetic FHIR JSON case.

The recording uses the real stdio MCP protocol and coordinator path. A deterministic harness supplies closed-code hypotheses so that the recording is reproducible. It does **not** demonstrate Codex, Claude, a trained healthcare model, model quality, or model inference.

Generate a replacement with `npm run demo:record`. The generator masks opaque case, submission, and record identifiers before capture, strips media metadata, scans visible DOM text and the final artifact for known forbidden strings, and writes a SHA-256 receipt. A human must still visually review the final video before release.
