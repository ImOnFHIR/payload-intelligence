// SPDX-License-Identifier: Apache-2.0

import { isFhirR4ResourceType } from './fhir-r4-resource-types.js'
import { findXmlPolicyViolation, inspectXmlEnvelope } from './xml-envelope.js'
import type {
  DeclaredPayloadContext,
  DetectionCandidate,
  DetectionConflict,
  DetectionEvidence,
  DetectionIssue,
  DetectionResult,
  DetectionStatus,
  PayloadFormat,
} from './types.js'

export const MAX_PAYLOAD_BYTES = 8_000_000
export const MAX_JSON_DEPTH = 64
export const MAX_NDJSON_LINES = 10_000
export const MAX_NDJSON_LINE_BYTES = 1_000_000
export const MAX_HL7_SEGMENTS = 10_000

/**
 * Closed detector vocabularies used by the main-process trust boundary. A
 * compromised parser renderer must not turn an arbitrary uppercase payload
 * value into an evidence token that can reach the model sketch or MCP result.
 */
export const DETECTION_EVIDENCE_CODES = [
  'ARCHIVE_MAGIC',
  'BINARY_CONTROL_DENSITY',
  'CDA_CLINICAL_DOCUMENT_ROOT',
  'CONSISTENT_DELIMITED_ROWS',
  'DECLARED_CONTENT_TYPE_COMPATIBLE',
  'DECLARED_EXTENSION_COMPATIBLE',
  'DICOM_PREAMBLE_MAGIC',
  'EMPTY_OR_WHITESPACE_TEXT',
  'FHIR_NAMESPACE_UNKNOWN_R4_ROOT',
  'FHIR_NDJSON_PARTIAL_SHAPE',
  'FHIR_NDJSON_RECORDS',
  'FHIR_RESOURCE_TYPE_MARKER',
  'FHIR_XML_NAMESPACE',
  'HL7_MSH_ENVELOPE',
  'HL7_MSH_PREFIX',
  'JSON_OPENING_TOKEN',
  'JSON_PARSE_SUCCEEDED',
  'LINE_DELIMITED_JSON',
  'PDF_MAGIC',
  'UTF8_DECODE_FAILED',
  'UTF8_TEXT',
  'RESTRICTED_EDI_SHAPE',
  'XML_OPENING_TAG',
  'XML_ROOT_PRESENT',
] as const

export const DETECTION_CONFLICT_CODES = [
  'DECLARED_METADATA_INTERNAL_CONFLICT',
  'DECLARED_CONTENT_TYPE_CONFLICT',
  'DECLARED_EXTENSION_CONFLICT',
] as const

export const DETECTION_ISSUE_CODES = [
  'FHIR_NDJSON_RECORD_INVALID',
  'FHIR_R4_RESOURCE_TYPE_UNRECOGNIZED',
  'HL7_MSH_ENVELOPE_INVALID',
  'HL7_SEGMENT_LIMIT_EXCEEDED',
  'JSON_DEPTH_LIMIT_EXCEEDED',
  'JSON_PARSE_FAILED',
  'NDJSON_LINE_LIMIT_EXCEEDED',
  'NDJSON_RECORD_SIZE_LIMIT_EXCEEDED',
  'PAYLOAD_SIZE_LIMIT_EXCEEDED',
  'XML_ATTRIBUTE_LIMIT_EXCEEDED',
  'XML_DOCTYPE_PROHIBITED',
  'XML_ELEMENT_LIMIT_EXCEEDED',
  'XML_ENTITY_PROHIBITED',
  'XML_NETWORK_REFERENCE_PROHIBITED',
  'XML_NOT_WELL_FORMED',
  'XML_ROOT_INVALID',
  'XML_XINCLUDE_PROHIBITED',
] as const

export const DETECTION_SAFE_CODES = [
  ...DETECTION_EVIDENCE_CODES,
  ...DETECTION_CONFLICT_CODES,
  ...DETECTION_ISSUE_CODES,
] as const

const UTF8 = new TextDecoder('utf-8', { fatal: true })
const UTF8_ENCODER = new TextEncoder()

const evidence = (
  code: string,
  source: DetectionEvidence['source'],
  description: string,
): DetectionEvidence => ({ code, source, description })

