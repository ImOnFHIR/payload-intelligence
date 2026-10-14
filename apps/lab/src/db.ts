// SPDX-License-Identifier: Apache-2.0

import {
  smeEvaluationRecordSchema,
  smeEvaluationRecordSchemaV1,
  type LegacySmeEvaluationRecord,
  type SmeEvaluationRecord,
} from '@imonfhir/payload-contracts'

const DB_NAME = 'imonfhir-payload-intelligence-preview'
const LEGACY_STORE_NAME = 'sanitized-evaluations'
const V2_STORE_NAME = 'sanitized-evaluations-v2'
const DB_VERSION = 2

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        request.result.createObjectStore(LEGACY_STORE_NAME, { keyPath: 'recordId' })
      }
      if (!request.result.objectStoreNames.contains(V2_STORE_NAME)) {
        request.result.createObjectStore(V2_STORE_NAME, { keyPath: 'recordId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  })
}

export async function listRecords(): Promise<SmeEvaluationRecord[]> {
  const database = await openDatabase()
  return await new Promise<SmeEvaluationRecord[]>((resolve, reject) => {
    const request = database.transaction(V2_STORE_NAME, 'readonly').objectStore(V2_STORE_NAME).getAll()
    request.onsuccess = () => {
      try {
        resolve(request.result.map((row) => smeEvaluationRecordSchema.parse(row) as SmeEvaluationRecord)
          .sort((a, b) => a.recordId.localeCompare(b.recordId)))
      } catch { reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE')) }
    }
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}

export async function saveRecord(record: SmeEvaluationRecord): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const validated = smeEvaluationRecordSchema.parse(record) as SmeEvaluationRecord
    const request = database.transaction(V2_STORE_NAME, 'readwrite').objectStore(V2_STORE_NAME).put(validated)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}

export async function clearRecords(): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(V2_STORE_NAME, 'readwrite').objectStore(V2_STORE_NAME).clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}

export async function listLegacyRecords(): Promise<LegacySmeEvaluationRecord[]> {
  const database = await openDatabase()
  return await new Promise<LegacySmeEvaluationRecord[]>((resolve, reject) => {
    const request = database.transaction(LEGACY_STORE_NAME, 'readonly').objectStore(LEGACY_STORE_NAME).getAll()
    request.onsuccess = () => {
      try {
        resolve(request.result.map((row) => smeEvaluationRecordSchemaV1.parse(row) as LegacySmeEvaluationRecord)
          .sort((a, b) => a.recordId.localeCompare(b.recordId)))
      } catch { reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE')) }
    }
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}

export async function clearLegacyRecords(): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(LEGACY_STORE_NAME, 'readwrite').objectStore(LEGACY_STORE_NAME).clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('LOCAL_RECORD_STORE_UNAVAILABLE'))
  }).finally(() => database.close())
}
