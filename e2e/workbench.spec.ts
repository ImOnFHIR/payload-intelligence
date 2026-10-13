// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test('sample → approve → MCP submission → SME save → purge', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByText('Local coordinator ready')).toBeVisible()
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  await expect(page.getByRole('heading', { name: 'FHIR_JSON' })).toBeVisible()
  await expect(page.getByText('synthetic-member')).toHaveCount(0)

  await page.getByRole('button', { name: 'Approve summary for AI host' }).click()
  await expect(page.getByRole('heading', { name: 'Case is available' })).toBeVisible()
  const caseHandle = (await page.locator('code.handle').textContent())!

  const path = process.env.IMONFHIR_LAB_RENDEZVOUS ?? join(homedir(), '.imonfhir-payload-intelligence', 'lab.json')
  const rendezvous = JSON.parse(await readFile(path, 'utf8')) as { token: string; baseUrl: string }
  const caseResponse = await request.get(`${rendezvous.baseUrl}/internal/cases/${caseHandle}`, {
    headers: { authorization: `Bearer ${rendezvous.token}` },
  })
  const evaluationCase = await caseResponse.json() as {
    caseDigest: string
    structuralSummary: { evidenceItems: Array<{ ref: string }> }
  }
  const evidenceRef = evaluationCase.structuralSummary.evidenceItems[0]!.ref
  const submission = {
    caseHandle,
    caseDigest: evaluationCase.caseDigest,
    hypotheses: {
      standardVersion: { value: 'FHIR_R4', evidenceRefs: [evidenceRef], conflictCodes: [] },
      workflow: { value: 'PRIOR_AUTHORIZATION', evidenceRefs: [evidenceRef], conflictCodes: [] },
      direction: { value: 'REQUEST', evidenceRefs: [evidenceRef], conflictCodes: [] },
      actorRoles: { values: ['PAYER_OR_HEALTH_PLAN', 'PROVIDER_OR_CARE_TEAM'], evidenceRefs: [evidenceRef], conflictCodes: [] },
      destinationClass: { value: 'PAYER_SYSTEM', evidenceRefs: [evidenceRef], conflictCodes: [] },
    },
    missingContextQuestionCodes: [],
    proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
  }
  const staleResponse = await request.post(`${rendezvous.baseUrl}/internal/cases/${caseHandle}/submissions?host=CODEX`, {
    headers: { authorization: `Bearer ${rendezvous.token}` },
    data: { ...submission, caseDigest: 'c'.repeat(64) },
  })
  expect(staleResponse.status()).toBe(400)
  await expect(page.getByText('A stale submission was rejected. Ask the host to retrieve this case again.')).toBeVisible({ timeout: 3_000 })
  const submitResponse = await request.post(`${rendezvous.baseUrl}/internal/cases/${caseHandle}/submissions?host=CODEX`, {
    headers: { authorization: `Bearer ${rendezvous.token}` },
    data: submission,
  })
  expect(submitResponse.status()).toBe(201)

  await expect(page.getByRole('heading', { name: 'Correct the host, not the payload' })).toBeVisible({ timeout: 3_000 })
  const workflow = page.locator('.axis-card').filter({ hasText: 'Workflow' })
  await workflow.getByRole('button', { name: 'Correct' }).click()
  await workflow.locator('select').selectOption('RESOURCE_EXCHANGE')
  const direction = page.locator('.axis-card').filter({ hasText: 'Direction' })
  await direction.getByRole('button', { name: 'Not scorable' }).click()
  await page.getByRole('button', { name: 'Save evaluation & purge case' }).click()
  await expect(page.getByRole('heading', { name: '1 evaluation' })).toBeVisible()

  const firstDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download canonical JSONL' }).click()
  const firstDownload = await firstDownloadEvent
  const firstPath = await firstDownload.path()
  expect(firstPath).not.toBeNull()
  const firstBody = await readFile(firstPath!, 'utf8')
  const secondDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download canonical JSONL' }).click()
  const secondDownload = await secondDownloadEvent
  const secondPath = await secondDownload.path()
  expect(secondPath).not.toBeNull()
  const secondBody = await readFile(secondPath!, 'utf8')
  expect(secondBody).toBe(firstBody)
  expect(firstBody.endsWith('\n')).toBe(true)
  expect(firstBody.trim().split('\n')).toHaveLength(1)
  const exported = JSON.parse(firstBody) as { review: { workflow: { verdict: string; expected: string; exactMatch: boolean }; direction: { verdict: string; expected: null; exactMatch: null } } }
  expect(exported.review.workflow).toMatchObject({ verdict: 'CORRECTED', expected: 'RESOURCE_EXCHANGE', exactMatch: false })
  expect(exported.review.direction).toEqual({ verdict: 'NOT_SCORABLE', expected: null, exactMatch: null })
  for (const forbidden of [caseHandle, 'caseHandle', 'expiresAt', 'submissionId', 'synthetic-member', ['/', 'Users', '/'].join(''), 'file://']) {
    expect(firstBody).not.toContain(forbidden)
  }

  const afterPurge = await request.get(`${rendezvous.baseUrl}/internal/cases/${caseHandle}`, {
    headers: { authorization: `Bearer ${rendezvous.token}` },
  })
  expect(afterPurge.status()).toBe(400)
  expect(await afterPurge.json()).toEqual({ error: 'EXPIRED_CASE' })
})

