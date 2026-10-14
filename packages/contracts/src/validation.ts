// SPDX-License-Identifier: Apache-2.0

import {
  ACTOR_ROLES,
  BUSINESS_WORKFLOWS,
  CONFLICT_CODES_V1,
  DESTINATION_CLASSES,
  DIRECTIONS_V1,
  EVALUATION_TAXONOMY,
  EXCHANGE_PATTERNS,
  INTERACTION_KINDS,
  NEXT_ACTION_CODES,
  NEXT_ACTION_CODES_V1,
  PAYLOAD_FORMATS,
  QUESTION_CODES,
  QUESTION_CODES_V1,
  SHAPE_SKETCH_ALLOWED_FEATURE_NAMES,
  SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE,
  STANDARD_VERSIONS,
  WORKFLOWS_V1,
} from '@imonfhir/payload-core'
import { z } from 'zod'
import { canonicalDigest } from './canonical.js'
import type {
  ApprovedCaseMaterial,
  ContractDigestsV2,
  HostEvaluationCase,
  HostHypothesisSubmission,
  HostKind,
  LegacyHostEvaluationCase,
  LegacyHostHypothesisSubmission,
  SmeEvaluationRecord,
} from './types.js'

const handle = z.string().regex(/^ec_[a-f0-9]{32}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const evidenceRef = z.string().regex(/^ev_[a-f0-9]{16}$/)
const safeFeatureName = z.string().refine((value) =>
  SHAPE_SKETCH_ALLOWED_FEATURE_NAMES.includes(value) ||
  new RegExp(`^(?:${SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE})$`).test(value),
)
const countBandSchema = z.enum([
  'ZERO', 'ONE', 'TWO_TO_FIVE', 'SIX_TO_TWENTY', 'TWENTY_ONE_TO_ONE_HUNDRED', 'OVER_ONE_HUNDRED',
])
const dataTypeSchema = z.enum(['object', 'array', 'string', 'number', 'boolean', 'null', 'element', 'segment'])

function uniqueSorted<T extends string>(values: T[]): boolean {
  return new Set(values).size === values.length && [...values].sort().join('|') === values.join('|')
}

function closedCodeSet<T extends readonly [string, ...string[]]>(values: T, maximum: number) {
  return z.array(z.enum(values)).max(maximum).superRefine((items, context) => {
    if (!uniqueSorted(items)) context.addIssue({ code: 'custom', message: 'Codes must be unique and sorted.' })
  })
}

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

function scalarHypothesis<T extends readonly [string, ...string[]], C extends readonly [string, ...string[]]>(
  values: T,
  conflicts: C,
) {
  return z.object({
    value: z.enum(values),
    evidenceRefs: z.array(evidenceRef).min(1).max(8).superRefine((items, context) => {
      if (!uniqueSorted(items)) context.addIssue({ code: 'custom', message: 'Evidence references must be unique and sorted.' })
    }),
    conflictCodes: closedCodeSet(conflicts, 8),
  }).strict()
}

function legacyScalarHypothesis<T extends readonly [string, ...string[]]>(values: T) {
  return z.object({
    value: z.enum(values),
    evidenceRefs: z.array(evidenceRef).min(1).max(8),
    conflictCodes: z.array(z.enum(CONFLICT_CODES_V1)).max(4),
  }).strict()
}

function actorHypothesis<C extends readonly [string, ...string[]]>(conflicts: C) {
  return z.object({
    values: z.array(z.enum(ACTOR_ROLES)).min(1).max(8),
    evidenceRefs: z.array(evidenceRef).min(1).max(8).superRefine((items, context) => {
      if (!uniqueSorted(items)) context.addIssue({ code: 'custom', message: 'Evidence references must be unique and sorted.' })
    }),
    conflictCodes: closedCodeSet(conflicts, 8),
  }).strict().superRefine((value, context) => {
    if (!uniqueSorted(value.values)) context.addIssue({ code: 'custom', message: 'Actor roles must be unique and sorted.' })
    if (value.values.includes('UNKNOWN') && value.values.length !== 1) {
      context.addIssue({ code: 'custom', message: 'UNKNOWN must be the only actor role.' })
    }
  })
}

const legacyActorHypothesis = z.object({
  values: z.array(z.enum(ACTOR_ROLES)).min(1).max(8),
  evidenceRefs: z.array(evidenceRef).min(1).max(8),
  conflictCodes: z.array(z.enum(CONFLICT_CODES_V1)).max(4),
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

// Frozen v1 contracts. They remain available for legacy export/clear only.
const legacyHypothesesSchema = z.object({
  standardVersion: legacyScalarHypothesis(STANDARD_VERSIONS),
  workflow: legacyScalarHypothesis(WORKFLOWS_V1),
  direction: legacyScalarHypothesis(DIRECTIONS_V1),
  actorRoles: legacyActorHypothesis,
  destinationClass: legacyScalarHypothesis(DESTINATION_CLASSES),
}).strict()

export const hostHypothesisSubmissionSchemaV1 = z.object({
  caseHandle: handle,
  caseDigest: digest,
  hypotheses: legacyHypothesesSchema,
  missingContextQuestionCodes: z.array(z.enum(QUESTION_CODES_V1)).max(6),
  proposedNextActionCodes: z.array(z.enum(NEXT_ACTION_CODES_V1)).max(11),
}).strict()

export const hostEvaluationCaseSchemaV1 = approvedCaseMaterialSchema.omit({ schemaVersion: true }).extend({
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

export const hostHypothesisReceiptSchemaV1 = z.object({
  schemaVersion: z.literal('imonfhir.host-hypothesis-receipt.v1'),
  caseHandle: handle,
  caseDigest: digest,
  submissionId: z.string().regex(/^hs_[a-f0-9]{32}$/),
  submissionDigest: digest,
  hostKind: z.enum(['CODEX', 'CLAUDE_DESKTOP']),
  state: z.literal('PENDING_SME_REVIEW'),
  deduplicated: z.boolean(),
}).strict()

export const evaluatorCapabilitiesSchemaV1 = z.object({
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

function actorReview() {
  return z.object({
    verdict: axisVerdict,
    expected: z.array(z.enum(ACTOR_ROLES)).min(1).max(8).nullable(),
    exactMatch: z.boolean().nullable(),
  }).strict()
}

function sameValues(left: string[], right: string[]): boolean {
  return [...left].sort().join('|') === [...right].sort().join('|')
}

export const smeEvaluationRecordSchemaV1 = z.object({
  schemaVersion: z.literal('imonfhir.sme-evaluation-record.v1'),
  recordId: z.string().regex(/^sr_[a-f0-9]{32}$/),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v1'),
  contextDigest: digest,
  context: approvedCaseMaterialSchema,
  hostKind: z.enum(['CODEX', 'CLAUDE_DESKTOP']),
  hypotheses: legacyHypothesesSchema,
  missingContextQuestionCodes: z.array(z.enum(QUESTION_CODES_V1)).max(6),
  proposedNextActionCodes: z.array(z.enum(NEXT_ACTION_CODES_V1)).max(11),
  review: z.object({
    standardVersion: scalarReview(STANDARD_VERSIONS),
    workflow: scalarReview(WORKFLOWS_V1),
    direction: scalarReview(DIRECTIONS_V1),
    actorRoles: actorReview(),
    destinationClass: scalarReview(DESTINATION_CLASSES),
  }).strict(),
}).strict().superRefine((record, context) => {
  const scalarAxes = ['standardVersion', 'workflow', 'direction', 'destinationClass'] as const
  for (const axis of scalarAxes) {
    const review = record.review[axis]
    const submitted = record.hypotheses[axis].value
    const valid = review.verdict === 'ACCEPTED'
      ? review.expected === submitted && review.exactMatch === true
      : review.verdict === 'CORRECTED'
        ? review.expected !== null && review.expected !== submitted && review.exactMatch === false
        : review.expected === null && review.exactMatch === null
    if (!valid) context.addIssue({ code: 'custom', path: ['review', axis], message: 'Review verdict, expected value, and exact-match result are inconsistent.' })
  }
  checkSetReview(record.review.actorRoles, record.hypotheses.actorRoles.values, context, ['review', 'actorRoles'])
})

const contractDigestsSchema = z.object({
  taxonomy: digest,
  evaluatorCapabilities: digest,
  hostEvaluationCase: digest,
  hostHypothesisSubmission: digest,
  hostHypothesisReceipt: digest,
  smeEvaluationRecord: digest,
}).strict()

const COMMON_AXIS_CONFLICTS = [
  'DECLARED_METADATA_CONFLICT', 'DETERMINISTIC_FORMAT_CONFLICT',
  'INSUFFICIENT_STRUCTURAL_EVIDENCE', 'SHAPE_SKETCH_TRUNCATED',
] as const
const STANDARD_VERSION_CONFLICTS = [...COMMON_AXIS_CONFLICTS, 'STANDARD_VERSION_NOT_OBSERVED'] as const
const BUSINESS_WORKFLOW_CONFLICTS = [
  ...COMMON_AXIS_CONFLICTS, 'BUSINESS_WORKFLOW_NOT_OBSERVED', 'MULTIPLE_BUSINESS_WORKFLOWS_PLAUSIBLE',
] as const
const EXCHANGE_PATTERN_CONFLICTS = [...COMMON_AXIS_CONFLICTS, 'EXCHANGE_PATTERN_NOT_OBSERVED'] as const
const INTERACTION_KIND_CONFLICTS = [...COMMON_AXIS_CONFLICTS, 'INTERACTION_KIND_NOT_OBSERVED'] as const
const SOURCE_ACTOR_ROLE_CONFLICTS = [...COMMON_AXIS_CONFLICTS, 'SOURCE_ACTOR_ROLES_NOT_OBSERVED'] as const
const DESTINATION_ACTOR_ROLE_CONFLICTS = [...COMMON_AXIS_CONFLICTS, 'DESTINATION_ACTOR_ROLES_NOT_OBSERVED'] as const
const DESTINATION_CLASS_CONFLICTS = [...COMMON_AXIS_CONFLICTS, 'DESTINATION_CLASS_NOT_OBSERVED'] as const

const v2HypothesesSchema = z.object({
  standardVersion: scalarHypothesis(STANDARD_VERSIONS, STANDARD_VERSION_CONFLICTS),
  businessWorkflow: scalarHypothesis(BUSINESS_WORKFLOWS, BUSINESS_WORKFLOW_CONFLICTS),
  exchangePattern: scalarHypothesis(EXCHANGE_PATTERNS, EXCHANGE_PATTERN_CONFLICTS),
  interactionKind: scalarHypothesis(INTERACTION_KINDS, INTERACTION_KIND_CONFLICTS),
  sourceActorRoles: actorHypothesis(SOURCE_ACTOR_ROLE_CONFLICTS),
  destinationActorRoles: actorHypothesis(DESTINATION_ACTOR_ROLE_CONFLICTS),
  destinationClass: scalarHypothesis(DESTINATION_CLASSES, DESTINATION_CLASS_CONFLICTS),
}).strict()

const questionCodeSet = closedCodeSet(QUESTION_CODES, QUESTION_CODES.length)
const nextActionCodeSet = closedCodeSet(NEXT_ACTION_CODES, NEXT_ACTION_CODES.length)

export const hostHypothesisSubmissionSchema = z.object({
  schemaVersion: z.literal('imonfhir.host-hypothesis-submission.v2'),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v2'),
  contractDigests: contractDigestsSchema,
  caseHandle: handle,
  caseDigest: digest,
  hypotheses: v2HypothesesSchema,
  missingContextQuestionCodes: questionCodeSet,
  proposedNextActionCodes: nextActionCodeSet,
}).strict()

export const hostEvaluationCaseSchema = approvedCaseMaterialSchema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal('imonfhir.host-evaluation-case.v2'),
  caseHandle: handle,
  caseDigest: digest,
  expiresAt: z.iso.datetime({ offset: true }),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v2'),
  contractDigests: contractDigestsSchema,
  requiredSubmission: z.object({
    axes: z.tuple([
      z.literal('standardVersion'), z.literal('businessWorkflow'), z.literal('exchangePattern'),
      z.literal('interactionKind'), z.literal('sourceActorRoles'), z.literal('destinationActorRoles'),
      z.literal('destinationClass'),
    ]),
  }).strict(),
}).strict()

export const hostHypothesisReceiptSchema = z.object({
  schemaVersion: z.literal('imonfhir.host-hypothesis-receipt.v2'),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v2'),
  contractDigests: contractDigestsSchema,
  caseHandle: handle,
  caseDigest: digest,
  submissionId: z.string().regex(/^hs_[a-f0-9]{32}$/),
  submissionDigest: digest,
  hypothesisDigest: digest,
  hostKind: z.enum(['CODEX', 'CLAUDE_DESKTOP']),
  state: z.literal('PENDING_SME_REVIEW'),
  deduplicated: z.boolean(),
}).strict()

export const evaluatorCapabilitiesSchema = z.object({
  schemaVersion: z.literal('imonfhir.evaluator-capabilities.v2'),
  mode: z.literal('HOST_ASSISTED_SME_EVALUATION'),
  bundledModel: z.literal(false),
  supportedHosts: z.tuple([z.literal('CODEX'), z.literal('CLAUDE_DESKTOP')]),
  caseCreation: z.literal('UI_ONLY_EXPLICIT_APPROVAL'),
  hostReceives: z.literal('APPROVED_STRUCTURAL_SUMMARY_ONLY'),
  probabilitiesAccepted: z.literal(false),
  freeTextAccepted: z.literal(false),
  rawPayloadAccepted: z.literal(false),
  syntheticOnly: z.literal(true),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v2'),
  contractDigests: contractDigestsSchema,
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

const questionSetReview = z.object({
  verdict: axisVerdict,
  expected: z.array(z.enum(QUESTION_CODES)).max(QUESTION_CODES.length).nullable(),
  exactMatch: z.boolean().nullable(),
}).strict()
const actionSetReview = z.object({
  verdict: axisVerdict,
  expected: z.array(z.enum(NEXT_ACTION_CODES)).max(NEXT_ACTION_CODES.length).nullable(),
  exactMatch: z.boolean().nullable(),
}).strict()

export const smeEvaluationRecordSchema = z.object({
  schemaVersion: z.literal('imonfhir.sme-evaluation-record.v2'),
  recordId: z.string().regex(/^sr_[a-f0-9]{32}$/),
  taxonomyVersion: z.literal('imonfhir.evaluation-taxonomy.v2'),
  contractDigests: contractDigestsSchema,
  contextDigest: digest,
  context: approvedCaseMaterialSchema,
  hostKind: z.enum(['CODEX', 'CLAUDE_DESKTOP']),
  hypothesisDigest: digest,
  submissionDigest: digest,
  hypotheses: v2HypothesesSchema,
  missingContextQuestionCodes: questionCodeSet,
  proposedNextActionCodes: nextActionCodeSet,
  review: z.object({
    standardVersion: scalarReview(STANDARD_VERSIONS),
    businessWorkflow: scalarReview(BUSINESS_WORKFLOWS),
    exchangePattern: scalarReview(EXCHANGE_PATTERNS),
    interactionKind: scalarReview(INTERACTION_KINDS),
    sourceActorRoles: actorReview(),
    destinationActorRoles: actorReview(),
    destinationClass: scalarReview(DESTINATION_CLASSES),
    missingContextQuestionCodes: questionSetReview,
    proposedNextActionCodes: actionSetReview,
  }).strict(),
}).strict().superRefine((record, context) => {
  if (!sameContractDigests(record.contractDigests, CONTRACT_DIGESTS_V2)) {
    context.addIssue({ code: 'custom', path: ['contractDigests'], message: 'Contract digests do not match this build.' })
  }
  const expectedHypothesisDigest = deriveHypothesisDigest(record)
  if (record.hypothesisDigest !== expectedHypothesisDigest) {
    context.addIssue({ code: 'custom', path: ['hypothesisDigest'], message: 'Hypothesis digest does not match reviewed material.' })
  }
  const expectedSubmissionDigest = deriveSubmissionDigest(record.contextDigest, record.hostKind, record.hypothesisDigest)
  if (record.submissionDigest !== expectedSubmissionDigest) {
    context.addIssue({ code: 'custom', path: ['submissionDigest'], message: 'Submission digest does not match context, host, and hypothesis digests.' })
  }
  if (record.recordId !== deriveRecordId(record.contextDigest, record.hostKind, record.hypothesisDigest)) {
    context.addIssue({ code: 'custom', path: ['recordId'], message: 'Record identifier does not match context, host, and hypothesis digests.' })
  }
  if (record.contextDigest !== canonicalDigest(record.context)) {
    context.addIssue({ code: 'custom', path: ['contextDigest'], message: 'Context digest does not match the sanitized context.' })
  }

  const scalarAxes = ['standardVersion', 'businessWorkflow', 'exchangePattern', 'interactionKind', 'destinationClass'] as const
  for (const axis of scalarAxes) checkScalarReview(record.review[axis], record.hypotheses[axis].value, context, ['review', axis])
  checkSetReview(record.review.sourceActorRoles, record.hypotheses.sourceActorRoles.values, context, ['review', 'sourceActorRoles'], true)
  checkSetReview(record.review.destinationActorRoles, record.hypotheses.destinationActorRoles.values, context, ['review', 'destinationActorRoles'], true)
  checkSetReview(record.review.missingContextQuestionCodes, record.missingContextQuestionCodes, context, ['review', 'missingContextQuestionCodes'])
  checkSetReview(record.review.proposedNextActionCodes, record.proposedNextActionCodes, context, ['review', 'proposedNextActionCodes'])
})

export const nonAuthorHandoffReceiptSchema = z.object({
  schemaVersion: z.literal('imonfhir.non-author-handoff-receipt.v1'),
  label: z.literal('NON_AUTHOR_USABILITY_SMOKE_TEST · NOT INDEPENDENT REVIEW'),
  testedCommit: z.string().regex(/^[a-f0-9]{40}$/),
  platformClass: z.enum(['MACOS_ARM64', 'MACOS_X64']),
  elapsedSetupMinutes: z.number().nonnegative().max(60),
  checklist: z.object({
    freshClonePathWithSpaces: z.enum(['PASS', 'FAIL']),
    uiReachableUnderTenMinutes: z.enum(['PASS', 'FAIL']),
    codexConfiguredWithoutOwnerCoaching: z.enum(['PASS', 'FAIL']),
    claudeConfiguredWithoutOwnerCoaching: z.enum(['PASS', 'FAIL']),
    sameCaseRetrievedByBothHosts: z.enum(['PASS', 'FAIL']),
    bothHostSubmissionsPreserved: z.enum(['PASS', 'FAIL']),
    bothHostEvaluationsSaved: z.enum(['PASS', 'FAIL']),
    customSyntheticCaseCompleted: z.enum(['PASS', 'FAIL']),
    correctedAtLeastOneResult: z.enum(['PASS', 'FAIL']),
    markedAtLeastOneResultNotScorable: z.enum(['PASS', 'FAIL']),
    questionAndActionSetsReviewed: z.enum(['PASS', 'FAIL']),
    deterministicV2JsonlExported: z.enum(['PASS', 'FAIL']),
    casePurged: z.enum(['PASS', 'FAIL']),
    nonClaimsExplainedWithoutAssistance: z.enum(['PASS', 'FAIL']),
  }).strict(),
  blockerCodes: z.array(z.enum([
    'NONE', 'SETUP_EXCEEDED_TEN_MINUTES', 'CODEX_CONFIGURATION_FAILED',
    'CLAUDE_CONFIGURATION_FAILED', 'CODEX_CASE_RETRIEVAL_FAILED',
    'CLAUDE_CASE_RETRIEVAL_FAILED', 'CODEX_SUBMISSION_FAILED',
    'CLAUDE_SUBMISSION_FAILED', 'DUAL_HOST_REVIEW_NOT_PRESERVED',
    'CUSTOM_SYNTHETIC_CASE_FAILED', 'SME_REVIEW_FAILED', 'EXPORT_FAILED',
    'PURGE_FAILED', 'NON_CLAIM_COMPREHENSION_FAILED', 'COACHING_REQUIRED',
    'ARTIFACT_MISMATCH', 'RESTRICTED_MATERIAL_DETECTED',
  ])).min(1).max(17).superRefine((values, context) => {
    if (!uniqueSorted(values)) context.addIssue({ code: 'custom', message: 'Blocker codes must be unique and sorted.' })
    if (values.includes('NONE') && values.length !== 1) context.addIssue({ code: 'custom', message: 'NONE must be the only blocker code.' })
  }),
  artifactDigests: z.object({
    candidateSourceTreeSha256: digest,
    evaluationExportSha256: digest,
    recordingMp4Sha256: digest,
    recordingDescriptorSha256: digest,
  }).strict(),
}).strict()

function checkScalarReview(
  review: { verdict: 'ACCEPTED' | 'CORRECTED' | 'NOT_SCORABLE'; expected: string | null; exactMatch: boolean | null },
  submitted: string,
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
): void {
  const valid = review.verdict === 'ACCEPTED'
    ? review.expected === submitted && review.exactMatch === true
    : review.verdict === 'CORRECTED'
      ? review.expected !== null && review.expected !== submitted && review.exactMatch === false
      : review.expected === null && review.exactMatch === null
  if (!valid) context.addIssue({ code: 'custom', path, message: 'Review verdict, expected value, and derived exact-match result are inconsistent.' })
}

function checkSetReview(
  review: { verdict: 'ACCEPTED' | 'CORRECTED' | 'NOT_SCORABLE'; expected: string[] | null; exactMatch: boolean | null },
  submitted: string[],
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
  actorSet = false,
): void {
  if (review.expected !== null && !uniqueSorted(review.expected)) {
    context.addIssue({ code: 'custom', path, message: 'Expected set must be unique and sorted.' })
    return
  }
  if (actorSet && review.expected?.includes('UNKNOWN') && review.expected.length !== 1) {
    context.addIssue({ code: 'custom', path, message: 'UNKNOWN must be the only actor role.' })
    return
  }
  const matches = review.expected !== null && sameValues(review.expected, submitted)
  const valid = review.verdict === 'ACCEPTED'
    ? matches && review.exactMatch === true
    : review.verdict === 'CORRECTED'
      ? review.expected !== null && !matches && review.exactMatch === false
      : review.expected === null && review.exactMatch === null
  if (!valid) context.addIssue({ code: 'custom', path, message: 'Review verdict, expected set, and derived exact-match result are inconsistent.' })
}

function schemaDigest(schema: z.ZodType): string {
  return canonicalDigest(z.toJSONSchema(schema, { target: 'draft-2020-12' }))
}

export const CONTRACT_DIGESTS_V2: Readonly<ContractDigestsV2> = Object.freeze({
  taxonomy: canonicalDigest(EVALUATION_TAXONOMY),
  evaluatorCapabilities: schemaDigest(evaluatorCapabilitiesSchema),
  hostEvaluationCase: schemaDigest(hostEvaluationCaseSchema),
  hostHypothesisSubmission: schemaDigest(hostHypothesisSubmissionSchema),
  hostHypothesisReceipt: schemaDigest(hostHypothesisReceiptSchema),
  smeEvaluationRecord: schemaDigest(smeEvaluationRecordSchema),
})

export const NON_AUTHOR_HANDOFF_RECEIPT_SCHEMA_DIGEST = schemaDigest(nonAuthorHandoffReceiptSchema)

function sameContractDigests(left: ContractDigestsV2, right: Readonly<ContractDigestsV2>): boolean {
  return canonicalDigest(left) === canonicalDigest(right)
}

export function assertCurrentContractDigests(digests: ContractDigestsV2): void {
  if (!sameContractDigests(digests, CONTRACT_DIGESTS_V2)) throw new Error('CONTRACT_VERSION_MISMATCH')
}

type HypothesisMaterial = Pick<HostHypothesisSubmission,
  'taxonomyVersion' | 'contractDigests' | 'hypotheses' |
  'missingContextQuestionCodes' | 'proposedNextActionCodes'
>

export function deriveHypothesisDigest(material: HypothesisMaterial): string {
  return canonicalDigest({
    schemaVersion: 'imonfhir.hypothesis-material.v2',
    taxonomyVersion: material.taxonomyVersion,
    contractDigests: material.contractDigests,
    hypotheses: material.hypotheses,
    missingContextQuestionCodes: material.missingContextQuestionCodes,
    proposedNextActionCodes: material.proposedNextActionCodes,
  })
}

export function deriveSubmissionDigest(contextDigest: string, hostKind: HostKind, hypothesisDigest: string): string {
  return canonicalDigest({
    schemaVersion: 'imonfhir.host-submission-material.v2',
    contextDigest,
    hostKind,
    hypothesisDigest,
  })
}

export function deriveSubmissionId(submissionDigest: string): string {
  return `hs_${submissionDigest.slice(0, 32)}`
}

export function deriveRecordId(contextDigest: string, hostKind: HostKind, hypothesisDigest: string): string {
  return `sr_${canonicalDigest({
    schemaVersion: 'imonfhir.sme-record-identity.v2',
    contextDigest,
    hostKind,
    hypothesisDigest,
  }).slice(0, 32)}`
}

export function parseHostHypothesisSubmission(input: unknown): HostHypothesisSubmission {
  const submission = hostHypothesisSubmissionSchema.parse(input) as HostHypothesisSubmission
  assertCurrentContractDigests(submission.contractDigests)
  return submission
}

export function parseLegacyHostHypothesisSubmission(input: unknown): LegacyHostHypothesisSubmission {
  return hostHypothesisSubmissionSchemaV1.parse(input) as LegacyHostHypothesisSubmission
}

function assertCaseMaterialDigest(evaluationCase: HostEvaluationCase): void {
  const material: ApprovedCaseMaterial = {
    schemaVersion: 'imonfhir.approved-case-material.v1',
    observation: evaluationCase.observation,
    structuralSummary: evaluationCase.structuralSummary,
  }
  if (evaluationCase.caseDigest !== canonicalDigest(material)) throw new Error('STALE_CASE')
}

export function parseHostEvaluationCase(input: unknown): HostEvaluationCase {
  const evaluationCase = hostEvaluationCaseSchema.parse(input) as HostEvaluationCase
  assertCurrentContractDigests(evaluationCase.contractDigests)
  assertCaseMaterialDigest(evaluationCase)
  return evaluationCase
}

export function validateSubmissionAgainstCase(
  submission: HostHypothesisSubmission,
  evaluationCase: HostEvaluationCase,
): void {
  assertCurrentContractDigests(submission.contractDigests)
  assertCurrentContractDigests(evaluationCase.contractDigests)
  assertCaseMaterialDigest(evaluationCase)
  if (submission.caseHandle !== evaluationCase.caseHandle) throw new Error('EXPIRED_CASE')
  if (submission.caseDigest !== evaluationCase.caseDigest) throw new Error('STALE_CASE')
  if (submission.taxonomyVersion !== evaluationCase.taxonomyVersion) throw new Error('CONTRACT_VERSION_MISMATCH')
  const offered = new Set(evaluationCase.structuralSummary.evidenceItems.map((item) => item.ref))
  const referenced = [
    submission.hypotheses.standardVersion.evidenceRefs,
    submission.hypotheses.businessWorkflow.evidenceRefs,
    submission.hypotheses.exchangePattern.evidenceRefs,
    submission.hypotheses.interactionKind.evidenceRefs,
    submission.hypotheses.sourceActorRoles.evidenceRefs,
    submission.hypotheses.destinationActorRoles.evidenceRefs,
    submission.hypotheses.destinationClass.evidenceRefs,
  ].flat()
  if (referenced.some((ref) => !offered.has(ref))) throw new Error('INVALID_EVIDENCE_REFERENCE')

  const questions = new Set(submission.missingContextQuestionCodes)
  const checks: Array<[boolean, string, string, { conflictCodes: string[] }]> = [
    [submission.hypotheses.standardVersion.value === 'UNDETERMINED', 'STANDARD_VERSION_NOT_OBSERVED', 'CONFIRM_STANDARD_VERSION', submission.hypotheses.standardVersion],
    [submission.hypotheses.businessWorkflow.value === 'UNKNOWN_OR_OTHER', 'BUSINESS_WORKFLOW_NOT_OBSERVED', 'CONFIRM_BUSINESS_WORKFLOW', submission.hypotheses.businessWorkflow],
    [submission.hypotheses.exchangePattern.value === 'UNKNOWN', 'EXCHANGE_PATTERN_NOT_OBSERVED', 'CONFIRM_EXCHANGE_PATTERN', submission.hypotheses.exchangePattern],
    [submission.hypotheses.interactionKind.value === 'UNKNOWN', 'INTERACTION_KIND_NOT_OBSERVED', 'CONFIRM_INTERACTION_KIND', submission.hypotheses.interactionKind],
    [submission.hypotheses.sourceActorRoles.values.includes('UNKNOWN'), 'SOURCE_ACTOR_ROLES_NOT_OBSERVED', 'CONFIRM_SOURCE_ACTOR_ROLES', submission.hypotheses.sourceActorRoles],
    [submission.hypotheses.destinationActorRoles.values.includes('UNKNOWN'), 'DESTINATION_ACTOR_ROLES_NOT_OBSERVED', 'CONFIRM_DESTINATION_ACTOR_ROLES', submission.hypotheses.destinationActorRoles],
    [submission.hypotheses.destinationClass.value === 'UNKNOWN', 'DESTINATION_CLASS_NOT_OBSERVED', 'CONFIRM_DESTINATION_CLASS', submission.hypotheses.destinationClass],
  ]
  for (const [unknown, conflict, question, hypothesis] of checks) {
    if (unknown && (!hypothesis.conflictCodes.includes(conflict) || !questions.has(question as never))) {
      throw new Error('INVALID_HYPOTHESES')
    }
  }
}

export function parseSmeEvaluationRecord(input: unknown): SmeEvaluationRecord {
  return smeEvaluationRecordSchema.parse(input) as SmeEvaluationRecord
}

export function parseLegacyHostEvaluationCase(input: unknown): LegacyHostEvaluationCase {
  return hostEvaluationCaseSchemaV1.parse(input) as LegacyHostEvaluationCase
}
