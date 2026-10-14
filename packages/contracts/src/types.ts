// SPDX-License-Identifier: Apache-2.0

import type {
  ActorRole,
  BusinessWorkflow,
  ConflictCode,
  DestinationClass,
  ExchangePattern,
  InteractionKind,
  LegacyConflictCode,
  LegacyDirection,
  LegacyNextActionCode,
  LegacyQuestionCode,
  LegacyWorkflow,
  NextActionCode,
  PayloadFormat,
  QuestionCode,
  StandardVersion,
} from '@imonfhir/payload-core'

export type HostKind = 'CODEX' | 'CLAUDE_DESKTOP'
export type CountBand = 'ZERO' | 'ONE' | 'TWO_TO_FIVE' | 'SIX_TO_TWENTY' | 'TWENTY_ONE_TO_ONE_HUNDRED' | 'OVER_ONE_HUNDRED'

export interface EvaluationCandidate {
  format: PayloadFormat
  signature: 'DETERMINISTIC' | 'HEURISTIC' | 'OPAQUE_MAGIC'
  evidenceCodes: string[]
}

export interface EvaluationObservation {
  status: 'DETECTED' | 'AMBIGUOUS' | 'OPAQUE' | 'UNKNOWN' | 'REJECTED'
  observedFormat?: PayloadFormat
  candidates: EvaluationCandidate[]
  conflictCodes: string[]
  issueCodes: string[]
}

export type EvidenceItem =
  | { ref: string; kind: 'FORMAT'; code: string }
  | { ref: string; kind: 'DETECTOR'; code: string }
  | { ref: string; kind: 'SHAPE'; code: 'COMPLETE' | 'TRUNCATED' }
  | { ref: string; kind: 'AGGREGATE'; code: 'LINES' | 'RECORDS' | 'SEGMENTS' | 'ELEMENTS'; countBand: CountBand }
  | {
      ref: string
      kind: 'FEATURE'
      feature: {
        kind: 'STRUCTURAL_NAME' | 'DATA_TYPE' | 'COUNT' | 'SAFE_MARKER'
        name: string
        structuralPath?: string
        dataType?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'element' | 'segment'
        countBand?: CountBand
      }
    }

export interface StructuralSummary {
  schemaVersion: 'imonfhir.approved-structural-summary.v1'
  format: PayloadFormat
  evidenceItems: EvidenceItem[]
  safety: {
    payloadValuesAbsent: true
    identifiersAbsent: true
    freeTextAbsent: true
    binaryContentAbsent: true
    unknownNamesHashed: true
    exactCountsAbsent: true
  }
}

export interface ApprovedCaseMaterial {
  schemaVersion: 'imonfhir.approved-case-material.v1'
  observation: EvaluationObservation
  structuralSummary: StructuralSummary
}

export interface ScalarHypothesis<T extends string, C extends string = ConflictCode> {
  value: T
  evidenceRefs: string[]
  conflictCodes: C[]
}

export interface ActorHypothesis<C extends string = ConflictCode> {
  values: ActorRole[]
  evidenceRefs: string[]
  conflictCodes: C[]
}

// v1 is deliberately retained as a separate legacy data model. It must never
// be silently promoted into v2 because its workflow/direction fields are
// semantically ambiguous.
export interface LegacyHypotheses {
  standardVersion: ScalarHypothesis<StandardVersion, LegacyConflictCode>
  workflow: ScalarHypothesis<LegacyWorkflow, LegacyConflictCode>
  direction: ScalarHypothesis<LegacyDirection, LegacyConflictCode>
  actorRoles: ActorHypothesis<LegacyConflictCode>
  destinationClass: ScalarHypothesis<DestinationClass, LegacyConflictCode>
}

export interface LegacyHostEvaluationCase extends Omit<ApprovedCaseMaterial, 'schemaVersion'> {
  schemaVersion: 'imonfhir.host-evaluation-case.v1'
  caseHandle: string
  caseDigest: string
  expiresAt: string
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1'
  requiredSubmission: {
    axes: ['standardVersion', 'workflow', 'direction', 'actorRoles', 'destinationClass']
  }
}

export interface LegacyHostHypothesisSubmission {
  caseHandle: string
  caseDigest: string
  hypotheses: LegacyHypotheses
  missingContextQuestionCodes: LegacyQuestionCode[]
  proposedNextActionCodes: LegacyNextActionCode[]
}

