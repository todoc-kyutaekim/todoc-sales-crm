import { Hono } from 'hono'
import { safeInt } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const dash = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// period → 시작일 (YYYY-MM-DD HH:MM:SS in UTC-ish; D1 uses CURRENT_TIMESTAMP UTC)
// today / week / month / 90d
function periodStart(period: string): string {
  const now = new Date()
  const d = new Date(now)
  switch (period) {
    case 'today':
      d.setUTCHours(0, 0, 0, 0)
      return d.toISOString().replace('T', ' ').slice(0, 19)
    case 'week': {
      // 지난 7일
      d.setUTCDate(d.getUTCDate() - 7)
      return d.toISOString().replace('T', ' ').slice(0, 19)
    }
    case '90d': {
      d.setUTCDate(d.getUTCDate() - 90)
      return d.toISOString().replace('T', ' ').slice(0, 19)
    }
    case 'month':
    default: {
      // 이번 달 1일
      d.setUTCDate(1)
      d.setUTCHours(0, 0, 0, 0)
      return d.toISOString().replace('T', ' ').slice(0, 19)
    }
  }
}

// GET /api/cs/dashboard?period=today|week|month|90d&mine=1
dash.get('/', async (c) => {
  const { env } = c
  const userId = c.get('userId') as number
  const period = (c.req.query('period') || 'month').toLowerCase()
  const mine = c.req.query('mine') === '1'
  const since = periodStart(period)

  // 담당자 필터: mine=1 → assignee_id = 현재 사용자
  const mineInqCond = mine ? ' AND assignee_id = ?' : ''
  const mineRepCond = mine ? ' AND assignee_id = ?' : ''
  const mineArgs = mine ? [userId] : []

  // ────────────────────────────────────────────────
  // 1) KPI 카드 (4장)
  //   - new_inquiries: period 내 신규 문의
  //   - open_inquiries: 현재 open + in_progress
  //   - active_repairs: 현재 진행 중 수리 (received/diagnosing/waiting_parts/repairing)
  //   - resolved_today: 오늘(UTC) 해결된 문의
  // ────────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10)

  const kpiSql = [
    // new_inquiries (기간 내)
    `SELECT COUNT(*) AS n FROM cs_inquiries WHERE created_at >= ?${mineInqCond}`,
    // open_inquiries (현재 미처리 — 기간 무관)
    `SELECT COUNT(*) AS n FROM cs_inquiries WHERE status IN ('open','in_progress')${mineInqCond}`,
    // active_repairs (현재 진행 중 — 기간 무관)
    `SELECT COUNT(*) AS n FROM cs_repairs WHERE status IN ('received','diagnosing','waiting_parts','repairing')${mineRepCond}`,
    // resolved_today (오늘 해결 — 기간 무관, 항상 "오늘")
    `SELECT COUNT(*) AS n FROM cs_inquiries WHERE resolved_at IS NOT NULL AND DATE(resolved_at) = DATE('now')${mineInqCond}`,
  ]

  const kpiRes = await Promise.all([
    env.DB.prepare(kpiSql[0]).bind(since, ...mineArgs).first(),
    env.DB.prepare(kpiSql[1]).bind(...mineArgs).first(),
    env.DB.prepare(kpiSql[2]).bind(...mineArgs).first(),
    env.DB.prepare(kpiSql[3]).bind(...mineArgs).first(),
  ])
  const kpi = {
    new_inquiries: Number((kpiRes[0] as any)?.n || 0),
    open_inquiries: Number((kpiRes[1] as any)?.n || 0),
    active_repairs: Number((kpiRes[2] as any)?.n || 0),
    resolved_today: Number((kpiRes[3] as any)?.n || 0),
  }

  // ────────────────────────────────────────────────
  // 2) 문의 상태별 분포 (기간 내)
  //   - open / in_progress / resolved / closed / canceled
  // ────────────────────────────────────────────────
  const inqStatusRows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM cs_inquiries
     WHERE created_at >= ?${mineInqCond}
     GROUP BY status`
  ).bind(since, ...mineArgs).all()
  const inqStatus: Record<string, number> = {
    open: 0, in_progress: 0, resolved: 0, closed: 0, canceled: 0,
  }
  for (const r of (inqStatusRows.results || []) as any[]) {
    if (r.status in inqStatus) inqStatus[r.status] = Number(r.n)
  }

  // ────────────────────────────────────────────────
  // 3) 우선순위 분포 (기간 내 오픈 상태)
  // ────────────────────────────────────────────────
  const priorityRows = await env.DB.prepare(
    `SELECT priority, COUNT(*) AS n FROM cs_inquiries
     WHERE status IN ('open','in_progress')${mineInqCond}
     GROUP BY priority`
  ).bind(...mineArgs).all()
  const priority: Record<string, number> = { urgent: 0, high: 0, mid: 0, low: 0 }
  for (const r of (priorityRows.results || []) as any[]) {
    if (r.priority in priority) priority[r.priority] = Number(r.n)
  }

  // ────────────────────────────────────────────────
  // 4) 최근 14일 추이 (일별 신규 vs 해결)
  // ────────────────────────────────────────────────
  const trendNewRows = await env.DB.prepare(
    `SELECT DATE(created_at) AS d, COUNT(*) AS n
     FROM cs_inquiries
     WHERE created_at >= DATE('now','-13 days')${mineInqCond}
     GROUP BY DATE(created_at)`
  ).bind(...mineArgs).all()
  const trendResolvedRows = await env.DB.prepare(
    `SELECT DATE(resolved_at) AS d, COUNT(*) AS n
     FROM cs_inquiries
     WHERE resolved_at IS NOT NULL AND DATE(resolved_at) >= DATE('now','-13 days')${mineInqCond}
     GROUP BY DATE(resolved_at)`
  ).bind(...mineArgs).all()
  const newMap: Record<string, number> = {}
  for (const r of (trendNewRows.results || []) as any[]) newMap[r.d] = Number(r.n)
  const resMap: Record<string, number> = {}
  for (const r of (trendResolvedRows.results || []) as any[]) resMap[r.d] = Number(r.n)

  // 14일 라벨 생성
  const trendLabels: string[] = []
  const trendNew: number[] = []
  const trendResolved: number[] = []
  const base = new Date()
  base.setUTCHours(0, 0, 0, 0)
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(base)
    dt.setUTCDate(dt.getUTCDate() - i)
    const key = dt.toISOString().slice(0, 10)
    trendLabels.push(key)
    trendNew.push(newMap[key] || 0)
    trendResolved.push(resMap[key] || 0)
  }

  // ────────────────────────────────────────────────
  // 5) AS/수리 상태 분포 (기간 무관 — 현재 진행 중 + 완료 요약)
  // ────────────────────────────────────────────────
  const repStatusRows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM cs_repairs
     WHERE 1=1${mineRepCond}
     GROUP BY status`
  ).bind(...mineArgs).all()
  const repStatus: Record<string, number> = {
    received: 0, diagnosing: 0, waiting_parts: 0, repairing: 0,
    completed: 0, shipped: 0, closed: 0, rejected: 0,
  }
  for (const r of (repStatusRows.results || []) as any[]) {
    if (r.status in repStatus) repStatus[r.status] = Number(r.n)
  }

  // ────────────────────────────────────────────────
  // 6-a) 긴급/장기 미처리 문의 TOP 10
  //   - open/in_progress, 우선순위 순, 오래된 순
  // ────────────────────────────────────────────────
  const urgentRows = await env.DB.prepare(
    `SELECT i.id, i.subject, i.priority, i.status, i.category, i.created_at,
            i.contact_name, cust.name AS customer_name,
            u.name AS assignee_name,
            CAST((julianday('now') - julianday(i.created_at)) AS INTEGER) AS days_open
     FROM cs_inquiries i
     LEFT JOIN customers cust ON cust.id = i.customer_id
     LEFT JOIN users u ON u.id = i.assignee_id
     WHERE i.status IN ('open','in_progress')${mine ? ' AND i.assignee_id = ?' : ''}
     ORDER BY
       CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'mid' THEN 2 ELSE 3 END ASC,
       i.created_at ASC
     LIMIT 10`
  ).bind(...mineArgs).all()

  // ────────────────────────────────────────────────
  // 6-b) 담당자별 처리 현황
  //   - 담당자별: 오픈 / 진행 중 / 이번 기간 내 해결
  // ────────────────────────────────────────────────
  const assigneeRows = await env.DB.prepare(
    `SELECT u.id, u.name,
       SUM(CASE WHEN i.status='open' THEN 1 ELSE 0 END) AS open_n,
       SUM(CASE WHEN i.status='in_progress' THEN 1 ELSE 0 END) AS progress_n,
       SUM(CASE WHEN i.status='resolved' AND i.resolved_at >= ? THEN 1 ELSE 0 END) AS resolved_n
     FROM users u
     JOIN cs_inquiries i ON i.assignee_id = u.id
     GROUP BY u.id, u.name
     HAVING (open_n + progress_n + resolved_n) > 0
     ORDER BY (open_n + progress_n) DESC, resolved_n DESC
     LIMIT 10`
  ).bind(since).all()

  // ────────────────────────────────────────────────
  // 7) FAQ / 지식베이스 요약
  //   - 카테고리별 아티클 수 (published only)
  //   - 최근 등록 5건
  // ────────────────────────────────────────────────
  const kbCatRows = await env.DB.prepare(
    `SELECT category, COUNT(*) AS n FROM cs_kb_articles
     WHERE status='published'
     GROUP BY category
     ORDER BY n DESC`
  ).all()
  const kbRecentRows = await env.DB.prepare(
    `SELECT id, title, category, view_count, updated_at
     FROM cs_kb_articles
     WHERE status='published'
     ORDER BY updated_at DESC
     LIMIT 5`
  ).all()

  // 평균 응답 시간 (기간 내 resolved 문의의 created_at → resolved_at)
  const avgRes = await env.DB.prepare(
    `SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS avg_hours
     FROM cs_inquiries
     WHERE resolved_at IS NOT NULL AND resolved_at >= ?${mineInqCond}`
  ).bind(since, ...mineArgs).first() as any
  const avgResolutionHours = avgRes?.avg_hours != null ? Math.round(Number(avgRes.avg_hours) * 10) / 10 : null

  return c.json({
    period,
    mine,
    since,
    kpi,
    inquiry_status: inqStatus,
    priority,
    trend: { labels: trendLabels, new: trendNew, resolved: trendResolved },
    repair_status: repStatus,
    urgent_inquiries: (urgentRows.results || []),
    assignees: (assigneeRows.results || []),
    kb: {
      categories: (kbCatRows.results || []),
      recent: (kbRecentRows.results || []),
    },
    avg_resolution_hours: avgResolutionHours,
  })
})

export default dash
