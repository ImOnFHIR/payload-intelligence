// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { canonicalJson } from '@imonfhir/payload-contracts'
import { evaluatedRecord, jsonl, material } from './evaluation-record-fixtures.js'
import { assertNoEvaluationLeak } from './release-verification-lib.js'
import {
  REVIEW_DIMENSIONS,
  readEvaluationExport,
  renderSummaryMarkdown,
  summarizeEvaluations,
} from './results-summary-lib.js'

describe('results summary', () => {
  const builtIn = material('FHIR_JSON', '1')
  const custom = material('FHIR_XML', '3')
  const records = [
    evaluatedRecord(builtIn, 'CODEX'),
    evaluatedRecord(builtIn, 'CLAUDE_DESKTOP'),
    evaluatedRecord(custom, 'CODEX', true),
  ]

  it('reads a single-host export that the handoff gate would refuse', () => {
    // One host and one case is a real first run; the summary must not demand the handoff gate's shape.
    expect(readEvaluationExport(jsonl([evaluatedRecord(builtIn, 'CLAUDE_DESKTOP')]))).toHaveLength(1)
  })

  it('still refuses an export that is out of order, duplicated, or edited out of its closed codes', () => {
    const text = jsonl(records)
    expect(() => readEvaluationExport(text.split('\n').filter(Boolean).reverse().join('\n') + '\n'))
      .toThrow('HANDOFF_EVALUATION_ORDER_OR_DUPLICATE_INVALID')
    const line = text.split('\n')[0]!
    expect(() => readEvaluationExport(`${line}\n${line}\n`)).toThrow('HANDOFF_EVALUATION_ORDER_OR_DUPLICATE_INVALID')
    // The record schema admits only closed codes, so a path pasted into a field is refused before the leak scan.
    expect(() => readEvaluationExport(text.replace('"FHIR_R4"', `"/Users/someone/FHIR_R4"`))).toThrow()
  })

  it('scans for transient identifiers as a second line of defence', () => {
    for (const leak of [`ec_${'a'.repeat(32)}`, '/Users/someone/file.json', '"caseHandle"', 'expiresAt', '"prompt"']) {
      expect(() => assertNoEvaluationLeak(`{"x":"${leak}"}\n`), leak).toThrow('HANDOFF_EVALUATION_LEAK')
    }
    expect(() => assertNoEvaluationLeak(jsonl(records))).not.toThrow()
  })

  it('counts each verdict per host and dimension, and never pools across dimensions', () => {
    const summary = summarizeEvaluations(records)
    expect(summary.records).toBe(3)
    expect(summary.hosts).toEqual(['CLAUDE_DESKTOP', 'CODEX'])
    expect(summary.byHost.CODEX!.businessWorkflow).toEqual({ accepted: 1, corrected: 1, notScorable: 0 })
    expect(summary.byHost.CODEX!.interactionKind).toEqual({ accepted: 1, corrected: 0, notScorable: 1 })
    expect(summary.byHost.CLAUDE_DESKTOP!.businessWorkflow).toEqual({ accepted: 1, corrected: 0, notScorable: 0 })
    for (const dimension of REVIEW_DIMENSIONS) {
      const tally = summary.byHost.CODEX![dimension]
      expect(tally.accepted + tally.corrected + tally.notScorable).toBe(2)
    }
    const markdown = renderSummaryMarkdown(summary)
    expect(markdown).toContain('No pooled score')
    expect(markdown).not.toMatch(/overall|average|%/i)
    expect(markdown).toContain('| businessWorkflow | 1 / 1 · 0 | 1 / 2 · 0 |')
  })

  it('shows what the host answered beside what the expert expected, case by case', () => {
    const summary = summarizeEvaluations(records)
    expect(summary.contexts.map((context) => context.format)).toEqual(['FHIR_JSON', 'FHIR_XML'])
    const corrected = summary.contexts[1]!.rows.find((row) => row.dimension === 'businessWorkflow')!
    expect(corrected).toMatchObject({
      hostKind: 'CODEX', submitted: 'PRIOR_AUTHORIZATION', expected: 'CARE_COORDINATION', verdict: 'CORRECTED',
    })
    const notScorable = summary.contexts[1]!.rows.find((row) => row.dimension === 'interactionKind')!
    expect(notScorable).toMatchObject({ submitted: 'REQUEST', expected: null, verdict: 'NOT_SCORABLE' })
    const accepted = summary.contexts[0]!.rows.find((row) => row.dimension === 'sourceActorRoles')!
    expect(accepted).toMatchObject({ submitted: 'PROVIDER_OR_CARE_TEAM', expected: 'PROVIDER_OR_CARE_TEAM' })
    expect(renderSummaryMarkdown(summary)).toContain(
      '| CODEX | businessWorkflow | PRIOR_AUTHORIZATION | CARE_COORDINATION | corrected |',
    )
  })

  it('carries nothing beyond codes, formats and short digests', () => {
    const markdown = renderSummaryMarkdown(summarizeEvaluations(records))
    for (const record of records) expect(markdown).not.toContain(record.recordId)
    expect(markdown).not.toContain(canonicalJson(records[0]!.context))
    expect(markdown).not.toMatch(/ec_[a-f0-9]{16,}|ev_[a-z0-9]{16}/)
  })
})
