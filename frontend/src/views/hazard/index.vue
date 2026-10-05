<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患点台账管理</h2>
        <p class="page-desc">按乡镇与灾害类型铺危险度分区格子，支持逐级钻取到单点；监测确认在监测设备台账同步生成安装核查单。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出隐患点台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="view-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :class="['tab-btn', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所在乡镇</span>
        <select v-model="filters['所在乡镇']">
          <option value="">全部乡镇</option>
          <option v-for="township in ALL_TOWNSHIPS" :key="township" :value="township">{{ township }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>灾害类型</span>
        <input v-model="filters['灾害类型']" placeholder="按主归属/登记类型检索" />
      </label>
      <label v-for="field in extraFilterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <ZoneMatrix v-if="activeTab === 'zone'" :filters="filters" @open="openDetail" />

    <template v-else>
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>主归属</th>
            <th>定位</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
            <td>{{ primaryOf(row) }}</td>
            <td>
              <span v-if="locatedOf(row)" class="located-tag">已定位</span>
              <span v-else class="locate-tag">待定位</span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openDetail(Number(row.id))">详情/监测确认</button>
              <button class="link" type="button" @click="runAction('启动治理', row)">启动治理</button>
              <button class="link" type="button" @click="runAction('申请核销', row)">申请核销</button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 4" class="empty-state">暂无隐患点台账数据</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患点台账记录；受威胁人口按在册/监测中且已定位点统计，已治理核销点不计入</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <HazardDrawer :hazard-id="detailId" @close="detailId = null" @changed="reload" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  isLocated,
  listHazardPoints,
  primaryDisasterType,
} from '@/api/hazard-domain'
import { ALL_TOWNSHIPS, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import ZoneMatrix from './ZoneMatrix.vue'
import HazardDrawer from './HazardDrawer.vue'

const meta = moduleMeta('hazard')
const columns = ['隐患点编号', '隐患点名称', '灾害类型', '所在乡镇', '经纬度坐标', '威胁户数', '威胁人口', '隐患状态']
const statuses = ['在册', '监测中', '已治理', '已核销', '新增']
const tabs = [
  { key: 'zone', label: '危险度分区图' },
  { key: 'list', label: '台账列表' },
]

const store = useSessionStore()
const activeTab = ref('zone')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({
  所在乡镇: '',
  灾害类型: '',
  隐患点编号: '',
  隐患点名称: '',
})
const extraFilterFields = ['隐患点编号', '隐患点名称']
const detailId = ref<number | null>(null)

const stats = computed(() => {
  const all = listHazardPoints({})
  const active = all.filter((row) => !['已治理', '已核销'].includes(String(row.status)))
  const threatened = active
    .filter((row) => isLocated(row))
    .reduce((sum, row) => sum + Number(row['威胁人口'] || 0), 0)
  return [
    { label: '隐患点总数', value: all.length },
    { label: '监测中数量', value: all.filter((row) => String(row.status) === '监测中').length },
    { label: '已治理数量', value: all.filter((row) => String(row.status) === '已治理').length },
    { label: '在册/监测受威胁人口', value: threatened },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function primaryOf(row: EntryRow): string {
  return primaryDisasterType(row)
}
function locatedOf(row: EntryRow): boolean {
  return isLocated(row)
}

function openDetail(id: number) {
  detailId.value = id
}

function resetFilters() {
  filters.value = { 所在乡镇: '', 灾害类型: '', 隐患点编号: '', 隐患点名称: '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, {
    operator: store.operator,
    townships: store.townships,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    // 列表读取走领域口径（乡镇精确、类型按主归属），分页结构仍与通用接口保持一致。
    const items = listHazardPoints(filters.value)
    rows.value = items
    total.value = items.length
    if (detailId.value !== null) {
      // 详情抽屉保持打开即可，抽屉内部会在 changed 后自取最新数据
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患点台账列表读取失败'
  }
}

onMounted(() => {
  // listEntries 仍保持可调用（导出/外部模块依赖），这里做一次预热校验
  listEntries(meta.key, {})
  reload()
})
</script>
