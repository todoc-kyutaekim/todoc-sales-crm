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

  // ═══════════════════════════════════════════════════════════════
  // ⚠️⚠️ 성능 핵심 — 절대 개별 await로 되돌리지 마세요 ⚠️⚠️
  //
  // 이 엔드포인트가 필요한 14개 쿼리는 서로 전혀 의존하지 않습니다.
  // 예전에는 이것을 하나씩 await 하여 D1 왕복이 11회 발생했고,
  // 인증 미들웨어(index.tsx) 1회를 더하면 요청당 12회 왕복이었습니다.
  //
  // D1 primary 리전은 ENAM(미국 동부)이고 읽기 복제는 꺼져 있어,
  // 한국에서 접속하면 왕복 1회당 약 200ms가 듭니다.
  //   → 12회 × 200ms ≈ 2.4초가 순수 대기 시간으로 낭비됐습니다.
  //
  // 그래서 D1 batch()로 14개를 "단 1회 왕복"에 묶었습니다.
  // (Promise.all과 달리 batch는 요청 1건에 모든 statement를 담아
  //  왕복 1회를 보장합니다.)
  //
  // 🔧 쿼리를 추가할 때 규칙
  //   1. STMTS 배열 끝에 statement를 추가하고,
  //   2. 아래 구조 분해(destructuring) 목록 끝에 변수명을 추가하세요.
  //   배열 순서와 구조 분해 순서가 1:1로 대응해야 합니다.
  //   개별 `await env.DB.prepare(...)`를 새로 만들면 왕복이 다시 늘어납니다.
  // ═══════════════════════════════════════════════════════════════

  const [
    // 1) KPI 카드 4장
    kpiNewRes,            // period 내 신규 문의
    kpiOpenRes,           // 현재 open + in_progress (기간 무관)
    kpiActiveRepairRes,   // 현재 진행 중 수리 (기간 무관)
    kpiResolvedTodayRes,  // 오늘 해결된 문의 (항상 "오늘")
    // 2) 문의 상태별 분포 (기간 내)
    inqStatusRes,
    // 3) 우선순위 분포 (현재 미처리)
    priorityRes,
    // 4) 최근 14일 추이
    trendNewRes,
    trendResolvedRes,
    // 5) AS/수리 상태 분포 (기간 무관)
    repStatusRes,
    // 6-a) 긴급/장기 미처리 문의 TOP 10
    urgentRes,
    // 6-b) 담당자별 처리 현황
    assigneeRes,
    // 7) FAQ / 지식베이스 요약
    kbCatRes,
    kbRecentRes,
    // 8) 평균 해결 시간 (기간 내)
    avgRes,
  ] = await env.DB.batch([
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cs_inquiries WHERE created_at >= ?${mineInqCond}`
    ).bind(since, ...mineArgs),

    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cs_inquiries WHERE status IN ('open','in_progress')${mineInqCond}`
    ).bind(...mineArgs),

    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cs_repairs WHERE status IN ('received','diagnosing','waiting_parts','repairing')${mineRepCond}`
    ).bind(...mineArgs),

    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM cs_inquiries WHERE resolved_at IS NOT NULL AND DATE(resolved_at) = DATE('now')${mineInqCond}`
    ).bind(...mineArgs),

    env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM cs_inquiries
       WHERE created_at >= ?${mineInqCond}
       GROUP BY status`
    ).bind(since, ...mineArgs),

    env.DB.prepare(
      `SELECT priority, COUNT(*) AS n FROM cs_inquiries
       WHERE status IN ('open','in_progress')${mineInqCond}
       GROUP BY priority`
    ).bind(...mineArgs),

    env.DB.prepare(
      `SELECT DATE(created_at) AS d, COUNT(*) AS n
       FROM cs_inquiries
       WHERE created_at >= DATE('now','-13 days')${mineInqCond}
       GROUP BY DATE(created_at)`
    ).bind(...mineArgs),

    env.DB.prepare(
      `SELECT DATE(resolved_at) AS d, COUNT(*) AS n
       FROM cs_inquiries
       WHERE resolved_at IS NOT NULL AND DATE(resolved_at) >= DATE('now','-13 days')${mineInqCond}
       GROUP BY DATE(resolved_at)`
    ).bind(...mineArgs),

    env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM cs_repairs
       WHERE 1=1${mineRepCond}
       GROUP BY status`
    ).bind(...mineArgs),

    env.DB.prepare(
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
    ).bind(...mineArgs),

    env.DB.prepare(
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
    ).bind(since),

    env.DB.prepare(
      `SELECT category, COUNT(*) AS n FROM cs_kb_articles
       WHERE status='published'
       GROUP BY category
       ORDER BY n DESC`
    ),

    env.DB.prepare(
      `SELECT id, title, category, view_count, updated_at
       FROM cs_kb_articles
       WHERE status='published'
       ORDER BY updated_at DESC
       LIMIT 5`
    ),

    env.DB.prepare(
      `SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24) AS avg_hours
       FROM cs_inquiries
       WHERE resolved_at IS NOT NULL AND resolved_at >= ?${mineInqCond}`
    ).bind(since, ...mineArgs),
  ])

  // batch() 결과는 D1Result 형태이므로 헬퍼로 꺼냅니다.
  //   rowsOf  : 기존 `.all()`  → results 배열
  //   firstOf : 기존 `.first()` → results[0] (없으면 null)
  const rowsOf = (r: any): any[] => (r?.results || []) as any[]
  const firstOf = (r: any): any => (r?.results?.[0] ?? null)

  // ── 1) KPI 카드 ──
  const kpi = {
    new_inquiries: Number(firstOf(kpiNewRes)?.n || 0),
    open_inquiries: Number(firstOf(kpiOpenRes)?.n || 0),
    active_repairs: Number(firstOf(kpiActiveRepairRes)?.n || 0),
    resolved_today: Number(firstOf(kpiResolvedTodayRes)?.n || 0),
  }

  // ── 2) 문의 상태별 분포 ──
  const inqStatus: Record<string, number> = {
    open: 0, in_progress: 0, resolved: 0, closed: 0, canceled: 0,
  }
  for (const r of rowsOf(inqStatusRes)) {
    if (r.status in inqStatus) inqStatus[r.status] = Number(r.n)
  }

  // ── 3) 우선순위 분포 ──
  const priority: Record<string, number> = { urgent: 0, high: 0, mid: 0, low: 0 }
  for (const r of rowsOf(priorityRes)) {
    if (r.priority in priority) priority[r.priority] = Number(r.n)
  }

  // ── 4) 최근 14일 추이 (일별 신규 vs 해결) ──
  const newMap: Record<string, number> = {}
  for (const r of rowsOf(trendNewRes)) newMap[r.d] = Number(r.n)
  const resMap: Record<string, number> = {}
  for (const r of rowsOf(trendResolvedRes)) resMap[r.d] = Number(r.n)

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

  // ── 5) AS/수리 상태 분포 ──
  const repStatus: Record<string, number> = {
    received: 0, diagnosing: 0, waiting_parts: 0, repairing: 0,
    completed: 0, shipped: 0, closed: 0, rejected: 0,
  }
  for (const r of rowsOf(repStatusRes)) {
    if (r.status in repStatus) repStatus[r.status] = Number(r.n)
  }

  // ── 8) 평균 해결 시간 ──
  const avgHoursRaw = firstOf(avgRes)?.avg_hours
  const avgResolutionHours = avgHoursRaw != null ? Math.round(Number(avgHoursRaw) * 10) / 10 : null

  return c.json({
    period,
    mine,
    since,
    kpi,
    inquiry_status: inqStatus,
    priority,
    trend: { labels: trendLabels, new: trendNew, resolved: trendResolved },
    repair_status: repStatus,
    urgent_inquiries: rowsOf(urgentRes),
    assignees: rowsOf(assigneeRes),
    kb: {
      categories: rowsOf(kbCatRes),
      recent: rowsOf(kbRecentRes),
    },
    avg_resolution_hours: avgResolutionHours,
  })
})

export default dash
