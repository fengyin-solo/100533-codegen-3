/** 访客接待册专用类型：进区流程一段一段往下走，不许跨步。 */

// 进区流程状态：已预约 → 在区中 → 已离场，顺序固定。
export const VISITOR_FLOW = ['已预约', '在区中', '已离场'] as const
export type VisitorStatus = (typeof VISITOR_FLOW)[number]

// 到访事由分栏：接待册按这几栏展示。
export const VISIT_REASONS = ['业务参观', '检查指导', '学术交流', '施工维保', '媒体采访'] as const

// 门卫动作：预约走完才轮到签到，签到之后才到离场。
export type VisitorAction = '预约登记' | '补登记陪同人' | '到区签到' | '离场登记' | '补填离场时间' | '离场批复'

export type VisitorRow = {
  id: number
  status: VisitorStatus
  pending: boolean
  abnormal: boolean
  访客编号: string
  到访事由: string
  陪同人: string
  预约到访: string
  签到时间: string
  离场时间: string
  批复人: string
  联动巡查编号: string
}

export type VisitorActionResult = {
  ok: boolean
  message: string
  /** 离场批复成功时，带回巡查台账新增的现场复核项编号。 */
  reviewCode?: string
}

// 巡查台账（安全巡查）里由离场批复追加的现场复核项，沿用 EntryRow 结构。
export type SafetyReviewSeed = Record<string, unknown>
