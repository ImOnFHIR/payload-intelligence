// SPDX-License-Identifier: Apache-2.0

import { sha256 } from '@noble/hashes/sha2.js'

import { fingerprintPayload } from './detection.js'
import { FHIR_R4_RESOURCE_TYPES, isFhirR4ResourceType } from './fhir-r4-resource-types.js'
import type { DetectionResult, PayloadFormat, ShapeFeature, ShapeSketch } from './types.js'

const MAX_FEATURES = 256
const MAX_SKETCH_DEPTH = 12
const MAX_JSON_NODES_TO_SCAN = 4_096
const MAX_XML_ELEMENTS_TO_SCAN = 4_096

const UTF8 = new TextDecoder()
const UTF8_ENCODER = new TextEncoder()

export const SHAPE_SKETCH_SAFE_JSON_STRUCTURAL_NAMES = Object.freeze([
  'resourceType',
  'meta',
  'profile',
  'entry',
  'resource',
  'type',
  'contained',
  'extension',
  'modifierExtension',
  'subject',
  'patient',
  'beneficiary',
  'provider',
  'insurer',
  'organization',
  'requester',
  'recipient',
  'performer',
  'supportingInfo',
  'diagnosis',
  'procedure',
  'insurance',
  'item',
  'reference',
  'coding',
  'code',
  'system',
  'status',
  'intent',
  'use',
  'priority',
  'focus',
  'encounter',
  'author',
  'custodian',
  'section',
  'component',
  'category',
  'reason',
  'input',
  'output',
  'parameter',
  'issue',
  'response',
  'request',
  'link',
  'relationship',
])

export const SHAPE_SKETCH_PROTECTED_JSON_NAMES = Object.freeze([
  'id',
  'identifier',
  'name',
  'address',
  'telecom',
  'birthDate',
  'deceasedDateTime',
  'text',
  'narrative',
  'note',
  'display',
  'valueString',
  'valueHumanName',
  'valueAddress',
  'valueContactPoint',
])

export const SHAPE_SKETCH_SAFE_XML_STRUCTURAL_NAMES = Object.freeze([
  'ClinicalDocument',
  'component',
  'structuredBody',
  'section',
  'entry',
  'observation',
  'procedure',
  'organizer',
  'substanceAdministration',
  'encounter',
  'act',
  'templateId',
  'code',
  'statusCode',
  'effectiveTime',
  'recordTarget',
  'author',
  'custodian',
  'legalAuthenticator',
  'componentOf',
  'documentationOf',
  ...FHIR_R4_RESOURCE_TYPES,
])

export const SHAPE_SKETCH_PROTECTED_XML_NAMES = Object.freeze([
  'id',
  'name',
  'given',
  'family',
  'addr',
  'telecom',
  'birthTime',
  'title',
  'text',
  'value',
  'reference',
])

export const SHAPE_SKETCH_SAFE_HL7_SEGMENTS = Object.freeze([
  'MSH',
  'OBX',
  'NTE',
])

const SAFE_FHIR_VALUE_MARKERS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  type: new Set(['batch', 'transaction', 'collection', 'history', 'searchset', 'message', 'document']),
  use: new Set(['claim', 'preauthorization', 'predetermination']),
  intent: new Set(['proposal', 'plan', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']),
  status: new Set(['active', 'draft', 'cancelled', 'completed', 'entered-in-error']),
})

const SAFE_HL7_MESSAGE_CODES = new Set(['ADT', 'ORM', 'ORU', 'SIU', 'MDM', 'DFT'])
const SAFE_HL7_TRIGGER_CODES = new Set(['A01', 'A03', 'O01', 'R01', 'S12', 'T02', 'P03'])
const SAFE_HL7_VERSIONS = new Set([
  '2.3', '2.3.1', '2.4', '2.5', '2.5.1', '2.6', '2.7', '2.7.1', '2.8', '2.8.1', '2.8.2', '2.9',
])

/**
 * The only irreversible labels emitted for structural names outside the
 * published vocabulary. Keep this source shared with the process-boundary
 * schema so a compromised renderer cannot return an arbitrary token that only
 * happens to look identifier-like.
 */
export const SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE =
  '(?:key|element|segment)_[a-f0-9]{12}'

