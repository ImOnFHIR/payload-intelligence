// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCallback } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeDesktopConfig, validateClaudeDesktopConfig } from '../scripts/mcp-config-shared.js'

const execFile = promisify(execFileCallback)
let temporaryDirectory: string

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'imonfhir-onboarding-test-'))
})

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('MCP onboarding scripts', () => {
  it('validates the generated Claude server entry without changing the file', async () => {
    const configPath = join(temporaryDirectory, 'claude_desktop_config.json')
    const source = `${JSON.stringify(claudeDesktopConfig(), null, 2)}\n`
    await writeFile(configPath, source, { mode: 0o600 })
    await chmod(configPath, 0o600)
    const modeBefore = (await stat(configPath)).mode & 0o777

    const result = await execFile(
      resolve('node_modules/.bin/tsx'),
      ['scripts/check-mcp-config.ts', 'claude'],
      { cwd: resolve('.'), env: { ...process.env, IMONFHIR_CLAUDE_CONFIG: configPath } },
    )

    expect(result.stdout).toContain('READ-ONLY CONFIG CHECK')
    expect(await readFile(configPath, 'utf8')).toBe(source)
    expect((await stat(configPath)).mode & 0o777).toBe(modeBefore)
  })

  it('rejects a Claude entry that points at a different command or host mode', () => {
    expect(validateClaudeDesktopConfig({
      mcpServers: {
        imonfhir_payload: {
          command: '/different/node',
          args: ['/different/server.js', '--host=CODEX'],
        },
      },
    })).toEqual(['COMMAND_MISMATCH', 'ARGS_MISMATCH'])
  })

  it('prints Claude configuration without creating or changing host files', async () => {
    const home = join(temporaryDirectory, 'empty-home')
    await mkdir(home, { mode: 0o700 })

    const result = await execFile(
      resolve('node_modules/.bin/tsx'),
      ['scripts/print-mcp-config.ts', 'claude'],
      { cwd: resolve('.'), env: { ...process.env, HOME: home } },
    )

    expect(result.stdout).toContain('"--host=CLAUDE_DESKTOP"')
    expect(result.stdout).toContain('Neither check proves Claude Desktop loaded the server')
    expect(await readdir(home)).toEqual([])
  })
})
