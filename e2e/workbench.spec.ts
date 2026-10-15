// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { canonicalJson, type ApprovedCaseMaterial, type HostEvaluationCase, type HostKind } from '../packages/contracts/src/index.js'

interface Rendezvous { token: string; baseUrl: string }

async function rendezvous(): Promise<Rendezvous> {
  const path = process.env.IMONFHIR_LAB_RENDEZVOUS ?? join(homedir(), '.imonfhir-payload-intelligence', 'lab.json')
  return JSON.parse(await readFile(path, 'utf8')) as Rendezvous
}

function hypothesisSubmission(evaluationCase: HostEvaluationCase, host: HostKind) {
  const evidenceRef = (evaluationCase.structuralSummary.evidenceItems.find((item) => item.kind === 'FORMAT') ?? evaluationCase.structuralSummary.evidenceItems[0])!.ref
  const scalar = <T extends string>(value: T) => ({ value, evidenceRefs: [evidenceRef], conflictCodes: [] })
  const actors = (values: string[]) => ({ values: [...values].sort(), evidenceRefs: [evidenceRef], conflictCodes: [] })
  return {
    schemaVersion: 'imonfhir.host-hypothesis-submission.v2',
    taxonomyVersion: evaluationCase.taxonomyVersion,
    contractDigests: evaluationCase.contractDigests,
    caseHandle: evaluationCase.caseHandle,
    caseDigest: evaluationCase.caseDigest,
    hypotheses: {
      standardVersion: scalar('FHIR_R4'),
      businessWorkflow: scalar(host === 'CODEX' ? 'PRIOR_AUTHORIZATION' : 'CARE_COORDINATION'),
      exchangePattern: scalar('SINGLE_RESOURCE'),
      interactionKind: scalar('REQUEST'),
      sourceActorRoles: actors(['PROVIDER_OR_CARE_TEAM']),
      destinationActorRoles: actors(['PAYER_OR_HEALTH_PLAN']),
      destinationClass: scalar('PAYER_SYSTEM'),
    },
    missingContextQuestionCodes: [],
    proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
  }
}

async function submit(
  request: APIRequestContext,
  connection: Rendezvous,
  evaluationCase: HostEvaluationCase,
  host: HostKind,
) {
  return request.post(`${connection.baseUrl}/internal/cases/${evaluationCase.caseHandle}/submissions?host=${host}&probe=0`, {
    headers: { authorization: `Bearer ${connection.token}` },
    data: hypothesisSubmission(evaluationCase, host),
  })
}

function axis(page: Page, label: string) {
  return page.locator('.axis-card').filter({ hasText: label })
}

async function accept(page: Page, label: string): Promise<void> {
  await axis(page, label).getByRole('button', { name: 'Accept', exact: true }).click()
}

async function acceptAllExcept(page: Page, excluded: readonly string[]): Promise<void> {
  for (const label of [
    'Standard / version', 'Business workflow', 'Exchange pattern', 'Interaction kind',
    'Source actor roles', 'Destination actor roles', 'Destination class',
    'Missing-context questions', 'Next actions',
  ]) if (!excluded.includes(label)) await accept(page, label)
}

