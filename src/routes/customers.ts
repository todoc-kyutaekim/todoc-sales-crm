import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const customers = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ─────────────────────────────────────────────────────────────
// 유틸: side 값 검증 ('left' | 'right')
// ─────────────────────────────────────────────────────────────
function normSide(v: any): 'left' | 'right' | null {
  if (v === 'left' || v === 'right') return v
  return null
}

// GET /api/customers?search=&type=&status=&hospital_id=&region=&group_id=&limit=
//   group_id: 숫자 → 해당 그룹 소속 고객만
//              'none' → 어떤 그룹에도 속하지 않은 고객만
customers.get('/', async (c) => {
  const { search, type, status, hospital_id, region, group_id, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT c.*,
      h.name AS hospital_name,
      g.name AS guardian_of_name,
      u.name AS created_by_name,
      (SELECT COUNT(*) FROM cs_inquiries WHERE customer_id = c.id) AS inquiry_count,
      (SELECT MAX(created_at) FROM cs_inquiries WHERE customer_id = c.id) AS last_inquiry_at,
      (SELECT COUNT(*) FROM customer_internal_devices WHERE customer_id = c.id) AS internal_devices_count,
      (SELECT COUNT(*) FROM customer_external_devices WHERE customer_id = c.id) AS external_devices_count,
      (SELECT GROUP_CONCAT(cg.id || '::' || cg.name || '::' || cg.color, '||')
        FROM customer_group_members m JOIN customer_groups cg ON cg.id = m.group_id
        WHERE m.customer_id = c.id) AS groups_raw
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
  if (group_id === 'none') {
    conds.push('NOT EXISTS (SELECT 1 FROM customer_group_members WHERE customer_id = c.id)')
  } else if (group_id) {
    conds.push('EXISTS (SELECT 1 FROM customer_group_members WHERE customer_id = c.id AND group_id = ?)')
    params.push(safeInt(group_id))
  }
  if (search) {
    const s = `%${safeLike(search)}%`
    // 다중 디바이스 시리얼도 검색 대상에 포함
    conds.push(`(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.device_serial LIKE ? OR c.internal_serial LIKE ? OR c.external_serial LIKE ?
      OR EXISTS (SELECT 1 FROM customer_internal_devices WHERE customer_id = c.id AND serial LIKE ?)
      OR EXISTS (SELECT 1 FROM customer_external_devices WHERE customer_id = c.id AND serial LIKE ?))`)
    params.push(s, s, s, s, s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY c.updated_at DESC, c.id DESC LIMIT ?'
  params.push(lim)

  const r = await c.env.DB.prepare(q).bind(...params).all()
  // groups_raw 문자열을 배열로 파싱
  const rows = (r.results as any[]).map((row) => {
    const raw = row.groups_raw as string | null
    const groups = raw
      ? raw.split('||').map((s) => {
          const [gid, name, color] = s.split('::')
          return { id: Number(gid), name, color }
        })
      : []
    delete row.groups_raw
    row.groups = groups
    return row
  })
  return c.json({ data: rows })
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

  // 병렬 조회: 문의 이력 + 내부기 + 외부기 + 그룹
  const [inquiries, intDevs, extDevs, groups] = await Promise.all([
    c.env.DB.prepare(`
      SELECT i.id, i.subject, i.category, i.status, i.priority, i.created_at, i.resolved_at,
        u.name AS assignee_name
      FROM cs_inquiries i
      LEFT JOIN users u ON u.id = i.assignee_id
      WHERE i.customer_id = ?
      ORDER BY i.created_at DESC
      LIMIT 50
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT id, side, manufacturer, model, serial, implant_date, notes, created_at, updated_at
      FROM customer_internal_devices
      WHERE customer_id = ?
      ORDER BY side ASC
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT id, side, manufacturer, model, serial, supply_date, version, is_active, notes, created_at, updated_at
      FROM customer_external_devices
      WHERE customer_id = ?
      ORDER BY is_active DESC, supply_date DESC, id DESC
    `).bind(id).all(),
    c.env.DB.prepare(`
      SELECT g.id, g.name, g.color, g.description, m.added_at
      FROM customer_group_members m
      JOIN customer_groups g ON g.id = m.group_id
      WHERE m.customer_id = ?
      ORDER BY g.sort_order ASC, g.name ASC
    `).bind(id).all(),
  ])

  return c.json({
    data: {
      ...row,
      inquiries: inquiries.results || [],
      internal_devices: intDevs.results || [],
      external_devices: extDevs.results || [],
      groups: groups.results || [],
    }
  })
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
      external_manufacturer, external_model, external_serial, external_supply_date, external_version,
      surgery_side
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
    b.external_manufacturer || null, b.external_model || null, b.external_serial || null, b.external_supply_date || null, b.external_version || null,
    b.surgery_side || null
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
      surgery_side=?,
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
    b.surgery_side || null,
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

// ─────────────────────────────────────────────────────────────
// 내부기 (customer_internal_devices) — 고객당 좌/우 최대 각 1개
// ─────────────────────────────────────────────────────────────

// GET /api/customers/:id/internal-devices
customers.get('/:id/internal-devices', async (c) => {
  const id = c.req.param('id')
  const r = await c.env.DB.prepare(`
    SELECT id, side, manufacturer, model, serial, implant_date, notes, created_at, updated_at
    FROM customer_internal_devices
    WHERE customer_id = ?
    ORDER BY side ASC
  `).bind(id).all()
  return c.json({ data: r.results || [] })
})

// POST /api/customers/:id/internal-devices
customers.post('/:id/internal-devices', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  const side = normSide(b.side)
  if (!side) return apiError(c, 400, '방향(side)은 left 또는 right 여야 합니다', ErrorCodes.VALIDATION)

  // 고객 존재 확인
  const cust = await c.env.DB.prepare('SELECT id, name FROM customers WHERE id=?').bind(id).first() as any
  if (!cust) return apiError(c, 404, '고객을 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  try {
    const r = await c.env.DB.prepare(`
      INSERT INTO customer_internal_devices (customer_id, side, manufacturer, model, serial, implant_date, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, side,
      b.manufacturer || null, b.model || null, b.serial || null, b.implant_date || null, b.notes || null
    ).run()

    await logActivity(c.env.DB, 'create', 'customer_internal_device', r.meta.last_row_id as number, `${cust.name} · ${side === 'left' ? '좌측' : '우측'} 내부기`)
    return c.json({ data: { id: r.meta.last_row_id, customer_id: Number(id), side, ...b } }, 201)
  } catch (e: any) {
    // UNIQUE 위반 (같은 side 중복)
    if (String(e.message || '').includes('UNIQUE')) {
      return apiError(c, 409, `해당 방향(${side === 'left' ? '좌측' : '우측'})의 내부기가 이미 등록되어 있습니다`, ErrorCodes.CONFLICT)
    }
    throw e
  }
})

// PUT /api/customers/:id/internal-devices/:did
customers.put('/:id/internal-devices/:did', async (c) => {
  const id = c.req.param('id')
  const did = c.req.param('did')
  const b = await c.req.json()

  // 소유 확인
  const own = await c.env.DB.prepare('SELECT id, side FROM customer_internal_devices WHERE id=? AND customer_id=?').bind(did, id).first() as any
  if (!own) return apiError(c, 404, '내부기를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  // side 변경 허용 (UNIQUE 위반 시 409)
  const newSide = b.side ? normSide(b.side) : own.side
  if (b.side && !newSide) return apiError(c, 400, '방향(side)은 left 또는 right 여야 합니다', ErrorCodes.VALIDATION)

  try {
    await c.env.DB.prepare(`
      UPDATE customer_internal_devices SET
        side=?, manufacturer=?, model=?, serial=?, implant_date=?, notes=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND customer_id=?
    `).bind(
      newSide,
      b.manufacturer || null, b.model || null, b.serial || null, b.implant_date || null, b.notes || null,
      did, id
    ).run()

    await logActivity(c.env.DB, 'update', 'customer_internal_device', Number(did), '')
    return c.json({ data: { id: Number(did), customer_id: Number(id), side: newSide, ...b } })
  } catch (e: any) {
    if (String(e.message || '').includes('UNIQUE')) {
      return apiError(c, 409, `해당 방향(${newSide === 'left' ? '좌측' : '우측'})의 내부기가 이미 등록되어 있습니다`, ErrorCodes.CONFLICT)
    }
    throw e
  }
})

// DELETE /api/customers/:id/internal-devices/:did
customers.delete('/:id/internal-devices/:did', async (c) => {
  const id = c.req.param('id')
  const did = c.req.param('did')
  const own = await c.env.DB.prepare('SELECT id FROM customer_internal_devices WHERE id=? AND customer_id=?').bind(did, id).first()
  if (!own) return apiError(c, 404, '내부기를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare('DELETE FROM customer_internal_devices WHERE id=? AND customer_id=?').bind(did, id).run()
  await logActivity(c.env.DB, 'delete', 'customer_internal_device', Number(did), '')
  return c.json({ data: { id: Number(did) } })
})

// ─────────────────────────────────────────────────────────────
// 외부기 (customer_external_devices) — 고객당 여러 개
// ─────────────────────────────────────────────────────────────

// GET /api/customers/:id/external-devices
customers.get('/:id/external-devices', async (c) => {
  const id = c.req.param('id')
  const r = await c.env.DB.prepare(`
    SELECT id, side, manufacturer, model, serial, supply_date, version, is_active, notes, created_at, updated_at
    FROM customer_external_devices
    WHERE customer_id = ?
    ORDER BY is_active DESC, supply_date DESC, id DESC
  `).bind(id).all()
  return c.json({ data: r.results || [] })
})

// POST /api/customers/:id/external-devices
customers.post('/:id/external-devices', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  const side = normSide(b.side)
  if (!side) return apiError(c, 400, '방향(side)은 left 또는 right 여야 합니다', ErrorCodes.VALIDATION)

  const cust = await c.env.DB.prepare('SELECT id, name FROM customers WHERE id=?').bind(id).first() as any
  if (!cust) return apiError(c, 404, '고객을 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  const isActive = (b.is_active === false || b.is_active === 0 || b.is_active === '0') ? 0 : 1

  const r = await c.env.DB.prepare(`
    INSERT INTO customer_external_devices (customer_id, side, manufacturer, model, serial, supply_date, version, is_active, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, side,
    b.manufacturer || null, b.model || null, b.serial || null, b.supply_date || null, b.version || null,
    isActive,
    b.notes || null
  ).run()

  await logActivity(c.env.DB, 'create', 'customer_external_device', r.meta.last_row_id as number, `${cust.name} · ${side === 'left' ? '좌측' : '우측'} 외부기`)
  return c.json({ data: { id: r.meta.last_row_id, customer_id: Number(id), side, is_active: isActive, ...b } }, 201)
})

// PUT /api/customers/:id/external-devices/:did
customers.put('/:id/external-devices/:did', async (c) => {
  const id = c.req.param('id')
  const did = c.req.param('did')
  const b = await c.req.json()

  const own = await c.env.DB.prepare('SELECT id, side FROM customer_external_devices WHERE id=? AND customer_id=?').bind(did, id).first() as any
  if (!own) return apiError(c, 404, '외부기를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  const newSide = b.side ? normSide(b.side) : own.side
  if (b.side && !newSide) return apiError(c, 400, '방향(side)은 left 또는 right 여야 합니다', ErrorCodes.VALIDATION)

  const isActive = (b.is_active === false || b.is_active === 0 || b.is_active === '0') ? 0 : 1

  await c.env.DB.prepare(`
    UPDATE customer_external_devices SET
      side=?, manufacturer=?, model=?, serial=?, supply_date=?, version=?, is_active=?, notes=?,
      updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND customer_id=?
  `).bind(
    newSide,
    b.manufacturer || null, b.model || null, b.serial || null, b.supply_date || null, b.version || null,
    isActive,
    b.notes || null,
    did, id
  ).run()

  await logActivity(c.env.DB, 'update', 'customer_external_device', Number(did), '')
  return c.json({ data: { id: Number(did), customer_id: Number(id), side: newSide, is_active: isActive, ...b } })
})

// DELETE /api/customers/:id/external-devices/:did
customers.delete('/:id/external-devices/:did', async (c) => {
  const id = c.req.param('id')
  const did = c.req.param('did')
  const own = await c.env.DB.prepare('SELECT id FROM customer_external_devices WHERE id=? AND customer_id=?').bind(did, id).first()
  if (!own) return apiError(c, 404, '외부기를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare('DELETE FROM customer_external_devices WHERE id=? AND customer_id=?').bind(did, id).run()
  await logActivity(c.env.DB, 'delete', 'customer_external_device', Number(did), '')
  return c.json({ data: { id: Number(did) } })
})

export default customers
