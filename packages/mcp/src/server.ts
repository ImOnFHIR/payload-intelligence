// SPDX-License-Identifier: Apache-2.0

import {
  canonicalJson,
  hostHypothesisSubmissionSchema,
  parseHostHypothesisSubmission,
  type EvaluatorCapabilities,
  type HostKind,
} from '@imonfhir/payload-contracts'
import {
  MAX_HL7_SEGMENTS,
  MAX_JSON_DEPTH,
  MAX_NDJSON_LINE_BYTES,
  MAX_NDJSON_LINES,
  MAX_PAYLOAD_BYTES,
  PAYLOAD_FORMATS,
  TAXONOMY_VERSION,
} from '@imonfhir/payload-core'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { CoordinatorClient } from './client.js'

const capabilities: EvaluatorCapabilities = {
  schemaVersion: 'imonfhir.evaluator-capabilities.v1',
  mode: 'HOST_ASSISTED_SME_EVALUATION',
  bundledModel: false,
  supportedHosts: ['CODEX', 'CLAUDE_DESKTOP'],
  caseCreation: 'UI_ONLY_EXPLICIT_APPROVAL',
  hostReceives: 'APPROVED_STRUCTURAL_SUMMARY_ONLY',
  probabilitiesAccepted: false,
  freeTextAccepted: false,
  rawPayloadAccepted: false,
  syntheticOnly: true,
  taxonomyVersion: TAXONOMY_VERSION,
  recognizedFormats: [...PAYLOAD_FORMATS],
  hostEligibleFormats: [
    'FHIR_JSON', 'FHIR_XML', 'FHIR_NDJSON', 'HL7_V2_ER7', 'CDA_XML',
    'GENERIC_JSON', 'GENERIC_XML', 'DELIMITED_TEXT', 'UNKNOWN_TEXT',
  ],
  hostBlockedFormats: [
    'RESTRICTED_EDI_UNSUPPORTED', 'PDF', 'DICOM', 'ARCHIVE', 'UNKNOWN_BINARY',
  ],
  limits: {
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
    maxJsonDepth: MAX_JSON_DEPTH,
    maxNdjsonLines: MAX_NDJSON_LINES,
    maxNdjsonLineBytes: MAX_NDJSON_LINE_BYTES,
    maxHl7Segments: MAX_HL7_SEGMENTS,
    maxEvidenceItems: 300,
    caseTtlSeconds: 14_400,
  },
  limitations: [
    'SYNTHETIC_DATA_ONLY',
    'NOT_A_VALIDATOR',
    'NOT_CALIBRATED',
    'NO_CLINICAL_OR_PAYER_DECISIONS',
    'HOST_PROVIDER_MAY_RECEIVE_APPROVED_SUMMARY',
  ],
}

const handleSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['caseHandle'],
  properties: { caseHandle: { type: 'string', pattern: '^ec_[a-f0-9]{32}$' } },
} as const

const submissionSchema = z.toJSONSchema(hostHypothesisSubmissionSchema, { target: 'draft-7' })

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: canonicalJson(value) }], structuredContent: value as Record<string, unknown> }
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : 'STORE_UNAVAILABLE'
  const allowed = new Set([
    'EXPIRED_CASE', 'EVALUATION_BLOCKED', 'STALE_CASE', 'INVALID_HYPOTHESES',
    'INVALID_EVIDENCE_REFERENCE', 'SUBMISSION_LIMIT_REACHED', 'STORE_UNAVAILABLE',
  ])
  return {
    isError: true,
    content: [{ type: 'text' as const, text: canonicalJson({ error: allowed.has(code) ? code : 'STORE_UNAVAILABLE' }) }],
  }
}

export async function runMcpServer(hostKind: HostKind): Promise<void> {
  const client = new CoordinatorClient(hostKind)
  const server = new Server(
    { name: 'imonfhir-payload-mcp', version: '0.1.0-preview.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    {
      name: 'payload_capabilities',
      description: 'Report the bounded evaluator capabilities and non-claims.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      name: 'payload_get_evaluation_case',
      description: 'Read one user-approved, value-minimized structural evaluation case.',
      inputSchema: handleSchema,
    },
    {
      name: 'payload_submit_hypotheses',
      description: 'Submit closed-code hypotheses for SME review. Free text and confidence are prohibited.',
      inputSchema: submissionSchema,
    },
  ] }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (request.params.name === 'payload_capabilities') return result(capabilities)
      if (request.params.name === 'payload_get_evaluation_case') {
        const args = request.params.arguments as Record<string, unknown> | undefined
        if (!args || Object.keys(args).length !== 1 || typeof args.caseHandle !== 'string' || !/^ec_[a-f0-9]{32}$/.test(args.caseHandle)) {
          throw new Error('EXPIRED_CASE')
        }
        return result(await client.getCase(args.caseHandle))
      }
      if (request.params.name === 'payload_submit_hypotheses') {
        const parsed = parseHostHypothesisSubmission(request.params.arguments)
        return result(await client.submit(parsed))
      }
      throw new Error('STORE_UNAVAILABLE')
    } catch (error) {
      return failure(error)
    }
  })

  await server.connect(new StdioServerTransport())
}
