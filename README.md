# ImOnFHIR Payload Intelligence

SPDX-License-Identifier: Apache-2.0

**EXPERIMENTAL DEVELOPER PREVIEW · SYNTHETIC DATA ONLY · NOT A VALIDATOR**

ImOnFHIR Payload Intelligence is a local workbench for evaluating how an AI host reasons about the structure of a healthcare payload without giving that host the payload's values.

```text
synthetic payload
  → one-use browser Worker
  → deterministic format and shape observation
  → human-approved structural summary
  → Codex or Claude through local MCP
  → closed-code hypotheses
  → SME correction
  → sanitized JSONL
```

The useful artifact is the correction loop. This repository does not include a bundled model, validator, calibration layer, clinical logic, payer policy, or production security claim.

## Five-minute start

Requirements: macOS, Git, and Node.js 22.

```bash
git clone https://github.com/ImOnFHIR/payload-intelligence.git
cd payload-intelligence
npm run bootstrap
npm run lab
```

The final command opens `http://127.0.0.1:4317`. Start with a built-in synthetic case before connecting an AI host.

[Watch the synthetic MCP workbench walkthrough](docs/media/synthetic-mcp-workbench-demo.mp4). The recording uses a deterministic protocol harness—not a model—and is labeled that way in-frame.

Print the configuration for your host:

```bash
npm run mcp:config -- codex
npm run mcp:config -- claude
```

These commands print configuration; they do not edit your Codex or Claude settings. Restart the host after adding the configuration, keep the lab running, and check the local connection with:

```bash
npm run mcp:doctor
```

Setup follows the current [Codex local MCP configuration](https://developers.openai.com/codex/extend/mcp) and [Claude Desktop local MCP guidance](https://support.anthropic.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop). Local MCP availability can still depend on the host version and workspace policy.

## Use the workbench

1. Choose a built-in example or confirm that your own fixture is synthetic and contains no PHI or production data.
2. Review the deterministic format result and the exact structural summary proposed for AI-host exposure.
3. Select **Approve summary for AI host**. This is the boundary decision: your configured AI host may send the approved summary to its provider.
4. Copy the generated instruction into Codex or Claude. The host retrieves the case and submits all five closed-code hypothesis axes through MCP.
5. Accept, correct, or mark each axis not scorable.
6. Save the sanitized evaluation, purge the active case, and download canonical JSONL.

No model prose, confidence percentage, prompt, payload value, filename, local path, payload digest, case handle, or timestamp is included in the exported record.

## MCP surface

The evaluator server exposes only:

- `payload_capabilities`
- `payload_get_evaluation_case`
- `payload_submit_hypotheses`

Intake, case listing, validation, review mutation, export, transformation, handoff, and purge are intentionally not MCP tools. Those actions remain under UI/user authority.

The host must submit every required axis—standard/version, workflow, direction, actor roles, and destination class—using the versioned closed taxonomy. Unknown conclusions must be explicit and supported by an insufficient-evidence conflict and question code. Probabilities, rationale, comments, URLs, paths, and arbitrary properties are rejected.

## What is observed

The preview recognizes bounded structural envelopes for:

- FHIR JSON, XML, and NDJSON
- HL7 v2 ER7 envelopes
- CDA XML roots
- generic JSON, XML, and delimited text
- opaque PDF, DICOM, archive, binary, and unknown input as unsupported

EDI-shaped input is blocked as `RESTRICTED_EDI_UNSUPPORTED`. This repository contains no X12 schemas, segment tables, mappings, examples, or model-facing content.

Safe host-visible markers are deliberately narrow: FHIR resource type and selected request/bundle state codes; HL7 v2 message, trigger, and version codes from MSH; structural names and data types; and banded—not exact—counts. Unknown names are hashed. Identifiers, narrative, free text, clinical values, binary content, and attachment content are removed.

## Boundary and limitations

- The browser rejects input above 8 MB before parsing.
- XML DTDs, entities, XInclude, and network references are prohibited.
- JSON depth, NDJSON line/record size, HL7 segment count, structural features, response size, and wall time are bounded.
- Raw bytes are read only in a one-use Worker, overwritten best-effort, and never posted to the local coordinator.
- Browser and JavaScript garbage collectors may retain copies. Same-user malware, memory inspection, screenshots, clipboard capture, and a compromised host remain out of scope.
- Active cases live only in coordinator memory and expire after four hours or when the lab exits.
- Sanitized reviewed records remain in local browser storage until downloaded or cleared.

See [SECURITY.md](SECURITY.md) before evaluating the design.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run check
```

The source is organized as:

```text
apps/lab/           local React workbench and one-use inspection Worker
packages/core/      deterministic recognition and value-minimized shape sketch
packages/contracts/ closed schemas, projection, taxonomy-bound validation
packages/mcp/       three-tool stdio evaluator server
examples/synthetic/ fictional examples only
scripts/            local coordinator, setup, schema and policy checks
```

## Non-claims

This preview does not establish payload conformance, semantic correctness, interoperability, authorization, medical necessity, coverage, destination readiness, privacy compliance, HIPAA compliance, model accuracy, calibration, production containment, or fitness for clinical or administrative decision-making.

The portfolio claim is narrower: **a bounded AI-evaluation workbench in which an AI host reasons over a value-minimized structural summary and a healthcare interoperability SME corrects the result for later iteration.**

## License and provenance

Owner-authored code is available under Apache-2.0. See [ORIGIN.json](ORIGIN.json), [RELICENSING_ATTESTATION.md](RELICENSING_ATTESTATION.md), [NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [TRADEMARKS.md](TRADEMARKS.md). The license does not grant rights to third-party standards, terminology, trademarks, validator packages, models, or runtime assets that are not included here.
