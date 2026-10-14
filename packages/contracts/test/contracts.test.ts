// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { inspectPayload } from '../../core/src/index.js'
import { canonicalDigest, canonicalJson } from '../src/canonical.js'
import { projectInspection } from '../src/projection.js'
import {
  CONTRACT_DIGESTS_V2,
  deriveHypothesisDigest,
  deriveRecordId,
  deriveSubmissionDigest,
  hostHypothesisSubmissionSchema,
  hostHypothesisSubmissionSchemaV1,
  nonAuthorHandoffReceiptSchema,
  parseApprovedCaseMaterial,
  parseHostEvaluationCase,
  parseHostHypothesisSubmission,
  smeEvaluationRecordSchema,
  validateSubmissionAgainstCase,
} from '../src/validation.js'
import type {
  HostEvaluationCase,
  HostHypothesisSubmission,
  LegacyHostHypothesisSubmission,
  SmeEvaluationRecord,
} from '../src/types.js'

describe('approved structural projection', () => {
  it('bands counts, removes exact bytes, and is stable', async () => {
    const canary = 'PRIVATE_VALUE_123456'
    const inspection = await inspectPayload(new TextEncoder().encode(JSON.stringify({ resourceType: 'Patient', name: canary, list: [1, 2, 3] })))
    const material = projectInspection(inspection)
    const serialized = canonicalJson(material)
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('byteCount')
    expect(serialized).not.toContain('"bytes"')
    expect(serialized).toContain('TWO_TO_FIVE')
    expect(parseApprovedCaseMaterial(material)).toEqual(material)
    expect(canonicalJson(material)).toBe(canonicalJson(JSON.parse(JSON.stringify(material))))
  })
})

async function v2Fixture() {
  const inspection = await inspectPayload(new TextEncoder().encode(JSON.stringify({ resourceType: 'Patient' })))
  const material = projectInspection(inspection)
  const ref = material.structuralSummary.evidenceItems[0]?.ref
  if (!ref) throw new Error('fixture evidence missing')
  const caseHandle = `ec_${'a'.repeat(32)}`
  const caseDigest = canonicalDigest(material)
  const submission = {
    schemaVersion: 'imonfhir.host-hypothesis-submission.v2',
    taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
    contractDigests: CONTRACT_DIGESTS_V2,
    caseHandle,
    caseDigest,
    hypotheses: {
      standardVersion: { value: 'UNDETERMINED', evidenceRefs: [ref], conflictCodes: ['STANDARD_VERSION_NOT_OBSERVED'] },
      businessWorkflow: { value: 'UNKNOWN_OR_OTHER', evidenceRefs: [ref], conflictCodes: ['BUSINESS_WORKFLOW_NOT_OBSERVED'] },
      exchangePattern: { value: 'UNKNOWN', evidenceRefs: [ref], conflictCodes: ['EXCHANGE_PATTERN_NOT_OBSERVED'] },
      interactionKind: { value: 'UNKNOWN', evidenceRefs: [ref], conflictCodes: ['INTERACTION_KIND_NOT_OBSERVED'] },
      sourceActorRoles: { values: ['UNKNOWN'], evidenceRefs: [ref], conflictCodes: ['SOURCE_ACTOR_ROLES_NOT_OBSERVED'] },
      destinationActorRoles: { values: ['UNKNOWN'], evidenceRefs: [ref], conflictCodes: ['DESTINATION_ACTOR_ROLES_NOT_OBSERVED'] },
      destinationClass: { value: 'UNKNOWN', evidenceRefs: [ref], conflictCodes: ['DESTINATION_CLASS_NOT_OBSERVED'] },
    },
    missingContextQuestionCodes: [
      'CONFIRM_BUSINESS_WORKFLOW', 'CONFIRM_DESTINATION_ACTOR_ROLES',
      'CONFIRM_DESTINATION_CLASS', 'CONFIRM_EXCHANGE_PATTERN',
      'CONFIRM_INTERACTION_KIND', 'CONFIRM_SOURCE_ACTOR_ROLES',
      'CONFIRM_STANDARD_VERSION',
    ],
    proposedNextActionCodes: ['ASK_TARGETED_CONTEXT'],
  } satisfies HostHypothesisSubmission
  const evaluationCase = {
    ...material,
    schemaVersion: 'imonfhir.host-evaluation-case.v2',
    caseHandle,
    caseDigest,
    expiresAt: '2026-10-14T12:00:00.000Z',
    taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
    contractDigests: CONTRACT_DIGESTS_V2,
    requiredSubmission: {
      axes: [
        'standardVersion', 'businessWorkflow', 'exchangePattern', 'interactionKind',
        'sourceActorRoles', 'destinationActorRoles', 'destinationClass',
      ],
    },
  } satisfies HostEvaluationCase
  return { material, submission, evaluationCase }
}

