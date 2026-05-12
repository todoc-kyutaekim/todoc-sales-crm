import { Hono } from 'hono'
import { logActivity, safeLike } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const products = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ============================================================
// 제품 마스터: 카테고리/모델 정의 (카테고리별 비고 description 포함)
// ============================================================
products.get('/', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id) as total_count,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.status = 'in_stock') as in_stock_count,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.status IN ('with_user','at_hospital','out')) as out_count,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.status = 'delivered') as delivered_count
     FROM products p
     WHERE p.active = 1
     ORDER BY
       CASE p.category WHEN 'internal' THEN 1 WHEN 'external' THEN 2 WHEN 'carry_case' THEN 3 ELSE 4 END,
       p.model`
  ).all()
  return c.json({ data: r.results })
})

// 카테고리/모델별 비고(description) 수정
products.put('/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE products SET description=?, name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(b.description || '', b.name || '', id).run()
  return c.json({ data: { id: Number(id), ...b } })
})

// ============================================================
// 대시보드 요약
// ============================================================
products.get('/dashboard', async (c) => {
  const [byCategory, totalCounts, overdue, recentMoves] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.category, p.model, p.name,
        COUNT(pu.id) as total,
        SUM(CASE WHEN pu.status = 'in_stock' THEN 1 ELSE 0 END) as in_stock,
        SUM(CASE WHEN pu.status IN ('with_user','at_hospital','out') THEN 1 ELSE 0 END) as out,
        SUM(CASE WHEN pu.status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN pu.status IN ('lost','repair','retired') THEN 1 ELSE 0 END) as inactive
       FROM products p
       LEFT JOIN product_units pu ON pu.product_id = p.id
       WHERE p.active = 1
       GROUP BY p.id
       ORDER BY p.category, p.model`
    ).all(),
    c.env.DB.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'in_stock' THEN 1 ELSE 0 END) as in_stock,
        SUM(CASE WHEN status IN ('with_user','at_hospital','out') THEN 1 ELSE 0 END) as out,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status IN ('lost','repair','retired') THEN 1 ELSE 0 END) as inactive
       FROM product_units`
    ).first(),
    // 회수 지연: 대여(is_loan=1)로 반출되었고 expected_return_date가 지났으며 아직 회수 안 된 항목
    c.env.DB.prepare(
      `SELECT pm.id as movement_id, pm.product_unit_id, pm.expected_return_date, pm.hospital_id,
        pu.serial_no, pu.asset_code, pu.status,
        p.name as product_name, p.category, p.model,
        h.name as hospital_name,
        CAST(julianday('now','+9 hours') - julianday(pm.expected_return_date) AS INTEGER) as days_overdue
       FROM product_movements pm
       JOIN product_units pu ON pu.id = pm.product_unit_id
       JOIN products p ON p.id = pu.product_id
       LEFT JOIN hospitals h ON h.id = pm.hospital_id
       WHERE pm.is_loan = 1
         AND pm.expected_return_date IS NOT NULL
         AND pm.actual_return_date IS NULL
         AND pm.expected_return_date < date('now','+9 hours')
         AND pu.status NOT IN ('in_stock','retired','lost')
       ORDER BY pm.expected_return_date ASC
       LIMIT 20`
    ).all(),
    c.env.DB.prepare(
      `SELECT pm.*, p.name as product_name, p.category, p.model,
        pu.serial_no, pu.asset_code,
        h.name as hospital_name,
        fu.name as from_user_name, tu.name as to_user_name,
        per.name as performed_by_name
       FROM product_movements pm
       JOIN product_units pu ON pu.id = pm.product_unit_id
       JOIN products p ON p.id = pu.product_id
       LEFT JOIN hospitals h ON h.id = pm.hospital_id
       LEFT JOIN users fu ON fu.id = pm.from_user_id
       LEFT JOIN users tu ON tu.id = pm.to_user_id
       LEFT JOIN users per ON per.id = pm.performed_by
       ORDER BY pm.performed_at DESC
       LIMIT 15`
    ).all(),
  ])
  return c.json({
    data: {
      byCategory: byCategory.results,
      totals: totalCounts,
      overdue: overdue.results,
      recentMoves: recentMoves.results,
    }
  })
})

// ============================================================
// 유닛 목록 (필터링 가능)
// ============================================================
products.get('/units', async (c) => {
  const { category, model, status, holder_user_id, hospital_id, search } = c.req.query()
  const conds: string[] = []
  const params: any[] = []
  if (category) { conds.push('p.category = ?'); params.push(category) }
  if (model) { conds.push('p.model = ?'); params.push(model) }
  if (status) { conds.push('pu.status = ?'); params.push(status) }
  if (hospital_id) { conds.push('pu.current_hospital_id = ?'); params.push(hospital_id) }
  if (holder_user_id) {
    conds.push('EXISTS (SELECT 1 FROM product_holders ph WHERE ph.product_unit_id = pu.id AND ph.user_id = ? AND ph.released_at IS NULL)')
    params.push(holder_user_id)
  }
  if (search) {
    conds.push('(pu.serial_no LIKE ? OR pu.asset_code LIKE ? OR pu.notes LIKE ?)')
    const s = `%${safeLike(search)}%`
    params.push(s, s, s)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await c.env.DB.prepare(
    `SELECT pu.*, p.category, p.model, p.name as product_name, p.description as product_description,
       h.name as hospital_name,
       (SELECT GROUP_CONCAT(u.name, ', ') FROM product_holders ph
        LEFT JOIN users u ON u.id = ph.user_id
        WHERE ph.product_unit_id = pu.id AND ph.released_at IS NULL) as holders,
       (SELECT pm.performed_at FROM product_movements pm WHERE pm.product_unit_id = pu.id ORDER BY pm.performed_at DESC LIMIT 1) as last_movement_at,
       (SELECT pm.movement_type FROM product_movements pm WHERE pm.product_unit_id = pu.id ORDER BY pm.performed_at DESC LIMIT 1) as last_movement_type
     FROM product_units pu
     JOIN products p ON p.id = pu.product_id
     LEFT JOIN hospitals h ON h.id = pu.current_hospital_id
     ${where}
     ORDER BY p.category, p.model, pu.asset_code, pu.id DESC`
  ).bind(...params).all()
  return c.json({ data: r.results })
})

// 유닛 상세 + 이동 이력 + 현재 보유자 목록
products.get('/units/:id', async (c) => {
  const id = c.req.param('id')
  const [unit, holders, movements] = await Promise.all([
    c.env.DB.prepare(
      `SELECT pu.*, p.category, p.model, p.name as product_name, p.description as product_description,
         h.name as hospital_name
       FROM product_units pu
       JOIN products p ON p.id = pu.product_id
       LEFT JOIN hospitals h ON h.id = pu.current_hospital_id
       WHERE pu.id = ?`
    ).bind(id).first(),
    c.env.DB.prepare(
      `SELECT ph.*, u.name as user_name, u.email as user_email
       FROM product_holders ph
       LEFT JOIN users u ON u.id = ph.user_id
       WHERE ph.product_unit_id = ?
       ORDER BY ph.released_at IS NULL DESC, ph.assigned_at DESC`
    ).bind(id).all(),
    c.env.DB.prepare(
      `SELECT pm.*,
         h.name as hospital_name,
         d.name as doctor_name,
         fu.name as from_user_name, tu.name as to_user_name,
         per.name as performed_by_name,
         m.meeting_date, m.meeting_type, m.purpose as meeting_purpose
       FROM product_movements pm
       LEFT JOIN hospitals h ON h.id = pm.hospital_id
       LEFT JOIN doctors d ON d.id = pm.doctor_id
       LEFT JOIN users fu ON fu.id = pm.from_user_id
       LEFT JOIN users tu ON tu.id = pm.to_user_id
       LEFT JOIN users per ON per.id = pm.performed_by
       LEFT JOIN meetings m ON m.id = pm.meeting_id
       WHERE pm.product_unit_id = ?
       ORDER BY pm.performed_at DESC`
    ).bind(id).all(),
  ])
  if (!unit) return c.json({ error: 'Not found' }, 404)
  return c.json({ data: { ...unit, holders: holders.results, movements: movements.results } })
})

// 유닛 등록 (입고)
products.post('/units', async (c) => {
  const b = await c.req.json()
  const userId = c.get('userId')
  if (!b.product_id) return c.json({ error: 'product_id is required' }, 400)
  const r = await c.env.DB.prepare(
    `INSERT INTO product_units (product_id, serial_no, asset_code, status, acquired_at, notes)
     VALUES (?, ?, ?, 'in_stock', ?, ?)`
  ).bind(
    b.product_id,
    b.serial_no || null,
    b.asset_code || null,
    b.acquired_at || new Date().toISOString().slice(0, 10),
    b.notes || null,
  ).run()
  const unitId = r.meta.last_row_id as number

  // 입고 이력 기록
  await c.env.DB.prepare(
    `INSERT INTO product_movements (product_unit_id, movement_type, quantity, reason, performed_by)
     VALUES (?, 'inbound', 1, ?, ?)`
  ).bind(unitId, b.reason || '신규 입고', userId).run()

  // 초기 보유자 지정 (선택)
  if (Array.isArray(b.holder_user_ids) && b.holder_user_ids.length > 0) {
    for (const uid of b.holder_user_ids) {
      await c.env.DB.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id) VALUES (?, ?)`
      ).bind(unitId, uid).run()
      await c.env.DB.prepare(
        `INSERT INTO product_movements (product_unit_id, movement_type, to_user_id, reason, performed_by)
         VALUES (?, 'assign', ?, '초기 보유자 지정', ?)`
      ).bind(unitId, uid, userId).run()
    }
  }

  await logActivity(c.env.DB, 'create', 'product_unit', unitId, `유닛 #${unitId} 입고`)
  return c.json({ data: { id: unitId } }, 201)
})

