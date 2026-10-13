// SPDX-License-Identifier: Apache-2.0

/**
 * Public, value-free contracts for the deterministic payload-intelligence core.
 *
 * `evidenceScore` is a rule weight. It is deliberately not named confidence or
 * probability: it has not been statistically calibrated and must never be
 * presented as one.
 */

export const PAYLOAD_FORMATS = [
  'FHIR_JSON',
  'FHIR_XML',
  'FHIR_NDJSON',
  'HL7_V2_ER7',
  'CDA_XML',
  'RESTRICTED_EDI_UNSUPPORTED',
  'GENERIC_JSON',
  'GENERIC_XML',
  'DELIMITED_TEXT',
  'PDF',
  'DICOM',
  'ARCHIVE',
  'UNKNOWN_TEXT',
  'UNKNOWN_BINARY',
] as const

export type PayloadFormat = (typeof PAYLOAD_FORMATS)[number]

export type DetectionStatus = 'DETECTED' | 'AMBIGUOUS' | 'OPAQUE' | 'UNKNOWN' | 'REJECTED'

export type DetectionSignature = 'DETERMINISTIC' | 'HEURISTIC' | 'OPAQUE_MAGIC'

export interface DetectionEvidence {
  /** Stable, non-payload-derived identifier suitable for receipts and tests. */
  code: string
  source: 'BYTES' | 'STRUCTURE' | 'DECLARED_METADATA' | 'LIMIT'
  /** Static copy only. Raw values must never be interpolated here. */
  description: string
}

export interface DetectionCandidate {
  format: PayloadFormat
  /** A deterministic rule weight in [0, 1], not a calibrated probability. */
  evidenceScore: number
  signature: DetectionSignature
  evidence: DetectionEvidence[]
}

export interface DetectionConflict {
  code: string
  description: string
  declaredFormat?: PayloadFormat
  observedFormat?: PayloadFormat
}

export interface DetectionIssue {
  code: string
  description: string
}

export interface DeclaredPayloadContext {
  /** A media type supplied by the intake surface. Parameters are ignored. */
  contentType?: string
  /** A display name only. Detection reads its final extension, never a path. */
  fileName?: string
}

export interface DetectionResult {
  schemaVersion: 'imonfhir.payload-fingerprint.v1'
  byteCount: number
  status: DetectionStatus
  candidates: DetectionCandidate[]
  conflicts: DetectionConflict[]
  issues: DetectionIssue[]
  /** The top byte/structure observation even when policy refuses selection. */
  observedFormat?: PayloadFormat
  /**
   * Reserved for a later calibrated policy decision. The deterministic detector
   * never selects a format for automatic routing and therefore leaves this unset.
   */
  selectedFormat?: PayloadFormat
  /** Always false at the deterministic-only layer; calibration lives elsewhere. */
  automaticRoutingEligible: false
}

export type ShapeFeatureKind = 'STRUCTURAL_NAME' | 'DATA_TYPE' | 'COUNT' | 'SAFE_MARKER'

export interface ShapeFeature {
  kind: ShapeFeatureKind
  /** A closed-vocabulary token or an irreversible hash label. Never a value. */
  name: string
  /** A path made only from closed-vocabulary or hashed structural names. */
  path?: string
  dataType?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'element' | 'segment'
  count?: number
}

export interface ShapeSketch {
  schemaVersion: 'imonfhir.shape-sketch.v1'
  format: PayloadFormat
  modelExposure: 'ALLOWED' | 'BLOCKED'
  /** Stable detector codes only; descriptions and input values are excluded. */
  evidence: string[]
  features: ShapeFeature[]
  counts: {
    bytes: number
    lines?: number
    records?: number
    segments?: number
    elements?: number
  }
  truncated: boolean
  safety: {
    valuesRemoved: true
    identifiersRemoved: true
    freeTextRemoved: true
    unknownNamesHashed: true
  }
}

/**
 * Closed content-type vocabulary for embedded binary representations. Unknown
 * sender values are deliberately collapsed instead of becoming a value-leak
 * channel through the inspection response or MCP.
 */
export const SANITIZED_ATTACHMENT_CONTENT_TYPES = [
  'UNDECLARED',
  'UNRECOGNIZED',
  'application/dicom',
  'application/fhir+json',
  'application/fhir+xml',
  'application/msword',
  'application/octet-stream',
  'application/pdf',
  'application/rtf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg',
  'audio/wav',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'text/html',
  'text/plain',
  'text/rtf',
  'video/mp4',
] as const

export type SanitizedAttachmentContentType =
  (typeof SANITIZED_ATTACHMENT_CONTENT_TYPES)[number]

/**
 * Metadata for one embedded base64 representation. The digest is over the
 * UTF-8 representation string exposed by the format parser; it is explicitly
 * not a digest of decoded attachment bytes.
 */
export interface EmbeddedAttachmentObservation {
  contentType: SanitizedAttachmentContentType
  declaredSizeBytes: number | null
  base64RepresentationSha256: string
}

export interface EmbeddedAttachmentSummary {
  /** This literal makes the no-decode execution fact machine-verifiable. */
  decoded: false
  items: readonly EmbeddedAttachmentObservation[]
  /** True when more bounded observations existed than could be returned. */
  truncated: boolean
}
