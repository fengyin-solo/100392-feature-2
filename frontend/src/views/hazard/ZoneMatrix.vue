<template>
  <section class="zone-board">
    <div class="zone-toolbar">
      <nav class="drill-crumb" aria-label="分区钻取路径">
        <button class="link" type="button" :disabled="drill.township !== null" @click="drillTo(null, null)">
          全县
        </button>
        <template v-if="drill.township">
          <span class="crumb-sep">/</span>
          <button class="link" type="button" :disabled="drill.type !== null" @click="drillTo(drill.township, null)">
            {{ drill.township }}
          </button>
        </template>
        <template v-if="drill.type">
          <span class="crumb-sep">/</span>
          <span class="crumb-current">{{ drill.type }}</span>
        </template>
      </nav>
      <button class="btn ghost" type="button" @click="drillTo(null, null)">回到全县格子</button>
    </div>

    <!-- 第一层：乡镇 × 主归属灾害类型 -->
    <div v-if="drill.township === null" class="matrix-scroll">
      <table class="zone-matrix">
        <thead>
          <tr>
            <th class="zone-corner">乡镇 ＼ 灾害类型（主归属）</th>
            <th v-for="type in matrix.disasterTypes" :key="type">{{ type }}</th>
            <th v-if="!matrix.disasterTypes.length">暂无类型</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="township in matrix.townships" :key="township">
            <th class="zone-row-head">{{ township }}</th>
            <td v-for="type in matrix.disasterTypes" :key="type" class="zone-cell-wrap">
              <button
                v-if="cellOf(township, type)"
                type="button"
                class="zone-cell"
                :class="`risk-${riskLevel(cellOf(township, type)!.metrics)}`"
                @click="drillTo(township, type)"
              >
                <span class="zone-cell-title">{{ RISK_LABEL[riskLevel(cellOf(township, type)!.metrics)] }}</span>
                <span class="zone-cell-line">在册 <b>{{ cellOf(township, type)!.metrics.registered }}</b></span>
                <span class="zone-cell-line">监测中 <b>{{ cellOf(township, type)!.metrics.monitoring }}</b></span>
                <span class="zone-cell-line">治理 <b>{{ cellOf(township, type)!.metrics.treated }}</b></span>
                <span class="zone-cell-line threatened">受威胁 {{ cellOf(township, type)!.metrics.threatened }} 人</span>
                <span v-if="cellOf(township, type)!.metrics.pendingLocate" class="zone-cell-line locate">
                  待定位 {{ cellOf(township, type)!.metrics.pendingLocate }}
                </span>
              </button>
              <span v-else class="zone-cell empty">无在册隐患点</span>
            </td>
          </tr>
          <tr v-if="!matrix.townships.length">
            <td class="empty-state" :colspan="matrix.disasterTypes.length + 1">当前筛选条件下没有隐患点</td>
          </tr>
        </tbody>
        <tfoot v-if="matrix.townships.length">
          <tr>
            <th class="zone-row-head">合计</th>
            <th :colspan="matrix.disasterTypes.length">
              <span class="zone-total-item">在册 {{ matrix.total.registered }}</span>
              <span class="zone-total-item">监测中 {{ matrix.total.monitoring }}</span>
              <span class="zone-total-item">治理数 {{ matrix.total.treated }}</span>
              <span class="zone-total-item threatened">受威胁 {{ matrix.total.threatened }} 人</span>
              <span class="zone-total-item locate">待定位 {{ matrix.total.pendingLocate }}</span>
            </th>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 第二层：某乡镇下各灾害类型的点清单 -->
    <div v-else-if="drill.type === null" class="drill-list">
      <h3 class="drill-title">{{ drill.township }} · 分灾害类型隐患点</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>主归属类型</th>
            <th>在册</th>
            <th>监测中</th>
            <th>治理数</th>
            <th>受威胁人口</th>
            <th>待定位</th>
            <th>钻取</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="cell in cellsOfTownship(drill.township)" :key="cell.disasterType">
            <td>{{ cell.disasterType }}</td>
            <td>{{ cell.metrics.registered }}</td>
            <td>{{ cell.metrics.monitoring }}</td>
            <td>{{ cell.metrics.treated }}</td>
            <td>{{ cell.metrics.threatened }}</td>
            <td>
              <span v-if="cell.metrics.pendingLocate" class="locate-tag">{{ cell.metrics.pendingLocate }}</span>
              <span v-else>0</span>
            </td>
            <td>
              <button class="link" type="button" @click="drillTo(drill.township, cell.disasterType)">
                查看单点 →
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 第三层：单格内隐患点列表（点行即单点） -->
    <div v-else class="drill-list">
      <h3 class="drill-title">{{ drill.township }} / {{ drill.type }} · 隐患点（{{ points.length }}）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>隐患点编号</th>
            <th>隐患点名称</th>
            <th>兼涉类型</th>
            <th>当前状态</th>
            <th>威胁人口</th>
            <th>定位</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="point in points" :key="String(point.id)">
            <td>{{ point['隐患点编号'] }}</td>
            <td>{{ point['隐患点名称'] }}</td>
            <td>{{ secondaryTypes(point) || '—' }}</td>
            <td><span class="status-pill">{{ point.status }}</span></td>
            <td>{{ point['威胁人口'] }}</td>
            <td>
              <span v-if="isLocated(point)" class="located-tag">已定位</span>
              <span v-else class="locate-tag">待定位</span>
            </td>
            <td>
              <button class="link" type="button" @click="emit('open', Number(point.id))">单点详情</button>
            </td>
          </tr>
          <tr v-if="!points.length">
            <td class="empty-state" colspan="7">该格子下没有隐患点</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import {
  buildZoneMatrix,
  isLocated,
  matchedTypes,
  pointsInZone,
  primaryDisasterType,
  riskLevel,
  RISK_LEVEL_LABEL,
} from '@/api/hazard-domain'
import type { EntryRow, ZoneCell } from '@/data/types'

const props = defineProps<{ filters: Record<string, string> }>()
const emit = defineEmits<{ (event: 'open', id: number): void }>()

const RISK_LABEL = RISK_LEVEL_LABEL

const matrix = computed(() => buildZoneMatrix(props.filters))
const drill = reactive<{ township: string | null; type: string | null }>({
  township: null,
  type: null,
})

watch(
  () => props.filters,
  () => {
    // 筛选条件变化后钻取路径可能失效，回退一层由用户重新进入。
    if (drill.township && !matrix.value.townships.includes(drill.township)) {
      drillTo(null, null)
    }
  },
  { deep: true },
)

function drillTo(township: string | null, type: string | null) {
  drill.township = township
  drill.type = type
}

function cellOf(township: string, type: string): ZoneCell | undefined {
  return matrix.value.cells.find(
    (cell) => cell.township === township && cell.disasterType === type,
  )
}

function cellsOfTownship(township: string): ZoneCell[] {
  return matrix.value.cells.filter((cell) => cell.township === township)
}

const points = computed<EntryRow[]>(() =>
  drill.township && drill.type ? pointsInZone(drill.township, drill.type) : [],
)

function secondaryTypes(row: EntryRow): string {
  const matched = matchedTypes(row)
  return matched.filter((type) => type !== primaryDisasterType(row)).join('、')
}
</script>
