// SPDX-License-Identifier: Apache-2.0

import {
  ACTOR_ROLES,
  CONFLICT_CODES,
  DESTINATION_CLASSES,
  DIRECTIONS,
  NEXT_ACTION_CODES,
  PAYLOAD_FORMATS,
  QUESTION_CODES,
  SHAPE_SKETCH_ALLOWED_FEATURE_NAMES,
  SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE,
  STANDARD_VERSIONS,
  WORKFLOWS,
} from '@imonfhir/payload-core'
import { z } from 'zod'
import type { ApprovedCaseMaterial, HostEvaluationCase, HostHypothesisSubmission } from './types.js'

const handle = z.string().regex(/^ec_[a-f0-9]{32}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const evidenceRef = z.string().regex(/^ev_[a-f0-9]{16}$/)
const conflictCode = z.enum(CONFLICT_CODES)
const safeFeatureName = z.string().refine((value) =>
  SHAPE_SKETCH_ALLOWED_FEATURE_NAMES.includes(value) ||
  new RegExp(`^(?:${SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE})$`).test(value),
)
const countBandSchema = z.enum([
  'ZERO', 'ONE', 'TWO_TO_FIVE', 'SIX_TO_TWENTY', 'TWENTY_ONE_TO_ONE_HUNDRED', 'OVER_ONE_HUNDRED',
])
const dataTypeSchema = z.enum(['object', 'array', 'string', 'number', 'boolean', 'null', 'element', 'segment'])

const evidenceItemSchema = z.discriminatedUnion('kind', [
  z.object({ ref: evidenceRef, kind: z.literal('FORMAT'), code: z.enum(PAYLOAD_FORMATS) }).strict(),
  z.object({ ref: evidenceRef, kind: z.literal('DETECTOR'), code: z.string().regex(/^[A-Z0-9_]{2,80}$/) }).strict(),
  z.object({ ref: evidenceRef, kind: z.literal('SHAPE'), code: z.enum(['COMPLETE', 'TRUNCATED']) }).strict(),
  z.object({
    ref: evidenceRef,
    kind: z.literal('AGGREGATE'),
    code: z.enum(['LINES', 'RECORDS', 'SEGMENTS', 'ELEMENTS']),
    countBand: countBandSchema,
  }).strict(),
  z.object({
    ref: evidenceRef,
    kind: z.literal('FEATURE'),
    feature: z.object({
      kind: z.enum(['STRUCTURAL_NAME', 'DATA_TYPE', 'COUNT', 'SAFE_MARKER']),
      name: safeFeatureName,
      structuralPath: z.string().regex(/^[A-Za-z0-9_$./\[\]-]{1,512}$/).optional(),
      dataType: dataTypeSchema.optional(),
      countBand: countBandSchema.optional(),
    }).strict(),
  }).strict(),
])

export const approvedCaseMaterialSchema = z.object({
  schemaVersion: z.literal('imonfhir.approved-case-material.v1'),
  observation: z.object({
    status: z.enum(['DETECTED', 'AMBIGUOUS', 'OPAQUE', 'UNKNOWN', 'REJECTED']),
    observedFormat: z.enum(PAYLOAD_FORMATS).optional(),
    candidates: z.array(z.object({
      format: z.enum(PAYLOAD_FORMATS),
      signature: z.enum(['DETERMINISTIC', 'HEURISTIC', 'OPAQUE_MAGIC']),
      evidenceCodes: z.array(z.string().regex(/^[A-Z0-9_]{2,80}$/)).max(32),
    }).strict()).max(8),
    conflictCodes: z.array(z.string().regex(/^[A-Z0-9_]{2,80}$/)).max(16),
    issueCodes: z.array(z.string().regex(/^[A-Z0-9_]{2,80}$/)).max(16),
  }).strict(),
  structuralSummary: z.object({
    schemaVersion: z.literal('imonfhir.approved-structural-summary.v1'),
    format: z.enum(PAYLOAD_FORMATS),
    evidenceItems: z.array(evidenceItemSchema).min(2).max(300),
    safety: z.object({
      payloadValuesAbsent: z.literal(true),
      identifiersAbsent: z.literal(true),
      freeTextAbsent: z.literal(true),
      binaryContentAbsent: z.literal(true),
      unknownNamesHashed: z.literal(true),
      exactCountsAbsent: z.literal(true),
    }).strict(),
  }).strict(),
}).strict()

export function parseApprovedCaseMaterial(input: unknown): ApprovedCaseMaterial {
  return approvedCaseMaterialSchema.parse(input) as ApprovedCaseMaterial
}

function scalarHypothesis<T extends readonly [string, ...string[]]>(values: T) {
  return z.object({
    value: z.enum(values),
    evidenceRefs: z.array(evidenceRef).min(1).max(8),
    conflictCodes: z.array(conflictCode).max(4),
  }).strict()
}

const actorRoles = z.object({
  values: z.array(z.enum(ACTOR_ROLES)).min(1).max(8),
  evidenceRefs: z.array(evidenceRef).min(1).max(8),
  conflictCodes: z.array(conflictCode).max(4),
}).strict().superRefine((value, context) => {
  if (new Set(value.values).size !== value.values.length) {
    context.addIssue({ code: 'custom', message: 'Actor roles must be unique.' })
  }
  if ([...value.values].sort().join('|') !== value.values.join('|')) {
    context.addIssue({ code: 'custom', message: 'Actor roles must be sorted.' })
  }
  if (value.values.includes('UNKNOWN') && value.values.length !== 1) {
    context.addIssue({ code: 'custom', message: 'UNKNOWN must be the only actor role.' })
  }
})

export const hostHypothesisSubmissionSchema = z.object({
  caseHandle: handle,
  caseDigest: digest,
  hypotheses: z.object({
    standardVersion: scalarHypothesis(STANDARD_VERSIONS),
    workflow: scalarHypothesis(WORKFLOWS),
    direction: scalarHypothesis(DIRECTIONS),
    actorRoles,
    destinationClass: scalarHypothesis(DESTINATION_CLASSES),
  }).strict(),
  missingContextQuestionCodes: z.array(z.enum(QUESTION_CODES)).max(6),
  proposedNextActionCodes: z.array(z.enum(NEXT_ACTION_CODES)).max(11),
}).strict()

export const hostEvaluationCaseSchema = approvedCaseMaterialSchema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal('imonfhir.host-evaluation-case.v1'),
  caseHandle: handle,
  caseDigest: digest,
  expiresAt: z.iso.datetime({ offset: true }),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v1'),
  requiredSubmission: z.object({
    axes: z.tuple([
      z.literal('standardVersion'), z.literal('workflow'), z.literal('direction'),
      z.literal('actorRoles'), z.literal('destinationClass'),
    ]),
  }).strict(),
}).strict()

