// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readRendezvous } from '../packages/mcp/src/rendezvous.js'

let transport: StdioClientTransport | undefined
try {
  const rendezvous = await readRendezvous()
  const response = await fetch(`${rendezvous.baseUrl}/api/status`, { signal: AbortSignal.timeout(2_000) })
  if (!response.ok) throw new Error('LAB_UNAVAILABLE')
  const status = await response.json() as { ready?: boolean }
  if (!status.ready) throw new Error('LAB_UNAVAILABLE')

  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('packages/mcp/dist/cli.js'), '--host=CODEX'],
    cwd: resolve('.'),
    env: environment,
    stderr: 'pipe',
  })
  const client = new Client({ name: 'imonfhir-mcp-doctor', version: '1.0.0' }, { capabilities: {} })
  await client.connect(transport)
  const tools = await client.listTools()
  const names = tools.tools.map((tool) => tool.name)
  if (names.join('|') !== 'payload_capabilities|payload_get_evaluation_case|payload_submit_hypotheses') {
    throw new Error('MCP_CONTRACT_MISMATCH')
  }
  const capabilities = await client.callTool({ name: 'payload_capabilities', arguments: {} })
  if (capabilities.isError || !capabilities.structuredContent) throw new Error('MCP_HANDSHAKE_FAILED')
  await transport.close()
  transport = undefined
  process.stdout.write('PASS local lab is running\nPASS rendezvous file is private\nPASS evaluator MCP stdio handshake and three-tool contract\n')
} catch {
  await transport?.close().catch(() => undefined)
  process.stderr.write('FAIL start the lab with `npm run lab`, then retry.\n')
  process.exitCode = 1
}
