import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const dashboard = new Hono<{ Bindings: Bindings }>()

// KST helper: SQLite date('now') is UTC, add +9 hours for Korean Standard Time
const KST = "'+9 hours'"

// Period-aware dashboard (supports ?period=month|quarter|year)
dashboard.get('/', async (c) => {
  const period = c.req.query('period') || 'month'
  let dateFilter = `date('now',${KST},'start of month')`
  let prevDateFilter = `date('now',${KST},'start of month','-1 month')`
  let prevEndFilter = `date('now',${KST},'start of month')`
  if (period === 'quarter') {
    dateFilter = `date('now',${KST},'start of month','-2 months','start of month')`
    prevDateFilter = `date('now',${KST},'start of month','-5 months','start of month')`
    prevEndFilter = `date('now',${KST},'start of month','-2 months','start of month')`
  } else if (period === 'year') {
    dateFilter = `date('now',${KST},'start of year')`
    prevDateFilter = `date('now',${KST},'start of year','-1 year')`
    prevEndFilter = `date('now',${KST},'start of year')`
  }

  const [hospitals, hospitalsAll, doctors, meetings, monthMeetings, lastMonthMeetings, recentMeetingsRaw, upcomingActionsRaw, regionStats, ciLatest, monthlyTrend, remindersRaw,
    // New: this week's meetings
    thisWeekMeetingsRaw,
    // New: long-inactive hospitals (no meeting in 30+ days)
    longInactiveRaw,
    // New: recently added hospitals
    recentHospitalsRaw,
    // New: recently added doctors
    recentDoctorsRaw,
    // New: hospital code registration stats
    codeRegistered, codeUnregistered,
    // New: pipeline stage summary
    pipelineSummaryRaw
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as c FROM hospitals WHERE status="active"').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM hospitals').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM doctors').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM meetings').first(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= ${dateFilter}`).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= ${prevDateFilter} AND meeting_date < ${prevEndFilter}`).first(),
    c.env.DB.prepare('SELECT m.*, h.name as hospital_name FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id ORDER BY m.meeting_date DESC LIMIT 8').all(),
    c.env.DB.prepare("SELECT m.*, h.name as hospital_name FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id WHERE m.next_action!='' AND m.next_action IS NOT NULL ORDER BY m.next_meeting_date ASC LIMIT 10").all(),
    c.env.DB.prepare('SELECT region, COUNT(*) as count FROM hospitals WHERE status="active" AND region!="" GROUP BY region ORDER BY count DESC').all(),
    c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient WHERE gender='계' AND visit_type='계' ORDER BY year DESC LIMIT 2").all().catch(() => ({ results: [] })),
    // Monthly meeting trend (last 6 months)
    c.env.DB.prepare(`
      SELECT strftime('%Y-%m', meeting_date) as month, COUNT(*) as count, 
        SUM(CASE WHEN meeting_type='visit' THEN 1 ELSE 0 END) as visit_count,
        SUM(CASE WHEN meeting_type='phone' THEN 1 ELSE 0 END) as phone_count,
        SUM(CASE WHEN meeting_type='conference' THEN 1 ELSE 0 END) as conf_count,
        SUM(CASE WHEN meeting_type='email' THEN 1 ELSE 0 END) as email_count,
        SUM(CASE WHEN meeting_type='online' THEN 1 ELSE 0 END) as online_count
      FROM meetings WHERE meeting_date >= date('now','+9 hours','-6 months')
      GROUP BY month ORDER BY month ASC
    `).all(),
    // Upcoming meeting reminders (next 7 days) — includes both:
    // 1. meetings with next_meeting_date in next 7 days (follow-up scheduled)
    // 2. meetings with meeting_date in next 7 days (future meetings, e.g. from schedule planner)
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name, 'next' as reminder_type,
        COALESCE(m.next_meeting_date, m.meeting_date) as sort_date
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.next_meeting_date IS NOT NULL AND m.next_meeting_date != ''
        AND m.next_meeting_date >= date('now','+9 hours') AND m.next_meeting_date <= date('now','+9 hours','+7 days')
      UNION ALL
      SELECT m.*, h.name as hospital_name, 'scheduled' as reminder_type,
        m.meeting_date as sort_date
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.meeting_date >= date('now','+9 hours') AND m.meeting_date <= date('now','+9 hours','+7 days')
        AND m.id NOT IN (
          SELECT m2.id FROM meetings m2
          WHERE m2.next_meeting_date IS NOT NULL AND m2.next_meeting_date != ''
            AND m2.next_meeting_date >= date('now','+9 hours') AND m2.next_meeting_date <= date('now','+9 hours','+7 days')
        )
      ORDER BY sort_date ASC LIMIT 20
    `).all(),
    // This week's meetings (Mon-Sun) — only today and future, exclude past dates
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE (m.meeting_date >= date('now','+9 hours') AND m.meeting_date >= date('now','+9 hours','weekday 1','-7 days') AND m.meeting_date <= date('now','+9 hours','weekday 0'))
         OR (m.next_meeting_date >= date('now','+9 hours') AND m.next_meeting_date >= date('now','+9 hours','weekday 1','-7 days') AND m.next_meeting_date <= date('now','+9 hours','weekday 0'))
      ORDER BY COALESCE(m.next_meeting_date, m.meeting_date) ASC LIMIT 15
    `).all(),
    // Long-inactive hospitals (last meeting > 30 days ago or never)
    c.env.DB.prepare(`
      SELECT h.id, h.name, h.region, h.grade, h.status, h.pipeline_stage,
        MAX(m.meeting_date) as last_meeting_date,
        CAST(julianday('now','+9 hours') - julianday(MAX(m.meeting_date)) AS INTEGER) as days_since
      FROM hospitals h
      LEFT JOIN meetings m ON m.hospital_id = h.id
      GROUP BY h.id
      HAVING last_meeting_date IS NULL OR days_since > 30
      ORDER BY days_since DESC, h.name ASC
      LIMIT 8
    `).all(),
    // Recently added hospitals (last 14 days)
    c.env.DB.prepare(`
      SELECT id, name, region, grade, status, type, created_at
      FROM hospitals
      WHERE created_at >= date('now', '+9 hours', '-14 days')
      ORDER BY created_at DESC LIMIT 5
    `).all(),
    // Recently added doctors (last 14 days)
    c.env.DB.prepare(`
      SELECT d.id, d.name, d.department, d.position, d.hospital_id, h.name as hospital_name, d.created_at
      FROM doctors d LEFT JOIN hospitals h ON d.hospital_id = h.id
      WHERE d.created_at >= date('now', '+9 hours', '-14 days')
      ORDER BY d.created_at DESC LIMIT 5
    `).all(),
    // Hospital code registration stats
    c.env.DB.prepare('SELECT COUNT(*) as c FROM hospitals WHERE status="active"').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM hospitals WHERE status="inactive" OR status IS NULL').first(),
    // Pipeline stage summary
    c.env.DB.prepare(`
      SELECT pipeline_stage, COUNT(*) as count
      FROM hospitals
      GROUP BY pipeline_stage
      ORDER BY CASE pipeline_stage
        WHEN 'contact' THEN 1 WHEN 'meeting' THEN 2 WHEN 'demo' THEN 3
        WHEN 'proposal' THEN 4 WHEN 'contract' THEN 5 WHEN 'active_customer' THEN 6
        ELSE 7 END
    `).all(),
  ])

  // ===== TODAY'S TASKS (오늘의 할 일) =====
  const [todayMeetingsRaw, overdueActionsRaw, unwrittenMeetingsRaw, dueFollowupsRaw] = await Promise.all([
    // 1. 오늘 예정된 미팅 (meeting_date = today, OR next_meeting_date = today)
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name, 'today' as task_type
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.meeting_date = date('now','+9 hours')
         OR (m.next_meeting_date IS NOT NULL AND m.next_meeting_date != '' AND m.next_meeting_date = date('now','+9 hours'))
      ORDER BY m.visit_time ASC, m.meeting_date ASC LIMIT 20
    `).all(),
    // 2. 미처리 후속 액션 (next_meeting_date 가 지났는데 결과 처리 안 된 것)
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name, 'overdue' as task_type
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.next_meeting_date IS NOT NULL AND m.next_meeting_date != ''
        AND m.next_meeting_date < date('now','+9 hours')
        AND m.next_action IS NOT NULL AND m.next_action != ''
      ORDER BY m.next_meeting_date ASC LIMIT 10
    `).all(),
    // 3. 결과 미작성 미팅 (과거 미팅인데 result 비어있음)
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name, 'unwritten' as task_type
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.meeting_date < date('now','+9 hours')
        AND m.meeting_date >= date('now','+9 hours','-7 days')
        AND (m.result IS NULL OR m.result = '')
      ORDER BY m.meeting_date DESC LIMIT 10
    `).all(),
    // 4. 내일~3일 후 후속 미팅 예정
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name, 'upcoming_followup' as task_type
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.next_meeting_date IS NOT NULL AND m.next_meeting_date != ''
        AND m.next_meeting_date > date('now','+9 hours')
        AND m.next_meeting_date <= date('now','+9 hours','+3 days')
      ORDER BY m.next_meeting_date ASC LIMIT 10
    `).all(),
  ])

  // Helper: attach doctor names & user names to meetings via meeting_doctors + meeting_users
  async function enrichMeetings(meetingsList: any[]): Promise<any[]> {
    if (!meetingsList.length) return meetingsList
    const ids = meetingsList.map(m => m.id)
    const placeholders = ids.map(() => '?').join(',')
    const [dr, ur] = await Promise.all([
      c.env.DB.prepare(
        `SELECT md.meeting_id, d.id as doctor_id, d.name as doctor_name, d.photo as doctor_photo
         FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id
         WHERE md.meeting_id IN (${placeholders}) ORDER BY md.meeting_id, d.name`
      ).bind(...ids).all(),
      c.env.DB.prepare(
        `SELECT mu.meeting_id, u.id as user_id, u.name as user_name
         FROM meeting_users mu LEFT JOIN users u ON mu.user_id=u.id
         WHERE mu.meeting_id IN (${placeholders}) ORDER BY mu.meeting_id, u.name`
      ).bind(...ids).all(),
    ])
    const dMap = new Map<number, any[]>()
    for (const row of dr.results as any[]) {
      if (!dMap.has(row.meeting_id)) dMap.set(row.meeting_id, [])
      dMap.get(row.meeting_id)!.push(row)
    }
    const uMap = new Map<number, any[]>()
    for (const row of ur.results as any[]) {
      if (!uMap.has(row.meeting_id)) uMap.set(row.meeting_id, [])
      uMap.get(row.meeting_id)!.push(row)
    }
    return meetingsList.map(m => {
      const doctors = dMap.get(m.id) || []
      const users = uMap.get(m.id) || []
      return {
        ...m,
        doctors,
        doctor_ids: doctors.map((d: any) => d.doctor_id),
        doctor_name: doctors.map((d: any) => d.doctor_name).join(', ') || null,
        doctor_photo: doctors.length > 0 ? doctors[0].doctor_photo : null,
        doctor_id: doctors.length > 0 ? doctors[0].doctor_id : m.doctor_id,
        users,
        user_names: users.map((u: any) => u.user_name).join(', ') || null,
        user_ids: users.map((u: any) => u.user_id),
      }
    })
  }

  const recentMeetings = await enrichMeetings(recentMeetingsRaw.results as any[])
  const upcomingActions = await enrichMeetings(upcomingActionsRaw.results as any[])
  const reminders = await enrichMeetings(remindersRaw.results as any[])
  const thisWeekMeetings = await enrichMeetings(thisWeekMeetingsRaw.results as any[])
  const todayMeetings = await enrichMeetings(todayMeetingsRaw.results as any[])
  const overdueActions = await enrichMeetings(overdueActionsRaw.results as any[])
  const unwrittenMeetings = await enrichMeetings(unwrittenMeetingsRaw.results as any[])
  const dueFollowups = await enrichMeetings(dueFollowupsRaw.results as any[])

  // CI KPI calculation
  let ciKpi: any = null
  const ciRows = ciLatest.results as any[]
  if (ciRows.length >= 2) {
    const latest = ciRows[0], prev = ciRows[1]
    ciKpi = {
      year: latest.year,
      patients: latest.patients,
      usage: latest.usage,
      amount: latest.amount,
      growth_patients: ((latest.patients - prev.patients) / prev.patients * 100).toFixed(1),
      growth_amount: ((latest.amount - prev.amount) / prev.amount * 100).toFixed(1),
    }
  }

  // KPI targets for current month (KST)
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const kpiTarget = await c.env.DB.prepare(
    'SELECT * FROM kpi_targets WHERE year=? AND month=?'
  ).bind(now.getUTCFullYear(), now.getUTCMonth() + 1).first().catch(() => null) as any

  // Reminder count (for notification badge)
  const reminderCount = reminders.length

  return c.json({ data: {
    stats: {
      hospitals: (hospitals as any)?.c || 0,
      hospitalsAll: (hospitalsAll as any)?.c || 0,
      doctors: (doctors as any)?.c || 0,
      meetings: (meetings as any)?.c || 0,
      monthMeetings: (monthMeetings as any)?.c || 0,
      lastMonthMeetings: (lastMonthMeetings as any)?.c || 0,
      codeRegistered: (codeRegistered as any)?.c || 0,
      codeUnregistered: (codeUnregistered as any)?.c || 0,
    },
    period,
    kpiTarget: kpiTarget || null,
    reminderCount,
    recentMeetings,
    upcomingActions,
    regionStats: regionStats.results,
    ciKpi,
    monthlyTrend: monthlyTrend.results,
    reminders,
    thisWeekMeetings,
    longInactive: longInactiveRaw.results,
    recentHospitals: recentHospitalsRaw.results,
    recentDoctors: recentDoctorsRaw.results,
    pipelineSummary: pipelineSummaryRaw.results,
    todayTasks: {
      todayMeetings,
      overdueActions,
      unwrittenMeetings,
      dueFollowups,
      total: todayMeetings.length + overdueActions.length + unwrittenMeetings.length + dueFollowups.length,
    },
  }})
})

