import { Hono } from 'hono'
import { logActivity, safeLike, safeInt } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const hospitals = new Hono<{ Bindings: Bindings, Variables: Variables }>()

hospitals.get('/', async (c) => {
  const { region, status, search, type } = c.req.query()
  let q = `SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meetings m ON h.id = m.hospital_id`
  const conds: string[] = [], params: any[] = []
  if (region) { conds.push('h.region = ?'); params.push(region) }
  if (status) { conds.push('h.status = ?'); params.push(status) }
  if (type) { conds.push('h.type = ?'); params.push(type) }
  if (search) { conds.push('(h.name LIKE ? OR h.region LIKE ? OR h.address LIKE ?)'); const s = `%${safeLike(search)}%`; params.push(s, s, s) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' GROUP BY h.id ORDER BY h.name ASC'
  const r = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: r.results })
})

hospitals.get('/regions', async (c) => {
  const r = await c.env.DB.prepare('SELECT DISTINCT region FROM hospitals WHERE region!="" ORDER BY region').all()
  return c.json({ data: r.results.map((x: any) => x.region) })
})

hospitals.get('/:id', async (c) => {
  const h = await c.env.DB.prepare('SELECT * FROM hospitals WHERE id = ?').bind(c.req.param('id')).first()
  return h ? c.json({ data: h }) : c.json({ error: 'Not found' }, 404)
})