function candidate(
  format: PayloadFormat,
  evidenceScore: number,
  signature: DetectionCandidate['signature'],
  findings: DetectionEvidence[],
): DetectionCandidate {
  return { format, evidenceScore, signature, evidence: findings }
}

function bytesOf(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? UTF8_ENCODER.encode(input) : input
}

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false
  return signature.every((value, index) => bytes[index] === value)
}

function baseResult(byteCount: number): Pick<DetectionResult, 'schemaVersion' | 'byteCount' | 'conflicts' | 'issues'> {
  return {
    schemaVersion: 'imonfhir.payload-fingerprint.v1',
    byteCount,
    conflicts: [],
    issues: [],
  }
}

function rejected(byteCount: number, issues: DetectionIssue[], candidates: DetectionCandidate[] = []): DetectionResult {
  const sorted = sortCandidates(candidates)
  return {
    ...baseResult(byteCount),
    status: 'REJECTED',
    candidates: sorted,
    issues,
    observedFormat: sorted[0]?.format,
    automaticRoutingEligible: false,
  }
}

function sortCandidates(candidates: DetectionCandidate[]): DetectionCandidate[] {
  return [...candidates].sort(
    (left, right) => right.evidenceScore - left.evidenceScore || left.format.localeCompare(right.format),
  )
}

interface DeclaredFormat {
  format: PayloadFormat
  genericFamily: boolean
  source: 'content-type' | 'extension'
}

const CONTENT_TYPE_FORMATS: Readonly<Record<string, Omit<DeclaredFormat, 'source'>>> = {
  'application/fhir+json': { format: 'FHIR_JSON', genericFamily: false },
  'application/fhir+xml': { format: 'FHIR_XML', genericFamily: false },
  'application/fhir+ndjson': { format: 'FHIR_NDJSON', genericFamily: false },
  'application/ndjson': { format: 'FHIR_NDJSON', genericFamily: true },
  'application/hl7-v2': { format: 'HL7_V2_ER7', genericFamily: false },
  'application/edi': { format: 'RESTRICTED_EDI_UNSUPPORTED', genericFamily: false },
  'application/json': { format: 'GENERIC_JSON', genericFamily: true },
  'text/json': { format: 'GENERIC_JSON', genericFamily: true },
  'application/xml': { format: 'GENERIC_XML', genericFamily: true },
  'text/xml': { format: 'GENERIC_XML', genericFamily: true },
  'text/csv': { format: 'DELIMITED_TEXT', genericFamily: true },
  'application/pdf': { format: 'PDF', genericFamily: false },
  'application/dicom': { format: 'DICOM', genericFamily: false },
  'application/zip': { format: 'ARCHIVE', genericFamily: true },
  'application/gzip': { format: 'ARCHIVE', genericFamily: true },
}

const EXTENSION_FORMATS: Readonly<Record<string, Omit<DeclaredFormat, 'source'>>> = {
  json: { format: 'GENERIC_JSON', genericFamily: true },
  xml: { format: 'GENERIC_XML', genericFamily: true },
  ndjson: { format: 'FHIR_NDJSON', genericFamily: true },
  hl7: { format: 'HL7_V2_ER7', genericFamily: false },
  er7: { format: 'HL7_V2_ER7', genericFamily: false },
  edi: { format: 'RESTRICTED_EDI_UNSUPPORTED', genericFamily: false },
  csv: { format: 'DELIMITED_TEXT', genericFamily: true },
  tsv: { format: 'DELIMITED_TEXT', genericFamily: true },
  pdf: { format: 'PDF', genericFamily: false },
  dcm: { format: 'DICOM', genericFamily: false },
  zip: { format: 'ARCHIVE', genericFamily: true },
  gz: { format: 'ARCHIVE', genericFamily: true },
  gzip: { format: 'ARCHIVE', genericFamily: true },
  rar: { format: 'ARCHIVE', genericFamily: true },
  '7z': { format: 'ARCHIVE', genericFamily: true },
}

