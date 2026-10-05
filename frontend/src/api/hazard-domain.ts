import { allRows, listRows, resetCacheToSnapshot, saveRows, saveRowsBatch } from '@/data/local-store'
import { ALL_TOWNSHIPS } from '@/stores/session'
import type {
  ConfirmResult,
  EntryRow,
  HazardDetail,
  OperatorContext,
  ZoneCell,
  ZoneMatrix,
} from '@/data/types'

// ===== 主归属口径 =====
// 同一隐患点的「灾害类型」字段允许用分号/顿号/逗号/斜杠登记多种类型（如「滑坡;泥石流」）。
// 铺格子时每个隐患点只能有一个主归属，按下表固定优先级取第一个命中的标准类型，
// 其余命中的类型作为兼涉类型保留在详情里，不在矩阵中重复计数。
const PRIMARY_TYPE_PRIORITY = [
  '滑坡',
  '崩塌',
  '泥石流',
  '地面塌陷',
  '地裂缝',
  '地面沉降',
  '不稳定斜坡',
] as const
// 同义写法归一到标准类型名。
const TYPE_ALIASES: Record<string, string> = {
  垮塌: '崩塌',
  崩落: '崩塌',
  塌方: '滑坡',
  山崩: '崩塌',
  裂缝: '地裂缝',
  沉降: '地面沉降',
  沉陷: '地面塌陷',
  斜坡: '不稳定斜坡',
  危岩: '崩塌',
}
export const OTHER_TYPE = '其他'
const TYPE_SPLITTER = /[;；、,，/／\s]+/

export function splitTypes(raw: unknown): string[] {
  return String(raw ?? '')
    .split(TYPE_SPLITTER)
    .map((part) => part.trim())
    .filter(Boolean)
}

function normalizeType(name: string): string {
  if ((PRIMARY_TYPE_PRIORITY as readonly string[]).includes(name)) {
    return name
  }
  if (TYPE_ALIASES[name]) {
    return TYPE_ALIASES[name]
  }
  for (const standard of PRIMARY_TYPE_PRIORITY) {
    if (name.includes(standard)) {
      return standard
    }
  }
  for (const [alias, standard] of Object.entries(TYPE_ALIASES)) {
    if (name.includes(alias)) {
      return standard
    }
  }
  return ''
}

// 返回主归属类型；完全无法识别时归到「其他」，保证每点必落一格。
export function primaryDisasterType(row: EntryRow): string {
  const matched = matchedTypes(row)
  return matched[0] ?? OTHER_TYPE
}

export function matchedTypes(row: EntryRow): string[] {
  const normalized = splitTypes(row['灾害类型']).map(normalizeType).filter(Boolean)
  const unique = [...new Set(normalized)]
  return unique.sort(
    (a, b) =>
      (PRIMARY_TYPE_PRIORITY as readonly string[]).indexOf(a) -
      (PRIMARY_TYPE_PRIORITY as readonly string[]).indexOf(b),
  )
}

// ===== 待定位口径 =====
// 经纬度字段必须同时解析出合法经度（73~136）与纬度（3~54，覆盖中国陆域）；
// 为空、只填一半（如「30.245」）、填文字（如「待补充」）一律判为「待定位」。
// 待定位点仍在台账中在册，但不允许「纳入监测」——监测确认前必须补录坐标。
const COORD_SPLITTER = /[,，\s]+/

export function parseCoordinates(
  raw: unknown,
): { located: boolean; longitude: number | null; latitude: number | null } {
  const parts = String(raw ?? '')
    .split(COORD_SPLITTER)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 2) {
    return { located: false, longitude: null, latitude: null }
  }
  const longitude = Number(parts[0])
  const latitude = Number(parts[1])
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < 73 ||
    longitude > 136 ||
    latitude < 3 ||
    latitude > 54
  ) {
    return { located: false, longitude: null, latitude: null }
  }
  return { located: true, longitude, latitude }
}

export function isLocated(row: EntryRow): boolean {
  return parseCoordinates(row['经纬度坐标']).located
}

function toCount(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0
}

// ===== 危险度分区图 =====
export function hazardRows(): EntryRow[] {
  return listRows('hazard')
}

