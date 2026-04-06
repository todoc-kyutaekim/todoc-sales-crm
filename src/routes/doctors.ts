import { Hono } from 'hono'
import { logActivity, safeLike } from '../helpers'

type Bindings = { DB: D1Database }
const doctors = new Hono<{ Bindings: Bindings }>()

// List doctors by hospital
doctors.get('/hospitals/:hid/doctors', async (c) => {
  const r = await c.env.DB.prepare(`SELECT d.*, 
    MAX(m.meeting_date) as last_meeting, 
    COUNT(DISTINCT m.id) as meeting_count 
    FROM doctors d 
    LEFT JOIN meeting_doctors md ON d.id=md.doctor_id 
    LEFT JOIN meetings m ON md.meeting_id=m.id 
    WHERE d.hospital_id=? GROUP BY d.id ORDER BY d.influence_level DESC, d.name`).bind(c.req.param('hid')).all()
  return c.json({ data: r.results })
})

// List all doctors with filters
doctors.get('/doctors', async (c) => {
  const { search, influence_level, specialty, unvisited_days } = c.req.query()
  let q = `SELECT d.*, h.name as hospital_name, h.grade as hospital_grade, 
    MAX(m.meeting_date) as last_meeting, COUNT(DISTINCT m.id) as meeting_count 
    FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id 
    LEFT JOIN meeting_doctors md ON d.id=md.doctor_id 
    LEFT JOIN meetings m ON md.meeting_id=m.id`
  const conds: string[] = [], p: any[] = []
  if (search) { conds.push('(d.name LIKE ? OR h.name LIKE ? OR d.specialty LIKE ?)'); const s = `%${safeLike(search)}%`; p.push(s, s, s) }
  if (influence_level) { conds.push('d.influence_level = ?'); p.push(influence_level) }
  if (specialty) { conds.push('d.specialty LIKE ?'); p.push(`%${safeLike(specialty)}%`) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' GROUP BY d.id'
  if (unvisited_days) {
    const days = parseInt(unvisited_days, 10)
    if (!isNaN(days) && days > 0) {
      q += ` HAVING last_meeting IS NULL OR last_meeting < date('now', '-${days} days')`
    }
  }
  q += ' ORDER BY d.name'
  const r = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ data: r.results })
})

// Unique departments for filter dropdown
doctors.get('/doctors/departments', async (c) => {
  const r = await c.env.DB.prepare("SELECT DISTINCT department FROM doctors WHERE department!='' ORDER BY department").all()
  return c.json({ data: r.results.map((x: any) => x.department) })
})

// Doctor detail profile
doctors.get('/doctors/:id', async (c) => {
  const id = c.req.param('id')
  const [docR, papersR, meetingsR] = await Promise.all([
    c.env.DB.prepare('SELECT d.*, h.name as hospital_name, h.region as hospital_region, h.grade as hospital_grade, h.address as hospital_address FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id WHERE d.id=?').bind(id).first(),
    c.env.DB.prepare('SELECT * FROM doctor_papers WHERE doctor_id=? ORDER BY year DESC, id DESC').bind(id).all(),
    c.env.DB.prepare(`SELECT m.*, h.name as hospital_name FROM meetings m 
      LEFT JOIN hospitals h ON m.hospital_id=h.id 
      WHERE m.id IN (SELECT meeting_id FROM meeting_doctors WHERE doctor_id=?) 
      ORDER BY m.meeting_date DESC`).bind(id).all(),
  ])
  if (!docR) return c.json({ error: 'Not found' }, 404)
  
  // Enrich meetings with all doctor names
  const meetingsList = meetingsR.results as any[]
  if (meetingsList.length > 0) {
    const mIds = meetingsList.map(m => m.id)
    const ph = mIds.map(() => '?').join(',')
    const mdR = await c.env.DB.prepare(
      `SELECT md.meeting_id, d.id as doctor_id, d.name as doctor_name, d.photo as doctor_photo
       FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id
       WHERE md.meeting_id IN (${ph}) ORDER BY md.meeting_id, d.name`
    ).bind(...mIds).all()
    const dMap = new Map<number, any[]>()
    for (const row of mdR.results as any[]) {
      if (!dMap.has(row.meeting_id)) dMap.set(row.meeting_id, [])
      dMap.get(row.meeting_id)!.push(row)
    }
    for (const m of meetingsList) {
      const doctors = dMap.get(m.id) || []
      m.doctors = doctors
      m.doctor_name = doctors.map((d: any) => d.doctor_name).join(', ')
    }
  }
  
  return c.json({ data: { ...docR, meeting_count: meetingsList.length, last_meeting: meetingsList.length ? (meetingsList[0] as any).meeting_date : null, papers: papersR.results, meetings: meetingsList } })
})

