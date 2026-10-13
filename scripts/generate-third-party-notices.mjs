// SPDX-License-Identifier: Apache-2.0

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const entries = []

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path.includes('node_modules/') || !metadata.version) continue
  const packageJsonPath = join(root, path, 'package.json')
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8').catch(() => JSON.stringify({
    name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: metadata.version,
    license: metadata.license,
  })))
  const license = typeof packageJson.license === 'string'
    ? packageJson.license
    : Array.isArray(packageJson.licenses)
      ? packageJson.licenses.map((item) => item.type).join(' OR ')
      : 'UNKNOWN'
  entries.push({ name: packageJson.name, version: packageJson.version, license })
}

const unique = [...new Map(entries.map((entry) => [`${entry.name}@${entry.version}`, entry])).values()]
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))

const unknown = unique.filter((entry) => entry.license === 'UNKNOWN')
if (unknown.length) {
  process.stderr.write(`Unknown dependency licenses: ${unknown.map((entry) => entry.name).join(', ')}\n`)
  process.exit(1)
}

const lines = [
  '# Third-party notices',
  '',
  'SPDX-License-Identifier: Apache-2.0',
  '',
  'Generated deterministically from `package-lock.json` and installed package metadata. Package license texts are distributed in the corresponding package directories. This inventory does not grant rights beyond each package license.',
  '',
  '| Package | Version | License |',
  '|---|---:|---|',
  ...unique.map((entry) => `| ${entry.name.replaceAll('|', '\\|')} | ${entry.version} | ${entry.license.replaceAll('|', '\\|')} |`),
  '',
]
await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'))
process.stdout.write(`Generated notices for ${unique.length} dependency versions.\n`)