test('dual-host v2 review preserves drafts, saves both records, warns before destructive purge, and exports deterministically', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByText('Local coordinator ready')).toBeVisible()
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  await expect(page.getByRole('heading', { name: 'FHIR_JSON' })).toBeVisible()
  await expect(page.getByText('synthetic-member')).toHaveCount(0)

  const projectionText = (await page.getByTestId('approved-case-projection').textContent())!
  const approvedProjection = JSON.parse(projectionText) as ApprovedCaseMaterial
  expect(projectionText).toBe(canonicalJson(approvedProjection))
  expect(projectionText).toContain('"structuralPath"')
  expect(projectionText).toContain('"countBand"')
  await expect(page.locator('details').filter({ hasText: 'Inspect structural evidence' })).toHaveAttribute('open', '')
  await expect(page.locator('.evidence-list')).toBeVisible()
  await expect(page.locator('.projection-details')).not.toHaveAttribute('open', '')

  await page.getByRole('button', { name: 'Approve summary for AI host' }).click()
  await expect(page.getByRole('heading', { name: 'Case is available' })).toBeVisible()
  const caseHandle = (await page.locator('code.handle').textContent())!
  await expect(page.getByLabel('Host instruction')).toHaveValue(new RegExp(caseHandle))
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('clipboard unavailable in test')) },
    })
  })
  await page.getByRole('button', { name: 'Copy host instruction' }).click()
  await expect(page.getByText('Clipboard unavailable. Select and copy the instruction shown below.')).toBeVisible()
  const connection = await rendezvous()
  const caseResponse = await request.get(`${connection.baseUrl}/internal/cases/${caseHandle}`, {
    headers: { authorization: `Bearer ${connection.token}` },
  })
  const evaluationCase = await caseResponse.json() as HostEvaluationCase
  expect(evaluationCase.schemaVersion).toBe('imonfhir.host-evaluation-case.v2')
  expect(approvedProjection).toEqual({
    schemaVersion: 'imonfhir.approved-case-material.v1',
    observation: evaluationCase.observation,
    structuralSummary: evaluationCase.structuralSummary,
  })

  const staleResponse = await request.post(`${connection.baseUrl}/internal/cases/${caseHandle}/submissions?host=CODEX&probe=0`, {
    headers: { authorization: `Bearer ${connection.token}` },
    data: { ...hypothesisSubmission(evaluationCase, 'CODEX'), caseDigest: 'c'.repeat(64) },
  })
  expect(staleResponse.status()).toBe(400)
  await expect(page.getByText('A stale submission was rejected. Ask the host to retrieve this case again.')).toBeVisible({ timeout: 3_000 })

  expect((await submit(request, connection, evaluationCase, 'CODEX')).status()).toBe(201)
  expect((await submit(request, connection, evaluationCase, 'CLAUDE_DESKTOP')).status()).toBe(201)
  for (const host of ['CODEX', 'CLAUDE_DESKTOP'] as const) {
    const response = await request.post(`${connection.baseUrl}/internal/host-activity?host=${host}&state=SUBMITTED&probe=0`, {
      headers: { authorization: `Bearer ${connection.token}` },
      data: '',
    })
    expect(response.ok()).toBe(true)
  }

  await expect(page.getByRole('heading', { name: 'Correct the host, not the payload' })).toBeVisible({ timeout: 3_000 })
  await expect(page.getByText('2 submissions received')).toBeVisible()
  await expect(page.getByText(/Codex-mode MCP activity this lab session · Submitted/)).toBeVisible()
  await expect(page.getByText(/Claude-mode MCP activity this lab session · Submitted/)).toBeVisible()
  await expect(axis(page, 'Standard / version').getByText('Observed format')).toBeVisible()

  const hostSelector = page.getByRole('combobox', { name: 'Host submission' })
  await axis(page, 'Standard / version').getByRole('button', { name: 'Accept', exact: true }).click()
  await hostSelector.selectOption({ index: 1 })
  await expect(axis(page, 'Business workflow')).toBeVisible()
  await axis(page, 'Business workflow').getByRole('button', { name: 'Not scorable' }).click()
  await hostSelector.selectOption({ index: 0 })
  await expect(axis(page, 'Standard / version').getByRole('button', { name: 'Accept', exact: true })).toHaveClass(/selected/)

  await axis(page, 'Business workflow').getByRole('button', { name: 'Change answer' }).click()
  await axis(page, 'Business workflow').locator('select').selectOption('CLINICAL_DOCUMENTATION')
  await axis(page, 'Interaction kind').getByRole('button', { name: 'Not scorable' }).click()
  await acceptAllExcept(page, ['Standard / version', 'Business workflow', 'Interaction kind'])
  const saveButton = page.getByRole('button', { name: 'Save this evaluation' })
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(page.getByText('Codex-mode evaluation saved. The case remains available for the other host.')).toBeVisible()

  await hostSelector.selectOption({ index: 1 })
  await expect(axis(page, 'Business workflow').getByRole('button', { name: 'Not scorable' })).toHaveClass(/selected/)
  await acceptAllExcept(page, ['Business workflow'])
  await saveButton.click()
  await expect(page.getByText('Claude-mode evaluation saved. The case remains available for the other host.')).toBeVisible()

  await axis(page, 'Exchange pattern').getByRole('button', { name: 'Not scorable' }).click()
  await expect(hostSelector.locator('option:checked')).toContainText('unsaved')
  let warned = false
  page.once('dialog', async (dialog) => {
    warned = true
    expect(dialog.message()).toContain('unsaved host submissions')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Finish and purge case' }).click()
  await expect.poll(() => warned).toBe(true)
  await expect(page.getByRole('heading', { name: 'Case is available' })).toBeVisible()
  await expect(axis(page, 'Business workflow').getByRole('button', { name: 'Not scorable' })).toHaveClass(/selected/)

  await saveButton.click()
  await expect(hostSelector.locator('option:checked')).toContainText('saved')
  await page.getByRole('button', { name: 'Finish and purge case' }).click()
  await expect(page.getByRole('heading', { name: '2 evaluations' })).toBeVisible()
  await expect(page.locator('.record-detail')).toHaveCount(2)
  await expect(page.getByText('Codex-mode', { exact: true })).toBeVisible()
  await expect(page.getByText('Claude-mode', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No pooled score' })).toBeVisible()

  const download = async () => {
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download canonical v2 JSONL' }).click()
    const artifact = await event
    return readFile((await artifact.path())!, 'utf8')
  }
  const firstBody = await download()
  const secondBody = await download()
  expect(secondBody).toBe(firstBody)
  expect(firstBody.endsWith('\n')).toBe(true)
  const exported = firstBody.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  expect(exported).toHaveLength(2)
  expect(exported.map((record) => record.hostKind).sort()).toEqual(['CLAUDE_DESKTOP', 'CODEX'])
  expect(firstBody).toContain('"schemaVersion":"imonfhir.sme-evaluation-record.v2"')
  expect(firstBody).toContain('"businessWorkflow":{"exactMatch":false,"expected":"CLINICAL_DOCUMENTATION","verdict":"CORRECTED"}')
  expect(firstBody).toContain('"interactionKind":{"exactMatch":null,"expected":null,"verdict":"NOT_SCORABLE"}')
  expect(firstBody).toContain('"missingContextQuestionCodes":{"exactMatch":true,"expected":[],"verdict":"ACCEPTED"}')
  expect(firstBody).toContain('"proposedNextActionCodes":{"exactMatch":true,"expected":["REVIEW_DETERMINISTIC_EVIDENCE"],"verdict":"ACCEPTED"}')
  for (const forbidden of [caseHandle, 'caseHandle', 'expiresAt', 'submissionId', 'synthetic-member', ['/', 'Users', '/'].join(''), 'file://']) {
    expect(firstBody).not.toContain(forbidden)
  }

  const afterPurge = await request.get(`${connection.baseUrl}/internal/cases/${caseHandle}`, {
    headers: { authorization: `Bearer ${connection.token}` },
  })
  expect(afterPurge.status()).toBe(400)
  expect(await afterPurge.json()).toEqual({ error: 'EXPIRED_CASE' })

  page.once('dialog', (dialog) => void dialog.dismiss())
  await page.getByRole('button', { name: 'Clear v2 sanitized records' }).click()
  await expect(page.getByRole('heading', { name: '2 evaluations' })).toBeVisible()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Clear v2 sanitized records' }).click()
  await expect(page.getByRole('heading', { name: '0 evaluations' })).toBeVisible()
})

test('labels simulated probe submissions and prevents them from becoming saved evidence', async ({ page, request }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  await page.getByRole('button', { name: 'Approve summary for AI host' }).click()
  const caseHandle = (await page.locator('code.handle').textContent())!
  const connection = await rendezvous()
  const evaluationCase = await request.get(`${connection.baseUrl}/internal/cases/${caseHandle}`, {
    headers: { authorization: `Bearer ${connection.token}` },
  }).then((response) => response.json()) as HostEvaluationCase

  const response = await request.post(
    `${connection.baseUrl}/internal/cases/${caseHandle}/submissions?host=CODEX&probe=1`,
    {
      headers: { authorization: `Bearer ${connection.token}` },
      data: hypothesisSubmission(evaluationCase, 'CODEX'),
    },
  )
  expect(response.status()).toBe(201)
  const first = hypothesisSubmission(evaluationCase, 'CODEX')
  const second = {
    ...first,
    hypotheses: {
      ...first.hypotheses,
      businessWorkflow: { ...first.hypotheses.businessWorkflow, value: 'CARE_COORDINATION' as const },
    },
  }
  expect((await request.post(
    `${connection.baseUrl}/internal/cases/${caseHandle}/submissions?host=CODEX&probe=1`,
    { headers: { authorization: `Bearer ${connection.token}` }, data: second },
  )).status()).toBe(201)

  const selector = page.getByRole('combobox', { name: 'Host submission' })
  await expect(selector).toBeVisible({ timeout: 3_000 })
  await expect(selector.locator('option')).toHaveCount(2)
  await expect(selector.locator('option').nth(0)).toContainText('submission 1 · simulated probe')
  await expect(selector.locator('option').nth(1)).toContainText('submission 2 · simulated probe')
  await expect(page.getByText('This probe submission can be reviewed, switched, and purged')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save this evaluation' })).toBeDisabled()
  await expect(page.getByText('Simulated probe submissions cannot be saved or exported.')).toBeVisible()
  await expect(page.getByText('Lab-session mode activity only; identity is not authenticated. Current-case submissions are counted above.')).toBeVisible()

  const visible = await request.get(`${connection.baseUrl}/api/cases/${caseHandle}/submissions`)
  expect(await visible.json()).toMatchObject({ submissions: [
    { hostKind: 'CODEX', probe: true },
    { hostKind: 'CODEX', probe: true },
  ] })
  expect((await request.delete(`${connection.baseUrl}/api/cases/${caseHandle}`)).ok()).toBe(true)
})

test('preserves v1 IndexedDB rows in the legacy store and excludes them from v2 counts', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  const material = JSON.parse((await page.getByTestId('approved-case-projection').textContent())!) as ApprovedCaseMaterial
  const evidenceRef = material.structuralSummary.evidenceItems[0]!.ref
  const legacyRecord = {
    schemaVersion: 'imonfhir.sme-evaluation-record.v1', recordId: `sr_${'1'.repeat(32)}`,
    taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1', contextDigest: '2'.repeat(64), context: material, hostKind: 'CODEX',
    hypotheses: {
      standardVersion: { value: 'FHIR_R4', evidenceRefs: [evidenceRef], conflictCodes: [] },
      workflow: { value: 'PRIOR_AUTHORIZATION', evidenceRefs: [evidenceRef], conflictCodes: [] },
      direction: { value: 'REQUEST', evidenceRefs: [evidenceRef], conflictCodes: [] },
      actorRoles: { values: ['PROVIDER_OR_CARE_TEAM'], evidenceRefs: [evidenceRef], conflictCodes: [] },
      destinationClass: { value: 'PAYER_SYSTEM', evidenceRefs: [evidenceRef], conflictCodes: [] },
    },
    missingContextQuestionCodes: [], proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
    review: {
      standardVersion: { verdict: 'ACCEPTED', expected: 'FHIR_R4', exactMatch: true },
      workflow: { verdict: 'ACCEPTED', expected: 'PRIOR_AUTHORIZATION', exactMatch: true },
      direction: { verdict: 'ACCEPTED', expected: 'REQUEST', exactMatch: true },
      actorRoles: { verdict: 'ACCEPTED', expected: ['PROVIDER_OR_CARE_TEAM'], exactMatch: true },
      destinationClass: { verdict: 'ACCEPTED', expected: 'PAYER_SYSTEM', exactMatch: true },
    },
  }
  await page.evaluate(async (record) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('imonfhir-payload-intelligence-preview', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction('sanitized-evaluations', 'readwrite').objectStore('sanitized-evaluations').put(record)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    database.close()
  }, legacyRecord)
  await page.reload()
  await page.getByRole('button', { name: 'View results' }).click()
  await expect(page.getByRole('heading', { name: '0 evaluations' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1 preserved v1 record' })).toBeVisible()
  await expect(page.locator('.record-detail')).toHaveCount(0)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download legacy v1 JSONL' }).click()
  const artifact = await downloadEvent
  const body = await readFile((await artifact.path())!, 'utf8')
  expect(JSON.parse(body)).toEqual(legacyRecord)
  expect(body).not.toContain('imonfhir.sme-evaluation-record.v2')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Clear legacy v1 records' }).click()
  await expect(page.getByRole('heading', { name: '0 preserved v1 records' })).toBeVisible()
})

test('fails closed instead of displaying or exporting a malformed local record', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('imonfhir-payload-intelligence-preview', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction('sanitized-evaluations-v2', 'readwrite')
        .objectStore('sanitized-evaluations-v2')
        .put({ recordId: `sr_${'9'.repeat(32)}`, prompt: 'MALFORMED_LOCAL_VALUE_MUST_NOT_EXPORT' })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    database.close()
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('LOCAL_RECORD_STORE_UNAVAILABLE')
  await page.getByRole('button', { name: 'View results' }).click()
  await expect(page.getByRole('heading', { name: '0 evaluations' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download canonical v2 JSONL' })).toBeDisabled()
  await expect(page.getByText('MALFORMED_LOCAL_VALUE_MUST_NOT_EXPORT')).toHaveCount(0)
})

test('recording view carries the required label and hides transient identifiers and paths', async ({ page }) => {
  await page.goto('/?recording=1')
  await expect(page.getByText('REAL HOST MCP HANDOFF · SYNTHETIC ONLY · NOT A MODEL QUALITY TEST')).toBeVisible()
  await page.getByRole('button', { name: /FHIR JSON/ }).click()
  await expect(page.getByText('Detailed structural paths and evidence identifiers are hidden in recording view.')).toBeVisible()
  await expect(page.getByTestId('approved-case-projection')).toHaveCount(0)
  await expect(page.locator('.evidence-list')).toHaveCount(0)
  await page.getByRole('button', { name: 'Approve summary for AI host' }).click()
  await expect(page.getByText('Private case handle and host instruction hidden in recording view.')).toBeVisible()
  await expect(page.locator('code.handle')).toHaveCount(0)
  await expect(page.getByLabel('Host instruction')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy host instruction' })).toHaveCount(0)
  expect(await page.locator('body').innerText()).not.toMatch(/\b(?:ec|hs|sr)_[a-f0-9]{16,64}\b/i)
  const controlValues = await page.locator('input, textarea, select').evaluateAll((elements) => elements
    .map((element) => (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value))
  expect(controlValues.join('\n')).not.toMatch(/\b(?:ec|hs|sr)_[a-f0-9]{16,64}\b/i)
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
      constructor(scriptURL: string | URL, options?: WorkerOptions) { super(scriptURL, options); stats.constructed += 1 }
      override terminate(): void { stats.terminated += 1; super.terminate() }
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
    name: 'synthetic-delimited.txt', mimeType: 'text/plain', buffer: Buffer.from('AAA*1*2~BBB*3*4~CCC*5*6~'),
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