function isTreatedStatus(status: string): boolean {
  return status === '已治理' || status === '已核销'
}

function emptyMetrics() {
  return { registered: 0, monitoring: 0, treated: 0, threatened: 0, pendingLocate: 0, total: 0 }
}

export function buildZoneMatrix(filters: Record<string, string> = {}): ZoneMatrix {
  const rows = applyHazardFilters(hazardRows(), filters)
  const grouped = new Map<string, ZoneCell>()
  const townships: string[] = []
  const types = new Set<string>()

  for (const row of rows) {
    const township = String(row['所在乡镇'] ?? '未知乡镇').trim() || '未知乡镇'
    const type = primaryDisasterType(row)
    if (!townships.includes(township)) {
      townships.push(township)
    }
    types.add(type)
    const key = `${township}__${type}`
    let cell = grouped.get(key)
    if (!cell) {
      cell = { township, disasterType: type, metrics: emptyMetrics() }
      grouped.set(key, cell)
    }
    const status = String(row.status)
    cell.metrics.total += 1
    cell.metrics.registered += 1
    if (status === '监测中') {
      cell.metrics.monitoring += 1
    }
    if (isTreatedStatus(status)) {
      cell.metrics.treated += 1
    }
    if (!isLocated(row)) {
      cell.metrics.pendingLocate += 1
    } else {
      // 已治理/已核销点威胁已解除，受威胁人口只统计仍在册或监测中的点。
      if (!isTreatedStatus(status)) {
        cell.metrics.threatened += toCount(row['威胁人口'])
      }
    }
  }

  const orderedTownships = [
    ...ALL_TOWNSHIPS.filter((name) => townships.includes(name)),
    ...townships.filter((name) => !ALL_TOWNSHIPS.includes(name)),
  ]
  const orderedTypes = [
    ...(PRIMARY_TYPE_PRIORITY as readonly string[]).filter((name) => types.has(name)),
    ...(types.has(OTHER_TYPE) ? [OTHER_TYPE] : []),
  ]
  const cells = orderedTownships.flatMap((township) =>
    orderedTypes
      .map((type) => grouped.get(`${township}__${type}`))
      .filter((cell): cell is ZoneCell => Boolean(cell)),
  )
  const total = cells.reduce(
    (acc, cell) => ({
      registered: acc.registered + cell.metrics.registered,
      monitoring: acc.monitoring + cell.metrics.monitoring,
      treated: acc.treated + cell.metrics.treated,
      threatened: acc.threatened + cell.metrics.threatened,
      pendingLocate: acc.pendingLocate + cell.metrics.pendingLocate,
      total: acc.total + cell.metrics.total,
    }),
    emptyMetrics(),
  )
  return { townships: orderedTownships, disasterTypes: orderedTypes, cells, total }
}

export function pointsInZone(township: string, type: string): EntryRow[] {
  return hazardRows().filter(
    (row) =>
      String(row['所在乡镇'] ?? '') === township && primaryDisasterType(row) === type,
  )
}

export function listHazardPoints(filters: Record<string, string> = {}): EntryRow[] {
  return applyHazardFilters(hazardRows(), filters)
}

// 分区图自带的筛选：乡镇、灾害类型按主归属精确过滤，其余字段沿用模糊匹配。
function applyHazardFilters(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => {
      const keyword = value.trim()
      if (field === '所在乡镇') {
        return String(row[field] ?? '') === keyword
      }
      if (field === '灾害类型') {
        return primaryDisasterType(row) === keyword || splitTypes(row['灾害类型']).some((part) => part.includes(keyword))
      }
      return String(row[field] ?? '').includes(keyword)
    }),
  )
}

export function getHazardDetail(id: number): HazardDetail | null {
  const row = hazardRows().find((item) => Number(item.id) === id)
  if (!row) {
    return null
  }
  const coord = parseCoordinates(row['经纬度坐标'])
  const code = String(row['隐患点编号'] ?? '')
  return {
    row,
    primaryType: primaryDisasterType(row),
    matchedTypes: matchedTypes(row),
    located: coord.located,
    longitude: coord.longitude,
    latitude: coord.latitude,
    devices: listRows('device').filter((device) => String(device['所属隐患点'] ?? '') === code),
    checkSheet:
      listRows('device_check').find((sheet) => String(sheet['隐患点编号'] ?? '') === code) ?? null,
  }
}