// ===== Personal KPI: /api/dashboard/me =====
// Returns the current user's KPI metrics (this month vs last month)
dashboard.get('/me', async (c) => {
  const userId = (c as any).get('userId') as number
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const period = c.req.query('period') || 'month'
  let dateFilter = `date('now',${KST},'start of month')`
  let prevDateFilter = `date('now',${KST},'start of month','-1 month')`
  let prevEndFilter = `date('now',${KST},'start of month')`
  if (period === 'quarter') {
    dateFilter = `date('now',${KST},'start of month','-2 months','start of month')`
    prevDateFilter = `date('now',${KST},'start of month','-5 months','start of month')`
    prevEndFilter = `date('now',${KST},'start of month','-2 months','start of month')`
  } else if (period === 'year') {
    dateFilter = `date('now',${KST},'start of year')`
    prevDateFilter = `date('now',${KST},'start of year','-1 year')`
    prevEndFilter = `date('now',${KST},'start of year')`
  }

  // My meetings (joined via meeting_users)
  const baseFromMyMeetings = `
    FROM meetings m
    INNER JOIN meeting_users mu ON mu.meeting_id = m.id AND mu.user_id = ?
  `

  const [myMeetings, myMeetingsPrev, myNewHospitals, myNewDoctors, myByType, myUpcoming, mySuccessful, monthlyMeetingsTrend] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as c ${baseFromMyMeetings} WHERE m.meeting_date >= ${dateFilter}`).bind(userId).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as c ${baseFromMyMeetings} WHERE m.meeting_date >= ${prevDateFilter} AND m.meeting_date < ${prevEndFilter}`).bind(userId).first(),
    // New hospitals where I had a meeting this period (proxy for new institutions)
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT m.hospital_id) as c
      ${baseFromMyMeetings}
      WHERE m.meeting_date >= ${dateFilter}
        AND m.hospital_id NOT IN (
          SELECT DISTINCT m2.hospital_id
          FROM meetings m2
          INNER JOIN meeting_users mu2 ON mu2.meeting_id = m2.id AND mu2.user_id = ?
          WHERE m2.meeting_date < ${dateFilter}
        )
    `).bind(userId, userId).first(),
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT md.doctor_id) as c
      FROM meetings m
      INNER JOIN meeting_users mu ON mu.meeting_id = m.id AND mu.user_id = ?
      INNER JOIN meeting_doctors md ON md.meeting_id = m.id
      WHERE m.meeting_date >= ${dateFilter}
    `).bind(userId).first(),
    c.env.DB.prepare(`
      SELECT m.meeting_type, COUNT(*) as c
      ${baseFromMyMeetings}
      WHERE m.meeting_date >= ${dateFilter}
      GROUP BY m.meeting_type
    `).bind(userId).all(),
    c.env.DB.prepare(`
      SELECT m.id, m.meeting_date, m.next_meeting_date, m.next_action, m.visit_time, m.meeting_type, h.name as hospital_name
      ${baseFromMyMeetings}
      LEFT JOIN hospitals h ON m.hospital_id = h.id
      WHERE m.next_meeting_date IS NOT NULL AND m.next_meeting_date >= date('now',${KST})
      ORDER BY m.next_meeting_date ASC LIMIT 10
    `).bind(userId).all(),
    c.env.DB.prepare(`
      SELECT COUNT(*) as c
      ${baseFromMyMeetings}
      WHERE m.meeting_date >= ${dateFilter}
        AND m.result IS NOT NULL AND m.result != ''
    `).bind(userId).first(),
    // 6-month personal trend
    c.env.DB.prepare(`
      SELECT strftime('%Y-%m', m.meeting_date) as month, COUNT(*) as count
      ${baseFromMyMeetings}
      WHERE m.meeting_date >= date('now',${KST},'-6 months')
      GROUP BY month ORDER BY month ASC
    `).bind(userId).all(),
  ])

  const cur = (myMeetings as any)?.c || 0
  const prev = (myMeetingsPrev as any)?.c || 0
  const change = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0)
  const total = cur || 1
  const successCount = (mySuccessful as any)?.c || 0
  const conversionRate = Math.round((successCount / total) * 100)

  // Activity score: visit=3, conference=3, online=2, phone=1.5, email=1
  const weights: any = { visit: 3, conference: 3, online: 2, phone: 1.5, email: 1 }
  let activityScore = 0
  for (const row of (myByType.results || []) as any[]) {
    activityScore += (weights[row.meeting_type] || 1) * (row.c || 0)
  }
  activityScore = Math.round(activityScore * 10) / 10

  return c.json({ data: {
    period,
    myMeetings: cur,
    myMeetingsPrev: prev,
    change,
    myNewHospitals: (myNewHospitals as any)?.c || 0,
    myNewDoctors: (myNewDoctors as any)?.c || 0,
    successCount,
    conversionRate,
    activityScore,
    byType: myByType.results,
    upcoming: myUpcoming.results,
    monthlyTrend: monthlyMeetingsTrend.results,
  }})
})

