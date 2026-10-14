// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const major = Number(process.versions.node.split('.')[0])
if (major !== 22) {
  process.stderr.write(`Node.js 22 is required; found ${process.version}.\n`)
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', [existsSync('package-lock.json') ? 'ci' : 'install'])
run('npm', ['run', 'build'])

process.stdout.write('\nReady. Start the workbench with:\n\n  npm run lab\n\n')
process.stdout.write('Print MCP setup instructions with:\n\n  npm run mcp:config -- codex\n  npm run mcp:config -- claude\n\n')
process.stdout.write('After the lab starts, test the local MCP launch contract with:\n\n  npm run mcp:self-test -- both\n\nThis does not prove either AI host loaded the configuration.\n\n')
