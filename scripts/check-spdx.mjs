// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const checkedExtensions = new Set(['.ts', '.tsx', '.mjs', '.css'])
const failures = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'dist-types', 'coverage'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await walk(path); continue }
    const extension = entry.name.slice(entry.name.lastIndexOf('.'))
    if (!checkedExtensions.has(extension)) continue
    const contents = await readFile(path, 'utf8')
    if (!contents.slice(0, 300).includes('SPDX-License-Identifier: Apache-2.0')) failures.push(relative(root, path))
  }
}

await walk(root)
if (failures.length) {
  process.stderr.write(`Missing SPDX header:\n${failures.join('\n')}\n`)
  process.exitCode = 1
} else process.stdout.write('PASS SPDX source headers\n')
