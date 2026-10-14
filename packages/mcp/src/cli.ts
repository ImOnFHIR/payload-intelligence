#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import type { HostKind } from '@imonfhir/payload-contracts'
import { runMcpServer } from './server.js'

const hostArg = process.argv.find((arg) => arg.startsWith('--host='))?.slice('--host='.length)
const probe = process.argv.includes('--probe')
const unknownArguments = process.argv.slice(2).filter((argument) => !argument.startsWith('--host=') && argument !== '--probe')
if (hostArg !== 'CODEX' && hostArg !== 'CLAUDE_DESKTOP') {
  process.stderr.write('imonfhir-payload-mcp: valid --host is required\n')
  process.exitCode = 2
} else if (unknownArguments.length > 0) {
  process.stderr.write('imonfhir-payload-mcp: unsupported argument\n')
  process.exitCode = 2
} else {
  runMcpServer(hostArg as HostKind, { probe }).catch(() => {
    process.stderr.write('imonfhir-payload-mcp: server unavailable\n')
    process.exitCode = 1
  })
}
