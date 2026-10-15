# U2 non-author smoke test

SPDX-License-Identifier: Apache-2.0

**NON_AUTHOR_USABILITY_SMOKE_TEST · NOT INDEPENDENT REVIEW**

This is the release gate for `v0.1.0-preview`. It is a usability smoke test of a
synthetic-only developer preview. It is not model-quality evidence, standards
validation, a clinical test, or an independent review.

The participant must use the exact candidate commit, work without owner coaching,
and enter their own host submissions and SME decisions. If either real host fails,
the participant needs coaching, or any restricted information appears in an
artifact, stop. Do not tag or publish a prerelease.

## Preconditions

- macOS with Node.js 22, Git, Codex, and Claude Desktop already available.
- A source checkout path containing at least one space.
- Only built-in examples and participant-created synthetic, non-PHI material.
- Use a clean browser profile for the smoke test. If the profile was used for an
  owner rehearsal, clear its prior **v2 sanitized records** from Results before
  the timed run; do not clear or reinterpret any legacy v1 records.
- The owner gives the participant only this document, the candidate commit, and
  the repository URL. The owner does not explain answers or operate the UI.

## Fresh-clone setup

Replace `<candidate-commit>` with the exact 40-character release-candidate commit.

```bash
mkdir -p "$HOME/ImOnFHIR Preview Test"
cd "$HOME/ImOnFHIR Preview Test"
git clone https://github.com/ImOnFHIR/payload-intelligence.git "Payload Intelligence"
cd "Payload Intelligence"
git checkout --detach <candidate-commit>
node --version
npm run bootstrap
npm run lab
```

Record elapsed whole minutes from the first `git clone` command until the Start
screen is usable. The gate is ten minutes or less. The lab opens the operating
system's default browser; close or ignore that tab, then manually open
`http://127.0.0.1:4317` in the prepared clean browser profile. That step is part
of the timed setup.

## Host setup and same-case review

1. In a second terminal, print—not install—the two host configurations:

   ```bash
   npm run mcp:config -- codex
   npm run mcp:config -- claude
   ```

2. Manually add the printed configuration to each host, then fully restart the
   host as its own instructions require.
3. With the lab still running, check the local path and configuration without
   changing either host:

   ```bash
   npm run mcp:doctor -- both
   ```

4. Open one built-in case, review the sanitized summary, and approve it.
5. Give the same case instruction to Codex and Claude Desktop. Each host must call
   the case tool and submit a closed-code result.
6. Confirm the UI says that Codex-mode and Claude-mode MCP activity was seen. This
   indicates launcher-mode traffic only; it is not authenticated host identity.
7. Switch between the two submissions while making review edits. Confirm no draft
   disappears.
8. Review all seven axes and the question/action sets, then use **Save this
   evaluation** for each host. Do not purge between saves.
9. After both host evaluations are saved, use **Finish and purge case**. Confirm
   Results contains both records, then select **Run another case** to return to
   Start before beginning the user-supplied case.

## User-supplied synthetic case

1. Create or select a synthetic file containing no PHI or production information.
2. Make the synthetic-data assertion, inspect it, and approve its sanitized summary.
3. Submit through at least one real host.
4. Correct at least one submitted result and mark at least one different result
   `NOT_SCORABLE`.
5. Review the missing-context-question and next-action sets.
6. Use **Save this evaluation**.
7. Change one reviewed decision so that the saved submission becomes unsaved,
   select **Finish and purge case**, and cancel the unsaved-submission warning.
   Restore the intended review and use **Save this evaluation** again.
8. Select **Finish and purge case** and confirm the UI reaches Results.
9. Export canonical v2 JSONL and confirm any legacy v1 rows remain separate.

## Participant explanation gate

Without a supplied script, the participant must be able to explain all three:

- Inputs are synthetic-only.
- The workbench does not validate payload conformance or interoperability.
- It does not make clinical, coverage, authorization, payer, or other healthcare
  decisions and does not establish model quality.

## Evidence retained

Retain only the closed handoff receipt, the sanitized v2 export digest, the
recording digest, and the source-only release asset digests. Do not retain or
publish host prose, prompts, handles, filenames, paths, usernames, payload values,
or identifiers.

Build the receipt against
`packages/contracts/schemas/imonfhir.non-author-handoff-receipt.v1.schema.json`.
Use these commands from the clean candidate checkout for its controlled fields:

```bash
git rev-parse HEAD
git ls-tree -r --full-tree -z HEAD | shasum -a 256
shasum -a 256 /outside/checkout/imonfhir-sme-evaluations-v2.jsonl
shasum -a 256 /outside/checkout/real-host-mcp-handoff.mp4
shasum -a 256 /outside/checkout/real-host-mcp-handoff.sha256
```

The recording must be 60–90 seconds and carry this exact in-frame label:

`REAL HOST MCP HANDOFF · SYNTHETIC ONLY · NOT A MODEL QUALITY TEST`

It may show workbench activity and the two sanitized submissions. It must not show
host prose, prompts, case handles, local paths, usernames, payload values, or
identifiers.

Capture only the workbench at `http://127.0.0.1:4317/?recording=1`. That view
renders the required label and hides case, record, context, evidence-reference,
and structural-path identifiers. Do not switch to either host while recording.
The final MP4 must have no audio. Store the raw and final evidence outside the
Git checkout so the candidate checkout remains clean.

After visual review, strip prior metadata and audio, add the controlled label as
MP4 metadata, and create the descriptor:

```bash
label='REAL HOST MCP HANDOFF · SYNTHETIC ONLY · NOT A MODEL QUALITY TEST'
ffmpeg -i raw-capture.mp4 -map 0:v:0 -an -map_metadata -1 \
  -metadata comment="$label" -c:v copy real-host-mcp-handoff.mp4
shasum -a 256 real-host-mcp-handoff.mp4 > real-host-mcp-handoff.sha256
```

## Tag gate

Only after every controlled check passes on the exact candidate commit:

```bash
npm run media:verify -- path/to/real-host-mcp-handoff.mp4 path/to/real-host-mcp-handoff.sha256 --visual-review=owner-confirmed --recording-view=confirmed
npm run handoff:verify -- path/to/non-author-handoff-receipt.json --evaluation=path/to/v2-export.jsonl --recording=path/to/real-host-mcp-handoff.mp4 --descriptor=path/to/real-host-mcp-handoff.sha256
git tag -a v0.1.0-preview <candidate-commit> -m "v0.1.0-preview"
git push origin v0.1.0-preview
```

Create a source-only GitHub prerelease and attach only the verified receipt, the
reviewed recording, and SHA-256 descriptor files. A failed or incomplete gate must
remain untagged.

The handoff verifier requires a clean checkout, at least one context containing
both Codex-mode and Claude-mode records, a separate synthetic context with both a
correction and a not-scorable verdict, canonical record ordering, and no duplicate
record identities.
