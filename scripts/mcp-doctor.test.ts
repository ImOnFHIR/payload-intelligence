// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Rendezvous } from '../packages/mcp/src/rendezvous.js'
import { claudeDesktopConfig, localMcpServerConfig, repositoryRoot, validateCodexConfig } from './mcp-config-shared.js'
import {
  EXPECTED_MCP_TOOLS,
  doctorPassed,
  formatDoctorReport,
  runDoctor,
  type DoctorDependencies,
} from './mcp-doctor-lib.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function dependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  const rendezvous: Rendezvous = {
    schemaVersion: 'imonfhir.lab-rendezvous.v1',
    baseUrl: 'http://127.0.0.1:4317',
    token: 'a'.repeat(64),
    pid: 123,
  }
  return {
    nodeVersion: 'v22.22.3',
    ensureReadable: async () => undefined,
    readText: async () => JSON.stringify(claudeDesktopConfig()),
    readLabRendezvous: async () => rendezvous,
    execFile: async () => ({
      stdout: JSON.stringify({
        command: process.execPath,
        args: localMcpServerConfig('CODEX').args,
        cwd: repositoryRoot,
      }),
      stderr: '',
    }),
    launchProbe: async () => ({ launched: true, tools: [...EXPECTED_MCP_TOOLS], capabilitiesReturned: true }),
    fetchJson: async (url) => url.endsWith('/api/status')
      ? { ready: true }
      : {
          schemaVersion: 'imonfhir.host-activity.v1',
          activity: { CODEX: 'NOT_SEEN', CLAUDE_DESKTOP: 'SUBMITTED' },
        },
    codexCommand: 'codex',
    claudeConfigPath: '/unused/claude.json',
    ...overrides,
  }
}

describe('MCP doctor', () => {
  it('keeps configuration, local probe, and activity as separate honest observations', async () => {
    const report = await runDoctor('both', dependencies())
    expect(doctorPassed(report)).toBe(true)
    expect(report.hosts.map((host) => host.activity)).toEqual(['NOT_SEEN', 'SUBMITTED'])
    const output = formatDoctorReport(report)
    expect(output).toContain('Codex-mode MCP activity seen: NOT_SEEN')
    expect(output).toContain('Claude-mode MCP activity seen: SUBMITTED')
    expect(output).toContain('not authenticated identity; probe calls excluded')
    expect(output).toContain('Saved configuration match, local launch, and MCP activity are separate observations')
    expect(output).toContain('none alone proves host activation or provider connectivity')
  })

  it('reports missing and stale host configuration without attempting a write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'imonfhir-doctor-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'claude.json')
    const stale = JSON.stringify({ mcpServers: { imonfhir_payload: { command: '/stale/node', args: [] } } })
    await writeFile(path, stale, { mode: 0o600 })
    const report = await runDoctor('claude', dependencies({
      claudeConfigPath: path,
      readText: (target) => readFile(target, 'utf8'),
    }))
    expect(report.hosts[0]?.configuration).toEqual({ state: 'FAIL', code: 'COMMAND_MISMATCH+ARGS_MISMATCH' })
    expect(await readFile(path, 'utf8')).toBe(stale)

    const missing = await runDoctor('claude', dependencies({
      claudeConfigPath: join(directory, 'missing.json'),
      readText: (target) => readFile(target, 'utf8'),
    }))
    expect(missing.hosts[0]?.configuration).toEqual({ state: 'FAIL', code: 'CONFIGURATION_MISSING' })
  })

  it('fails local launch and contract separately', async () => {
    const report = await runDoctor('codex', dependencies({
      launchProbe: async () => { throw new Error('launcher failed') },
    }))
    expect(report.hosts[0]?.localLaunch.code).toBe('PROBE_LAUNCH_FAILED')
    expect(report.hosts[0]?.toolContract.code).toBe('TOOL_CONTRACT_UNVERIFIED')
    expect(doctorPassed(report)).toBe(false)
  })

  it('rejects an unpinned Node 22 minor', async () => {
    const report = await runDoctor('codex', dependencies({ nodeVersion: 'v22.20.0' }))
    expect(report.node).toEqual({ state: 'FAIL', code: 'NODE_22_22_3_REQUIRED' })
    expect(doctorPassed(report)).toBe(false)
  })

  it('reports missing Codex configuration and an unavailable CLI without inference', async () => {
    const missingError = Object.assign(new Error('No MCP server named imonfhir_payload found.'), {
      stderr: 'Error: No MCP server named imonfhir_payload found.',
    })
    const missing = await runDoctor('codex', dependencies({
      execFile: async () => { throw missingError },
    }))
    expect(missing.hosts[0]?.configuration).toEqual({
      state: 'FAIL', code: 'CONFIGURATION_MISSING_OR_INVALID',
    })

    const unavailable = await runDoctor('codex', dependencies({
      execFile: async () => { throw Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }) },
    }))
    expect(unavailable.hosts[0]?.configuration).toEqual({
      state: 'UNAVAILABLE', code: 'CODEX_CLI_UNAVAILABLE',
    })
  })

  it('recognizes nested Codex transport and rejects stale paths or probe arguments', () => {
    const expected = localMcpServerConfig('CODEX')
    expect(validateCodexConfig({
      transport: { command: expected.command, args: expected.args },
      cwd: repositoryRoot,
    })).toEqual([])
    expect(validateCodexConfig({
      transport: { command: expected.command, args: [...expected.args, '--probe'] },
      cwd: '/stale/checkout',
    })).toEqual(['ARGS_MISMATCH', 'CWD_MISMATCH'])
    expect(validateCodexConfig({
      enabled: false,
      transport: { type: 'http', command: expected.command, args: expected.args },
      cwd: repositoryRoot,
    })).toEqual(['SERVER_DISABLED', 'TRANSPORT_MISMATCH'])
  })
})