/** Literal feature names that may leave the isolated renderer. */
export const SHAPE_SKETCH_ALLOWED_FEATURE_NAMES = Object.freeze(
  [...new Set([
    ...SHAPE_SKETCH_SAFE_JSON_STRUCTURAL_NAMES,
    ...SHAPE_SKETCH_SAFE_XML_STRUCTURAL_NAMES,
    ...SHAPE_SKETCH_SAFE_HL7_SEGMENTS,
    'PROTECTED_FIELD',
    'PROTECTED_ELEMENT',
    'ARRAY_ITEMS',
    'FHIR_RESOURCE_MARKER_PRESENT',
    'FHIR_RESOURCE_TYPE_UNRECOGNIZED',
    'FHIR_METADATA_PRESENT',
    'JSON_NODE_TYPE',
    ...Object.entries(SAFE_FHIR_VALUE_MARKERS).flatMap(([field, values]) =>
      [...values].map((value) => `FHIR_${field.toUpperCase()}_${value.toUpperCase().replaceAll('-', '_')}`)
    ),
    ...[...SAFE_HL7_MESSAGE_CODES].map((value) => `HL7_MESSAGE_${value}`),
    ...[...SAFE_HL7_TRIGGER_CODES].map((value) => `HL7_TRIGGER_${value}`),
    ...[...SAFE_HL7_VERSIONS].map((value) => `HL7_VERSION_${value.replaceAll('.', '_')}`),
    ...FHIR_R4_RESOURCE_TYPES.map((resourceType) =>
      `FHIR_RESOURCE_${resourceType.toUpperCase()}`
    ),
  ])].sort()
)

/** Literal structural tokens allowed inside a shape-sketch path. */
export const SHAPE_SKETCH_ALLOWED_PATH_TOKENS = Object.freeze(
  [...new Set([
    ...SHAPE_SKETCH_SAFE_JSON_STRUCTURAL_NAMES,
    ...SHAPE_SKETCH_SAFE_XML_STRUCTURAL_NAMES,
    'PROTECTED_FIELD',
    'PROTECTED_ELEMENT',
  ])].sort()
)

const SAFE_JSON_STRUCTURAL_NAMES: ReadonlySet<string> =
  new Set(SHAPE_SKETCH_SAFE_JSON_STRUCTURAL_NAMES)
const PROTECTED_JSON_NAMES: ReadonlySet<string> =
  new Set(SHAPE_SKETCH_PROTECTED_JSON_NAMES)
const SAFE_XML_STRUCTURAL_NAMES: ReadonlySet<string> =
  new Set(SHAPE_SKETCH_SAFE_XML_STRUCTURAL_NAMES)
const PROTECTED_XML_NAMES: ReadonlySet<string> =
  new Set(SHAPE_SKETCH_PROTECTED_XML_NAMES)
const SAFE_HL7_SEGMENTS: ReadonlySet<string> =
  new Set(SHAPE_SKETCH_SAFE_HL7_SEGMENTS)

function bytesOf(input: Uint8Array | string): Uint8Array {
  return typeof input === 'string' ? UTF8_ENCODER.encode(input) : input
}

