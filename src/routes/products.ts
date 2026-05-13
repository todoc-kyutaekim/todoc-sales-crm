import { Hono } from 'hono'
import { logActivity, safeLike } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const products = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// 재고(in_stock) 상태의 기본 보유자: 김규태(id=3), 도재민(id=4)
const DEFAULT_STOCK_HOLDERS: number[] = [3, 4]

// 유닛이 in_stock 상태일 때 기본 보유자(김규태/도재민)가 활성 상태로 존재하도록 보장
async function ensureDefaultStockHolders(db: D1Database, unitId: number) {
  for (const uid of DEFAULT_STOCK_HOLDERS) {
    const existing = await db.prepare(
      `SELECT id FROM product_holders WHERE product_unit_id=? AND user_id=? AND released_at IS NULL LIMIT 1`
    ).bind(unitId, uid).first()
    if (!existing) {
      await db.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id, notes) VALUES (?, ?, '재고 기본 보유자 자동 지정')`
      ).bind(unitId, uid).run()
    }
  }
}

// ============================================================
// 제품 마스터: 카테고리/모델 정의 (카테고리별 비고 description 포함)
// ============================================================
products.get('/', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT p.*,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id) as total_count,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.status = 'in_stock') as in_stock_count,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.status IN ('at_hospital','out')) as out_count,
      (SELECT COUNT(*) FROM product_units pu WHERE pu.product_id = p.id AND pu.status = 'delivered') as delivered_count
     FROM products p
     WHERE p.active = 1
     ORDER BY
       CASE p.category WHEN 'internal' THEN 1 WHEN 'external' THEN 2 WHEN 'carry_case' THEN 3 ELSE 4 END,
       p.model`
  ).all()
  return c.json({ data: r.results })
})

