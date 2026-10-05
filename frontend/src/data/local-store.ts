import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
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

// 绕开模块缓存直接读 localStorage：并发确认前必须拿到别的标签页刚写入的最新版本。
export function readRowsFresh(key: string): EntryRow[] {
  return readStorage()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

// 跨模块原子写：以 localStorage 里的最新内容为基座合并，一次 setItem 落全部改动；
// 任何一步抛错就把基座写回去，保证「隐患点台账」和「监测设备台账」要么一起生效、要么一起回退。
export function saveRowsBatch(entries: Record<string, EntryRow[]>): void {
  const base =
    typeof window !== 'undefined' && window.localStorage ? readStorage() : allRows()
  const next = { ...base, ...entries }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch (error) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(base))
      } catch {
        // 基座也写不回时只能保持现状，由调用方报失败
      }
      throw error
    }
  }
  cache = next
}

// 跨标签页咨询锁：并发确认只留一版。锁带时间戳，持有者崩溃 5 秒后自动失效。
const LOCK_PREFIX = `${STORAGE_KEY}:lock:`
const LOCK_TTL_MS = 5000

export function tryAcquireLock(name: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return true
  }
  const key = LOCK_PREFIX + name
  try {
    const raw = window.localStorage.getItem(key)
    if (raw !== null && Date.now() - Number(raw) < LOCK_TTL_MS) {
      return false
    }
    window.localStorage.setItem(key, String(Date.now()))
    return true
  } catch {
    // 存储不可写时宁可拒绝，也不能在拿不到锁的情况下放行进度的写
    return false
  }
}

export function releaseLock(name: string): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.removeItem(LOCK_PREFIX + name)
  } catch {
    // 锁有 5 秒过期兜底，释放失败不影响后续流程
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
