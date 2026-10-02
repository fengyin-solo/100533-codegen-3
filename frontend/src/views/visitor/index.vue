<template>
  <section class="page" data-module="visitor">
    <header class="page-head">
      <div>
        <h2>访客接待册</h2>
        <p class="page-desc">维护访客接待册，围绕访客编号、到访事由、陪同人、离场时间做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记访客记录</button>
        <button class="btn" type="button" @click="exportRows">导出访客清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div v-if="incompleteDeparted.length" class="banner warn">
      离场时间缺失或填得不全，请补齐：{{ incompleteDeparted.map((row) => row['访客编号']).join('、') }}
    </div>
    <div v-if="gateIssues.length" class="banner danger">
      门卫登记与接待册的访客编号对不上：{{ gateIssues.join('、') }}
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="kanban-row">
      <section class="kanban-col onsite">
        <h3 class="kanban-title">
          在区访客 · 未离场
          <span class="kanban-count">{{ onsiteRows.length }} 人</span>
        </h3>
        <article v-for="row in onsiteRows" :key="String(row.id)" class="visitor-card" :class="{ warn: cardWarn(row) }">
          <div class="visitor-card-head">
            <span class="visitor-id">{{ row['访客编号'] }}</span>
            <span class="badge" :class="statusClass(row)">{{ row.status }}</span>
          </div>
          <p class="visitor-line"><span class="label">到访事由</span>{{ row['到访事由'] || '—' }}</p>
          <p class="visitor-line">
            <span class="label">陪同人</span>
            <span v-if="row['陪同人']">{{ row['陪同人'] }}</span>
            <span v-else class="badge danger">未登记，不许放行</span>
          </p>
          <p class="visitor-line"><span class="label">到访日期</span>{{ row['到访日期'] || '—' }}</p>
          <p class="visitor-line"><span class="label">签到时间</span>{{ row['签到时间'] || '—' }}</p>
          <p class="visitor-line"><span class="label">离场时间</span>—</p>
          <p class="visitor-line">
            <span class="label">门卫登记号</span>{{ row['门卫登记号'] || '—' }}
            <span v-if="gateIssue(row)" class="badge danger">{{ gateIssue(row) }}</span>
          </p>
          <div class="card-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </div>
        </article>
        <p v-if="!onsiteRows.length" class="empty-state">当前没有在区访客</p>
      </section>

      <section v-for="reason in reasonColumns" :key="reason" class="kanban-col">
        <h3 class="kanban-title">
          {{ reason }}
          <span class="kanban-count">{{ columnRows(reason).length }} 条</span>
        </h3>
        <article
          v-for="row in columnRows(reason)"
          :key="String(row.id)"
          class="visitor-card"
          :class="{ warn: cardWarn(row) }"
        >
          <div class="visitor-card-head">
            <span class="visitor-id">{{ row['访客编号'] }}</span>
            <span class="badge" :class="statusClass(row)">{{ row.status }}</span>
          </div>
          <p class="visitor-line"><span class="label">到访事由</span>{{ row['到访事由'] || '—' }}</p>
          <p class="visitor-line">
            <span class="label">陪同人</span>
            <span v-if="row['陪同人']">{{ row['陪同人'] }}</span>
            <span v-else class="badge danger">未登记</span>
          </p>
          <p class="visitor-line"><span class="label">到访日期</span>{{ row['到访日期'] || '—' }}</p>
          <p class="visitor-line"><span class="label">签到时间</span>{{ row['签到时间'] || '—' }}</p>
          <p class="visitor-line">
            <span class="label">离场时间</span>
            <template v-if="isDepartureTimeIncomplete(row['离场时间'])">
              {{ row['离场时间'] || '未填写' }}
              <span class="badge warn">待补齐</span>
            </template>
            <template v-else>{{ row['离场时间'] }}</template>
          </p>
          <p class="visitor-line">
            <span class="label">门卫登记号</span>{{ row['门卫登记号'] || '—' }}
            <span v-if="gateIssue(row)" class="badge danger">{{ gateIssue(row) }}</span>
          </p>
          <div class="card-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </div>
        </article>
        <p v-if="!columnRows(reason).length" class="empty-state">暂无记录</p>
      </section>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条访客记录</span>
      <span v-if="notice" :class="noticeOk ? 'ok-text' : 'error-text'">{{ notice }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  isDepartureTimeIncomplete,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  todayStamp,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('visitor')
const actions = meta.actions
const statuses = meta.statuses
const filterFields = ["访客编号", "到访事由", "陪同人"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const notice = ref('')
const noticeOk = ref(true)
const filters = ref<Record<string, string>>({})

// 当天还没走的（已预约、已签到）挪到单独一栏；已离场的按到访事由分栏。
const onsiteRows = computed(() => rows.value.filter((row) => String(row.status) !== '已离场'))
const departedRows = computed(() => rows.value.filter((row) => String(row.status) === '已离场'))
const reasonColumns = computed(() => {
  const names: string[] = []
  for (const row of departedRows.value) {
    const reason = String(row['到访事由'] ?? '').trim() || '未注明事由'
    if (!names.includes(reason)) {
      names.push(reason)
    }
  }
  return names
})

const incompleteDeparted = computed(() =>
  departedRows.value.filter((row) => isDepartureTimeIncomplete(row['离场时间'])),
)

const gateIssues = computed(() =>
  rows.value
    .map((row) => {
      const gate = String(row['门卫登记号'] ?? '').trim()
      const code = String(row['访客编号'] ?? '').trim()
      if (!gate) {
        return `${code}（门卫登记缺失）`
      }
      if (gate !== code) {
        return `${code}（门卫登记号 ${gate}）`
      }
      return null
    })
    .filter((item): item is string => item !== null),
)

const stats = computed(() => [
  { label: '在区访客', value: onsiteRows.value.length },
  { label: '今日到访', value: rows.value.filter((row) => String(row['到访日期'] ?? '') === todayStamp()).length },
  { label: '离场时间待补齐', value: incompleteDeparted.value.length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function columnRows(reason: string): EntryRow[] {
  return departedRows.value.filter(
    (row) => (String(row['到访事由'] ?? '').trim() || '未注明事由') === reason,
  )
}

function gateIssue(row: EntryRow): string {
  const gate = String(row['门卫登记号'] ?? '').trim()
  const code = String(row['访客编号'] ?? '').trim()
  if (!gate) {
    return '门卫登记缺失'
  }
  if (gate !== code) {
    return '与接待册编号不符'
  }
  return ''
}

function cardWarn(row: EntryRow): boolean {
  const departedIncomplete =
    String(row.status) === '已离场' && isDepartureTimeIncomplete(row['离场时间'])
  return departedIncomplete || gateIssue(row) !== ''
}

function statusClass(row: EntryRow): string {
  const status = String(row.status)
  if (status === '已签到') {
    return 'info'
  }
  if (status === '已预约') {
    return 'warn'
  }
  return ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  notice.value = '访客记录登记入口尚未接入审批流'
  noticeOk.value = false
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  notice.value = result.message
  noticeOk.value = result.ok
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '访客接待册读取失败'
    noticeOk.value = false
  }
}

onMounted(reload)
</script>