function opaqueName(prefix: 'key' | 'element' | 'segment', raw: string): string {
  const digest = toHex(sha256(UTF8_ENCODER.encode(raw))).slice(0, 12)
  return `${prefix}_${digest}`
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function jsonName(raw: string): string {
  if (PROTECTED_JSON_NAMES.has(raw)) return 'PROTECTED_FIELD'
  if (SAFE_JSON_STRUCTURAL_NAMES.has(raw)) return raw
  return opaqueName('key', raw)
}

function xmlName(raw: string): string {
  const localName = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw
  if (PROTECTED_XML_NAMES.has(localName)) return 'PROTECTED_ELEMENT'
  if (SAFE_XML_STRUCTURAL_NAMES.has(localName)) return localName
  return opaqueName('element', localName)
}

function segmentName(raw: string): string {
  if (SAFE_HL7_SEGMENTS.has(raw)) return raw
  return opaqueName('segment', raw)
}

function jsonType(value: unknown): ShapeFeature['dataType'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return undefined
}

class FeatureCollector {
  private readonly values = new Map<string, ShapeFeature>()
  private visitedNodes = 0
  truncated = false

  visitNode(): boolean {
    this.visitedNodes += 1
    if (this.visitedNodes <= MAX_JSON_NODES_TO_SCAN) return true
    this.truncated = true
    return false
  }

  add(feature: ShapeFeature): void {
    const key = [feature.kind, feature.name, feature.path ?? '', feature.dataType ?? '', feature.count ?? ''].join('|')
    if (this.values.has(key)) return
    if (this.values.size >= MAX_FEATURES) {
      this.truncated = true
      return
    }
    this.values.set(key, feature)
  }

  list(): ShapeFeature[] {
    return [...this.values.values()].sort((left, right) => {
      const leftKey = [left.kind, left.path ?? '', left.name, left.dataType ?? '', left.count ?? -1].join('|')
      const rightKey = [right.kind, right.path ?? '', right.name, right.dataType ?? '', right.count ?? -1].join('|')
      return leftKey.localeCompare(rightKey)
    })
  }
}

function addJsonShape(
  value: unknown,
  collector: FeatureCollector,
  path = '$',
  depth = 0,
): void {
  if (!collector.visitNode()) return
  if (depth > MAX_SKETCH_DEPTH) {
    collector.truncated = true
    return
  }

  if (Array.isArray(value)) {
    collector.add({ kind: 'COUNT', name: 'ARRAY_ITEMS', path, count: value.length })
    for (const item of value) addJsonShape(item, collector, `${path}[]`, depth + 1)
    return
  }

  if (typeof value !== 'object' || value === null) return
  const record = value as Record<string, unknown>
  if (typeof record.resourceType === 'string') {
    collector.add({ kind: 'SAFE_MARKER', name: 'FHIR_RESOURCE_MARKER_PRESENT', path })
    collector.add({
      kind: 'SAFE_MARKER',
      name: isFhirR4ResourceType(record.resourceType)
        ? `FHIR_RESOURCE_${record.resourceType.toUpperCase()}`
        : 'FHIR_RESOURCE_TYPE_UNRECOGNIZED',
      path,
    })
  }
  if (Array.isArray(record.profile) || (typeof record.meta === 'object' && record.meta !== null)) {
    collector.add({ kind: 'SAFE_MARKER', name: 'FHIR_METADATA_PRESENT', path })
  }
  for (const [field, allowed] of Object.entries(SAFE_FHIR_VALUE_MARKERS)) {
    const value = record[field]
    if (typeof value === 'string' && allowed.has(value)) {
      collector.add({
        kind: 'SAFE_MARKER',
        name: `FHIR_${field.toUpperCase()}_${value.toUpperCase().replaceAll('-', '_')}`,
        path,
      })
    }
  }

  for (const rawName of Object.keys(record).sort()) {
    const safeName = jsonName(rawName)
    const child = record[rawName]
    const childPath = `${path}.${safeName}`
    collector.add({ kind: 'STRUCTURAL_NAME', name: safeName, path: childPath })
    const dataType = jsonType(child)
    if (dataType) collector.add({ kind: 'DATA_TYPE', name: 'JSON_NODE_TYPE', path: childPath, dataType })
    addJsonShape(child, collector, childPath, depth + 1)
  }
}

function addJsonFeatures(text: string, format: PayloadFormat, collector: FeatureCollector): number | undefined {
  if (format === 'FHIR_NDJSON') {
    const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0)
    for (const line of lines) {
      try {
        addJsonShape(JSON.parse(line) as unknown, collector)
      } catch {
        collector.truncated = true
        break
      }
    }
    return lines.length
  }
  try {
    addJsonShape(JSON.parse(text) as unknown, collector)
  } catch {
    collector.truncated = true
  }
  return undefined
}

function stripXmlValues(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
}

