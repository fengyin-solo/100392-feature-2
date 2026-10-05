/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 危险度分区图的一个格子：乡镇 × 灾害主类型。 */
export type ZoningCell = {
  township: string
  disasterType: string
  /** 在册数：状态为「在册」或「新增」的隐患点 */
  registered: number
  monitoring: number
  /** 治理数：状态为「已治理」的隐患点 */
  treated: number
  /** 受威胁人口：格内未核销隐患点的威胁人口合计 */
  threatenedPopulation: number
  /** 缺经纬度、待定位的隐患点数 */
  unlocated: number
  total: number
  /** 0=空 1=低 2=中 3=高 4=极高 */
  riskLevel: 0 | 1 | 2 | 3 | 4
}

export type ZoningMatrix = {
  townships: string[]
  disasterTypes: string[]
  cells: ZoningCell[]
}

/** 单点钻取详情：台账行 + 主归属/定位判定 + 设备绑定与核查单。 */
export type HazardDetail = {
  row: EntryRow
  primaryType: string
  located: boolean
  devices: EntryRow[]
  checkForms: EntryRow[]
  regionBlocked: string | null
}