// 危险度定级（格内）：仅在册/监测中点参与定级，已治理核销点不抬高危险度。
export function riskLevel(metrics: ZoneCell['metrics']): 'high' | 'medium' | 'low' | 'none' {
  const active = metrics.registered - metrics.treated
  if (metrics.threatened >= 80 || (metrics.monitoring > 0 && active >= 3)) {
    return 'high'
  }
  if (metrics.threatened >= 30 || active >= 2 || metrics.pendingLocate > 0) {
    return 'medium'
  }
  return active > 0 ? 'low' : 'none'
}

export const RISK_LEVEL_LABEL: Record<ReturnType<typeof riskLevel>, string> = {
  high: '高危险度',
  medium: '中危险度',
  low: '低危险度',
  none: '无在册点',
}

// ===== 辖区管控 =====
export function townshipOf(key: string, row: EntryRow): string {
  if (key === 'hazard') {
    return String(row['所在乡镇'] ?? '')
  }
  if (key === 'device_check') {
    return String(row['所在乡镇'] ?? '')
  }
  // 设备/阈值/巡查等模块只登记了隐患点编号：反查隐患点所在乡镇，
  // 保证跨区域人员通过设备台账也改不到别处的绑定数据。
  const codeField =
    key === 'device'
      ? '所属隐患点'
      : typeof row['隐患点编号'] === 'string'
        ? '隐患点编号'
        : ''
  const code = codeField ? String(row[codeField] ?? '') : ''
  const owner = code
    ? hazardRows().find((item) => String(item['隐患点编号'] ?? '') === code)
    : undefined
  return owner ? String(owner['所在乡镇'] ?? '') : ''
}

export function assertWithinScope(key: string, row: EntryRow, operator: OperatorContext): void {
  const township = townshipOf(key, row)
  if (!township) {
    return // 无法判定归属的历史记录不拦截，避免把跨模块反查失败误判成越权
  }
  if (!operator.townships.includes(township)) {
    throw new Error(
      `「${township}」不在${operator.operator}的辖区（${operator.townships.join('、') || '无'}）内，不能改动该数据`,
    )
  }
}

// ===== 并发确认：同一点只留一版 =====
// 纯前端没有数据库事务，用「正在确认中的隐患点 id 集合」做互斥；
// 动作内部以先快照、后批量落库、任一步失败整体回滚快照的方式保证台账与核查单同成同败。
const confirming = new Set<number>()

function recommendDeviceTypes(type: string): string[] {
  switch (type) {
    case '滑坡':
    case '不稳定斜坡':
      return ['GNSS位移监测站', '倾角传感器']
    case '崩塌':
      return ['倾角传感器', '裂缝计']
    case '泥石流':
      return ['一体化雨量站', '泥位计']
    case '地面塌陷':
    case '地面沉降':
      return ['GNSS位移监测站', '静力水准仪']
    case '地裂缝':
      return ['裂缝计']
    default:
      return ['GNSS位移监测站']
  }
}

