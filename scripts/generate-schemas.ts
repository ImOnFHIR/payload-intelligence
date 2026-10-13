// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  evaluatorCapabilitiesSchema,
  hostEvaluationCaseSchema,
  hostHypothesisReceiptSchema,
  hostHypothesisSubmissionSchema,
  smeEvaluationRecordSchema,
} from '../packages/contracts/src/validation.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const directory = resolve(root, 'packages/contracts/schemas')
await mkdir(directory, { recursive: true })

const schemas = [
  ['imonfhir.evaluator-capabilities.v1', evaluatorCapabilitiesSchema],
  ['imonfhir.host-evaluation-case.v1', hostEvaluationCaseSchema],
  ['imonfhir.host-hypothesis-submission.v1', hostHypothesisSubmissionSchema],
  ['imonfhir.host-hypothesis-receipt.v1', hostHypothesisReceiptSchema],
  ['imonfhir.sme-evaluation-record.v1', smeEvaluationRecordSchema],
] as const

for (const [name, schema] of schemas) {
  const generated = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://imonfhir.com/schemas/${name}.schema.json`,
    $comment: 'SPDX-License-Identifier: Apache-2.0',
    ...generated,
  }
  await writeFile(resolve(directory, `${name}.schema.json`), `${JSON.stringify(document, null, 2)}\n`)
}

process.stdout.write(`Generated ${schemas.length} closed contract schemas.\n`)
