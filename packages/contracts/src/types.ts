// SPDX-License-Identifier: Apache-2.0

import type {
  ActorRole,
  DestinationClass,
  Direction,
  NextActionCode,
  PayloadFormat,
  QuestionCode,
  StandardVersion,
  Workflow,
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

export interface HostEvaluationCase {
  schemaVersion: 'imonfhir.host-evaluation-case.v1'
  observation: EvaluationObservation
  structuralSummary: StructuralSummary
  caseHandle: string
  caseDigest: string
  expiresAt: string
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1'
  requiredSubmission: {
    axes: ['standardVersion', 'workflow', 'direction', 'actorRoles', 'destinationClass']
  }
}

export interface ScalarHypothesis<T extends string> {
  value: T
  evidenceRefs: string[]
  conflictCodes: string[]
}

export interface ActorHypothesis {
  values: ActorRole[]
  evidenceRefs: string[]
  conflictCodes: string[]
}

export interface Hypotheses {
  standardVersion: ScalarHypothesis<StandardVersion>
  workflow: ScalarHypothesis<Workflow>
  direction: ScalarHypothesis<Direction>
  actorRoles: ActorHypothesis
  destinationClass: ScalarHypothesis<DestinationClass>
}

export interface HostHypothesisSubmission {
  caseHandle: string
  caseDigest: string
  hypotheses: Hypotheses
  missingContextQuestionCodes: QuestionCode[]
  proposedNextActionCodes: NextActionCode[]
}

export interface HostHypothesisReceipt {
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

export interface SmeEvaluationRecord {
  schemaVersion: 'imonfhir.sme-evaluation-record.v1'
  recordId: string
  taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1'
  contextDigest: string
  context: ApprovedCaseMaterial
  hostKind: HostKind
  hypotheses: Hypotheses
  missingContextQuestionCodes: QuestionCode[]
  proposedNextActionCodes: NextActionCode[]
  review: {
    standardVersion: SmeAxisReview<StandardVersion>
    workflow: SmeAxisReview<Workflow>
    direction: SmeAxisReview<Direction>
    actorRoles: SmeAxisReview<ActorRole[]>
    destinationClass: SmeAxisReview<DestinationClass>
  }
}

export interface EvaluatorCapabilities {
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
  limits: {
    maxPayloadBytes: 8000000
    maxJsonDepth: 64
    maxNdjsonLines: 10000
    maxNdjsonLineBytes: 1000000
    maxHl7Segments: 10000
    maxEvidenceItems: 300
    caseTtlSeconds: 14400
  }
  limitations: string[]
}
