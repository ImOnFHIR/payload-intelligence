// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  canonicalDigest,
  canonicalJson,
  smeEvaluationRecordSchema,
  type ActorHypothesis,
  type ApprovedCaseMaterial,
  type AxisVerdict,
  type HostEvaluationCase,
  type HostHypothesisSubmission,
  type HostKind,
  type ScalarHypothesis,
  type SmeEvaluationRecord,
} from '@imonfhir/payload-contracts'
import {
  ACTOR_ROLES,
  DESTINATION_CLASSES,
  DIRECTIONS,
  STANDARD_VERSIONS,
  WORKFLOWS,
  type ActorRole,
  type DestinationClass,
  type Direction,
  type StandardVersion,
  type Workflow,
} from '@imonfhir/payload-core'
import { clearRecords, listRecords, saveRecord } from './db.js'

type Screen = 'START' | 'EVALUATE' | 'RESULTS'
type HostRoundtripState = 'WAITING' | 'RECEIVED' | 'STALE' | 'EXPIRED'

interface SubmissionEnvelope {
  hostKind: HostKind
  submission: HostHypothesisSubmission
  receipt: { submissionId: string; submissionDigest: string }
}

interface ScalarReview<T extends string> { verdict: AxisVerdict; expected: T }
interface ReviewState {
  standardVersion: ScalarReview<StandardVersion>
  workflow: ScalarReview<Workflow>
  direction: ScalarReview<Direction>
  actorRoles: { verdict: AxisVerdict; expected: ActorRole[] }
  destinationClass: ScalarReview<DestinationClass>
}

const samples = [
  { id: 'fhir-json', title: 'FHIR JSON', detail: 'Synthetic prior-authorization-shaped Claim', url: '/fhir-claim.json', fileName: 'fhir-claim.json', contentType: 'application/fhir+json' },
  { id: 'fhir-xml', title: 'FHIR XML', detail: 'Synthetic collection Bundle', url: '/fhir-bundle.xml', fileName: 'fhir-bundle.xml', contentType: 'application/fhir+xml' },
  { id: 'fhir-ndjson', title: 'FHIR NDJSON', detail: 'Two synthetic resources', url: '/fhir.ndjson', fileName: 'fhir.ndjson', contentType: 'application/fhir+ndjson' },
  { id: 'hl7-v2', title: 'HL7 v2', detail: 'Synthetic ORU envelope', url: '/hl7-v2.er7', fileName: 'hl7-v2.er7', contentType: 'application/hl7-v2' },
  { id: 'cda', title: 'CDA', detail: 'Synthetic ClinicalDocument', url: '/cda.xml', fileName: 'cda.xml', contentType: 'application/xml' },
  { id: 'ambiguous', title: 'Ambiguous JSON', detail: 'Clinical-looking, but no standard marker', url: '/ambiguous.json', fileName: 'ambiguous.json', contentType: 'application/json' },
] as const

function runInspection(message: unknown): Promise<ApprovedCaseMaterial> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./inspector.worker.ts', import.meta.url), { type: 'module' })
    const timeout = window.setTimeout(() => {
      worker.terminate()
      reject(new Error('INSPECTION_TIMEOUT'))
    }, 5_000)
    worker.onmessage = (event: MessageEvent<{ ok: boolean; material?: ApprovedCaseMaterial; error?: string }>) => {
      window.clearTimeout(timeout)
      worker.terminate()
      if (event.data.ok && event.data.material) resolve(event.data.material)
      else reject(new Error(event.data.error ?? 'INSPECTION_FAILED'))
    }
    worker.onerror = () => {
      window.clearTimeout(timeout)
      worker.terminate()
      reject(new Error('INSPECTION_FAILED'))
    }
    worker.postMessage(message)
  })
}

function initialReview(submission: HostHypothesisSubmission): ReviewState {
  return {
    standardVersion: { verdict: 'ACCEPTED', expected: submission.hypotheses.standardVersion.value },
    workflow: { verdict: 'ACCEPTED', expected: submission.hypotheses.workflow.value },
    direction: { verdict: 'ACCEPTED', expected: submission.hypotheses.direction.value },
    actorRoles: { verdict: 'ACCEPTED', expected: [...submission.hypotheses.actorRoles.values] },
    destinationClass: { verdict: 'ACCEPTED', expected: submission.hypotheses.destinationClass.value },
  }
}

