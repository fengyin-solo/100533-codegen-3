<template>
  <section class="page" data-module="visitor-book">
    <header class="page-head">
      <div>
        <h2>访客接待册</h2>
        <p class="page-desc">
          按到访事由分栏逐条登记访客编号、到访事由、陪同人与离场时间；当天还没走的单独一栏，
          离场时间填得不全的标红提示补齐。与门卫登记读取同一套访客编号。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新接待册</button>
        <RouterLink class="btn" to="/visitor-gate">前往门卫登记</RouterLink>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">编号来源：门卫登记台账（VIS-xxxx 统一排号）</span>
      <span class="legend-item legend-warn">红色卡片：离场时间缺失，需门卫补齐</span>
      <span class="legend-item">已批复条目附巡查台账现场复核项编号</span>
    </p>

    <section class="board">
      <!-- 当天还没走的，挪到单独一栏，排在最前 -->
      <article class="board-col col-onsite">
        <header class="col-head">
          <h3>在区未走（{{ onsiteRows.length }}）</h3>
          <span class="col-note">已签到、尚未离场</span>
        </header>
        <ul class="card-list">
          <li v-for="row in onsiteRows" :key="row.id" class="visitor-card">
            <div class="card-title">
              <strong>{{ row.访客编号 }}</strong>
              <span class="reason-tag">{{ row.到访事由 }}</span>
            </div>
            <dl class="card-body">
              <div><dt>到访事由</dt><dd>{{ row.到访事由 }}</dd></div>
              <div><dt>陪同人</dt><dd>{{ row.陪同人 }}</dd></div>
              <div><dt>签到时间</dt><dd>{{ row.签到时间 }}</dd></div>
              <div><dt>离场时间</dt><dd class="onsite-note">尚未离场</dd></div>
            </dl>
          </li>
          <li v-if="!onsiteRows.length" class="card-empty">当前没有在区访客</li>
        </ul>
      </article>

      <!-- 按到访事由分栏 -->
      <article v-for="reason in reasons" :key="reason" class="board-col">
        <header class="col-head">
          <h3>{{ reason }}（{{ rowsByReason[reason].length }}）</h3>
          <span class="col-note">含已预约与已离场</span>
        </header>
        <ul class="card-list">
          <li
            v-for="row in rowsByReason[reason]"
            :key="row.id"
            class="visitor-card"
            :class="{ 'card-missing': missingLeave(row), 'card-booked': row.status === '已预约' }"
          >
            <div class="card-title">
              <strong>{{ row.访客编号 }}</strong>
              <span class="status-tag" :class="`flow-${flowIndex(row.status)}`">{{ row.status }}</span>
            </div>
            <dl class="card-body">
              <div><dt>到访事由</dt><dd>{{ row.到访事由 }}</dd></div>
              <div>
                <dt>陪同人</dt>
                <dd :class="{ 'field-missing': !row.陪同人 }">
                  {{ row.陪同人 || '未登记（签到前必补）' }}
                </dd>
              </div>
              <div>
                <dt>离场时间</dt>
                <dd v-if="row.离场时间">{{ row.离场时间 }}</dd>
                <dd v-else-if="row.status === '已离场'" class="field-missing">
                  离场时间缺失，请门卫在登记页补齐
                </dd>
                <dd v-else class="muted">预约未到，暂不填离场时间</dd>
              </div>
              <div v-if="row.联动巡查编号" class="review-row">
                <dt>台账复核</dt>
                <dd>{{ row.联动巡查编号 }}</dd>
              </div>
            </dl>
          </li>
          <li v-if="!rowsByReason[reason].length" class="card-empty">本栏暂无访客</li>
        </ul>
      </article>
    </section>

    <footer class="page-foot">
      <span>本册与门卫登记同源：共 {{ total }} 条，在区 {{ onsiteRows.length }} 条，信息缺失 {{ missingCount }} 条</span>
      <span class="muted">离场批复后自动到「安全巡查」台账查看现场复核项</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listVisitorEntries } from '@/api/visitor-service'
import { VISITOR_FLOW, VISIT_REASONS } from '@/data/visitor-types'
import type { VisitorRow } from '@/data/visitor-types'

// 接待册只读：登记与流转动作统一到门卫登记页办理，避免两处各写一套。

const reasons = VISIT_REASONS
const allRows = ref<VisitorRow[]>([])

const onsiteRows = computed(() => allRows.value.filter((row) => row.status === '在区中'))
const rowsByReason = computed<Record<string, VisitorRow[]>>(() => {
  const grouped: Record<string, VisitorRow[]> = {}
  for (const reason of reasons) {
    // 当天还没走的已单独成栏，事由栏里不再重复出现。
    grouped[reason] = allRows.value.filter(
      (row) => row.到访事由 === reason && row.status !== '在区中',
    )
  }
  return grouped
})
const missingLeave = (row: VisitorRow) => row.status === '已离场' && !row.离场时间.trim()
const missingCount = computed(() => allRows.value.filter((row) => row.abnormal).length)
const total = computed(() => allRows.value.length)
const stats = computed(() => [
  { label: '在册访客', value: total.value },
  { label: '在区未走', value: onsiteRows.value.length },
  { label: '已预约待签到', value: allRows.value.filter((row) => row.status === '已预约').length },
  { label: '离场信息缺失', value: missingCount.value },
])

function flowIndex(status: string): number {
  return Math.max(0, VISITOR_FLOW.indexOf(status as (typeof VISITOR_FLOW)[number]))
}

function reload() {
  allRows.value = listVisitorEntries()
}

onMounted(reload)
</script>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(3, minmax(260px, 1fr));
  gap: 12px;
  align-items: start;
}
@media (max-width: 1200px) {
  .board { grid-template-columns: repeat(2, minmax(260px, 1fr)); }
}
.board-col {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
.col-onsite { border-color: #1e40af; box-shadow: 0 0 0 1px #1e40af inset; }
.col-head h3 { margin: 0; font-size: 14px; }
.col-note { font-size: 11px; color: var(--muted); }
.card-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.visitor-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  background: #fcfdff;
}
.card-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.card-body { margin: 0; display: flex; flex-direction: column; gap: 3px; }
.card-body > div { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.card-body dt { color: var(--muted); margin: 0; }
.card-body dd { margin: 0; text-align: right; }
.reason-tag,
.status-tag { font-size: 11px; border-radius: 999px; padding: 1px 8px; background: #eef2f7; }
.flow-0 { background: #fef3c7; color: #92400e; }
.flow-1 { background: #dbeafe; color: #1e40af; }
.flow-2 { background: #dcfce7; color: #166534; }
.onsite-note { color: #1e40af; font-weight: 600; }
.card-missing { border-color: #b42318; background: #fef2f2; }
.card-booked { opacity: 0.85; }
.field-missing { color: #b42318; font-weight: 600; }
.muted { color: var(--muted); }
.card-empty { list-style: none; font-size: 12px; color: var(--muted); text-align: center; padding: 12px 0; }
.review-row dd { color: #166534; }
.legend-warn { background: #fee2e2; color: #b42318; }
</style>
