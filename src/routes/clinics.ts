import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit } from '../helpers'

type Bindings = { DB: D1Database }
const clinics = new Hono<{ Bindings: Bindings }>()

// ===== CLINICS CRUD =====
clinics.get('/', async (c) => {
  const { region, status, search, priority } = c.req.query()
  let q = `SELECT cl.*, 
    COUNT(DISTINCT cc.id) as contact_count, 
    COUNT(DISTINCT cv.id) as visit_count, 
    MAX(cv.visit_date) as last_visit 
    FROM clinics cl 
    LEFT JOIN clinic_contacts cc ON cl.id = cc.clinic_id 
    LEFT JOIN clinic_visits cv ON cl.id = cv.clinic_id`
  const conds: string[] = [], params: any[] = []
  if (region) { conds.push('cl.region = ?'); params.push(region) }
  if (status) { conds.push('cl.status = ?'); params.push(status) }
  if (priority) { conds.push('cl.priority = ?'); params.push(priority) }
  if (search) { conds.push('(cl.name LIKE ? OR cl.region LIKE ? OR cl.address LIKE ?)'); const s = `%${safeLike(search)}%`; params.push(s, s, s) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' GROUP BY cl.id ORDER BY cl.priority DESC, cl.name ASC'
  const r = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: r.results })
})

clinics.get('/regions', async (c) => {
  const r = await c.env.DB.prepare('SELECT DISTINCT region FROM clinics WHERE region!="" ORDER BY region').all()
  return c.json({ data: r.results.map((x: any) => x.region) })
})

clinics.get('/:id', async (c) => {
  const cl = await c.env.DB.prepare('SELECT * FROM clinics WHERE id = ?').bind(c.req.param('id')).first()
  return cl ? c.json({ data: cl }) : c.json({ error: 'Not found' }, 404)
})

clinics.post('/', async (c) => {
  const b = await c.req.json()
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO clinics (name,region,address,phone,priority,todoc_contact,notes,status,patient_count,hearing_aid_sales,ci_referrals) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    b.name.trim(), b.region || '', b.address || '', b.phone || '',
    b.priority || '3', b.todoc_contact || 'X', b.notes || '', b.status || 'active',
    safeInt(b.patient_count + ''), safeInt(b.hearing_aid_sales + ''), safeInt(b.ci_referrals + '')
  ).run()
  await logActivity(c.env.DB, 'create', 'clinic', r.meta.last_row_id as number, b.name.trim())
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

clinics.put('/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) return c.json({ error: 'name is required' }, 400)
  await c.env.DB.prepare(
    'UPDATE clinics SET name=?,region=?,address=?,phone=?,priority=?,todoc_contact=?,notes=?,status=?,patient_count=?,hearing_aid_sales=?,ci_referrals=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(
    b.name.trim(), b.region || '', b.address || '', b.phone || '',
    b.priority || '3', b.todoc_contact || 'X', b.notes || '', b.status || 'active',
    safeInt(b.patient_count + ''), safeInt(b.hearing_aid_sales + ''), safeInt(b.ci_referrals + ''),
    id
  ).run()
  await logActivity(c.env.DB, 'update', 'clinic', Number(id), b.name.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

clinics.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const cl = await c.env.DB.prepare('SELECT name FROM clinics WHERE id=?').bind(id).first() as any
  await c.env.DB.prepare('DELETE FROM clinic_visits WHERE clinic_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM clinic_contacts WHERE clinic_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM clinics WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'clinic', Number(id), cl?.name || '')
  return c.json({ success: true })
})

// ===== CONTACTS CRUD =====
clinics.get('/:cid/contacts', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT cc.*, COUNT(DISTINCT cv.id) as visit_count, MAX(cv.visit_date) as last_visit 
     FROM clinic_contacts cc 
     LEFT JOIN clinic_visits cv ON cc.id = cv.contact_id 
     WHERE cc.clinic_id=? GROUP BY cc.id ORDER BY cc.influence_level DESC, cc.name`
  ).bind(c.req.param('cid')).all()
  return c.json({ data: r.results })
})

clinics.post('/:cid/contacts', async (c) => {
  const b = await c.req.json(); const cid = c.req.param('cid')
  if (!b.name) return c.json({ error: 'name is required' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO clinic_contacts (clinic_id,name,role,phone,email,influence_level,notes,photo) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(cid, b.name.trim(), b.role || '', b.phone || '', b.email || '', b.influence_level || 'medium', b.notes || '', b.photo || '').run()
  await logActivity(c.env.DB, 'create', 'clinic_contact', r.meta.last_row_id as number, b.name.trim())
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

clinics.put('/contacts/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.name) return c.json({ error: 'name is required' }, 400)
  await c.env.DB.prepare(
    'UPDATE clinic_contacts SET name=?,role=?,phone=?,email=?,influence_level=?,notes=?,photo=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(b.name.trim(), b.role || '', b.phone || '', b.email || '', b.influence_level || 'medium', b.notes || '', b.photo || '', id).run()
  await logActivity(c.env.DB, 'update', 'clinic_contact', Number(id), b.name.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

clinics.delete('/contacts/:id', async (c) => {
  const id = c.req.param('id')
  const cc = await c.env.DB.prepare('SELECT name FROM clinic_contacts WHERE id=?').bind(id).first() as any
  // Set visits contact_id to null
  await c.env.DB.prepare('UPDATE clinic_visits SET contact_id=NULL WHERE contact_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM clinic_contacts WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'clinic_contact', Number(id), cc?.name || '')
  return c.json({ success: true })
})

// ===== VISITS CRUD =====
clinics.get('/:cid/visits', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT cv.*, cc.name as contact_name, cc.role as contact_role 
     FROM clinic_visits cv 
     LEFT JOIN clinic_contacts cc ON cv.contact_id = cc.id 
     WHERE cv.clinic_id=? ORDER BY cv.visit_date DESC`
  ).bind(c.req.param('cid')).all()
  return c.json({ data: r.results })
})