doctors.post('/doctors', async (c) => {
  const b = await c.req.json()
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)
  if (!b.hospital_id) return c.json({ error: 'hospital_id is required' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO doctors (hospital_id,name,department,position,phone,email,specialty,influence_level,notes,photo,bio,education,career,clinic_hours) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(b.hospital_id, b.name.trim(), b.department || '', b.position || '', b.phone || '', b.email || '', b.specialty || '', b.influence_level || 'medium', b.notes || '', b.photo || '', b.bio || '', b.education || '', b.career || '', b.clinic_hours || '').run()
  await logActivity(c.env.DB, 'create', 'doctor', r.meta.last_row_id as number, b.name.trim())
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

doctors.put('/doctors/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)
  await c.env.DB.prepare('UPDATE doctors SET hospital_id=?,name=?,department=?,position=?,phone=?,email=?,specialty=?,influence_level=?,notes=?,photo=?,bio=?,education=?,career=?,clinic_hours=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(b.hospital_id, b.name.trim(), b.department || '', b.position || '', b.phone || '', b.email || '', b.specialty || '', b.influence_level || 'medium', b.notes || '', b.photo || '', b.bio || '', b.education || '', b.career || '', b.clinic_hours || '', id).run()
  await logActivity(c.env.DB, 'update', 'doctor', Number(id), b.name.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

doctors.delete('/doctors/:id', async (c) => {
  const id = c.req.param('id')
  const d = await c.env.DB.prepare('SELECT name FROM doctors WHERE id=?').bind(id).first() as any
  await c.env.DB.prepare('DELETE FROM doctor_papers WHERE doctor_id=?').bind(id).run()
  // Delete meeting_doctors entries for this doctor
  await c.env.DB.prepare('DELETE FROM meeting_doctors WHERE doctor_id=?').bind(id).run()
  // Delete meetings where this doctor was the only participant
  await c.env.DB.prepare(`DELETE FROM meetings WHERE id NOT IN (SELECT DISTINCT meeting_id FROM meeting_doctors) AND doctor_id=?`).bind(id).run()
  await c.env.DB.prepare('DELETE FROM doctors WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'doctor', Number(id), d?.name || '')
  return c.json({ success: true })
})

// Photo
doctors.post('/doctors/:id/photo', async (c) => {
  const body = await c.req.json()
  if (!body.photo) return c.json({ error: 'No photo' }, 400)
  await c.env.DB.prepare('UPDATE doctors SET photo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.photo, c.req.param('id')).run()
  return c.json({ success: true })
})

// Profile update (bio, education, career, position, specialty) — partial update
doctors.patch('/doctors/:id/profile', async (c) => {
  const b = await c.req.json()
  const id = c.req.param('id')
  const sets: string[] = []
  const vals: any[] = []
  if (b.bio !== undefined) { sets.push('bio=?'); vals.push(b.bio) }
  if (b.education !== undefined) { sets.push('education=?'); vals.push(b.education) }
  if (b.career !== undefined) { sets.push('career=?'); vals.push(b.career) }
  if (b.position !== undefined) { sets.push('position=?'); vals.push(b.position) }
  if (b.specialty !== undefined) { sets.push('specialty=?'); vals.push(b.specialty) }
  if (b.clinic_hours !== undefined) { sets.push('clinic_hours=?'); vals.push(b.clinic_hours) }
  if (!sets.length) return c.json({ error: 'No fields to update' }, 400)
  sets.push('updated_at=CURRENT_TIMESTAMP')
  vals.push(id)
  await c.env.DB.prepare(`UPDATE doctors SET ${sets.join(',')} WHERE id=?`).bind(...vals).run()
  return c.json({ success: true })
})

doctors.delete('/doctors/:id/photo', async (c) => {
  await c.env.DB.prepare("UPDATE doctors SET photo='', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// Papers
doctors.post('/doctors/:id/papers', async (c) => {
  const b = await c.req.json(); const did = c.req.param('id')
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0) return c.json({ error: 'title is required' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO doctor_papers (doctor_id,title,journal,year,authors,doi,abstract,paper_type,url) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(did, b.title.trim(), b.journal || '', b.year || null, b.authors || '', b.doi || '', b.abstract || '', b.paper_type || 'journal', b.url || '').run()
  await logActivity(c.env.DB, 'create', 'paper', r.meta.last_row_id as number, b.title.trim(), `doctor_id:${did}`)
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

doctors.put('/papers/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0) return c.json({ error: 'title is required' }, 400)
  await c.env.DB.prepare('UPDATE doctor_papers SET title=?,journal=?,year=?,authors=?,doi=?,abstract=?,paper_type=?,url=? WHERE id=?')
    .bind(b.title.trim(), b.journal || '', b.year || null, b.authors || '', b.doi || '', b.abstract || '', b.paper_type || 'journal', b.url || '', id).run()
  await logActivity(c.env.DB, 'update', 'paper', Number(id), b.title.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

doctors.delete('/papers/:id', async (c) => {
  const id = c.req.param('id')
  const p = await c.env.DB.prepare('SELECT title FROM doctor_papers WHERE id=?').bind(id).first() as any
  await c.env.DB.prepare('DELETE FROM doctor_papers WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'paper', Number(id), p?.title || '')
  return c.json({ success: true })
})

export default doctors
