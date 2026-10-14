// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCallback } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readRendezvous, type Rendezvous } from '../packages/mcp/src/rendezvous.js'
import {
  localMcpServerConfig,
  mcpEntry,
  repositoryRoot,
  validateClaudeDesktopConfig,
  validateCodexConfig,
  type McpHostMode,
} from './mcp-config-shared.js'

export const EXPECTED_MCP_TOOLS = [
  'payload_capabilities',
  'payload_get_evaluation_case',
  'payload_submit_hypotheses',
] as const

export type DoctorTarget = 'codex' | 'claude' | 'both'
export type DoctorCheckState = 'PASS' | 'FAIL' | 'UNAVAILABLE'
export type HostActivityState = 'NOT_SEEN' | 'CAPABILITIES_CALLED' | 'CASE_RETRIEVED' | 'SUBMITTED' | 'UNAVAILABLE'

export interface DoctorCheck {
  state: DoctorCheckState
  code: string
}

export interface HostDoctorResult {
  host: McpHostMode
  configuration: DoctorCheck
  localLaunch: DoctorCheck
  toolContract: DoctorCheck
  activity: HostActivityState
}

export interface DoctorReport {
  schemaVersion: 'imonfhir.mcp-doctor-report.v1'
  readOnly: true
  node: DoctorCheck
  build: DoctorCheck
  lab: DoctorCheck
  rendezvousPermissions: DoctorCheck
  hosts: HostDoctorResult[]
}

interface ProbeResult {
  launched: boolean
  tools: string[]
  capabilitiesReturned: boolean
}

interface ExecResult {
  stdout: string
  stderr: string
}

export interface DoctorDependencies {
  nodeVersion: string
  ensureReadable(path: string): Promise<void>
  readText(path: string): Promise<string>
  readLabRendezvous(): Promise<Rendezvous>
  execFile(file: string, args: string[]): Promise<ExecResult>
  launchProbe(host: McpHostMode): Promise<ProbeResult>
  fetchJson(url: string): Promise<unknown>
  codexCommand: string
  claudeConfigPath: string
}

const execFile = promisify(execFileCallback)

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function selectedHosts(target: DoctorTarget): McpHostMode[] {
  if (target === 'codex') return ['CODEX']
  if (target === 'claude') return ['CLAUDE_DESKTOP']
  return ['CODEX', 'CLAUDE_DESKTOP']
}

async function defaultLaunchProbe(host: McpHostMode): Promise<ProbeResult> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const config = localMcpServerConfig(host, process.execPath, { probe: true })
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: repositoryRoot,
    env: environment,
    stderr: 'pipe',
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const client = new Client({ name: 'imonfhir-mcp-doctor-probe', version: '1.0.0' }, { capabilities: {} })
        await client.connect(transport)
        const tools = await client.listTools()
        const capabilities = await client.callTool({ name: 'payload_capabilities', arguments: {} })
        return {
          launched: true,
          tools: tools.tools.map((tool) => tool.name),
          capabilitiesReturned: !capabilities.isError && capabilities.structuredContent !== undefined,
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('PROBE_TIMEOUT')), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    await transport.close().catch(() => undefined)
  }
}

export function defaultDoctorDependencies(): DoctorDependencies {
  return {
    nodeVersion: process.version,
    ensureReadable: async (path) => access(path),
    readText: async (path) => readFile(path, 'utf8'),
    readLabRendezvous: () => readRendezvous(),
    execFile: async (file, args) => {
      const output = await execFile(file, args, { timeout: 5_000, maxBuffer: 512 * 1_024 })
      return { stdout: output.stdout, stderr: output.stderr }
    },
    launchProbe: defaultLaunchProbe,
    fetchJson: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (!response.ok) throw new Error('HTTP_FAILURE')
      return response.json()
    },
    codexCommand: process.env.IMONFHIR_CODEX_COMMAND || process.env.CODEX_CLI_PATH || 'codex',
    claudeConfigPath: process.env.IMONFHIR_CLAUDE_CONFIG || join(
      homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json',
    ),
  }
}

async function inspectCodexConfiguration(dependencies: DoctorDependencies): Promise<DoctorCheck> {
  try {
    const result = await dependencies.execFile(
      dependencies.codexCommand,
      ['mcp', 'get', 'imonfhir_payload', '--json'],
    )
    const parsed = JSON.parse(result.stdout) as unknown
    const failures = validateCodexConfig(parsed)
    return failures.length === 0
      ? { state: 'PASS', code: 'CONFIGURATION_MATCH' }
      : { state: 'FAIL', code: failures.join('+') }
  } catch (error) {
    const detail = record(error)
    const code = detail?.code
    const errorText = `${typeof detail?.stderr === 'string' ? detail.stderr : ''} ${error instanceof Error ? error.message : ''}`.toLowerCase()
    return code === 'ENOENT' || errorText.includes('unexpected argument') || errorText.includes('unrecognized option')
      ? { state: 'UNAVAILABLE', code: 'CODEX_CLI_UNAVAILABLE' }
      : { state: 'FAIL', code: 'CONFIGURATION_MISSING_OR_INVALID' }
  }
}

async function inspectClaudeConfiguration(dependencies: DoctorDependencies): Promise<DoctorCheck> {
  try {
    const parsed = JSON.parse(await dependencies.readText(dependencies.claudeConfigPath)) as unknown
    const failures = validateClaudeDesktopConfig(parsed)
    return failures.length === 0
      ? { state: 'PASS', code: 'CONFIGURATION_MATCH' }
      : { state: 'FAIL', code: failures.join('+') }
  } catch (error) {
    const code = record(error)?.code
    return code === 'ENOENT'
      ? { state: 'FAIL', code: 'CONFIGURATION_MISSING' }
      : { state: 'FAIL', code: 'CONFIGURATION_INVALID' }
  }
}

