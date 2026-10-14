// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type McpHostMode = 'CODEX' | 'CLAUDE_DESKTOP'

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const mcpEntry = resolve(repositoryRoot, 'packages/mcp/dist/cli.js')

export interface LocalMcpServerConfig {
  command: string
  args: [string, `--host=${McpHostMode}`] | [string, `--host=${McpHostMode}`, '--probe']
}

export function localMcpServerConfig(
  host: McpHostMode,
  nodePath = process.execPath,
  options: { probe?: boolean } = {},
): LocalMcpServerConfig {
  return {
    command: nodePath,
    args: options.probe
      ? [mcpEntry, `--host=${host}`, '--probe']
      : [mcpEntry, `--host=${host}`],
  }
}

export function claudeDesktopConfig(nodePath = process.execPath): Record<string, unknown> {
  return {
    mcpServers: {
      imonfhir_payload: localMcpServerConfig('CLAUDE_DESKTOP', nodePath),
    },
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function validateClaudeDesktopConfig(value: unknown, nodePath = process.execPath): string[] {
  const root = objectValue(value)
  const servers = objectValue(root?.mcpServers)
  const server = objectValue(servers?.imonfhir_payload)
  if (!server) return ['MISSING_IMONFHIR_SERVER']

  const expected = localMcpServerConfig('CLAUDE_DESKTOP', nodePath)
  const failures: string[] = []
  if (server.command !== expected.command) failures.push('COMMAND_MISMATCH')
  if (
    !Array.isArray(server.args) ||
    server.args.length !== expected.args.length ||
    server.args.some((argument, index) => argument !== expected.args[index])
  ) failures.push('ARGS_MISMATCH')
  return failures
}

export function validateCodexConfig(value: unknown, nodePath = process.execPath): string[] {
  const root = objectValue(value)
  const transport = objectValue(root?.transport)
  const server = transport ?? objectValue(root?.server) ?? root
  if (!server) return ['MISSING_IMONFHIR_SERVER']

  const expected = localMcpServerConfig('CODEX', nodePath)
  const failures: string[] = []
  if (root?.enabled === false) failures.push('SERVER_DISABLED')
  if (transport?.type !== undefined && transport.type !== 'stdio') failures.push('TRANSPORT_MISMATCH')
  if (server.command !== expected.command) failures.push('COMMAND_MISMATCH')
  if (
    !Array.isArray(server.args) ||
    server.args.length !== expected.args.length ||
    server.args.some((argument, index) => argument !== expected.args[index])
  ) failures.push('ARGS_MISMATCH')

  const configuredCwd = typeof root?.cwd === 'string'
    ? root.cwd
    : typeof server.cwd === 'string' ? server.cwd : undefined
  if (configuredCwd !== repositoryRoot) failures.push('CWD_MISMATCH')
  return failures
}
