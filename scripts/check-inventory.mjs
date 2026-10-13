// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const forbiddenNames = [/\.gguf$/i, /\.jar$/i, /model-pack/i, /node-llama-cpp/i, /study-consent/i, /utility-study/i, /case-study/i, /private-key/i]
const forbiddenPackages = ['electron', 'next', 'prisma', 'node-llama-cpp']
const failures = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    const display = relative(root, path)
    if (forbiddenNames.some((pattern) => pattern.test(display))) failures.push(`forbidden file: ${display}`)
    if (entry.isDirectory()) await walk(path)
  }
}

await walk(root)
const lock = await readFile(join(root, 'package-lock.json'), 'utf8').catch(() => '')
for (const dependency of forbiddenPackages) {
  if (lock.includes(`node_modules/${dependency}`)) failures.push(`forbidden dependency: ${dependency}`)
}
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
} else process.stdout.write('PASS public package inventory\n')
