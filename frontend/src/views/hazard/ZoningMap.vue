<template>
  <section class="zoning">
    <header class="zoning-head">
      <h3>危险度分区图</h3>
      <nav class="breadcrumb">
        <button class="link" type="button" :disabled="level === 'matrix'" @click="backToMatrix">全县矩阵</button>
        <template v-if="level !== 'matrix'">
          <span>/</span>
          <button class="link" type="button" :disabled="level === 'cell'" @click="backToCell">
            {{ selectedTownship }} · {{ selectedType }}
          </button>
        </template>
        <template v-if="level === 'point' && detail">
          <span>/</span>
          <span>{{ detail.row['隐患点名称'] }}</span>
        </template>
      </nav>
    </header>

    <p class="zoning-note">
      同一隐患点符合多种灾害类型时，按登记的第一个类型归属统计；缺经纬度的点标记「待定位」，需补测后才能监测确认。
    </p>

    <!-- 第一级：乡镇 × 灾害类型矩阵 -->
    <template v-if="level === 'matrix'">
      <table class="data-table zoning-matrix">
        <thead>
          <tr>
            <th>乡镇 \ 灾害类型</th>
            <th v-for="type in matrix.disasterTypes" :key="type">{{ type }}</th>
            <th>合计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="township in matrix.townships" :key="township">
            <th>{{ township }}</th>
            <td v-for="type in matrix.disasterTypes" :key="type" class="zoning-td">
              <button
                v-if="cellOf(township, type).total > 0"
                type="button"
                class="zoning-cell"
                :class="`risk-${cellOf(township, type).riskLevel}`"
                @click="drillCell(township, type)"
              >
                <span class="cell-nums">
                  在册 {{ cellOf(township, type).registered }} · 监测中 {{ cellOf(township, type).monitoring }} ·
                  治理 {{ cellOf(township, type).treated }}
                </span>
                <span class="cell-pop">受威胁人口 {{ cellOf(township, type).threatenedPopulation }}</span>
                <span v-if="cellOf(township, type).unlocated > 0" class="cell-flag">
                  待定位 {{ cellOf(township, type).unlocated }}
                </span>
              </button>
              <span v-else class="cell-empty">—</span>
            </td>
            <td class="zoning-total">
              在册 {{ rowTotal(township).registered }} · 监测中 {{ rowTotal(township).monitoring }} · 治理
              {{ rowTotal(township).treated }} · 人口 {{ rowTotal(township).threatenedPopulation }}
            </td>
          </tr>
          <tr class="zoning-total-row">
            <th>合计</th>
            <td v-for="type in matrix.disasterTypes" :key="type">
              在册 {{ colTotal(type).registered }} · 监测中 {{ colTotal(type).monitoring }} · 治理
              {{ colTotal(type).treated }} · 人口 {{ colTotal(type).threatenedPopulation }}
            </td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
      <p class="risk-legend">
        危险度：
        <span class="legend-item risk-1">低</span>
        <span class="legend-item risk-2">中</span>
        <span class="legend-item risk-3">高</span>
        <span class="legend-item risk-4">极高</span>
        <span class="legend-note">（按格内受威胁人口与在账活跃点数分档，点击格子逐级钻取）</span>
      </p>
    </template>

    <!-- 第二级：格内隐患点列表 -->
    <template v-else-if="level === 'cell'">
      <table class="data-table">
        <thead>
          <tr>
            <th>隐患点编号</th>
            <th>隐患点名称</th>
            <th>灾害类型</th>
            <th>威胁人口</th>
            <th>定位</th>
            <th>当前状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in cellPoints" :key="String(point.id)">
            <td>{{ point['隐患点编号'] }}</td>
            <td>{{ point['隐患点名称'] }}</td>
            <td>{{ point['灾害类型'] }}</td>
            <td>{{ point['威胁人口'] }}</td>
            <td>
              <span v-if="isLocated(point)" class="tag ok">已定位</span>
              <span v-else class="tag warn">待定位</span>
            </td>
            <td>{{ point.status }}</td>
            <td>
              <button class="link" type="button" @click="drillPoint(Number(point.id))">查看单点</button>
            </td>
          </tr>
          <tr v-if="!cellPoints.length">
            <td colspan="7" class="empty-state">该格暂无隐患点</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- 第三级：单点详情 -->
    <template v-else-if="detail">
      <div class="detail-grid">
        <dl class="detail-card">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail.row[field] ?? '—' }}</dd>
          </template>
          <dt>主归属类型</dt>
          <dd>{{ detail.primaryType }}</dd>
          <dt>定位状态</dt>
          <dd>
            <span v-if="detail.located" class="tag ok">已定位</span>
            <span v-else class="tag warn">待定位（缺经纬度，先补测再监测确认）</span>
          </dd>
          <dt>当前状态</dt>
          <dd>{{ detail.row.status }}</dd>
        </dl>

        <div class="detail-card">
          <h4>绑定监测设备</h4>
          <table class="data-table">
            <thead>
              <tr><th>设备编号</th><th>设备类型</th><th>通讯状态</th><th>当前状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="device in detail.devices" :key="String(device.id)">
                <td>{{ device['设备编号'] }}</td>
                <td>{{ device['设备类型'] }}</td>
                <td>{{ device['通讯状态'] }}</td>
                <td>{{ device.status }}</td>
              </tr>
              <tr v-if="!detail.devices.length">
                <td colspan="4" class="empty-state">暂无绑定设备</td>
              </tr>
            </tbody>
          </table>

          <h4>安装核查单</h4>
          <table class="data-table">
            <thead>
              <tr><th>核查单号</th><th>生成日期</th><th>当前状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="form in detail.checkForms" :key="String(form.id)">
                <td>{{ form['设备编号'] }}</td>
                <td>{{ form['安装日期'] }}</td>
                <td>{{ form.status }}</td>
              </tr>
              <tr v-if="!detail.checkForms.length">
                <td colspan="3" class="empty-state">暂无核查单，监测确认后自动生成</td>
              </tr>
            </tbody>
          </table>

          <p v-if="detail.regionBlocked" class="error-text">{{ detail.regionBlocked }}</p>
          <div class="detail-actions">
            <button
              v-if="confirmable"
              class="btn primary"
              type="button"
              :disabled="Boolean(detail.regionBlocked)"
              @click="confirm"
            >
              监测确认
            </button>
            <span v-if="message" :class="confirmOk ? 'ok-text' : 'error-text'">{{ message }}</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmMonitoring,
  isHazardLocated,
  listZoningPoints,
  loadHazardDetail,
  loadZoning,
} from '@/api/local-service'
import type { EntryRow, HazardDetail, ZoningCell, ZoningMatrix } from '@/data/types'

