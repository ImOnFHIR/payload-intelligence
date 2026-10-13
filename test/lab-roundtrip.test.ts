// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { inspectPayload } from '../packages/core/src/index.js'
import { projectInspection, type HostEvaluationCase, type HostHypothesisSubmission } from '../packages/contracts/src/index.js'

const port = 43_217
const baseUrl = `http://127.0.0.1:${port}`
let processHandle: ChildProcess
let temporaryDirectory: string
let rendezvousPath: string
let token: string

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
  processHandle = spawn(resolve('node_modules/.bin/tsx'), ['scripts/lab.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, IMONFHIR_LAB_PORT: String(port), IMONFHIR_LAB_RENDEZVOUS: rendezvousPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
      caseHandle: evaluationCase.caseHandle,
      caseDigest: evaluationCase.caseDigest,
      hypotheses: {
        standardVersion: { value: 'UNDETERMINED', evidenceRefs: [evidenceRef], conflictCodes: ['STANDARD_VERSION_NOT_OBSERVED'] },
        workflow: { value: 'UNKNOWN_OR_OTHER', evidenceRefs: [evidenceRef], conflictCodes: ['INSUFFICIENT_STRUCTURAL_EVIDENCE'] },
        direction: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['DIRECTION_NOT_OBSERVED'] },
        actorRoles: { values: ['UNKNOWN'], evidenceRefs: [evidenceRef], conflictCodes: ['ACTOR_ROLES_NOT_OBSERVED'] },
        destinationClass: { value: 'UNKNOWN', evidenceRefs: [evidenceRef], conflictCodes: ['DESTINATION_NOT_OBSERVED'] },
      },
      missingContextQuestionCodes: ['CONFIRM_STANDARD_VERSION', 'CONFIRM_WORKFLOW', 'CONFIRM_DIRECTION', 'CONFIRM_ACTOR_ROLES', 'CONFIRM_DESTINATION_CLASS'],
      proposedNextActionCodes: ['ASK_TARGETED_CONTEXT'],
    }
    const submit = () => fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}/submissions?host=CODEX`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(submission),
    })
    const stale = await fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}/submissions?host=CODEX`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...submission, caseDigest: 'c'.repeat(64) }),
    })
    expect(stale.status).toBe(400)
    expect(await stale.json()).toEqual({ error: 'STALE_CASE' })
    const staleVisible = await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}/submissions`)
    expect(await staleVisible.json()).toMatchObject({ state: 'STALE', submissions: [] })
    const first = await submit()
    expect(first.status).toBe(201)
    const second = await submit()
    expect(second.status).toBe(200)
    expect((await second.json() as { deduplicated: boolean }).deduplicated).toBe(true)

    const visible = await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}/submissions`)
    const visibleText = await visible.text()
    expect(visibleText).not.toContain(canary)
    expect(JSON.parse(visibleText)).toMatchObject({ state: 'RECEIVED' })
    expect(JSON.parse(visibleText).submissions).toHaveLength(1)

    expect((await fetch(`${baseUrl}/api/cases/${evaluationCase.caseHandle}`, { method: 'DELETE' })).ok).toBe(true)
    const afterPurge = await fetch(`${baseUrl}/internal/cases/${evaluationCase.caseHandle}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(afterPurge.status).toBe(400)
    expect(await afterPurge.json()).toEqual({ error: 'EXPIRED_CASE' })
  })
})
