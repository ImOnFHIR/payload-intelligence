// SPDX-License-Identifier: Apache-2.0

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Rendezvous {
  schemaVersion: 'imonfhir.lab-rendezvous.v1'
  baseUrl: string
  token: string
  pid: number
}

export function rendezvousPath(): string {
  if (process.env.IMONFHIR_LAB_RENDEZVOUS) return process.env.IMONFHIR_LAB_RENDEZVOUS
  return join(homedir(), '.imonfhir-payload-intelligence', 'lab.json')
}

export async function readRendezvous(path = rendezvousPath()): Promise<Rendezvous> {
  const fileStat = await stat(path)
  if ((fileStat.mode & 0o077) !== 0) throw new Error('STORE_UNAVAILABLE')
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<Rendezvous>
  if (
    parsed.schemaVersion !== 'imonfhir.lab-rendezvous.v1' ||
    typeof parsed.baseUrl !== 'string' ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(parsed.baseUrl) ||
    typeof parsed.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.token) ||
    !Number.isInteger(parsed.pid)
  ) throw new Error('STORE_UNAVAILABLE')
  return parsed as Rendezvous
}