const emit = defineEmits<{ changed: [] }>()

const detailFields = ["隐患点编号", "隐患点名称", "灾害类型", "所在乡镇", "经纬度坐标", "威胁户数", "威胁人口", "隐患状态"]

const level = ref<'matrix' | 'cell' | 'point'>('matrix')
const selectedTownship = ref('')
const selectedType = ref('')
const matrix = ref<ZoningMatrix>({ townships: [], disasterTypes: [], cells: [] })
const cellPoints = ref<EntryRow[]>([])
const detail = ref<HazardDetail | null>(null)
const message = ref('')
const confirmOk = ref(false)

const confirmable = computed(
  () => detail.value !== null && ['在册', '新增'].includes(String(detail.value.row.status)) && detail.value.located,
)

function cellOf(township: string, type: string): ZoningCell {
  const found = matrix.value.cells.find((cell) => cell.township === township && cell.disasterType === type)
  return (
    found ?? {
      township,
      disasterType: type,
      registered: 0,
      monitoring: 0,
      treated: 0,
      threatenedPopulation: 0,
      unlocated: 0,
      total: 0,
      riskLevel: 0,
    }
  )
}

function sumCells(cells: ZoningCell[]) {
  return cells.reduce(
    (acc, cell) => ({
      registered: acc.registered + cell.registered,
      monitoring: acc.monitoring + cell.monitoring,
      treated: acc.treated + cell.treated,
      threatenedPopulation: acc.threatenedPopulation + cell.threatenedPopulation,
    }),
    { registered: 0, monitoring: 0, treated: 0, threatenedPopulation: 0 },
  )
}

function rowTotal(township: string) {
  return sumCells(matrix.value.cells.filter((cell) => cell.township === township))
}

function colTotal(type: string) {
  return sumCells(matrix.value.cells.filter((cell) => cell.disasterType === type))
}

function isLocated(row: EntryRow) {
  return isHazardLocated(row)
}

function drillCell(township: string, type: string) {
  selectedTownship.value = township
  selectedType.value = type
  cellPoints.value = listZoningPoints(township, type)
  level.value = 'cell'
}

function drillPoint(id: number) {
  detail.value = loadHazardDetail(id)
  message.value = ''
  level.value = 'point'
}

function backToMatrix() {
  level.value = 'matrix'
}

function backToCell() {
  if (level.value === 'point') {
    cellPoints.value = listZoningPoints(selectedTownship.value, selectedType.value)
    level.value = 'cell'
  }
}

function confirm() {
  if (!detail.value) {
    return
  }
  message.value = ''
  const result = confirmMonitoring(Number(detail.value.row.id), Number(detail.value.row.version ?? 1))
  confirmOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    refresh()
    emit('changed')
  }
}

function refresh() {
  matrix.value = loadZoning()
  if (level.value === 'cell') {
    cellPoints.value = listZoningPoints(selectedTownship.value, selectedType.value)
  }
  if (level.value === 'point' && detail.value) {
    detail.value = loadHazardDetail(Number(detail.value.row.id))
  }
}

onMounted(refresh)

defineExpose({ refresh })
</script>