export interface LegacyHostHypothesisReceipt {
  schemaVersion: 'imonfhir.host-hypothesis-receipt.v1'
  caseHandle: string
  caseDigest: string
  submissionId: string
  submissionDigest: string
  hostKind: HostKind
  state: 'PENDING_SME_REVIEW'
  deduplicated: boolean
}

export type AxisVerdict = 'ACCEPTED' | 'CORRECTED' | 'NOT_SCORABLE'

export interface SmeAxisReview<T> {
  verdict: AxisVerdict
  expected: T | null
  exactMatch: boolean | null
}

export interface LegacySmeEvaluationRecord {
  schemaVersion: 'imonfhir.sme-evaluation-record.v1'
  recordId: string
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1'
  contextDigest: string
  context: ApprovedCaseMaterial
  hostKind: HostKind
  hypotheses: LegacyHypotheses
  missingContextQuestionCodes: LegacyQuestionCode[]
  proposedNextActionCodes: LegacyNextActionCode[]
  review: {
    standardVersion: SmeAxisReview<StandardVersion>
    workflow: SmeAxisReview<LegacyWorkflow>
    direction: SmeAxisReview<LegacyDirection>
    actorRoles: SmeAxisReview<ActorRole[]>
    destinationClass: SmeAxisReview<DestinationClass>
  }
}

export interface LegacyEvaluatorCapabilities {
  schemaVersion: 'imonfhir.evaluator-capabilities.v1'
  mode: 'HOST_ASSISTED_SME_EVALUATION'
  bundledModel: false
  supportedHosts: ['CODEX', 'CLAUDE_DESKTOP']
  caseCreation: 'UI_ONLY_EXPLICIT_APPROVAL'
  hostReceives: 'APPROVED_STRUCTURAL_SUMMARY_ONLY'
  probabilitiesAccepted: false
  freeTextAccepted: false
  rawPayloadAccepted: false
  syntheticOnly: true
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1'
  recognizedFormats: PayloadFormat[]
  hostEligibleFormats: PayloadFormat[]
  hostBlockedFormats: PayloadFormat[]
  limits: EvaluationLimits
  limitations: string[]
}

export interface ContractDigestsV2 {
  taxonomy: string
  evaluatorCapabilities: string
  hostEvaluationCase: string
  hostHypothesisSubmission: string
  hostHypothesisReceipt: string
  smeEvaluationRecord: string
}

export interface Hypotheses {
  standardVersion: ScalarHypothesis<StandardVersion>
  businessWorkflow: ScalarHypothesis<BusinessWorkflow>
  exchangePattern: ScalarHypothesis<ExchangePattern>
  interactionKind: ScalarHypothesis<InteractionKind>
  sourceActorRoles: ActorHypothesis
  destinationActorRoles: ActorHypothesis
  destinationClass: ScalarHypothesis<DestinationClass>
}

export interface HostEvaluationCase extends Omit<ApprovedCaseMaterial, 'schemaVersion'> {
  schemaVersion: 'imonfhir.host-evaluation-case.v2'
  caseHandle: string
  caseDigest: string
  expiresAt: string
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2'
  contractDigests: ContractDigestsV2
  requiredSubmission: {
    axes: [
      'standardVersion',
      'businessWorkflow',
      'exchangePattern',
      'interactionKind',
      'sourceActorRoles',
      'destinationActorRoles',
      'destinationClass',
    ]
  }
}

export interface HostHypothesisSubmission {
  schemaVersion: 'imonfhir.host-hypothesis-submission.v2'
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2'
  contractDigests: ContractDigestsV2
  caseHandle: string
  caseDigest: string
  hypotheses: Hypotheses
  missingContextQuestionCodes: QuestionCode[]
  proposedNextActionCodes: NextActionCode[]
}

export interface HostHypothesisReceipt {
  schemaVersion: 'imonfhir.host-hypothesis-receipt.v2'
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2'
  contractDigests: ContractDigestsV2
  caseHandle: string
  caseDigest: string
  submissionId: string
  submissionDigest: string
  hypothesisDigest: string
  hostKind: HostKind
  state: 'PENDING_SME_REVIEW'
  deduplicated: boolean
}

