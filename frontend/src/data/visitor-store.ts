import { listRows, saveRows } from './local-store'
import { SEED_VISITORS } from './visitor-seed'
import type { VisitorRow } from './visitor-types'

// 访客数据单独存一份：门卫登记与接待册读的是同一批记录，访客编号天然一致。
const VISITOR_STORAGE_KEY = 'archaeology-field:visitors'
const SAFETY_MODULE_KEY = 'safety'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readVisitors(): VisitorRow[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_VISITORS)
  }
  const raw = window.localStorage.getItem(VISITOR_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(SEED_VISITORS))
    return clone(SEED_VISITORS)
  }
  try {
    return JSON.parse(raw) as VisitorRow[]
  } catch {
    window.localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(SEED_VISITORS))
    return clone(SEED_VISITORS)
  }
}

let cache: VisitorRow[] | null = null

export function listVisitors(): VisitorRow[] {
  if (cache === null) {
    cache = readVisitors()
  }
  return cache
}

export function persistVisitors(rows: VisitorRow[]): void {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(rows))
  }
}

export function resetVisitors(): VisitorRow[] {
  const rows = clone(SEED_VISITORS)
  persistVisitors(rows)
  return rows
}

export function nextVisitorCode(rows: VisitorRow[]): string {
  const max = rows.reduce((acc, row) => {
    const tail = Number(String(row.访客编号).replace(/^VIS-/, ''))
    return Number.isFinite(tail) ? Math.max(acc, tail) : acc
  }, 0)
  return `VIS-${String(max + 1).padStart(4, '0')}`
}

// 离场批复落到巡查台账：在安全巡查记录尾部追加一条「现场复核」项，并返回其巡查编号。
export function appendSafetyReview(visitor: VisitorRow): string {
  const rows = listRows(SAFETY_MODULE_KEY)
  const numericTails = rows
    .map((row) => Number(String(row['巡查编号'] ?? '').replace(/^SAFE-/, '')))
    .filter((n) => Number.isFinite(n))
  const nextTail = numericTails.reduce((a, b) => Math.max(a, b), 1000) + 1
  const code = `SAFE-${nextTail}`
  const today = (visitor.离场时间 || nowStamp()).slice(0, 10)
  rows.push({
    id: (rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) || 0) + 1,
    status: '待巡查',
    pending: true,
    abnormal: false,
    巡查编号: code,
    巡查区域: '发掘区出入口',
    巡查类别: '离场现场复核',
    隐患描述: `访客${visitor.访客编号}（${visitor.到访事由}）离场批复，核对接待人、离场时间与随身物品`,
    整改措施: '门卫现场复核，异常即上报',
    巡查人: visitor.批复人 || '值班管理员',
    巡查日期: today,
    巡查状态: '待复核',
  })
  saveRows(SAFETY_MODULE_KEY, rows)
  return code
}

export { nowStamp }
