import { Hono } from 'hono'
import { logActivity } from '../helpers'

type Bindings = { DB: D1Database }
const pipeline = new Hono<{ Bindings: Bindings }>()

// Get pipeline overview (grouped by stage)
pipeline.get('/', async (c) => {
  const stages = ['contact', 'meeting', 'demo', 'proposal', 'contract', 'active_customer']
  const stageLabels: Record<string, string> = {
    contact: '첫 접촉', meeting: '미팅 진행', demo: '데모/시연',
    proposal: '제안/협의', contract: '계약', active_customer: '활성 거래처'
  }
  const r = await c.env.DB.prepare(`
    SELECT h.id, h.name, h.region, h.grade, h.status, h.pipeline_stage,
      COUNT(DISTINCT m.id) as meeting_count,
      MAX(m.meeting_date) as last_meeting
    FROM hospitals h
    LEFT JOIN meetings m ON h.id = m.hospital_id
    GROUP BY h.id
    ORDER BY h.pipeline_stage, h.name
  `).all()
  
  const grouped: Record<string, any[]> = {}
  for (const stage of stages) {
    grouped[stage] = {
      key: stage,
      label: stageLabels[stage],
      hospitals: (r.results as any[]).filter(h => (h.pipeline_stage || 'contact') === stage)
    }
  }
  return c.json({ data: { stages: Object.values(grouped), totals: r.results.length } })
})

// Update hospital pipeline stage
pipeline.put('/:hospitalId', async (c) => {
  const hid = c.req.param('hospitalId')
  const { pipeline_stage } = await c.req.json()
  const validStages = ['contact', 'meeting', 'demo', 'proposal', 'contract', 'active_customer']
  if (!validStages.includes(pipeline_stage)) return c.json({ error: 'Invalid stage' }, 400)
  
  const h = await c.env.DB.prepare('SELECT name, pipeline_stage FROM hospitals WHERE id=?').bind(hid).first() as any
  await c.env.DB.prepare('UPDATE hospitals SET pipeline_stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(pipeline_stage, hid).run()
  
  await logActivity(c.env.DB, 'update', 'hospital', Number(hid), h?.name || '', 
    `파이프라인: ${h?.pipeline_stage || 'contact'} → ${pipeline_stage}`)
  return c.json({ success: true })
})

// KPI targets
pipeline.get('/kpi-targets', async (c) => {
  const { year, month } = c.req.query()
  const y = year || new Date().getFullYear()
  const m = month || (new Date().getMonth() + 1)
  
  const target = await c.env.DB.prepare(
    'SELECT * FROM kpi_targets WHERE year=? AND month=?'
  ).bind(Number(y), Number(m)).first()
  
  // Get actual counts for this month
  const monthStr = `${y}-${String(m).padStart(2, '0')}`
  const [actualMeetings, actualNewHosps, actualContracts] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as c FROM meetings WHERE strftime('%Y-%m', meeting_date)=?").bind(monthStr).first(),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM hospitals WHERE strftime('%Y-%m', created_at)=? AND status='active'").bind(monthStr).first(),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM hospitals WHERE pipeline_stage='contract' AND strftime('%Y-%m', updated_at)=?").bind(monthStr).first(),
  ])
  
  return c.json({
    data: {
      target: target || { year: Number(y), month: Number(m), target_meetings: 0, target_new_hospitals: 0, target_contracts: 0 },
      actual: {
        meetings: (actualMeetings as any)?.c || 0,
        new_hospitals: (actualNewHosps as any)?.c || 0,
        contracts: (actualContracts as any)?.c || 0,
      }
    }
  })
})

// Set KPI target
pipeline.post('/kpi-targets', async (c) => {
  const { year, month, target_meetings, target_new_hospitals, target_contracts } = await c.req.json()
  if (!year || !month) return c.json({ error: 'year and month required' }, 400)
  
  await c.env.DB.prepare(`
    INSERT INTO kpi_targets (year, month, target_meetings, target_new_hospitals, target_contracts)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(year, month) DO UPDATE SET
      target_meetings=excluded.target_meetings,
      target_new_hospitals=excluded.target_new_hospitals,
      target_contracts=excluded.target_contracts
  `).bind(Number(year), Number(month), Number(target_meetings) || 0, Number(target_new_hospitals) || 0, Number(target_contracts) || 0).run()
  
  return c.json({ success: true })
})

