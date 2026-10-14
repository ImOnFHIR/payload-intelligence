// SPDX-License-Identifier: Apache-2.0

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  canonicalDigest,
  parseApprovedCaseMaterial,
  parseHostHypothesisSubmission,
  validateSubmissionAgainstCase,
  type ApprovedCaseMaterial,
  type HostEvaluationCase,
  type HostHypothesisReceipt,
  type HostHypothesisSubmission,
  type HostKind,
} from '@imonfhir/payload-contracts'
import { TAXONOMY_VERSION } from '@imonfhir/payload-core'
import { createServer as createViteServer } from 'vite'

const PORT = Number(process.env.IMONFHIR_LAB_PORT ?? '4317')
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65_535) throw new Error('INVALID_PORT')
const BASE_URL = `http://127.0.0.1:${PORT}`
const CASE_TTL_MS = 4 * 60 * 60 * 1_000
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

interface StoredSubmission {
  hostKind: HostKind
  submission: HostHypothesisSubmission
  receipt: HostHypothesisReceipt
}

interface StoredCase {
  evaluationCase: HostEvaluationCase
  expiresAtMs: number
  submissions: StoredSubmission[]
  hostState: 'WAITING' | 'RECEIVED' | 'STALE'
}

const cases = new Map<string, StoredCase>()
const token = randomBytes(32).toString('hex')

function rendezvousFile(): string {
  if (process.env.IMONFHIR_LAB_RENDEZVOUS) return process.env.IMONFHIR_LAB_RENDEZVOUS
  return join(homedir(), '.imonfhir-payload-intelligence', 'lab.json')
}

async function writeRendezvous(): Promise<string> {
  const path = rendezvousFile()
  const directory = resolve(path, '..')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify({
    schemaVersion: 'imonfhir.lab-rendezvous.v1',
    baseUrl: BASE_URL,
    token,
    pid: process.pid,
  }), { mode: 0o600 })
  await rename(temporary, path)
  return path
}

// Only the instance that wrote the rendezvous may remove it. A second launch that
// loses the port race must not strand the running lab's MCP connection.
async function removeOwnRendezvous(): Promise<void> {
  try {
    const current = JSON.parse(await readFile(rendezvousFile(), 'utf8')) as { pid?: unknown }
    if (current.pid === process.pid) await rm(rendezvousFile(), { force: true })
  } catch { /* absent or unreadable: nothing of ours to remove */ }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > limit) throw new Error('BODY_TOO_LARGE')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function activeCase(handle: string): StoredCase {
  const stored = cases.get(handle)
  if (!stored || stored.expiresAtMs <= Date.now()) {
    cases.delete(handle)
    throw new Error('EXPIRED_CASE')
  }
  return stored
}

function isBlocked(material: ApprovedCaseMaterial): boolean {
  return ['RESTRICTED_EDI_UNSUPPORTED', 'PDF', 'DICOM', 'ARCHIVE', 'UNKNOWN_BINARY']
    .includes(material.structuralSummary.format) ||
    material.observation.status === 'REJECTED' ||
    material.observation.status === 'OPAQUE'
}

function publicOriginAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  return origin === BASE_URL || origin === undefined
}

