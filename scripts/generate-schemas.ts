// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  evaluatorCapabilitiesSchema,
  evaluatorCapabilitiesSchemaV1,
  hostEvaluationCaseSchema,
  hostEvaluationCaseSchemaV1,
  hostHypothesisReceiptSchema,
  hostHypothesisReceiptSchemaV1,
  hostHypothesisSubmissionSchema,
  hostHypothesisSubmissionSchemaV1,
  nonAuthorHandoffReceiptSchema,
  smeEvaluationRecordSchema,
  smeEvaluationRecordSchemaV1,
} from '../packages/contracts/src/validation.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const directory = resolve(root, 'packages/contracts/schemas')
await mkdir(directory, { recursive: true })

const schemas = [
  ['imonfhir.evaluator-capabilities.v1', evaluatorCapabilitiesSchemaV1],
  ['imonfhir.host-evaluation-case.v1', hostEvaluationCaseSchemaV1],
  ['imonfhir.host-hypothesis-submission.v1', hostHypothesisSubmissionSchemaV1],
  ['imonfhir.host-hypothesis-receipt.v1', hostHypothesisReceiptSchemaV1],
  ['imonfhir.sme-evaluation-record.v1', smeEvaluationRecordSchemaV1],
  ['imonfhir.evaluator-capabilities.v2', evaluatorCapabilitiesSchema],
  ['imonfhir.host-evaluation-case.v2', hostEvaluationCaseSchema],
  ['imonfhir.host-hypothesis-submission.v2', hostHypothesisSubmissionSchema],
  ['imonfhir.host-hypothesis-receipt.v2', hostHypothesisReceiptSchema],
  ['imonfhir.sme-evaluation-record.v2', smeEvaluationRecordSchema],
  ['imonfhir.non-author-handoff-receipt.v1', nonAuthorHandoffReceiptSchema],
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
