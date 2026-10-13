// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))

const runtimeAllowlist = new Set([
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
])

// MPL tooling is accepted only when npm marks the complete package path as
// development-only. It may not enter the runtime dependency graph.
const developmentOnlyAllowlist = new Set(['MPL-2.0'])
const failures = []
let runtimeCount = 0
let developmentCount = 0

if (lock.lockfileVersion !== 3 || typeof lock.packages !== 'object' || lock.packages === null) {
  failures.push('package-lock.json must use npm lockfileVersion 3 with package metadata')
} else {
  for (const [packagePath, metadata] of Object.entries(lock.packages)) {
    if (metadata.link === true) {
      if (typeof metadata.resolved !== 'string' || !lock.packages[metadata.resolved]) {
        failures.push(`${packagePath}: unresolved workspace link`)
      }
      continue
    }

    const display = packagePath || '<root>'
    const license = metadata.license
    const developmentOnly = metadata.dev === true
    if (developmentOnly) developmentCount += 1
    else runtimeCount += 1

    if (typeof license !== 'string' || license.length === 0) {
      failures.push(`${display}: missing license metadata`)
      continue
    }
    if (runtimeAllowlist.has(license)) continue
    if (developmentOnly && developmentOnlyAllowlist.has(license)) continue

    const scope = developmentOnly ? 'development' : 'runtime'
    failures.push(`${display}: ${scope} license ${JSON.stringify(license)} is not allowed`)
  }
}

if (failures.length > 0) {
  process.stderr.write(`Dependency license policy failed:\n${failures.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `PASS dependency license policy (${runtimeCount} runtime, ${developmentCount} development packages)\n`,
  )
}
