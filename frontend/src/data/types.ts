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

// ===== 隐患点危险度分区图 / 监测确认相关类型 =====

export type ZoneCellMetrics = {
  registered: number
  monitoring: number
  treated: number
  threatened: number
  pendingLocate: number
  total: number
}

export type ZoneCell = {
  township: string
  disasterType: string
  metrics: ZoneCellMetrics
}

export type ZoneMatrix = {
  townships: string[]
  disasterTypes: string[]
  cells: ZoneCell[]
  total: ZoneCellMetrics
}

export type HazardDetail = {
  row: EntryRow
  primaryType: string
  matchedTypes: string[]
  located: boolean
  longitude: number | null
  latitude: number | null
  devices: EntryRow[]
  checkSheet: EntryRow | null
}

export type ConfirmResult = ActionResult & {
  checkSheet?: EntryRow
}

export type OperatorContext = {
  operator: string
  townships: string[]
}

