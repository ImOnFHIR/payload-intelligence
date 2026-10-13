// SPDX-License-Identifier: Apache-2.0

export * from './types.js'
export * from './detection.js'
export * from './shape-sketch.js'
export * from './taxonomy.js'

import { fingerprintPayload } from './detection.js'
import { createShapeSketch } from './shape-sketch.js'
import type { DeclaredPayloadContext, DetectionResult, ShapeSketch } from './types.js'

export interface InspectionResult {
  schemaVersion: 'imonfhir.browser-inspection.v1'
  detection: DetectionResult
  sketch: ShapeSketch
}

export async function inspectPayload(
  bytes: Uint8Array,
  context: DeclaredPayloadContext = {},
): Promise<InspectionResult> {
  const detection = fingerprintPayload(bytes, context)
  const sketch = createShapeSketch(bytes, detection)
  return { schemaVersion: 'imonfhir.browser-inspection.v1', detection, sketch }
}