describe('taxonomy-v2 host submissions', () => {
  it('accepts all seven axes and rejects v1, prose, probabilities, and extra fields', async () => {
    const { submission } = await v2Fixture()
    expect(parseHostHypothesisSubmission(submission)).toEqual(submission)
    expect(() => hostHypothesisSubmissionSchema.parse({ ...submission, rationale: 'trust me' })).toThrow()
    expect(() => hostHypothesisSubmissionSchema.parse({ ...submission, confidence: 0.99 })).toThrow()

    const v1 = {
      caseHandle: submission.caseHandle,
      caseDigest: submission.caseDigest,
      hypotheses: {
        standardVersion: { value: 'UNDETERMINED', evidenceRefs: submission.hypotheses.standardVersion.evidenceRefs, conflictCodes: ['STANDARD_VERSION_NOT_OBSERVED'] },
        workflow: { value: 'UNKNOWN_OR_OTHER', evidenceRefs: submission.hypotheses.standardVersion.evidenceRefs, conflictCodes: ['INSUFFICIENT_STRUCTURAL_EVIDENCE'] },
        direction: { value: 'UNKNOWN', evidenceRefs: submission.hypotheses.standardVersion.evidenceRefs, conflictCodes: ['DIRECTION_NOT_OBSERVED'] },
        actorRoles: { values: ['UNKNOWN'], evidenceRefs: submission.hypotheses.standardVersion.evidenceRefs, conflictCodes: ['ACTOR_ROLES_NOT_OBSERVED'] },
        destinationClass: { value: 'UNKNOWN', evidenceRefs: submission.hypotheses.standardVersion.evidenceRefs, conflictCodes: ['DESTINATION_NOT_OBSERVED'] },
      },
      missingContextQuestionCodes: ['CONFIRM_STANDARD_VERSION'],
      proposedNextActionCodes: ['ASK_TARGETED_CONTEXT'],
    } satisfies LegacyHostHypothesisSubmission
    expect(hostHypothesisSubmissionSchemaV1.parse(v1)).toEqual(v1)
    expect(() => hostHypothesisSubmissionSchema.parse(v1)).toThrow()
  })

  it('requires UNKNOWN actor roles to be exclusive and arrays to be canonical sets', async () => {
    const { submission } = await v2Fixture()
    expect(() => hostHypothesisSubmissionSchema.parse({
      ...submission,
      hypotheses: {
        ...submission.hypotheses,
        sourceActorRoles: { ...submission.hypotheses.sourceActorRoles, values: ['UNKNOWN', 'OTHER'] },
      },
    })).toThrow('UNKNOWN must be the only actor role')
    expect(() => hostHypothesisSubmissionSchema.parse({
      ...submission,
      missingContextQuestionCodes: [...submission.missingContextQuestionCodes].reverse(),
    })).toThrow('Codes must be unique and sorted')
  })

  it('rejects conflict codes attached to the wrong v2 axis', async () => {
    const { submission } = await v2Fixture()
    expect(() => hostHypothesisSubmissionSchema.parse({
      ...submission,
      hypotheses: {
        ...submission.hypotheses,
        standardVersion: {
          ...submission.hypotheses.standardVersion,
          conflictCodes: ['DESTINATION_CLASS_NOT_OBSERVED'],
        },
      },
    })).toThrow()
  })

  it('binds the case, evidence, taxonomy, and exact contract digests', async () => {
    const { submission, evaluationCase } = await v2Fixture()
    expect(() => validateSubmissionAgainstCase(submission, evaluationCase)).not.toThrow()
    expect(() => validateSubmissionAgainstCase({
      ...submission,
      hypotheses: {
        ...submission.hypotheses,
        standardVersion: { ...submission.hypotheses.standardVersion, evidenceRefs: ['ev_2222222222222222'] },
      },
    }, evaluationCase)).toThrow('INVALID_EVIDENCE_REFERENCE')
    expect(() => parseHostHypothesisSubmission({
      ...submission,
      contractDigests: { ...submission.contractDigests, taxonomy: 'f'.repeat(64) },
    })).toThrow('CONTRACT_VERSION_MISMATCH')
    const tamperedCase: HostEvaluationCase = {
      ...evaluationCase,
      observation: { ...evaluationCase.observation, status: 'AMBIGUOUS' },
    }
    expect(() => parseHostEvaluationCase(tamperedCase)).toThrow('STALE_CASE')
    expect(() => validateSubmissionAgainstCase(submission, tamperedCase)).toThrow('STALE_CASE')
  })

  it('derives a handle-free hypothesis digest and stable record identity', async () => {
    const { submission } = await v2Fixture()
    const digest = deriveHypothesisDigest(submission)
    expect(deriveHypothesisDigest({ ...submission, caseHandle: `ec_${'f'.repeat(32)}` })).toBe(digest)
    const otherContext = '9'.repeat(64)
    expect(deriveSubmissionDigest(submission.caseDigest, 'CODEX', digest)).not.toBe(
      deriveSubmissionDigest(otherContext, 'CODEX', digest),
    )
    expect(deriveRecordId(submission.caseDigest, 'CODEX', digest)).toMatch(/^sr_[a-f0-9]{32}$/)
  })
})

