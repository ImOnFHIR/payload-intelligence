// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (process.versions.node !== '22.22.3') {
  process.stderr.write(`Node.js 22.22.3 is required; found ${process.version}. Use .nvmrc or .node-version.\n`)
  process.exit(1)
}

if (!existsSync('package-lock.json')) {
  process.stderr.write('LOCKFILE_REQUIRED: package-lock.json is required for the locked bootstrap.\n')
  process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['ci'])
run('npm', ['run', 'build'])

process.stdout.write('\nReady. Start the workbench with:\n\n  npm run lab\n\n')
process.stdout.write('Print MCP setup instructions with:\n\n  npm run mcp:config -- codex\n  npm run mcp:config -- claude\n\n')
process.stdout.write('After the lab starts, test the local MCP launch contract with:\n\n  npm run mcp:self-test -- both\n\n')
process.stdout.write('Then inspect saved host configuration, local launch, and real mode activity separately with:\n\n  npm run mcp:doctor -- both\n\n')
process.stdout.write('Probe checks do not count as host activity and do not prove either AI host loaded the configuration.\n\n')