clinics.get('/visits/all', async (c) => {
  const { search, visit_type, limit, date_from, date_to, clinic_id } = c.req.query()
  let q = `SELECT cv.*, cl.name as clinic_name, cl.region as clinic_region, cc.name as contact_name, cc.role as contact_role 
     FROM clinic_visits cv 
     LEFT JOIN clinics cl ON cv.clinic_id = cl.id 
     LEFT JOIN clinic_contacts cc ON cv.contact_id = cc.id`
  const conds: string[] = [], p: any[] = []
  if (clinic_id) { conds.push('cv.clinic_id=?'); p.push(safeInt(clinic_id)) }
  if (visit_type) { conds.push('cv.visit_type=?'); p.push(visit_type) }
  if (date_from) { conds.push('cv.visit_date>=?'); p.push(date_from) }
  if (date_to) { conds.push('cv.visit_date<=?'); p.push(date_to) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push('(cl.name LIKE ? OR cv.purpose LIKE ? OR cv.content LIKE ? OR cc.name LIKE ?)')
    p.push(s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY cv.visit_date DESC'
  if (limit) q += ` LIMIT ${safeLimit(limit, 200)}`
  const r = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ data: r.results })
})

clinics.post('/:cid/visits', async (c) => {
  const b = await c.req.json(); const cid = c.req.param('cid')
  if (!b.visit_date) return c.json({ error: 'visit_date is required' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO clinic_visits (clinic_id,contact_id,visit_date,visit_type,purpose,content,result,next_action,next_visit_date) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(cid, b.contact_id || null, b.visit_date, b.visit_type || 'visit', b.purpose || '', b.content || '', b.result || '', b.next_action || '', b.next_visit_date || null).run()
  // Get clinic name for log
  const cl = await c.env.DB.prepare('SELECT name FROM clinics WHERE id=?').bind(cid).first() as any
  await logActivity(c.env.DB, 'create', 'clinic_visit', r.meta.last_row_id as number, cl?.name || '', `type:${b.visit_type || 'visit'}`)
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

clinics.put('/visits/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  if (!b.visit_date) return c.json({ error: 'visit_date is required' }, 400)
  await c.env.DB.prepare(
    'UPDATE clinic_visits SET contact_id=?,visit_date=?,visit_type=?,purpose=?,content=?,result=?,next_action=?,next_visit_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(b.contact_id || null, b.visit_date, b.visit_type || 'visit', b.purpose || '', b.content || '', b.result || '', b.next_action || '', b.next_visit_date || null, id).run()
  await logActivity(c.env.DB, 'update', 'clinic_visit', Number(id), '', `type:${b.visit_type}`)
  return c.json({ data: { id: Number(id), ...b } })
})

clinics.delete('/visits/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM clinic_visits WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'clinic_visit', Number(id), '')
  return c.json({ success: true })
})

// ===== FORM DATA: clinics + contacts for visit forms =====
clinics.get('/form-data/all', async (c) => {
  const [cls, contacts] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, region FROM clinics WHERE status="active" ORDER BY name').all(),
    c.env.DB.prepare('SELECT cc.id, cc.name, cc.clinic_id, cc.role FROM clinic_contacts cc ORDER BY cc.name').all(),
  ])
  return c.json({ data: { clinics: cls.results, contacts: contacts.results } })
})

export default clinics
