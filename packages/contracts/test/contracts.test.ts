// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { inspectPayload } from '../../core/src/index.js'
import { canonicalJson } from '../src/canonical.js'
import { projectInspection } from '../src/projection.js'
import {
  hostHypothesisSubmissionSchema,
  parseApprovedCaseMaterial,
  smeEvaluationRecordSchema,
  validateSubmissionAgainstCase,
} from '../src/validation.js'
import type { HostEvaluationCase, HostHypothesisSubmission } from '../src/types.js'

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

describe('closed host submissions', () => {
  const base = {
    caseHandle: `ec_${'a'.repeat(32)}`,
    caseDigest: 'b'.repeat(64),
    hypotheses: {
      standardVersion: { value: 'UNDETERMINED', evidenceRefs: ['ev_1111111111111111'], conflictCodes: ['STANDARD_VERSION_NOT_OBSERVED'] },
      workflow: { value: 'UNKNOWN_OR_OTHER', evidenceRefs: ['ev_1111111111111111'], conflictCodes: ['INSUFFICIENT_STRUCTURAL_EVIDENCE'] },
      direction: { value: 'UNKNOWN', evidenceRefs: ['ev_1111111111111111'], conflictCodes: ['DIRECTION_NOT_OBSERVED'] },
      actorRoles: { values: ['UNKNOWN'], evidenceRefs: ['ev_1111111111111111'], conflictCodes: ['ACTOR_ROLES_NOT_OBSERVED'] },
      destinationClass: { value: 'UNKNOWN', evidenceRefs: ['ev_1111111111111111'], conflictCodes: ['DESTINATION_NOT_OBSERVED'] },
    },
    missingContextQuestionCodes: ['CONFIRM_STANDARD_VERSION', 'CONFIRM_WORKFLOW', 'CONFIRM_DIRECTION', 'CONFIRM_ACTOR_ROLES', 'CONFIRM_DESTINATION_CLASS'],
    proposedNextActionCodes: ['ASK_TARGETED_CONTEXT'],
  } satisfies HostHypothesisSubmission

  it('rejects arbitrary prose and probability fields', () => {
    expect(() => hostHypothesisSubmissionSchema.parse({ ...base, rationale: 'trust me' })).toThrow()
    expect(() => hostHypothesisSubmissionSchema.parse({ ...base, confidence: 0.99 })).toThrow()
  })

  it('rejects evidence not offered by the case', () => {
    const evaluationCase = {
      schemaVersion: 'imonfhir.host-evaluation-case.v1',
      caseHandle: base.caseHandle,
      caseDigest: base.caseDigest,
      expiresAt: '2026-10-13T00:00:00.000Z',
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1',
      requiredSubmission: { axes: ['standardVersion', 'workflow', 'direction', 'actorRoles', 'destinationClass'] },
      observation: { status: 'DETECTED', candidates: [], conflictCodes: [], issueCodes: [] },
      structuralSummary: {
        schemaVersion: 'imonfhir.approved-structural-summary.v1',
        format: 'GENERIC_JSON',
        evidenceItems: [{ ref: 'ev_2222222222222222', kind: 'FORMAT', code: 'GENERIC_JSON' }],
        safety: { payloadValuesAbsent: true, identifiersAbsent: true, freeTextAbsent: true, binaryContentAbsent: true, unknownNamesHashed: true, exactCountsAbsent: true },
      },
    } as HostEvaluationCase
    expect(() => validateSubmissionAgainstCase(base, evaluationCase)).toThrow('INVALID_EVIDENCE_REFERENCE')
  })

  async function reviewedRecord() {
    const inspection = await inspectPayload(new TextEncoder().encode(JSON.stringify({ resourceType: 'Patient' })))
    return {
      schemaVersion: 'imonfhir.sme-evaluation-record.v1',
      recordId: `sr_${'c'.repeat(32)}`,
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1',
      contextDigest: 'd'.repeat(64),
      context: projectInspection(inspection),
      hostKind: 'CODEX',
      hypotheses: base.hypotheses,
      missingContextQuestionCodes: base.missingContextQuestionCodes,
      proposedNextActionCodes: base.proposedNextActionCodes,
      review: {
        standardVersion: { verdict: 'ACCEPTED', expected: 'UNDETERMINED', exactMatch: true },
        workflow: { verdict: 'ACCEPTED', expected: 'UNKNOWN_OR_OTHER', exactMatch: true },
        direction: { verdict: 'ACCEPTED', expected: 'UNKNOWN', exactMatch: true },
        actorRoles: { verdict: 'ACCEPTED', expected: ['UNKNOWN'], exactMatch: true },
        destinationClass: { verdict: 'ACCEPTED', expected: 'UNKNOWN', exactMatch: true },
      },
    }
  }

  it('keeps UNREVIEWED out of the public evaluation-record contract', async () => {
    const record = await reviewedRecord()
    expect(() => smeEvaluationRecordSchema.parse({
      ...record,
      review: {
        ...record.review,
        workflow: { verdict: 'UNREVIEWED', expected: 'UNKNOWN_OR_OTHER', exactMatch: null },
      },
    })).toThrow()
  })

  it('requires a corrected value to differ from the host hypothesis', async () => {
    const record = await reviewedRecord()
    expect(() => smeEvaluationRecordSchema.parse({
      ...record,
      review: {
        ...record.review,
        workflow: { verdict: 'CORRECTED', expected: 'UNKNOWN_OR_OTHER', exactMatch: false },
      },
    })).toThrow('Review verdict, expected value, and exact-match result are inconsistent.')

    expect(smeEvaluationRecordSchema.parse({
      ...record,
      review: {
        ...record.review,
        workflow: { verdict: 'CORRECTED', expected: 'RESOURCE_EXCHANGE', exactMatch: false },
      },
    }).review.workflow).toEqual({ verdict: 'CORRECTED', expected: 'RESOURCE_EXCHANGE', exactMatch: false })
  })
})
