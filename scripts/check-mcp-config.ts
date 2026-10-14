// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateClaudeDesktopConfig } from './mcp-config-shared.js'

const target = process.argv[2]?.toLowerCase()
if (target !== 'claude') {
  process.stderr.write('Usage: npm run mcp:config:check -- claude\n')
  process.exit(2)
}

const explicitPath = process.argv.find((argument) => argument.startsWith('--path='))?.slice('--path='.length)
const configPath = explicitPath || process.env.IMONFHIR_CLAUDE_CONFIG || join(
  homedir(),
  'Library',
  'Application Support',
  'Claude',
  'claude_desktop_config.json',
)

try {
  const source = await readFile(configPath, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('INVALID_JSON')
  }
  const failures = validateClaudeDesktopConfig(parsed)
  if (failures.length > 0) throw new Error(failures.join(','))
  process.stdout.write('PASS Claude Desktop configuration is valid JSON and its imonfhir_payload command and arguments match this checkout.\n')
  process.stdout.write('READ-ONLY CONFIG CHECK: no settings were changed. This does not prove Claude Desktop loaded or can call the server.\n')
} catch (error) {
  const reason = error instanceof Error ? error.message : 'CONFIG_UNAVAILABLE'
  process.stderr.write(`FAIL Claude Desktop configuration check (${reason}). Regenerate the snippet with \`npm run mcp:config -- claude\`.\n`)
  process.stderr.write('No settings were changed.\n')
  process.exitCode = 1
}
