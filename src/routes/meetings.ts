import { Hono } from 'hono'
import { logActivity, safeInt, safeLimit, safeLike } from '../helpers'

type Bindings = { DB: D1Database }
const meetings = new Hono<{ Bindings: Bindings }>()

meetings.get('/', async (c) => {
  const { doctor_id, hospital_id, limit, meeting_type, date_from, date_to, search } = c.req.query()
  let q = 'SELECT m.*, d.name as doctor_name, d.photo as doctor_photo, h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id=d.id LEFT JOIN hospitals h ON m.hospital_id=h.id'
  const conds: string[] = [], p: any[] = []
  if (doctor_id) { conds.push('m.doctor_id=?'); p.push(safeInt(doctor_id)) }
  if (hospital_id) { conds.push('m.hospital_id=?'); p.push(safeInt(hospital_id)) }
  if (meeting_type) { conds.push('m.meeting_type=?'); p.push(meeting_type) }
  if (date_from) { conds.push('m.meeting_date>=?'); p.push(date_from) }
  if (date_to) { conds.push('m.meeting_date<=?'); p.push(date_to) }
  if (search) { const s = `%${safeLike(search)}%`; conds.push('(d.name LIKE ? OR h.name LIKE ? OR m.purpose LIKE ? OR m.content LIKE ?)'); p.push(s, s, s, s) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY m.meeting_date DESC'
  if (limit) q += ` LIMIT ${safeLimit(limit, 200)}`
  const r = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ data: r.results })
})

meetings.post('/', async (c) => {
  const b = await c.req.json()
  if (!b.doctor_id) return c.json({ error: 'doctor_id is required' }, 400)
  if (!b.hospital_id) return c.json({ error: 'hospital_id is required' }, 400)
  if (!b.meeting_date) return c.json({ error: 'meeting_date is required' }, 400)
  const r = await c.env.DB.prepare('INSERT INTO meetings (doctor_id,hospital_id,meeting_date,meeting_type,purpose,content,result,next_action,next_meeting_date) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(b.doctor_id, b.hospital_id, b.meeting_date, b.meeting_type || 'visit', b.purpose || '', b.content || '', b.result || '', b.next_action || '', b.next_meeting_date || null).run()
  const doc = await c.env.DB.prepare('SELECT name FROM doctors WHERE id=?').bind(b.doctor_id).first() as any
  await logActivity(c.env.DB, 'create', 'meeting', r.meta.last_row_id as number, doc?.name || '', `type:${b.meeting_type || 'visit'}, purpose:${b.purpose || ''}`)
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

meetings.put('/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.doctor_id || !b.hospital_id || !b.meeting_date) return c.json({ error: 'Required fields missing' }, 400)
  await c.env.DB.prepare('UPDATE meetings SET doctor_id=?,hospital_id=?,meeting_date=?,meeting_type=?,purpose=?,content=?,result=?,next_action=?,next_meeting_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(b.doctor_id, b.hospital_id, b.meeting_date, b.meeting_type || 'visit', b.purpose || '', b.content || '', b.result || '', b.next_action || '', b.next_meeting_date || null, id).run()
  await logActivity(c.env.DB, 'update', 'meeting', Number(id), '', `type:${b.meeting_type}`)
  return c.json({ data: { id: Number(id), ...b } })
})

meetings.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'meeting', Number(id), '')
  return c.json({ success: true })
})

// Quick list of hospitals + doctors for global meeting form
meetings.get('/form-data', async (c) => {
  const [hosps, docs] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, region FROM hospitals WHERE status="active" ORDER BY name').all(),
    c.env.DB.prepare('SELECT d.id, d.name, d.hospital_id, d.position, h.name as hospital_name FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id ORDER BY d.name').all(),
  ])
  return c.json({ data: { hospitals: hosps.results, doctors: docs.results } })
})

export default meetings