function nextCheckId(existing: EntryRow[]): number {
  return existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function checkCode(id: number): string {
  return `CHK-${String(id).padStart(4, '0')}`
}

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

// 监测确认：台账状态回写 + 监测设备台账侧同步生成安装核查单，一个事务。
export function confirmMonitoring(
  id: number,
  operator: OperatorContext,
): ConfirmResult {
  if (confirming.has(id)) {
    return { ok: false, message: '该隐患点正在被其他操作确认，并发确认只保留一版，请稍后刷新查看' }
  }
  confirming.add(id)
  const cacheSnapshot = JSON.parse(JSON.stringify(allRows())) as Record<string, EntryRow[]>
  const hazardSnapshot = cacheSnapshot.hazard.map((row) => ({ ...row }))
  const checkSnapshot = (cacheSnapshot.device_check ?? []).map((row) => ({ ...row }))
  try {
    const index = hazardSnapshot.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的隐患点` }
    }
    const row = hazardSnapshot[index]
    assertWithinScope('hazard', row, operator)

    const status = String(row.status)
    const code = String(row['隐患点编号'] ?? '')
    const existing = checkSnapshot.find((sheet) => String(sheet['隐患点编号'] ?? '') === code)
    if (status === '已治理' || status === '已核销') {
      return { ok: false, message: `隐患点已是「${status}」，不能再纳入监测` }
    }
    // 幂等：已在监测中且核查单已存在（并发确认的另一路胜出，或人工重复点击）时，
    // 返回成功并回带同一版核查单，不重复建档、不重复回写。
    if (status === '监测中') {
      if (existing) {
        return {
          ok: true,
          message: '隐患点已在监测中，安装核查单已存在，沿用同一版不重复建档',
          checkSheet: existing,
        }
      }
      return { ok: false, message: '隐患点已是「监测中」，不用重复操作' }
    }
    if (!isLocated(row)) {
      return {
        ok: false,
        message: '该隐患点缺少有效经纬度，属于待定位点，请先补录坐标再纳入监测',
      }
    }

    if (existing) {
      // 状态曾被人工退回在册、再次确认时复用同一版核查单。
      hazardSnapshot[index] = { ...row, status: '监测中', pending: true, abnormal: false }
      saveRowsBatch({
        hazard: hazardSnapshot,
        device_check: checkSnapshot,
      })
      return {
        ok: true,
        message: '隐患点已纳入监测，安装核查单此前已生成，沿用原核查单不重复建档',
        checkSheet: existing,
      }
    }

    const primary = primaryDisasterType(row)
    const checkId = nextCheckId(checkSnapshot)
    const sheet: EntryRow = {
      id: checkId,
      status: '待核查',
      pending: true,
      abnormal: false,
      核查单编号: checkCode(checkId),
      隐患点编号: code,
      隐患点名称: String(row['隐患点名称'] ?? ''),
      所在乡镇: String(row['所在乡镇'] ?? ''),
      建议设备类型: recommendDeviceTypes(primary).join('、'),
      安装点位: String(row['经纬度坐标'] ?? ''),
      核查状态: '待现场核查安装点位',
      生成时间: nowText(),
      确认人: operator.operator,
    }

    hazardSnapshot[index] = { ...row, status: '监测中', pending: true, abnormal: false }
    // 批量落库：localStorage 写失败时 saveRowsBatch 会先回滚内存快照，这里再兜底回滚一次。
    saveRowsBatch({
      hazard: hazardSnapshot,
      device_check: [...checkSnapshot, sheet],
    })
    return {
      ok: true,
      message: `隐患点已纳入监测，已在监测设备台账同步生成安装核查单 ${sheet['核查单编号']}`,
      checkSheet: sheet,
    }
  } catch (error) {
    // 补偿回滚：恢复内存快照即可。saveRowsBatch 失败时已回滚过一次，这里再兜底；
    // 不能再调 saveRows——它会再次尝试写正在报错的 localStorage。
    resetCacheToSnapshot(cacheSnapshot)
    return {
      ok: false,
      message: `监测确认失败，台账状态与安装核查单已一起回退：${error instanceof Error ? error.message : '未知错误'}`,
    }
  } finally {
    confirming.delete(id)
  }
}

// 补录坐标：待定位点的唯一解锁入口；补录后仍保持原状态，由用户再发起监测确认。
export function updateCoordinates(
  id: number,
  coordinates: string,
  operator: OperatorContext,
): ConfirmResult {
  const rows = hazardRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的隐患点` }
  }
  const row = rows[index]
  assertWithinScope('hazard', row, operator)
  const coord = parseCoordinates(coordinates)
  if (!coord.located) {
    return { ok: false, message: '坐标格式不合法，请填写「经度,纬度」两个数字，且经纬度需在中国陆域范围内' }
  }
  const normalized = `${coord.longitude},${coord.latitude}`
  saveRows('hazard', rows.map((item, i) => (i === index ? { ...item, 经纬度坐标: normalized } : item)))
  return { ok: true, message: `坐标已补录（${normalized}），该点解除待定位，可纳入监测` }
}

export function listCheckSheets(filters: Record<string, string> = {}): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const rows = listRows('device_check')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) => pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())))
}
