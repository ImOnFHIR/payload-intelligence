// SPDX-License-Identifier: Apache-2.0

import {
  canonicalJson,
  smeEvaluationRecordSchema,
  type SmeEvaluationRecord,
} from '@imonfhir/payload-contracts'

export const REQUIRED_REAL_HOST_VIDEO_LABEL = 'REAL HOST MCP HANDOFF · SYNTHETIC ONLY · NOT A MODEL QUALITY TEST'

const evaluationLeakPatterns = [
  /\b(?:ec|hs)_[a-f0-9]{16,64}\b/i,
  /\/Users\//,
  /file:\/\//i,
  /caseHandle/i,
  /expiresAt/i,
  /submissionId/i,
  /"prompt"/i,
] as const

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function validateHandoffEvaluationJsonl(evaluationText: string): SmeEvaluationRecord[] {
  const lines = evaluationText.endsWith('\n') ? evaluationText.slice(0, -1).split('\n') : []
  if (lines.length === 0 || lines.some((line) => line.length === 0)) throw new Error('HANDOFF_EVALUATION_JSONL_INVALID')
  const records: SmeEvaluationRecord[] = []
  for (const line of lines) {
    const parsed = smeEvaluationRecordSchema.parse(JSON.parse(line)) as SmeEvaluationRecord
    if (line !== canonicalJson(parsed)) throw new Error('HANDOFF_EVALUATION_NOT_CANONICAL')
    records.push(parsed)
  }
  const canonicalFile = records.slice().sort((left, right) => left.recordId.localeCompare(right.recordId))
    .map(canonicalJson).join('\n') + '\n'
  if (evaluationText !== canonicalFile) throw new Error('HANDOFF_EVALUATION_ORDER_OR_DUPLICATE_INVALID')
  if (new Set(records.map((entry) => entry.recordId)).size !== records.length) {
    throw new Error('HANDOFF_EVALUATION_ORDER_OR_DUPLICATE_INVALID')
  }
  if (records.length < 3 || new Set(records.map((entry) => entry.contextDigest)).size < 2) {
    throw new Error('HANDOFF_REQUIRED_CONTEXTS_MISSING')
  }
  const contexts = new Map<string, SmeEvaluationRecord[]>()
  for (const entry of records) contexts.set(entry.contextDigest, [...(contexts.get(entry.contextDigest) ?? []), entry])
  const dualHostContexts = [...contexts.entries()].filter(([, contextRecords]) => {
    const hosts = new Set(contextRecords.map((entry) => entry.hostKind))
    return hosts.has('CODEX') && hosts.has('CLAUDE_DESKTOP')
  })
  if (dualHostContexts.length === 0) throw new Error('HANDOFF_DUAL_HOST_CONTEXT_MISSING')
  const customReviewContext = [...contexts.entries()].find(([contextDigest, contextRecords]) => {
    if (!dualHostContexts.some(([dualDigest]) => dualDigest !== contextDigest)) return false
    const verdicts = contextRecords.flatMap((entry) => Object.values(entry.review).map((review) => review.verdict))
    return verdicts.includes('CORRECTED') && verdicts.includes('NOT_SCORABLE')
  })
  if (!customReviewContext) {
    throw new Error('HANDOFF_CUSTOM_REVIEW_EVIDENCE_MISSING')
  }
  if (evaluationLeakPatterns.some((pattern) => pattern.test(evaluationText))) throw new Error('HANDOFF_EVALUATION_LEAK')
  return records
}

export function validateMediaProbe(probe: unknown): number {
  const root = record(probe)
  const format = record(root?.format)
  const duration = Number(format?.duration)
  if (!Number.isFinite(duration) || duration < 60 || duration > 90) throw new Error('RELEASE_MEDIA_DURATION_INVALID')
  const streams = Array.isArray(root?.streams) ? root.streams.map(record) : []
  const streamTypes = streams.map((stream) => stream?.codec_type)
  if (!streamTypes.includes('video')) throw new Error('RELEASE_MEDIA_VIDEO_STREAM_MISSING')
  if (streamTypes.includes('audio')) throw new Error('RELEASE_MEDIA_AUDIO_PROHIBITED')
  const tags = record(format?.tags)
  if (!tags || !Object.values(tags).includes(REQUIRED_REAL_HOST_VIDEO_LABEL)) {
    throw new Error('RELEASE_MEDIA_LABEL_METADATA_MISSING')
  }
  return duration
}
