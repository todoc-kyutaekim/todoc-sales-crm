import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const customers = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// GET /api/customers?search=&type=&status=&hospital_id=&region=&limit=
customers.get('/', async (c) => {
  const { search, type, status, hospital_id, region, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT c.*,
      h.name AS hospital_name,
      g.name AS guardian_of_name,
      u.name AS created_by_name,
      (SELECT COUNT(*) FROM cs_inquiries WHERE customer_id = c.id) AS inquiry_count,
      (SELECT MAX(created_at) FROM cs_inquiries WHERE customer_id = c.id) AS last_inquiry_at
    FROM customers c
    LEFT JOIN hospitals h ON h.id = c.hospital_id
    LEFT JOIN customers g ON g.id = c.guardian_of
    LEFT JOIN users u ON u.id = c.created_by
  `
  const conds: string[] = []
  const params: any[] = []
  if (type) { conds.push('c.customer_type = ?'); params.push(type) }
  if (status) { conds.push('c.status = ?'); params.push(status) }
  if (hospital_id) { conds.push('c.hospital_id = ?'); params.push(safeInt(hospital_id)) }
  if (region) { conds.push('c.region = ?'); params.push(region) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.device_serial LIKE ? OR c.internal_serial LIKE ? OR c.external_serial LIKE ?)')
    params.push(s, s, s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY c.updated_at DESC, c.id DESC LIMIT ?'
  params.push(lim)

  const r = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: r.results })
})

// GET /api/customers/stats — dashboard용 요약
customers.get('/stats', async (c) => {
  const [total, byType, byStatus] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM customers').first() as Promise<any>,
    c.env.DB.prepare('SELECT customer_type, COUNT(*) AS n FROM customers GROUP BY customer_type').all(),
    c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM customers GROUP BY status').all(),
  ])
  return c.json({
    data: {
      total: total?.n || 0,
      by_type: byType.results || [],
      by_status: byStatus.results || [],
    }
  })
})

// GET /api/customers/:id
customers.get('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`
    SELECT c.*,
      h.name AS hospital_name,
      g.name AS guardian_of_name,
      u.name AS created_by_name
    FROM customers c
    LEFT JOIN hospitals h ON h.id = c.hospital_id
    LEFT JOIN customers g ON g.id = c.guardian_of
    LEFT JOIN users u ON u.id = c.created_by
    WHERE c.id = ?
  `).bind(id).first()
  if (!row) return apiError(c, 404, '고객을 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  // 문의 이력도 함께 반환
  const inquiries = await c.env.DB.prepare(`
    SELECT i.id, i.subject, i.category, i.status, i.priority, i.created_at, i.resolved_at,
      u.name AS assignee_name
    FROM cs_inquiries i
    LEFT JOIN users u ON u.id = i.assignee_id
    WHERE i.customer_id = ?
    ORDER BY i.created_at DESC
    LIMIT 50
  `).bind(id).all()

  return c.json({ data: { ...row, inquiries: inquiries.results || [] } })
})

// POST /api/customers
customers.post('/', async (c) => {
  const b = await c.req.json()
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) {
    return apiError(c, 400, '이름을 입력하세요', ErrorCodes.VALIDATION)
  }
  const uid = c.get('userId')
  const r = await c.env.DB.prepare(`
    INSERT INTO customers (
      name, phone, email, birth_date, gender, customer_type,
      hospital_id, address, region,
      implant_date, implant_side, device_model, device_serial,
      guardian_of, status, tags, notes, created_by,
      internal_manufacturer, internal_model, internal_serial, internal_implant_date, internal_side,
      external_manufacturer, external_model, external_serial, external_supply_date, external_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    b.name.trim(),
    b.phone || '', b.email || '', b.birth_date || '', b.gender || '',
    b.customer_type || 'prospect',
    b.hospital_id ? safeInt(String(b.hospital_id)) : null,
    b.address || '', b.region || '',
    b.implant_date || '', b.implant_side || '',
    b.device_model || '', b.device_serial || '',
    b.guardian_of ? safeInt(String(b.guardian_of)) : null,
    b.status || 'active',
    b.tags || '', b.notes || '',
    uid || null,
    b.internal_manufacturer || null, b.internal_model || null, b.internal_serial || null, b.internal_implant_date || null, b.internal_side || null,
    b.external_manufacturer || null, b.external_model || null, b.external_serial || null, b.external_supply_date || null, b.external_version || null
  ).run()

  await logActivity(c.env.DB, 'create', 'customer', r.meta.last_row_id as number, b.name.trim())
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})

// PUT /api/customers/:id
customers.put('/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  if (!b.name || typeof b.name !== 'string' || b.name.trim().length === 0) {
    return apiError(c, 400, '이름을 입력하세요', ErrorCodes.VALIDATION)
  }
  await c.env.DB.prepare(`
    UPDATE customers SET
      name=?, phone=?, email=?, birth_date=?, gender=?, customer_type=?,
      hospital_id=?, address=?, region=?,
      implant_date=?, implant_side=?, device_model=?, device_serial=?,
      guardian_of=?, status=?, tags=?, notes=?,
      internal_manufacturer=?, internal_model=?, internal_serial=?, internal_implant_date=?, internal_side=?,
      external_manufacturer=?, external_model=?, external_serial=?, external_supply_date=?, external_version=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    b.name.trim(),
    b.phone || '', b.email || '', b.birth_date || '', b.gender || '',
    b.customer_type || 'prospect',
    b.hospital_id ? safeInt(String(b.hospital_id)) : null,
    b.address || '', b.region || '',
    b.implant_date || '', b.implant_side || '',
    b.device_model || '', b.device_serial || '',
    b.guardian_of ? safeInt(String(b.guardian_of)) : null,
    b.status || 'active',
    b.tags || '', b.notes || '',
    b.internal_manufacturer || null, b.internal_model || null, b.internal_serial || null, b.internal_implant_date || null, b.internal_side || null,
    b.external_manufacturer || null, b.external_model || null, b.external_serial || null, b.external_supply_date || null, b.external_version || null,
    id
  ).run()

  await logActivity(c.env.DB, 'update', 'customer', Number(id), b.name.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

// DELETE /api/customers/:id
customers.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT name FROM customers WHERE id=?').bind(id).first() as any
  if (!row) return apiError(c, 404, '고객을 찾을 수 없습니다', ErrorCodes.NOT_FOUND)
  await c.env.DB.prepare('DELETE FROM customers WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'customer', Number(id), row.name || '')
  return c.json({ data: { id: Number(id) } })
})

export default customers