function internalAuthorized(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${token}`
}

function fixedError(error: unknown): string {
  const value = error instanceof Error ? error.message : 'STORE_UNAVAILABLE'
  const allowed = new Set([
    'EXPIRED_CASE', 'EVALUATION_BLOCKED', 'STALE_CASE', 'INVALID_HYPOTHESES',
    'INVALID_EVIDENCE_REFERENCE', 'SUBMISSION_LIMIT_REACHED', 'STORE_UNAVAILABLE',
  ])
  return allowed.has(value) ? value : 'STORE_UNAVAILABLE'
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const url = new URL(request.url ?? '/', BASE_URL)
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/internal/')) return false

  try {
    if (url.pathname.startsWith('/internal/') && !internalAuthorized(request)) {
      json(response, 401, { error: 'STORE_UNAVAILABLE' })
      return true
    }
    if (url.pathname.startsWith('/api/') && !publicOriginAllowed(request)) {
      json(response, 403, { error: 'STORE_UNAVAILABLE' })
      return true
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      json(response, 200, {
        schemaVersion: 'imonfhir.lab-status.v1',
        ready: true,
        activeCases: cases.size,
        hosts: ['CODEX', 'CLAUDE_DESKTOP'],
      })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/cases') {
      const material = parseApprovedCaseMaterial(await readJson(request, 256 * 1_024))
      if (isBlocked(material)) throw new Error('EVALUATION_BLOCKED')
      for (const existing of cases.keys()) cases.delete(existing)
      const caseHandle = `ec_${randomBytes(16).toString('hex')}`
      const caseDigest = canonicalDigest(material)
      const expiresAtMs = Date.now() + CASE_TTL_MS
      const evaluationCase: HostEvaluationCase = {
        ...material,
        schemaVersion: 'imonfhir.host-evaluation-case.v1',
        caseHandle,
        caseDigest,
        expiresAt: new Date(expiresAtMs).toISOString(),
        taxonomyVersion: TAXONOMY_VERSION,
        requiredSubmission: {
          axes: ['standardVersion', 'workflow', 'direction', 'actorRoles', 'destinationClass'],
        },
      }
      cases.set(caseHandle, { evaluationCase, expiresAtMs, submissions: [], hostState: 'WAITING' })
      json(response, 201, evaluationCase)
      return true
    }

    const publicMatch = url.pathname.match(/^\/api\/cases\/(ec_[a-f0-9]{32})(?:\/submissions)?$/)
    if (publicMatch?.[1]) {
      const handle = publicMatch[1]
      if (request.method === 'GET' && url.pathname.endsWith('/submissions')) {
        const stored = activeCase(handle)
        json(response, 200, { state: stored.hostState, submissions: stored.submissions })
        return true
      }
      if (request.method === 'DELETE') {
        cases.delete(handle)
        json(response, 200, { purged: true })
        return true
      }
    }

    const internalCaseMatch = url.pathname.match(/^\/internal\/cases\/(ec_[a-f0-9]{32})$/)
    if (request.method === 'GET' && internalCaseMatch?.[1]) {
      json(response, 200, activeCase(internalCaseMatch[1]).evaluationCase)
      return true
    }

    const submissionMatch = url.pathname.match(/^\/internal\/cases\/(ec_[a-f0-9]{32})\/submissions$/)
    if (request.method === 'POST' && submissionMatch?.[1]) {
      const handle = submissionMatch[1]
      const host = url.searchParams.get('host')
      if (host !== 'CODEX' && host !== 'CLAUDE_DESKTOP') throw new Error('STORE_UNAVAILABLE')
      const stored = activeCase(handle)
      const submission = parseHostHypothesisSubmission(await readJson(request, 32 * 1_024))
      try {
        validateSubmissionAgainstCase(submission, stored.evaluationCase)
      } catch (error) {
        if (fixedError(error) === 'STALE_CASE') stored.hostState = 'STALE'
        throw error
      }
      const submissionDigest = canonicalDigest({ caseDigest: submission.caseDigest, hostKind: host, submission })
      const duplicate = stored.submissions.find((entry) => entry.receipt.submissionDigest === submissionDigest)
      if (duplicate) {
        stored.hostState = 'RECEIVED'
        json(response, 200, { ...duplicate.receipt, deduplicated: true })
        return true
      }
      if (stored.submissions.length >= 16 || stored.submissions.filter((entry) => entry.hostKind === host).length >= 8) {
        throw new Error('SUBMISSION_LIMIT_REACHED')
      }
      const receipt: HostHypothesisReceipt = {
        schemaVersion: 'imonfhir.host-hypothesis-receipt.v1',
        caseHandle: handle,
        caseDigest: submission.caseDigest,
        submissionId: `hs_${submissionDigest.slice(0, 32)}`,
        submissionDigest,
        hostKind: host,
        state: 'PENDING_SME_REVIEW',
        deduplicated: false,
      }
      stored.submissions.push({ hostKind: host, submission, receipt })
      stored.hostState = 'RECEIVED'
      json(response, 201, receipt)
      return true
    }

    json(response, 404, { error: 'EXPIRED_CASE' })
    return true
  } catch (error) {
    json(response, 400, { error: fixedError(error) })
    return true
  }
}

async function main(): Promise<void> {
  const vite = await createViteServer({
    root: join(root, 'apps/lab'),
    server: { middlewareMode: true, hmr: false },
    appType: 'spa',
  })
  const server = createServer(async (request, response) => {
    response.setHeader('content-security-policy', `default-src 'self'; connect-src 'self' ws://127.0.0.1:${PORT}; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    response.setHeader('x-content-type-options', 'nosniff')
    if (await handleApi(request, response)) return
    vite.middlewares(request, response, () => {
      response.statusCode = 404
      response.end('Not found')
    })
  })

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(PORT, '127.0.0.1', resolvePromise)
  })
  await writeRendezvous()
  process.stdout.write(`ImOnFHIR Payload Intelligence Preview: ${BASE_URL}\n`)

  if (process.argv.includes('--open')) {
    const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'cmd' : 'xdg-open'
    const args = platform() === 'win32' ? ['/c', 'start', '', BASE_URL] : [BASE_URL]
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
  }

  const shutdown = async () => {
    cases.clear()
    await removeOwnRendezvous()
    await vite.close()
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}

main().catch(async () => {
  await removeOwnRendezvous()
  process.stderr.write(`Unable to start the local workbench. Is port ${PORT} already in use?\n`)
  process.exit(1)
})
