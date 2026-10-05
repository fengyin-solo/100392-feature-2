import { SEED_ROWS, SEED_VERSION } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'
const VERSION_KEY = 'geohazard-monitor-prevention:version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeAll(data: Record<string, EntryRow[]>): void {
  cache = data
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    window.localStorage.setItem(VERSION_KEY, String(SEED_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeAll(fallback)
    return fallback
  }
  // 种子结构升级（字段口径变化）后，旧缓存整体作废，用新种子重新播种；
  // 用户的运行期数据没有独立后端，清缓存回种子是 README 已声明的口径。
  const storedVersion = Number(window.localStorage.getItem(VERSION_KEY) ?? '0')
  if (storedVersion !== SEED_VERSION) {
    writeAll(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    writeAll(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  writeAll({ ...allRows(), [key]: rows })
}

// 跨模块事务写：一次落多个模块，写 localStorage 失败时整体回滚到调用前快照。
export function saveRowsBatch(patch: Record<string, EntryRow[]>): void {
  const snapshot = allRows()
  const next = { ...snapshot, ...patch }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      window.localStorage.setItem(VERSION_KEY, String(SEED_VERSION))
    } catch (error) {
      cache = snapshot
      throw error
    }
  }
}

// 事务补偿：只把内存缓存恢复到调用前快照，不再碰 localStorage（存储本身可能正在报错）。
export function resetCacheToSnapshot(snapshot: Record<string, EntryRow[]>): void {
  cache = snapshot
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