function exactScalar<T extends string>(review: ScalarReview<T>, actual: T): boolean | null {
  return review.verdict === 'NOT_SCORABLE' ? null : review.expected === actual
}

function equalActors(left: ActorRole[], right: ActorRole[]): boolean {
  return [...left].sort().join('|') === [...right].sort().join('|')
}

function downloadJsonl(records: SmeEvaluationRecord[]): void {
  const body = records.slice().sort((a, b) => a.recordId.localeCompare(b.recordId)).map(canonicalJson).join('\n') + '\n'
  const url = URL.createObjectURL(new Blob([body], { type: 'application/x-ndjson' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'imonfhir-sme-evaluations.jsonl'
  link.click()
  URL.revokeObjectURL(url)
}

async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

function HostSetupCard({ title, command }: { title: string; command: string }) {
  return <article className="setup-card">
    <div><span className="eyebrow">MCP host</span><h3>{title}</h3></div>
    <code>{command}</code>
    <button className="quiet" onClick={() => void copy(command)}>Copy setup command</button>
  </article>
}

function VerdictButtons({ value, onChange }: { value: AxisVerdict; onChange: (value: AxisVerdict) => void }) {
  return <div className="segmented" role="group" aria-label="SME verdict">
    {(['ACCEPTED', 'CORRECTED', 'NOT_SCORABLE'] as const).map((option) =>
      <button key={option} className={value === option ? 'selected' : ''} onClick={() => onChange(option)}>
        {option === 'NOT_SCORABLE' ? 'Not scorable' : option === 'CORRECTED' ? 'Correct' : 'Accept'}
      </button>,
    )}
  </div>
}

function ScalarAxis<T extends string>({
  label,
  hypothesis,
  options,
  review,
  onChange,
}: {
  label: string
  hypothesis: ScalarHypothesis<T>
  options: readonly T[]
  review: ScalarReview<T>
  onChange: (review: ScalarReview<T>) => void
}) {
  return <section className="axis-card">
    <div className="axis-heading"><div><span>{label}</span><strong>{hypothesis.value}</strong></div><VerdictButtons value={review.verdict} onChange={(verdict) => onChange({ ...review, verdict })} /></div>
    <div className="evidence-line">Evidence: {hypothesis.evidenceRefs.join(', ')}{hypothesis.conflictCodes.length ? ` · Conflicts: ${hypothesis.conflictCodes.join(', ')}` : ''}</div>
    {review.verdict === 'CORRECTED' && <label className="field">Expected value<select value={review.expected} onChange={(event) => onChange({ ...review, expected: event.target.value as T })}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>}
  </section>
}

function ActorAxis({ hypothesis, review, onChange }: { hypothesis: ActorHypothesis; review: ReviewState['actorRoles']; onChange: (review: ReviewState['actorRoles']) => void }) {
  return <section className="axis-card">
    <div className="axis-heading"><div><span>Actor roles</span><strong>{hypothesis.values.join(' + ')}</strong></div><VerdictButtons value={review.verdict} onChange={(verdict) => onChange({ ...review, verdict })} /></div>
    <div className="evidence-line">Evidence: {hypothesis.evidenceRefs.join(', ')}{hypothesis.conflictCodes.length ? ` · Conflicts: ${hypothesis.conflictCodes.join(', ')}` : ''}</div>
    {review.verdict === 'CORRECTED' && <div className="actor-grid">{ACTOR_ROLES.map((role) => <label key={role}><input type="checkbox" checked={review.expected.includes(role)} onChange={(event) => {
      const next = event.target.checked ? [...review.expected.filter((item) => item !== 'UNKNOWN'), role] : review.expected.filter((item) => item !== role)
      onChange({ ...review, expected: role === 'UNKNOWN' && event.target.checked ? ['UNKNOWN'] : [...new Set(next)].sort() as ActorRole[] })
    }} />{role}</label>)}</div>}
  </section>
}

export function App() {
  const [screen, setScreen] = useState<Screen>('START')
  const [ready, setReady] = useState(false)
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false)
  const [material, setMaterial] = useState<ApprovedCaseMaterial | null>(null)
  const [evaluationCase, setEvaluationCase] = useState<HostEvaluationCase | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionEnvelope[]>([])
  const [hostRoundtripState, setHostRoundtripState] = useState<HostRoundtripState>('WAITING')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [records, setRecords] = useState<SmeEvaluationRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = submissions[selectedIndex]

  const refreshRecords = useCallback(async () => setRecords(await listRecords()), [])
  useEffect(() => {
    void fetch('/api/status').then((response) => response.ok).then(setReady).catch(() => setReady(false))
    void refreshRecords()
  }, [refreshRecords])

  useEffect(() => {
    if (!evaluationCase) return
    const poll = async () => {
      const response = await fetch(`/api/cases/${evaluationCase.caseHandle}/submissions`, { cache: 'no-store' })
      const body = await response.json() as { state?: HostRoundtripState; submissions?: SubmissionEnvelope[]; error?: string }
      if (!response.ok) {
        if (body.error === 'EXPIRED_CASE') setHostRoundtripState('EXPIRED')
        return
      }
      setHostRoundtripState(body.state ?? 'WAITING')
      if (!body.submissions) return
      setSubmissions(body.submissions)
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => window.clearInterval(timer)
  }, [evaluationCase])

  useEffect(() => {
    if (selected) setReview(initialReview(selected.submission))
  }, [selected?.receipt.submissionId])

  const begin = async (request: unknown) => {
    setBusy(true); setError(null); setEvaluationCase(null); setSubmissions([]); setReview(null); setHostRoundtripState('WAITING')
    try {
      setMaterial(await runInspection(request))
      setScreen('EVALUATE')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'INSPECTION_FAILED')
    } finally { setBusy(false) }
  }

  const approve = async () => {
    if (!material) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(material) })
      const body = await response.json() as HostEvaluationCase & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'STORE_UNAVAILABLE')
      setEvaluationCase(body)
      setHostRoundtripState('WAITING')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'STORE_UNAVAILABLE') }
    finally { setBusy(false) }
  }

  const purge = async () => {
    if (evaluationCase) await fetch(`/api/cases/${evaluationCase.caseHandle}`, { method: 'DELETE' })
    setMaterial(null); setEvaluationCase(null); setSubmissions([]); setReview(null); setHostRoundtripState('WAITING'); setScreen('START')
  }

  const save = async () => {
    if (!material || !evaluationCase || !selected || !review) return
    if (review.actorRoles.verdict === 'CORRECTED' && review.actorRoles.expected.length === 0) {
      setError('SELECT_AT_LEAST_ONE_ACTOR_ROLE'); return
    }
    const submission = selected.submission
    const recordBase = {
      schemaVersion: 'imonfhir.sme-evaluation-record.v1' as const,
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v1' as const,
      contextDigest: evaluationCase.caseDigest,
      context: material,
      hostKind: selected.hostKind,
      hypotheses: submission.hypotheses,
      missingContextQuestionCodes: submission.missingContextQuestionCodes,
      proposedNextActionCodes: submission.proposedNextActionCodes,
      review: {
        standardVersion: { ...review.standardVersion, expected: review.standardVersion.verdict === 'NOT_SCORABLE' ? null : review.standardVersion.expected, exactMatch: exactScalar(review.standardVersion, submission.hypotheses.standardVersion.value) },
        workflow: { ...review.workflow, expected: review.workflow.verdict === 'NOT_SCORABLE' ? null : review.workflow.expected, exactMatch: exactScalar(review.workflow, submission.hypotheses.workflow.value) },
        direction: { ...review.direction, expected: review.direction.verdict === 'NOT_SCORABLE' ? null : review.direction.expected, exactMatch: exactScalar(review.direction, submission.hypotheses.direction.value) },
        actorRoles: { ...review.actorRoles, expected: review.actorRoles.verdict === 'NOT_SCORABLE' ? null : review.actorRoles.expected, exactMatch: review.actorRoles.verdict === 'NOT_SCORABLE' ? null : equalActors(review.actorRoles.expected, submission.hypotheses.actorRoles.values) },
        destinationClass: { ...review.destinationClass, expected: review.destinationClass.verdict === 'NOT_SCORABLE' ? null : review.destinationClass.expected, exactMatch: exactScalar(review.destinationClass, submission.hypotheses.destinationClass.value) },
      },
    }
    const record: SmeEvaluationRecord = { ...recordBase, recordId: `sr_${canonicalDigest(recordBase).slice(0, 32)}` }
    smeEvaluationRecordSchema.parse(record)
    await saveRecord(record)
    await refreshRecords()
    await purge()
    setScreen('RESULTS')
  }

  const hostPrompt = evaluationCase ? `Use the ImOnFHIR Payload Intelligence MCP. Call payload_get_evaluation_case with caseHandle ${evaluationCase.caseHandle}. Use only its approved structural summary. Submit every required closed-code hypothesis with payload_submit_hypotheses. Do not ask for or infer raw payload values.` : ''
  const blocked = material ? ['RESTRICTED_EDI_UNSUPPORTED', 'PDF', 'DICOM', 'ARCHIVE', 'UNKNOWN_BINARY'].includes(material.structuralSummary.format) || ['REJECTED', 'OPAQUE'].includes(material.observation.status) : false
  const matchSummary = useMemo(() => {
    const values = records.flatMap((record) => Object.values(record.review).map((axis) => axis.exactMatch)).filter((value): value is boolean => value !== null)
    return { correct: values.filter(Boolean).length, scored: values.length }
  }, [records])

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark">IF</div><div><strong>Payload Intelligence</strong><span>Evaluation workbench</span></div><span className="preview-badge">EXPERIMENTAL PREVIEW</span></header>
    <main>
      <div className="nonclaim"><strong>Synthetic data only.</strong> Not a validator, trained healthcare model, calibrated classifier, or clinical/payer decision system.</div>
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}

      {screen === 'START' && <>
        <section className="hero"><div><span className="eyebrow">Local, bounded, correctable</span><h1>Inspect the shape.<br />Evaluate the hypothesis.</h1><p>Raw bytes stay in a one-use browser Worker. You approve the structural summary before Codex or Claude can read it.</p></div><div className="readiness"><span className={ready ? 'ready-dot' : 'offline-dot'} />{ready ? 'Local coordinator ready' : 'Coordinator unavailable'}</div></section>
        <section><div className="section-heading"><div><span className="eyebrow">Start with evidence</span><h2>Choose a synthetic case</h2></div><span>{records.length} saved evaluation{records.length === 1 ? '' : 's'}</span></div><div className="sample-grid">{samples.map((sample, index) => <button className="sample-card" key={sample.id} disabled={busy} onClick={() => void begin({ kind: 'sample', url: sample.url, fileName: sample.fileName, contentType: sample.contentType })}><span className="sample-number">0{index + 1}</span><strong>{sample.title}</strong><span>{sample.detail}</span><b>Inspect →</b></button>)}</div></section>
        <section className="upload-panel"><div><span className="eyebrow">Your fixture</span><h2>Use a synthetic payload</h2><p>Any bounded file can be inspected. Unsupported or unsafe shapes stop before host exposure.</p></div><div className="upload-actions"><label className="check"><input type="checkbox" checked={syntheticConfirmed} onChange={(event) => setSyntheticConfirmed(event.target.checked)} />I confirm this is synthetic and contains no PHI or production data.</label><label className={`file-button ${!syntheticConfirmed ? 'disabled' : ''}`}>Choose file<input type="file" disabled={!syntheticConfirmed || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void begin({ kind: 'file', file }); event.target.value = '' }} /></label></div></section>
        <section><div className="section-heading"><div><span className="eyebrow">Connect once</span><h2>Use your AI host</h2></div><button className="quiet" onClick={() => setScreen('RESULTS')}>View results</button></div><div className="setup-grid"><HostSetupCard title="Codex" command="npm run mcp:config -- codex" /><HostSetupCard title="Claude Desktop" command="npm run mcp:config -- claude" /></div></section>
      </>}

      {screen === 'EVALUATE' && material && <>
        <div className="crumbs"><button onClick={() => void purge()}>← Start</button><span>Deterministic inspection</span><span>AI-host hypothesis</span><span>SME review</span></div>
        <section className="case-hero"><div><span className="eyebrow">Observed format</span><h1>{material.observation.observedFormat ?? material.structuralSummary.format}</h1><p>Status: {material.observation.status} · {material.structuralSummary.evidenceItems.length} sanitized evidence items</p></div><div className={`status-card ${blocked ? 'blocked' : ''}`}><strong>{blocked ? 'Host exposure blocked' : 'Ready for your approval'}</strong><span>{blocked ? 'This format or parser outcome cannot be sent to an AI host.' : 'Review the summary below before creating a short-lived case.'}</span></div></section>
        <div className="case-layout"><section className="panel"><span className="eyebrow">Approved summary candidate</span><h2>What the host can see</h2><div className="safety-grid"><span>✓ No payload values</span><span>✓ No identifiers</span><span>✓ No free text</span><span>✓ Counts are banded</span></div><details><summary>Inspect structural evidence</summary><div className="evidence-list">{material.structuralSummary.evidenceItems.map((item) => <code key={item.ref}>{item.ref} · {item.kind} · {'code' in item ? item.code : item.feature.name}</code>)}</div></details>{!evaluationCase && <><p className="boundary-copy">Approving makes this structural summary—not the payload—available to your configured AI host. That host may send it to its provider.</p><button className="primary" disabled={blocked || busy} onClick={() => void approve()}>Approve summary for AI host</button></>}</section>
          <section className="panel dark-panel"><span className="eyebrow">MCP roundtrip</span><h2>{evaluationCase ? hostRoundtripState === 'EXPIRED' ? 'Case expired' : 'Case is available' : 'Waiting for approval'}</h2>{evaluationCase && <>{hostRoundtripState !== 'EXPIRED' && <><code className="handle">{evaluationCase.caseHandle}</code><button className="quiet light" onClick={() => void copy(hostPrompt)}>Copy host instruction</button></>}<div className="waiting"><span className="pulse" />{hostRoundtripState === 'EXPIRED' ? 'The four-hour case window ended. Start a new inspection.' : hostRoundtripState === 'STALE' ? 'A stale submission was rejected. Ask the host to retrieve this case again.' : hostRoundtripState === 'RECEIVED' ? `${submissions.length} submission${submissions.length === 1 ? '' : 's'} received` : 'Waiting for Codex or Claude…'}</div></>}</section></div>

        {submissions.length > 0 && selected && review && <section className="review-panel"><div className="section-heading"><div><span className="eyebrow">SME review</span><h2>Correct the host, not the payload</h2></div><select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>{submissions.map((entry, index) => <option value={index} key={entry.receipt.submissionId}>{entry.hostKind} · {entry.receipt.submissionId.slice(0, 11)}</option>)}</select></div><ScalarAxis label="Standard / version" hypothesis={selected.submission.hypotheses.standardVersion} options={STANDARD_VERSIONS} review={review.standardVersion} onChange={(value) => setReview({ ...review, standardVersion: value })} /><ScalarAxis label="Workflow" hypothesis={selected.submission.hypotheses.workflow} options={WORKFLOWS} review={review.workflow} onChange={(value) => setReview({ ...review, workflow: value })} /><ScalarAxis label="Direction" hypothesis={selected.submission.hypotheses.direction} options={DIRECTIONS} review={review.direction} onChange={(value) => setReview({ ...review, direction: value })} /><ActorAxis hypothesis={selected.submission.hypotheses.actorRoles} review={review.actorRoles} onChange={(value) => setReview({ ...review, actorRoles: value })} /><ScalarAxis label="Destination class" hypothesis={selected.submission.hypotheses.destinationClass} options={DESTINATION_CLASSES} review={review.destinationClass} onChange={(value) => setReview({ ...review, destinationClass: value })} /><div className="review-actions"><button className="quiet danger" onClick={() => void purge()}>Purge without saving</button><button className="primary" onClick={() => void save()}>Save evaluation & purge case</button></div></section>}
      </>}

      {screen === 'RESULTS' && <><section className="results-hero"><div><span className="eyebrow">Sanitized local records</span><h1>{records.length} evaluation{records.length === 1 ? '' : 's'}</h1><p>{matchSummary.scored ? `${matchSummary.correct} of ${matchSummary.scored} scored axes matched the SME expectation.` : 'No scored axes yet.'}</p></div><div className="result-actions"><button className="quiet" onClick={() => setScreen('START')}>Run another case</button><button className="primary" disabled={!records.length} onClick={() => downloadJsonl(records)}>Download canonical JSONL</button></div></section><section className="records">{records.map((record) => <article key={record.recordId}><div><strong>{record.context.observation.observedFormat ?? record.context.structuralSummary.format}</strong><span>{record.hostKind}</span></div><code>{record.recordId}</code><span>{Object.values(record.review).filter((axis) => axis.exactMatch === true).length} exact · {Object.values(record.review).filter((axis) => axis.exactMatch === false).length} corrected</span></article>)}</section><button className="text-danger" disabled={!records.length} onClick={() => void clearRecords().then(refreshRecords)}>Clear sanitized records</button></>}
    </main>
    <footer><span>ImOnFHIR Payload Intelligence Preview</span><span>Local coordinator · Browser Worker inspection · Model-neutral MCP</span></footer>
  </div>
}
