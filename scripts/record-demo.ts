// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium, type Page } from 'playwright'
import {
  CONTRACT_DIGESTS_V2,
  type HostEvaluationCase,
  type HostHypothesisSubmission,
} from '@imonfhir/payload-contracts'

const execute = promisify(execFile)
const root = resolve('.')
const outputDirectory = resolve(process.env.IMONFHIR_DEMO_OUTPUT_DIR ?? 'docs/media')
const outputVideo = join(outputDirectory, 'synthetic-mcp-workbench-demo.mp4')
const outputReceipt = join(outputDirectory, 'synthetic-mcp-workbench-demo.sha256')
const forbiddenText = ['synthetic-member', ['/', 'Users', '/'].join(''), 'file://']

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('DEMO_PORT_UNAVAILABLE')
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  return address.port
}

async function waitForLab(baseUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${baseUrl}/api/status`)).ok) return
    } catch { /* keep polling */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('DEMO_LAB_START_TIMEOUT')
}

async function assertVisibleSurfaceSafe(page: Page, extra: string[] = []): Promise<void> {
  const visibleText = await page.locator('body').innerText()
  const visibleControlValues = await page.locator('input, textarea, select').evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && (element as HTMLElement).offsetParent !== null
    })
    .map((element) => (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)
    .join('\n'))
  const visibleSurface = `${visibleText}\n${visibleControlValues}`
  for (const value of [...forbiddenText, ...extra]) {
    if (value && visibleSurface.includes(value)) throw new Error('DEMO_VISIBLE_SURFACE_LEAK')
  }
  if (/\b(?:ec|hs|sr)_[a-f0-9]{16,64}\b/.test(visibleSurface)) throw new Error('DEMO_VISIBLE_OPAQUE_ID_LEAK')
}

async function installRecordingMask(page: Page): Promise<void> {
  await page.addStyleTag({ content: `
    .review-panel .section-heading select, .host-instruction { display: none !important; }
    #demo-disclosure {
      position: fixed; z-index: 99999; right: 18px; bottom: 18px;
      max-width: 360px; padding: 10px 14px; border-radius: 10px;
      background: #f4d35e; color: #12251f; font: 700 12px/1.35 system-ui;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); text-transform: uppercase;
      letter-spacing: .04em;
    }
  ` })
  await page.evaluate(`(() => {
    const disclosure = document.createElement('div');
    disclosure.id = 'demo-disclosure';
    disclosure.textContent = 'Automated MCP protocol demonstration · No model inference';
    document.body.append(disclosure);
    const mask = function () {
      document.querySelectorAll('code.handle').forEach(function (element) {
        if (element.textContent && element.textContent.startsWith('ec_')) element.textContent = 'EPHEMERAL CASE HANDLE WITHHELD';
      });
      document.querySelectorAll('.record-title code').forEach(function (element) {
        if (element.textContent && element.textContent.startsWith('sr_')) element.textContent = 'SANITIZED RECORD ID WITHHELD';
      });
      document.querySelectorAll('.record-group-heading code').forEach(function (element) {
        if (element.textContent !== 'SANITIZED CONTEXT DIGEST WITHHELD') {
          element.textContent = 'SANITIZED CONTEXT DIGEST WITHHELD';
        }
      });
    };
    mask();
    new MutationObserver(mask).observe(document.body, { childList: true, subtree: true, characterData: true });
  })()`)
}

async function main(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'imonfhir-demo-'))
  const videoDirectory = join(temporary, 'video')
  const rendezvousPath = join(temporary, 'lab.json')
  const temporaryMp4 = join(temporary, 'demo.mp4')
  await mkdir(videoDirectory)
  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  let lab: ChildProcess | undefined
  let transport: StdioClientTransport | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

  try {
    lab = spawn(resolve('node_modules/.bin/tsx'), ['scripts/lab.ts'], {
      cwd: root,
      env: { ...process.env, IMONFHIR_LAB_PORT: String(port), IMONFHIR_LAB_RENDEZVOUS: rendezvousPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await waitForLab(baseUrl)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } },
    })
    const page = await context.newPage()
    await page.goto(baseUrl)
    await installRecordingMask(page)
    await page.waitForTimeout(2_000)
    await page.getByRole('button', { name: /FHIR JSON/ }).click()
    await page.getByRole('heading', { name: 'FHIR_JSON' }).waitFor()
    await assertVisibleSurfaceSafe(page)
    await page.waitForTimeout(2_500)

    const created = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === `${baseUrl}/api/cases`)
    await page.getByRole('button', { name: 'Approve summary for AI host' }).click()
    const evaluationCase = await (await created).json() as HostEvaluationCase
    await assertVisibleSurfaceSafe(page, [evaluationCase.caseHandle])
    await page.waitForTimeout(2_000)

    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
    environment.IMONFHIR_LAB_RENDEZVOUS = rendezvousPath
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve('packages/mcp/dist/cli.js'), '--host=CODEX'],
      cwd: root,
      env: environment,
      stderr: 'pipe',
    })
    const client = new Client({ name: 'imonfhir-deterministic-demo-harness', version: '1.0.0' }, { capabilities: {} })
    await client.connect(transport)
    const fetched = await client.callTool({
      name: 'payload_get_evaluation_case',
      arguments: { caseHandle: evaluationCase.caseHandle },
    })
    if (fetched.isError || !fetched.structuredContent) throw new Error('DEMO_MCP_RETRIEVAL_FAILED')
    const approved = fetched.structuredContent as unknown as HostEvaluationCase
    const evidenceRef = approved.structuralSummary.evidenceItems[0]?.ref
    if (!evidenceRef) throw new Error('DEMO_MISSING_EVIDENCE')
    const submission: HostHypothesisSubmission = {
      schemaVersion: 'imonfhir.host-hypothesis-submission.v2',
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
      contractDigests: CONTRACT_DIGESTS_V2,
      caseHandle: approved.caseHandle,
      caseDigest: approved.caseDigest,
      hypotheses: {
        standardVersion: { value: 'FHIR_R4', evidenceRefs: [evidenceRef], conflictCodes: [] },
        businessWorkflow: { value: 'PRIOR_AUTHORIZATION', evidenceRefs: [evidenceRef], conflictCodes: [] },
        exchangePattern: { value: 'SINGLE_RESOURCE', evidenceRefs: [evidenceRef], conflictCodes: [] },
        interactionKind: { value: 'REQUEST', evidenceRefs: [evidenceRef], conflictCodes: [] },
        sourceActorRoles: { values: ['PROVIDER_OR_CARE_TEAM'], evidenceRefs: [evidenceRef], conflictCodes: [] },
        destinationActorRoles: { values: ['PAYER_OR_HEALTH_PLAN'], evidenceRefs: [evidenceRef], conflictCodes: [] },
        destinationClass: { value: 'PAYER_SYSTEM', evidenceRefs: [evidenceRef], conflictCodes: [] },
      },
      missingContextQuestionCodes: [],
      proposedNextActionCodes: ['REVIEW_DETERMINISTIC_EVIDENCE'],
    }
    const receipt = await client.callTool({ name: 'payload_submit_hypotheses', arguments: submission })
    if (receipt.isError) throw new Error('DEMO_MCP_SUBMISSION_FAILED')

    const reviewHeading = page.getByRole('heading', { name: 'Correct the host, not the payload' })
    await reviewHeading.waitFor({ timeout: 4_000 })
    await reviewHeading.scrollIntoViewIfNeeded()
    await assertVisibleSurfaceSafe(page, [evaluationCase.caseHandle])
    await page.waitForTimeout(2_500)
    const standardVersion = page.locator('.axis-card').filter({ hasText: 'Standard / version' })
    const workflow = page.locator('.axis-card').filter({ hasText: 'Business workflow' })
    const exchangePattern = page.locator('.axis-card').filter({ hasText: 'Exchange pattern' })
    const interactionKind = page.locator('.axis-card').filter({ hasText: 'Interaction kind' })
    const sourceActors = page.locator('.axis-card').filter({ hasText: 'Source actor roles' })
    const destinationActors = page.locator('.axis-card').filter({ hasText: 'Destination actor roles' })
    const destinationClass = page.locator('.axis-card').filter({ hasText: 'Destination class' })
    const questions = page.locator('.axis-card').filter({ hasText: 'Missing-context questions' })
    const actions = page.locator('.axis-card').filter({ hasText: 'Next actions' })
    await standardVersion.getByRole('button', { name: 'Accept' }).click()
    await workflow.scrollIntoViewIfNeeded()
    await workflow.getByRole('button', { name: 'Change answer' }).click()
    await workflow.locator('select').selectOption('CARE_COORDINATION')
    await exchangePattern.getByRole('button', { name: 'Accept' }).click()
    await interactionKind.getByRole('button', { name: 'Accept' }).click()
    await sourceActors.getByRole('button', { name: 'Accept' }).click()
    await destinationActors.getByRole('button', { name: 'Accept' }).click()
    await destinationClass.getByRole('button', { name: 'Accept' }).click()
    await questions.getByRole('button', { name: 'Accept' }).click()
    await actions.getByRole('button', { name: 'Accept' }).click()
    await page.waitForTimeout(1_800)
    const saveButton = page.getByRole('button', { name: 'Save this evaluation' })
    await saveButton.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1_000)
    await saveButton.click()
    await page.getByText('Codex-mode evaluation saved. The case remains available for the other host.').waitFor()
    await page.waitForFunction(() => {
      const labels = [...document.querySelectorAll('select[aria-label="Host submission"] option')]
        .map((option) => option.textContent?.trim() ?? '')
      return labels.length === 1 && labels.every((label) => label.endsWith('· saved'))
    })
    let stalePurgeWarning = false
    page.once('dialog', async (dialog) => {
      if (dialog.message() === 'This case has one or more unsaved host submissions. Finish and purge anyway?') {
        stalePurgeWarning = true
        await dialog.accept()
      } else await dialog.dismiss()
    })
    await page.getByRole('button', { name: 'Finish and purge case' }).click()
    await page.getByRole('heading', { name: '1 evaluation' }).waitFor()
    if (stalePurgeWarning) throw new Error('DEMO_STALE_PURGE_WARNING')
    await assertVisibleSurfaceSafe(page, [evaluationCase.caseHandle])
    await page.waitForTimeout(3_000)

    await transport.close()
    transport = undefined
    await context.close()
    await browser.close()
    browser = undefined

    const recordings = (await readdir(videoDirectory)).filter((name) => name.endsWith('.webm'))
    if (recordings.length !== 1) throw new Error('DEMO_RECORDING_COUNT_INVALID')
    const sourceVideo = join(videoDirectory, recordings[0]!)
    await execute('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourceVideo,
      '-map_metadata', '-1', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', temporaryMp4,
    ])
    const probe = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', temporaryMp4])
    const probeText = `${probe.stdout}${probe.stderr}`
    for (const value of [root, temporary, evaluationCase.caseHandle, ...forbiddenText]) {
      if (probeText.includes(value)) throw new Error('DEMO_METADATA_LEAK')
    }
    const video = await readFile(temporaryMp4)
    for (const value of [root, temporary, evaluationCase.caseHandle, ...forbiddenText]) {
      if (video.includes(Buffer.from(value))) throw new Error('DEMO_BINARY_TEXT_LEAK')
    }
    const digest = createHash('sha256').update(video).digest('hex')
    await mkdir(outputDirectory, { recursive: true })
    await copyFile(temporaryMp4, outputVideo)
    await writeFile(outputReceipt, `${digest}  synthetic-mcp-workbench-demo.mp4\n`)
    process.stdout.write(`PASS wrote ${outputVideo}\nPASS SHA-256 ${digest}\n`)
  } finally {
    await transport?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    lab?.kill('SIGTERM')
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
