import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 访客接待册的专属规矩都收在这里：顺序流转、陪同人核验、在区唯一、离场联动巡查台账。
const VISITOR_KEY = 'visitor'
const VISITOR_SIGNIN = '登记签到'
const VISITOR_DEPART = '办理离场'
const SAFETY_KEY = 'safety'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function nowStamp(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

export function todayStamp(): string {
  return nowStamp().slice(0, 10)
}

// 离场时间要么没填、要么只填了一半（缺日期或缺分钟），都算「不全」，接待册上要标出来。
export function isDepartureTimeIncomplete(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) {
    return true
  }
  return !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)
}

// 签到放行的硬性规矩：没登记陪同人不许放行；同一访客当天重复签到只留一条在区记录。
function visitorSigninGuard(rows: EntryRow[], index: number): string | null {
  const row = rows[index]
  const code = String(row['访客编号'] ?? '').trim()
  if (!String(row['陪同人'] ?? '').trim()) {
    return `访客 ${code} 未登记陪同人，不许放行进区`
  }
  const onsite = rows.find(
    (item, other) =>
      other !== index &&
      String(item.status) === '已签到' &&
      String(item['访客编号'] ?? '').trim() === code &&
      String(item['到访日期'] ?? '') === String(row['到访日期'] ?? ''),
  )
  if (onsite) {
    return `访客 ${code} 当天已有在区记录（#${onsite.id}），重复签到只保留这一条`
  }
  return null
}

// 离场收尾的批复落到巡查台账：安全巡查模块随之添一条「现场复核」项，返回新巡查编号。
function appendDepartureReview(row: EntryRow): string {
  const rows = listRows(SAFETY_KEY)
  const nextId = rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const code = `SAFE-${String(nextId).padStart(4, '0')}`
  const review: EntryRow = {
    id: nextId,
    status: '待巡查',
    pending: true,
    abnormal: false,
    巡查编号: code,
    巡查区域: '发掘区访客通道',
    巡查类别: '现场复核',
    隐患描述: `访客 ${String(row['访客编号'] ?? '')} 离场收尾复核：核对陪同人、登记信息与随身物品`,
    整改措施: '',
    巡查人: String(row['陪同人'] ?? '').trim() || '值班门卫',
    巡查日期: todayStamp(),
    巡查状态: '待巡查',
  }
  saveRows(SAFETY_KEY, [...rows, review])
  return code
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 顺序流转的模块只能一段一段往下走：预约走完才轮到签到，最后才到离场，中间不许跨步。
  if (meta.strictFlow) {
    const fromIndex = meta.statuses.indexOf(current)
    const toIndex = meta.statuses.indexOf(target)
    if (toIndex !== fromIndex + 1) {
      return {
        ok: false,
        message: `${meta.name}的流程只能一段一段往下走（${meta.statuses.join('→')}），不许从「${current}」跨到「${target}」`,
      }
    }
  }
  if (key === VISITOR_KEY && action === VISITOR_SIGNIN) {
    const refused = visitorSigninGuard(rows, index)
    if (refused) {
      return { ok: false, message: refused }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  let extra = ''
  if (key === VISITOR_KEY && action === VISITOR_DEPART && !String(updated['离场时间'] ?? '').trim()) {
    updated['离场时间'] = nowStamp()
    extra = `，离场时间补记为 ${updated['离场时间']}`
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (key === VISITOR_KEY && action === VISITOR_DEPART) {
    const reviewCode = appendDepartureReview(updated)
    extra += `；巡查台账已添现场复核项 ${reviewCode}`
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extra}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
