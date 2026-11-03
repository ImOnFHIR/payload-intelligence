// SPDX-License-Identifier: Apache-2.0

// npm run results:summarize -- <imonfhir-sme-evaluations-v2.jsonl>
// Prints Markdown tables for a written finding. Reads the file only; writes nothing.

import { readFile } from 'node:fs/promises'
import { readEvaluationExport, renderSummaryMarkdown, summarizeEvaluations } from './results-summary-lib.js'

const path = process.argv[2]
if (!path) {
  process.stderr.write('Usage: npm run results:summarize -- <imonfhir-sme-evaluations-v2.jsonl>\n')
  process.exit(2)
}

try {
  const records = readEvaluationExport(await readFile(path, 'utf8'))
  process.stdout.write(renderSummaryMarkdown(summarizeEvaluations(records)))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'RESULTS_SUMMARY_FAILED'}\n`)
  process.exit(1)
}