describe('taxonomy-v2 SME records', () => {
  async function reviewedRecord(): Promise<SmeEvaluationRecord> {
    const { material, submission } = await v2Fixture()
    const hypothesisDigest = deriveHypothesisDigest(submission)
    const submissionDigest = deriveSubmissionDigest(submission.caseDigest, 'CODEX', hypothesisDigest)
    return {
      schemaVersion: 'imonfhir.sme-evaluation-record.v2',
      recordId: deriveRecordId(submission.caseDigest, 'CODEX', hypothesisDigest),
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
      contractDigests: CONTRACT_DIGESTS_V2,
      contextDigest: submission.caseDigest,
      context: material,
      hostKind: 'CODEX',
      hypothesisDigest,
      submissionDigest,
      hypotheses: submission.hypotheses,
      missingContextQuestionCodes: submission.missingContextQuestionCodes,
      proposedNextActionCodes: submission.proposedNextActionCodes,
      review: {
        standardVersion: { verdict: 'ACCEPTED', expected: 'UNDETERMINED', exactMatch: true },
        businessWorkflow: { verdict: 'ACCEPTED', expected: 'UNKNOWN_OR_OTHER', exactMatch: true },
        exchangePattern: { verdict: 'ACCEPTED', expected: 'UNKNOWN', exactMatch: true },
        interactionKind: { verdict: 'ACCEPTED', expected: 'UNKNOWN', exactMatch: true },
        sourceActorRoles: { verdict: 'ACCEPTED', expected: ['UNKNOWN'], exactMatch: true },
        destinationActorRoles: { verdict: 'ACCEPTED', expected: ['UNKNOWN'], exactMatch: true },
        destinationClass: { verdict: 'ACCEPTED', expected: 'UNKNOWN', exactMatch: true },
        missingContextQuestionCodes: { verdict: 'ACCEPTED', expected: submission.missingContextQuestionCodes, exactMatch: true },
        proposedNextActionCodes: { verdict: 'ACCEPTED', expected: submission.proposedNextActionCodes, exactMatch: true },
      },
    }
  }

  it('reviews all seven axes and both exact sets', async () => {
    const record = await reviewedRecord()
    expect(smeEvaluationRecordSchema.parse(record)).toEqual(record)
  })

  it('requires CORRECTED values and sets to differ', async () => {
    const record = await reviewedRecord()
    expect(() => smeEvaluationRecordSchema.parse({
      ...record,
      review: {
        ...record.review,
        businessWorkflow: { verdict: 'CORRECTED', expected: 'UNKNOWN_OR_OTHER', exactMatch: false },
      },
    })).toThrow('derived exact-match result are inconsistent')
    expect(() => smeEvaluationRecordSchema.parse({
      ...record,
      review: {
        ...record.review,
        missingContextQuestionCodes: {
          verdict: 'CORRECTED',
          expected: record.missingContextQuestionCodes,
          exactMatch: false,
        },
      },
    })).toThrow('derived exact-match result are inconsistent')
  })

  it('rejects user-entered exact-match results that contradict the verdict', async () => {
    const record = await reviewedRecord()
    expect(() => smeEvaluationRecordSchema.parse({
      ...record,
      review: {
        ...record.review,
        interactionKind: { verdict: 'NOT_SCORABLE', expected: null, exactMatch: true },
      },
    })).toThrow()
  })
})

