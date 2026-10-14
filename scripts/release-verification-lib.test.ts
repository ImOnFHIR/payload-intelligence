// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
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
import {
  REQUIRED_REAL_HOST_VIDEO_LABEL,
  validateHandoffEvaluationJsonl,
  validateMediaProbe,
} from './release-verification-lib.js'

function material(format: 'FHIR_JSON' | 'FHIR_XML', refSeed: string): ApprovedCaseMaterial {
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

function evaluatedRecord(
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

function jsonl(records: SmeEvaluationRecord[]): string {
  return records.slice().sort((left, right) => left.recordId.localeCompare(right.recordId)).map(canonicalJson).join('\n') + '\n'
}

describe('U2 release evidence verification', () => {
  it('requires a dual-host context and a corrected/not-scorable custom context', () => {
    const builtIn = material('FHIR_JSON', '1')
    const custom = material('FHIR_XML', '3')
    const records = [
      evaluatedRecord(builtIn, 'CODEX'),
      evaluatedRecord(builtIn, 'CLAUDE_DESKTOP'),
      evaluatedRecord(custom, 'CODEX', true),
    ]
    expect(validateHandoffEvaluationJsonl(jsonl(records))).toHaveLength(3)
    expect(() => validateHandoffEvaluationJsonl(jsonl(records.slice(0, 2)))).toThrow('HANDOFF_REQUIRED_CONTEXTS_MISSING')
    expect(() => validateHandoffEvaluationJsonl(jsonl([
      evaluatedRecord(builtIn, 'CODEX'),
      evaluatedRecord(custom, 'CODEX'),
      evaluatedRecord(material('FHIR_JSON', '5'), 'CLAUDE_DESKTOP', true),
    ]))).toThrow('HANDOFF_DUAL_HOST_CONTEXT_MISSING')
    expect(() => validateHandoffEvaluationJsonl(jsonl([
      evaluatedRecord(builtIn, 'CODEX'),
      evaluatedRecord(builtIn, 'CLAUDE_DESKTOP'),
      evaluatedRecord(custom, 'CODEX'),
    ]))).toThrow('HANDOFF_CUSTOM_REVIEW_EVIDENCE_MISSING')
    expect(() => validateHandoffEvaluationJsonl(jsonl(records).split('\n').filter(Boolean).reverse().join('\n') + '\n'))
      .toThrow('HANDOFF_EVALUATION_ORDER_OR_DUPLICATE_INVALID')
  })

  it('requires 60-90 second, silent, labelled video metadata', () => {
    const valid = {
      format: { duration: '75.0', tags: { comment: REQUIRED_REAL_HOST_VIDEO_LABEL } },
      streams: [{ codec_type: 'video' }],
    }
    expect(validateMediaProbe(valid)).toBe(75)
    expect(() => validateMediaProbe({ ...valid, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }))
      .toThrow('RELEASE_MEDIA_AUDIO_PROHIBITED')
    expect(() => validateMediaProbe({ ...valid, format: { duration: '75.0', tags: {} } }))
      .toThrow('RELEASE_MEDIA_LABEL_METADATA_MISSING')
    expect(() => validateMediaProbe({ ...valid, format: { ...valid.format, duration: '59.9' } }))
      .toThrow('RELEASE_MEDIA_DURATION_INVALID')
  })
})
