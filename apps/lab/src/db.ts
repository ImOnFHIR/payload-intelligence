// SPDX-License-Identifier: Apache-2.0

import type { SmeEvaluationRecord } from '@imonfhir/payload-contracts'

const DB_NAME = 'imonfhir-payload-intelligence-preview'
const STORE_NAME = 'sanitized-evaluations'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'recordId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  })
}

export async function listRecords(): Promise<SmeEvaluationRecord[]> {
  const database = await openDatabase()
  return await new Promise<SmeEvaluationRecord[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve((request.result as SmeEvaluationRecord[]).sort((a, b) => a.recordId.localeCompare(b.recordId)))
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}

export async function saveRecord(record: SmeEvaluationRecord): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}

export async function clearRecords(): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}
