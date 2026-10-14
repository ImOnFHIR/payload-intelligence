// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  nonAuthorHandoffReceiptSchema,
} from '@imonfhir/payload-contracts'
import { validateHandoffEvaluationJsonl } from './release-verification-lib.js'

function fail(error: unknown): never {
  const message = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'HANDOFF_VERIFICATION_FAILED'
  process.stderr.write(`FAIL ${message}\n`)
  process.exit(1)
}
process.once('uncaughtException', fail)
process.once('unhandledRejection', fail)

function argument(name: string): string | undefined {
  return process.argv.slice(2).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

const receiptArgument = process.argv[2]
const evaluationArgument = argument('--evaluation')
const recordingArgument = argument('--recording')
const descriptorArgument = argument('--descriptor')
if (!receiptArgument || !evaluationArgument || !recordingArgument || !descriptorArgument) {
  process.stderr.write(
    'Usage: npm run handoff:verify -- <receipt.json> --evaluation=<v2.jsonl> --recording=<video.mp4> --descriptor=<video.sha256>\n',
  )
  process.exit(2)
}

async function regularFile(path: string): Promise<Buffer> {
  const resolved = resolve(path)
  const stats = await lstat(resolved)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('HANDOFF_ARTIFACT_NOT_REGULAR_FILE')
  return readFile(resolved)
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function gitOutput(args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const processHandle = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    processHandle.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    processHandle.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    processHandle.once('error', rejectPromise)
    processHandle.once('close', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout))
      else rejectPromise(new Error(stderr.length ? Buffer.concat(stderr).toString('utf8') : 'GIT_COMMAND_FAILED'))
    })
  })
}

const receipt = nonAuthorHandoffReceiptSchema.parse(
  JSON.parse((await regularFile(receiptArgument)).toString('utf8')),
)
if (receipt.elapsedSetupMinutes > 10) throw new Error('HANDOFF_SETUP_TIME_GATE_FAILED')
if (Object.values(receipt.checklist).some((value) => value !== 'PASS')) {
  throw new Error('HANDOFF_CHECKLIST_INCOMPLETE')
}
if (receipt.blockerCodes.length !== 1 || receipt.blockerCodes[0] !== 'NONE') {
  throw new Error('HANDOFF_BLOCKERS_PRESENT')
}

const head = (await gitOutput(['rev-parse', 'HEAD'])).toString('utf8').trim()
if (head !== receipt.testedCommit) throw new Error('HANDOFF_COMMIT_MISMATCH')
const worktreeStatus = await gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])
if (worktreeStatus.length !== 0) throw new Error('HANDOFF_CHECKOUT_NOT_CLEAN')
const sourceTree = await gitOutput(['ls-tree', '-r', '--full-tree', '-z', receipt.testedCommit])
if (sha256(sourceTree) !== receipt.artifactDigests.candidateSourceTreeSha256) {
  throw new Error('HANDOFF_SOURCE_TREE_DIGEST_MISMATCH')
}

const evaluationPath = resolve(evaluationArgument)
const evaluation = await regularFile(evaluationPath)
if (sha256(evaluation) !== receipt.artifactDigests.evaluationExportSha256) {
  throw new Error('HANDOFF_EVALUATION_DIGEST_MISMATCH')
}
const evaluationText = evaluation.toString('utf8')
const records = validateHandoffEvaluationJsonl(evaluationText)

const recordingPath = resolve(recordingArgument)
const recording = await regularFile(recordingPath)
if (sha256(recording) !== receipt.artifactDigests.recordingMp4Sha256) {
  throw new Error('HANDOFF_RECORDING_DIGEST_MISMATCH')
}
const descriptorPath = resolve(descriptorArgument)
const descriptor = await regularFile(descriptorPath)
if (sha256(descriptor) !== receipt.artifactDigests.recordingDescriptorSha256) {
  throw new Error('HANDOFF_DESCRIPTOR_DIGEST_MISMATCH')
}
if (descriptor.toString('utf8') !== `${receipt.artifactDigests.recordingMp4Sha256}  ${basename(recordingPath)}\n`) {
  throw new Error('HANDOFF_DESCRIPTOR_CONTENT_MISMATCH')
}

process.stdout.write(
  `PASS U2 non-author handoff receipt for ${receipt.testedCommit}\n` +
  `PASS ${records.length} canonical taxonomy-v2 evaluation record${records.length === 1 ? '' : 's'}\n` +
  'Release tagging remains a separate explicit owner action.\n',
)
