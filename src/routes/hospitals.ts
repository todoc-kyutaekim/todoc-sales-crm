import { Hono } from 'hono'
import { logActivity, safeLike, safeInt } from '../helpers'

type Bindings = { DB: D1Database }
const hospitals = new Hono<{ Bindings: Bindings }>()

hospitals.get('/', async (c) => {
  const { region, status, search, grade, type } = c.req.query()
  let q = `SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meetings m ON h.id = m.hospital_id`
  const conds: string[] = [], params: any[] = []
  if (region) { conds.push('h.region = ?'); params.push(region) }
  if (status) { conds.push('h.status = ?'); params.push(status) }
  if (grade) { conds.push('h.grade = ?'); params.push(grade) }
  if (type) { conds.push('h.type = ?'); params.push(type) }
  if (search) { conds.push('(h.name LIKE ? OR h.region LIKE ? OR h.address LIKE ?)'); const s = `%${safeLike(search)}%`; params.push(s, s, s) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' GROUP BY h.id ORDER BY h.grade ASC, h.name ASC'
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
    'INSERT INTO hospitals (name,region,address,phone,grade,notes,status,type,priority,todoc_contact,patient_count,hearing_aid_sales,ci_referrals,pipeline_stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    b.name.trim(), b.region || '', b.address || '', b.phone || '',
    b.grade || 'A',
    b.notes || '', b.status || 'active',
    b.type || 'hospital',
    b.priority || '3', b.todoc_contact || '', 
    safeInt(b.patient_count + ''), safeInt(b.hearing_aid_sales + ''), safeInt(b.ci_referrals + ''),
    b.pipeline_stage || 'contact'
  ).run()
  await logActivity(c.env.DB, 'create', 'hospital', r.meta.last_row_id as number, b.name.trim())
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

hospitals.put('/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)
  await c.env.DB.prepare(
    'UPDATE hospitals SET name=?,region=?,address=?,phone=?,grade=?,notes=?,status=?,type=?,priority=?,todoc_contact=?,patient_count=?,hearing_aid_sales=?,ci_referrals=?,pipeline_stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(
    b.name.trim(), b.region || '', b.address || '', b.phone || '',
    b.grade || 'A', b.notes || '', b.status || 'active',
    b.type || 'hospital',
    b.priority || '3', b.todoc_contact || '',
    safeInt(b.patient_count + ''), safeInt(b.hearing_aid_sales + ''), safeInt(b.ci_referrals + ''),
    b.pipeline_stage || 'contact',
    id
  ).run()
  await logActivity(c.env.DB, 'update', 'hospital', Number(id), b.name.trim())
  return c.json({ data: { id: Number(id), ...b } })
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
