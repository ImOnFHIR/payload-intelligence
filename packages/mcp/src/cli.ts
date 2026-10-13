#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import type { HostKind } from '@imonfhir/payload-contracts'
import { runMcpServer } from './server.js'

const hostArg = process.argv.find((arg) => arg.startsWith('--host='))?.slice('--host='.length)
if (hostArg !== 'CODEX' && hostArg !== 'CLAUDE_DESKTOP') {
  process.stderr.write('imonfhir-payload-mcp: valid --host is required\n')
  process.exitCode = 2
} else {
  runMcpServer(hostArg as HostKind).catch(() => {
    process.stderr.write('imonfhir-payload-mcp: server unavailable\n')
    process.exitCode = 1
  })
}