function declaredFormats(context: DeclaredPayloadContext): DeclaredFormat[] {
  const result: DeclaredFormat[] = []
  const contentType = context.contentType?.split(';', 1)[0]?.trim().toLowerCase()
  const fromContentType = contentType ? CONTENT_TYPE_FORMATS[contentType] : undefined
  if (fromContentType) result.push({ ...fromContentType, source: 'content-type' })

  const displayName = context.fileName?.replaceAll('\\', '/').split('/').at(-1) ?? ''
  const extension = displayName.includes('.') ? displayName.split('.').at(-1)?.toLowerCase() : undefined
  const fromExtension = extension ? EXTENSION_FORMATS[extension] : undefined
  if (fromExtension) result.push({ ...fromExtension, source: 'extension' })
  return result
}

function formatFamily(format: PayloadFormat): 'JSON' | 'XML' | 'TEXT' | 'OPAQUE' | 'BINARY' {
  if (format === 'FHIR_JSON' || format === 'FHIR_NDJSON' || format === 'GENERIC_JSON') return 'JSON'
  if (format === 'FHIR_XML' || format === 'CDA_XML' || format === 'GENERIC_XML') return 'XML'
  if (format === 'HL7_V2_ER7' || format === 'RESTRICTED_EDI_UNSUPPORTED' || format === 'DELIMITED_TEXT' || format === 'UNKNOWN_TEXT') {
    return 'TEXT'
  }
  if (format === 'PDF' || format === 'DICOM' || format === 'ARCHIVE') return 'OPAQUE'
  return 'BINARY'
}

function declaredCompatible(observed: PayloadFormat, declared: DeclaredFormat): boolean {
  if (observed === declared.format) return true
  if (declared.genericFamily) return formatFamily(observed) === formatFamily(declared.format)
  return false
}

function applyDeclaredContext(
  observed: PayloadFormat | undefined,
  context: DeclaredPayloadContext,
): { conflicts: DetectionConflict[]; evidence: DetectionEvidence[] } {
  const declarations = declaredFormats(context)
  const conflicts: DetectionConflict[] = []
  const compatibleEvidence: DetectionEvidence[] = []

  if (declarations.length === 2 && !declaredCompatible(declarations[0].format, declarations[1])) {
    conflicts.push({
      code: 'DECLARED_METADATA_INTERNAL_CONFLICT',
      description: 'The declared media type and file extension indicate incompatible format families.',
      declaredFormat: declarations[0].format,
    })
  }

  if (!observed) return { conflicts, evidence: compatibleEvidence }

  for (const declaration of declarations) {
    if (declaredCompatible(observed, declaration)) {
      compatibleEvidence.push(
        evidence(
          declaration.source === 'content-type' ? 'DECLARED_CONTENT_TYPE_COMPATIBLE' : 'DECLARED_EXTENSION_COMPATIBLE',
          'DECLARED_METADATA',
          'Declared metadata is compatible with the byte-derived format family.',
        ),
      )
    } else {
      conflicts.push({
        code:
          declaration.source === 'content-type'
            ? 'DECLARED_CONTENT_TYPE_CONFLICT'
            : 'DECLARED_EXTENSION_CONFLICT',
        description: 'Declared metadata conflicts with the byte-derived format.',
        declaredFormat: declaration.format,
        observedFormat: observed,
      })
    }
  }

  return { conflicts, evidence: compatibleEvidence }
}

function finalize(
  byteCount: number,
  candidates: DetectionCandidate[],
  context: DeclaredPayloadContext,
  defaultStatus: DetectionStatus = 'DETECTED',
  issues: DetectionIssue[] = [],
): DetectionResult {
  const sorted = sortCandidates(candidates)
  const observedFormat = sorted[0]?.format
  const declared = applyDeclaredContext(observedFormat, context)
  if (sorted[0] && declared.evidence.length > 0) {
    sorted[0] = { ...sorted[0], evidence: [...sorted[0].evidence, ...declared.evidence] }
  }

  const status: DetectionStatus =
    defaultStatus === 'REJECTED'
      ? 'REJECTED'
      : declared.conflicts.length > 0
        ? 'AMBIGUOUS'
        : defaultStatus

  return {
    ...baseResult(byteCount),
    status,
    candidates: sorted,
    conflicts: declared.conflicts,
    issues,
    observedFormat,
    // Deterministic evidence can rank candidates, but only the separate
    // calibrated policy layer may authorize or select an automatic route.
    selectedFormat: undefined,
    automaticRoutingEligible: false,
  }
}

