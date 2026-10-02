<template>
  <section class="page" data-module="visitor-gate">
    <header class="page-head">
      <div>
        <h2>门卫登记</h2>
        <p class="page-desc">
          发掘区出入口门卫台账。进区流程只能一段一段往下走：预约 → 签到 → 离场，中间不许跨步；
          没有登记陪同人的访客不许放行。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetAll">恢复示例数据</button>
        <RouterLink class="btn" to="/visitor-book">查看访客接待册</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in flowSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>到访事由</span>
        <select v-model="filterReason">
          <option value="">全部事由</option>
          <option v-for="reason in reasons" :key="reason" :value="reason">{{ reason }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="filterKeyword" placeholder="按访客编号 / 陪同人检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <form class="data-table create-row" @submit.prevent="submitAppointment">
      <div class="create-grid">
        <label>
          <span>到访事由 *</span>
          <select v-model="form.到访事由" required>
            <option value="" disabled>请选择事由</option>
            <option v-for="reason in reasons" :key="reason" :value="reason">{{ reason }}</option>
          </select>
        </label>
        <label>
          <span>陪同人</span>
          <input v-model="form.陪同人" placeholder="签到前必须登记" />
        </label>
        <label>
          <span>预约到访 *</span>
          <input v-model="form.预约到访" type="datetime-local" required />
        </label>
        <button class="btn primary" type="submit">预约登记</button>
      </div>
      <p class="form-hint">访客编号由接待册统一排号（VIS-xxxx），预约时可不填陪同人，但签到前必须补齐。</p>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>访客编号</th>
          <th>到访事由</th>
          <th>陪同人</th>
          <th>预约到访</th>
          <th>签到时间</th>
          <th>离场时间</th>
          <th>流程状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'row-abnormal': row.abnormal }">
          <td>{{ row.访客编号 }}</td>
          <td>{{ row.到访事由 }}</td>
          <td>
            <span v-if="row.陪同人">{{ row.陪同人 }}</span>
            <strong v-else class="error-text">缺陪同人</strong>
          </td>
          <td>{{ row.预约到访 }}</td>
          <td>{{ row.签到时间 || '—' }}</td>
          <td>
            <span v-if="row.离场时间">{{ row.离场时间 }}</span>
            <strong v-else-if="row.status === '已离场'" class="error-text">离场时间缺失</strong>
            <span v-else>—</span>
          </td>
          <td>
            <span class="flow-badge" :class="`flow-${flowIndex(row.status)}`">{{ row.status }}</span>
            <span v-if="row.联动巡查编号" class="review-link">台账：{{ row.联动巡查编号 }}</span>
          </td>
          <td class="row-actions">
            <template v-if="row.status === '已预约'">
              <button class="link" type="button" @click="promptEscort(row)">
                {{ row.陪同人 ? '变更陪同人' : '补登记陪同人' }}
              </button>
              <button
                class="link"
                type="button"
                :class="{ 'link-disabled': !row.陪同人 }"
                :title="row.陪同人 ? '' : '没有登记陪同人，不许放行'"
                @click="doAction(() => checkIn(row.id))"
              >
                到区签到
              </button>
            </template>
            <template v-else-if="row.status === '在区中'">
              <button class="link" type="button" @click="promptLeave(row, true)">离场登记（补填时间）</button>
              <button class="link" type="button" @click="promptLeave(row, false)">离场登记（按当前时间）</button>
            </template>
            <template v-else>
              <button v-if="!row.离场时间" class="link" type="button" @click="promptCompleteLeave(row)">
                补填离场时间
              </button>
              <button v-if="!row.联动巡查编号" class="link" type="button" @click="promptApprove(row)">
                离场批复
              </button>
              <span v-else class="review-done">已批复</span>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="8" class="empty-state">暂无符合条件的访客记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>门卫登记与访客接待册读取同一份访客编号，共 {{ total }} 条记录</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  checkIn,
  createAppointment,
  completeLeaveTime,
  approveLeave,
  fillEscort,
  listVisitorEntries,
  registerLeave,
  resetVisitorBook,
} from '@/api/visitor-service'
import { VISITOR_FLOW, VISIT_REASONS } from '@/data/visitor-types'
import type { VisitorRow } from '@/data/visitor-types'

