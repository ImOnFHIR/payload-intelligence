// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  canonicalJsonl,
  evidenceLabel,
  hasUnsavedSubmissions,
  plainLabel,
  putDraft,
  recoveryFor,
  reviewFingerprint,
  sameSet,
  upsertRecord,
} from '../src/ui.js'

describe('workbench UI policy helpers', () => {
  it('maps known and unknown errors to fixed recovery text', () => {
    expect(recoveryFor(new Error('STALE_CASE'))).toEqual({
      code: 'STALE_CASE',
      message: 'Ask the host to retrieve the current case again before resubmitting.',
    })
    expect(recoveryFor(new Error('CONTRACT_VERSION_MISMATCH'))).toEqual({
      code: 'CONTRACT_VERSION_MISMATCH',
      message: 'Rebuild and restart the local lab, then inspect and approve a new case.',
    })
    expect(recoveryFor(new Error('a local path must not be rendered'))).toEqual({
      code: 'LOCAL_RESTART_REQUIRED',
      message: 'Restart the local lab and retry this synthetic case.',
    })
    expect(recoveryFor(new Error('toString'))).toEqual({
      code: 'LOCAL_RESTART_REQUIRED',
      message: 'Restart the local lab and retry this synthetic case.',
    })
  })

  it('uses plain labels and complete sanitized evidence details', () => {
    expect(plainLabel('PRIOR_AUTHORIZATION')).toBe('Prior Authorization')
    expect(evidenceLabel({
      ref: 'ev_0000000000000000',
      kind: 'AGGREGATE',
      code: 'SEGMENTS',
      countBand: 'TWO_TO_FIVE',
    })).toBe('Segments · Two To Five')
  })

  it('compares sets without order and distinguishes different sets', () => {
    expect(sameSet(['A', 'B'], ['B', 'A'])).toBe(true)
    expect(sameSet(['A'], ['B'])).toBe(false)
  })

  it('creates deterministic JSONL and review fingerprints', () => {
    const records = [{ recordId: 'sr_b', value: 2 }, { recordId: 'sr_a', value: 1 }]
    expect(canonicalJsonl(records)).toBe('{"recordId":"sr_a","value":1}\n{"recordId":"sr_b","value":2}\n')
    expect(canonicalJsonl([])).toBe('')
    expect(reviewFingerprint({ verdict: 'ACCEPTED' })).toBe(reviewFingerprint({ verdict: 'ACCEPTED' }))
  })

  it('preserves drafts by submission digest and detects unsaved review changes', () => {
    const first = putDraft({}, 'a'.repeat(64), { verdict: 'ACCEPTED' })
    const both = putDraft(first, 'b'.repeat(64), { verdict: 'CORRECTED' })
    expect(both['a'.repeat(64)]).toEqual({ verdict: 'ACCEPTED' })
    expect(both['b'.repeat(64)]).toEqual({ verdict: 'CORRECTED' })
    expect(hasUnsavedSubmissions(Object.keys(both), both, {})).toBe(true)
    expect(hasUnsavedSubmissions(Object.keys(both), both, {
      ['a'.repeat(64)]: reviewFingerprint(both['a'.repeat(64)]),
      ['b'.repeat(64)]: reviewFingerprint(both['b'.repeat(64)]),
    })).toBe(false)
  })

  it('deduplicates saved records by derived record id', () => {
    expect(upsertRecord(
      [{ recordId: 'sr_a', value: 'old' }, { recordId: 'sr_b', value: 'other' }],
      { recordId: 'sr_a', value: 'new' },
    )).toEqual([{ recordId: 'sr_a', value: 'new' }, { recordId: 'sr_b', value: 'other' }])
  })
})
