// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  REQUIRED_REAL_HOST_VIDEO_LABEL,
  validateHandoffEvaluationJsonl,
  validateMediaProbe,
} from './release-verification-lib.js'
import { evaluatedRecord, jsonl, material } from './evaluation-record-fixtures.js'

describe('U2 release evidence verification', () => {
  it('requires a dual-host context and a corrected/not-scorable custom context', () => {
    const builtIn = material('FHIR_JSON', '1')
    const custom = material('FHIR_XML', '3')
    const records = [
      evaluatedRecord(builtIn, 'CODEX'),
      evaluatedRecord(builtIn, 'CLAUDE_DESKTOP'),
      evaluatedRecord(custom, 'CODEX', true),
    ]
    expect(validateHandoffEvaluationJsonl(jsonl(records))).toHaveLength(3)
    expect(() => validateHandoffEvaluationJsonl(jsonl(records.slice(0, 2)))).toThrow('HANDOFF_REQUIRED_CONTEXTS_MISSING')
    expect(() => validateHandoffEvaluationJsonl(jsonl([
      evaluatedRecord(builtIn, 'CODEX'),
      evaluatedRecord(custom, 'CODEX'),
      evaluatedRecord(material('FHIR_JSON', '5'), 'CLAUDE_DESKTOP', true),
    ]))).toThrow('HANDOFF_DUAL_HOST_CONTEXT_MISSING')
    expect(() => validateHandoffEvaluationJsonl(jsonl([
      evaluatedRecord(builtIn, 'CODEX'),
      evaluatedRecord(builtIn, 'CLAUDE_DESKTOP'),
      evaluatedRecord(custom, 'CODEX'),
    ]))).toThrow('HANDOFF_CUSTOM_REVIEW_EVIDENCE_MISSING')
    expect(() => validateHandoffEvaluationJsonl(jsonl(records).split('\n').filter(Boolean).reverse().join('\n') + '\n'))
      .toThrow('HANDOFF_EVALUATION_ORDER_OR_DUPLICATE_INVALID')
  })

  it('requires 60-90 second, silent, labelled video metadata', () => {
    const valid = {
      format: { duration: '75.0', tags: { comment: REQUIRED_REAL_HOST_VIDEO_LABEL } },
      streams: [{ codec_type: 'video' }],
    }
    expect(validateMediaProbe(valid)).toBe(75)
    expect(() => validateMediaProbe({ ...valid, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }))
      .toThrow('RELEASE_MEDIA_AUDIO_PROHIBITED')
    expect(() => validateMediaProbe({ ...valid, format: { duration: '75.0', tags: {} } }))
      .toThrow('RELEASE_MEDIA_LABEL_METADATA_MISSING')
    expect(() => validateMediaProbe({ ...valid, format: { ...valid.format, duration: '59.9' } }))
      .toThrow('RELEASE_MEDIA_DURATION_INVALID')
  })
})
