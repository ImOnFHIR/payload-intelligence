# First real run: answer key

SPDX-License-Identifier: Apache-2.0

**Fill this in and commit it before any AI host sees a case.** The commit time is the evidence that the expected
answers were not fitted to what the hosts said. Do not edit an answer after the run; if you change your mind, add a
dated note under the table instead.

Everything here is synthetic. The fixtures are in [`examples/synthetic/`](../../../examples/synthetic/). Each
built-in case has a different format, which is how the exported records (which carry no fixture names) are matched
back to this key.

## Two columns per dimension

- **Expected:** the right answer for the payload itself, as an HL7/FHIR expert would give it. Use the codes listed
  under [Allowed codes](#allowed-codes). For the two sets, list every code or write `(none)`.
- **In the summary?** Fill this in on the approve screen, after reading the structural summary and before giving the
  instruction to any host: `yes` if the summary alone carries enough to reach your answer, `partly`, or `no`. This
  separates a host that reasoned badly from a summary that hid the answer. The second kind is a finding about the
  instrument, not the host.

## Run log

| | |
|---|---|
| Date | |
| Commit of payload-intelligence used | |
| Claude Desktop version and model | |
| Codex version and model | |
| Anything unusual | |


## 1. FHIR JSON: Synthetic prior-authorization-shaped Claim (`fhir-claim.json`)

| Dimension | Expected | In the summary? |
|---|---|---|
| standardVersion | | |
| businessWorkflow | | |
| exchangePattern | | |
| interactionKind | | |
| sourceActorRoles | | |
| destinationActorRoles | | |
| destinationClass | | |
| missingContextQuestionCodes | | |
| proposedNextActionCodes | | |

## 2. FHIR XML: Synthetic collection Bundle (`fhir-bundle.xml`)

| Dimension | Expected | In the summary? |
|---|---|---|
| standardVersion | | |
| businessWorkflow | | |
| exchangePattern | | |
| interactionKind | | |
| sourceActorRoles | | |
| destinationActorRoles | | |
| destinationClass | | |
| missingContextQuestionCodes | | |
| proposedNextActionCodes | | |

## 3. FHIR NDJSON: Two synthetic resources (`fhir.ndjson`)

| Dimension | Expected | In the summary? |
|---|---|---|
| standardVersion | | |
| businessWorkflow | | |
| exchangePattern | | |
| interactionKind | | |
| sourceActorRoles | | |
| destinationActorRoles | | |
| destinationClass | | |
| missingContextQuestionCodes | | |
| proposedNextActionCodes | | |

## 4. HL7 v2: Synthetic ORU envelope (`hl7-v2.er7`)

| Dimension | Expected | In the summary? |
|---|---|---|
| standardVersion | | |
| businessWorkflow | | |
| exchangePattern | | |
| interactionKind | | |
| sourceActorRoles | | |
| destinationActorRoles | | |
| destinationClass | | |
| missingContextQuestionCodes | | |
| proposedNextActionCodes | | |

## 5. CDA: Synthetic ClinicalDocument (`cda.xml`)

| Dimension | Expected | In the summary? |
|---|---|---|
| standardVersion | | |
| businessWorkflow | | |
| exchangePattern | | |
| interactionKind | | |
| sourceActorRoles | | |
| destinationActorRoles | | |
| destinationClass | | |
| missingContextQuestionCodes | | |
| proposedNextActionCodes | | |

## 6. Ambiguous JSON: Clinical-looking, but no standard marker (`ambiguous.json`)

| Dimension | Expected | In the summary? |
|---|---|---|
| standardVersion | | |
| businessWorkflow | | |
| exchangePattern | | |
| interactionKind | | |
| sourceActorRoles | | |
| destinationActorRoles | | |
| destinationClass | | |
| missingContextQuestionCodes | | |
| proposedNextActionCodes | | |

## Allowed codes

Taxonomy `imonfhir.evaluation-taxonomy.v2` (`packages/core/src/taxonomy.ts`).

| Dimension | Codes |
|---|---|
| standardVersion | FHIR_R4, FHIR_R4B, FHIR_R5, HL7_V2_3, HL7_V2_3_1, HL7_V2_4, HL7_V2_5, HL7_V2_5_1, HL7_V2_6, HL7_V2_7, HL7_V2_7_1, HL7_V2_8, HL7_V2_8_1, HL7_V2_8_2, HL7_V2_9, CDA_R2, C_CDA_2_1, C_CDA_3_0, UNDETERMINED, NOT_APPLICABLE |
| businessWorkflow | PRIOR_AUTHORIZATION, PATIENT_ADMINISTRATION, ORDER_MANAGEMENT, RESULT_REPORTING, CLINICAL_DOCUMENTATION, PUBLIC_HEALTH_REPORTING, CARE_COORDINATION, UNKNOWN_OR_OTHER, NOT_APPLICABLE |
| exchangePattern | SINGLE_RESOURCE, RESOURCE_COLLECTION, RESOURCE_STREAM, DOCUMENT, MESSAGE, DELIMITED_RECORD_SET, GENERIC_STRUCTURED_OBJECT, UNKNOWN, NOT_APPLICABLE |
| interactionKind | REQUEST, RESPONSE, EVENT, UNKNOWN, NOT_APPLICABLE |
| sourceActorRoles, destinationActorRoles (a set; UNKNOWN only on its own) | PATIENT_OR_MEMBER, PROVIDER_OR_CARE_TEAM, PAYER_OR_HEALTH_PLAN, HEALTH_INFORMATION_NETWORK_OR_EXCHANGE, PUBLIC_HEALTH_AGENCY, APPLICATION_OR_DATA_SERVICE, OTHER, UNKNOWN |
| destinationClass | PROVIDER_SYSTEM, PAYER_SYSTEM, PATIENT_APPLICATION, HEALTH_INFORMATION_NETWORK_OR_EXCHANGE, PUBLIC_HEALTH_SYSTEM, DATA_PLATFORM_OR_REPOSITORY, LOCAL_REVIEW_ONLY, OTHER, UNKNOWN |
| missingContextQuestionCodes (a set) | CONFIRM_STANDARD_VERSION, CONFIRM_BUSINESS_WORKFLOW, CONFIRM_EXCHANGE_PATTERN, CONFIRM_INTERACTION_KIND, CONFIRM_SOURCE_ACTOR_ROLES, CONFIRM_DESTINATION_ACTOR_ROLES, CONFIRM_DESTINATION_CLASS |
| proposedNextActionCodes (a set) | ASK_TARGETED_CONTEXT, REVIEW_DETERMINISTIC_EVIDENCE, REVIEW_STANDARD_VERSION_HYPOTHESIS, REVIEW_BUSINESS_WORKFLOW_HYPOTHESIS, REVIEW_EXCHANGE_PATTERN_HYPOTHESIS, REVIEW_INTERACTION_KIND_HYPOTHESIS, REVIEW_SOURCE_ACTOR_HYPOTHESES, REVIEW_DESTINATION_ACTOR_HYPOTHESES, REVIEW_DESTINATION_CLASS_HYPOTHESIS, STOP_UNSUPPORTED_FORMAT |

## The run, in order

1. Commit this file with the **Expected** column filled in.
2. `nvm use`, `npm run bootstrap`, `npm run lab`. Configure both hosts (`npm run mcp:config -- claude`,
   `npm run mcp:config -- codex`), fully restart them, then `npm run mcp:doctor -- both`.
3. For each case above, in order:
   - choose the built-in sample, read the structural summary and fill in **In the summary?**;
   - approve it, give the instruction to Claude Desktop, then to Codex;
   - review each submission against this key: Accept, Change answer (to the expected code), or Not scorable;
   - save both evaluations, then finish and purge the case.
4. Fill in the run log.
5. On Results, download `imonfhir-sme-evaluations-v2.jsonl`. Check it with
   `npm run results:summarize -- <path to the file>`, then commit it beside this key as `evaluations.jsonl`.
