// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectPayload } from '../packages/core/src/index.js'
import {
  CONTRACT_DIGESTS_V2,
  projectInspection,
  type HostEvaluationCase,
  type HostHypothesisSubmission,
} from '../packages/contracts/src/index.js'
import { CoordinatorClient } from '../packages/mcp/src/client.js'
import { readRendezvous } from '../packages/mcp/src/rendezvous.js'

const port = 43_217
const baseUrl = `http://127.0.0.1:${port}`
let processHandle: ChildProcess
let temporaryDirectory: string
let rendezvousPath: string
let token: string

function spawnLab(): ChildProcess {
  return spawn(resolve('node_modules/.bin/tsx'), ['scripts/lab.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, IMONFHIR_LAB_PORT: String(port), IMONFHIR_LAB_RENDEZVOUS: rendezvousPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`)
      if (response.ok) return
    } catch { /* keep polling */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('LAB_START_TIMEOUT')
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'imonfhir-lab-test-'))
  rendezvousPath = join(temporaryDirectory, 'lab.json')
  processHandle = spawnLab()
  await waitForReady()
  const rendezvous = JSON.parse(await readFile(rendezvousPath, 'utf8')) as { token: string }
  token = rendezvous.token
}, 15_000)

afterAll(async () => {
  processHandle?.kill('SIGTERM')
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('local UI/MCP coordinator roundtrip', () => {
  it('uses a private rendezvous and never persists raw payload material', async () => {
    expect((await stat(rendezvousPath)).mode & 0o077).toBe(0)
    const canary = 'RAW_CANARY_MUST_NOT_CROSS_98234'
    const rejectedRaw = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resourceType: 'Claim', patient: canary }),
    })
    expect(rejectedRaw.status).toBe(400)
    const rejectedRawBody = await rejectedRaw.text()
    expect(rejectedRawBody).toBe('{"error":"STORE_UNAVAILABLE"}')
    expect(rejectedRawBody).not.toContain(canary)

    const inspection = await inspectPayload(new TextEncoder().encode(JSON.stringify({
      resourceType: 'Claim', use: 'preauthorization', patient: canary,
    })))
    const material = projectInspection(inspection)
    expect(JSON.stringify(material)).not.toContain(canary)

    const createdResponse = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(material),
    })
    expect(createdResponse.status).toBe(201)
    const evaluationCase = await createdResponse.json() as HostEvaluationCase
    const internalResponse = await fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(internalResponse.status).toBe(200)
    expect(await internalResponse.text()).not.toContain(canary)

    const evidenceRef = evaluationCase.structuralSummary.evidenceItems[0]!.ref
    const submission: HostHypothesisSubmission = {
      schemaVersion: 'imonfhir.host-hypothesis-submission.v2',
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
      contractDigests: CONTRACT_DIGESTS_V2,
      caseHandle: evaluationCase.caseHandle,
      caseDigest: evaluationCase.caseDigest,
      hypotheses: {
        standardVersion: { value: 'UNDETERMINED', evidenceRefs: [evidenceRef], conflictCodes: ['STANDARD_VERSION_NOT_OBSERVED'] },
        businessWorkflow: { value: 'UNKNOWN_OR_OTHER', evidenceRefs: [evidenceRef], conflictCodes: ['BUSINESS_WORKFLOW_NOT_OBSERVED'] },
        exchangePattern: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['EXCHANGE_PATTERN_NOT_OBSERVED'] },
        interactionKind: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['INTERACTION_KIND_NOT_OBSERVED'] },
        sourceActorRoles: { values: ['UNKNOWN'], evidenceRefs: [evidenceRef], conflictCodes: ['SOURCE_ACTOR_ROLES_NOT_OBSERVED'] },
        destinationActorRoles: { values: ['UNKNOWN'], evidenceRefs: [evidenceRef], conflictCodes: ['DESTINATION_ACTOR_ROLES_NOT_OBSERVED'] },
        destinationClass: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['DESTINATION_CLASS_NOT_OBSERVED'] },
      },
      missingContextQuestionCodes: [
        'CONFIRM_BUSINESS_WORKFLOW', 'CONFIRM_DESTINATION_ACTOR_ROLES',
        'CONFIRM_DESTINATION_CLASS', 'CONFIRM_EXCHANGE_PATTERN',
        'CONFIRM_INTERACTION_KIND', 'CONFIRM_SOURCE_ACTOR_ROLES',
        'CONFIRM_STANDARD_VERSION',
      ],
      proposedNextActionCodes: ['ASK_TARGETED_CONTEXT'],
    }
    const submit = (probe: '0' | '1') => fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}/submissions?host=CODEX&probe=${probe}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(submission),
    })
    const stale = await fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}/submissions?host=CODEX&probe=0`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...submission, caseDigest: 'c'.repeat(64) }),
    })
    expect(stale.status).toBe(400)
    expect(await stale.json()).toEqual({ error: 'STALE_CASE' })
    const staleVisible = await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}/submissions`)
    expect(await staleVisible.json()).toMatchObject({ state: 'STALE', submissions: [] })
    const probeFirst = await submit('1')
    expect(probeFirst.status).toBe(201)
    const probeVisible = await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}/submissions`)
    expect((await probeVisible.json() as { submissions: Array<{ probe: boolean }> }).submissions[0]?.probe).toBe(true)

    const first = await submit('0')
    expect(first.status).toBe(200)
    expect((await first.json() as { deduplicated: boolean }).deduplicated).toBe(true)
    const second = await submit('0')
    expect(second.status).toBe(200)
    expect((await second.json() as { deduplicated: boolean }).deduplicated).toBe(true)

    const visible = await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}/submissions`)
    const visibleText = await visible.text()
    expect(visibleText).not.toContain(canary)
    expect(JSON.parse(visibleText)).toMatchObject({ state: 'RECEIVED' })
    expect(JSON.parse(visibleText).submissions).toHaveLength(1)
    expect(JSON.parse(visibleText).submissions[0].probe).toBe(false)

    expect((await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}`, { method: 'DELETE' })).ok).toBe(true)
    const afterPurge = await fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(afterPurge.status).toBe(400)
    expect(await afterPurge.json()).toEqual({ error: 'EXPIRED_CASE' })
  })
})

describe('a second lab launch on a busy port', () => {
  it('exits without deleting or replacing the running lab\'s rendezvous', async () => {
    const before = await readRendezvous(rendezvousPath)
    const second = spawnLab()
    try {
      const exitCode = await new Promise<number | null | 'TIMEOUT'>((resolvePromise) => {
        const timer = setTimeout(() => resolvePromise('TIMEOUT'), 20_000)
        second.once('exit', (code) => {
          clearTimeout(timer)
          resolvePromise(code)
        })
      })
      expect(exitCode).not.toBe('TIMEOUT')
      expect(exitCode).not.toBe(0)
    } finally {
      second.kill('SIGKILL')
    }

    expect(await readRendezvous(rendezvousPath)).toEqual(before)

    const inspection = await inspectPayload(new TextEncoder().encode(JSON.stringify({ resourceType: 'Claim', use: 'claim' })))
    const created = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(projectInspection(inspection)),
    })
    expect(created.status).toBe(201)
    const { caseHandle } = await created.json() as HostEvaluationCase
    const client = new CoordinatorClient('CODEX', false, () => readRendezvous(rendezvousPath))
    expect((await client.getCase(caseHandle)).caseHandle).toBe(caseHandle)
  }, 30_000)
})
