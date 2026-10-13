// SPDX-License-Identifier: Apache-2.0

import {
  SHAPE_SKETCH_ALLOWED_FEATURE_NAMES,
  SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE,
  type InspectionResult,
  type ShapeFeature,
} from '@imonfhir/payload-core'
import { canonicalDigest } from './canonical.js'
import type { ApprovedCaseMaterial, CountBand, EvidenceItem } from './types.js'

const allowedFeatureNames = new Set<string>(SHAPE_SKETCH_ALLOWED_FEATURE_NAMES)
const hashedNamePattern = new RegExp(`^(?:${SHAPE_SKETCH_HASHED_NAME_PATTERN_SOURCE})$`)

export function countBand(count: number): CountBand {
  if (count <= 0) return 'ZERO'
  if (count === 1) return 'ONE'
  if (count <= 5) return 'TWO_TO_FIVE'
  if (count <= 20) return 'SIX_TO_TWENTY'
  if (count <= 100) return 'TWENTY_ONE_TO_ONE_HUNDRED'
  return 'OVER_ONE_HUNDRED'
}

function safeFeature(feature: ShapeFeature): boolean {
  return allowedFeatureNames.has(feature.name) || hashedNamePattern.test(feature.name)
}

type EvidenceItemWithoutRef = EvidenceItem extends infer Item
  ? Item extends { ref: string }
    ? Omit<Item, 'ref'>
    : never
  : never

function withRef(item: EvidenceItemWithoutRef): EvidenceItem {
  return { ...item, ref: `ev_${canonicalDigest(item).slice(0, 16)}` } as EvidenceItem
}

export function projectInspection(inspection: InspectionResult): ApprovedCaseMaterial {
  const items: EvidenceItem[] = []
  items.push(withRef({ kind: 'FORMAT', code: inspection.sketch.format }))
  for (const code of inspection.sketch.evidence) items.push(withRef({ kind: 'DETECTOR', code }))
  items.push(withRef({ kind: 'SHAPE', code: inspection.sketch.truncated ? 'TRUNCATED' : 'COMPLETE' }))

  for (const feature of inspection.sketch.features.slice(0, 256)) {
    if (!safeFeature(feature)) continue
    const projected: Extract<EvidenceItem, { kind: 'FEATURE' }>['feature'] = {
      kind: feature.kind,
      name: feature.name,
    }
    if (feature.path !== undefined) projected.structuralPath = feature.path
    if (feature.dataType !== undefined) projected.dataType = feature.dataType
    if (feature.count !== undefined) projected.countBand = countBand(feature.count)
    items.push(withRef({ kind: 'FEATURE', feature: projected }))
  }

  const aggregates: Array<['LINES' | 'RECORDS' | 'SEGMENTS' | 'ELEMENTS', number | undefined]> = [
    ['LINES', inspection.sketch.counts.lines],
    ['RECORDS', inspection.sketch.counts.records],
    ['SEGMENTS', inspection.sketch.counts.segments],
    ['ELEMENTS', inspection.sketch.counts.elements],
  ]
  for (const [code, count] of aggregates) {
    if (count !== undefined) items.push(withRef({ kind: 'AGGREGATE', code, countBand: countBand(count) }))
  }

  const uniqueItems = [...new Map(items.map((item) => [item.ref, item])).values()]
    .sort((left, right) => left.ref.localeCompare(right.ref))

  return {
    schemaVersion: 'imonfhir.approved-case-material.v1',
    observation: {
      status: inspection.detection.status,
      ...(inspection.detection.observedFormat ? { observedFormat: inspection.detection.observedFormat } : {}),
      candidates: inspection.detection.candidates.map((candidate) => ({
        format: candidate.format,
        signature: candidate.signature,
        evidenceCodes: candidate.evidence.map((item) => item.code).sort(),
      })),
      conflictCodes: inspection.detection.conflicts.map((item) => item.code).sort(),
      issueCodes: inspection.detection.issues.map((item) => item.code).sort(),
    },
    structuralSummary: {
      schemaVersion: 'imonfhir.approved-structural-summary.v1',
      format: inspection.sketch.format,
      evidenceItems: uniqueItems,
      safety: {
        payloadValuesAbsent: true,
        identifiersAbsent: true,
        freeTextAbsent: true,
        binaryContentAbsent: true,
        unknownNamesHashed: true,
        exactCountsAbsent: true,
      },
    },
  }
}