export interface SmeEvaluationRecord {
  schemaVersion: 'imonfhir.sme-evaluation-record.v2'
  recordId: string
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2'
  contractDigests: ContractDigestsV2
  contextDigest: string
  context: ApprovedCaseMaterial
  hostKind: HostKind
  hypothesisDigest: string
  submissionDigest: string
  hypotheses: Hypotheses
  missingContextQuestionCodes: QuestionCode[]
  proposedNextActionCodes: NextActionCode[]
  review: {
    standardVersion: SmeAxisReview<StandardVersion>
    businessWorkflow: SmeAxisReview<BusinessWorkflow>
    exchangePattern: SmeAxisReview<ExchangePattern>
    interactionKind: SmeAxisReview<InteractionKind>
    sourceActorRoles: SmeAxisReview<ActorRole[]>
    destinationActorRoles: SmeAxisReview<ActorRole[]>
    destinationClass: SmeAxisReview<DestinationClass>
    missingContextQuestionCodes: SmeAxisReview<QuestionCode[]>
    proposedNextActionCodes: SmeAxisReview<NextActionCode[]>
  }
}

export interface EvaluationLimits {
  maxPayloadBytes: 8000000
  maxJsonDepth: 64
  maxNdjsonLines: 10000
  maxNdjsonLineBytes: 1000000
  maxHl7Segments: 10000
  maxEvidenceItems: 300
  caseTtlSeconds: 14400
}

export interface EvaluatorCapabilities {
  schemaVersion: 'imonfhir.evaluator-capabilities.v2'
  mode: 'HOST_ASSISTED_SME_EVALUATION'
  bundledModel: false
  supportedHosts: ['CODEX', 'CLAUDE_DESKTOP']
  caseCreation: 'UI_ONLY_EXPLICIT_APPROVAL'
  hostReceives: 'APPROVED_STRUCTURAL_SUMMARY_ONLY'
  probabilitiesAccepted: false
  freeTextAccepted: false
  rawPayloadAccepted: false
  syntheticOnly: true
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2'
  contractDigests: ContractDigestsV2
  recognizedFormats: PayloadFormat[]
  hostEligibleFormats: PayloadFormat[]
  hostBlockedFormats: PayloadFormat[]
  limits: EvaluationLimits
  limitations: string[]
}

export type HandoffChecklistResult = 'PASS' | 'FAIL'
export type HandoffBlockerCode =
  | 'NONE'
  | 'SETUP_EXCEEDED_TEN_MINUTES'
  | 'CODEX_CONFIGURATION_FAILED'
  | 'CLAUDE_CONFIGURATION_FAILED'
  | 'CODEX_CASE_RETRIEVAL_FAILED'
  | 'CLAUDE_CASE_RETRIEVAL_FAILED'
  | 'CODEX_SUBMISSION_FAILED'
  | 'CLAUDE_SUBMISSION_FAILED'
  | 'DUAL_HOST_REVIEW_NOT_PRESERVED'
  | 'CUSTOM_SYNTHETIC_CASE_FAILED'
  | 'SME_REVIEW_FAILED'
  | 'EXPORT_FAILED'
  | 'PURGE_FAILED'
  | 'NON_CLAIM_COMPREHENSION_FAILED'
  | 'COACHING_REQUIRED'
  | 'ARTIFACT_MISMATCH'
  | 'RESTRICTED_MATERIAL_DETECTED'

export interface NonAuthorHandoffReceipt {
  schemaVersion: 'imonfhir.non-author-handoff-receipt.v1'
  label: 'NON_AUTHOR_USABILITY_SMOKE_TEST · NOT INDEPENDENT REVIEW'
  testedCommit: string
  platformClass: 'MACOS_ARM64' | 'MACOS_X64'
  elapsedSetupMinutes: number
  checklist: {
    freshClonePathWithSpaces: HandoffChecklistResult
    uiReachableUnderTenMinutes: HandoffChecklistResult
    codexConfiguredWithoutOwnerCoaching: HandoffChecklistResult
    claudeConfiguredWithoutOwnerCoaching: HandoffChecklistResult
    sameCaseRetrievedByBothHosts: HandoffChecklistResult
    bothHostSubmissionsPreserved: HandoffChecklistResult
    bothHostEvaluationsSaved: HandoffChecklistResult
    customSyntheticCaseCompleted: HandoffChecklistResult
    correctedAtLeastOneResult: HandoffChecklistResult
    markedAtLeastOneResultNotScorable: HandoffChecklistResult
    questionAndActionSetsReviewed: HandoffChecklistResult
    deterministicV2JsonlExported: HandoffChecklistResult
    casePurged: HandoffChecklistResult
    nonClaimsExplainedWithoutAssistance: HandoffChecklistResult
  }
  blockerCodes: HandoffBlockerCode[]
  artifactDigests: {
    candidateSourceTreeSha256: string
    evaluationExportSha256: string
    recordingMp4Sha256: string
    recordingDescriptorSha256: string
  }
}
