// SPDX-License-Identifier: Apache-2.0

import type { HostEvaluationCase, HostHypothesisReceipt, HostHypothesisSubmission, HostKind } from '@imonfhir/payload-contracts'
import { readRendezvous, type Rendezvous } from './rendezvous.js'

export class CoordinatorClient {
  constructor(
    private readonly hostKind: HostKind,
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

  async getCase(caseHandle: string): Promise<HostEvaluationCase> {
    return await this.request(`/internal/cases/${encodeURIComponent(caseHandle)}`) as HostEvaluationCase
  }

  async submit(submission: HostHypothesisSubmission): Promise<HostHypothesisReceipt> {
    return await this.request(
      `/internal/cases/${encodeURIComponent(submission.caseHandle)}/submissions?host=${this.hostKind}`,
      { method: 'POST', body: JSON.stringify(submission) },
    ) as HostHypothesisReceipt
  }
}
