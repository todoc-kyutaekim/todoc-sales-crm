import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const dashboard = new Hono<{ Bindings: Bindings }>()

dashboard.get('/', async (c) => {
  const [hospitals, doctors, meetings, monthMeetings, lastMonthMeetings, recentMeetingsRaw, upcomingActionsRaw, regionStats, ciLatest, monthlyTrend, remindersRaw] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as c FROM hospitals WHERE status="active"').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM doctors').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM meetings').first(),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= date('now','start of month')").first(),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= date('now','start of month','-1 month') AND meeting_date < date('now','start of month')").first(),
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
      FROM meetings WHERE meeting_date >= date('now','-6 months')
      GROUP BY month ORDER BY month ASC
    `).all(),
    // Upcoming meeting reminders (next 7 days)
    c.env.DB.prepare(`
      SELECT m.*, h.name as hospital_name
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id
      WHERE m.next_meeting_date IS NOT NULL AND m.next_meeting_date != ''
        AND m.next_meeting_date >= date('now') AND m.next_meeting_date <= date('now','+7 days')
      ORDER BY m.next_meeting_date ASC LIMIT 10
    `).all(),
  ])

  // Helper: attach doctor names to meetings via meeting_doctors
  async function enrichMeetings(meetingsList: any[]): Promise<any[]> {
    if (!meetingsList.length) return meetingsList
    const ids = meetingsList.map(m => m.id)
    const placeholders = ids.map(() => '?').join(',')
    const dr = await c.env.DB.prepare(
      `SELECT md.meeting_id, d.id as doctor_id, d.name as doctor_name, d.photo as doctor_photo
       FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id
       WHERE md.meeting_id IN (${placeholders}) ORDER BY md.meeting_id, d.name`
    ).bind(...ids).all()
    const dMap = new Map<number, any[]>()
    for (const row of dr.results as any[]) {
      if (!dMap.has(row.meeting_id)) dMap.set(row.meeting_id, [])
      dMap.get(row.meeting_id)!.push(row)
    }
    return meetingsList.map(m => {
      const doctors = dMap.get(m.id) || []
      return {
        ...m,
        doctors,
        doctor_name: doctors.map((d: any) => d.doctor_name).join(', ') || null,
        doctor_photo: doctors.length > 0 ? doctors[0].doctor_photo : null,
        doctor_id: doctors.length > 0 ? doctors[0].doctor_id : m.doctor_id,
      }
    })
  }

  const recentMeetings = await enrichMeetings(recentMeetingsRaw.results as any[])
  const upcomingActions = await enrichMeetings(upcomingActionsRaw.results as any[])
  const reminders = await enrichMeetings(remindersRaw.results as any[])

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

  return c.json({ data: {
    stats: {
      hospitals: (hospitals as any)?.c || 0,
      doctors: (doctors as any)?.c || 0,
      meetings: (meetings as any)?.c || 0,
      monthMeetings: (monthMeetings as any)?.c || 0,
      lastMonthMeetings: (lastMonthMeetings as any)?.c || 0,
    },
    recentMeetings,
    upcomingActions,
    regionStats: regionStats.results,
    ciKpi,
    monthlyTrend: monthlyTrend.results,
    reminders,
  }})
})

export default dashboard