// 카테고리/모델별 비고(description) + 표시명(name) + 모델명(model_code) 수정
products.put('/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  // model_code: 명시적으로 빈 문자열로 보내면 NULL 처리
  const modelCode = b.model_code === undefined ? undefined
    : (String(b.model_code).trim() || null)
  await c.env.DB.prepare(
    `UPDATE products SET
       description = COALESCE(?, description),
       name        = COALESCE(?, name),
       model_code  = CASE WHEN ? = 1 THEN ? ELSE model_code END,
       updated_at  = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    b.description != null ? b.description : null,
    b.name != null && b.name !== '' ? b.name : null,
    modelCode === undefined ? 0 : 1,
    modelCode === undefined ? null : modelCode,
    id
  ).run()
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
        SUM(CASE WHEN pu.status IN ('at_hospital','out') THEN 1 ELSE 0 END) as out,
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
        SUM(CASE WHEN status IN ('at_hospital','out') THEN 1 ELSE 0 END) as out,
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

  // 시리얼번호 중복 체크 (있을 때만, 같은 제품 내에서만)
  // 카테고리/모델별 시리얼 체계가 다르므로 product_id 스코프로만 체크
  const sn = (b.serial_no || '').trim()
  if (sn) {
    const dup = await c.env.DB.prepare(
      `SELECT id FROM product_units WHERE product_id = ? AND serial_no = ? LIMIT 1`
    ).bind(b.product_id, sn).first()
    if (dup) return c.json({ error: '이미 등록된 시리얼번호입니다 (해당 제품 내)', code: 'DUPLICATE_SERIAL' }, 409)
  }

  // 자산코드 미입력 시 제품의 model_code 자동 적용
  let assetCode: string | null = (b.asset_code || '').trim() || null
  if (!assetCode) {
    const prod = await c.env.DB.prepare(`SELECT model_code FROM products WHERE id = ?`).bind(b.product_id).first<any>()
    if (prod && prod.model_code) assetCode = String(prod.model_code).trim() || null
  }

  const holderIds: number[] = Array.isArray(b.holder_user_ids)
    ? b.holder_user_ids.map((x: any) => Number(x)).filter((x: number) => x > 0)
    : []
  // 신규 입고는 항상 in_stock(재고) 상태로 진입 (담당자 보유 상태 폐기)
  const initStatus = 'in_stock'

  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO product_units (product_id, serial_no, asset_code, status, acquired_at, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      b.product_id,
      sn || null,
      assetCode,
      initStatus,
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
    for (const uid of holderIds) {
      await c.env.DB.prepare(
        `INSERT INTO product_holders (product_unit_id, user_id) VALUES (?, ?)`
      ).bind(unitId, uid).run()
      await c.env.DB.prepare(
        `INSERT INTO product_movements (product_unit_id, movement_type, to_user_id, reason, performed_by)
         VALUES (?, 'assign', ?, '초기 보유자 지정', ?)`
      ).bind(unitId, uid, userId).run()
    }

    // 재고 상태이므로 기본 보유자(김규태/도재민)를 자동 추가 (사용자 지정 보유자와 중복 시 스킵)
    await ensureDefaultStockHolders(c.env.DB, unitId)

    await logActivity(c.env.DB, 'create', 'product_unit', unitId, `유닛 #${unitId} 입고`)
    return c.json({ data: { id: unitId } }, 201)
  } catch (e: any) {
    const msg = String(e?.message || e || 'unknown error')
    if (/UNIQUE|constraint/i.test(msg)) {
      return c.json({ error: '이미 등록된 시리얼번호입니다', code: 'DUPLICATE_SERIAL' }, 409)
    }
    return c.json({ error: msg }, 500)
  }
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

  // 시리얼번호 정규화 + 배치 내 중복 사전 제거 (먼저 입력된 것 우선)
  const rawSerials: string[] = Array.isArray(b.serial_nos)
    ? b.serial_nos.map((s: any) => String(s || '').trim()).filter((s: string) => s)
    : []
  const rawAssetCodes: string[] = Array.isArray(b.asset_codes)
    ? b.asset_codes.map((s: any) => String(s || '').trim())
    : []
  const seenInBatch = new Set<string>()
  const serialNos: string[] = []
  const assetCodes: string[] = []
  const preDupSerials: string[] = []
  for (let i = 0; i < rawSerials.length; i++) {
    const s = rawSerials[i]
    const key = s.toLowerCase()
    if (seenInBatch.has(key)) { preDupSerials.push(s); continue }
    seenInBatch.add(key)
    serialNos.push(s)
    assetCodes.push(rawAssetCodes[i] || '')
  }
  if (!serialNos.length) return c.json({ error: 'serial_nos array is required (at least 1)' }, 400)

  const acquiredAt = b.acquired_at || new Date().toISOString().slice(0, 10)
  const notes = b.notes || null
  const reason = b.reason || '신규 입고 (다량)'
  const holderIds: number[] = Array.isArray(b.holder_user_ids)
    ? b.holder_user_ids.map((x: any) => Number(x)).filter((x: number) => x > 0)
    : []

  // 제품의 model_code 조회 (asset_code 미입력 시 자동 적용)
  const prod = await c.env.DB.prepare(`SELECT model_code FROM products WHERE id = ?`).bind(b.product_id).first<any>()
  const defaultAssetCode: string | null = prod && prod.model_code ? String(prod.model_code).trim() || null : null

  const created: number[] = []
  const skipped: { serial_no: string, reason: string }[] = []
  // 배치 입력 내부의 중복은 미리 스킵 목록에 추가
  for (const s of preDupSerials) skipped.push({ serial_no: s, reason: '입력 내 중복 시리얼' })

  // 신규 입고는 항상 in_stock(재고) 상태로 진입 (담당자 보유 상태 폐기)
  const initStatus = 'in_stock'

  for (let i = 0; i < serialNos.length; i++) {
    const sn = serialNos[i]
    const ac = (assetCodes[i] || '').trim() || defaultAssetCode
    try {
      // 같은 제품 내 중복 시리얼번호 체크
      // (카테고리/모델별 시리얼 체계가 달라 전역이 아니라 제품 스코프로만 체크)
      const dup = await c.env.DB.prepare(
        `SELECT id FROM product_units WHERE product_id = ? AND serial_no = ? LIMIT 1`
      ).bind(b.product_id, sn).first()
      if (dup) { skipped.push({ serial_no: sn, reason: '이미 등록된 시리얼번호' }); continue }

      const r = await c.env.DB.prepare(
        `INSERT INTO product_units (product_id, serial_no, asset_code, status, acquired_at, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(b.product_id, sn, ac, initStatus, acquiredAt, notes).run()
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

      // 재고 상태이므로 기본 보유자(김규태/도재민) 자동 추가
      await ensureDefaultStockHolders(c.env.DB, unitId)
    } catch (e: any) {
      const msg = String(e?.message || e || 'unknown error')
      // UNIQUE 충돌 등은 중복으로 처리하고 계속 진행
      if (/UNIQUE|constraint/i.test(msg)) {
        skipped.push({ serial_no: sn, reason: '이미 등록된 시리얼번호' })
      } else {
        skipped.push({ serial_no: sn, reason: msg.slice(0, 200) })
      }
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

  // '담당자 보유' 상태(with_user) 폐기: in_stock 상태에서는 보유자 유무와 무관하게 상태 유지
  // at_hospital 상태에서 보유자 변경은 "현장 담당자 인계"로 보고 상태는 유지
  // 재고 상태이면 기본 보유자(김규태/도재민) 자동 보장
  const unit = await c.env.DB.prepare(`SELECT status FROM product_units WHERE id=?`).bind(id).first<any>()
  if (unit && unit.status === 'in_stock') {
    await ensureDefaultStockHolders(c.env.DB, id)
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
    // 대여 반출 — 기관 있으면 at_hospital, 없으면 out(외부)
    await c.env.DB.prepare(
      `UPDATE product_units SET status=?, current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(hospitalId ? 'at_hospital' : 'out', hospitalId, unitId).run()
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
    // 재고 복귀 시 기본 보유자(김규태/도재민) 자동 추가
    await ensureDefaultStockHolders(c.env.DB, unitId)
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
     WHERE pu.status IN ('in_stock','at_hospital','out')
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
      ).bind(meet.hospital_id ? 'at_hospital' : 'out', meet.hospital_id || null, unitId).run()
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
// 미팅 동반 반출 — 세트 단위
// ============================================================

// 동반 반출 가능한 세트 (in_stock 또는 mixed — 구성 유닛이 있는 활성 세트)
products.get('/available-sets-for-meeting', async (c) => {
  const userId = c.get('userId')
  const r = await c.env.DB.prepare(
    `SELECT s.id, s.name, s.description, s.status,
       (SELECT COUNT(*) FROM product_set_items si
         WHERE si.set_id = s.id AND si.removed_at IS NULL) AS unit_count,
       (SELECT GROUP_CONCAT(p.category || ':' || COALESCE(pu.asset_code, pu.serial_no, '#'||pu.id), ' / ')
          FROM product_set_items si
          JOIN product_units pu ON pu.id = si.product_unit_id
          JOIN products p ON p.id = pu.product_id
         WHERE si.set_id = s.id AND si.removed_at IS NULL) AS composition,
       (SELECT GROUP_CONCAT(DISTINCT p.category)
          FROM product_set_items si
          JOIN product_units pu ON pu.id = si.product_unit_id
          JOIN products p ON p.id = pu.product_id
         WHERE si.set_id = s.id AND si.removed_at IS NULL) AS categories,
       (SELECT COUNT(DISTINCT ph.user_id) FROM product_set_items si
          JOIN product_holders ph ON ph.product_unit_id = si.product_unit_id
         WHERE si.set_id = s.id AND si.removed_at IS NULL
           AND ph.user_id = ? AND ph.released_at IS NULL) AS my_holder_count
     FROM product_sets s
     WHERE s.status IN ('in_stock','at_hospital','out')
     ORDER BY s.created_at DESC`
  ).bind(userId).all()
  return c.json({ data: r.results })
})

// 미팅에 세트 통째로 연결 — 세트 구성 유닛들을 한 번에 meeting_products 에 추가
// body: { meeting_id, set_ids: number[], action?, is_loan?, notes? }
products.post('/link-sets-to-meeting', async (c) => {
  const b = await c.req.json()
  const userId = c.get('userId')
  const meetingId = Number(b.meeting_id)
  const action = (b.action || 'demo') as string // demo | checkout | deliver
  const isLoan = b.is_loan ? 1 : 0
  const setIds: number[] = Array.isArray(b.set_ids) ? b.set_ids.map(Number).filter((x: number) => x > 0) : []
  if (!meetingId || !setIds.length) {
    return c.json({ error: 'meeting_id and set_ids are required' }, 400)
  }
  const meet = await c.env.DB.prepare(
    `SELECT m.id, m.hospital_id,
       (SELECT md.doctor_id FROM meeting_doctors md WHERE md.meeting_id = m.id LIMIT 1) as doctor_id
     FROM meetings m WHERE m.id = ?`
  ).bind(meetingId).first<any>()
  if (!meet) return c.json({ error: 'Meeting not found' }, 404)

  const linkedSets: { set_id: number, set_name: string, linked_units: number, skipped_units: number }[] = []
  let totalLinkedUnits = 0

  for (const setId of setIds) {
    // 세트 정보 + 활성 구성 유닛 조회
    const setInfo = await c.env.DB.prepare(`SELECT id, name FROM product_sets WHERE id = ?`).bind(setId).first<any>()
    if (!setInfo) continue
    const itemR = await c.env.DB.prepare(
      `SELECT pu.id AS unit_id
         FROM product_set_items si
         JOIN product_units pu ON pu.id = si.product_unit_id
        WHERE si.set_id = ? AND si.removed_at IS NULL`
    ).bind(setId).all()
    const unitIds: number[] = (itemR.results as any[]).map(r => Number(r.unit_id))
    if (!unitIds.length) {
      linkedSets.push({ set_id: setId, set_name: setInfo.name, linked_units: 0, skipped_units: 0 })
      continue
    }

    let linkedCount = 0
    let skippedCount = 0
    const setNotes = `[세트: ${setInfo.name}]` + (b.notes ? ' ' + b.notes : '')
    for (const unitId of unitIds) {
      const exists = await c.env.DB.prepare(
        `SELECT id FROM meeting_products WHERE meeting_id=? AND product_unit_id=?`
      ).bind(meetingId, unitId).first()
      if (exists) { skippedCount++; continue }
      await c.env.DB.prepare(
        `INSERT INTO meeting_products (meeting_id, product_unit_id, action, notes) VALUES (?, ?, ?, ?)`
      ).bind(meetingId, unitId, action, setNotes).run()
      const movType = action === 'deliver' ? 'deliver' : action === 'checkout' ? 'checkout' : 'demo'
      await c.env.DB.prepare(
        `INSERT INTO product_movements
          (product_unit_id, movement_type, hospital_id, doctor_id, meeting_id, is_loan, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(unitId, movType, meet.hospital_id || null, meet.doctor_id || null, meetingId, isLoan, setNotes, userId).run()
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
        ).bind(meet.hospital_id ? 'at_hospital' : 'out', meet.hospital_id || null, unitId).run()
      }
      linkedCount++
    }

    // 세트 상태 재계산 (구성 유닛 상태 변경 반영)
    // deliver 시에는 세트도 delivered (current_hospital 설정), checkout 시에는 at_hospital/out
    if (action === 'deliver') {
      await c.env.DB.prepare(
        `UPDATE product_sets SET status='delivered', current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(meet.hospital_id || null, setId).run()
    } else if (action === 'checkout') {
      await c.env.DB.prepare(
        `UPDATE product_sets SET status=?, current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(meet.hospital_id ? 'at_hospital' : 'out', meet.hospital_id || null, setId).run()
    } else {
      // demo (시연·회수) — 구성 유닛 상태 그대로, refresh 만 호출
      await refreshSetStatus(c.env.DB, setId)
    }

    linkedSets.push({ set_id: setId, set_name: setInfo.name, linked_units: linkedCount, skipped_units: skippedCount })
    totalLinkedUnits += linkedCount
  }

  return c.json({ data: { linked_sets: linkedSets, total_linked_units: totalLinkedUnits } }, 201)
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
  const header = ['일시','이동유형','카테고리','모델','제품명','S/N','모델명','병원','의사','반출자','반입자','처리자','대여여부','반환예정일','실반환일','비고']
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

// ============================================================
// 제품 세트 (set) — 내부기 + 외부기 + 휴대보관함 등을 묶음 관리
// ============================================================

// 세트 목록 (구성 유닛 요약 포함)
products.get('/sets', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT s.*,
       h.name AS hospital_name,
       u.name AS created_by_name,
       (SELECT COUNT(*) FROM product_set_items si WHERE si.set_id = s.id AND si.removed_at IS NULL) AS unit_count,
       (SELECT GROUP_CONCAT(p.category || ':' || p.model, ',')
          FROM product_set_items si
          JOIN product_units pu ON pu.id = si.product_unit_id
          JOIN products p ON p.id = pu.product_id
         WHERE si.set_id = s.id AND si.removed_at IS NULL) AS composition
     FROM product_sets s
     LEFT JOIN hospitals h ON h.id = s.current_hospital_id
     LEFT JOIN users u ON u.id = s.created_by
     ORDER BY s.created_at DESC`
  ).all()
  return c.json({ data: r.results })
})

// 세트 상세 (구성 유닛 + 보유자 + 상태 포함)
products.get('/sets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const setRow = await c.env.DB.prepare(
    `SELECT s.*, h.name AS hospital_name, u.name AS created_by_name
     FROM product_sets s
     LEFT JOIN hospitals h ON h.id = s.current_hospital_id
     LEFT JOIN users u ON u.id = s.created_by
     WHERE s.id = ?`
  ).bind(id).first<any>()
  if (!setRow) return c.json({ error: 'Not found' }, 404)

  const items = await c.env.DB.prepare(
    `SELECT si.id AS item_id, si.added_at,
            pu.id, pu.serial_no, pu.asset_code, pu.status, pu.acquired_at,
            p.category, p.model, p.name AS product_name,
            (SELECT GROUP_CONCAT(usr.name, ', ')
               FROM product_holders ph
               LEFT JOIN users usr ON usr.id = ph.user_id
              WHERE ph.product_unit_id = pu.id AND ph.released_at IS NULL) AS holders
       FROM product_set_items si
       JOIN product_units pu ON pu.id = si.product_unit_id
       JOIN products p ON p.id = pu.product_id
      WHERE si.set_id = ? AND si.removed_at IS NULL
      ORDER BY CASE p.category WHEN 'internal' THEN 1 WHEN 'external' THEN 2 WHEN 'carry_case' THEN 3 ELSE 4 END`
  ).bind(id).all()
  return c.json({ data: { ...setRow, items: items.results } })
})

// 세트 생성 (유닛 ID 배열을 받아 한 번에 구성)
// body: { name, description?, notes?, unit_ids: number[] }
products.post('/sets', async (c) => {
  const b = await c.req.json()
  const userId = c.get('userId')
  const name = (b.name || '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)
  const unitIds: number[] = Array.isArray(b.unit_ids)
    ? b.unit_ids.map((x: any) => Number(x)).filter((x: number) => x > 0)
    : []
  if (!unitIds.length) return c.json({ error: 'unit_ids must contain at least one unit' }, 400)

  // 이미 다른 활성 세트에 속한 유닛은 거부
  const placeholders = unitIds.map(() => '?').join(',')
  const conflictR = await c.env.DB.prepare(
    `SELECT product_unit_id FROM product_set_items
     WHERE product_unit_id IN (${placeholders}) AND removed_at IS NULL`
  ).bind(...unitIds).all()
  const conflicts: number[] = (conflictR.results as any[]).map(r => Number(r.product_unit_id))
  if (conflicts.length > 0) {
    return c.json({ error: '일부 유닛이 이미 다른 세트에 속해 있습니다', conflicts }, 409)
  }

  const r = await c.env.DB.prepare(
    `INSERT INTO product_sets (name, description, notes, created_by, status) VALUES (?, ?, ?, ?, 'in_stock')`
  ).bind(name, b.description || null, b.notes || null, userId).run()
  const setId = r.meta.last_row_id as number

  for (const uid of unitIds) {
    await c.env.DB.prepare(
      `INSERT INTO product_set_items (set_id, product_unit_id) VALUES (?, ?)`
    ).bind(setId, uid).run()
  }

  // 세트 상태 = 구성 유닛들 상태의 대표값 (모두 같으면 그 값, 다르면 'mixed')
  await refreshSetStatus(c.env.DB, setId)

  await logActivity(c.env.DB, 'create', 'product_set', setId, name)
  return c.json({ data: { id: setId } }, 201)
})

// 세트 수정 (이름/설명/구성 변경)
// body: { name?, description?, notes?, unit_ids?: number[] (제공 시 전체 교체) }
products.put('/sets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json()
  await c.env.DB.prepare(
    `UPDATE product_sets SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       notes = COALESCE(?, notes),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(b.name || null, b.description || null, b.notes || null, id).run()

  if (Array.isArray(b.unit_ids)) {
    const newIds: number[] = b.unit_ids.map((x: any) => Number(x)).filter((x: number) => x > 0)
    const curR = await c.env.DB.prepare(
      `SELECT product_unit_id FROM product_set_items WHERE set_id=? AND removed_at IS NULL`
    ).bind(id).all()
    const curIds: number[] = (curR.results as any[]).map(r => Number(r.product_unit_id))
    const curSet = new Set(curIds)
    const newSet = new Set(newIds)
    const toRemove = curIds.filter(x => !newSet.has(x))
    const toAdd = newIds.filter(x => !curSet.has(x))

    // 추가 대상이 다른 활성 세트에 속해있으면 거부
    if (toAdd.length > 0) {
      const placeholders = toAdd.map(() => '?').join(',')
      const conflictR = await c.env.DB.prepare(
        `SELECT product_unit_id FROM product_set_items
         WHERE product_unit_id IN (${placeholders}) AND removed_at IS NULL AND set_id != ?`
      ).bind(...toAdd, id).all()
      const conflicts: number[] = (conflictR.results as any[]).map(r => Number(r.product_unit_id))
      if (conflicts.length > 0) {
        return c.json({ error: '일부 유닛이 이미 다른 세트에 속해 있습니다', conflicts }, 409)
      }
    }

    for (const uid of toRemove) {
      await c.env.DB.prepare(
        `UPDATE product_set_items SET removed_at=CURRENT_TIMESTAMP WHERE set_id=? AND product_unit_id=? AND removed_at IS NULL`
      ).bind(id, uid).run()
    }
    for (const uid of toAdd) {
      await c.env.DB.prepare(
        `INSERT INTO product_set_items (set_id, product_unit_id) VALUES (?, ?)`
      ).bind(id, uid).run()
    }
  }

  await refreshSetStatus(c.env.DB, id)
  await logActivity(c.env.DB, 'update', 'product_set', id, b.name || `세트 #${id} 수정`)
  return c.json({ data: { id } })
})

// 세트 삭제 (구성 관계만 해제하고 마스터 삭제)
products.delete('/sets/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare(`DELETE FROM product_set_items WHERE set_id=?`).bind(id).run()
  await c.env.DB.prepare(`DELETE FROM product_sets WHERE id=?`).bind(id).run()
  await logActivity(c.env.DB, 'delete', 'product_set', id, `세트 #${id} 삭제`)
  return c.json({ data: { id } })
})

// 세트 단위 이동 (checkout / return / deliver / demo) — 구성 유닛 전체에 동일 동작 적용
// body: { movement_type, hospital_id?, doctor_id?, meeting_id?, to_user_id?, from_user_id?, is_loan?, expected_return_date?, actual_return_date?, reason? }
products.post('/sets/:id/movements', async (c) => {
  const setId = Number(c.req.param('id'))
  const b = await c.req.json()
  const userId = c.get('userId')
  const type = String(b.movement_type || '')
  if (!type) return c.json({ error: 'movement_type is required' }, 400)

  const itemsR = await c.env.DB.prepare(
    `SELECT product_unit_id FROM product_set_items WHERE set_id=? AND removed_at IS NULL`
  ).bind(setId).all()
  const unitIds: number[] = (itemsR.results as any[]).map(r => Number(r.product_unit_id))
  if (!unitIds.length) return c.json({ error: '세트에 포함된 유닛이 없습니다' }, 400)

  const hospitalId = b.hospital_id || null
  const doctorId = b.doctor_id || null
  const meetingId = b.meeting_id || null
  const toUserId = b.to_user_id || null
  const fromUserId = b.from_user_id || null
  const isLoan = b.is_loan ? 1 : 0
  const reason = b.reason || `세트(#${setId}) ${type}`

  const movementIds: number[] = []
  for (const unitId of unitIds) {
    const movRes = await c.env.DB.prepare(
      `INSERT INTO product_movements
        (product_unit_id, movement_type, from_user_id, to_user_id, hospital_id, doctor_id,
         meeting_id, is_loan, expected_return_date, actual_return_date, quantity, reason, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(
      unitId, type, fromUserId, toUserId, hospitalId, doctorId,
      meetingId, isLoan,
      b.expected_return_date || null,
      b.actual_return_date || null,
      reason,
      userId
    ).run()
    movementIds.push(movRes.meta.last_row_id as number)

    // 유닛 상태 갱신 — /movements 핸들러의 핵심 분기와 동일
    if (type === 'checkout') {
      await c.env.DB.prepare(
        `UPDATE product_units SET status=?, current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(hospitalId ? 'at_hospital' : 'out', hospitalId, unitId).run()
      if (toUserId) {
        await c.env.DB.prepare(
          `INSERT INTO product_holders (product_unit_id, user_id, notes) VALUES (?, ?, ?)`
        ).bind(unitId, toUserId, reason).run()
      }
    } else if (type === 'deliver') {
      await c.env.DB.prepare(
        `UPDATE product_units SET status='delivered', current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(hospitalId, unitId).run()
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND released_at IS NULL`
      ).bind(unitId).run()
    } else if (type === 'return') {
      await c.env.DB.prepare(
        `UPDATE product_units SET status='in_stock', current_hospital_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`
      ).bind(unitId).run()
      await c.env.DB.prepare(
        `UPDATE product_holders SET released_at=CURRENT_TIMESTAMP WHERE product_unit_id=? AND released_at IS NULL`
      ).bind(unitId).run()
      await c.env.DB.prepare(
        `UPDATE product_movements
         SET actual_return_date = COALESCE(?, date('now','+9 hours'))
         WHERE id = (
           SELECT id FROM product_movements
           WHERE product_unit_id=? AND is_loan=1 AND actual_return_date IS NULL
           ORDER BY performed_at DESC LIMIT 1
         )`
      ).bind(b.actual_return_date || null, unitId).run()
      // 재고 복귀 시 기본 보유자(김규태/도재민) 자동 추가
      await ensureDefaultStockHolders(c.env.DB, unitId)
    }
    // demo는 상태 변경 없음

    // 미팅 매핑
    if (meetingId) {
      const mpAction = type === 'demo' ? 'demo'
        : type === 'deliver' ? 'deliver'
        : type === 'checkout' ? 'checkout'
        : type === 'return' ? 'return' : null
      if (mpAction) {
        await c.env.DB.prepare(
          `INSERT INTO meeting_products (meeting_id, product_unit_id, action, notes) VALUES (?, ?, ?, ?)`
        ).bind(meetingId, unitId, mpAction, reason).run()
      }
    }
  }

  // 세트 마스터 상태/위치 갱신
  if (type === 'checkout') {
    await c.env.DB.prepare(
      `UPDATE product_sets SET status=?, current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(hospitalId ? 'at_hospital' : 'out', hospitalId, setId).run()
  } else if (type === 'deliver') {
    await c.env.DB.prepare(
      `UPDATE product_sets SET status='delivered', current_hospital_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(hospitalId, setId).run()
  } else if (type === 'return') {
    await c.env.DB.prepare(
      `UPDATE product_sets SET status='in_stock', current_hospital_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(setId).run()
  } else {
    await refreshSetStatus(c.env.DB, setId)
  }

  await logActivity(c.env.DB, 'create', 'product_set_movement', setId, `세트 ${type} (유닛 ${unitIds.length}개)`)
  return c.json({ data: { set_id: setId, movement_ids: movementIds, affected_units: unitIds.length } }, 201)
})

// 세트 상태 재계산 유틸 — 구성 유닛들의 상태가 모두 같으면 그 값, 다르면 'mixed'
async function refreshSetStatus(db: D1Database, setId: number) {
  const r = await db.prepare(
    `SELECT DISTINCT pu.status
     FROM product_set_items si
     JOIN product_units pu ON pu.id = si.product_unit_id
     WHERE si.set_id = ? AND si.removed_at IS NULL`
  ).bind(setId).all()
  const statuses: string[] = (r.results as any[]).map(x => String(x.status || ''))
  let next = 'in_stock'
  if (statuses.length === 0) next = 'in_stock'
  else if (statuses.length === 1) next = statuses[0]
  else next = 'mixed'
  await db.prepare(`UPDATE product_sets SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(next, setId).run()
}

export default products
