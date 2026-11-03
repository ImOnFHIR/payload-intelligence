// SPDX-License-Identifier: Apache-2.0

// Valid v2 evaluation records for tests: a minimal approved context and a record whose host answers and SME review are
// derived the same way the lab derives them, so the contracts schema accepts them as real exports.

import {
  CONTRACT_DIGESTS_V2,
  canonicalDigest,
  canonicalJson,
  deriveHypothesisDigest,
  deriveRecordId,
  deriveSubmissionDigest,
  smeEvaluationRecordSchema,
  type ApprovedCaseMaterial,
  type HostHypothesisSubmission,
  type HostKind,
  type SmeEvaluationRecord,
} from '@imonfhir/payload-contracts'

export function material(format: 'FHIR_JSON' | 'FHIR_XML', refSeed: string): ApprovedCaseMaterial {
  const formatRef = `ev_${refSeed.repeat(16).slice(0, 16)}`
  const shapeRef = `ev_${refSeed.toUpperCase().repeat(16).slice(0, 16).toLowerCase()}`
  const distinctShapeRef = shapeRef === formatRef
    ? `ev_${(format === 'FHIR_JSON' ? '2' : '4').repeat(16)}`
    : shapeRef
  return {
    schemaVersion: 'imonfhir.approved-case-material.v1',
    observation: {
      status: 'DETECTED', observedFormat: format,
      candidates: [{ format, signature: 'DETERMINISTIC', evidenceCodes: ['FHIR_MARKER'] }],
      conflictCodes: [], issueCodes: [],
    },
    structuralSummary: {
      schemaVersion: 'imonfhir.approved-structural-summary.v1', format,
      evidenceItems: [
        { ref: formatRef, kind: 'FORMAT', code: format },
        { ref: distinctShapeRef, kind: 'SHAPE', code: 'COMPLETE' },
      ],
      safety: {
        payloadValuesAbsent: true, identifiersAbsent: true, freeTextAbsent: true,
        binaryContentAbsent: true, unknownNamesHashed: true, exactCountsAbsent: true,
      },
    },
  }
}

export function evaluatedRecord(
  context: ApprovedCaseMaterial,
  hostKind: HostKind,
  customReview = false,
): SmeEvaluationRecord {
  const contextDigest = canonicalDigest(context)
  const evidenceRef = context.structuralSummary.evidenceItems[0]!.ref
  const submission: HostHypothesisSubmission = {
    schemaVersion: 'imonfhir.host-hypothesis-submission.v2',
    taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
    contractDigests: CONTRACT_DIGESTS_V2,
    caseHandle: `ec_${'a'.repeat(32)}`,
    caseDigest: contextDigest,
    hypotheses: {
      standardVersion: { value: 'FHIR_R4', evidenceRefs: [evidenceRef], conflictCodes: [] },
      businessWorkflow: { value: 'PRIOR_AUTHORIZATION', evidenceRefs: [evidenceRef], conflictCodes: [] },
      exchangePattern: { value: 'SINGLE_RESOURCE', evidenceRefs: [evidenceRef], conflictCodes: [] },
      interactionKind: { value: 'REQUEST', evidenceRefs: [evidenceRef], conflictCodes: [] },
      sourceActorRoles: { values: ['PROVIDER_OR_CARE_TEAM'], evidenceRefs: [evidenceRef], conflictCodes: [] },
      destinationActorRoles: { values: ['PAYER_OR_HEALTH_PLAN'], evidenceRefs: [evidenceRef], conflictCodes: [] },
      destinationClass: { value: 'PAYER_SYSTEM', evidenceRefs: [evidenceRef], conflictCodes: [] },
    },
    missingContextQuestionCodes: [],
    proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
  }
  const hypothesisDigest = deriveHypothesisDigest(submission)
  const submissionDigest = deriveSubmissionDigest(contextDigest, hostKind, hypothesisDigest)
  return smeEvaluationRecordSchema.parse({
    schemaVersion: 'imonfhir.sme-evaluation-record.v2',
    recordId: deriveRecordId(contextDigest, hostKind, hypothesisDigest),
    taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
    contractDigests: CONTRACT_DIGESTS_V2,
    contextDigest, context, hostKind, hypothesisDigest, submissionDigest,
    hypotheses: submission.hypotheses,
    missingContextQuestionCodes: [],
    proposedNextActionCodes: submission.proposedNextActionCodes,
    review: {
      standardVersion: { verdict: 'ACCEPTED', expected: 'FHIR_R4', exactMatch: true },
      businessWorkflow: customReview
        ? { verdict: 'CORRECTED', expected: 'CARE_COORDINATION', exactMatch: false }
        : { verdict: 'ACCEPTED', expected: 'PRIOR_AUTHORIZATION', exactMatch: true },
      exchangePattern: { verdict: 'ACCEPTED', expected: 'SINGLE_RESOURCE', exactMatch: true },
      interactionKind: customReview
        ? { verdict: 'NOT_SCORABLE', expected: null, exactMatch: null }
        : { verdict: 'ACCEPTED', expected: 'REQUEST', exactMatch: true },
      sourceActorRoles: { verdict: 'ACCEPTED', expected: ['PROVIDER_OR_CARE_TEAM'], exactMatch: true },
      destinationActorRoles: { verdict: 'ACCEPTED', expected: ['PAYER_OR_HEALTH_PLAN'], exactMatch: true },
      destinationClass: { verdict: 'ACCEPTED', expected: 'PAYER_SYSTEM', exactMatch: true },
      missingContextQuestionCodes: { verdict: 'ACCEPTED', expected: [], exactMatch: true },
      proposedNextActionCodes: { verdict: 'ACCEPTED', expected: ['REVIEW_DETERMINISTIC_EVIDENCE'], exactMatch: true },
    },
  }) as SmeEvaluationRecord
}

export function jsonl(records: SmeEvaluationRecord[]): string {
  return records.slice().sort((left, right) => left.recordId.localeCompare(right.recordId)).map(canonicalJson).join('\n') + '\n'
}