export const hostHypothesisReceiptSchema = z.object({
  schemaVersion: z.literal('imonfhir.host-hypothesis-receipt.v1'),
  caseHandle: handle,
  caseDigest: digest,
  submissionId: z.string().regex(/^hs_[a-f0-9]{32}$/),
  submissionDigest: digest,
  hostKind: z.enum(['CODEX', 'CLAUDE_DESKTOP']),
  state: z.literal('PENDING_SME_REVIEW'),
  deduplicated: z.boolean(),
}).strict()

export const evaluatorCapabilitiesSchema = z.object({
  schemaVersion: z.literal('imonfhir.evaluator-capabilities.v1'),
  mode: z.literal('HOST_ASSISTED_SME_EVALUATION'),
  bundledModel: z.literal(false),
  supportedHosts: z.tuple([z.literal('CODEX'), z.literal('CLAUDE_DESKTOP')]),
  caseCreation: z.literal('UI_ONLY_EXPLICIT_APPROVAL'),
  hostReceives: z.literal('APPROVED_STRUCTURAL_SUMMARY_ONLY'),
  probabilitiesAccepted: z.literal(false),
  freeTextAccepted: z.literal(false),
  rawPayloadAccepted: z.literal(false),
  syntheticOnly: z.literal(true),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v1'),
  recognizedFormats: z.array(z.enum(PAYLOAD_FORMATS)),
  hostEligibleFormats: z.array(z.enum(PAYLOAD_FORMATS)),
  hostBlockedFormats: z.array(z.enum(PAYLOAD_FORMATS)),
  limits: z.object({
    maxPayloadBytes: z.literal(8_000_000),
    maxJsonDepth: z.literal(64),
    maxNdjsonLines: z.literal(10_000),
    maxNdjsonLineBytes: z.literal(1_000_000),
    maxHl7Segments: z.literal(10_000),
    maxEvidenceItems: z.literal(300),
    caseTtlSeconds: z.literal(14_400),
  }).strict(),
  limitations: z.array(z.enum([
    'SYNTHETIC_DATA_ONLY', 'NOT_A_VALIDATOR', 'NOT_CALIBRATED',
    'NO_CLINICAL_OR_PAYER_DECISIONS', 'HOST_PROVIDER_MAY_RECEIVE_APPROVED_SUMMARY',
  ])).min(5).max(5),
}).strict()

