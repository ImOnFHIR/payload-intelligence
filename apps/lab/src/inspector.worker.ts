// SPDX-License-Identifier: Apache-2.0

/// <reference lib="webworker" />

import { projectInspection } from '@imonfhir/payload-contracts'
import { inspectPayload, MAX_PAYLOAD_BYTES } from '@imonfhir/payload-core'

type Request =
  | { kind: 'file'; file: File }
  | { kind: 'sample'; url: string; fileName: string; contentType: string }

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<Request>) => {
  let bytes: Uint8Array | undefined
  try {
    let buffer: ArrayBuffer
    let context: { fileName: string; contentType?: string }
    if (event.data.kind === 'file') {
      if (event.data.file.size > MAX_PAYLOAD_BYTES) throw new Error('PAYLOAD_SIZE_LIMIT_EXCEEDED')
      buffer = await event.data.file.arrayBuffer()
      context = {
        fileName: event.data.file.name,
        ...(event.data.file.type ? { contentType: event.data.file.type } : {}),
      }
    } else {
      const response = await fetch(event.data.url, { cache: 'no-store', credentials: 'same-origin' })
      if (!response.ok) throw new Error('SAMPLE_UNAVAILABLE')
      const length = Number(response.headers.get('content-length') ?? '0')
      if (length > MAX_PAYLOAD_BYTES) throw new Error('PAYLOAD_SIZE_LIMIT_EXCEEDED')
      buffer = await response.arrayBuffer()
      context = { fileName: event.data.fileName, contentType: event.data.contentType }
    }
    if (buffer.byteLength > MAX_PAYLOAD_BYTES) throw new Error('PAYLOAD_SIZE_LIMIT_EXCEEDED')
    bytes = new Uint8Array(buffer)
    const inspection = await inspectPayload(bytes, context)
    const material = projectInspection(inspection)
    self.postMessage({ ok: true, material })
  } catch (error) {
    const allowed = new Set(['PAYLOAD_SIZE_LIMIT_EXCEEDED', 'SAMPLE_UNAVAILABLE'])
    const candidate = error instanceof Error ? error.message : 'INSPECTION_FAILED'
    self.postMessage({ ok: false, error: allowed.has(candidate) ? candidate : 'INSPECTION_FAILED' })
  } finally {
    bytes?.fill(0)
    self.close()
  }
}
