// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  canonicalJson,
  deriveRecordId,
  parseHostEvaluationCase,
  smeEvaluationRecordSchema,
  type ActorHypothesis,
  type ApprovedCaseMaterial,
  type AxisVerdict,
  type HostEvaluationCase,
  type HostHypothesisReceipt,
  type HostHypothesisSubmission,
  type HostKind,
  type LegacySmeEvaluationRecord,
  type ScalarHypothesis,
  type SmeEvaluationRecord,
} from '@imonfhir/payload-contracts'
import {
  ACTOR_ROLES,
  BUSINESS_WORKFLOWS,
  DESTINATION_CLASSES,
  EXCHANGE_PATTERNS,
  INTERACTION_KINDS,
  NEXT_ACTION_CODES,
  QUESTION_CODES,
  STANDARD_VERSIONS,
  type ActorRole,
  type BusinessWorkflow,
  type DestinationClass,
  type ExchangePattern,
  type InteractionKind,
  type NextActionCode,
  type QuestionCode,
  type StandardVersion,
} from '@imonfhir/payload-core'
import {
  clearLegacyRecords,
  clearRecords,
  listLegacyRecords,
  listRecords,
  saveRecord,
} from './db.js'
import {
  canonicalJsonl,
  evidenceLabel,
  hasUnsavedSubmissions,
  plainLabel,
  putDraft,
  recoveryFor,
  reviewFingerprint,
  sameSet,
  type RecoveryMessage,
} from './ui.js'

type Screen = 'START' | 'EVALUATE' | 'RESULTS'
type HostRoundtripState = 'WAITING' | 'RECEIVED' | 'STALE' | 'EXPIRED'
type HostActivityState = 'NOT_SEEN' | 'CAPABILITIES_CALLED' | 'CASE_RETRIEVED' | 'SUBMITTED'
type ReviewVerdict = AxisVerdict | 'UNREVIEWED'

interface SubmissionEnvelope {
  hostKind: HostKind
  submission: HostHypothesisSubmission
  receipt: HostHypothesisReceipt
}

interface ScalarReview<T extends string> { verdict: ReviewVerdict; expected: T }
interface SetReview<T extends string> { verdict: ReviewVerdict; expected: T[] }
interface ReviewState {
  standardVersion: ScalarReview<StandardVersion>
  businessWorkflow: ScalarReview<BusinessWorkflow>
  exchangePattern: ScalarReview<ExchangePattern>
  interactionKind: ScalarReview<InteractionKind>
  sourceActorRoles: SetReview<ActorRole>
  destinationActorRoles: SetReview<ActorRole>
  destinationClass: ScalarReview<DestinationClass>
  missingContextQuestionCodes: SetReview<QuestionCode>
  proposedNextActionCodes: SetReview<NextActionCode>
}

type ReviewKey = keyof ReviewState
type ScalarHypothesisKey = 'standardVersion' | 'businessWorkflow' | 'exchangePattern' | 'interactionKind' | 'destinationClass'

const samples = [
  { id: 'fhir-json', title: 'FHIR JSON', detail: 'Synthetic prior-authorization-shaped Claim', url: '/fhir-claim.json', fileName: 'fhir-claim.json', contentType: 'application/fhir+json' },
  { id: 'fhir-xml', title: 'FHIR XML', detail: 'Synthetic collection Bundle', url: '/fhir-bundle.xml', fileName: 'fhir-bundle.xml', contentType: 'application/fhir+xml' },
  { id: 'fhir-ndjson', title: 'FHIR NDJSON', detail: 'Two synthetic resources', url: '/fhir.ndjson', fileName: 'fhir.ndjson', contentType: 'application/fhir+ndjson' },
  { id: 'hl7-v2', title: 'HL7 v2', detail: 'Synthetic ORU envelope', url: '/hl7-v2.er7', fileName: 'hl7-v2.er7', contentType: 'application/hl7-v2' },
  { id: 'cda', title: 'CDA', detail: 'Synthetic ClinicalDocument', url: '/cda.xml', fileName: 'cda.xml', contentType: 'application/xml' },
  { id: 'ambiguous', title: 'Ambiguous JSON', detail: 'Clinical-looking, but no standard marker', url: '/ambiguous.json', fileName: 'ambiguous.json', contentType: 'application/json' },
] as const

const DIMENSIONS: Array<{ key: ReviewKey; label: string }> = [
  { key: 'standardVersion', label: 'Standard / version' },
  { key: 'businessWorkflow', label: 'Business workflow' },
  { key: 'exchangePattern', label: 'Exchange pattern' },
  { key: 'interactionKind', label: 'Interaction kind' },
  { key: 'sourceActorRoles', label: 'Source actor roles' },
  { key: 'destinationActorRoles', label: 'Destination actor roles' },
  { key: 'destinationClass', label: 'Destination class' },
  { key: 'missingContextQuestionCodes', label: 'Missing-context questions' },
  { key: 'proposedNextActionCodes', label: 'Next actions' },
]