// 유닛 수정
products.put('/units/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  await c.env.DB.prepare(
    `UPDATE product_units
     SET serial_no=?, asset_code=?, notes=?, acquired_at=?, status=COALESCE(?, status), updated_at=CURRENT_TIMESTAMP
     WHERE id=?`
  ).bind(b.serial_no || null, b.asset_code || null, b.notes || null, b.acquired_at || null, b.status || null, id).run()
  return c.json({ data: { id: Number(id) } })
})

// 다량 입고 — 시리얼번호 여러개를 한 번에 입고
// body: { product_id, serial_nos: string[], asset_codes?: string[], acquired_at?, notes?, holder_user_ids? }
products.post('/units/bulk', async (c) => {
  const b = await c.req.json()
  const userId = c.get('userId')
  if (!b.product_id) return c.json({ error: 'product_id is required' }, 400)
  const serialNos: string[] = Array.isArray(b.serial_nos)
    ? b.serial_nos.map((s: any) => String(s || '').trim()).filter((s: string) => s)
    : []
  const assetCodes: string[] = Array.isArray(b.asset_codes)
    ? b.asset_codes.map((s: any) => String(s || '').trim())
    : []
  if (!serialNos.length) return c.json({ error: 'serial_nos array is required (at least 1)' }, 400)

  const acquiredAt = b.acquired_at || new Date().toISOString().slice(0, 10)
  const notes = b.notes || null
  const reason = b.reason || '신규 입고 (다량)'
  const holderIds: number[] = Array.isArray(b.holder_user_ids)
    ? b.holder_user_ids.map((x: any) => Number(x)).filter((x: number) => x > 0)
    : []

  const created: number[] = []
  const skipped: { serial_no: string, reason: string }[] = []

  for (let i = 0; i < serialNos.length; i++) {
    const sn = serialNos[i]
    const ac = assetCodes[i] || null
    // 중복 시리얼번호 체크 (동일 product_id 내)
    const dup = await c.env.DB.prepare(
      `SELECT id FROM product_units WHERE product_id = ? AND serial_no = ? LIMIT 1`
    ).bind(b.product_id, sn).first()
    if (dup) { skipped.push({ serial_no: sn, reason: '중복 시리얼번호' }); continue }

    const r = await c.env.DB.prepare(
      `INSERT INTO product_units (product_id, serial_no, asset_code, status, acquired_at, notes)
       VALUES (?, ?, ?, 'in_stock', ?, ?)`
    ).bind(b.product_id, sn, ac, acquiredAt, notes).run()
    const unitId = r.meta.last_row_id as number
    created.push(unitId)

    // 입고 이력
    await c.env.DB.prepare(
      `INSERT INTO product_movements (product_unit_id, movement_type, quantity, reason, performed_by)
       VALUES (?, 'inbound', 1, ?, ?)`
    ).bind(unitId, reason, userId).run()

    // 초기 보유자
    for (const uid of holderIds) {
      await c.env.DB.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id) VALUES (?, ?)`
      ).bind(unitId, uid).run()
      await c.env.DB.prepare(
        `INSERT INTO product_movements (product_unit_id, movement_type, to_user_id, reason, performed_by)
         VALUES (?, 'assign', ?, '초기 보유자 지정', ?)`
      ).bind(unitId, uid, userId).run()
    }
  }

  await logActivity(c.env.DB, 'create', 'product_unit', 0, `다량 입고: ${created.length}건 (스킵 ${skipped.length}건)`)
  return c.json({ data: { created_count: created.length, created_ids: created, skipped } }, 201)
})

// 유닛 보유자 일괄 수정 — 활성 보유자 전체를 새 목록으로 교체
// body: { user_ids: number[], reason?: string }
products.put('/units/:id/holders', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json()
  const userId = c.get('userId')
  const newHolderIds: number[] = Array.isArray(b.user_ids)
    ? b.user_ids.map((x: any) => Number(x)).filter((x: number) => x > 0)
    : []
  const reason = b.reason || '보유자 수정'

  // 현재 활성 보유자 조회
  const currentR = await c.env.DB.prepare(
    `SELECT user_id FROM product_holders WHERE product_unit_id=? AND released_at IS NULL`
  ).bind(id).all()
  const currentIds: number[] = (currentR.results as any[]).map(r => Number(r.user_id))
  const currentSet = new Set(currentIds)
  const newSet = new Set(newHolderIds)
  const toRemove = currentIds.filter(x => !newSet.has(x))
  const toAdd = newHolderIds.filter(x => !currentSet.has(x))

  // 제거 (release)
  for (const uid of toRemove) {
    await c.env.DB.prepare(
      `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND user_id=? AND released_at IS NULL`
    ).bind(id, uid).run()
    await c.env.DB.prepare(
      `INSERT INTO product_movements (product_unit_id, movement_type, from_user_id, reason, performed_by)
       VALUES (?, 'release', ?, ?, ?)`
    ).bind(id, uid, reason, userId).run()
  }
  // 추가 (assign)
  for (const uid of toAdd) {
    await c.env.DB.prepare(
      `INSERT INTO product_holders (product_unit_id, user_id, notes) VALUES (?, ?, ?)`
    ).bind(id, uid, reason).run()
    await c.env.DB.prepare(
      `INSERT INTO product_movements (product_unit_id, movement_type, to_user_id, reason, performed_by)
       VALUES (?, 'assign', ?, ?, ?)`
    ).bind(id, uid, reason, userId).run()
  }

  // 보유자 변경에 따라 유닛 상태 자동 조정
  // - 새 보유자가 있고 현재 상태가 in_stock → with_user
  // - 새 보유자가 없고 현재 상태가 with_user → in_stock
  const unit = await c.env.DB.prepare(`SELECT status, current_hospital_id FROM product_units WHERE id=?`).bind(id).first<any>()
  if (unit) {
    if (newHolderIds.length > 0 && unit.status === 'in_stock') {
      await c.env.DB.prepare(`UPDATE product_units SET status='with_user', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    } else if (newHolderIds.length === 0 && unit.status === 'with_user' && !unit.current_hospital_id) {
      await c.env.DB.prepare(`UPDATE product_units SET status='in_stock', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id).run()
    }
  }

  await logActivity(c.env.DB, 'update', 'product_unit', id, `보유자 수정: 추가 ${toAdd.length} / 제거 ${toRemove.length}`)
  return c.json({ data: { id, added: toAdd, removed: toRemove } })
})

// 유닛 삭제 (영구 — 폐기와는 다름; 보통은 movement_type='retire' 사용 권장)
products.delete('/units/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM product_units WHERE id=?').bind(id).run()
  return c.json({ data: { id: Number(id) } })
})

// ============================================================
// 이동(입출고) 처리 — 트랜잭션 (유닛 상태 + 보유자 + movement 동시 갱신)
// ============================================================
products.post('/movements', async (c) => {
  const b = await c.req.json()
  const userId = c.get('userId')
  if (!b.product_unit_id || !b.movement_type) {
    return c.json({ error: 'product_unit_id and movement_type are required' }, 400)
  }
  const unitId = Number(b.product_unit_id)
  const type = b.movement_type as string
  const isLoan = b.is_loan ? 1 : 0
  const hospitalId = b.hospital_id || null
  const doctorId = b.doctor_id || null
  const meetingId = b.meeting_id || null
  const toUserId = b.to_user_id || null
  const fromUserId = b.from_user_id || null

  // 1) movement 기록
  const movRes = await c.env.DB.prepare(
    `INSERT INTO product_movements
      (product_unit_id, movement_type, from_user_id, to_user_id, hospital_id, doctor_id,
       meeting_id, is_loan, expected_return_date, actual_return_date, quantity, reason, performed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    unitId, type, fromUserId, toUserId, hospitalId, doctorId,
    meetingId, isLoan,
    b.expected_return_date || null,
    b.actual_return_date || null,
    b.quantity || 1,
    b.reason || null,
    userId
  ).run()
  const movementId = movRes.meta.last_row_id

  // 2) 유닛 상태/위치 갱신
  if (type === 'checkout') {
    // 대여 반출 (외부)
    await c.env.DB.prepare(
      `UPDATE product_units SET status=?, current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(hospitalId ? 'at_hospital' : 'with_user', hospitalId, unitId).run()
    // 보유자 추가
    if (toUserId) {
      await c.env.DB.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id, notes) VALUES (?, ?, ?)`
      ).bind(unitId, toUserId, b.reason || '반출').run()
    }
  } else if (type === 'deliver') {
    // 영구 납품 (회수 안 함)
    await c.env.DB.prepare(
      `UPDATE product_units SET status='delivered', current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(hospitalId, unitId).run()
    // 모든 보유자 해제
    await c.env.DB.prepare(
      `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND released_at IS NULL`
    ).bind(unitId).run()
  } else if (type === 'return') {
    // 회수 (재고로 복귀)
    await c.env.DB.prepare(
      `UPDATE product_units SET status='in_stock', current_hospital_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(unitId).run()
    // 모든 활성 보유자 해제 (또는 from_user_id 지정 시 그 사람만)
    if (fromUserId) {
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND user_id=? AND released_at IS NULL`
      ).bind(unitId, fromUserId).run()
    } else {
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND released_at IS NULL`
      ).bind(unitId).run()
    }
    // 직전 대여 movement의 actual_return_date 갱신
    await c.env.DB.prepare(
      `UPDATE product_movements
       SET actual_return_date = COALESCE(?, date('now','+9 hours'))
       WHERE id = (
         SELECT id FROM product_movements
         WHERE product_unit_id=? AND is_loan=1 AND actual_return_date IS NULL
         ORDER BY performed_at DESC LIMIT 1
       )`
    ).bind(b.actual_return_date || null, unitId).run()
  } else if (type === 'demo') {
    // 시연 후 복귀 (상태는 in_stock 유지, 이력만 기록)
    // 별도 상태 변경 없음
  } else if (type === 'transfer') {
    // 담당자 이전 (from → to)
    if (fromUserId) {
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND user_id=? AND released_at IS NULL`
      ).bind(unitId, fromUserId).run()
    }
    if (toUserId) {
      await c.env.DB.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id, notes) VALUES (?, ?, ?)`
      ).bind(unitId, toUserId, b.reason || '담당자 이전').run()
    }
  } else if (type === 'assign') {
    // 보유자 추가 (공유)
    if (toUserId) {
      await c.env.DB.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id, notes) VALUES (?, ?, ?)`
      ).bind(unitId, toUserId, b.reason || '보유자 추가').run()
    }
  } else if (type === 'release') {
    // 특정 보유자 해제
    if (fromUserId) {
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND user_id=? AND released_at IS NULL`
      ).bind(unitId, fromUserId).run()
    }
  } else if (type === 'lost') {
    await c.env.DB.prepare(`UPDATE product_units SET status='lost', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(unitId).run()
  } else if (type === 'repair') {
    await c.env.DB.prepare(`UPDATE product_units SET status='repair', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(unitId).run()
  } else if (type === 'retire') {
    await c.env.DB.prepare(`UPDATE product_units SET status='retired', current_hospital_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(unitId).run()
    await c.env.DB.prepare(
      `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND released_at IS NULL`
    ).bind(unitId).run()
  }

  // 3) 미팅 자동 연계 — meeting_products에 매핑 추가
  if (meetingId) {
    const mpAction = type === 'demo' ? 'demo'
      : type === 'deliver' ? 'deliver'
      : type === 'checkout' ? 'checkout'
      : type === 'return' ? 'return' : null
    if (mpAction) {
      await c.env.DB.prepare(
        `INSERT INTO meeting_products (meeting_id, product_unit_id, action, notes) VALUES (?, ?, ?, ?)`
      ).bind(meetingId, unitId, mpAction, b.reason || null).run()
    }
  }

  await logActivity(c.env.DB, 'create', 'product_movement', movementId as number, `${type} 처리`)
  return c.json({ data: { id: movementId } }, 201)
})

// 이동 이력 목록 (필터링)
products.get('/movements', async (c) => {
  const { from, to, type, hospital_id, user_id, unit_id, meeting_id } = c.req.query()
  const conds: string[] = []
  const params: any[] = []
  if (from) { conds.push('DATE(pm.performed_at) >= ?'); params.push(from) }
  if (to) { conds.push('DATE(pm.performed_at) <= ?'); params.push(to) }
  if (type) { conds.push('pm.movement_type = ?'); params.push(type) }
  if (hospital_id) { conds.push('pm.hospital_id = ?'); params.push(hospital_id) }
  if (user_id) { conds.push('(pm.from_user_id = ? OR pm.to_user_id = ?)'); params.push(user_id, user_id) }
  if (unit_id) { conds.push('pm.product_unit_id = ?'); params.push(unit_id) }
  if (meeting_id) { conds.push('pm.meeting_id = ?'); params.push(meeting_id) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await c.env.DB.prepare(
    `SELECT pm.*,
       p.category, p.model, p.name as product_name,
       pu.serial_no, pu.asset_code,
       h.name as hospital_name,
       d.name as doctor_name,
       fu.name as from_user_name, tu.name as to_user_name,
       per.name as performed_by_name,
       m.meeting_date
     FROM product_movements pm
     JOIN product_units pu ON pu.id = pm.product_unit_id
     JOIN products p ON p.id = pu.product_id
     LEFT JOIN hospitals h ON h.id = pm.hospital_id
     LEFT JOIN doctors d ON d.id = pm.doctor_id
     LEFT JOIN users fu ON fu.id = pm.from_user_id
     LEFT JOIN users tu ON tu.id = pm.to_user_id
     LEFT JOIN users per ON per.id = pm.performed_by
     LEFT JOIN meetings m ON m.id = pm.meeting_id
     ${where}
     ORDER BY pm.performed_at DESC
     LIMIT 500`
  ).bind(...params).all()
  return c.json({ data: r.results })
})

// 영업담당자별 보유 현황
products.get('/by-user', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT u.id as user_id, u.name as user_name,
       COUNT(DISTINCT ph.product_unit_id) as holding_count,
       GROUP_CONCAT(DISTINCT p.name) as product_names
     FROM users u
     LEFT JOIN product_holders ph ON ph.user_id = u.id AND ph.released_at IS NULL
     LEFT JOIN product_units pu ON pu.id = ph.product_unit_id
     LEFT JOIN products p ON p.id = pu.product_id
     GROUP BY u.id
     HAVING holding_count > 0
     ORDER BY holding_count DESC, u.name`
  ).all()
  return c.json({ data: r.results })
})

