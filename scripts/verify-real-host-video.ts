// SPDX-License-Identifier: Apache-2.0

import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { validateMediaProbe } from './release-verification-lib.js'

function fail(error: unknown): never {
  const message = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'RELEASE_MEDIA_CHECK_FAILED'
  process.stderr.write(`FAIL ${message}\n`)
  process.exit(1)
}
process.once('uncaughtException', fail)
process.once('unhandledRejection', fail)

const execute = promisify(execFileCallback)
const [videoArgument, digestArgument, ...confirmations] = process.argv.slice(2)
if (
  !videoArgument || !digestArgument ||
  !confirmations.includes('--visual-review=owner-confirmed') ||
  !confirmations.includes('--recording-view=confirmed')
) {
  process.stderr.write(
    'Usage: npm run media:verify -- <video.mp4> <video.sha256> --visual-review=owner-confirmed --recording-view=confirmed\n',
  )
  process.exit(2)
}

const videoPath = resolve(videoArgument)
const digestPath = resolve(digestArgument)
const videoStat = await lstat(videoPath)
const digestStat = await lstat(digestPath)
if (!videoStat.isFile() || videoStat.isSymbolicLink() || !digestStat.isFile() || digestStat.isSymbolicLink()) {
  throw new Error('RELEASE_MEDIA_MUST_BE_REGULAR_FILES')
}
if (videoStat.size === 0 || videoStat.size > 100 * 1_024 * 1_024) throw new Error('RELEASE_MEDIA_SIZE_INVALID')

const video = await readFile(videoPath)
const expectedLine = (await readFile(digestPath, 'utf8')).trim()
const digest = createHash('sha256').update(video).digest('hex')
if (expectedLine !== `${digest}  ${basename(videoPath)}`) throw new Error('RELEASE_MEDIA_DIGEST_MISMATCH')

const forbiddenBinaryPatterns = [
  /ec_[a-f0-9]{32}/i,
  /hs_[a-f0-9]{32}/i,
  /sr_[a-f0-9]{32}/i,
  /\/Users\//,
  /file:\/\//i,
  /caseHandle/i,
  /submissionId/i,
  /"prompt"/i,
]
const latinText = video.toString('latin1')
if (forbiddenBinaryPatterns.some((pattern) => pattern.test(latinText))) {
  throw new Error('RELEASE_MEDIA_BINARY_OR_METADATA_LEAK')
}

const probe = await execute('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration:format_tags:stream=codec_type:stream_tags', '-of', 'json', videoPath,
])
const probeText = `${probe.stdout}${probe.stderr}`
const duration = validateMediaProbe(JSON.parse(probe.stdout))
if (forbiddenBinaryPatterns.some((pattern) => pattern.test(probeText))) {
  throw new Error('RELEASE_MEDIA_METADATA_LEAK')
}
if ((await realpath(videoPath)) === (await realpath(digestPath))) throw new Error('RELEASE_MEDIA_DESCRIPTOR_INVALID')

process.stdout.write(
  `PASS real-host video descriptor and metadata checks (${duration.toFixed(1)} seconds; sha256 ${digest})\n` +
  'OWNER CONFIRMATION recorded: recording view was used and every frame was visually reviewed for restricted on-screen material.\n' +
  'This check does not establish model quality, host identity, or payload safety.\n',
)
