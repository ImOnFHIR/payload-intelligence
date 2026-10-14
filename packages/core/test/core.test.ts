// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_WORKFLOWS,
  DIRECTIONS_V1,
  EVALUATION_TAXONOMY,
  EVALUATION_TAXONOMY_V1,
  EXCHANGE_PATTERNS,
  inspectPayload,
  INTERACTION_KINDS,
} from '../src/index.js'
import { createShapeSketch } from '../src/shape-sketch.js'
import { fingerprintPayload, MAX_PAYLOAD_BYTES } from '../src/detection.js'

const examples = resolve(import.meta.dirname, '../../../examples/synthetic')

describe('versioned evaluation taxonomy', () => {
  it('separates business workflow, exchange pattern, and interaction kind in v2', () => {
    expect(EVALUATION_TAXONOMY.version).toBe('imonfhir.evaluation-taxonomy.v2')
    expect(BUSINESS_WORKFLOWS).toContain('CARE_COORDINATION')
    expect(EXCHANGE_PATTERNS).toContain('RESOURCE_STREAM')
    expect(INTERACTION_KINDS).toEqual(['REQUEST', 'RESPONSE', 'EVENT', 'UNKNOWN', 'NOT_APPLICABLE'])
  })

  it('retains the ambiguous v1 vocabulary only as an explicit legacy taxonomy', () => {
    expect(EVALUATION_TAXONOMY_V1.version).toBe('imonfhir.evaluation-taxonomy.v1')
    expect(DIRECTIONS_V1).toContain('SENDER_TO_RECEIVER')
    expect(EVALUATION_TAXONOMY).not.toHaveProperty('directions')
  })
})

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(resolve(examples, name)))
}

describe('deterministic recognition', () => {
  it.each([
    ['fhir-claim.json', 'FHIR_JSON'],
    ['fhir-bundle.xml', 'FHIR_XML'],
    ['fhir.ndjson', 'FHIR_NDJSON'],
    ['hl7-v2.er7', 'HL7_V2_ER7'],
    ['cda.xml', 'CDA_XML'],
    ['ambiguous.json', 'GENERIC_JSON'],
  ])('recognizes %s as %s', async (name, format) => {
    const detection = fingerprintPayload(await fixture(name))
    expect(detection.observedFormat).toBe(format)
    expect(detection.status).toBe('DETECTED')
    expect(detection.automaticRoutingEligible).toBe(false)
  })

  it('blocks standard-neutral EDI-shaped input without interpreting it', () => {
    const detection = fingerprintPayload('AAA*1*2~BBB*3*4~CCC*5*6~')
    expect(detection.observedFormat).toBe('RESTRICTED_EDI_UNSUPPORTED')
    expect(createShapeSketch('AAA*1*2~BBB*3*4~CCC*5*6~', detection).modelExposure).toBe('BLOCKED')
  })

  it('rejects prohibited XML declarations and excessive input', () => {
    const xml = fingerprintPayload('<!DOCTYPE root [<!ENTITY x SYSTEM "https://example.invalid/x">]><root>&x;</root>')
    expect(xml.status).toBe('REJECTED')
    expect(xml.issues.map((issue) => issue.code)).toContain('XML_DOCTYPE_PROHIBITED')
    const oversized = fingerprintPayload(new Uint8Array(MAX_PAYLOAD_BYTES + 1))
    expect(oversized.status).toBe('REJECTED')
    expect(oversized.issues[0]?.code).toBe('PAYLOAD_SIZE_LIMIT_EXCEEDED')
  })
})

describe('value-minimized shape sketch', () => {
  it('retains allowlisted standard markers but removes payload values', () => {
    const canary = 'VERY_SECRET_CANARY_991827'
    const input = JSON.stringify({
      resourceType: 'Claim',
      status: 'active',
      use: 'preauthorization',
      id: canary,
      narrative: canary,
      totallyUnknownSecretField: canary,
    })
    const sketch = createShapeSketch(input)
    const serialized = JSON.stringify(sketch)
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('totallyUnknownSecretField')
    expect(sketch.features.map((feature) => feature.name)).toContain('FHIR_RESOURCE_CLAIM')
    expect(sketch.features.map((feature) => feature.name)).toContain('FHIR_USE_PREAUTHORIZATION')
    expect(serialized).toMatch(/key_[a-f0-9]{12}/)
  })

  it('does not expose OBX or NTE values and emits bounded MSH markers', () => {
    const canary = 'DO_NOT_EXPOSE_THIS_RESULT'
    const message = `MSH|^~\\&|S|F|R|F|20260101000000||ORU^R01|1|P|2.5.1\rOBX|1|ST|CODE||${canary}\rNTE|1||${canary}`
    const sketch = createShapeSketch(message)
    const serialized = JSON.stringify(sketch)
    expect(serialized).not.toContain(canary)
    expect(sketch.features.map((feature) => feature.name)).toEqual(expect.arrayContaining([
      'HL7_MESSAGE_ORU', 'HL7_TRIGGER_R01', 'HL7_VERSION_2_5_1',
    ]))
  })

  it('removes XML comments, CDATA, attributes, names, filenames, and declared metadata', async () => {
    const valueCanary = 'XML_VALUE_CANARY_41729'
    const nameCanary = 'secretCanaryElement'
    const metadataCanary = 'METADATA_CANARY_88214'
    const repetitiveComment = '<'.repeat(100_000)
    const xml = `<?probe ${valueCanary}?><ClinicalDocument xmlns="urn:hl7-org:v3" ${nameCanary}="${valueCanary}"><!--${repetitiveComment}${valueCanary}--><component><${nameCanary}><![CDATA[${valueCanary}]]></${nameCanary}></component></ClinicalDocument>`
    const inspection = await inspectPayload(new TextEncoder().encode(xml), {
      fileName: `${metadataCanary}.xml`,
      contentType: `application/xml; profile=${metadataCanary}`,
    })
    const serialized = JSON.stringify(inspection.sketch)
    expect(serialized).not.toContain(valueCanary)
    expect(serialized).not.toContain(nameCanary)
    expect(serialized).not.toContain(metadataCanary)
    expect(serialized).not.toContain('probe')
    expect(serialized).toMatch(/element_[a-f0-9]{12}/)
  })

  it('fails closed without echoing malformed payload content', async () => {
    const canary = 'MALFORMED_CANARY_55190'
    const inspection = await inspectPayload(new TextEncoder().encode(`{"resourceType":"Patient","note":"${canary}"`), {
      fileName: `${canary}.json`,
      contentType: `application/json; canary=${canary}`,
    })
    expect(JSON.stringify(inspection)).not.toContain(canary)
    expect(inspection.detection.automaticRoutingEligible).toBe(false)
  })
})
