<template>
  <section class="page" data-module="device">
    <header class="page-head">
      <div>
        <h2>监测设备管理</h2>
        <p class="page-desc">维护监测设备台账；安装核查单由隐患点监测确认时自动同步生成，本页只核查与查看，不手工建单。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出当前清单</button>
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
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 设备台账 -->
    <template v-if="activeTab === 'device'">
      <p class="status-legend">
        <span v-for="item in statusSummary" :key="item.status" class="legend-item">
          {{ item.status }}：{{ item.count }}
        </span>
      </p>
      <form class="filter-bar" @submit.prevent="reloadDevices">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="deviceFilters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetDeviceFilters">重置条件</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>绑定乡镇</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ townshipOfRow(row) || '未匹配到隐患点' }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runDeviceAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 3" class="empty-state">暂无监测设备数据</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ total }} 条监测设备记录</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>

    <!-- 安装核查单（相邻业务面，同步生成） -->
    <template v-else>
      <p class="rule-hint">
        核查单由隐患点台账执行「监测确认」时在本业务面自动生成，台账回写与核查单生成同成同败；
        并发确认只保留一版。本页不提供手工建单入口。
      </p>
      <form class="filter-bar" @submit.prevent="reloadChecks">
        <label class="filter-item">
          <span>所在乡镇</span>
          <select v-model="checkFilters['所在乡镇']">
            <option value="">全部乡镇</option>
            <option v-for="township in ALL_TOWNSHIPS" :key="township" :value="township">{{ township }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>隐患点编号</span>
          <input v-model="checkFilters['隐患点编号']" placeholder="按隐患点编号检索" />
        </label>
        <label class="filter-item">
          <span>核查状态</span>
          <input v-model="checkFilters['status']" placeholder="如 待核查" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetCheckFilters">重置条件</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in checkColumns" :key="column">{{ column }}</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in checkRows" :key="String(row.id)">
            <td v-for="column in checkColumns" :key="column">{{ row[column] ?? '—' }}</td>
            <td><span class="status-pill">{{ row.status }}</span></td>
          </tr>
          <tr v-if="!checkRows.length">
            <td :colspan="checkColumns.length + 1" class="empty-state">
              暂无安装核查单：去隐患点台账对在册点执行「监测确认」后会自动生成
            </td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>共 {{ checkRows.length }} 张安装核查单</span>
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      </footer>
    </template>
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
import { listCheckSheets, townshipOf } from '@/api/hazard-domain'
import { ALL_TOWNSHIPS, useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const tabs = [
  { key: 'device', label: '监测设备台账' },
  { key: 'check', label: '安装核查单' },
]
const activeTab = ref('device')

const meta = moduleMeta('device')
const columns = ['设备编号', '设备类型', '所属隐患点', '安装日期', '最近维护日', '电池余量', '通讯状态', '设备状态']
const actions = ['报修设备', '确认修复', '停用设备']
const statuses = ['正常运行', '信号异常', '低电量', '待维修', '已停用']

const checkColumns = ['核查单编号', '隐患点编号', '隐患点名称', '所在乡镇', '建议设备类型', '安装点位', '生成时间', '确认人']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const deviceFilters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const checkRows = ref<EntryRow[]>([])
const checkFilters = ref<Record<string, string>>({ 所在乡镇: '', 隐患点编号: '', status: '' })

const stats = computed(() => {
  if (activeTab.value === 'device') {
    const devices = listEntries('device').items
    return [
      { label: '设备总数', value: devices.length },
      { label: '正常运行数', value: devices.filter((row) => String(row.status) === '正常运行').length },
      { label: '待维修数', value: devices.filter((row) => String(row.status) === '待维修').length },
    ]
  }
  const checks = listCheckSheets({})
  return [
    { label: '核查单总数', value: checks.length },
    { label: '待核查数', value: checks.filter((row) => String(row.status) === '待核查').length },
    { label: '本周生成数', value: checks.length },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function townshipOfRow(row: EntryRow): string {
  return townshipOf('device', row)
}

function switchTab(key: string) {
  activeTab.value = key
  errorMessage.value = ''
  if (key === 'check') {
    reloadChecks()
  } else {
    reloadDevices()
  }
}

function resetDeviceFilters() {
  deviceFilters.value = {}
  reloadDevices()
}

function resetCheckFilters() {
  checkFilters.value = { 所在乡镇: '', 隐患点编号: '', status: '' }
  reloadChecks()
}

function exportRows() {
  downloadEntries(activeTab.value === 'device' ? 'device' : 'device_check')
}

function runDeviceAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction('device', Number(row.id), action, {
    operator: store.operator,
    townships: store.townships,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reloadDevices()
}

function reloadDevices() {
  errorMessage.value = ''
  try {
    const payload = listEntries('device', deviceFilters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '监测设备列表读取失败'
  }
}

function reloadChecks() {
  errorMessage.value = ''
  try {
    const effective: Record<string, string> = {}
    for (const [field, value] of Object.entries(checkFilters.value)) {
      if (!value.trim()) {
        continue
      }
      if (field === 'status') {
        effective.status = value
      } else {
        effective[field] = value
      }
    }
    checkRows.value = listCheckSheets(effective)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '安装核查单读取失败'
  }
}

onMounted(reloadDevices)
</script>
