// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const entry = resolve(root, 'packages/mcp/dist/cli.js')
const node = process.execPath
const target = process.argv.at(-1)?.toLowerCase()

if (target === 'codex') {
  process.stdout.write(`Add this to ~/.codex/config.toml:\n\n[mcp_servers.imonfhir_payload]\ncommand = "${node}"\nargs = ["${entry}", "--host=CODEX"]\ncwd = "${root}"\nstartup_timeout_sec = 30\n\nThen restart Codex and run: npm run mcp:doctor\n`)
} else if (target === 'claude') {
  process.stdout.write(`Merge this server into ~/Library/Application Support/Claude/claude_desktop_config.json:\n\n${JSON.stringify({ mcpServers: { imonfhir_payload: { command: node, args: [entry, '--host=CLAUDE_DESKTOP'] } } }, null, 2)}\n\nFully quit and reopen Claude Desktop, then run: npm run mcp:doctor\n`)
} else {
  process.stderr.write('Choose a host: npm run mcp:config -- codex|claude\n')
  process.exitCode = 2
}
