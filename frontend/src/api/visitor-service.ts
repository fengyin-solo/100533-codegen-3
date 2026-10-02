import {
  appendSafetyReview,
  listVisitors,
  nextVisitorCode,
  nowStamp,
  persistVisitors,
  resetVisitors,
} from '@/data/visitor-store'
import { VISITOR_FLOW, VISIT_REASONS } from '@/data/visitor-types'
import type { VisitorActionResult, VisitorRow, VisitorStatus } from '@/data/visitor-types'

// 进区流程只能一段一段往下走：预约 → 签到 → 离场，中间不许跨步。
const NEXT_STATUS: Record<string, VisitorStatus> = {
  预约登记: '已预约',
  到区签到: '在区中',
  离场登记: '已离场',
}

function findIndex(rows: VisitorRow[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

function sameVisitorActive(rows: VisitorRow[], code: string, exceptId = -1): boolean {
  // 同一位访客重复提交签到只留一条在区记录：在区中编号相同即视为重复。
  return rows.some(
    (row) => Number(row.id) !== exceptId && row.访客编号 === code && row.status === '在区中',
  )
}

export function listVisitorEntries(filters: { 到访事由?: string; 关键字?: string } = {}): VisitorRow[] {
  let rows = [...listVisitors()]
  if (filters.到访事由) {
    rows = rows.filter((row) => row.到访事由 === filters.到访事由)
  }
  const keyword = filters.关键字?.trim()
  if (keyword) {
    rows = rows.filter((row) =>
      [row.访客编号, row.到访事由, row.陪同人, row.签到时间, row.离场时间]
        .join(' ')
        .includes(keyword),
    )
  }
  return rows
}

export function createAppointment(input: {
  访客编号?: string
  到访事由: string
  陪同人: string
  预约到访: string
}): VisitorActionResult {
  const rows = listVisitors()
  const 到访事由 = input.到访事由.trim()
  if (!VISIT_REASONS.includes(到访事由 as (typeof VISIT_REASONS)[number])) {
    return { ok: false, message: '到访事由不在接待册分栏范围内，请重新选择' }
  }
  const 预约到访 = input.预约到访.trim()
  if (!预约到访) {
    return { ok: false, message: '预约到访时间不能为空' }
  }
  const code = input.访客编号?.trim() || nextVisitorCode(rows)
  if (rows.some((row) => row.访客编号 === code)) {
    return { ok: false, message: `访客编号 ${code} 已存在，不能重复预约` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  rows.push({
    id,
    status: '已预约',
    pending: true,
    abnormal: false,
    访客编号: code,
    到访事由,
    // 预约阶段可以先不登记陪同人，但没补登记之前不予放行签到。
    陪同人: input.陪同人.trim(),
    预约到访,
    签到时间: '',
    离场时间: '',
    批复人: '',
    联动巡查编号: '',
  })
  persistVisitors(rows)
  return { ok: true, message: `已预约，访客编号 ${code}，下一步到区签到` }
}

export function fillEscort(id: number, escort: string): VisitorActionResult {
  const rows = listVisitors()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的访客` }
  }
  const name = escort.trim()
  if (!name) {
    return { ok: false, message: '陪同人必须登记，没有陪同人不予放行' }
  }
  rows[index] = { ...rows[index], 陪同人: name }
  persistVisitors(rows)
  return { ok: true, message: `已登记陪同人 ${name}，可以办理签到` }
}

export function checkIn(id: number): VisitorActionResult {
  const rows = listVisitors()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的访客` }
  }
  const row = rows[index]
  // 预约走完才轮到签到：只有「已预约」能签到，不许跨步。
  if (row.status !== '已预约') {
    return { ok: false, message: `当前为「${row.status}」，只有已预约的访客才能签到，不能跨步办理` }
  }
  // 没有登记陪同人的访客不许放行。
  if (!row.陪同人.trim()) {
    return { ok: false, message: '该访客未登记陪同人，按规定不予放行，请先补登记陪同人' }
  }
  // 同一位访客重复提交签到只留一条在区记录。
  if (sameVisitorActive(rows, row.访客编号, id)) {
    return { ok: false, message: `访客 ${row.访客编号} 已有一条在区记录，重复签到不再另立条目` }
  }
  rows[index] = { ...row, 签到时间: nowStamp() }
  applyStatus(rows[index], '在区中')
  persistVisitors(rows)
  return { ok: true, message: `访客 ${row.访客编号} 已签到放行，进入在区记录` }
}

export function registerLeave(id: number, leaveAt = ''): VisitorActionResult {
  const rows = listVisitors()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的访客` }
  }
  const row = rows[index]
  // 最后才到离场：只有「在区中」能离场，预约未到的不许直接离场。
  if (row.status !== '在区中') {
    return { ok: false, message: `当前为「${row.status}」，只有在区中的访客才能离场，不能跨步办理` }
  }
  const 离场时间 = leaveAt.trim()
  rows[index] = {
    ...row,
    离场时间,
    // 离场时间缺失的标出来：abnormal 置真，接待册对应位置给出补齐提示。
    abnormal: !离场时间,
  }
  applyStatus(rows[index], '已离场')
  persistVisitors(rows)
  if (!离场时间) {
    return { ok: true, message: `访客 ${row.访客编号} 已离场，但离场时间未填，已标出待补齐` }
  }
  return { ok: true, message: `访客 ${row.访客编号} 已离场，离场时间已登记，等待离场批复` }
}

export function completeLeaveTime(id: number, leaveAt: string): VisitorActionResult {
  const rows = listVisitors()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的访客` }
  }
  const value = leaveAt.trim()
  if (!value) {
    return { ok: false, message: '离场时间不能为空，请补齐后再提交' }
  }
  const row = rows[index]
  if (row.status !== '已离场') {
    return { ok: false, message: '只有已离场的访客才需要补填离场时间' }
  }
  rows[index] = { ...row, 离场时间: value, abnormal: false }
  persistVisitors(rows)
  return { ok: true, message: `访客 ${row.访客编号} 的离场时间已补齐：${value}` }
}

export function approveLeave(id: number, approver: string): VisitorActionResult {
  const rows = listVisitors()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的访客` }
  }
  const row = rows[index]
  if (row.status !== '已离场') {
    return { ok: false, message: '离场收尾前必须先完成离场登记，流程不能跨步' }
  }
  // 离场时间缺失的要提示补齐：批复环节再拦一道。
  if (!row.离场时间.trim()) {
    return { ok: false, message: '离场时间缺失，请先补齐离场时间，再作离场批复' }
  }
  const name = approver.trim()
  if (!name) {
    return { ok: false, message: '离场批复需要填写批复人' }
  }
  let reviewCode = row.联动巡查编号
  // 离场收尾的批复落到巡查台账：幂等，重复批复不重复追加现场复核项。
  if (!reviewCode) {
    reviewCode = appendSafetyReview({ ...row, 批复人: name })
  }
  rows[index] = { ...row, 批复人: name, 联动巡查编号: reviewCode, abnormal: false }
  persistVisitors(rows)
  return {
    ok: true,
    message: `离场已批复，巡查台账已新增现场复核项 ${reviewCode}`,
    reviewCode,
  }
}

export function resetVisitorBook(): VisitorRow[] {
  return resetVisitors()
}

function applyStatus(row: VisitorRow, target: VisitorStatus): void {
  row.status = target
  row.pending = target !== VISITOR_FLOW[VISITOR_FLOW.length - 1]
}

export { NEXT_STATUS }
