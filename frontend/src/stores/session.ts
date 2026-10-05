import { defineStore } from 'pinia'

// 辖区口径：写操作只允许落在本人所辖乡镇；选「全县联动」时可写全部乡镇。
// 纯前端演示态，选择结果存 localStorage，刷新后保持。
const TOWNSHIP_STORAGE_KEY = 'geohazard-monitor-prevention:townships'

export const ALL_TOWNSHIPS = ['青龙镇', '白沙乡', '云岭镇', '河谷乡']

function loadTownships(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return ALL_TOWNSHIPS
  }
  const raw = window.localStorage.getItem(TOWNSHIP_STORAGE_KEY)
  if (!raw) {
    return ALL_TOWNSHIPS
  }
  try {
    const parsed = JSON.parse(raw) as string[]
    const valid = parsed.filter((item) => ALL_TOWNSHIPS.includes(item))
    return valid.length ? valid : ALL_TOWNSHIPS
  } catch {
    return ALL_TOWNSHIPS
  }
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '地质灾害隐患点监测防治管理系统',
    townships: loadTownships(),
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    scopeLabel: (state) =>
      state.townships.length === ALL_TOWNSHIPS.length ? '全县联动' : state.townships.join('、'),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTownships(townships: string[]) {
      this.townships = townships.length
        ? ALL_TOWNSHIPS.filter((item) => townships.includes(item))
        : [...ALL_TOWNSHIPS]
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(TOWNSHIP_STORAGE_KEY, JSON.stringify(this.townships))
      }
    },
  },
})
