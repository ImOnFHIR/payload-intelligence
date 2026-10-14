// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoordinatorClient } from './client.js'
import type { Rendezvous } from './rendezvous.js'

const rendezvous: Rendezvous = {
  schemaVersion: 'imonfhir.lab-rendezvous.v1',
  baseUrl: 'http://127.0.0.1:4317',
  token: 'a'.repeat(64),
  pid: 123,
}

afterEach(() => vi.unstubAllGlobals())

describe('CoordinatorClient activity', () => {
  it('marks diagnostics as probes and ordinary host launches as non-probes', async () => {
    const requested: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input))
      return new Response(JSON.stringify({ state: 'NOT_SEEN', probeIgnored: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const resolveRendezvous = async () => rendezvous
    await new CoordinatorClient('CODEX', true, resolveRendezvous).noteActivity('CAPABILITIES_CALLED')
    await new CoordinatorClient('CLAUDE_DESKTOP', false, resolveRendezvous).noteActivity('CASE_RETRIEVED')

    expect(requested).toEqual([
      'http://127.0.0.1:4317/internal/host-activity?host=CODEX&state=CAPABILITIES_CALLED&probe=1',
      'http://127.0.0.1:4317/internal/host-activity?host=CLAUDE_DESKTOP&state=CASE_RETRIEVED&probe=0',
    ])
  })
})
