// SPDX-License-Identifier: Apache-2.0

import { claudeDesktopConfig, localMcpServerConfig, repositoryRoot } from './mcp-config-shared.js'

const target = process.argv.at(-1)?.toLowerCase()

if (target === 'codex') {
  const config = localMcpServerConfig('CODEX')
  process.stdout.write(`Add this to ~/.codex/config.toml:\n\n[mcp_servers.imonfhir_payload]\ncommand = "${config.command}"\nargs = ["${config.args[0]}", "${config.args[1]}"]\ncwd = "${repositoryRoot}"\nstartup_timeout_sec = 30\n\nFully quit and reopen Codex. Test the protocol-only probe, then inspect saved configuration and mode activity without changing either:\n  npm run mcp:self-test -- codex\n  npm run mcp:doctor -- codex\n\nA passing probe does not prove Codex loaded the server. Mode activity is ephemeral launcher-mode traffic, not authenticated host identity.\n`)
} else if (target === 'claude') {
  process.stdout.write(`Merge this server into ~/Library/Application Support/Claude/claude_desktop_config.json:\n\n${JSON.stringify(claudeDesktopConfig(), null, 2)}\n\nCheck the saved JSON without changing it:\n  npm run mcp:config:check -- claude\n\nFully quit and reopen Claude Desktop. Test the protocol-only probe, then inspect saved configuration and mode activity without changing either:\n  npm run mcp:self-test -- claude\n  npm run mcp:doctor -- claude\n\nNone of these checks alone proves Claude Desktop loaded the server. Mode activity is ephemeral launcher-mode traffic, not authenticated host identity.\n`)
} else {
  process.stderr.write('Choose a host: npm run mcp:config -- codex|claude\n')
  process.exitCode = 2
}