// Transfer doctor between hospitals
pipeline.post('/transfer-doctor', async (c) => {
  const { doctor_id, to_hospital_id, notes } = await c.req.json()
  if (!doctor_id || !to_hospital_id) return c.json({ error: 'doctor_id and to_hospital_id required' }, 400)
  
  const doc = await c.env.DB.prepare('SELECT * FROM doctors WHERE id=?').bind(doctor_id).first() as any
  if (!doc) return c.json({ error: 'Doctor not found' }, 404)
  
  const fromHospId = doc.hospital_id
  
  // Record transfer
  await c.env.DB.prepare(
    'INSERT INTO doctor_transfers (doctor_id, from_hospital_id, to_hospital_id, notes) VALUES (?, ?, ?, ?)'
  ).bind(doctor_id, fromHospId, Number(to_hospital_id), notes || '').run()
  
  // Update doctor's hospital
  await c.env.DB.prepare('UPDATE doctors SET hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(Number(to_hospital_id), doctor_id).run()
  
  const toHosp = await c.env.DB.prepare('SELECT name FROM hospitals WHERE id=?').bind(to_hospital_id).first() as any
  await logActivity(c.env.DB, 'update', 'doctor', Number(doctor_id), doc.name, 
    `이적: ${doc.hospital_name || fromHospId} → ${toHosp?.name || to_hospital_id}`)
  
  return c.json({ success: true })
})

// Get doctor transfer history
pipeline.get('/transfer-history/:doctorId', async (c) => {
  const did = c.req.param('doctorId')
  const r = await c.env.DB.prepare(`
    SELECT dt.*, 
      fh.name as from_hospital_name, th.name as to_hospital_name
    FROM doctor_transfers dt
    LEFT JOIN hospitals fh ON dt.from_hospital_id=fh.id
    LEFT JOIN hospitals th ON dt.to_hospital_id=th.id
    WHERE dt.doctor_id=? ORDER BY dt.transfer_date DESC
  `).bind(did).all()
  return c.json({ data: r.results })
})

// Meeting statistics (per doctor and institution)
pipeline.get('/meeting-stats', async (c) => {
  const { doctor_id, hospital_id } = c.req.query()
  
  if (doctor_id) {
    const [total, byType, byMonth, avgInterval] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM meeting_doctors WHERE doctor_id=?').bind(doctor_id).first(),
      c.env.DB.prepare(`
        SELECT m.meeting_type, COUNT(*) as count
        FROM meetings m INNER JOIN meeting_doctors md ON m.id=md.meeting_id
        WHERE md.doctor_id=? GROUP BY m.meeting_type
      `).bind(doctor_id).all(),
      c.env.DB.prepare(`
        SELECT strftime('%Y-%m', m.meeting_date) as month, COUNT(*) as count
        FROM meetings m INNER JOIN meeting_doctors md ON m.id=md.meeting_id
        WHERE md.doctor_id=? AND m.meeting_date >= date('now', '-12 months')
        GROUP BY month ORDER BY month
      `).bind(doctor_id).all(),
      c.env.DB.prepare(`
        SELECT meeting_date FROM meetings m
        INNER JOIN meeting_doctors md ON m.id=md.meeting_id
        WHERE md.doctor_id=? ORDER BY meeting_date
      `).bind(doctor_id).all(),
    ])
    
    // Calculate average interval
    const dates = (avgInterval.results as any[]).map(r => new Date(r.meeting_date + 'T00:00:00').getTime())
    let avgDays = 0
    if (dates.length > 1) {
      let totalDiff = 0
      for (let i = 1; i < dates.length; i++) totalDiff += dates[i] - dates[i - 1]
      avgDays = Math.round(totalDiff / (dates.length - 1) / 86400000)
    }
    
    return c.json({ data: { total: (total as any)?.c || 0, byType: byType.results, byMonth: byMonth.results, avgIntervalDays: avgDays } })
  }
  
  if (hospital_id) {
    const [total, byType, byMonth] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM meetings WHERE hospital_id=?').bind(hospital_id).first(),
      c.env.DB.prepare('SELECT meeting_type, COUNT(*) as count FROM meetings WHERE hospital_id=? GROUP BY meeting_type').bind(hospital_id).all(),
      c.env.DB.prepare(`
        SELECT strftime('%Y-%m', meeting_date) as month, COUNT(*) as count
        FROM meetings WHERE hospital_id=? AND meeting_date >= date('now', '-12 months')
        GROUP BY month ORDER BY month
      `).bind(hospital_id).all(),
    ])
    return c.json({ data: { total: (total as any)?.c || 0, byType: byType.results, byMonth: byMonth.results } })
  }
  
  return c.json({ error: 'doctor_id or hospital_id required' }, 400)
})

// Duplicate hospital check (fuzzy matching)
pipeline.get('/check-duplicate', async (c) => {
  const name = c.req.query('name') || ''
  if (name.length < 2) return c.json({ data: [] })
  
  // Simple fuzzy: search for names containing the input, or input containing the name
  const r = await c.env.DB.prepare(
    `SELECT id, name, region, type, grade FROM hospitals 
     WHERE name LIKE ? OR ? LIKE '%' || name || '%'
     ORDER BY name LIMIT 10`
  ).bind(`%${name}%`, name).all()
  
  return c.json({ data: r.results })
})

export default pipeline