function addXmlFeatures(text: string, collector: FeatureCollector): number {
  const tags = stripXmlValues(text).matchAll(/<\s*(\/?)\s*([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)(?:\s[^<>]*?)?\s*(\/?)>/g)
  const stack: string[] = []
  let elements = 0
  for (const match of tags) {
    const closing = match[1] === '/'
    const selfClosing = match[3] === '/'
    const safeName = xmlName(match[2])
    if (closing) {
      stack.pop()
      continue
    }
    elements += 1
    if (elements > MAX_XML_ELEMENTS_TO_SCAN) {
      collector.truncated = true
      break
    }
    const path = `/${[...stack, safeName].join('/')}`
    collector.add({ kind: 'STRUCTURAL_NAME', name: safeName, path, dataType: 'element' })
    const localName = match[2].includes(':') ? match[2].slice(match[2].lastIndexOf(':') + 1) : match[2]
    if (isFhirR4ResourceType(localName)) {
      collector.add({ kind: 'SAFE_MARKER', name: `FHIR_RESOURCE_${localName.toUpperCase()}`, path })
    }
    if (!selfClosing) stack.push(safeName)
    if (stack.length > MAX_SKETCH_DEPTH) {
      collector.truncated = true
      stack.length = MAX_SKETCH_DEPTH
    }
  }
  return elements
}

function addHl7Features(text: string, collector: FeatureCollector): number {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.length > 0)
  const counts = new Map<string, number>()
  for (const line of lines) {
    const rawName = line.slice(0, 3)
    if (!/^[A-Z][A-Z0-9]{2}$/.test(rawName)) continue
    const safeName = segmentName(rawName)
    counts.set(safeName, (counts.get(safeName) ?? 0) + 1)
  }
  for (const [name, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    collector.add({ kind: 'COUNT', name, dataType: 'segment', count })
  }
  const msh = lines.find((line) => line.startsWith('MSH') && line.length >= 4)
  if (msh) {
    const separator = msh[3]
    const fields = msh.split(separator)
    const messageParts = (fields[8] ?? '').split('^')
    const messageCode = messageParts[0]
    const triggerCode = messageParts[1]
    const version = fields[11]
    if (messageCode && SAFE_HL7_MESSAGE_CODES.has(messageCode)) {
      collector.add({ kind: 'SAFE_MARKER', name: `HL7_MESSAGE_${messageCode}` })
    }
    if (triggerCode && SAFE_HL7_TRIGGER_CODES.has(triggerCode)) {
      collector.add({ kind: 'SAFE_MARKER', name: `HL7_TRIGGER_${triggerCode}` })
    }
    if (version && SAFE_HL7_VERSIONS.has(version)) {
      collector.add({ kind: 'SAFE_MARKER', name: `HL7_VERSION_${version.replaceAll('.', '_')}` })
    }
  }
  return lines.length
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') lines += 1
    else if (text[index] === '\r' && text[index + 1] !== '\n') lines += 1
  }
  return lines
}

function equivalentDetection(provided: DetectionResult, observed: DetectionResult): boolean {
  return (
    provided.byteCount === observed.byteCount &&
    provided.status === observed.status &&
    provided.observedFormat === observed.observedFormat
  )
}

/**
 * Produce the only model-eligible representation of a payload. Instance values,
 * attribute values, free text and identifiers are never copied into the result.
 * A fresh fingerprint prevents a caller-supplied result from bypassing the
 * restricted-EDI and rejected-input exposure gates.
 */
export function createShapeSketch(
  input: Uint8Array | string,
  detection?: DetectionResult,
): ShapeSketch {
  const bytes = bytesOf(input)
  const observed = fingerprintPayload(bytes)
  const effective = detection && equivalentDetection(detection, observed) ? detection : observed
  const format = effective.observedFormat ?? 'UNKNOWN_BINARY'
  const modelExposure =
    format === 'RESTRICTED_EDI_UNSUPPORTED' ||
    effective.status === 'REJECTED' ||
    effective.status === 'OPAQUE' ||
    effective.status === 'UNKNOWN'
      ? 'BLOCKED'
      : 'ALLOWED'
  const detectorEvidence = [
    ...effective.candidates.flatMap((item) => item.evidence.map((itemEvidence) => itemEvidence.code)),
    ...effective.issues.map((issue) => issue.code),
    ...effective.conflicts.map((conflict) => conflict.code),
  ]
  const evidence = [...new Set(detectorEvidence)].sort()
  const collector = new FeatureCollector()
  const counts: ShapeSketch['counts'] = { bytes: bytes.byteLength }

  if (modelExposure === 'ALLOWED') {
    const text = UTF8.decode(bytes).replace(/^\uFEFF/, '')
    if (format === 'FHIR_JSON' || format === 'GENERIC_JSON' || format === 'FHIR_NDJSON') {
      const records = addJsonFeatures(text, format, collector)
      counts.lines = countLines(text)
      if (records !== undefined) counts.records = records
    } else if (format === 'FHIR_XML' || format === 'CDA_XML' || format === 'GENERIC_XML') {
      counts.lines = countLines(text)
      counts.elements = addXmlFeatures(text, collector)
    } else if (format === 'HL7_V2_ER7') {
      counts.lines = countLines(text)
      counts.segments = addHl7Features(text, collector)
    }
  }

  return {
    schemaVersion: 'imonfhir.shape-sketch.v1',
    format,
    modelExposure,
    evidence,
    features: collector.list(),
    counts,
    truncated: collector.truncated,
    safety: {
      valuesRemoved: true,
      identifiersRemoved: true,
      freeTextRemoved: true,
      unknownNamesHashed: true,
    },
  }
}
