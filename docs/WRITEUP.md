# Payload Intelligence — project write-up

SPDX-License-Identifier: Apache-2.0

Written 2026-10-14 against the U2 source candidate based on `main` at `1d21d1a`.
The U2 non-author and real-host gates remain unexecuted, so no preview release is
claimed. Anything here that can go stale carries a date.

## In one screen

**What it is.** A local workbench that measures how an AI host (Codex or Claude Desktop) reasons about the *structure* of a healthcare payload without being given the payload's values. A healthcare interoperability SME then corrects the host's answer. The output is a sanitized, canonical JSONL record of where the host was right, wrong, or unable to tell.

**Where it stands.** This is an experimental developer preview that uses synthetic data only. It is public, but there is no tagged release.

**What is proven.** The trust boundary and the correction loop are both covered by executable tests (see [the evidence table](#evidence)). The tests show three things:
- raw input never reaches the coordinator or the AI host;
- the host can only answer in closed codes;
- every answer needs an explicit verdict from the SME before it is saved.

**What is not proven.** These have not happened yet:
- a real Codex or Claude Desktop host completing the loop;
- anyone other than the author completing the workflow;
- any measure of model quality.

The preview makes no compliance, validation or production claim (see [non-claims](#what-is-not-proven)).

**The claim, stated narrowly:** a bounded AI-evaluation workbench in which an AI host reasons over a value-minimized structural summary and a healthcare interoperability SME corrects the result for later iteration.

---

## The problem

Healthcare integration work starts with a question that sounds simple: *what is this payload?* Useful triage separates concerns that are often blurred together:
- Which standard and version it follows.
- Which business workflow it may support.
- Whether its exchange shape is a resource, collection, stream, document, message or record set.
- Whether the interaction is a request, response or event.
- Who the source and destination actors may be, and what destination class is plausible.

People who have done this for years answer from structure: segment and resource names, envelope shape, which elements are present. They rarely need the values.

General-purpose AI hosts are now good enough that people will ask them this question. Usually they paste in the payload to do it. That has two costs:

1. **Exposure.** A real payload carries identifiers, clinical values and free text. Once pasted, it belongs to the host's provider policy, not yours.
2. **Nothing to learn from.** A fluent paragraph that is wrong in one detail looks the same as one that is right. Without structured, expert-corrected outcomes, there is no record of where hosts fail, so nothing improves.

This project asks a narrower question. **If the host sees only a value-minimized structural summary, how well does it reason? And can an SME's corrections be captured in a form that supports the next iteration?**

## The pivot, including the wrong turns

This repository is the second attempt. The first was a private experiment (P1/P2), frozen at commit `aaad9de` in its own repository.

**What went wrong the first time.**
- It built study consent, signed publication artifacts and release lifecycle controls *before* the underlying experience could be handed to anyone.
- It shipped a small frozen model, and that model **failed its own small holdout**.

Neither the model nor the study machinery carries forward. [ADR 0001](decisions/0001-pivot-to-evaluation-workbench.md) records the decision. This repository's inventory check deliberately fails the build if study, consent or model-pack artifacts reappear.

**Alternatives considered and set aside.**

| Option | Why it was not pursued |
|---|---|
| Keep refining the frozen model | It failed its holdout. More tuning without expert-labelled outcomes would be tuning against noise. |
| Ship a validator | Validators answer "is this conformant?", not "what is this, and where is it going?". Good validators already exist. This project includes none and makes no conformance claim. |
| Let the host see the raw payload | It is the easiest path and has the highest exposure. It also makes the evaluation unrepeatable, because the host's answer depends on values the record cannot keep. |
| Free-text host answers with confidence scores | Prose can carry values back out. Uncalibrated confidence numbers look like evidence and are not. Neither can be compared across hosts or runs. |
| **Chosen: a model-neutral evaluation loop with human-approved exposure and closed-code answers** | This produces the missing artifact: expert-corrected, comparable outcomes. It needs no model of its own, and it works with whichever host the evaluator already uses. |

## Design

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

### The trust boundary

- **Raw bytes stay in a one-use Worker.** Each inspection gets a fresh browser Worker. The Worker reads the bytes, overwrites them as far as the browser allows, and posts back only an observation. The local coordinator never receives raw input. It rejects a raw payload posted to its case endpoint without echoing it.
- **Deterministic code decides what the payload is.**
  - Recognition is bounded. It covers FHIR (JSON, XML, NDJSON), HL7 v2 ER7, CDA, generic JSON/XML/delimited text, and opaque or binary input. No model is involved.
  - Input is capped at 8 MB.
  - XML DTDs, entities, XInclude and network references are rejected, and a bounded SAX parser reads the rest.
  - EDI-shaped input stops at `RESTRICTED_EDI_UNSUPPORTED`, and the repository contains no X12 content.
- **The summary is value-minimized by construction.**
  - Allowed: FHIR resource types, HL7 MSH message, trigger and version codes, structural names and data types, and *banded* counts (`TWO_TO_FIVE`, never `3`).
  - Hashed: unknown names.
  - Removed: identifiers, narrative, free text, clinical values and attachments.
- **A person approves exposure.** The workbench shows the *complete* canonical projection the host will be able to read, not a summary of it. Nothing reaches the host until the user selects **Approve summary for AI host**. The UI states that the host may forward what it reads to its provider.
- **The MCP surface has three tools.**
  - `payload_capabilities`
  - `payload_get_evaluation_case`
  - `payload_submit_hypotheses`

  Case creation, listing, review, export and purge are UI-only. The host can read an approved case and submit an answer. It cannot create, change or delete anything else.
- **The coordinator is local and short-lived.**
  - It is bound to `127.0.0.1`.
  - The MCP server authenticates with a 256-bit token in a mode-0600 rendezvous file.
  - Cases live only in memory and expire after four hours or when the lab exits.

### Closed codes, not prose

The host must answer all seven axes from the current versioned taxonomy (`imonfhir.evaluation-taxonomy.v2`, see [`taxonomy.ts`](../packages/core/src/taxonomy.ts)). Format remains deterministic and is not submitted by the host:

| Axis | Example codes |
|---|---|
| Standard / version | `FHIR_R4`, `HL7_V2_5_1`, `C_CDA_2_1`, `UNDETERMINED` |
| Business workflow | `PRIOR_AUTHORIZATION`, `RESULT_REPORTING`, `CARE_COORDINATION` |
| Exchange pattern | `SINGLE_RESOURCE`, `RESOURCE_STREAM`, `DOCUMENT`, `MESSAGE` |
| Interaction kind | `REQUEST`, `RESPONSE`, `EVENT`, `UNKNOWN` |
| Source actor roles | `PROVIDER_OR_CARE_TEAM`, `APPLICATION_OR_DATA_SERVICE`, … |
| Destination actor roles | `PAYER_OR_HEALTH_PLAN`, `PUBLIC_HEALTH_AGENCY`, … |
| Destination class | `PAYER_SYSTEM`, `PUBLIC_HEALTH_SYSTEM`, `LOCAL_REVIEW_ONLY`, … |

**Each hypothesis must cite evidence references that the case actually offered.** An "unknown" answer must be explicit, and it must carry the conflict code and question code for that specific axis. A destination conflict cannot be attached to a standard/version answer.

**The submission is rejected outright if it contains:**
- probabilities or confidence fields;
- rationale or comments;
- URLs or paths;
- any property the schema does not name.

This is the decision that makes the output useful. Every answer can be compared with every other answer, across hosts and across runs.

## The SME correction loop

1. Codex-mode and Claude-mode submissions can both appear against the same approved case.
2. Draft reviews are keyed by submission digest, so switching hosts does not discard work.
3. Each of the seven axes plus the missing-question and next-action sets starts as **unreviewed**. Nothing is accepted by default, and the evaluation cannot be saved until every dimension has a verdict.
4. For each dimension the SME chooses **Accept**, **Change answer** or **Not scorable**. A changed answer must differ from the host's answer; re-selecting the host's own value is rejected.
5. **Save this evaluation** updates that submission's deterministic record without purging the case. After both desired host records are saved, **Finish and purge case** removes the active case. Export produces canonical taxonomy-v2 JSONL.
6. Existing taxonomy-v1 browser rows stay in a separate legacy store. They can be exported or cleared, but they are never inferred into v2 or included in v2 comparisons.

**What the record leaves out:**
- model prose;
- confidence numbers;
- prompts;
- payload values;
- filenames;
- local paths;
- payload digests;
- case handles;
- timestamps.

**What it keeps:**
- the approved structural context and its digest;
- the host kind;
- the host's closed-code hypotheses and question and next-action codes;
- for all seven axes and both controlled-code sets, the verdict, the expected value and whether it was an exact match.

## Evidence

Tests are the evidence standard. A capability is claimed only where a test would fail without it.

| Claim | Backed by | Verified how |
|---|---|---|
| Raw payload material never reaches or persists in the coordinator; the rendezvous file is private | `test/lab-roundtrip.test.ts` — *uses a private rendezvous and never persists raw payload material* | Unit suite |
| The host sees exactly three tools with closed input schemas, including the empty capabilities root | `test/mcp-protocol.test.ts` — *publishes only the three evaluator tools with closed roots* | Unit suite |
| Fabricated handles, stale digests, unknown evidence, prose and extra fields fail closed | `test/mcp-protocol.test.ts` — *fails closed for fabricated handles, stale digests, unknown evidence, prose, and extra fields* | Unit suite |
| Confidence and probability fields are rejected | `test/mcp-protocol.test.ts` — *rejects arbitrary confidence fields*; `packages/contracts/test/contracts.test.ts` — *rejects arbitrary prose and probability fields* | Unit suite |
| Counts are banded and exact byte sizes removed | `contracts.test.ts` — *bands counts, removes exact bytes, and is stable* | Unit suite |
| Hypotheses bind the exact case material, current contract digests and offered evidence; conflict codes are axis-specific | `contracts.test.ts` — taxonomy-v2 binding and wrong-axis conflict tests | Unit suite |
| Corrections must differ; exact-match values are derived; all seven axes and both sets are reviewed | `contracts.test.ts` — taxonomy-v2 SME record tests | Unit suite |
| HL7 OBX/NTE values are not exposed; MSH markers are bounded | `packages/core/test/core.test.ts` — *does not expose OBX or NTE values and emits bounded MSH markers* | Unit suite |
| XML comments, CDATA, attributes, names and declared metadata are removed; prohibited XML is rejected | `core.test.ts` — *removes XML comments, CDATA, …*; *rejects prohibited XML declarations and excessive input* | Unit suite |
| EDI-shaped input is blocked without interpretation | `core.test.ts` — *blocks standard-neutral EDI-shaped input without interpreting it* | Unit suite |
| Submissions are rejected after the user purges a case | `mcp-protocol.test.ts` — *rejects submissions after the user purges the case* | Unit suite |
| Both host launch modes complete the stdio handshake; probes do not advance ephemeral host activity | `mcp-protocol.test.ts`, `test/host-activity.test.ts` | Unit suite |
| Config helpers print and check host configuration without changing it | `test/onboarding-scripts.test.ts` (three tests) | Unit suite |
| A second lab launch neither strands nor replaces the running lab | `lab-roundtrip.test.ts` — *exits without deleting or replacing the running lab's rendezvous* | Unit suite, plus a manual double launch and MCP self-test |
| Full dual-host UI flow preserves drafts, saves both records, warns before destructive purge and exports deterministic v2 JSONL | `e2e/workbench.spec.ts` | Browser suite |
| V1 rows remain isolated; malformed browser rows fail closed; recording view hides transient identifiers and paths | `e2e/workbench.spec.ts` | Browser suite |
| Every inspection uses a new one-operation Worker | `e2e/workbench.spec.ts` | Browser suite |
| A custom file requires a synthetic-data assertion; blocked and expired states are explicit | `e2e/workbench.spec.ts` (two tests) | Browser suite |

**Historical U1 reproduction, 2026-10-14.** The following was run on Linux with Node 22.22.0, outside the author's machine before taxonomy v2 and dual-host review were added:
- A fresh clone and `npm run bootstrap` succeeded.
- The unit and integration suite passed: 27/27 at `c5e796d`, and 28/28 with the fix below.
- The browser suite passed 4/4 against a locally installed Chromium.
- Typecheck, build, SPDX, license and inventory checks passed.

**Historical author-reported U1 checks at `c5e796d`, 2026-10-14** (linked, not independently re-checked for U2):
- [macOS/Linux CI](https://github.com/ImOnFHIR/payload-intelligence/actions/runs/38512602357) passed.
- [CodeQL](https://github.com/ImOnFHIR/payload-intelligence/actions/runs/38512600907) passed.
- There were no open CodeQL, Dependabot, secret-scanning, or high or critical audit findings.

## Found and fixed: the double launch

An outside review found a defect the suite had not covered. Running `npm run lab` while a lab was already up did two things:
1. The second instance wrote its own rendezvous file *before* trying the port.
2. When the port was taken, it deleted the rendezvous file.

The running lab kept serving, and its UI still said **Local coordinator ready**. But every MCP call failed with `STORE_UNAVAILABLE`, because the token file was gone. The failed second instance also never exited.

This is the worst kind of first-run failure: a green UI over a broken host connection, with nothing on screen to explain it. The README's own troubleshooting advice ("keep `npm run lab` running in another terminal and retry") makes a second launch a likely move for a confused first-time user.

**Why the suite missed it.** Every test started exactly one lab. Nothing exercised a second instance against a live one.

**The fix** ([`scripts/lab.ts`](../scripts/lab.ts)):
- The rendezvous file is written only after the port is held.
- An instance removes the rendezvous only if the recorded pid is its own.
- A failed start exits explicitly.

The regression test checks three things:
- the second launch exits non-zero;
- the first lab's rendezvous is unchanged;
- an MCP client still reaches the first lab.

Reverting each of the three changes on its own turns the test red.

## What is not proven

- **No real host run yet.** The tests launch the same stdio commands the hosts are configured with and exercise the protocol contract. They do not prove that Codex or Claude Desktop loaded the server, or that local MCP is allowed under a given workspace policy. The read-only doctor reports saved configuration, local launch, exact tool contract and ephemeral mode activity separately. Mode activity is not authenticated identity. The [walkthrough video](media/synthetic-mcp-workbench-demo.mp4) uses a deterministic protocol harness, not a model, and says so on screen.
- **No non-author run.** No one other than the author has completed the workflow with a real host configuration. This is the remaining release gate.
- **No model-quality result.** The workbench is built to *produce* that evidence. It does not yet contain any.
- **Synthetic data only.** Same-user malware, memory inspection, screenshots, clipboard capture and a compromised host are out of scope. Browser and JavaScript garbage collectors may keep copies despite best-effort overwrites.
- **Explicit non-claims.** The preview does not establish:
  - payload conformance, semantic correctness or interoperability;
  - authorization, medical necessity, coverage or destination readiness;
  - privacy or HIPAA compliance;
  - model accuracy or calibration;
  - production containment;
  - fitness for clinical or administrative decision-making.

## What's next

1. **Run the frozen U2 release gate.** One SME who is not the author uses the exact candidate on macOS, from a clone path containing spaces, without owner coaching. Both real hosts must submit against one case; both evaluations must be saved; a separate user-supplied synthetic case must include a correction and a not-scorable verdict; v2 JSONL must export; the case must purge; and the participant must explain the non-claims. See the [controlled checklist](handoff/U2_NON_AUTHOR_SMOKE_TEST.md).
2. **Name what the JSONL is for.** The correction loop is the artifact. The next step is to decide which decision 20–50 corrected evaluations should inform: which axis hosts get wrong most often, or whether the structural summary is missing a marker experts rely on. Then collect toward that decision.
3. **Smaller known gaps (2026-10-14).**
   - The developer preview is pinned to Node 22.22.3; later Node lines are intentionally untested here.
   - The README lists macOS as the requirement while CI also runs Linux.
   - The `/api/*` routes do not validate the `Host` header. The exposure is limited to an active-case count, but the fix is one line.

## Run it

See the [README](../README.md#ten-minute-start). From a clean clone it takes two commands: `npm run bootstrap`, then `npm run lab`.
