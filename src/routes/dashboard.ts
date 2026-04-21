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
  }})
})

export default dashboard
