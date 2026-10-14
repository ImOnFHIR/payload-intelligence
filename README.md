# ImOnFHIR Payload Intelligence

SPDX-License-Identifier: Apache-2.0

**EXPERIMENTAL DEVELOPER PREVIEW · SYNTHETIC DATA ONLY · NOT A VALIDATOR**

ImOnFHIR Payload Intelligence is a macOS-first local workbench for evaluating how
an AI host reasons about the structure of a healthcare payload without giving that
host the payload's values.

```text
synthetic payload
  → one-use browser Worker
  → deterministic format and shape observation
  → human-approved structural summary
  → Codex or Claude Desktop through local MCP
  → closed-code taxonomy-v2 hypotheses
  → SME acceptance or correction
  → sanitized canonical JSONL
```

The useful artifact is the correction loop. This repository does not include a
bundled model, validator, calibration layer, clinical logic, payer policy, or
production security claim.

For the reasoning behind the design, the evidence for each claim, and what is not yet proven, read the [project write-up](docs/WRITEUP.md).

## Ten-minute start

Requirements: macOS, Git, and Node.js 22.22.3. The repository includes `.nvmrc`
and `.node-version` for common version managers.

```bash
git clone https://github.com/ImOnFHIR/payload-intelligence.git
cd payload-intelligence
nvm use # or: fnm use
npm run bootstrap
npm run lab
```

The final command opens `http://127.0.0.1:4317`. Start with a built-in synthetic
case before connecting an AI host.

Print configuration for each host:

```bash
npm run mcp:config -- codex
npm run mcp:config -- claude
```

The commands print settings; they never edit host configuration. After manually
adding the configuration, fully quit and reopen the host and keep the lab running.

Run the protocol-only probe, then the read-only diagnostic:

```bash
npm run mcp:self-test -- both
npm run mcp:doctor -- both
```

The doctor reports four separate facts: saved configuration match, local stdio
launch, the exact three-tool contract, and ephemeral Codex-mode or Claude-mode
activity. Self-test and doctor launches are probes and cannot advance activity.
Mode activity is not authenticated host identity and does not prove provider
connectivity.