// 기관에 있는 데모기 목록
products.get('/by-hospital/:id', async (c) => {
  const id = c.req.param('id')
  const r = await c.env.DB.prepare(
    `SELECT pu.*, p.name as product_name, p.category, p.model
     FROM product_units pu
     JOIN products p ON p.id = pu.product_id
     WHERE pu.current_hospital_id = ? AND pu.status IN ('at_hospital','delivered','out')
     ORDER BY pu.updated_at DESC`
  ).bind(id).all()
  return c.json({ data: r.results })
})

// 미팅에서 동반 반출된 제품 목록
products.get('/by-meeting/:id', async (c) => {
  const id = c.req.param('id')
  const r = await c.env.DB.prepare(
    `SELECT mp.*, pu.serial_no, pu.asset_code, pu.status,
       p.name as product_name, p.category, p.model
     FROM meeting_products mp
     JOIN product_units pu ON pu.id = mp.product_unit_id
     JOIN products p ON p.id = pu.product_id
     WHERE mp.meeting_id = ?
     ORDER BY mp.created_at DESC`
  ).bind(id).all()
  return c.json({ data: r.results })
})

// ============================================================
// 미팅에서 동반 반출 가능한 유닛 (현재 사용자가 보유 중인 + 재고)
// ============================================================
products.get('/available-for-meeting', async (c) => {
  const userId = c.get('userId')
  const r = await c.env.DB.prepare(
    `SELECT pu.id, pu.serial_no, pu.asset_code, pu.status,
       p.category, p.model, p.name as product_name,
       (SELECT GROUP_CONCAT(u.name, ', ') FROM product_holders ph
        LEFT JOIN users u ON u.id = ph.user_id
        WHERE ph.product_unit_id = pu.id AND ph.released_at IS NULL) as holders,
       (CASE WHEN EXISTS (SELECT 1 FROM product_holders ph2
          WHERE ph2.product_unit_id = pu.id AND ph2.user_id = ? AND ph2.released_at IS NULL)
        THEN 1 ELSE 0 END) as is_mine
     FROM product_units pu
     JOIN products p ON p.id = pu.product_id
     WHERE pu.status IN ('in_stock','with_user','at_hospital','out')
     ORDER BY is_mine DESC, p.category, p.model, pu.asset_code`
  ).bind(userId).all()
  return c.json({ data: r.results })
})