test('custom payload requires a synthetic-data assertion', async ({ page }) => {
  await page.goto('/')
  const chooser = page.locator('input[type="file"]')
  await expect(chooser).toBeDisabled()
  await page.getByLabel('I confirm this is synthetic and contains no PHI or production data.').check()
  await expect(chooser).toBeEnabled()
  await chooser.setInputFiles(join(process.cwd(), 'examples/synthetic/ambiguous.json'))
  await expect(page.getByRole('heading', { name: 'GENERIC_JSON' })).toBeVisible()
  await expect(page.getByText('synthetic person')).toHaveCount(0)
})

test('uses a new one-operation Worker for every inspection', async ({ page }) => {
  await page.addInitScript(() => {
    const stats = { constructed: 0, terminated: 0 }
    const NativeWorker = window.Worker
    class TrackedWorker extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options)
        stats.constructed += 1
      }
      override terminate(): void {
        stats.terminated += 1
        super.terminate()
      }
    }
    Object.defineProperty(window, 'Worker', { configurable: true, value: TrackedWorker })
    Object.defineProperty(window, '__imonfhirWorkerStats', { configurable: true, value: stats })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  await expect(page.getByRole('heading', { name: 'FHIR_JSON' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __imonfhirWorkerStats: { constructed: number; terminated: number } }).__imonfhirWorkerStats)).toEqual({ constructed: 1, terminated: 1 })
  await page.getByRole('button', { name: '← Start' }).click()
  await page.getByRole('button', { name: /FHIR XML/ }).click()
  await expect(page.getByRole('heading', { name: 'FHIR_XML' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __imonfhirWorkerStats: { constructed: number; terminated: number } }).__imonfhirWorkerStats)).toEqual({ constructed: 2, terminated: 2 })
})

test('shows blocked and expired case states explicitly', async ({ page, request }) => {
  await page.goto('/')
  await page.getByLabel('I confirm this is synthetic and contains no PHI or production data.').check()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic-delimited.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('AAA*1*2~BBB*3*4~CCC*5*6~'),
  })
  await expect(page.getByText('Host exposure blocked')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve summary for AI host' })).toBeDisabled()

  await page.getByRole('button', { name: '← Start' }).click()
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  await page.getByRole('button', { name: 'Approve summary for AI host' }).click()
  const caseHandle = (await page.locator('code.handle').textContent())!
  expect((await request.delete(`/api/cases/${caseHandle}`)).ok()).toBe(true)
  await expect(page.getByRole('heading', { name: 'Case expired' })).toBeVisible({ timeout: 3_000 })
  await expect(page.getByText('The four-hour case window ended. Start a new inspection.')).toBeVisible()
})