const initialHostActivity: Record<HostKind, HostActivityState> = {
  CODEX: 'NOT_SEEN',
  CLAUDE_DESKTOP: 'NOT_SEEN',
}

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
    standardVersion: { verdict: 'UNREVIEWED', expected: submission.hypotheses.standardVersion.value },
    businessWorkflow: { verdict: 'UNREVIEWED', expected: submission.hypotheses.businessWorkflow.value },
    exchangePattern: { verdict: 'UNREVIEWED', expected: submission.hypotheses.exchangePattern.value },
    interactionKind: { verdict: 'UNREVIEWED', expected: submission.hypotheses.interactionKind.value },
    sourceActorRoles: { verdict: 'UNREVIEWED', expected: [...submission.hypotheses.sourceActorRoles.values] },
    destinationActorRoles: { verdict: 'UNREVIEWED', expected: [...submission.hypotheses.destinationActorRoles.values] },
    destinationClass: { verdict: 'UNREVIEWED', expected: submission.hypotheses.destinationClass.value },
    missingContextQuestionCodes: { verdict: 'UNREVIEWED', expected: [...submission.missingContextQuestionCodes] },
    proposedNextActionCodes: { verdict: 'UNREVIEWED', expected: [...submission.proposedNextActionCodes] },
  }
}

function completedReview(review: ReviewState): boolean {
  return Object.values(review).every((dimension) => dimension.verdict !== 'UNREVIEWED')
}

function submittedSet(submission: HostHypothesisSubmission, key: 'sourceActorRoles' | 'destinationActorRoles' | 'missingContextQuestionCodes' | 'proposedNextActionCodes'): readonly string[] {
  if (key === 'sourceActorRoles') return submission.hypotheses.sourceActorRoles.values
  if (key === 'destinationActorRoles') return submission.hypotheses.destinationActorRoles.values
  if (key === 'missingContextQuestionCodes') return submission.missingContextQuestionCodes
  return submission.proposedNextActionCodes
}

function reviewProblem(review: ReviewState, submission: HostHypothesisSubmission): string | null {
  if (!completedReview(review)) return 'Review all seven axes and both code sets before saving.'
  for (const key of ['sourceActorRoles', 'destinationActorRoles'] as const) {
    const dimension = review[key]
    if (dimension.verdict === 'CORRECTED' && dimension.expected.length === 0) {
      return `${key === 'sourceActorRoles' ? 'Source' : 'Destination'} actor roles require at least one expected value.`
    }
    if (dimension.verdict === 'CORRECTED' && dimension.expected.includes('UNKNOWN') && dimension.expected.length !== 1) return 'UNKNOWN must be the only actor-role expectation.'
  }
  const scalarPairs = [
    [review.standardVersion, submission.hypotheses.standardVersion.value],
    [review.businessWorkflow, submission.hypotheses.businessWorkflow.value],
    [review.exchangePattern, submission.hypotheses.exchangePattern.value],
    [review.interactionKind, submission.hypotheses.interactionKind.value],
    [review.destinationClass, submission.hypotheses.destinationClass.value],
  ] as const
  if (scalarPairs.some(([dimension, actual]) => dimension.verdict === 'CORRECTED' && dimension.expected === actual)) return 'A correction must differ from the host hypothesis.'
  for (const key of ['sourceActorRoles', 'destinationActorRoles', 'missingContextQuestionCodes', 'proposedNextActionCodes'] as const) {
    const dimension = review[key]
    if (dimension.verdict === 'CORRECTED' && sameSet(dimension.expected, submittedSet(submission, key))) return 'A corrected set must differ from the host submission.'
  }
  return null
}

function scalarReview<T extends string>(draft: ScalarReview<T>, actual: T) {
  if (draft.verdict === 'NOT_SCORABLE') return { verdict: draft.verdict, expected: null, exactMatch: null }
  if (draft.verdict === 'ACCEPTED') return { verdict: draft.verdict, expected: actual, exactMatch: true }
  return { verdict: 'CORRECTED' as const, expected: draft.expected, exactMatch: false }
}

function setReview<T extends string>(draft: SetReview<T>, actual: readonly T[]) {
  if (draft.verdict === 'NOT_SCORABLE') return { verdict: draft.verdict, expected: null, exactMatch: null }
  if (draft.verdict === 'ACCEPTED') return { verdict: draft.verdict, expected: [...actual], exactMatch: true }
  return { verdict: 'CORRECTED' as const, expected: [...draft.expected].sort(), exactMatch: false }
}

