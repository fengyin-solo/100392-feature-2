import { defineStore } from 'pinia'

import { setOperatorRegion } from '@/api/local-service'
import { COUNTY_REGION } from '@/data/regions'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '地质灾害隐患点监测防治管理系统',
    // 值班区域：县局可动全部乡镇，乡镇人员跨区域改动会被服务层拦截
    region: COUNTY_REGION,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRegion(region: string) {
      this.region = region
      setOperatorRegion(region)
    },
  },
})