function parseActivity(value: unknown, host: McpHostMode): HostActivityState {
  const root = record(value)
  if (root?.schemaVersion !== 'imonfhir.host-activity.v1') return 'UNAVAILABLE'
  const activity = record(root.activity)
  const state = activity?.[host]
  return state === 'NOT_SEEN' || state === 'CAPABILITIES_CALLED' || state === 'CASE_RETRIEVED' || state === 'SUBMITTED'
    ? state
    : 'UNAVAILABLE'
}

export async function runDoctor(
  target: DoctorTarget,
  dependencies: DoctorDependencies = defaultDoctorDependencies(),
): Promise<DoctorReport> {
  const node: DoctorCheck = dependencies.nodeVersion.replace(/^v/, '') === '22.22.3'
    ? { state: 'PASS', code: 'NODE_22_22_3' }
    : { state: 'FAIL', code: 'NODE_22_22_3_REQUIRED' }

  let build: DoctorCheck
  try {
    await dependencies.ensureReadable(mcpEntry)
    build = { state: 'PASS', code: 'MCP_BUILD_PRESENT' }
  } catch {
    build = { state: 'FAIL', code: 'MCP_BUILD_MISSING' }
  }

  let rendezvous: Rendezvous | undefined
  let rendezvousPermissions: DoctorCheck
  try {
    rendezvous = await dependencies.readLabRendezvous()
    rendezvousPermissions = { state: 'PASS', code: 'PRIVATE_RENDEZVOUS' }
  } catch {
    rendezvousPermissions = { state: 'FAIL', code: 'RENDEZVOUS_MISSING_OR_PERMISSIVE' }
  }

  let lab: DoctorCheck = { state: 'FAIL', code: 'LAB_UNAVAILABLE' }
  let activity: unknown
  if (rendezvous) {
    try {
      const status = record(await dependencies.fetchJson(`${rendezvous.baseUrl}/api/status`))
      lab = status?.ready === true
        ? { state: 'PASS', code: 'LOOPBACK_LAB_READY' }
        : { state: 'FAIL', code: 'LAB_NOT_READY' }
      activity = await dependencies.fetchJson(`${rendezvous.baseUrl}/api/host-activity`).catch(() => undefined)
    } catch {
      lab = { state: 'FAIL', code: 'LAB_UNAVAILABLE' }
    }
  }

  const hosts: HostDoctorResult[] = []
  for (const host of selectedHosts(target)) {
    const configuration = host === 'CODEX'
      ? await inspectCodexConfiguration(dependencies)
      : await inspectClaudeConfiguration(dependencies)

    let localLaunch: DoctorCheck
    let toolContract: DoctorCheck
    try {
      const result = await dependencies.launchProbe(host)
      localLaunch = result.launched && result.capabilitiesReturned
        ? { state: 'PASS', code: 'PROBE_LAUNCH_OK' }
        : { state: 'FAIL', code: 'PROBE_LAUNCH_FAILED' }
      toolContract = result.tools.join('|') === EXPECTED_MCP_TOOLS.join('|')
        ? { state: 'PASS', code: 'EXACT_THREE_TOOL_CONTRACT' }
        : { state: 'FAIL', code: 'TOOL_CONTRACT_MISMATCH' }
    } catch {
      localLaunch = { state: 'FAIL', code: 'PROBE_LAUNCH_FAILED' }
      toolContract = { state: 'FAIL', code: 'TOOL_CONTRACT_UNVERIFIED' }
    }

    hosts.push({
      host,
      configuration,
      localLaunch,
      toolContract,
      activity: parseActivity(activity, host),
    })
  }

  return {
    schemaVersion: 'imonfhir.mcp-doctor-report.v1',
    readOnly: true,
    node,
    build,
    lab,
    rendezvousPermissions,
    hosts,
  }
}

function hostLabel(host: McpHostMode): string {
  return host === 'CODEX' ? 'Codex-mode' : 'Claude-mode'
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    'ImOnFHIR MCP doctor (read-only; no host configuration was changed)',
    `${report.node.state} node: ${report.node.code}`,
    `${report.build.state} build: ${report.build.code}`,
    `${report.lab.state} lab: ${report.lab.code}`,
    `${report.rendezvousPermissions.state} rendezvous: ${report.rendezvousPermissions.code}`,
  ]
  for (const host of report.hosts) {
    const label = hostLabel(host.host)
    const configurationLabel = host.host === 'CODEX' ? 'saved CLI configuration match' : 'saved JSON configuration match'
    lines.push(`${label} ${configurationLabel}: ${host.configuration.state} (${host.configuration.code})`)
    lines.push(`${label} local probe launch: ${host.localLaunch.state} (${host.localLaunch.code})`)
    lines.push(`${label} exact three-tool contract: ${host.toolContract.state} (${host.toolContract.code})`)
    lines.push(`${label} MCP activity seen: ${host.activity} (ephemeral mode activity; not authenticated identity; probe calls excluded)`)
  }
  lines.push('Saved configuration match, local launch, and MCP activity are separate observations; none alone proves host activation or provider connectivity.')
  return `${lines.join('\n')}\n`
}

export function doctorPassed(report: DoctorReport): boolean {
  const base = [report.node, report.build, report.lab, report.rendezvousPermissions]
  const hostChecks = report.hosts.flatMap((host) => [host.configuration, host.localLaunch, host.toolContract])
  return [...base, ...hostChecks].every((check) => check.state === 'PASS')
}
