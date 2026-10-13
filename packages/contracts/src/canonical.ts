// SPDX-License-Identifier: Apache-2.0

import { sha256 } from '@noble/hashes/sha2.js'

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, normalize(record[key])]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value))
}

export function sha256Hex(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  return [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}
