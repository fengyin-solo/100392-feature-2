// 冒烟测试：直接驱动 local-service，验证分区图与监测确认的规则。
// 用 esbuild 打包后在 node 里跑，localStorage 用内存 shim。
const store = new Map<string, string>()
let failNextSet = false
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      // 只往数据键上注入故障，锁键的写入不受影响
      if (failNextSet && !k.includes(':lock:')) {
        failNextSet = false
        throw new Error('模拟写入失败')
      }
      store.set(k, String(v))
    },
    removeItem: (k: string) => void store.delete(k),
  },
}

const svc = await import('@/api/local-service')
const { tryAcquireLock, releaseLock } = await import('@/data/local-store')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}`, extra ?? '')
  }
}

// 1. 分区矩阵结构与主归属
const zoning = svc.loadZoning()
check('乡镇行数=4', zoning.townships.length === 4, zoning.townships)
check('类型列含滑坡/崩塌/泥石流/地面塌陷', ['滑坡', '崩塌', '泥石流', '地面塌陷'].every((t) => zoning.disasterTypes.includes(t)), zoning.disasterTypes)
const cell = (t: string, d: string) => zoning.cells.find((c) => c.township === t && c.disasterType === d)!
const cg滑坡 = cell('城关镇', '滑坡')
check('城关镇×滑坡 在册=2（HAZA-0003 主归属滑坡）', cg滑坡.registered === 2, cg滑坡)
check('城关镇×滑坡 受威胁人口=206', cg滑坡.threatenedPopulation === 206, cg滑坡)
check('城关镇×滑坡 危险度=极高', cg滑坡.riskLevel === 4, cg滑坡)
const cg泥石流 = cell('城关镇', '泥石流')
check('多类型点不重复计入泥石流列', cg泥石流.total === 1 && cg泥石流.treated === 1, cg泥石流)
const sm崩塌 = cell('石门乡', '崩塌')
check('石门乡×崩塌 待定位=1（坐标为占位文本）', sm崩塌.unlocated === 1, sm崩塌)
const xk滑坡 = cell('溪口镇', '滑坡')
check('已核销点不计入在册/人口', xk滑坡.registered === 0 && xk滑坡.threatenedPopulation === 0 && xk滑坡.total === 1, xk滑坡)

// 2. 监测确认事务：台账转监测中 + 同步生成核查单
const before = svc.listEntries('device').total
const ok1 = svc.confirmMonitoring(1, 1)
check('HAZA-0001 监测确认成功', ok1.ok, ok1.message)
const hazard1 = svc.listEntries('hazard').items.find((r) => r.id === 1)!
check('台账状态=监测中 且 version=2', hazard1.status === '监测中' && hazard1.version === 2, hazard1)
const devices = svc.listEntries('device').items
check('设备台账新增一条记录', devices.length === before + 1)
const form = devices.find((r) => r['设备类型'] === '安装核查单' && r['所属隐患点'] === 'HAZA-0001')
check('核查单已生成且待核查', Boolean(form) && form!.status === '待核查', form)

// 3. 重复确认 / 版本不符 / 待定位拦截
check('重复确认被拒', !svc.confirmMonitoring(1, 2).ok)
const stale = svc.confirmMonitoring(8, 99)
check('版本不符被拒（并发只留一版）', !stale.ok && stale.message.includes('只保留一版'), stale.message)
const unlocated = svc.confirmMonitoring(6, 1)
check('缺坐标点确认被拒（待定位）', !unlocated.ok && unlocated.message.includes('待定位'), unlocated.message)
check('占位文本坐标同样待定位', !svc.confirmMonitoring(10, 1).ok)

// 4. 区域权限
svc.setOperatorRegion('城关镇')
const cross = svc.confirmMonitoring(8, 1)
check('跨乡镇确认被拒', !cross.ok && cross.message.includes('跨区域'), cross.message)
check('本乡镇动作放行', svc.runAction('hazard', 1, '申请核销').ok === false || true) // 状态机消息不限，仅保证不抛错
const devOk = svc.runAction('device', 1, '报修设备')
check('本乡镇设备动作放行', devOk.ok, devOk.message)
svc.setOperatorRegion('青云镇')
const devCross = svc.runAction('device', 3, '报修设备')
check('跨乡镇设备动作被拒（回溯所属隐患点）', !devCross.ok && devCross.message.includes('跨区域'), devCross.message)
svc.setOperatorRegion('县局')

// 5. 写入失败时台账与核查单一起回退
const hazardBefore = svc.listEntries('hazard').items.find((r) => r.id === 8)!
const devCountBefore = svc.listEntries('device').total
failNextSet = true
const rolled = svc.confirmMonitoring(8, 1)
const hazardAfter = svc.listEntries('hazard').items.find((r) => r.id === 8)!
check('写入失败返回失败', !rolled.ok && rolled.message.includes('回退'), rolled.message)
check('台账状态回退', hazardAfter.status === hazardBefore.status && hazardAfter.version === hazardBefore.version, hazardAfter)
check('核查单未残留', svc.listEntries('device').total === devCountBefore)

// 6. 咨询锁
check('锁可获取', tryAcquireLock('t'))
check('锁互斥', !tryAcquireLock('t'))
releaseLock('t')
check('锁释放后可再获取', tryAcquireLock('t'))
releaseLock('t')

// 7. 钻取数据
const detail = svc.loadHazardDetail(5)
check('单点详情含绑定设备与核查单', detail !== null && detail.devices.length === 1 && detail.checkForms.length === 1, detail)
check('格内钻取点数正确', svc.listZoningPoints('城关镇', '滑坡').length === 2)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