[Official Codex MCP documentation](https://developers.openai.com/codex/extend/mcp)
documents local STDIO configuration and the shared Codex configuration. The
[current Claude Desktop local MCP guidance](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
foregrounds desktop extensions; the preview's Claude-mode doctor checks the saved
JSON entry requested by this developer-preview flow, while actual in-app tool
availability remains a separate manual check and may be restricted by host version
or administrator policy.

### Setup troubleshooting

- **Wrong Node version:** run `nvm use` or `fnm use`, then confirm
  `node --version` reports `v22.22.3`.
- **Lab unavailable:** keep `npm run lab` running in another terminal.
- **Probe passes but a host is unseen:** regenerate that host's snippet, compare it
  with `npm run mcp:doctor -- codex|claude`, fully restart the host, and confirm
  local MCP is allowed by its policy.
- **Claude JSON mismatch:** run `npm run mcp:config:check -- claude`. It reads but
  never rewrites the file.
- **Stale or expired case:** inspect and approve a new synthetic case, then give
  the new instruction to the host.

## Evaluate one case with both hosts

1. Choose a built-in example or assert that your own fixture is synthetic and
   contains no PHI or production data.
2. Review the deterministic format result and every structural item proposed for
   host exposure.
3. Select **Approve summary for AI host**. Your configured host may send that
   approved summary to its provider.
4. Copy the case instruction into Codex and Claude Desktop. Each host retrieves
   the same case and submits all seven taxonomy-v2 axes through MCP.
5. Switch between submissions. Review standard/version, business workflow,
   exchange pattern, interaction kind, source roles, destination roles,
   destination class, the missing-context-question set, and the next-action set.
6. Select **Save this evaluation** for each host. Saving does not purge the case,
   and drafts remain attached to their submission digest while switching.
7. Select **Finish and purge case** only after the desired submissions are saved.
   The workbench warns before discarding unsaved submissions.
8. Download deterministic v2 JSONL from Results. V1 rows remain in a separate
   legacy store with separate export and clear actions and are never remapped.

Results show submitted values, SME expectations, verdicts, and exact counts for
each dimension. They do not compute a pooled accuracy score or name a winning
host.

## Taxonomy v2

Format remains a deterministic observation and is not submitted by an AI host.
The required host axes are:

- standard/version;
- business workflow;
- exchange pattern;
- interaction kind;
- source actor roles;
- destination actor roles; and
- destination class.

V2 replaces the ambiguous v1 workflow/direction combination. Unknown and
not-applicable conclusions are explicit controlled codes. `UNKNOWN` is exclusive
within each actor-role set. Missing-context questions, conflicts, and next actions
are axis-specific. See [ADR 0002](docs/decisions/0002-separate-workflow-exchange-and-interaction.md).

## MCP surface

The evaluator server exposes exactly three tools:

- `payload_capabilities`
- `payload_get_evaluation_case`
- `payload_submit_hypotheses`

Intake, case listing, validation, review mutation, export, transformation, handoff,
and purge are intentionally absent. Those actions remain under UI/user authority.

Every submission binds the exact case, taxonomy version, fixed contract digests,
and offered evidence references. Probabilities, rationale, comments, prompts,
URLs, paths, v1 submissions, and arbitrary properties fail closed. Identical
retries deduplicate. Codex-mode and Claude-mode submissions may coexist on one
case.

## What is observed

The preview recognizes bounded structural envelopes for:

- FHIR JSON, XML, and NDJSON;
- HL7 v2 ER7 envelopes;
- CDA XML roots;
- generic JSON, XML, delimited text, and unknown text; and
- opaque PDF, DICOM, archive, binary, and unknown input as unsupported.

EDI-shaped input is blocked as `RESTRICTED_EDI_UNSUPPORTED`. This repository
contains no X12 schemas, segment tables, mappings, examples, or model-facing
content.

Safe host-visible markers are narrow: FHIR resource type and selected
request/bundle state codes; HL7 v2 message, trigger, and version codes from MSH;
structural names and data types; and banded—not exact—counts. Unknown names are
hashed. Identifiers, narrative, free text, clinical values, binary content, and
attachment content are removed.

## Boundary and limitations

- The browser rejects input above 8 MB before parsing.
- XML DTDs, entities, XInclude, and network references are prohibited.
- JSON depth, NDJSON line/record size, HL7 segment count, structural features,
  response size, and wall time are bounded.
- Raw bytes are read only in a one-use Worker, overwritten best-effort, and never
  posted to the local coordinator.
- Browser and JavaScript garbage collectors may retain copies. Same-user malware,
  memory inspection, screenshots, clipboard capture, and a compromised host remain
  out of scope.
- Active cases live only in coordinator memory and expire after four hours or when
  the lab exits.
- Sanitized reviewed records remain in local browser storage until downloaded or
  cleared.

See [SECURITY.md](SECURITY.md) before evaluating the design.

## Release status

The source version is `0.1.0-preview`, but the `v0.1.0-preview` tag and GitHub
prerelease are deliberately withheld until one non-author completes the real
Codex/Claude smoke test on the exact candidate and the reviewed 60–90 second video
and receipt pass their digest checks. See the
[U2 non-author smoke test](docs/handoff/U2_NON_AUTHOR_SMOKE_TEST.md).

The existing [synthetic MCP workbench recording](docs/media/synthetic-mcp-workbench-demo.mp4)
is an earlier deterministic protocol-harness demonstration. It is not real-host
evidence and cannot satisfy the U2 release gate.

The controlled handoff checklist uses `/?recording=1`, which keeps the required
real-host label on screen and hides transient case, evidence, context, record, and
structural-path identifiers. This is a capture aid, not a security boundary;
frame-by-frame owner review remains mandatory.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run test:browser
npm run check
```

The source is organized as:

```text
apps/lab/           local React workbench and one-use inspection Worker
packages/core/      deterministic recognition and versioned taxonomy
packages/contracts/ closed v1/v2 schemas and digest-bound validation
packages/mcp/       three-tool stdio evaluator server
examples/synthetic/ fictional examples only
scripts/            coordinator, setup, doctor, schemas, and policy checks
```

## Non-claims

This preview does not establish payload conformance, semantic correctness,
interoperability, authorization, medical necessity, coverage, destination
readiness, privacy compliance, HIPAA compliance, model accuracy, calibration,
production containment, authenticated host identity, or fitness for clinical or
administrative decision-making.

The portfolio claim is narrower: **a bounded healthcare-payload evaluation
workbench in which an AI host reasons over a value-minimized structural summary
and a healthcare interoperability SME corrects the result for later iteration.**

## License and provenance

Owner-authored code is available under Apache-2.0. See [ORIGIN.json](ORIGIN.json),
[RELICENSING_ATTESTATION.md](RELICENSING_ATTESTATION.md), [NOTICE](NOTICE),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [TRADEMARKS.md](TRADEMARKS.md).
The license does not grant rights to third-party standards, terminology,
trademarks, validator packages, models, or runtime assets that are not included
here.