function downloadJsonl(records: readonly { recordId: string }[], fileName: string): void {
  const url = URL.createObjectURL(new Blob([canonicalJsonl(records)], { type: 'application/x-ndjson' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

async function copy(text: string): Promise<void> { await navigator.clipboard.writeText(text) }

function activityCopy(hostKind: HostKind, state: HostActivityState): string {
  const mode = hostKind === 'CODEX' ? 'Codex-mode' : 'Claude-mode'
  return state === 'NOT_SEEN' ? `No ${mode} MCP activity seen` : `${mode} MCP activity seen · ${plainLabel(state)}`
}

function HostSetupCard({ title, command, hostKind, activity }: { title: string; command: string; hostKind: HostKind; activity: HostActivityState }) {
  return <article className="setup-card">
    <div><span className="eyebrow">MCP host</span><h3>{title}</h3><small>{activityCopy(hostKind, activity)}</small></div>
    <code>{command}</code>
    <button className="quiet" onClick={() => void copy(command)}>Copy setup command</button>
  </article>
}

function VerdictButtons({ value, onChange }: { value: ReviewVerdict; onChange: (value: AxisVerdict) => void }) {
  return <div className="segmented" role="group" aria-label="SME verdict">
    {(['ACCEPTED', 'CORRECTED', 'NOT_SCORABLE'] as const).map((option) => <button key={option} className={value === option ? 'selected' : ''} onClick={() => onChange(option)}>{option === 'NOT_SCORABLE' ? 'Not scorable' : option === 'CORRECTED' ? 'Correct' : 'Accept'}</button>)}
  </div>
}

function EvidenceReferences({ refs, conflicts, material, recordingView = false }: { refs: readonly string[]; conflicts: readonly string[]; material: ApprovedCaseMaterial; recordingView?: boolean }) {
  const offered = new Map(material.structuralSummary.evidenceItems.map((item) => [item.ref, item]))
  return <div className="evidence-references">
    {refs.map((ref) => { const item = offered.get(ref); return <div key={ref}>{!recordingView && <code>{ref}</code>}<span>{item ? recordingView && item.kind === 'FEATURE' ? `${plainLabel(item.feature.kind)} · ${plainLabel(item.feature.name)}` : evidenceLabel(item) : 'Unavailable evidence reference'}</span></div> })}
    {conflicts.map((code) => <div className="conflict" key={code}><code>{code}</code><span>{plainLabel(code)}</span></div>)}
  </div>
}

function ScalarAxis<T extends string>({ label, hypothesis, options, review, material, recordingView, onChange }: { label: string; hypothesis: ScalarHypothesis<T>; options: readonly T[]; review: ScalarReview<T>; material: ApprovedCaseMaterial; recordingView?: boolean; onChange: (review: ScalarReview<T>) => void }) {
  return <section className="axis-card">
    <div className="axis-heading"><div><span>{label}</span><strong>{plainLabel(hypothesis.value)}</strong><code>{hypothesis.value}</code></div><VerdictButtons value={review.verdict} onChange={(verdict) => onChange({ ...review, verdict })} /></div>
    <EvidenceReferences refs={hypothesis.evidenceRefs} conflicts={hypothesis.conflictCodes} material={material} recordingView={recordingView} />
    {review.verdict === 'CORRECTED' && <label className="field">Expected value<select value={review.expected} onChange={(event) => onChange({ ...review, expected: event.target.value as T })}>{options.map((option) => <option value={option} key={option}>{plainLabel(option)} · {option}</option>)}</select></label>}
  </section>
}

function OptionGrid<T extends string>({ options, review, exclusive, onChange }: { options: readonly T[]; review: SetReview<T>; exclusive?: T; onChange: (review: SetReview<T>) => void }) {
  return <div className="actor-grid">{options.map((option) => <label key={option}><input type="checkbox" checked={review.expected.includes(option)} onChange={(event) => {
    const without = review.expected.filter((item) => item !== option && item !== exclusive)
    const next = event.target.checked ? option === exclusive ? [option] : [...without, option] : review.expected.filter((item) => item !== option)
    onChange({ ...review, expected: [...new Set(next)].sort() as T[] })
  }} />{plainLabel(option)} <code>{option}</code></label>)}</div>
}

function ActorAxis({ label, hypothesis, review, material, recordingView, onChange }: { label: string; hypothesis: ActorHypothesis; review: SetReview<ActorRole>; material: ApprovedCaseMaterial; recordingView?: boolean; onChange: (review: SetReview<ActorRole>) => void }) {
  return <section className="axis-card">
    <div className="axis-heading"><div><span>{label}</span><strong>{hypothesis.values.map(plainLabel).join(' + ')}</strong><code>{hypothesis.values.join(' + ')}</code></div><VerdictButtons value={review.verdict} onChange={(verdict) => onChange({ ...review, verdict })} /></div>
    <EvidenceReferences refs={hypothesis.evidenceRefs} conflicts={hypothesis.conflictCodes} material={material} recordingView={recordingView} />
    {review.verdict === 'CORRECTED' && <OptionGrid options={ACTOR_ROLES} review={review} exclusive="UNKNOWN" onChange={onChange} />}
  </section>
}

function CodeSetAxis<T extends string>({ label, submitted, options, review, onChange }: { label: string; submitted: readonly T[]; options: readonly T[]; review: SetReview<T>; onChange: (review: SetReview<T>) => void }) {
  return <section className="axis-card">
    <div className="axis-heading"><div><span>{label}</span><strong>{submitted.length ? submitted.map(plainLabel).join(' + ') : 'None submitted'}</strong><code>{submitted.length ? submitted.join(' + ') : 'EMPTY_SET'}</code></div><VerdictButtons value={review.verdict} onChange={(verdict) => onChange({ ...review, verdict })} /></div>
    {review.verdict === 'CORRECTED' && <OptionGrid options={options} review={review} onChange={onChange} />}
  </section>
}

function ControlledValues({ values, empty = 'EMPTY_SET' }: { values: readonly string[]; empty?: string }) {
  if (values.length === 0) return <div className="controlled-values"><strong>None</strong><code>{empty}</code></div>
  return <div className="controlled-values"><strong>{values.map(plainLabel).join(' + ')}</strong><code>{values.join(' + ')}</code></div>
}

function submittedFor(record: SmeEvaluationRecord, key: ReviewKey): readonly string[] {
  if (key === 'sourceActorRoles' || key === 'destinationActorRoles') return record.hypotheses[key].values
  if (key === 'missingContextQuestionCodes' || key === 'proposedNextActionCodes') return record[key]
  return [(record.hypotheses[key as ScalarHypothesisKey] as ScalarHypothesis<string>).value]
}

export function App() {
  const recordingView = new URLSearchParams(window.location.search).get('recording') === '1'
  const [screen, setScreen] = useState<Screen>('START')
  const [ready, setReady] = useState(false)
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false)
  const [material, setMaterial] = useState<ApprovedCaseMaterial | null>(null)
  const [evaluationCase, setEvaluationCase] = useState<HostEvaluationCase | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionEnvelope[]>([])
  const [hostRoundtripState, setHostRoundtripState] = useState<HostRoundtripState>('WAITING')
  const [selectedDigest, setSelectedDigest] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, ReviewState>>({})
  const [savedFingerprints, setSavedFingerprints] = useState<Record<string, string>>({})
  const [records, setRecords] = useState<SmeEvaluationRecord[]>([])
  const [legacyRecords, setLegacyRecords] = useState<LegacySmeEvaluationRecord[]>([])
  const [hostActivity, setHostActivity] = useState<Record<HostKind, HostActivityState>>(initialHostActivity)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<RecoveryMessage | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const selected = submissions.find((entry) => entry.receipt.submissionDigest === selectedDigest) ?? submissions[0]
  const review = selected ? drafts[selected.receipt.submissionDigest] : undefined

  const refreshRecords = useCallback(async () => {
    try {
      const [current, legacy] = await Promise.all([listRecords(), listLegacyRecords()])
      setRecords(current); setLegacyRecords(legacy)
    } catch (cause) { setError(recoveryFor(cause)) }
  }, [])

  useEffect(() => {
    void fetch('/api/status').then((response) => response.ok).then(setReady).catch(() => setReady(false))
    void refreshRecords()
    const pollActivity = async () => {
      try {
        const response = await fetch('/api/host-activity', { cache: 'no-store' })
        if (!response.ok) return
        const body = await response.json() as { activity?: Record<HostKind, HostActivityState> }
        if (body.activity) setHostActivity(body.activity)
      } catch { /* readiness already communicates a stopped lab */ }
    }
    void pollActivity()
    const activityTimer = window.setInterval(() => void pollActivity(), 1_000)
    return () => window.clearInterval(activityTimer)
  }, [refreshRecords])

  useEffect(() => {
    if (!evaluationCase) return
    const poll = async () => {
      const response = await fetch(`/api/cases/${evaluationCase.caseHandle}/submissions`, { cache: 'no-store' })
      const body = await response.json() as { state?: HostRoundtripState; submissions?: SubmissionEnvelope[]; error?: string }
      if (!response.ok) { if (body.error === 'EXPIRED_CASE') setHostRoundtripState('EXPIRED'); return }
      setHostRoundtripState(body.state ?? 'WAITING')
      if (body.submissions) setSubmissions(body.submissions)
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 1_000)
    return () => window.clearInterval(timer)
  }, [evaluationCase])

  useEffect(() => { if (!selectedDigest && submissions[0]) setSelectedDigest(submissions[0].receipt.submissionDigest) }, [selectedDigest, submissions])
  useEffect(() => {
    if (!selected) return
    const digest = selected.receipt.submissionDigest
    setDrafts((current) => current[digest] ? current : putDraft(current, digest, initialReview(selected.submission)))
  }, [selected])

  const updateReview = (next: ReviewState) => {
    if (!selected) return
    setDrafts((current) => putDraft(current, selected.receipt.submissionDigest, next)); setSavedNotice(null)
  }
  const resetCase = () => {
    setMaterial(null); setEvaluationCase(null); setSubmissions([]); setSelectedDigest(null); setDrafts({}); setSavedFingerprints({}); setHostRoundtripState('WAITING'); setSavedNotice(null)
  }
  const begin = async (request: unknown) => {
    setBusy(true); setError(null); resetCase()
    try { setMaterial(await runInspection(request)); setScreen('EVALUATE') } catch (cause) { setError(recoveryFor(cause)) } finally { setBusy(false) }
  }
  const approve = async () => {
    if (!material) return
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/cases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(material) })
      const body = await response.json() as HostEvaluationCase & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'STORE_UNAVAILABLE')
      setEvaluationCase(parseHostEvaluationCase(body)); setHostRoundtripState('WAITING')
    } catch (cause) { setError(recoveryFor(cause)) } finally { setBusy(false) }
  }
  const purgeCase = async () => {
    if (evaluationCase) {
      const response = await fetch(`/api/cases/${evaluationCase.caseHandle}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'STORE_UNAVAILABLE' })) as { error?: string }
        throw new Error(body.error ?? 'STORE_UNAVAILABLE')
      }
    }
    resetCase()
  }
  const finishAndPurge = async (destination: Screen = 'RESULTS') => {
    if (hasUnsavedSubmissions(submissions.map((entry) => entry.receipt.submissionDigest), drafts, savedFingerprints) && !window.confirm('This case has one or more unsaved host submissions. Finish and purge anyway?')) return
    try { await purgeCase(); setScreen(destination) } catch (cause) { setError(recoveryFor(cause)) }
  }
  const save = async () => {
    if (!material || !evaluationCase || !selected || !review) return
    const submission = selected.submission
    const problem = reviewProblem(review, submission)
    if (problem) return
    const record: SmeEvaluationRecord = {
      schemaVersion: 'imonfhir.sme-evaluation-record.v2',
      recordId: deriveRecordId(evaluationCase.caseDigest, selected.hostKind, selected.receipt.hypothesisDigest),
      taxonomyVersion: 'imonfhir.evaluation-taxonomy.v2',
      contractDigests: evaluationCase.contractDigests,
      contextDigest: evaluationCase.caseDigest,
      context: material,
      hostKind: selected.hostKind,
      hypothesisDigest: selected.receipt.hypothesisDigest,
      submissionDigest: selected.receipt.submissionDigest,
      hypotheses: submission.hypotheses,
      missingContextQuestionCodes: submission.missingContextQuestionCodes,
      proposedNextActionCodes: submission.proposedNextActionCodes,
      review: {
        standardVersion: scalarReview(review.standardVersion, submission.hypotheses.standardVersion.value),
        businessWorkflow: scalarReview(review.businessWorkflow, submission.hypotheses.businessWorkflow.value),
        exchangePattern: scalarReview(review.exchangePattern, submission.hypotheses.exchangePattern.value),
        interactionKind: scalarReview(review.interactionKind, submission.hypotheses.interactionKind.value),
        sourceActorRoles: setReview(review.sourceActorRoles, submission.hypotheses.sourceActorRoles.values),
        destinationActorRoles: setReview(review.destinationActorRoles, submission.hypotheses.destinationActorRoles.values),
        destinationClass: scalarReview(review.destinationClass, submission.hypotheses.destinationClass.value),
        missingContextQuestionCodes: setReview(review.missingContextQuestionCodes, submission.missingContextQuestionCodes),
        proposedNextActionCodes: setReview(review.proposedNextActionCodes, submission.proposedNextActionCodes),
      },
    }
    try {
      smeEvaluationRecordSchema.parse(record)
      await saveRecord(record)
      setSavedFingerprints((current) => ({ ...current, [selected.receipt.submissionDigest]: reviewFingerprint(review) }))
      setSavedNotice(`${selected.hostKind === 'CODEX' ? 'Codex-mode' : 'Claude-mode'} evaluation saved. The case remains available for the other host.`)
      await refreshRecords()
    } catch (cause) { setError(recoveryFor(cause)) }
  }

  const hostPrompt = evaluationCase ? `Use the ImOnFHIR Payload Intelligence MCP. Call payload_get_evaluation_case with caseHandle ${evaluationCase.caseHandle}. Use only its approved structural summary. Submit every required v2 closed-code hypothesis with payload_submit_hypotheses. Do not ask for or infer raw payload values.` : ''
  const blocked = material ? ['RESTRICTED_EDI_UNSUPPORTED', 'PDF', 'DICOM', 'ARCHIVE', 'UNKNOWN_BINARY'].includes(material.structuralSummary.format) || ['REJECTED', 'OPAQUE'].includes(material.observation.status) : false
  const currentReviewProblem = selected && review ? reviewProblem(review, selected.submission) : null
  const dimensionSummary = useMemo(() => DIMENSIONS.map(({ key, label }) => {
    const values = records.map((record) => record.review[key].exactMatch).filter((value): value is boolean => value !== null)
    return { key, label, correct: values.filter(Boolean).length, scored: values.length }
  }), [records])
  const groups = useMemo(() => {
    const grouped = new Map<string, SmeEvaluationRecord[]>()
    for (const record of records) grouped.set(record.contextDigest, [...(grouped.get(record.contextDigest) ?? []), record])
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))
  }, [records])

  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark">IF</div><div><strong>Payload Intelligence</strong><span>Evaluation workbench</span></div><span className="preview-badge">EXPERIMENTAL PREVIEW</span></header>
    <main>
      <div className="nonclaim"><strong>Synthetic data only.</strong> Not a validator, trained healthcare model, calibrated classifier, or clinical/payer decision system.</div>
      {recordingView && <div className="recording-label">REAL HOST MCP HANDOFF · SYNTHETIC ONLY · NOT A MODEL QUALITY TEST</div>}
      {error && <div className="error-banner" role="alert"><span><strong>{error.code}</strong> · {error.message}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
      {screen === 'START' && <>
        <section className="hero"><div><span className="eyebrow">Local, bounded, correctable</span><h1>Inspect the shape.<br />Evaluate the hypothesis.</h1><p>Raw bytes stay in a one-use browser Worker. You approve the structural summary before Codex or Claude can read it.</p></div><div className="readiness"><span className={ready ? 'ready-dot' : 'offline-dot'} />{ready ? 'Local coordinator ready' : 'Coordinator unavailable'}</div></section>
        <section><div className="section-heading"><div><span className="eyebrow">Start with evidence</span><h2>Choose a synthetic case</h2></div><span>{records.length} saved v2 evaluation{records.length === 1 ? '' : 's'}{legacyRecords.length ? ` · ${legacyRecords.length} legacy v1` : ''}</span></div><div className="sample-grid">{samples.map((sample, index) => <button className="sample-card" key={sample.id} disabled={busy} onClick={() => void begin({ kind: 'sample', url: sample.url, fileName: sample.fileName, contentType: sample.contentType })}><span className="sample-number">0{index + 1}</span><strong>{sample.title}</strong><span>{sample.detail}</span><b>Inspect →</b></button>)}</div></section>
        <section className="upload-panel"><div><span className="eyebrow">Your fixture</span><h2>Use a synthetic payload</h2><p>Any bounded file can be inspected. Unsupported or unsafe shapes stop before host exposure.</p></div><div className="upload-actions"><label className="check"><input type="checkbox" checked={syntheticConfirmed} onChange={(event) => setSyntheticConfirmed(event.target.checked)} />I confirm this is synthetic and contains no PHI or production data.</label><label className={`file-button ${!syntheticConfirmed ? 'disabled' : ''}`}>Choose file<input type="file" disabled={!syntheticConfirmed || busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void begin({ kind: 'file', file }); event.target.value = '' }} /></label></div></section>
        <section><div className="section-heading"><div><span className="eyebrow">Connect once</span><h2>Use your AI host</h2></div><button className="quiet" onClick={() => setScreen('RESULTS')}>View results</button></div><div className="setup-grid"><HostSetupCard title="Codex" hostKind="CODEX" activity={hostActivity.CODEX} command="npm run mcp:config -- codex" /><HostSetupCard title="Claude Desktop" hostKind="CLAUDE_DESKTOP" activity={hostActivity.CLAUDE_DESKTOP} command="npm run mcp:config -- claude" /></div><p className="activity-disclaimer">Activity reflects local Codex-mode or Claude-mode MCP traffic, not authenticated host identity. Self-test and doctor probes do not advance it.</p></section>
      </>}
      {screen === 'EVALUATE' && material && <>
        <div className="crumbs"><button onClick={() => void finishAndPurge('START')}>← Start</button><span>Deterministic inspection</span><span>AI-host hypothesis</span><span>SME review</span></div>
        <section className="case-hero"><div><span className="eyebrow">Observed format</span><h1>{material.observation.observedFormat ?? material.structuralSummary.format}</h1><p>Status: {material.observation.status} · {material.structuralSummary.evidenceItems.length} sanitized evidence items</p></div><div className={`status-card ${blocked ? 'blocked' : ''}`}><strong>{blocked ? 'Host exposure blocked' : 'Ready for your approval'}</strong><span>{blocked ? 'This format or parser outcome cannot be sent to an AI host.' : 'Review the summary below before creating a short-lived case.'}</span></div></section>
        <div className="case-layout"><section className="panel"><span className="eyebrow">Approved summary candidate</span><h2>What the host can see</h2><div className="safety-grid"><span>✓ No payload values</span><span>✓ No identifiers</span><span>✓ No free text</span><span>✓ Counts are banded</span></div>{recordingView ? <p className="recording-redaction">Detailed structural paths and evidence identifiers are hidden in recording view.</p> : <><details><summary>Inspect structural evidence</summary><div className="evidence-list">{material.structuralSummary.evidenceItems.map((item) => <div key={item.ref}><code>{item.ref}</code><span>{evidenceLabel(item)}</span></div>)}</div></details><div className="projection-block"><h3>Complete approved case material</h3><p>This canonical projection contains every observed or structural field approved for host retrieval. Short-lived coordinator metadata is added only after approval.</p><pre data-testid="approved-case-projection">{canonicalJson(material)}</pre></div></>}{!evaluationCase && <><p className="boundary-copy">Approving makes this complete case material—not the payload—available to your configured AI host. That host may send it to its provider.</p><button className="primary" disabled={blocked || busy} onClick={() => void approve()}>Approve summary for AI host</button></>}</section>
          <section className="panel dark-panel"><span className="eyebrow">MCP roundtrip</span><h2>{evaluationCase ? hostRoundtripState === 'EXPIRED' ? 'Case expired' : 'Case is available' : 'Waiting for approval'}</h2>{evaluationCase && <>{hostRoundtripState !== 'EXPIRED' && <>{recordingView ? <span className="recording-redaction">Private case handle hidden in recording view.</span> : <code className="handle">{evaluationCase.caseHandle}</code>}<button className="quiet light" onClick={() => void copy(hostPrompt)}>Copy host instruction</button></>}<div className="waiting"><span className="pulse" />{hostRoundtripState === 'EXPIRED' ? 'The four-hour case window ended. Start a new inspection.' : hostRoundtripState === 'STALE' ? 'A stale submission was rejected. Ask the host to retrieve this case again.' : hostRoundtripState === 'RECEIVED' ? `${submissions.length} submission${submissions.length === 1 ? '' : 's'} received` : 'Waiting for Codex or Claude…'}</div><div className="activity-stack"><span>{activityCopy('CODEX', hostActivity.CODEX)}</span><span>{activityCopy('CLAUDE_DESKTOP', hostActivity.CLAUDE_DESKTOP)}</span><small>Mode activity only; identity is not authenticated.</small></div></>}</section></div>
        {submissions.length > 0 && selected && review && <section className="review-panel"><div className="section-heading"><div><span className="eyebrow">SME review</span><h2>Correct the host, not the payload</h2></div><select aria-label="Host submission" value={selected.receipt.submissionDigest} onChange={(event) => setSelectedDigest(event.target.value)}>{submissions.map((entry) => { const draft = drafts[entry.receipt.submissionDigest]; const saved = draft !== undefined && savedFingerprints[entry.receipt.submissionDigest] === reviewFingerprint(draft); return <option value={entry.receipt.submissionDigest} key={entry.receipt.submissionDigest}>{entry.hostKind === 'CODEX' ? 'Codex-mode' : 'Claude-mode'} · {saved ? 'saved' : 'unsaved'}</option> })}</select></div><p className="review-instruction">Choose Accept, Correct, or Not scorable for all seven axes and both exact code sets. Drafts stay attached to each submission when you switch hosts.</p>
          <ScalarAxis label="Standard / version" hypothesis={selected.submission.hypotheses.standardVersion} options={STANDARD_VERSIONS} review={review.standardVersion} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, standardVersion: value })} />
          <ScalarAxis label="Business workflow" hypothesis={selected.submission.hypotheses.businessWorkflow} options={BUSINESS_WORKFLOWS} review={review.businessWorkflow} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, businessWorkflow: value })} />
          <ScalarAxis label="Exchange pattern" hypothesis={selected.submission.hypotheses.exchangePattern} options={EXCHANGE_PATTERNS} review={review.exchangePattern} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, exchangePattern: value })} />
          <ScalarAxis label="Interaction kind" hypothesis={selected.submission.hypotheses.interactionKind} options={INTERACTION_KINDS} review={review.interactionKind} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, interactionKind: value })} />
          <ActorAxis label="Source actor roles" hypothesis={selected.submission.hypotheses.sourceActorRoles} review={review.sourceActorRoles} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, sourceActorRoles: value })} />
          <ActorAxis label="Destination actor roles" hypothesis={selected.submission.hypotheses.destinationActorRoles} review={review.destinationActorRoles} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, destinationActorRoles: value })} />
          <ScalarAxis label="Destination class" hypothesis={selected.submission.hypotheses.destinationClass} options={DESTINATION_CLASSES} review={review.destinationClass} material={material} recordingView={recordingView} onChange={(value) => updateReview({ ...review, destinationClass: value })} />
          <CodeSetAxis label="Missing-context questions" submitted={selected.submission.missingContextQuestionCodes} options={QUESTION_CODES} review={review.missingContextQuestionCodes} onChange={(value) => updateReview({ ...review, missingContextQuestionCodes: value })} />
          <CodeSetAxis label="Next actions" submitted={selected.submission.proposedNextActionCodes} options={NEXT_ACTION_CODES} review={review.proposedNextActionCodes} onChange={(value) => updateReview({ ...review, proposedNextActionCodes: value })} />
          <div className="review-actions"><button className="quiet danger" onClick={() => void finishAndPurge()}>Finish and purge case</button><div className="save-review">{savedNotice && <strong className="saved-notice">{savedNotice}</strong>}<span aria-live="polite">{currentReviewProblem ?? 'All seven axes and both exact code sets have explicit verdicts.'}</span><button className="primary" disabled={Boolean(currentReviewProblem)} onClick={() => void save()}>Save this evaluation</button></div></div>
        </section>}
        {evaluationCase && submissions.length === 0 && <div className="case-finish"><button className="quiet danger" onClick={() => void finishAndPurge()}>Finish and purge case</button></div>}
      </>}
      {screen === 'RESULTS' && <><section className="results-hero"><div><span className="eyebrow">Sanitized local v2 records</span><h1>{records.length} evaluation{records.length === 1 ? '' : 's'}</h1><p>Results stay separated by context, host mode, and review dimension. No pooled accuracy score or host ranking is produced.</p></div><div className="result-actions"><button className="quiet" onClick={() => setScreen('START')}>Run another case</button><button className="primary" disabled={!records.length} onClick={() => downloadJsonl(records, 'imonfhir-sme-evaluations-v2.jsonl')}>Download canonical v2 JSONL</button></div></section>
        <section className="dimension-summary"><div className="section-heading"><div><span className="eyebrow">Per-dimension exact counts</span><h2>No pooled score</h2></div></div><div className="dimension-grid">{dimensionSummary.map((dimension) => <div key={dimension.key}><span>{dimension.label}</span><strong>{dimension.correct} / {dimension.scored}</strong></div>)}</div></section>
        <section className="record-groups">{groups.map(([contextDigest, contextRecords]) => <section className="record-group" key={contextDigest}><div className="record-group-heading"><div><span className="eyebrow">Evaluation context</span><h2>{contextRecords[0]?.context.observation.observedFormat ?? contextRecords[0]?.context.structuralSummary.format}</h2></div>{!recordingView && <code>{contextDigest}</code>}</div>{contextRecords.slice().sort((a, b) => a.hostKind.localeCompare(b.hostKind)).map((record) => <article className="record-detail" key={record.recordId}><div className="record-title"><strong>{record.hostKind === 'CODEX' ? 'Codex-mode' : 'Claude-mode'}</strong>{!recordingView && <code>{record.recordId}</code>}</div><div className="comparison-table" role="table">{DIMENSIONS.map(({ key, label }) => {
          const reviewValue = record.review[key]
          const submitted = submittedFor(record, key)
          const expected = reviewValue.expected
          const expectedValues = expected === null ? null : Array.isArray(expected) ? expected : [expected]
          return <div className="comparison-row" role="row" key={key}><span>{label}</span><div><small>Submitted</small><ControlledValues values={submitted} /></div><div><small>SME expectation</small>{expectedValues === null ? <div className="controlled-values"><strong>Not scorable</strong><code>NOT_SCORABLE</code></div> : <ControlledValues values={expectedValues} />}</div><strong>{plainLabel(reviewValue.verdict)} · {reviewValue.exactMatch === null ? 'not scored' : reviewValue.exactMatch ? 'exact' : 'not exact'}</strong></div>
        })}</div></article>)}</section>)}</section>
        <section className="legacy-panel"><div><span className="eyebrow">Legacy isolation</span><h2>{legacyRecords.length} preserved v1 record{legacyRecords.length === 1 ? '' : 's'}</h2><p>V1 rows keep their original semantics. They are never remapped into taxonomy v2 or included in the counts above.</p></div><div className="result-actions"><button className="quiet" disabled={!legacyRecords.length} onClick={() => downloadJsonl(legacyRecords, 'imonfhir-sme-evaluations-v1-legacy.jsonl')}>Download legacy v1 JSONL</button><button className="text-danger" disabled={!legacyRecords.length} onClick={() => void clearLegacyRecords().then(refreshRecords).catch((cause) => setError(recoveryFor(cause)))}>Clear legacy v1 records</button></div></section>
        <button className="text-danger" disabled={!records.length} onClick={() => void clearRecords().then(refreshRecords).catch((cause) => setError(recoveryFor(cause)))}>Clear v2 sanitized records</button>
      </>}
    </main>
    <footer><span>ImOnFHIR Payload Intelligence Preview</span><span>Local coordinator · Browser Worker inspection · Model-neutral MCP</span></footer>
  </div>
}
