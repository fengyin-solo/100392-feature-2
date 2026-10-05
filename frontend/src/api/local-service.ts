import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  readRowsFresh,
  releaseLock,
  resetRows,
  saveRows,
  saveRowsBatch,
  tryAcquireLock,
} from '@/data/local-store'
import { COUNTY_REGION } from '@/data/regions'
import type {
  ActionResult,
  EntryRow,
  HazardDetail,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ZoningCell,
  ZoningMatrix,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 当前值班区域：县局不限乡镇，乡镇人员只能动本乡镇的数据。由会话层同步进来。
let operatorRegion = COUNTY_REGION

export function setOperatorRegion(region: string): void {
  operatorRegion = region
}

export function getOperatorRegion(): string {
  return operatorRegion
}

// 灾害类型允许填多个（、，,/；; 分隔），主归属取登记的第一个类型，
// 分区图只把点计入主类型列，避免一个点在多个格里重复计数。
export function parseDisasterTypes(raw: string): string[] {
  return raw
    .split(/[、，,;/；]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export function primaryDisasterType(row: EntryRow): string {
  return parseDisasterTypes(String(row['灾害类型'] ?? ''))[0] ?? '未分类'
}

// 待定位规则：坐标为空、占位文本或解析不出合法经纬度（经度 73-135、纬度 3-54）都算待定位。
export function isHazardLocated(row: EntryRow): boolean {
  const raw = String(row['经纬度坐标'] ?? '').trim()
  const parts = raw.split(/[，,]/).map((item) => item.trim())
  if (parts.length !== 2) {
    return false
  }
  const lng = Number(parts[0])
  const lat = Number(parts[1])
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 73 && lng <= 135 && lat >= 3 && lat <= 54
}

// 跨区域拦截：返回 null 表示放行，否则返回拒绝原因。设备行按「所属隐患点」回溯到乡镇。
export function regionBlockReason(key: string, row: EntryRow): string | null {
  if (operatorRegion === COUNTY_REGION) {
    return null
  }
  let township: string | null = null
  if (key === 'hazard') {
    township = String(row['所在乡镇'] ?? '')
  } else if (key === 'device') {
    const hazard = listRows('hazard').find((item) => item['隐患点编号'] === row['所属隐患点'])
    // 找不到归属隐患点时无法判定区域，先放行，不臆断拦截
    township = hazard ? String(hazard['所在乡镇'] ?? '') : null
  }
  if (township && township !== operatorRegion) {
    return `当前值班区域为「${operatorRegion}」，跨区域人员不得改动${township}的数据`
  }
  return null
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 监测确认要走事务（同步生成安装核查单），不能走普通单模块回写
  if (key === 'hazard' && action === '监测确认') {
    return confirmMonitoring(id)
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const blocked = regionBlockReason(key, rows[index])
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 危险度分档：受威胁人口与在账活跃点数（在册+新增+监测中）取高者定级。
function cellRiskLevel(threatenedPopulation: number, activeCount: number): ZoningCell['riskLevel'] {
  if (activeCount === 0 && threatenedPopulation === 0) {
    return 0
  }
  if (threatenedPopulation >= 100 || activeCount >= 4) {
    return 4
  }
  if (threatenedPopulation >= 50 || activeCount >= 3) {
    return 3
  }
  if (threatenedPopulation >= 20 || activeCount >= 1) {
    return 2
  }
  return 1
}

// 分区图矩阵：乡镇 × 灾害主类型铺格子，已核销的点不进任何计数。
export function loadZoning(): ZoningMatrix {
  const rows = listRows('hazard')
  const townships = [...new Set(rows.map((row) => String(row['所在乡镇'] ?? '') || '未填乡镇'))].sort()
  const preferred = ['滑坡', '崩塌', '泥石流', '地面塌陷', '地面沉降', '地裂缝']
  const present = new Set(rows.map((row) => primaryDisasterType(row)))
  const disasterTypes = [
    ...preferred.filter((item) => present.has(item)),
    ...[...present].filter((item) => !preferred.includes(item)).sort(),
  ]
  const cells: ZoningCell[] = []
  for (const township of townships) {
    for (const disasterType of disasterTypes) {
      const inCell = rows.filter(
        (row) =>
          (String(row['所在乡镇'] ?? '') || '未填乡镇') === township &&
          primaryDisasterType(row) === disasterType,
      )
      const active = inCell.filter((row) => String(row.status) !== '已核销')
      const registered = inCell.filter((row) => ['在册', '新增'].includes(String(row.status))).length
      const monitoring = inCell.filter((row) => String(row.status) === '监测中').length
      const treated = inCell.filter((row) => String(row.status) === '已治理').length
      const threatenedPopulation = active.reduce(
        (sum, row) => sum + (Number(row['威胁人口']) || 0),
        0,
      )
      const unlocated = active.filter((row) => !isHazardLocated(row)).length
      const activeCount = registered + monitoring
      cells.push({
        township,
        disasterType,
        registered,
        monitoring,
        treated,
        threatenedPopulation,
        unlocated,
        total: inCell.length,
        riskLevel: cellRiskLevel(threatenedPopulation, activeCount),
      })
    }
  }
  return { townships, disasterTypes, cells }
}

// 格内钻取：某乡镇 × 某主类型下的全部隐患点（含已核销，页面上能看到完整台账）。
export function listZoningPoints(township: string, disasterType: string): EntryRow[] {
  return listRows('hazard').filter(
    (row) =>
      (String(row['所在乡镇'] ?? '') || '未填乡镇') === township &&
      primaryDisasterType(row) === disasterType,
  )
}

// 单点钻取：台账行 + 设备绑定（所属隐患点 = 隐患点编号）+ 安装核查单。
export function loadHazardDetail(id: number): HazardDetail | null {
  const row = listRows('hazard').find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  const code = String(row['隐患点编号'])
  const bound = listRows('device').filter((item) => item['所属隐患点'] === code)
  return {
    row,
    primaryType: primaryDisasterType(row),
    located: isHazardLocated(row),
    devices: bound.filter((item) => item['设备类型'] !== '安装核查单'),
    checkForms: bound.filter((item) => item['设备类型'] === '安装核查单'),
    regionBlocked: regionBlockReason('hazard', row),
  }
}

// 监测确认：台账转「监测中」并在监测设备台账同步生成安装核查单。
// 跨区域拦截、待定位拦截、版本校验（并发确认只留一版），失败时两边一起回退。
export function confirmMonitoring(id: number, expectedVersion?: number): ActionResult {
  if (!tryAcquireLock('hazard-confirm')) {
    return { ok: false, message: '另一窗口正在执行监测确认，并发确认只保留一版，请稍后重试' }
  }
  try {
    const hazards = readRowsFresh('hazard')
    const index = hazards.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的隐患点` }
    }
    const row = hazards[index]
    const blocked = regionBlockReason('hazard', row)
    if (blocked) {
      return { ok: false, message: blocked }
    }
    if (String(row.status) === '监测中') {
      return { ok: false, message: '隐患点已经是「监测中」，不用重复操作' }
    }
    if (!['在册', '新增'].includes(String(row.status))) {
      return { ok: false, message: `当前状态「${row.status}」不允许监测确认` }
    }
    if (!isHazardLocated(row)) {
      return { ok: false, message: '该隐患点缺经纬度，属待定位，先补测坐标再做监测确认' }
    }
    const version = Number(row.version ?? 1)
    if (expectedVersion !== undefined && expectedVersion !== version) {
      return { ok: false, message: '该隐患点刚被其他端更新，并发确认只保留一版，请刷新后重试' }
    }
    const devices = readRowsFresh('device')
    const hazardCode = String(row['隐患点编号'])
    const hasOpenForm = devices.some(
      (item) =>
        item['所属隐患点'] === hazardCode && item['设备类型'] === '安装核查单' && item.status === '待核查',
    )
    if (hasOpenForm) {
      return { ok: false, message: '该隐患点已存在待核查的安装核查单，不能重复生成' }
    }
    const nextId = devices.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
    const checkForm: EntryRow = {
      id: nextId,
      status: '待核查',
      pending: true,
      abnormal: false,
      设备编号: `VERI-${String(nextId).padStart(4, '0')}`,
      设备类型: '安装核查单',
      所属隐患点: hazardCode,
      安装日期: new Date().toISOString().slice(0, 10),
      最近维护日: '—',
      电池余量: '—',
      通讯状态: '待安装',
      设备状态: '待核查',
    }
    const nextHazards = [...hazards]
    nextHazards[index] = { ...row, status: '监测中', pending: true, abnormal: false, version: version + 1 }
    try {
      saveRowsBatch({ hazard: nextHazards, device: [...devices, checkForm] })
    } catch {
      return { ok: false, message: '写入失败，隐患点台账与安装核查单已一起回退' }
    }
    return {
      ok: true,
      message: `隐患点已监测确认，当前状态「监测中」，已同步生成安装核查单 ${checkForm['设备编号']}`,
    }
  } finally {
    releaseLock('hazard-confirm')
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
