// SPDX-License-Identifier: Apache-2.0

import { canonicalDigest, canonicalJson, type EvidenceItem } from '@imonfhir/payload-contracts'

export type PublicErrorCode =
  | 'PAYLOAD_SIZE_LIMIT_EXCEEDED'
  | 'SAMPLE_UNAVAILABLE'
  | 'INSPECTION_TIMEOUT'
  | 'INSPECTION_FAILED'
  | 'EXPIRED_CASE'
  | 'EVALUATION_BLOCKED'
  | 'STALE_CASE'
  | 'INVALID_HYPOTHESES'
  | 'INVALID_EVIDENCE_REFERENCE'
  | 'CONTRACT_VERSION_MISMATCH'
  | 'SUBMISSION_LIMIT_REACHED'
  | 'STORE_UNAVAILABLE'
  | 'LOCAL_RECORD_STORE_UNAVAILABLE'

export interface RecoveryMessage {
  code: PublicErrorCode | 'LOCAL_RESTART_REQUIRED'
  message: string
}

const ERROR_RECOVERY: Record<PublicErrorCode, string> = {
  PAYLOAD_SIZE_LIMIT_EXCEEDED: 'Choose a synthetic file smaller than 8 MB.',
  SAMPLE_UNAVAILABLE: 'Reload the workbench and try the built-in sample again.',
  INSPECTION_TIMEOUT: 'Try a smaller synthetic fixture or a built-in sample.',
  INSPECTION_FAILED: 'Check that the fixture is well formed, then try a built-in sample.',
  EXPIRED_CASE: 'Inspect and approve the synthetic case again to create a fresh case.',
  EVALUATION_BLOCKED: 'This case cannot be exposed to an AI host. Choose a supported synthetic case.',
  STALE_CASE: 'Ask the host to retrieve the current case again before resubmitting.',
  INVALID_HYPOTHESES: 'Ask the host to retrieve the v2 case and submit only the required controlled codes.',
  INVALID_EVIDENCE_REFERENCE: 'Ask the host to retrieve the case again and use only evidence references it contains.',
  CONTRACT_VERSION_MISMATCH: 'Rebuild and restart the local lab, then inspect and approve a new case.',
  SUBMISSION_LIMIT_REACHED: 'Finish reviewing this case, purge it, and start a new case.',
  STORE_UNAVAILABLE: 'Restart the local lab and retry this synthetic case.',
  LOCAL_RECORD_STORE_UNAVAILABLE: 'Check browser storage availability, then reload the local workbench.',
}

export function recoveryFor(error: unknown): RecoveryMessage {
  const candidate = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  if (Object.hasOwn(ERROR_RECOVERY, candidate)) {
    const code = candidate as PublicErrorCode
    return { code, message: ERROR_RECOVERY[code] }
  }
  return { code: 'LOCAL_RESTART_REQUIRED', message: 'Restart the local lab and retry this synthetic case.' }
}

export function plainLabel(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((part) => part === 'fhir' || part === 'hl7' || part === 'cda' ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function evidenceLabel(item: EvidenceItem): string {
  switch (item.kind) {
    case 'FORMAT': return `Observed format · ${plainLabel(item.code)}`
    case 'DETECTOR': return `Detector signal · ${plainLabel(item.code)}`
    case 'SHAPE': return `Shape coverage · ${plainLabel(item.code)}`
    case 'AGGREGATE': return `${plainLabel(item.code)} · ${plainLabel(item.countBand)}`
    case 'FEATURE': {
      const details = [plainLabel(item.feature.kind), plainLabel(item.feature.name)]
      if (item.feature.structuralPath) details.push(item.feature.structuralPath)
      if (item.feature.dataType) details.push(plainLabel(item.feature.dataType))
      if (item.feature.countBand) details.push(plainLabel(item.feature.countBand))
      return details.join(' · ')
    }
  }
}

export function sameSet<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return [...left].sort().join('|') === [...right].sort().join('|')
}

export function canonicalJsonl<T extends { recordId: string }>(records: readonly T[]): string {
  if (records.length === 0) return ''
  return records.slice().sort((a, b) => a.recordId.localeCompare(b.recordId)).map(canonicalJson).join('\n') + '\n'
}

export function reviewFingerprint(review: unknown): string {
  return canonicalDigest(review)
}

export function putDraft<T>(drafts: Readonly<Record<string, T>>, submissionDigest: string, review: T): Record<string, T> {
  return { ...drafts, [submissionDigest]: review }
}

export function hasUnsavedSubmissions<T>(
  submissionDigests: readonly string[],
  drafts: Readonly<Record<string, T>>,
  savedFingerprints: Readonly<Record<string, string>>,
): boolean {
  return submissionDigests.some((submissionDigest) => {
    const draft = drafts[submissionDigest]
    return draft === undefined || savedFingerprints[submissionDigest] !== reviewFingerprint(draft)
  })
}

export function upsertRecord<T extends { recordId: string }>(records: readonly T[], record: T): T[] {
  return [...records.filter((candidate) => candidate.recordId !== record.recordId), record]
    .sort((a, b) => a.recordId.localeCompare(b.recordId))
}