// 미팅-제품 일괄 연결 (미팅 폼에서 선택한 유닛들을 동반 반출로 기록)
products.post('/link-to-meeting', async (c) => {
  const b = await c.req.json()
  const userId = c.get('userId')
  const meetingId = Number(b.meeting_id)
  const action = (b.action || 'demo') as string // demo | checkout | deliver
  const isLoan = b.is_loan ? 1 : 0
  const unitIds: number[] = Array.isArray(b.product_unit_ids) ? b.product_unit_ids.map(Number) : []
  if (!meetingId || !unitIds.length) {
    return c.json({ error: 'meeting_id and product_unit_ids are required' }, 400)
  }
  // 미팅 정보 (hospital_id, doctor_ids 조회)
  const meet = await c.env.DB.prepare(
    `SELECT m.id, m.hospital_id,
       (SELECT md.doctor_id FROM meeting_doctors md WHERE md.meeting_id = m.id LIMIT 1) as doctor_id
     FROM meetings m WHERE m.id = ?`
  ).bind(meetingId).first<any>()
  if (!meet) return c.json({ error: 'Meeting not found' }, 404)

  const linked: number[] = []
  for (const unitId of unitIds) {
    // 중복 체크
    const exists = await c.env.DB.prepare(
      `SELECT id FROM meeting_products WHERE meeting_id=? AND product_unit_id=?`
    ).bind(meetingId, unitId).first()
    if (exists) continue
    // meeting_products 매핑 추가
    await c.env.DB.prepare(
      `INSERT INTO meeting_products (meeting_id, product_unit_id, action, notes) VALUES (?, ?, ?, ?)`
    ).bind(meetingId, unitId, action, b.notes || null).run()
    // movement 기록
    const movType = action === 'deliver' ? 'deliver' : action === 'checkout' ? 'checkout' : 'demo'
    await c.env.DB.prepare(
      `INSERT INTO product_movements
        (product_unit_id, movement_type, hospital_id, doctor_id, meeting_id, is_loan, reason, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(unitId, movType, meet.hospital_id || null, meet.doctor_id || null, meetingId, isLoan, b.notes || '미팅 동반 반출', userId).run()
    // 유닛 상태/위치 갱신
    if (action === 'deliver') {
      await c.env.DB.prepare(
        `UPDATE product_units SET status='delivered', current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(meet.hospital_id || null, unitId).run()
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND released_at IS NULL`
      ).bind(unitId).run()
    } else if (action === 'checkout') {
      await c.env.DB.prepare(
        `UPDATE product_units SET status=?, current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(meet.hospital_id ? 'at_hospital' : 'with_user', meet.hospital_id || null, unitId).run()
    }
    linked.push(unitId)
  }
  return c.json({ data: { linked_count: linked.length, unit_ids: linked } }, 201)
})

