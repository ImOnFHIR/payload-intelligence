// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectPayload } from '../packages/core/src/index.js'
import {
  CONTRACT_DIGESTS_V2,
  projectInspection,
  type HostEvaluationCase,
  type HostHypothesisSubmission,
} from '../packages/contracts/src/index.js'

const port = 43_218
const baseUrl = `http://127.0.0.1:${port}`
let lab: ChildProcess
let temporaryDirectory: string
let rendezvousPath: string
let evaluationCase: HostEvaluationCase
let client: Client
let transport: StdioClientTransport
let claudeClient: Client
let claudeTransport: StdioClientTransport
const execFile = promisify(execFileCallback)

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/status`)).ok) return } catch { /* poll */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('LAB_START_TIMEOUT')
}

function submissionFor(target: HostEvaluationCase): HostHypothesisSubmission {
  const evidenceRef = target.structuralSummary.evidenceItems[0]!.ref
  return {
    schemaVersion: 'imonfhir.host-hypothesis-submission.v2',
    taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
    contractDigests: CONTRACT_DIGESTS_V2,
    caseHandle: target.caseHandle,
    caseDigest: target.caseDigest,
    hypotheses: {
      standardVersion: { value: 'FHIR_R4', evidenceRefs: [evidenceRef], conflictCodes: [] },
      businessWorkflow: { value: 'UNKNOWN_OR_OTHER', evidenceRefs: [evidenceRef], conflictCodes: ['BUSINESS_WORKFLOW_NOT_OBSERVED'] },
      exchangePattern: { value: 'RESOURCE_COLLECTION', evidenceRefs: [evidenceRef], conflictCodes: [] },
      interactionKind: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['INTERACTION_KIND_NOT_OBSERVED'] },
      sourceActorRoles: { values: ['UNKNOWN'], evidenceRefs: [evidenceRef], conflictCodes: ['SOURCE_ACTOR_ROLES_NOT_OBSERVED'] },
      destinationActorRoles: { values: ['UNKNOWN'], evidenceRefs: [evidenceRef], conflictCodes: ['DESTINATION_ACTOR_ROLES_NOT_OBSERVED'] },
      destinationClass: { value: 'LOCAL_REVIEW_ONLY', evidenceRefs: [evidenceRef], conflictCodes: [] },
    },
    missingContextQuestionCodes: [
      'CONFIRM_BUSINESS_WORKFLOW', 'CONFIRM_DESTINATION_ACTOR_ROLES',
      'CONFIRM_INTERACTION_KIND', 'CONFIRM_SOURCE_ACTOR_ROLES',
    ],
    proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
  }
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'imonfhir-mcp-test-'))
  rendezvousPath = join(temporaryDirectory, 'lab.json')
  lab = spawn(resolve('node_modules/.bin/tsx'), ['scripts/lab.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, IMONFHIR_LAB_PORT: String(port), IMONFHIR_LAB_RENDEZVOUS: rendezvousPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForReady()

  const material = projectInspection(await inspectPayload(new TextEncoder().encode(JSON.stringify({
    resourceType: 'Bundle', type: 'collection', id: 'MCP_RAW_CANARY_77421', entry: [{ resource: { resourceType: 'Patient' } }],
  }))))
  const response = await fetch(`${baseUrl}/api/cases`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(material),
  })
  evaluationCase = await response.json() as HostEvaluationCase

  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  environment.IMONFHIR_LAB_RENDEZVOUS = rendezvousPath
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp/dist/cli.js'), '--host=CODEX'],
    cwd: resolve('.'),
    env: environment,
    stderr: 'pipe',
  })
  client = new Client({ name: 'imonfhir-test-client', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  claudeTransport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp/dist/cli.js'), '--host=CLAUDE_DESKTOP'],
    cwd: resolve('.'),
    env: environment,
    stderr: 'pipe',
  })
  claudeClient = new Client({ name: 'imonfhir-claude-test-client', version: '1.0.0' }, { capabilities: {} })
  await claudeClient.connect(claudeTransport)
}, 15_000)

afterAll(async () => {
  await transport?.close()
  await claudeTransport?.close()
  lab?.kill('SIGTERM')
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('model-neutral MCP', () => {
  it('publishes only the three evaluator tools with closed roots', async () => {
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'payload_capabilities', 'payload_get_evaluation_case', 'payload_submit_hypotheses',
    ])
    for (const tool of tools.tools) expect(tool.inputSchema.additionalProperties).toBe(false)
    const submission = tools.tools.find((tool) => tool.name === 'payload_submit_hypotheses')!
    expect((submission.inputSchema.properties?.hypotheses as { additionalProperties?: boolean }).additionalProperties).toBe(false)
    const capabilities = await client.callTool({ name: 'payload_capabilities', arguments: {} })
    expect(capabilities.structuredContent).toMatchObject({
      schemaVersion: 'imonfhir.evaluator-capabilities.v2',
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
      bundledModel: false,
      syntheticOnly: true,
      probabilitiesAccepted: false,
      rawPayloadAccepted: false,
    })
    const invalidCapabilities = await client.callTool({
      name: 'payload_capabilities', arguments: { rawPayload: 'SHOULD_REJECT' },
    })
    expect(invalidCapabilities.isError).toBe(true)
    expect(invalidCapabilities.content).toEqual([{ type: 'text', text: '{"error":"INVALID_HYPOTHESES"}' }])
  })

  it('retrieves an approved summary and returns a submission to the UI', async () => {
    const fetched = await client.callTool({
      name: 'payload_get_evaluation_case', arguments: { caseHandle: evaluationCase.caseHandle },
    })
    expect(fetched.isError).not.toBe(true)
    const serialized = JSON.stringify(fetched.structuredContent)
    expect(serialized).not.toContain('MCP_RAW_CANARY_77421')

    const submission = submissionFor(evaluationCase)
    const receipt = await client.callTool({ name: 'payload_submit_hypotheses', arguments: submission })
    expect(receipt.isError).not.toBe(true)
    expect(receipt.structuredContent).toMatchObject({ hostKind: 'CODEX', state: 'PENDING_SME_REVIEW' })
    const claudeReceipt = await claudeClient.callTool({ name: 'payload_submit_hypotheses', arguments: submission })
    expect(claudeReceipt.structuredContent).toMatchObject({ hostKind: 'CLAUDE_DESKTOP', state: 'PENDING_SME_REVIEW' })

    const visible = await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}/submissions`)
    expect((await visible.json() as { submissions: unknown[] }).submissions).toHaveLength(2)
    const activity = await fetch(`${baseUrl}/api/host-activity`).then((response) => response.json()) as {
      activity: Record<string, string>
    }
    expect(activity.activity).toEqual({ CODEX: 'SUBMITTED', CLAUDE_DESKTOP: 'SUBMITTED' })
  })

  it('rejects arbitrary confidence fields', async () => {
    const result = await client.callTool({
      name: 'payload_submit_hypotheses',
      arguments: { caseHandle: evaluationCase.caseHandle, caseDigest: evaluationCase.caseDigest, confidence: 0.99 },
    }).catch((error: unknown) => error)
    expect(result).toBeTruthy()
  })

  it('fails closed for a taxonomy-v1 submission', async () => {
    const v2 = submissionFor(evaluationCase)
    const evidenceRef = evaluationCase.structuralSummary.evidenceItems[0]!.ref
    const result = await client.callTool({
      name: 'payload_submit_hypotheses',
      arguments: {
        caseHandle: v2.caseHandle,
        caseDigest: v2.caseDigest,
        hypotheses: {
          standardVersion: { value: 'FHIR_R4', evidenceRefs: [evidenceRef], conflictCodes: [] },
          workflow: { value: 'RESOURCE_EXCHANGE', evidenceRefs: [evidenceRef], conflictCodes: [] },
          direction: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['DIRECTION_NOT_OBSERVED'] },
          actorRoles: { values: ['UNKNOWN'], evidenceRefs: [evidenceRef], conflictCodes: ['ACTOR_ROLES_NOT_OBSERVED'] },
          destinationClass: { value: 'LOCAL_REVIEW_ONLY', evidenceRefs: [evidenceRef], conflictCodes: [] },
        },
        missingContextQuestionCodes: ['CONFIRM_DIRECTION'],
        proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
      },
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: '{"error":"INVALID_HYPOTHESES"}' }])
  })

  it('self-tests both fixed host modes without claiming host readiness', async () => {
    const before = await fetch(`${baseUrl}/api/host-activity`).then((response) => response.text())
    const result = await execFile(
      resolve('node_modules/.bin/tsx'),
      ['scripts/mcp-self-test.ts', 'both'],
      {
        cwd: resolve('.'),
        env: { ...process.env, IMONFHIR_LAB_RENDEZVOUS: rendezvousPath },
      },
    )
    expect(result.stdout).toContain('PASS CODEX-mode local stdio launch')
    expect(result.stdout).toContain('PASS CLAUDE_DESKTOP-mode local stdio launch')
    expect(result.stdout).toContain('LOCAL SELF-TEST ONLY')
    expect(result.stdout).toContain('does not inspect or prove Codex or Claude Desktop configuration')
    expect(await fetch(`${baseUrl}/api/host-activity`).then((response) => response.text())).toBe(before)
  })

  it('fails closed for fabricated handles, stale digests, unknown evidence, prose, and extra fields', async () => {
    const fabricated = await client.callTool({
      name: 'payload_get_evaluation_case', arguments: { caseHandle: `ec_${'f'.repeat(32)}` },
    })
    expect(fabricated.isError).toBe(true)
    expect(fabricated.content).toEqual([{ type: 'text', text: '{"error":"EXPIRED_CASE"}' }])

    const submission = submissionFor(evaluationCase)
    const stale = await client.callTool({
      name: 'payload_submit_hypotheses', arguments: { ...submission, caseDigest: 'd'.repeat(64) },
    })
    expect(stale.isError).toBe(true)
    expect(stale.content).toEqual([{ type: 'text', text: '{"error":"STALE_CASE"}' }])

    const unsupportedEvidence = await client.callTool({
      name: 'payload_submit_hypotheses',
      arguments: {
        ...submission,
        hypotheses: {
          ...submission.hypotheses,
          businessWorkflow: { ...submission.hypotheses.businessWorkflow, evidenceRefs: ['ev_0000000000000000'] },
        },
      },
    })
    expect(unsupportedEvidence.isError).toBe(true)
    expect(unsupportedEvidence.content).toEqual([{ type: 'text', text: '{"error":"INVALID_EVIDENCE_REFERENCE"}' }])

    for (const forbidden of [{ rationale: 'model prose' }, { prompt: 'hidden prompt' }, { probability: 0.5 }, { extra: true }]) {
      const invalid = await client.callTool({
        name: 'payload_submit_hypotheses', arguments: { ...submission, ...forbidden },
      })
      expect(invalid.isError).toBe(true)
    }
  })

  it('rejects submissions after the user purges the case', async () => {
    const submission = submissionFor(evaluationCase)
    expect((await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}`, { method: 'DELETE' })).ok).toBe(true)
    const result = await client.callTool({ name: 'payload_submit_hypotheses', arguments: submission })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: '{"error":"EXPIRED_CASE"}' }])
  })
})