describe('fixed contract digests and handoff receipt', () => {
  it('publishes exactly the fixed v2 digest keys', () => {
    expect(Object.keys(CONTRACT_DIGESTS_V2)).toEqual([
      'taxonomy', 'evaluatorCapabilities', 'hostEvaluationCase',
      'hostHypothesisSubmission', 'hostHypothesisReceipt', 'smeEvaluationRecord',
    ])
    expect(Object.values(CONTRACT_DIGESTS_V2)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]),
    )
  })

  it('keeps the non-author receipt controlled and closed', () => {
    const receipt = {
      schemaVersion: 'imonfhir.non-author-handoff-receipt.v1',
      label: 'NON_AUTHOR_USABILITY_SMOKE_TEST · NOT INDEPENDENT REVIEW',
      testedCommit: 'a'.repeat(40),
      platformClass: 'MACOS_ARM64',
      elapsedSetupMinutes: 8.5,
      checklist: {
        freshClonePathWithSpaces: 'PASS', uiReachableUnderTenMinutes: 'PASS',
        codexConfiguredWithoutOwnerCoaching: 'PASS', claudeConfiguredWithoutOwnerCoaching: 'PASS',
        sameCaseRetrievedByBothHosts: 'PASS', bothHostSubmissionsPreserved: 'PASS',
        bothHostEvaluationsSaved: 'PASS', customSyntheticCaseCompleted: 'PASS',
        correctedAtLeastOneResult: 'PASS', markedAtLeastOneResultNotScorable: 'PASS',
        questionAndActionSetsReviewed: 'PASS', deterministicV2JsonlExported: 'PASS',
        casePurged: 'PASS', nonClaimsExplainedWithoutAssistance: 'PASS',
      },
      blockerCodes: ['NONE'],
      artifactDigests: {
        candidateSourceTreeSha256: 'b'.repeat(64), evaluationExportSha256: 'c'.repeat(64),
        recordingMp4Sha256: 'd'.repeat(64), recordingDescriptorSha256: 'e'.repeat(64),
      },
    }
    expect(nonAuthorHandoffReceiptSchema.parse(receipt)).toEqual(receipt)
    expect(() => nonAuthorHandoffReceiptSchema.parse({ ...receipt, participant: 'someone' })).toThrow()
    expect(() => nonAuthorHandoffReceiptSchema.parse({ ...receipt, blockerCodes: ['NONE', 'EXPORT_FAILED'] })).toThrow()
  })
})