hospitals.post('/', async (c) => {
  const b = await c.req.json()
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO hospitals (name,region,address,phone,grade,notes,status,type,priority,todoc_contact,patient_count,hearing_aid_sales,ci_referrals,pipeline_stage,audiology_room,mapping_room) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    b.name.trim(), b.region || '', b.address || '', b.phone || '',
    b.grade || 'A',
    b.notes || '', b.status || 'active',
    b.type || 'hospital',
    b.priority || '3', b.todoc_contact || '', 
    safeInt(b.patient_count + ''), safeInt(b.hearing_aid_sales + ''), safeInt(b.ci_referrals + ''),
    b.pipeline_stage || 'contact',
    b.audiology_room || '', b.mapping_room || ''
  ).run()
  await logActivity(c.env.DB, 'create', 'hospital', r.meta.last_row_id as number, b.name.trim())
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

hospitals.put('/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)

  // Preserve existing grade column for backward compatibility (no longer surfaced in UI)
  const prev = await c.env.DB.prepare('SELECT grade FROM hospitals WHERE id=?').bind(id).first() as any
  const keepGrade = b.grade || prev?.grade || 'A'

  await c.env.DB.prepare(
    'UPDATE hospitals SET name=?,region=?,address=?,phone=?,grade=?,notes=?,status=?,type=?,priority=?,todoc_contact=?,patient_count=?,hearing_aid_sales=?,ci_referrals=?,pipeline_stage=?,audiology_room=?,mapping_room=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(
    b.name.trim(), b.region || '', b.address || '', b.phone || '',
    keepGrade, b.notes || '', b.status || 'active',
    b.type || 'hospital',
    b.priority || '3', b.todoc_contact || '',
    safeInt(b.patient_count + ''), safeInt(b.hearing_aid_sales + ''), safeInt(b.ci_referrals + ''),
    b.pipeline_stage || 'contact',
    b.audiology_room || '', b.mapping_room || '',
    id
  ).run()

  await logActivity(c.env.DB, 'update', 'hospital', Number(id), b.name.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

// ===== Hospital Score History =====
// GET /api/hospitals/:id/score-history?months=12
// Returns time-series of grade changes, monthly meeting counts, and pipeline transitions
hospitals.get('/:id/score-history', async (c) => {
  const id = c.req.param('id')
  const months = Number(c.req.query('months') || '12')

  const [grades, pipes, monthlyMeets, hospital] = await Promise.all([
    c.env.DB.prepare(`
      SELECT from_grade, to_grade, changed_at, u.name as changed_by_name
      FROM hospital_grade_history hgh
      LEFT JOIN users u ON u.id = hgh.changed_by
      WHERE hgh.hospital_id = ?
      ORDER BY hgh.changed_at ASC
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT from_stage, to_stage, changed_at, u.name as changed_by_name
      FROM pipeline_transitions pt
      LEFT JOIN users u ON u.id = pt.changed_by
      WHERE pt.hospital_id = ?
      ORDER BY pt.changed_at ASC
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT strftime('%Y-%m', meeting_date) as month, COUNT(*) as count,
        SUM(CASE WHEN meeting_type='visit' THEN 1 ELSE 0 END) as visit_count,
        SUM(CASE WHEN result IS NOT NULL AND result != '' THEN 1 ELSE 0 END) as result_count
      FROM meetings
      WHERE hospital_id = ? AND meeting_date >= date('now','+9 hours','-${months} months')
      GROUP BY month ORDER BY month ASC
    `).bind(id).all(),
    c.env.DB.prepare('SELECT id, name, grade, pipeline_stage FROM hospitals WHERE id=?').bind(id).first(),
  ])

  // Compute score time series:
  // grade weight: S=5, A=4, B=3, C=2, D=1
  // pipeline weight: contact=1, meeting=2, demo=3, proposal=4, contract=5, active_customer=6
  // monthly score = grade_weight * 10 + pipeline_weight * 5 + monthly_meeting_count * 2 + result_count * 3
  const gradeW: any = { S: 5, A: 4, B: 3, C: 2, D: 1 }
  const pipeW: any = { contact: 1, meeting: 2, demo: 3, proposal: 4, contract: 5, active_customer: 6 }

  // Build month buckets for the requested window
  const now = new Date()
  const buckets: { month: string, label: string }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = d.toISOString().slice(0, 7)
    buckets.push({ month, label: month })
  }

  // For each bucket, find grade and pipeline_stage in effect at end-of-month
  const meetMap: any = {}
  for (const m of monthlyMeets.results as any[]) meetMap[m.month] = m

  const series = buckets.map(b => {
    const eom = b.month + '-31T23:59:59'
    let curGrade = (hospital as any)?.grade || 'A'
    let curPipe = (hospital as any)?.pipeline_stage || 'contact'
    // Find latest grade as of eom
    for (const g of grades.results as any[]) {
      if (g.changed_at <= eom) curGrade = g.to_grade
      else break
    }
    for (const p of pipes.results as any[]) {
      if (p.changed_at <= eom) curPipe = p.to_stage
      else break
    }
    const meets = meetMap[b.month] || { count: 0, visit_count: 0, result_count: 0 }
    const score = (gradeW[curGrade] || 0) * 10
      + (pipeW[curPipe] || 0) * 5
      + (meets.count || 0) * 2
      + (meets.result_count || 0) * 3
    return {
      month: b.month,
      grade: curGrade,
      pipeline_stage: curPipe,
      meeting_count: meets.count || 0,
      visit_count: meets.visit_count || 0,
      result_count: meets.result_count || 0,
      score,
    }
  })

  return c.json({ data: {
    hospital,
    months,
    series,
    grade_changes: grades.results,
    pipeline_changes: pipes.results,
  }})
})

// ===== Hospital Integrated Timeline =====
// GET /api/hospitals/:id/timeline?limit=200
// Returns a unified, time-sorted feed merging:
//  - meetings (with doctor names + result snippet)
//  - grade changes (hospital_grade_history)
//  - pipeline transitions (pipeline_transitions)
//  - doctor add/delete activity (activity_log scoped to this hospital's doctors)
//  - hospital create/update activity (activity_log on hospital itself)
//  - meeting comments (recent comments on this hospital's meetings)
hospitals.get('/:id/timeline', async (c) => {
  const id = Number(c.req.param('id'))
  const limit = Math.min(Number(c.req.query('limit') || '200'), 500)

  const [meets, pipes, hospActs, docActs, comments] = await Promise.all([
    c.env.DB.prepare(`
      SELECT m.id, m.meeting_date, m.meeting_type, m.visit_time, m.start_time, m.end_time,
             m.purpose, m.content, m.result, m.next_action, m.created_at,
             u.name as user_name,
             (SELECT GROUP_CONCAT(d.name, ', ')
              FROM meeting_doctors md LEFT JOIN doctors d ON d.id = md.doctor_id
              WHERE md.meeting_id = m.id) as doctor_names
      FROM meetings m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.hospital_id = ?
      ORDER BY m.meeting_date DESC, m.id DESC
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT pt.id, pt.from_stage, pt.to_stage, pt.changed_at, u.name as changed_by_name
      FROM pipeline_transitions pt
      LEFT JOIN users u ON u.id = pt.changed_by
      WHERE pt.hospital_id = ?
      ORDER BY pt.changed_at DESC
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT id, action, entity_name, details, created_at
      FROM activity_log
      WHERE entity_type='hospital' AND entity_id=?
      ORDER BY created_at DESC LIMIT 50
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT al.id, al.action, al.entity_name, al.details, al.created_at, al.entity_id
      FROM activity_log al
      WHERE al.entity_type='doctor'
        AND al.entity_id IN (SELECT id FROM doctors WHERE hospital_id=?)
      ORDER BY al.created_at DESC LIMIT 80
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT mc.id, mc.content, mc.created_at, mc.meeting_id,
             u.name as user_name,
             m.meeting_date
      FROM meeting_comments mc
      LEFT JOIN users u ON u.id = mc.user_id
      LEFT JOIN meetings m ON m.id = mc.meeting_id
      WHERE m.hospital_id = ?
      ORDER BY mc.created_at DESC LIMIT 80
    `).bind(id).all().catch(() => ({ results: [] })),
  ])

  // Normalize into a single event list { ts, type, title, body, meta }
  const events: any[] = []

  for (const m of meets.results as any[]) {
    const ts = (m.meeting_date || '').substring(0, 10)
    events.push({
      ts: (ts ? ts : (m.created_at || '')) + 'T00:00:00',
      sortTs: m.meeting_date || m.created_at,
      type: 'meeting',
      meeting_type: m.meeting_type,
      title: (m.doctor_names || '의료진 미정') + ' · ' + (m.purpose || '미팅'),
      body: m.result || m.content || '',
      meta: {
        meeting_id: m.id,
        meeting_type: m.meeting_type,
        visit_time: m.visit_time,
        start_time: m.start_time,
        end_time: m.end_time,
        user_name: m.user_name,
        next_action: m.next_action,
      },
    })
  }
  const stageLabels: Record<string, string> = {
    contact: '접촉', meeting: '미팅', demo: '데모', proposal: '제안', contract: '계약', active_customer: '활성고객'
  }
  for (const p of pipes.results as any[]) {
    events.push({
      ts: p.changed_at,
      sortTs: p.changed_at,
      type: 'pipeline',
      title: '파이프라인: ' + (stageLabels[p.from_stage] || p.from_stage || '-') + ' → ' + (stageLabels[p.to_stage] || p.to_stage || '-'),
      body: '',
      meta: { from: p.from_stage, to: p.to_stage, changed_by: p.changed_by_name },
    })
  }
  for (const a of hospActs.results as any[]) {
    if (a.action === 'update' || a.action === 'create') {
      events.push({
        ts: a.created_at,
        sortTs: a.created_at,
        type: 'hospital_activity',
        title: (a.action === 'create' ? '기관 등록' : '기관 정보 변경') + (a.entity_name ? ' · ' + a.entity_name : ''),
        body: a.details || '',
        meta: { action: a.action },
      })
    }
  }
  for (const a of docActs.results as any[]) {
    events.push({
      ts: a.created_at,
      sortTs: a.created_at,
      type: 'doctor_activity',
      title: (a.action === 'create' ? '의료진 추가: ' : a.action === 'delete' ? '의료진 삭제: ' : '의료진 변경: ') + (a.entity_name || ''),
      body: a.details || '',
      meta: { action: a.action, doctor_id: a.entity_id },
    })
  }
  for (const cm of (comments as any).results as any[]) {
    events.push({
      ts: cm.created_at,
      sortTs: cm.created_at,
      type: 'comment',
      title: (cm.user_name || '익명') + ' 의 미팅 코멘트',
      body: (cm.content || '').slice(0, 200),
      meta: { meeting_id: cm.meeting_id, meeting_date: cm.meeting_date },
    })
  }

  // Sort: latest first
  events.sort((a, b) => String(b.sortTs || '').localeCompare(String(a.sortTs || '')))

  return c.json({ data: {
    events: events.slice(0, limit),
    counts: {
      total: events.length,
      meeting: events.filter(e => e.type === 'meeting').length,
      pipeline: events.filter(e => e.type === 'pipeline').length,
      doctor: events.filter(e => e.type === 'doctor_activity').length,
      hospital: events.filter(e => e.type === 'hospital_activity').length,
      comment: events.filter(e => e.type === 'comment').length,
    }
  }})
})

hospitals.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const h = await c.env.DB.prepare('SELECT name FROM hospitals WHERE id=?').bind(id).first() as any
  // CASCADE: delete meeting_doctors, meetings, papers, doctors first
  await c.env.DB.prepare('DELETE FROM meeting_doctors WHERE meeting_id IN (SELECT id FROM meetings WHERE hospital_id=?)').bind(id).run()
  await c.env.DB.prepare('DELETE FROM meeting_doctors WHERE doctor_id IN (SELECT id FROM doctors WHERE hospital_id=?)').bind(id).run()
  await c.env.DB.prepare('DELETE FROM doctor_papers WHERE doctor_id IN (SELECT id FROM doctors WHERE hospital_id=?)').bind(id).run()
  await c.env.DB.prepare('DELETE FROM meetings WHERE hospital_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM doctors WHERE hospital_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM hospitals WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'hospital', Number(id), h?.name || '')
  return c.json({ success: true })
})

export default hospitals
