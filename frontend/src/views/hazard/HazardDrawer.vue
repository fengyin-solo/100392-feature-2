<template>
  <div v-if="detail" class="drawer-mask" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-label="隐患点单点详情">
      <header class="drawer-head">
        <div>
          <h3>{{ detail.row['隐患点名称'] }}</h3>
          <p class="drawer-sub">
            {{ detail.row['隐患点编号'] }} · {{ detail.row['所在乡镇'] }} · 当前状态
            <span class="status-pill">{{ detail.row.status }}</span>
          </p>
        </div>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <div class="drawer-body">
        <section class="detail-block">
          <h4>归属与定位</h4>
          <dl class="detail-grid">
            <div><dt>登记灾害类型</dt><dd>{{ detail.row['灾害类型'] || '—' }}</dd></div>
            <div><dt>主归属类型</dt><dd><b>{{ detail.primaryType }}</b></dd></div>
            <div>
              <dt>兼涉类型</dt>
              <dd>{{ secondaryTypes || '无' }}</dd>
            </div>
            <div>
              <dt>定位状态</dt>
              <dd>
                <span v-if="detail.located" class="located-tag">
                  已定位（{{ detail.longitude }}, {{ detail.latitude }}）
                </span>
                <span v-else class="locate-tag">待定位 · 经纬度缺失或不合法</span>
              </dd>
            </div>
            <div><dt>隐患状态</dt><dd>{{ detail.row['隐患状态'] }}</dd></div>
          </dl>
          <p class="rule-hint">
            主归属规则：多类型按「滑坡 &gt; 崩塌 &gt; 泥石流 &gt; 地面塌陷 &gt; 地裂缝 &gt; 地面沉降 &gt; 不稳定斜坡」取首个命中类型，
            其余作为兼涉类型；无法识别归「其他」，每点只在主归属格计一次。
          </p>

          <form v-if="!detail.located" class="coord-form" @submit.prevent="submitCoordinates">
            <label class="filter-item">
              <span>补录经纬度（经度,纬度）</span>
              <input v-model="coordinateDraft" placeholder="如 104.102,29.812" />
            </label>
            <button class="btn primary" type="submit" :disabled="saving">补录并解除待定位</button>
          </form>
        </section>

        <section class="detail-block">
          <h4>威胁情况</h4>
          <dl class="detail-grid">
            <div><dt>威胁户数</dt><dd>{{ detail.row['威胁户数'] }} 户</dd></div>
            <div><dt>威胁人口</dt><dd>{{ detail.row['威胁人口'] }} 人</dd></div>
          </dl>
        </section>

        <section class="detail-block">
          <h4>已绑定监测设备（{{ detail.devices.length }}）</h4>
          <table v-if="detail.devices.length" class="data-table compact">
            <thead>
              <tr><th>设备编号</th><th>设备类型</th><th>安装日期</th><th>通讯</th><th>设备状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="device in detail.devices" :key="String(device.id)">
                <td>{{ device['设备编号'] }}</td>
                <td>{{ device['设备类型'] }}</td>
                <td>{{ device['安装日期'] }}</td>
                <td>{{ device['通讯状态'] }}</td>
                <td>{{ device.status }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="rule-hint">该点尚未绑定设备；监测确认后会生成安装核查单，由监测设备台账侧据此建档安装。</p>
        </section>

        <section class="detail-block">
          <h4>安装核查单</h4>
          <table v-if="detail.checkSheet" class="data-table compact">
            <tbody>
              <tr><th>核查单编号</th><td>{{ detail.checkSheet['核查单编号'] }}</td></tr>
              <tr><th>建议设备类型</th><td>{{ detail.checkSheet['建议设备类型'] }}</td></tr>
              <tr><th>核查状态</th><td>{{ detail.checkSheet.status }}</td></tr>
              <tr><th>生成时间</th><td>{{ detail.checkSheet['生成时间'] }}</td></tr>
              <tr><th>确认人</th><td>{{ detail.checkSheet['确认人'] }}</td></tr>
            </tbody>
          </table>
          <p v-else class="rule-hint">暂无核查单。隐患点执行「纳入监测」确认后自动在此生成。</p>
        </section>
      </div>

      <footer class="drawer-foot">
        <span v-if="message" :class="saving ? 'muted-text' : resultOk ? 'ok-text' : 'error-text'">{{ message }}</span>
        <span class="spacer" />
        <button
          class="btn primary"
          type="button"
          :disabled="saving || detail.row.status === '监测中' || detail.row.status === '已治理' || detail.row.status === '已核销'"
          @click="submitConfirm"
        >
          {{ detail.row.status === '监测中' ? '已在监测中' : '监测确认（纳入监测）' }}
        </button>
      </footer>
    </aside>
  </div>
  <div v-else />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { confirmMonitoring, getHazardDetail, updateCoordinates } from '@/api/hazard-domain'
import { useSessionStore } from '@/stores/session'
import type { HazardDetail } from '@/data/types'

const props = defineProps<{ hazardId: number | null }>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'changed'): void }>()

const store = useSessionStore()
const detail = ref<HazardDetail | null>(null)
const coordinateDraft = ref('')
const message = ref('')
const resultOk = ref(false)
const saving = ref(false)

function operatorContext() {
  return { operator: store.operator, townships: store.townships }
}

const secondaryTypes = computed(() => {
  if (!detail.value) {
    return ''
  }
  const current = detail.value
  return current.matchedTypes.filter((type) => type !== current.primaryType).join('、')
})

function reloadDetail(keepMessage = false) {
  detail.value = props.hazardId === null ? null : getHazardDetail(props.hazardId)
  coordinateDraft.value = detail.value && !detail.value.located ? String(detail.value.row['经纬度坐标'] ?? '') : ''
  if (!keepMessage) {
    message.value = ''
  }
}

watch(
  () => props.hazardId,
  () => reloadDetail(),
  { immediate: true },
)

function submitCoordinates() {
  if (!detail.value) {
    return
  }
  saving.value = true
  message.value = ''
  const result = updateCoordinates(Number(detail.value.row.id), coordinateDraft.value, operatorContext())
  saving.value = false
  resultOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    reloadDetail(true)
    emit('changed')
  }
}

function submitConfirm() {
  if (!detail.value) {
    return
  }
  saving.value = true
  message.value = ''
  const result = confirmMonitoring(Number(detail.value.row.id), operatorContext())
  saving.value = false
  resultOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    reloadDetail(true)
    emit('changed')
  }
}
</script>