function detectOpaque(bytes: Uint8Array): DetectionCandidate | undefined {
  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return candidate('PDF', 1, 'OPAQUE_MAGIC', [
      evidence('PDF_MAGIC', 'BYTES', 'The payload begins with the PDF file signature.'),
    ])
  }
  if (
    bytes.byteLength >= 132 &&
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  ) {
    return candidate('DICOM', 1, 'OPAQUE_MAGIC', [
      evidence('DICOM_PREAMBLE_MAGIC', 'BYTES', 'The DICOM marker is present after the 128-byte preamble.'),
    ])
  }
  if (
    startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(bytes, [0x50, 0x4b, 0x07, 0x08]) ||
    startsWithBytes(bytes, [0x1f, 0x8b]) ||
    startsWithBytes(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) ||
    startsWithBytes(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
  ) {
    return candidate('ARCHIVE', 1, 'OPAQUE_MAGIC', [
      evidence('ARCHIVE_MAGIC', 'BYTES', 'The payload begins with a recognized archive signature.'),
    ])
  }
  return undefined
}

function hasBinaryControls(text: string): boolean {
  if (text.length === 0) return false
  let controls = 0
  const sampleLength = Math.min(text.length, 16_384)
  for (let index = 0; index < sampleLength; index += 1) {
    const code = text.charCodeAt(index)
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) controls += 1
  }
  return controls / sampleLength > 0.02
}

interface JsonDepthResult {
  maxDepth: number
  exceeded: boolean
}

