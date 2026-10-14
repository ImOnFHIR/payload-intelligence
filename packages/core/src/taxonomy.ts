// SPDX-License-Identifier: Apache-2.0

/**
 * The v1 vocabulary remains exported only so existing, already-saved browser
 * records can be read and exported without reinterpretation. New evaluations
 * must use the v2 vocabulary below.
 */
export const TAXONOMY_VERSION_V1 = 'imonfhir.evaluation-taxonomy.v1' as const

export const WORKFLOWS_V1 = [
  'RESOURCE_EXCHANGE', 'BULK_RESOURCE_EXCHANGE', 'CLINICAL_DOCUMENT_EXCHANGE',
  'PATIENT_ADMINISTRATION', 'ORDER_EXCHANGE', 'RESULT_EXCHANGE',
  'PRIOR_AUTHORIZATION', 'PUBLIC_HEALTH_REPORTING', 'UNKNOWN_OR_OTHER',
] as const

export const DIRECTIONS_V1 = [
  'SENDER_TO_RECEIVER', 'RECEIVER_FROM_SENDER', 'REQUEST', 'RESPONSE', 'EVENT', 'UNKNOWN',
] as const

export const CONFLICT_CODES_V1 = [
  'DETERMINISTIC_FORMAT_CONFLICT', 'DECLARED_METADATA_CONFLICT',
  'MULTIPLE_WORKFLOWS_PLAUSIBLE', 'STANDARD_VERSION_NOT_OBSERVED',
  'DIRECTION_NOT_OBSERVED', 'ACTOR_ROLES_NOT_OBSERVED',
  'DESTINATION_NOT_OBSERVED', 'SHAPE_SKETCH_TRUNCATED',
  'INSUFFICIENT_STRUCTURAL_EVIDENCE',
] as const

export const QUESTION_CODES_V1 = [
  'CONFIRM_STANDARD_VERSION', 'CONFIRM_WORKFLOW', 'CONFIRM_DIRECTION',
  'CONFIRM_ACTOR_ROLES', 'CONFIRM_DESTINATION_CLASS',
] as const

export const NEXT_ACTION_CODES_V1 = [
  'ASK_TARGETED_CONTEXT', 'REVIEW_DETERMINISTIC_EVIDENCE',
  'REVIEW_WORKFLOW_HYPOTHESIS', 'REVIEW_DIRECTION_HYPOTHESIS',
  'REVIEW_ACTOR_HYPOTHESES', 'REVIEW_DESTINATION_HYPOTHESIS',
  'CONFIRM_STANDARD_VERSION', 'STOP_UNSUPPORTED_FORMAT',
] as const

export const STANDARD_VERSIONS = [
  'FHIR_R4', 'FHIR_R4B', 'FHIR_R5',
  'HL7_V2_3', 'HL7_V2_3_1', 'HL7_V2_4', 'HL7_V2_5', 'HL7_V2_5_1',
  'HL7_V2_6', 'HL7_V2_7', 'HL7_V2_7_1', 'HL7_V2_8', 'HL7_V2_8_1',
  'HL7_V2_8_2', 'HL7_V2_9', 'CDA_R2', 'C_CDA_2_1', 'C_CDA_3_0',
  'UNDETERMINED', 'NOT_APPLICABLE',
] as const

export const ACTOR_ROLES = [
  'PATIENT_OR_MEMBER', 'PROVIDER_OR_CARE_TEAM', 'PAYER_OR_HEALTH_PLAN',
  'HEALTH_INFORMATION_NETWORK_OR_EXCHANGE', 'PUBLIC_HEALTH_AGENCY',
  'APPLICATION_OR_DATA_SERVICE', 'OTHER', 'UNKNOWN',
] as const

export const DESTINATION_CLASSES = [
  'PROVIDER_SYSTEM', 'PAYER_SYSTEM', 'PATIENT_APPLICATION',
  'HEALTH_INFORMATION_NETWORK_OR_EXCHANGE', 'PUBLIC_HEALTH_SYSTEM',
  'DATA_PLATFORM_OR_REPOSITORY', 'LOCAL_REVIEW_ONLY', 'OTHER', 'UNKNOWN',
] as const

export const EVALUATION_TAXONOMY_V1 = Object.freeze({
  version: TAXONOMY_VERSION_V1,
  standardVersions: STANDARD_VERSIONS,
  workflows: WORKFLOWS_V1,
  directions: DIRECTIONS_V1,
  actorRoles: ACTOR_ROLES,
  destinationClasses: DESTINATION_CLASSES,
  conflictCodes: CONFLICT_CODES_V1,
  questionCodes: QUESTION_CODES_V1,
  nextActionCodes: NEXT_ACTION_CODES_V1,
})

export type LegacyWorkflow = (typeof WORKFLOWS_V1)[number]
export type LegacyDirection = (typeof DIRECTIONS_V1)[number]
export type LegacyConflictCode = (typeof CONFLICT_CODES_V1)[number]
export type LegacyQuestionCode = (typeof QUESTION_CODES_V1)[number]
export type LegacyNextActionCode = (typeof NEXT_ACTION_CODES_V1)[number]

