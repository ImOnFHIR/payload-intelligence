// SPDX-License-Identifier: Apache-2.0

// Summarises an exported v2 evaluation file for a written finding. Counts only; nothing is pooled, because each of the
// nine reviewed dimensions asks a different question and an average across them would mean nothing.

import type { HostKind, SmeEvaluationRecord } from '@imonfhir/payload-contracts'
import { assertNoEvaluationLeak, canonicalEvaluationRecords } from './release-verification-lib.js'

export const REVIEW_DIMENSIONS = [
  'standardVersion',
  'businessWorkflow',
  'exchangePattern',
  'interactionKind',
  'sourceActorRoles',
  'destinationActorRoles',
  'destinationClass',
  'missingContextQuestionCodes',
  'proposedNextActionCodes',
] as const

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number]

export interface DimensionTally {
  accepted: number
  corrected: number
  notScorable: number
}

export interface ContextRow {
  hostKind: HostKind
  dimension: ReviewDimension
  submitted: string
  expected: string | null
  verdict: 'ACCEPTED' | 'CORRECTED' | 'NOT_SCORABLE'
}

export interface ContextSummary {
  /** The approved summary's format and the first 8 characters of its digest. Fixtures carry no name in the export. */
  label: string
  format: string
  rows: ContextRow[]
}

export interface EvaluationSummary {
  records: number
  hosts: HostKind[]
  byHost: Record<string, Record<ReviewDimension, DimensionTally>>
  contexts: ContextSummary[]
}

/** Reads an export the way the handoff verifier does (canonical, sorted, no leaks) without its handoff gates. */
export function readEvaluationExport(evaluationText: string): SmeEvaluationRecord[] {
  const records = canonicalEvaluationRecords(evaluationText)
  assertNoEvaluationLeak(evaluationText)
  return records
}

function submittedValue(record: SmeEvaluationRecord, dimension: ReviewDimension): string {
  if (dimension === 'missingContextQuestionCodes') return codes(record.missingContextQuestionCodes)
  if (dimension === 'proposedNextActionCodes') return codes(record.proposedNextActionCodes)
  const hypothesis = record.hypotheses[dimension] as { value?: string; values?: string[] }
  return hypothesis.values ? codes(hypothesis.values) : String(hypothesis.value)
}

function codes(values: readonly string[]): string {
  return values.length ? values.join(', ') : '(none)'
}

function expectedValue(expected: unknown): string | null {
  if (expected === null || expected === undefined) return null
  return Array.isArray(expected) ? codes(expected as string[]) : String(expected)
}

export function summarizeEvaluations(records: readonly SmeEvaluationRecord[]): EvaluationSummary {
  const hosts = [...new Set(records.map((record) => record.hostKind))].sort()
  const byHost: EvaluationSummary['byHost'] = {}
  for (const host of hosts) {
    byHost[host] = Object.fromEntries(
      REVIEW_DIMENSIONS.map((dimension) => [dimension, { accepted: 0, corrected: 0, notScorable: 0 }]),
    ) as Record<ReviewDimension, DimensionTally>
  }
  const contexts = new Map<string, ContextSummary>()
  for (const record of records) {
    const format = record.context.structuralSummary.format
    const digest = record.contextDigest.replace(/^sha256:/, '').slice(0, 8)
    const context = contexts.get(record.contextDigest) ?? { label: `${format} · ${digest}`, format, rows: [] }
    for (const dimension of REVIEW_DIMENSIONS) {
      const review = record.review[dimension]
      const tally = byHost[record.hostKind]![dimension]
      if (review.verdict === 'ACCEPTED') tally.accepted += 1
      else if (review.verdict === 'CORRECTED') tally.corrected += 1
      else tally.notScorable += 1
      context.rows.push({
        hostKind: record.hostKind,
        dimension,
        submitted: submittedValue(record, dimension),
        expected: review.verdict === 'ACCEPTED' ? submittedValue(record, dimension) : expectedValue(review.expected),
        verdict: review.verdict,
      })
    }
    contexts.set(record.contextDigest, context)
  }
  return {
    records: records.length,
    hosts,
    byHost,
    contexts: [...contexts.values()].sort((left, right) => left.label.localeCompare(right.label)),
  }
}

const VERDICT_WORD = { ACCEPTED: 'accepted', CORRECTED: 'corrected', NOT_SCORABLE: 'not scorable' } as const

export function renderSummaryMarkdown(summary: EvaluationSummary): string {
  const lines: string[] = []
  lines.push(`${summary.records} evaluations from ${summary.contexts.length} approved cases; hosts: ${summary.hosts.join(', ')}.`)
  lines.push('')
  lines.push('No pooled score: each dimension is a different question, so the counts are reported one dimension at a time.')
  lines.push('')
  lines.push('## Accepted as answered, per host and dimension')
  lines.push('')
  lines.push(`| Dimension | ${summary.hosts.map((host) => `${host}: accepted / scored · not scorable`).join(' | ')} |`)
  lines.push(`|---|${summary.hosts.map(() => '---').join('|')}|`)
  for (const dimension of REVIEW_DIMENSIONS) {
    const cells = summary.hosts.map((host) => {
      const tally = summary.byHost[host]![dimension]
      return `${tally.accepted} / ${tally.accepted + tally.corrected} · ${tally.notScorable}`
    })
    lines.push(`| ${dimension} | ${cells.join(' | ')} |`)
  }
  for (const context of summary.contexts) {
    lines.push('')
    lines.push(`## ${context.label}`)
    lines.push('')
    lines.push('| Host | Dimension | Host answered | Expert expected | Verdict |')
    lines.push('|---|---|---|---|---|')
    for (const row of context.rows) {
      lines.push(`| ${row.hostKind} | ${row.dimension} | ${row.submitted} | ${row.expected ?? '—'} | ${VERDICT_WORD[row.verdict]} |`)
    }
  }
  return `${lines.join('\n')}\n`
}