// 미팅-제품 연결 해제
products.delete('/meeting-product/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM meeting_products WHERE id=?').bind(id).run()
  return c.json({ data: { id: Number(id) } })
})

// ============================================================
// 이동 이력 CSV 내보내기
// ============================================================
products.get('/movements/export.csv', async (c) => {
  const { from, to, type, hospital_id } = c.req.query()
  const conds: string[] = []
  const params: any[] = []
  if (from) { conds.push('DATE(pm.performed_at) >= ?'); params.push(from) }
  if (to) { conds.push('DATE(pm.performed_at) <= ?'); params.push(to) }
  if (type) { conds.push('pm.movement_type = ?'); params.push(type) }
  if (hospital_id) { conds.push('pm.hospital_id = ?'); params.push(hospital_id) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await c.env.DB.prepare(
    `SELECT pm.performed_at, pm.movement_type, p.category, p.model, p.name as product_name,
       pu.serial_no, pu.asset_code,
       h.name as hospital_name, d.name as doctor_name,
       fu.name as from_user_name, tu.name as to_user_name,
       per.name as performed_by_name,
       pm.is_loan, pm.expected_return_date, pm.actual_return_date,
       pm.reason
     FROM product_movements pm
     JOIN product_units pu ON pu.id = pm.product_unit_id
     JOIN products p ON p.id = pu.product_id
     LEFT JOIN hospitals h ON h.id = pm.hospital_id
     LEFT JOIN doctors d ON d.id = pm.doctor_id
     LEFT JOIN users fu ON fu.id = pm.from_user_id
     LEFT JOIN users tu ON tu.id = pm.to_user_id
     LEFT JOIN users per ON per.id = pm.performed_by
     ${where}
     ORDER BY pm.performed_at DESC
     LIMIT 5000`
  ).bind(...params).all()
  const rows: any[] = r.results as any[]
  const header = ['일시','이동유형','카테고리','모델','제품명','S/N','자산코드','병원','의사','반출자','반입자','처리자','대여여부','반환예정일','실반환일','비고']
  const csv = [header.join(',')].concat(
    rows.map(row => {
      const cells = [
        row.performed_at || '',
        row.movement_type || '',
        row.category || '',
        row.model || '',
        row.product_name || '',
        row.serial_no || '',
        row.asset_code || '',
        row.hospital_name || '',
        row.doctor_name || '',
        row.from_user_name || '',
        row.to_user_name || '',
        row.performed_by_name || '',
        row.is_loan ? '대여' : '영구',
        row.expected_return_date || '',
        row.actual_return_date || '',
        (row.reason || '').toString().replace(/"/g, '""'),
      ]
      return cells.map(v => {
        const s = String(v ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    })
  ).join('\n')
  // UTF-8 BOM for Excel
  return new Response('\uFEFF' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="product_movements_${new Date().toISOString().slice(0,10)}.csv"`,
    }
  })
})

export default products
