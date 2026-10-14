// SPDX-License-Identifier: Apache-2.0

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const port = 43_220
const baseUrl = `http://127.0.0.1:${port}`
let lab: ChildProcess
let temporaryDirectory: string
let rendezvousPath: string
let token: string

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/status`)).ok) return } catch { /* poll */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('LAB_START_TIMEOUT')
}

async function activity(): Promise<Record<'CODEX' | 'CLAUDE_DESKTOP', string>> {
  const response = await fetch(`${baseUrl}/api/host-activity`)
  expect(response.ok).toBe(true)
  const body = await response.json() as {
    schemaVersion: string
    activity: Record<'CODEX' | 'CLAUDE_DESKTOP', string>
  }
  expect(body.schemaVersion).toBe('imonfhir.host-activity.v1')
  return body.activity
}

async function advance(host: 'CODEX' | 'CLAUDE_DESKTOP', state: string, probe: '0' | '1') {
  return fetch(`${baseUrl}/internal/host-activity?host=${host}&state=${state}&probe=${probe}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'imonfhir-activity-test-'))
  rendezvousPath = join(temporaryDirectory, 'lab.json')
  lab = spawn(resolve('node_modules/.bin/tsx'), ['scripts/lab.ts'], {
    cwd: resolve('.'),
    env: { ...process.env, IMONFHIR_LAB_PORT: String(port), IMONFHIR_LAB_RENDEZVOUS: rendezvousPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForReady()
  token = (JSON.parse(await readFile(rendezvousPath, 'utf8')) as { token: string }).token
}, 15_000)

afterAll(async () => {
  lab?.kill('SIGTERM')
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('ephemeral host-mode activity', () => {
  it('starts unseen and ignores authenticated probe traffic', async () => {
    expect(await activity()).toEqual({ CODEX: 'NOT_SEEN', CLAUDE_DESKTOP: 'NOT_SEEN' })
    const response = await advance('CODEX', 'SUBMITTED', '1')
    expect(response.ok).toBe(true)
    expect(await response.json()).toMatchObject({ state: 'NOT_SEEN', probeIgnored: true })
    expect(await activity()).toEqual({ CODEX: 'NOT_SEEN', CLAUDE_DESKTOP: 'NOT_SEEN' })
  })

  it('advances monotonically and does not imply authenticated identity', async () => {
    expect((await advance('CODEX', 'CAPABILITIES_CALLED', '0')).ok).toBe(true)
    expect((await advance('CODEX', 'SUBMITTED', '0')).ok).toBe(true)
    expect((await advance('CODEX', 'CASE_RETRIEVED', '0')).ok).toBe(true)
    expect((await advance('CLAUDE_DESKTOP', 'CASE_RETRIEVED', '0')).ok).toBe(true)
    expect(await activity()).toEqual({ CODEX: 'SUBMITTED', CLAUDE_DESKTOP: 'CASE_RETRIEVED' })
  })

  it('fails closed for unauthenticated or unknown activity values', async () => {
    const unauthenticated = await fetch(
      `${baseUrl}/internal/host-activity?host=CODEX&state=SUBMITTED&probe=0`,
      { method: 'POST' },
    )
    expect(unauthenticated.status).toBe(401)
    expect(await unauthenticated.json()).toEqual({ error: 'STORE_UNAVAILABLE' })
    expect((await advance('CODEX', 'AUTHENTICATED', '0')).status).toBe(400)
  })
})