/** @deprecated v1-only alias retained for saved-record compatibility. */
export const WORKFLOWS = WORKFLOWS_V1
/** @deprecated v1-only alias retained for saved-record compatibility. */
export const DIRECTIONS = DIRECTIONS_V1
/** @deprecated use LegacyWorkflow for v1 data or BusinessWorkflow for v2 data. */
export type Workflow = LegacyWorkflow
/** @deprecated use LegacyDirection for v1 data or InteractionKind for v2 data. */
export type Direction = LegacyDirection

export const TAXONOMY_VERSION = 'imonfhir.evaluation-taxonomy.v2' as const

export const BUSINESS_WORKFLOWS = [
  'PRIOR_AUTHORIZATION', 'PATIENT_ADMINISTRATION', 'ORDER_MANAGEMENT',
  'RESULT_REPORTING', 'CLINICAL_DOCUMENTATION', 'PUBLIC_HEALTH_REPORTING',
  'CARE_COORDINATION', 'UNKNOWN_OR_OTHER', 'NOT_APPLICABLE',
] as const

export const EXCHANGE_PATTERNS = [
  'SINGLE_RESOURCE', 'RESOURCE_COLLECTION', 'RESOURCE_STREAM', 'DOCUMENT',
  'MESSAGE', 'DELIMITED_RECORD_SET', 'GENERIC_STRUCTURED_OBJECT', 'UNKNOWN',
  'NOT_APPLICABLE',
] as const

export const INTERACTION_KINDS = [
  'REQUEST', 'RESPONSE', 'EVENT', 'UNKNOWN', 'NOT_APPLICABLE',
] as const

export const CONFLICT_CODES = [
  'DETERMINISTIC_FORMAT_CONFLICT', 'DECLARED_METADATA_CONFLICT',
  'MULTIPLE_BUSINESS_WORKFLOWS_PLAUSIBLE', 'STANDARD_VERSION_NOT_OBSERVED',
  'BUSINESS_WORKFLOW_NOT_OBSERVED', 'EXCHANGE_PATTERN_NOT_OBSERVED',
  'INTERACTION_KIND_NOT_OBSERVED', 'SOURCE_ACTOR_ROLES_NOT_OBSERVED',
  'DESTINATION_ACTOR_ROLES_NOT_OBSERVED', 'DESTINATION_CLASS_NOT_OBSERVED',
  'SHAPE_SKETCH_TRUNCATED', 'INSUFFICIENT_STRUCTURAL_EVIDENCE',
] as const

export const QUESTION_CODES = [
  'CONFIRM_STANDARD_VERSION', 'CONFIRM_BUSINESS_WORKFLOW',
  'CONFIRM_EXCHANGE_PATTERN', 'CONFIRM_INTERACTION_KIND',
  'CONFIRM_SOURCE_ACTOR_ROLES', 'CONFIRM_DESTINATION_ACTOR_ROLES',
  'CONFIRM_DESTINATION_CLASS',
] as const

export const NEXT_ACTION_CODES = [
  'ASK_TARGETED_CONTEXT', 'REVIEW_DETERMINISTIC_EVIDENCE',
  'REVIEW_STANDARD_VERSION_HYPOTHESIS', 'REVIEW_BUSINESS_WORKFLOW_HYPOTHESIS',
  'REVIEW_EXCHANGE_PATTERN_HYPOTHESIS', 'REVIEW_INTERACTION_KIND_HYPOTHESIS',
  'REVIEW_SOURCE_ACTOR_HYPOTHESES', 'REVIEW_DESTINATION_ACTOR_HYPOTHESES',
  'REVIEW_DESTINATION_CLASS_HYPOTHESIS', 'STOP_UNSUPPORTED_FORMAT',
] as const

export type StandardVersion = (typeof STANDARD_VERSIONS)[number]
export type BusinessWorkflow = (typeof BUSINESS_WORKFLOWS)[number]
export type ExchangePattern = (typeof EXCHANGE_PATTERNS)[number]
export type InteractionKind = (typeof INTERACTION_KINDS)[number]
export type ActorRole = (typeof ACTOR_ROLES)[number]
export type DestinationClass = (typeof DESTINATION_CLASSES)[number]
export type ConflictCode = (typeof CONFLICT_CODES)[number]
export type QuestionCode = (typeof QUESTION_CODES)[number]
export type NextActionCode = (typeof NEXT_ACTION_CODES)[number]

export const EVALUATION_TAXONOMY = Object.freeze({
  version: TAXONOMY_VERSION,
  standardVersions: STANDARD_VERSIONS,
  businessWorkflows: BUSINESS_WORKFLOWS,
  exchangePatterns: EXCHANGE_PATTERNS,
  interactionKinds: INTERACTION_KINDS,
  sourceActorRoles: ACTOR_ROLES,
  destinationActorRoles: ACTOR_ROLES,
  destinationClasses: DESTINATION_CLASSES,
  conflictCodes: CONFLICT_CODES,
  questionCodes: QUESTION_CODES,
  nextActionCodes: NEXT_ACTION_CODES,
})