// ===== Personal KPI Target Management =====
// GET /api/dashboard/kpi-target?year=YYYY&month=MM (defaults to current month)
dashboard.get('/kpi-target', async (c) => {
  const userId = (c as any).get('userId') as number
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const year = parseInt(c.req.query('year') || String(now.getUTCFullYear()), 10)
  const month = parseInt(c.req.query('month') || String(now.getUTCMonth() + 1), 10)

  // Try to get user-specific target first; fall back to global (user_id IS NULL)
  let target: any = null
  try {
    target = await c.env.DB.prepare(
      'SELECT * FROM kpi_targets WHERE year=? AND month=? AND user_id=?'
    ).bind(year, month, userId).first()
  } catch (e) {}
  if (!target) {
    target = await c.env.DB.prepare(
      'SELECT * FROM kpi_targets WHERE year=? AND month=? AND (user_id IS NULL OR user_id=0)'
    ).bind(year, month).first().catch(() => null)
  }

  // Compute current achievement for the same month
  const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`
  // Last day: use SQLite to compute end of month
  const endRow = await c.env.DB.prepare(
    `SELECT date(?, '+1 month', '-1 day') as eom`
  ).bind(startOfMonth).first<any>()
  const endOfMonth = endRow?.eom || startOfMonth

  const [meetingsCount, newHospCount, contractCount] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM meetings m
       INNER JOIN meeting_users mu ON mu.meeting_id=m.id AND mu.user_id=?
       WHERE m.meeting_date >= ? AND m.meeting_date <= ?`
    ).bind(userId, startOfMonth, endOfMonth).first<any>(),
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT m.hospital_id) as c FROM meetings m
       INNER JOIN meeting_users mu ON mu.meeting_id=m.id AND mu.user_id=?
       WHERE m.meeting_date >= ? AND m.meeting_date <= ?
         AND m.hospital_id NOT IN (
           SELECT DISTINCT m2.hospital_id FROM meetings m2
           INNER JOIN meeting_users mu2 ON mu2.meeting_id=m2.id AND mu2.user_id=?
           WHERE m2.meeting_date < ?
         )`
    ).bind(userId, startOfMonth, endOfMonth, userId, startOfMonth).first<any>(),
    c.env.DB.prepare(
      `SELECT COUNT(DISTINCT h.id) as c FROM hospitals h
       INNER JOIN meetings m ON m.hospital_id=h.id
       INNER JOIN meeting_users mu ON mu.meeting_id=m.id AND mu.user_id=?
       WHERE h.pipeline_stage IN ('contract','active_customer')
         AND m.meeting_date >= ? AND m.meeting_date <= ?`
    ).bind(userId, startOfMonth, endOfMonth).first<any>(),
  ])

  const cur = {
    meetings: (meetingsCount as any)?.c || 0,
    new_hospitals: (newHospCount as any)?.c || 0,
    contracts: (contractCount as any)?.c || 0
  }

  const tgt = target ? {
    target_meetings: target.target_meetings || 0,
    target_new_hospitals: target.target_new_hospitals || 0,
    target_contracts: target.target_contracts || 0
  } : { target_meetings: 0, target_new_hospitals: 0, target_contracts: 0 }

  // 달성률 계산
  const pct = (cur: number, tgt: number) => tgt > 0 ? Math.min(999, Math.round((cur / tgt) * 100)) : 0

  return c.json({
    data: {
      year, month,
      target: tgt,
      current: cur,
      achievement: {
        meetings_pct: pct(cur.meetings, tgt.target_meetings),
        new_hospitals_pct: pct(cur.new_hospitals, tgt.target_new_hospitals),
        contracts_pct: pct(cur.contracts, tgt.target_contracts)
      }
    }
  })
})

// POST /api/dashboard/kpi-target
// Body: { year, month, target_meetings, target_new_hospitals, target_contracts }
dashboard.post('/kpi-target', async (c) => {
  const userId = (c as any).get('userId') as number
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const b = await c.req.json()
  const year = parseInt(b.year, 10)
  const month = parseInt(b.month, 10)
  if (!year || !month) return c.json({ error: 'year, month는 필수입니다.' }, 400)
  const tm = parseInt(b.target_meetings || 0, 10) || 0
  const tn = parseInt(b.target_new_hospitals || 0, 10) || 0
  const tc = parseInt(b.target_contracts || 0, 10) || 0

  // Try with user_id column; gracefully fall back to global if column doesn't exist
  let saved = false
  try {
    await c.env.DB.prepare(
      `INSERT INTO kpi_targets (user_id, year, month, target_meetings, target_new_hospitals, target_contracts)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, year, month) DO UPDATE SET
         target_meetings=excluded.target_meetings,
         target_new_hospitals=excluded.target_new_hospitals,
         target_contracts=excluded.target_contracts`
    ).bind(userId, year, month, tm, tn, tc).run()
    saved = true
  } catch (e) {}
  if (!saved) {
    // Fallback: per-(year,month) global record
    const existing = await c.env.DB.prepare(
      'SELECT id FROM kpi_targets WHERE year=? AND month=?'
    ).bind(year, month).first()
    if (existing) {
      await c.env.DB.prepare(
        'UPDATE kpi_targets SET target_meetings=?, target_new_hospitals=?, target_contracts=? WHERE year=? AND month=?'
      ).bind(tm, tn, tc, year, month).run()
    } else {
      await c.env.DB.prepare(
        'INSERT INTO kpi_targets (year, month, target_meetings, target_new_hospitals, target_contracts) VALUES (?,?,?,?,?)'
      ).bind(year, month, tm, tn, tc).run()
    }
  }

  return c.json({ data: { year, month, target_meetings: tm, target_new_hospitals: tn, target_contracts: tc } })
})

// ===== Team Ranking: /api/dashboard/ranking =====
// Returns activity score ranking among all users for a period
dashboard.get('/ranking', async (c) => {
  const period = c.req.query('period') || 'month'
  let dateFilter = `date('now',${KST},'start of month')`
  if (period === 'quarter') {
    dateFilter = `date('now',${KST},'start of month','-2 months','start of month')`
  } else if (period === 'year') {
    dateFilter = `date('now',${KST},'start of year')`
  }

  const r = await c.env.DB.prepare(`
    SELECT u.id as user_id, u.name as user_name, u.email,
      COUNT(DISTINCT m.id) as meeting_count,
      COUNT(DISTINCT m.hospital_id) as hospital_count,
      SUM(CASE WHEN m.meeting_type='visit' THEN 3 ELSE 0 END) +
      SUM(CASE WHEN m.meeting_type='conference' THEN 3 ELSE 0 END) +
      SUM(CASE WHEN m.meeting_type='online' THEN 2 ELSE 0 END) +
      SUM(CASE WHEN m.meeting_type='phone' THEN 1.5 ELSE 0 END) +
      SUM(CASE WHEN m.meeting_type='email' THEN 1 ELSE 0 END) as activity_score,
      SUM(CASE WHEN m.result IS NOT NULL AND m.result != '' THEN 1 ELSE 0 END) as success_count
    FROM users u
    LEFT JOIN meeting_users mu ON mu.user_id = u.id
    LEFT JOIN meetings m ON m.id = mu.meeting_id AND m.meeting_date >= ${dateFilter}
    GROUP BY u.id, u.name, u.email
    ORDER BY activity_score DESC, meeting_count DESC
    LIMIT 20
  `).all()

  const ranking = (r.results as any[]).map((row, idx) => ({
    rank: idx + 1,
    user_id: row.user_id,
    user_name: row.user_name,
    email: row.email,
    meeting_count: row.meeting_count || 0,
    hospital_count: row.hospital_count || 0,
    activity_score: Math.round((row.activity_score || 0) * 10) / 10,
    success_count: row.success_count || 0,
  }))

  return c.json({ data: { period, ranking } })
})

// ===== Auto report (weekly / monthly) =====
// GET /api/dashboard/report?range=week|month|custom&from=YYYY-MM-DD&to=YYYY-MM-DD
dashboard.get('/report', async (c) => {
  const range = c.req.query('range') || 'week'
  let from = c.req.query('from') || ''
  let to = c.req.query('to') || ''

  // Compute KST-based date range when not custom
  if (!from || !to || range !== 'custom') {
    if (range === 'week') {
      const startSql = await c.env.DB.prepare(`SELECT date('now',${KST},'-6 days') as f, date('now',${KST}) as t`).first<any>()
      from = startSql?.f || ''
      to = startSql?.t || ''
    } else if (range === 'month') {
      const startSql = await c.env.DB.prepare(`SELECT date('now',${KST},'start of month') as f, date('now',${KST}) as t`).first<any>()
      from = startSql?.f || ''
      to = startSql?.t || ''
    } else if (range === 'last_week') {
      const startSql = await c.env.DB.prepare(`SELECT date('now',${KST},'-13 days') as f, date('now',${KST},'-7 days') as t`).first<any>()
      from = startSql?.f || ''
      to = startSql?.t || ''
    } else if (range === 'last_month') {
      const startSql = await c.env.DB.prepare(`SELECT date('now',${KST},'start of month','-1 month') as f, date('now',${KST},'start of month','-1 day') as t`).first<any>()
      from = startSql?.f || ''
      to = startSql?.t || ''
    }
  }

  if (!from || !to) return c.json({ error: 'Invalid date range' }, 400)

  // Compute previous period (same length) for comparison
  const lenSql = await c.env.DB.prepare(`SELECT julianday(?) - julianday(?) as days`).bind(to, from).first<any>()
  const days = Math.max(0, Math.round(Number(lenSql?.days || 0))) + 1
  const prevFromSql = await c.env.DB.prepare(`SELECT date(?, '-' || ? || ' days') as pf, date(?, '-' || ? || ' days') as pt`).bind(from, days, to, days).first<any>()
  const prevFrom = prevFromSql?.pf || ''
  const prevTo = prevFromSql?.pt || ''

  const [
    totalMeetings, prevTotalMeetings,
    uniqueHospitalsRaw, prevUniqueHospitalsRaw,
    uniqueDoctorsRaw,
    typeBreakdownRaw,
    topHospitalsRaw,
    topUsersRaw,
    pipelineMovesRaw,
    upcomingNextActionsRaw,
    dailyTrendRaw,
    meetingDetailsRaw,
    notMetHospitalsRaw,
    regionBreakdownRaw,
    keyOutcomesRaw
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= ? AND meeting_date <= ?').bind(from, to).first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= ? AND meeting_date <= ?').bind(prevFrom, prevTo).first<any>(),
    // 미팅한 고유 기관 수
    c.env.DB.prepare('SELECT COUNT(DISTINCT hospital_id) as c FROM meetings WHERE meeting_date >= ? AND meeting_date <= ?').bind(from, to).first<any>(),
    c.env.DB.prepare('SELECT COUNT(DISTINCT hospital_id) as c FROM meetings WHERE meeting_date >= ? AND meeting_date <= ?').bind(prevFrom, prevTo).first<any>(),
    // 미팅한 고유 의료진 수 (meeting_doctors 우선, 없으면 meetings.doctor_id)
    c.env.DB.prepare(`SELECT COUNT(DISTINCT doctor_id) as c FROM (
      SELECT md.doctor_id FROM meeting_doctors md
        JOIN meetings m ON m.id = md.meeting_id
        WHERE m.meeting_date >= ? AND m.meeting_date <= ?
      UNION
      SELECT m.doctor_id FROM meetings m
        WHERE m.meeting_date >= ? AND m.meeting_date <= ? AND m.doctor_id IS NOT NULL
    )`).bind(from, to, from, to).first<any>().catch(() => ({ c: 0 })),
    c.env.DB.prepare('SELECT meeting_type, COUNT(*) as c FROM meetings WHERE meeting_date >= ? AND meeting_date <= ? GROUP BY meeting_type ORDER BY c DESC').bind(from, to).all(),
    // 활동 상위 기관 — 마지막 미팅일/등급/단계 포함
    c.env.DB.prepare(`SELECT h.id, h.name, h.region, h.grade, h.pipeline_stage,
      COUNT(m.id) as c, MAX(m.meeting_date) as last_date
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.meeting_date >= ? AND m.meeting_date <= ?
      GROUP BY h.id ORDER BY c DESC, last_date DESC LIMIT 12`).bind(from, to).all(),
    c.env.DB.prepare(`SELECT u.id, u.name, COUNT(DISTINCT mu.meeting_id) as c
      FROM meeting_users mu
      LEFT JOIN users u ON mu.user_id=u.id
      LEFT JOIN meetings m ON mu.meeting_id=m.id
      WHERE m.meeting_date >= ? AND m.meeting_date <= ? AND u.id IS NOT NULL
      GROUP BY u.id ORDER BY c DESC LIMIT 10`).bind(from, to).all(),
    c.env.DB.prepare(`SELECT pt.from_stage, pt.to_stage, COUNT(*) as c
      FROM pipeline_transitions pt
      WHERE DATE(pt.created_at) >= ? AND DATE(pt.created_at) <= ?
      GROUP BY pt.from_stage, pt.to_stage ORDER BY c DESC`).bind(from, to).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(`SELECT m.id, m.next_meeting_date, m.next_action, h.name as hospital_name, h.id as hospital_id
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.next_meeting_date IS NOT NULL AND m.next_meeting_date != ''
        AND m.next_meeting_date >= date('now',${KST}) AND m.next_meeting_date <= date('now',${KST},'+14 days')
      ORDER BY m.next_meeting_date ASC LIMIT 30`).all(),
    c.env.DB.prepare('SELECT meeting_date as d, COUNT(*) as c FROM meetings WHERE meeting_date >= ? AND meeting_date <= ? GROUP BY meeting_date ORDER BY meeting_date ASC').bind(from, to).all(),
    // 기간 내 모든 미팅 상세 — 핵심: '어떤 곳과 무슨 미팅을 했는가'
    c.env.DB.prepare(`SELECT m.id, m.meeting_date, m.meeting_type, m.purpose, m.summary, m.next_action, m.next_meeting_date,
      m.hospital_id, h.name as hospital_name, h.region, h.grade, h.pipeline_stage,
      d.name as doctor_name, d.position as doctor_position
      FROM meetings m
      LEFT JOIN hospitals h ON m.hospital_id = h.id
      LEFT JOIN doctors d ON m.doctor_id = d.id
      WHERE m.meeting_date >= ? AND m.meeting_date <= ?
      ORDER BY m.meeting_date DESC, m.id DESC LIMIT 100`).bind(from, to).all(),
    // 한동안 미팅하지 못한 활성 기관 (소홀해진 거래처) — pipeline_stage가 active_customer/contract/proposal/demo/meeting인 곳 중 30일 이상 미접촉
    // NULLS FIRST 대신 CASE 표현식으로 NULL이 먼저 오도록 정렬 (D1 SQLite 호환)
    c.env.DB.prepare(`SELECT h.id, h.name, h.region, h.grade, h.pipeline_stage,
      (SELECT MAX(m2.meeting_date) FROM meetings m2 WHERE m2.hospital_id = h.id) as last_date
      FROM hospitals h
      WHERE h.status = 'active'
        AND COALESCE(h.pipeline_stage,'contact') IN ('active_customer','contract','proposal','demo','meeting')
        AND (
          (SELECT MAX(m2.meeting_date) FROM meetings m2 WHERE m2.hospital_id = h.id) IS NULL
          OR (SELECT MAX(m2.meeting_date) FROM meetings m2 WHERE m2.hospital_id = h.id) < date('now',${KST},'-30 days')
        )
      ORDER BY CASE WHEN (SELECT MAX(m2.meeting_date) FROM meetings m2 WHERE m2.hospital_id = h.id) IS NULL THEN 0 ELSE 1 END,
               (SELECT MAX(m2.meeting_date) FROM meetings m2 WHERE m2.hospital_id = h.id) ASC
      LIMIT 15`).all().catch(() => ({ results: [] })),
    // 지역별 미팅 분포
    c.env.DB.prepare(`SELECT COALESCE(h.region,'기타') as region, COUNT(m.id) as c, COUNT(DISTINCT m.hospital_id) as hosp_count
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.meeting_date >= ? AND m.meeting_date <= ?
      GROUP BY h.region ORDER BY c DESC`).bind(from, to).all(),
    // 핵심 성과: 본 기간에 next_action이 명시된 (=후속 액션을 만들어낸) 미팅의 비율
    c.env.DB.prepare(`SELECT
      SUM(CASE WHEN next_action IS NOT NULL AND TRIM(next_action) != '' THEN 1 ELSE 0 END) as with_followup,
      SUM(CASE WHEN summary IS NOT NULL AND TRIM(summary) != '' THEN 1 ELSE 0 END) as with_summary,
      COUNT(*) as total
      FROM meetings WHERE meeting_date >= ? AND meeting_date <= ?`).bind(from, to).first<any>()
  ])

  const total = Number(totalMeetings?.c || 0)
  const prevTotal = Number(prevTotalMeetings?.c || 0)
  const diffPct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : (total > 0 ? 100 : 0)
  const uniqueHospitals = Number(uniqueHospitalsRaw?.c || 0)
  const prevUniqueHospitals = Number(prevUniqueHospitalsRaw?.c || 0)
  const uniqueDoctors = Number(uniqueDoctorsRaw?.c || 0)
  const ko = keyOutcomesRaw || { with_followup: 0, with_summary: 0, total: 0 }
  const followupRate = ko.total > 0 ? Math.round((Number(ko.with_followup) / Number(ko.total)) * 100) : 0
  const summaryRate = ko.total > 0 ? Math.round((Number(ko.with_summary) / Number(ko.total)) * 100) : 0

  return c.json({
    data: {
      range,
      from, to,
      prevFrom, prevTo,
      summary: {
        totalMeetings: total,
        prevTotalMeetings: prevTotal,
        diffPct,
        uniqueHospitals,
        prevUniqueHospitals,
        uniqueDoctors,
        followupRate,
        summaryRate,
        upcomingNextActions: (upcomingNextActionsRaw.results as any[]).length
      },
      typeBreakdown: typeBreakdownRaw.results,
      topHospitals: topHospitalsRaw.results,
      topUsers: topUsersRaw.results,
      pipelineMoves: pipelineMovesRaw.results || [],
      meetingDetails: meetingDetailsRaw.results || [],
      notMetHospitals: notMetHospitalsRaw.results || [],
      regionBreakdown: regionBreakdownRaw.results || [],
      upcomingNextActions: upcomingNextActionsRaw.results,
      dailyTrend: dailyTrendRaw.results
    }
  })
})

// ===== Pipeline conversion analytics =====
// GET /api/dashboard/pipeline-analytics?from=&to=
dashboard.get('/pipeline-analytics', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const where: string[] = []
  const params: any[] = []
  if (from) { where.push('DATE(pt.created_at) >= ?'); params.push(from) }
  if (to) { where.push('DATE(pt.created_at) <= ?'); params.push(to) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''

  const [transitionsRaw, currentStagesRaw, dwellTimeRaw, churnRaw] = await Promise.all([
    // All transitions in the window (or all-time if no filter)
    c.env.DB.prepare(`SELECT from_stage, to_stage, COUNT(*) as c FROM pipeline_transitions pt${whereSql} GROUP BY from_stage, to_stage`).bind(...params).all().catch(() => ({ results: [] })),
    // Current stage distribution
    c.env.DB.prepare(`SELECT COALESCE(pipeline_stage, 'contact') as stage, COUNT(*) as c FROM hospitals WHERE status='active' GROUP BY stage`).all(),
    // Average dwell time per stage (days between sequential transitions for same hospital)
    c.env.DB.prepare(`SELECT pt1.from_stage as stage,
      AVG(julianday(pt2.created_at) - julianday(pt1.created_at)) as avg_days,
      COUNT(*) as samples
      FROM pipeline_transitions pt1
      JOIN pipeline_transitions pt2 ON pt2.hospital_id = pt1.hospital_id
        AND pt2.created_at > pt1.created_at
        AND pt2.from_stage = pt1.to_stage
      GROUP BY pt1.from_stage`).all().catch(() => ({ results: [] })),
    // Churn: transitions to 'lost' or 'inactive'
    c.env.DB.prepare(`SELECT from_stage, COUNT(*) as c FROM pipeline_transitions pt
      WHERE to_stage IN ('lost','inactive','closed_lost')${where.length ? ' AND ' + where.join(' AND ') : ''}
      GROUP BY from_stage`).bind(...params).all().catch(() => ({ results: [] }))
  ])

  // Compute conversion rates: for each from_stage, the share of transitions going to each to_stage
  const transitions = (transitionsRaw.results as any[]) || []
  const fromTotals: Record<string, number> = {}
  for (const t of transitions) { fromTotals[t.from_stage] = (fromTotals[t.from_stage] || 0) + Number(t.c || 0) }
  const conversionRates = transitions.map(t => ({
    from_stage: t.from_stage,
    to_stage: t.to_stage,
    count: Number(t.c || 0),
    rate: fromTotals[t.from_stage] > 0 ? Math.round((Number(t.c || 0) / fromTotals[t.from_stage]) * 1000) / 10 : 0
  }))

  return c.json({
    data: {
      from: from || null, to: to || null,
      currentDistribution: currentStagesRaw.results,
      transitions,
      conversionRates,
      avgDwellDays: dwellTimeRaw.results,
      churn: churnRaw.results
    }
  })
})

export default dashboard