function scanJsonDepth(text: string): JsonDepthResult {
  let depth = 0
  let maxDepth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') {
      depth += 1
      maxDepth = Math.max(maxDepth, depth)
      if (maxDepth > MAX_JSON_DEPTH) return { maxDepth, exceeded: true }
    } else if (character === '}' || character === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
  return { maxDepth, exceeded: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasFhirResourceMarker(value: unknown): value is Record<string, unknown> & { resourceType: string } {
  return isRecord(value) && isFhirR4ResourceType(value.resourceType)
}

function detectWholeJson(
  text: string,
  byteCount: number,
  context: DeclaredPayloadContext,
): DetectionResult | undefined {
  const trimmed = text.trim()
  if (!/^[{["\-0-9tfn]/.test(trimmed)) return undefined
  const depth = scanJsonDepth(trimmed)
  if (depth.exceeded) {
    return rejected(
      byteCount,
      [{ code: 'JSON_DEPTH_LIMIT_EXCEEDED', description: 'JSON nesting exceeds the 64-level intake limit.' }],
      [candidate('GENERIC_JSON', 0.6, 'HEURISTIC', [evidence('JSON_OPENING_TOKEN', 'BYTES', 'The payload begins with a JSON token.')])],
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }

  if (hasFhirResourceMarker(parsed)) {
    return finalize(
      byteCount,
      [
        candidate('FHIR_JSON', 0.99, 'DETERMINISTIC', [
          evidence('FHIR_RESOURCE_TYPE_MARKER', 'STRUCTURE', 'The JSON root carries a syntactically valid FHIR resource type marker.'),
        ]),
        candidate('GENERIC_JSON', 0.55, 'HEURISTIC', [
          evidence('JSON_PARSE_SUCCEEDED', 'STRUCTURE', 'The complete payload parses as one JSON value.'),
        ]),
      ],
      context,
    )
  }

  return finalize(
    byteCount,
    [
      candidate('GENERIC_JSON', 0.94, 'HEURISTIC', [
        evidence('JSON_PARSE_SUCCEEDED', 'STRUCTURE', 'The complete payload parses as one JSON value.'),
      ]),
    ],
    context,
  )
}

function nonEmptyLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0)
}

function detectNdjson(
  text: string,
  byteCount: number,
  context: DeclaredPayloadContext,
): DetectionResult | undefined {
  const lines = nonEmptyLines(text)
  if (lines.length < 2 || !lines[0].trimStart().startsWith('{')) return undefined

  const appearsFhir = lines.slice(0, Math.min(lines.length, 8)).some((line) => /"resourceType"\s*:/.test(line))
  if (!appearsFhir) return undefined
  if (lines.length > MAX_NDJSON_LINES) {
    return rejected(byteCount, [
      { code: 'NDJSON_LINE_LIMIT_EXCEEDED', description: 'NDJSON input exceeds the 10,000-line intake limit.' },
    ])
  }

  for (const line of lines) {
    if (UTF8_ENCODER.encode(line).byteLength > MAX_NDJSON_LINE_BYTES) {
      return rejected(byteCount, [
        { code: 'NDJSON_RECORD_SIZE_LIMIT_EXCEEDED', description: 'An NDJSON record exceeds the 1 MB per-line intake limit.' },
      ])
    }
    if (scanJsonDepth(line).exceeded) {
      return rejected(byteCount, [
        { code: 'JSON_DEPTH_LIMIT_EXCEEDED', description: 'An NDJSON record exceeds the 64-level JSON depth limit.' },
      ])
    }
    try {
      const parsed = JSON.parse(line) as unknown
      if (!hasFhirResourceMarker(parsed)) {
        return rejected(
          byteCount,
          [{ code: 'FHIR_NDJSON_RECORD_INVALID', description: 'Every FHIR NDJSON record must be a JSON object with a FHIR resource type marker.' }],
          [candidate('FHIR_NDJSON', 0.75, 'HEURISTIC', [evidence('FHIR_NDJSON_PARTIAL_SHAPE', 'STRUCTURE', 'The input has a partial FHIR NDJSON shape.')])],
        )
      }
    } catch {
      return rejected(
        byteCount,
        [{ code: 'FHIR_NDJSON_RECORD_INVALID', description: 'At least one FHIR NDJSON record is not valid JSON.' }],
        [candidate('FHIR_NDJSON', 0.75, 'HEURISTIC', [evidence('FHIR_NDJSON_PARTIAL_SHAPE', 'STRUCTURE', 'The input has a partial FHIR NDJSON shape.')])],
      )
    }
  }

  return finalize(
    byteCount,
    [
      candidate('FHIR_NDJSON', 1, 'DETERMINISTIC', [
        evidence('FHIR_NDJSON_RECORDS', 'STRUCTURE', 'Every non-empty line is a FHIR-shaped JSON resource object.'),
      ]),
      candidate('GENERIC_JSON', 0.45, 'HEURISTIC', [
        evidence('LINE_DELIMITED_JSON', 'STRUCTURE', 'The payload contains multiple line-delimited JSON values.'),
      ]),
    ],
    context,
  )
}

function countSegments(text: string): number {
  return nonEmptyLines(text).length
}

function detectHl7(
  text: string,
  byteCount: number,
  context: DeclaredPayloadContext,
): DetectionResult | undefined {
  if (!text.startsWith('MSH')) return undefined
  const firstTerminator = text.search(/[\r\n]/)
  const firstSegment = firstTerminator === -1 ? text : text.slice(0, firstTerminator)
  const separator = firstSegment[3]
  const encodingCharacters = firstSegment.slice(4, 8)
  const segments = countSegments(text)

  if (segments > MAX_HL7_SEGMENTS) {
    return rejected(
      byteCount,
      [{ code: 'HL7_SEGMENT_LIMIT_EXCEEDED', description: 'HL7 v2 input exceeds the 10,000-segment intake limit.' }],
      [candidate('HL7_V2_ER7', 0.8, 'HEURISTIC', [evidence('HL7_MSH_PREFIX', 'BYTES', 'The payload begins with an MSH segment marker.')])],
    )
  }
  if (
    firstSegment.length < 9 ||
    !separator ||
    /[A-Za-z0-9\s]/.test(separator) ||
    encodingCharacters.length !== 4 ||
    /[A-Za-z0-9\s]/.test(encodingCharacters)
  ) {
    return rejected(
      byteCount,
      [{ code: 'HL7_MSH_ENVELOPE_INVALID', description: 'The MSH delimiter envelope is incomplete or invalid.' }],
      [candidate('HL7_V2_ER7', 0.7, 'HEURISTIC', [evidence('HL7_MSH_PREFIX', 'BYTES', 'The payload begins with an MSH segment marker.')])],
    )
  }

  return finalize(
    byteCount,
    [
      candidate('HL7_V2_ER7', 1, 'DETERMINISTIC', [
        evidence('HL7_MSH_ENVELOPE', 'STRUCTURE', 'The input begins with a structurally valid MSH delimiter envelope.'),
      ]),
    ],
    context,
  )
}

/**
 * Conservative, standard-neutral EDI-shape recognition. This deliberately
 * contains no X12 segment identifiers, schemas, mappings, or code tables.
 */
function detectRestrictedEdi(
  text: string,
  byteCount: number,
  context: DeclaredPayloadContext,
): DetectionResult | undefined {
  const segments = text.split(/[~\r\n]+/).filter(Boolean).slice(0, 8)
  if (segments.length < 3) return undefined
  if (!segments.every((segment) => /^[A-Z0-9]{2,3}[^A-Z0-9\s]/.test(segment))) return undefined
  return finalize(
    byteCount,
    [
      candidate('RESTRICTED_EDI_UNSUPPORTED', 0.8, 'HEURISTIC', [
        evidence('RESTRICTED_EDI_SHAPE', 'STRUCTURE', 'The payload has a bounded, delimiter-based EDI shape that is not interpreted by this preview.'),
      ]),
    ],
    context,
  )
}

function detectXml(
  text: string,
  byteCount: number,
  context: DeclaredPayloadContext,
): DetectionResult | undefined {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('<')) return undefined

  const prohibition = findXmlPolicyViolation(trimmed)
  if (prohibition) {
    return rejected(byteCount, [prohibition])
  }

  const inspection = inspectXmlEnvelope(trimmed)
  if (!inspection.ok) {
    return rejected(
      byteCount,
      [inspection.issue],
      [candidate('GENERIC_XML', 0.55, 'HEURISTIC', [evidence('XML_OPENING_TAG', 'BYTES', 'The payload begins with an XML opening tag.')])],
    )
  }
  const { localName, namespaceUri } = inspection.root
  const fhirNamespace = namespaceUri === 'http://hl7.org/fhir'
  const cdaNamespace = namespaceUri === 'urn:hl7-org:v3'

  if (fhirNamespace && isFhirR4ResourceType(localName)) {
    return finalize(
      byteCount,
      [
        candidate('FHIR_XML', 1, 'DETERMINISTIC', [
          evidence('FHIR_XML_NAMESPACE', 'STRUCTURE', 'The XML root declares the FHIR namespace.'),
        ]),
        candidate('GENERIC_XML', 0.55, 'HEURISTIC', [
          evidence('XML_ROOT_PRESENT', 'STRUCTURE', 'The payload has a bounded XML root element.'),
        ]),
      ],
      context,
    )
  }

  if (fhirNamespace) {
    return finalize(
      byteCount,
      [
        candidate('GENERIC_XML', 0.94, 'HEURISTIC', [
          evidence('FHIR_NAMESPACE_UNKNOWN_R4_ROOT', 'STRUCTURE', 'The XML root uses the FHIR namespace but is not a concrete FHIR R4 resource type.'),
        ]),
      ],
      context,
      'DETECTED',
      [{ code: 'FHIR_R4_RESOURCE_TYPE_UNRECOGNIZED', description: 'The declared FHIR namespace has a root outside the pinned FHIR R4 resource vocabulary.' }],
    )
  }

  if (localName === 'ClinicalDocument' && cdaNamespace) {
    return finalize(
      byteCount,
      [
        candidate('CDA_XML', 1, 'DETERMINISTIC', [
          evidence('CDA_CLINICAL_DOCUMENT_ROOT', 'STRUCTURE', 'The XML root is ClinicalDocument in the HL7 v3 namespace.'),
        ]),
        candidate('GENERIC_XML', 0.55, 'HEURISTIC', [
          evidence('XML_ROOT_PRESENT', 'STRUCTURE', 'The payload has a bounded XML root element.'),
        ]),
      ],
      context,
    )
  }

  return finalize(
    byteCount,
    [
      candidate('GENERIC_XML', 0.94, 'HEURISTIC', [
        evidence('XML_ROOT_PRESENT', 'STRUCTURE', 'The payload has a bounded XML root element.'),
      ]),
    ],
    context,
  )
}

function splitDelimitedRow(row: string, delimiter: string): string[] | undefined {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < row.length; index += 1) {
    const character = row[index]
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      fields.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (quoted) return undefined
  fields.push(current)
  return fields
}

function detectDelimited(
  text: string,
  byteCount: number,
  context: DeclaredPayloadContext,
): DetectionResult | undefined {
  const lines = nonEmptyLines(text)
  if (lines.length < 2) return undefined
  const sample = lines.slice(0, Math.min(50, lines.length))
  const delimiters = [',', '\t', '|', ';'] as const
  for (const delimiter of delimiters) {
    const rows = sample.map((line) => splitDelimitedRow(line, delimiter))
    const width = rows[0]?.length ?? 0
    if (width >= 2 && rows.every((row) => row !== undefined && row.length === width)) {
      return finalize(
        byteCount,
        [
          candidate('DELIMITED_TEXT', 0.9, 'HEURISTIC', [
            evidence('CONSISTENT_DELIMITED_ROWS', 'STRUCTURE', 'Sampled rows have a consistent delimited field count.'),
          ]),
        ],
        context,
      )
    }
  }
  return undefined
}

/**
 * Fingerprint bounded payload bytes without invoking a model or a standards
 * validator. The function never returns payload fragments or parser messages.
 */
export function fingerprintPayload(
  input: Uint8Array | string,
  context: DeclaredPayloadContext = {},
): DetectionResult {
  const bytes = bytesOf(input)
  const byteCount = bytes.byteLength
  if (byteCount > MAX_PAYLOAD_BYTES) {
    return rejected(byteCount, [
      { code: 'PAYLOAD_SIZE_LIMIT_EXCEEDED', description: 'Payload exceeds the 8,000,000-byte intake limit.' },
    ])
  }

  const opaque = detectOpaque(bytes)
  if (opaque) return finalize(byteCount, [opaque], context, 'OPAQUE')

  let text: string
  try {
    text = UTF8.decode(bytes)
  } catch {
    return finalize(
      byteCount,
      [candidate('UNKNOWN_BINARY', 1, 'HEURISTIC', [evidence('UTF8_DECODE_FAILED', 'BYTES', 'The payload is not valid UTF-8 text.')])],
      context,
      'UNKNOWN',
    )
  }

  if (hasBinaryControls(text)) {
    return finalize(
      byteCount,
      [candidate('UNKNOWN_BINARY', 0.98, 'HEURISTIC', [evidence('BINARY_CONTROL_DENSITY', 'BYTES', 'The decoded payload contains a binary control-byte density.')])],
      context,
      'UNKNOWN',
    )
  }

  text = text.replace(/^\uFEFF/, '')
  if (text.trim().length === 0) {
    return finalize(
      byteCount,
      [candidate('UNKNOWN_TEXT', 0.5, 'HEURISTIC', [evidence('EMPTY_OR_WHITESPACE_TEXT', 'BYTES', 'The payload contains no non-whitespace text.')])],
      context,
      'UNKNOWN',
    )
  }

  const hl7 = detectHl7(text, byteCount, context)
  if (hl7) return hl7
  const restrictedEdi = detectRestrictedEdi(text, byteCount, context)
  if (restrictedEdi) return restrictedEdi
  const xml = detectXml(text, byteCount, context)
  if (xml) return xml
  const json = detectWholeJson(text, byteCount, context)
  if (json) return json
  const ndjson = detectNdjson(text, byteCount, context)
  if (ndjson) return ndjson
  if (/^[{[]/.test(text.trimStart())) {
    return rejected(byteCount, [
      { code: 'JSON_PARSE_FAILED', description: 'The JSON-shaped payload is not syntactically valid JSON or bounded FHIR NDJSON.' },
    ])
  }
  const delimited = detectDelimited(text, byteCount, context)
  if (delimited) return delimited

  return finalize(
    byteCount,
    [candidate('UNKNOWN_TEXT', 0.5, 'HEURISTIC', [evidence('UTF8_TEXT', 'BYTES', 'The payload is bounded UTF-8 text without a supported signature.')])],
    context,
    'UNKNOWN',
  )
}
