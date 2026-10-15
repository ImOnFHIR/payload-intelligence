// SPDX-License-Identifier: Apache-2.0

import {
  assertCurrentContractDigests,
  hostHypothesisReceiptSchema,
  parseHostEvaluationCase,
  type HostEvaluationCase,
  type HostHypothesisReceipt,
  type HostHypothesisSubmission,
  type HostKind,
} from '@imonfhir/payload-contracts'
import { readRendezvous, type Rendezvous } from './rendezvous.js'

export type HostActivityState = 'CAPABILITIES_CALLED' | 'CASE_RETRIEVED' | 'SUBMITTED'

export class CoordinatorClient {
  constructor(
    private readonly hostKind: HostKind,
    private readonly probe = false,
    private readonly resolveRendezvous: () => Promise<Rendezvous> = () => readRendezvous(),
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const rendezvous = await this.resolveRendezvous()
    const response = await fetch(`${rendezvous.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${rendezvous.token}`,
        'content-type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(5_000),
    })
    const body = await response.json().catch(() => ({ error: 'STORE_UNAVAILABLE' })) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? 'STORE_UNAVAILABLE')
    return body
  }

  async noteActivity(state: HostActivityState): Promise<void> {
    await this.request(
      `/internal/host-activity?host=${this.hostKind}&state=${state}&probe=${this.probe ? '1' : '0'}`,
      { method: 'POST', body: '' },
    )
  }

  async getCase(caseHandle: string): Promise<HostEvaluationCase> {
    const evaluationCase = parseHostEvaluationCase(
      await this.request(`/internal/cases/${encodeURIComponent(caseHandle)}`),
    )
    await this.noteActivity('CASE_RETRIEVED').catch(() => undefined)
    return evaluationCase
  }

  async submit(submission: HostHypothesisSubmission): Promise<HostHypothesisReceipt> {
    const receipt = hostHypothesisReceiptSchema.parse(await this.request(
      `/internal/cases/${encodeURIComponent(submission.caseHandle)}/submissions?host=${this.hostKind}&probe=${this.probe ? '1' : '0'}`,
      { method: 'POST', body: JSON.stringify(submission) },
    )) as HostHypothesisReceipt
    assertCurrentContractDigests(receipt.contractDigests)
    await this.noteActivity('SUBMITTED').catch(() => undefined)
    return receipt
  }
}
