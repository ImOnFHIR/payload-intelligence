// SPDX-License-Identifier: Apache-2.0

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readRendezvous } from '../packages/mcp/src/rendezvous.js'
import { localMcpServerConfig, repositoryRoot, type McpHostMode } from './mcp-config-shared.js'

const expectedTools = [
  'payload_capabilities',
  'payload_get_evaluation_case',
  'payload_submit_hypotheses',
]

const requestedMode = (process.argv[2] ?? 'both').toLowerCase()
const modes: McpHostMode[] = requestedMode === 'both'
  ? ['CODEX', 'CLAUDE_DESKTOP']
  : requestedMode === 'codex'
    ? ['CODEX']
    : requestedMode === 'claude' || requestedMode === 'claude_desktop'
      ? ['CLAUDE_DESKTOP']
      : []

if (modes.length === 0) {
  process.stderr.write('Usage: npm run mcp:self-test -- codex|claude|both\n')
  process.exit(2)
}

async function testMode(host: McpHostMode): Promise<void> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const config = localMcpServerConfig(host)
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: repositoryRoot,
    env: environment,
    stderr: 'pipe',
  })
  try {
    const client = new Client({ name: 'imonfhir-local-mcp-self-test', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name)
    if (names.join('|') !== expectedTools.join('|')) throw new Error('MCP_CONTRACT_MISMATCH')
    const capabilities = await client.callTool({ name: 'payload_capabilities', arguments: {} })
    if (capabilities.isError || !capabilities.structuredContent) throw new Error('MCP_HANDSHAKE_FAILED')
    process.stdout.write(`PASS ${host}-mode local stdio launch, handshake, and three-tool contract\n`)
  } finally {
    await transport.close().catch(() => undefined)
  }
}

try {
  const rendezvous = await readRendezvous()
  const response = await fetch(`${rendezvous.baseUrl}/api/status`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error('LAB_UNAVAILABLE')
  const status = await response.json() as { ready?: boolean }
  if (!status.ready) throw new Error('LAB_UNAVAILABLE')

  process.stdout.write('PASS local lab readiness endpoint\nPASS rendezvous file private-mode check\n')
  for (const host of modes) await testMode(host)
  process.stdout.write('LOCAL SELF-TEST ONLY: this does not inspect or prove Codex or Claude Desktop configuration, host policy, provider connectivity, or host readiness.\n')
} catch {
  process.stderr.write('FAIL local MCP self-test. Start the lab with `npm run lab`, confirm this checkout is built, and retry.\n')
  process.stderr.write('This result does not diagnose Codex or Claude Desktop configuration.\n')
  process.exitCode = 1
}
