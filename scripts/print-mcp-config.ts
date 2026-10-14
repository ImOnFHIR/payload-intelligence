// SPDX-License-Identifier: Apache-2.0

import { claudeDesktopConfig, localMcpServerConfig, repositoryRoot } from './mcp-config-shared.js'

const target = process.argv.at(-1)?.toLowerCase()

if (target === 'codex') {
  const config = localMcpServerConfig('CODEX')
  process.stdout.write(`Add this to ~/.codex/config.toml:\n\n[mcp_servers.imonfhir_payload]\ncommand = "${config.command}"\nargs = ["${config.args[0]}", "${config.args[1]}"]\ncwd = "${repositoryRoot}"\nstartup_timeout_sec = 30\n\nFully quit and reopen Codex. Separately test this checkout's local server with:\n  npm run mcp:self-test -- codex\n\nThat self-test does not inspect Codex configuration or prove Codex host readiness.\n`)
} else if (target === 'claude') {
  process.stdout.write(`Merge this server into ~/Library/Application Support/Claude/claude_desktop_config.json:\n\n${JSON.stringify(claudeDesktopConfig(), null, 2)}\n\nCheck the saved JSON without changing it:\n  npm run mcp:config:check -- claude\n\nFully quit and reopen Claude Desktop. Separately test this checkout's local server with:\n  npm run mcp:self-test -- claude\n\nNeither check proves Claude Desktop loaded the server or can call it.\n`)
} else {
  process.stderr.write('Choose a host: npm run mcp:config -- codex|claude\n')
  process.exitCode = 2
}