const reasons = VISIT_REASONS
const rows = ref<VisitorRow[]>([])
const filterReason = ref('')
const filterKeyword = ref('')
const message = ref('')
const messageOk = ref(false)
const form = reactive({ 到访事由: '', 陪同人: '', 预约到访: '' })

const total = computed(() => rows.value.length)
const stats = computed(() => [
  { label: '今日访客总数', value: rows.value.length },
  { label: '在区未走', value: rows.value.filter((row) => row.status === '在区中').length },
  { label: '已离场待批复', value: rows.value.filter((row) => row.status === '已离场' && !row.联动巡查编号).length },
  { label: '信息缺失待补', value: rows.value.filter((row) => row.abnormal).length },
])
const flowSummary = computed(() =>
  VISITOR_FLOW.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

function flowIndex(status: string): number {
  return Math.max(0, VISITOR_FLOW.indexOf(status as (typeof VISITOR_FLOW)[number]))
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function doAction(fn: () => { ok: boolean; message: string }) {
  const result = fn()
  notify(result.ok, result.message)
  reload()
}

function submitAppointment() {
  const result = createAppointment({ ...form })
  notify(result.ok, result.message)
  if (result.ok) {
    form.到访事由 = ''
    form.陪同人 = ''
    form.预约到访 = ''
  }
  reload()
}

function promptEscort(row: VisitorRow) {
  const name = window.prompt(`为访客 ${row.访客编号} 登记陪同人（没有陪同人不予放行）`, row.陪同人)
  if (name === null) return
  doAction(() => fillEscort(row.id, name))
}

function promptLeave(row: VisitorRow, manual: boolean) {
  let leaveAt = ''
  if (manual) {
    const value = window.prompt(`补填访客 ${row.访客编号} 的离场时间（YYYY-MM-DD HH:mm）`, '')
    if (value === null) return
    leaveAt = value
  }
  doAction(() => registerLeave(row.id, leaveAt))
}

function promptCompleteLeave(row: VisitorRow) {
  const value = window.prompt(`访客 ${row.访客编号} 的离场时间缺失，请补齐（YYYY-MM-DD HH:mm）`, '')
  if (value === null) return
  doAction(() => completeLeaveTime(row.id, value))
}

function promptApprove(row: VisitorRow) {
  const approver = window.prompt(`批复访客 ${row.访客编号} 离场，批复将落到巡查台账`, '值班管理员')
  if (approver === null) return
  doAction(() => approveLeave(row.id, approver))
}

function resetFilters() {
  filterReason.value = ''
  filterKeyword.value = ''
  reload()
}

function resetAll() {
  resetVisitorBook()
  notify(true, '访客记录已恢复为示例数据（巡查台账不受影响）')
  reload()
}

function reload() {
  rows.value = listVisitorEntries({ 到访事由: filterReason.value, 关键字: filterKeyword.value })
}

onMounted(reload)
</script>

<style scoped>
.create-row {
  background: #fff;
  padding: 10px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
}
.create-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
}
.create-grid label span,
.form-hint {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}
.form-hint { margin: 6px 0 0; }
.flow-badge {
  display: inline-block;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.flow-0 { background: #fef3c7; color: #92400e; }
.flow-1 { background: #dbeafe; color: #1e40af; }
.flow-2 { background: #dcfce7; color: #166534; }
.row-abnormal { background: #fef2f2; }
.review-link { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
.review-done { color: #166534; font-size: 12px; }
.ok-text { color: #166534; }
.link-disabled { color: #94a3b8; cursor: not-allowed; text-decoration: line-through; }
</style>
