import { Hono } from 'hono'
import { logActivity } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const pipeline = new Hono<{ Bindings: Bindings, Variables: Variables }>()

const STAGE_ORDER = ['contact', 'meeting', 'demo', 'proposal', 'contract', 'active_customer'] as const
const STAGE_LABELS: Record<string, string> = {
  contact: '첫 접촉', meeting: '미팅 진행', demo: '데모/시연',
  proposal: '제안/협의', contract: '계약', active_customer: '활성 거래처'
}

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
  if (!STAGE_ORDER.includes(pipeline_stage as any)) return c.json({ error: 'Invalid stage' }, 400)
  
  const h = await c.env.DB.prepare('SELECT name, pipeline_stage FROM hospitals WHERE id=?').bind(hid).first() as any
  const fromStage = h?.pipeline_stage || 'contact'
  await c.env.DB.prepare('UPDATE hospitals SET pipeline_stage=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(pipeline_stage, hid).run()

  // Record transition history if stage actually changed
  if (fromStage !== pipeline_stage) {
    const userId = c.get('userId') || null
    await c.env.DB.prepare(
      `INSERT INTO pipeline_transitions (hospital_id, from_stage, to_stage, changed_by, changed_at)
       VALUES (?, ?, ?, ?, datetime('now','+9 hours'))`
    ).bind(Number(hid), fromStage, pipeline_stage, userId).run().catch(() => {})
  }
  
  await logActivity(c.env.DB, 'update', 'hospital', Number(hid), h?.name || '', 
    `파이프라인: ${fromStage} → ${pipeline_stage}`)
  return c.json({ success: true })
})

// ===== Pipeline Conversion Analytics =====
// GET /api/pipeline/analytics?period=30|90|180|365 (days)
pipeline.get('/analytics', async (c) => {
  const periodDays = Number(c.req.query('period') || '90')
  const cutoff = `date('now','+9 hours','-${periodDays} days')`

  // 1) Current funnel: how many hospitals are in each stage (snapshot)
  const funnelRaw = await c.env.DB.prepare(`
    SELECT COALESCE(pipeline_stage,'contact') as stage, COUNT(*) as c
    FROM hospitals GROUP BY stage
  `).all()
  const funnelMap: Record<string, number> = {}
  for (const r of funnelRaw.results as any[]) funnelMap[r.stage] = r.c

  // 2) Stage entries within the period (for conversion rate calc)
  // For each stage we count: how many hospitals entered the stage in window,
  // and of those, how many later moved forward to the next stage.
  const transitions = await c.env.DB.prepare(`
    SELECT hospital_id, from_stage, to_stage, changed_at
    FROM pipeline_transitions
    WHERE changed_at >= ${cutoff}
    ORDER BY hospital_id, changed_at ASC
  `).all()

  // 3) Compute dwell time per stage from full history (not limited to window)
  const allTrans = await c.env.DB.prepare(`
    SELECT hospital_id, from_stage, to_stage, changed_at
    FROM pipeline_transitions
    ORDER BY hospital_id, changed_at ASC
  `).all()

  // Build per-hospital timeline
  const byHosp: Record<number, any[]> = {}
  for (const r of allTrans.results as any[]) {
    if (!byHosp[r.hospital_id]) byHosp[r.hospital_id] = []
    byHosp[r.hospital_id].push(r)
  }

  // Dwell time: for each stage entry, dwell = next changed_at - this changed_at
  const dwellSums: Record<string, { total: number, count: number }> = {}
  const stageEntries: Record<string, number> = {}
  const stageProgressions: Record<string, number> = {}
  for (const stage of STAGE_ORDER) {
    dwellSums[stage] = { total: 0, count: 0 }
    stageEntries[stage] = 0
    stageProgressions[stage] = 0
  }

  const now = Date.now()
  const cutoffTs = now - periodDays * 86400000

  for (const hid in byHosp) {
    const list = byHosp[hid]
    for (let i = 0; i < list.length; i++) {
      const cur = list[i]
      const next = list[i + 1]
      const enteredTs = new Date(cur.changed_at + 'Z').getTime()
      const stage = cur.to_stage
      const exitTs = next ? new Date(next.changed_at + 'Z').getTime() : null
      const dwellMs = (exitTs || now) - enteredTs
      const dwellDays = Math.max(0, Math.round(dwellMs / 86400000))
      if (dwellSums[stage]) {
        dwellSums[stage].total += dwellDays
        dwellSums[stage].count += 1
      }

      // Window-based conversion: only count entries that happened in window
      if (enteredTs >= cutoffTs) {
        if (stageEntries[stage] !== undefined) stageEntries[stage] += 1
        // Did it progress to the next stage?
        if (next) {
          const nextIdx = STAGE_ORDER.indexOf(next.to_stage as any)
          const curIdx = STAGE_ORDER.indexOf(stage as any)
          if (nextIdx > curIdx && stageProgressions[stage] !== undefined) {
            stageProgressions[stage] += 1
          }
        }
      }
    }
  }

  // 4) Conversion rates between consecutive stages (within window)
  const stageStats = STAGE_ORDER.map(stage => {
    const dw = dwellSums[stage]
    const avgDwell = dw.count > 0 ? Math.round(dw.total / dw.count) : 0
    const entries = stageEntries[stage] || 0
    const progressed = stageProgressions[stage] || 0
    const conversion = entries > 0 ? Math.round((progressed / entries) * 100) : 0
    return {
      stage,
      label: STAGE_LABELS[stage],
      current: funnelMap[stage] || 0,
      entries,
      progressed,
      conversion_rate: conversion,
      avg_dwell_days: avgDwell,
    }
  })

  // 5) Bottleneck: stage with highest avg dwell among non-terminal stages
  const nonTerminal = stageStats.filter(s => s.stage !== 'active_customer')
  let bottleneck: any = null
  for (const s of nonTerminal) {
    if (s.current > 0 && (!bottleneck || s.avg_dwell_days > bottleneck.avg_dwell_days)) {
      bottleneck = s
    }
  }

  // 6) Recent stage changes (timeline)
  const recentChanges = await c.env.DB.prepare(`
    SELECT pt.id, pt.hospital_id, pt.from_stage, pt.to_stage, pt.changed_at,
      h.name as hospital_name, u.name as changed_by_name
    FROM pipeline_transitions pt
    LEFT JOIN hospitals h ON h.id = pt.hospital_id
    LEFT JOIN users u ON u.id = pt.changed_by
    WHERE pt.from_stage IS NOT NULL
    ORDER BY pt.changed_at DESC
    LIMIT 15
  `).all()

  return c.json({ data: {
    period_days: periodDays,
    funnel: stageStats,
    bottleneck,
    recent_changes: recentChanges.results,
  }})
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