const axisVerdict = z.enum(['ACCEPTED', 'CORRECTED', 'NOT_SCORABLE'])
function scalarReview<T extends readonly [string, ...string[]]>(values: T) {
  return z.object({ verdict: axisVerdict, expected: z.enum(values).nullable(), exactMatch: z.boolean().nullable() }).strict()
}

export const smeEvaluationRecordSchema = z.object({
  schemaVersion: z.literal('imonfhir.sme-evaluation-record.v1'),
  recordId: z.string().regex(/^sr_[a-f0-9]{32}$/),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v1'),
  contextDigest: digest,
  context: approvedCaseMaterialSchema,
  hostKind: z.enum(['CODEX', 'CLAUDE_DESKTOP']),
  hypotheses: hostHypothesisSubmissionSchema.shape.hypotheses,
  missingContextQuestionCodes: z.array(z.enum(QUESTION_CODES)).max(6),
  proposedNextActionCodes: z.array(z.enum(NEXT_ACTION_CODES)).max(11),
  review: z.object({
    standardVersion: scalarReview(STANDARD_VERSIONS),
    workflow: scalarReview(WORKFLOWS),
    direction: scalarReview(DIRECTIONS),
    actorRoles: z.object({
      verdict: axisVerdict,
      expected: z.array(z.enum(ACTOR_ROLES)).min(1).max(8).nullable(),
      exactMatch: z.boolean().nullable(),
    }).strict(),
    destinationClass: scalarReview(DESTINATION_CLASSES),
  }).strict(),
}).strict()

export function parseHostHypothesisSubmission(input: unknown): HostHypothesisSubmission {
  return hostHypothesisSubmissionSchema.parse(input) as HostHypothesisSubmission
}

export function validateSubmissionAgainstCase(
  submission: HostHypothesisSubmission,
  evaluationCase: HostEvaluationCase,
): void {
  if (submission.caseHandle !== evaluationCase.caseHandle) throw new Error('EXPIRED_CASE')
  if (submission.caseDigest !== evaluationCase.caseDigest) throw new Error('STALE_CASE')
  const offered = new Set(evaluationCase.structuralSummary.evidenceItems.map((item) => item.ref))
  const referenced = [
    submission.hypotheses.standardVersion.evidenceRefs,
    submission.hypotheses.workflow.evidenceRefs,
    submission.hypotheses.direction.evidenceRefs,
    submission.hypotheses.actorRoles.evidenceRefs,
    submission.hypotheses.destinationClass.evidenceRefs,
  ].flat()
  if (referenced.some((ref) => !offered.has(ref))) throw new Error('INVALID_EVIDENCE_REFERENCE')

  const questions = new Set(submission.missingContextQuestionCodes)
  const checks: Array<[boolean, string, string]> = [
    [submission.hypotheses.standardVersion.value === 'UNDETERMINED', 'STANDARD_VERSION_NOT_OBSERVED', 'CONFIRM_STANDARD_VERSION'],
    [submission.hypotheses.workflow.value === 'UNKNOWN_OR_OTHER', 'INSUFFICIENT_STRUCTURAL_EVIDENCE', 'CONFIRM_WORKFLOW'],
    [submission.hypotheses.direction.value === 'UNKNOWN', 'DIRECTION_NOT_OBSERVED', 'CONFIRM_DIRECTION'],
    [submission.hypotheses.actorRoles.values.includes('UNKNOWN'), 'ACTOR_ROLES_NOT_OBSERVED', 'CONFIRM_ACTOR_ROLES'],
    [submission.hypotheses.destinationClass.value === 'UNKNOWN', 'DESTINATION_NOT_OBSERVED', 'CONFIRM_DESTINATION_CLASS'],
  ]
  const axisHypotheses = [
    submission.hypotheses.standardVersion,
    submission.hypotheses.workflow,
    submission.hypotheses.direction,
    submission.hypotheses.actorRoles,
    submission.hypotheses.destinationClass,
  ]
  checks.forEach(([unknown, conflict, question], index) => {
    if (!unknown) return
    if (!axisHypotheses[index]?.conflictCodes.includes(conflict as never) || !questions.has(question as never)) {
      throw new Error('INVALID_HYPOTHESES')
    }
  })
}
