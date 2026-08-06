import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'
import { notifyRepair } from '../lib/slack'

type Bindings = { DB: D1Database; SLACK_WEBHOOK_URL?: string; PUBLIC_BASE_URL?: string }
type Variables = { userId: number; user?: { id: number; name: string; email: string } }
const rep = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// 알림용 detail 조회 헬퍼 (Slack 메시지 빌드에 필요한 조인 데이터 포함)
async function getRepairForNotify(db: D1Database, id: number): Promise<any> {
  return await db.prepare(`
    SELECT r.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      h.name AS hospital_name,
      u.name AS assignee_name,
      pu.serial_no AS product_serial_no,
      pu.asset_code AS product_asset_code,
      p.name AS product_master_name
    FROM cs_repairs r
    LEFT JOIN customers cust ON cust.id = r.customer_id
    LEFT JOIN hospitals h ON h.id = r.hospital_id
    LEFT JOIN users u ON u.id = r.assignee_id
    LEFT JOIN product_units pu ON pu.id = r.product_unit_id
    LEFT JOIN products p ON p.id = pu.product_id
    WHERE r.id = ?
  `).bind(id).first() as any
}

async function getUserName(db: D1Database, uid: number | null): Promise<string | undefined> {
  if (!uid) return undefined
  const u = await db.prepare('SELECT name FROM users WHERE id=?').bind(uid).first() as any
  return u?.name
}

// ────────────────────────────────────────────────────────────────
// 접수일시(received_at) 정규화
//
// ⚠️ 저장 형식 주의: cs_repairs 는 다른 타임스탬프를 모두
//    new Date().toISOString() (= 'YYYY-MM-DDTHH:MM:SS.sssZ') 로 넣습니다.
//    (cs_inquiries 는 SQLite CURRENT_TIMESTAMP = 'YYYY-MM-DD HH:MM:SS' 를 씁니다)
//    한 컬럼에 두 형식이 섞이면 ORDER BY received_at DESC 정렬이 어긋나므로
//    (문자열 비교에서 'T'(0x54) > ' '(0x20)) 여기서 반드시 ISO 로 통일합니다.
//
// 입력은 'YYYY-MM-DD HH:MM(:SS)'(UTC, 프론트가 보내는 형식) 또는 ISO 모두 허용.
// 형식이 어긋나거나 실존하지 않는 날짜(예: 2026-02-31)면 null 을 돌려주고,
// 호출측에서 "지금" 또는 "이전 값 유지"로 처리합니다.
// ────────────────────────────────────────────────────────────────
function normalizeReceivedAt(v: any): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim().replace(' ', 'T')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const [, y, mo, d, h, mi, sec] = m
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec || 0)))
  if (isNaN(dt.getTime())) return null
  // 실존 날짜 검증 (2026-02-31 → Date 가 3/3 으로 넘겨버리는 것을 차단)
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null
  return dt.toISOString()
}

// -------------------- LIST --------------------
// GET /api/cs/repairs?search=&status=&priority=&assignee_id=&customer_id=&hospital_id=&warranty_status=&limit=
rep.get('/', async (c) => {
  const { search, status, priority, assignee_id, customer_id, hospital_id, warranty_status, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT r.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      h.name AS hospital_name,
      u.name AS assignee_name,
      creator.name AS created_by_name,
      pu.serial_no AS product_serial_no,
      pu.asset_code AS product_asset_code,
      p.name AS product_master_name,
      p.category AS product_category,
      p.model AS product_model,
      (SELECT COUNT(*) FROM cs_repair_steps WHERE repair_id = r.id) AS step_count
    FROM cs_repairs r
    LEFT JOIN customers cust ON cust.id = r.customer_id
    LEFT JOIN hospitals h ON h.id = r.hospital_id
    LEFT JOIN users u ON u.id = r.assignee_id
    LEFT JOIN users creator ON creator.id = r.created_by
    LEFT JOIN product_units pu ON pu.id = r.product_unit_id
    LEFT JOIN products p ON p.id = pu.product_id
  `
  const conds: string[] = []
  const params: any[] = []
  if (status) { conds.push('r.status = ?'); params.push(status) }
  if (priority) { conds.push('r.priority = ?'); params.push(priority) }
  if (warranty_status) { conds.push('r.warranty_status = ?'); params.push(warranty_status) }
  if (assignee_id) { conds.push('r.assignee_id = ?'); params.push(safeInt(assignee_id)) }
  if (customer_id) { conds.push('r.customer_id = ?'); params.push(safeInt(customer_id)) }
  if (hospital_id) { conds.push('r.hospital_id = ?'); params.push(safeInt(hospital_id)) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push(`(r.symptom LIKE ? OR r.diagnosis LIKE ? OR r.contact_name LIKE ? OR r.contact_phone LIKE ?
                 OR r.product_name LIKE ? OR r.serial_no_text LIKE ?
                 OR cust.name LIKE ? OR pu.serial_no LIKE ? OR pu.asset_code LIKE ?)`)
    params.push(s, s, s, s, s, s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')

  // 정렬: 열려있는 상태 우선, 우선순위, 최신순
  q += `
    ORDER BY
      CASE r.status
        WHEN 'received' THEN 1
        WHEN 'diagnosing' THEN 2
        WHEN 'waiting_parts' THEN 3
        WHEN 'repairing' THEN 4
        WHEN 'completed' THEN 5
        WHEN 'shipped' THEN 6
        WHEN 'closed' THEN 7
        WHEN 'rejected' THEN 8
        ELSE 9
      END,
      CASE r.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'mid' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      r.received_at DESC
    LIMIT ?
  `
  params.push(lim)

  const rs = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: rs.results || [] })
})

// -------------------- STATS --------------------
rep.get('/stats', async (c) => {
  const rs = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN status IN ('diagnosing','waiting_parts','repairing') THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS shipped,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN priority = 'urgent' AND status NOT IN ('closed','rejected','shipped') THEN 1 ELSE 0 END) AS urgent_open
    FROM cs_repairs
  `).first()
  return c.json({ data: rs || {} })
})

// -------------------- PRODUCT LOOKUP BY SERIAL --------------------
// GET /api/cs/repairs/lookup-serial?serial=xxx
rep.get('/lookup-serial', async (c) => {
  const serial = (c.req.query('serial') || '').trim()
  if (!serial) return c.json({ items: [] })
  const s = `%${safeLike(serial)}%`
  const rs = await c.env.DB.prepare(`
    SELECT pu.id AS product_unit_id, pu.serial_no, pu.asset_code, pu.status AS unit_status,
      p.id AS product_id, p.name AS product_name, p.category, p.model
    FROM product_units pu
    JOIN products p ON p.id = pu.product_id
    WHERE (pu.serial_no LIKE ? OR pu.asset_code LIKE ?)
    LIMIT 20
  `).bind(s, s).all()
  return c.json({ data: rs.results || [] })
})

// -------------------- DETAIL --------------------
rep.get('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const item = await c.env.DB.prepare(`
    SELECT r.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      cust.email AS customer_email,
      cust.customer_type,
      h.name AS hospital_name,
      u.name AS assignee_name,
      creator.name AS created_by_name,
      pu.serial_no AS product_serial_no,
      pu.asset_code AS product_asset_code,
      pu.status AS product_unit_status,
      p.name AS product_master_name,
      p.category AS product_category,
      p.model AS product_model,
      inq.subject AS inquiry_subject
    FROM cs_repairs r
    LEFT JOIN customers cust ON cust.id = r.customer_id
    LEFT JOIN hospitals h ON h.id = r.hospital_id
    LEFT JOIN users u ON u.id = r.assignee_id
    LEFT JOIN users creator ON creator.id = r.created_by
    LEFT JOIN product_units pu ON pu.id = r.product_unit_id
    LEFT JOIN products p ON p.id = pu.product_id
    LEFT JOIN cs_inquiries inq ON inq.id = r.inquiry_id
    WHERE r.id = ?
  `).bind(id).first()

  if (!item) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  const steps = await c.env.DB.prepare(`
    SELECT s.*, u.name AS user_name
    FROM cs_repair_steps s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.repair_id = ?
    ORDER BY s.created_at DESC, s.id DESC
  `).bind(id).all()

  return c.json({ data: { ...item, steps: steps.results || [] } })
})

// -------------------- CREATE --------------------
rep.post('/', async (c) => {
  const userId = c.get('userId')
  const b = await c.req.json().catch(() => ({} as any))
  const symptom = (b.symptom || '').trim()
  if (!symptom) return apiError(c, 400, '증상(symptom)은 필수입니다.', ErrorCodes.VALIDATION)

  const now = new Date().toISOString()
  // 접수일시: 폼에서 지정한 값이 유효하면 그대로, 아니면 현재 시각
  const receivedAt = normalizeReceivedAt(b.received_at) || now
  // 접수자: 폼에서 지정 가능. 미지정이면 로그인 사용자
  // ⚠️ b.created_by 가 '' 이면 "미지정"을 의도한 것이므로 null 로 저장합니다.
  const createdBy = b.created_by !== undefined
    ? (b.created_by === '' || b.created_by === null ? null : safeInt(b.created_by))
    : (userId || null)

  const rs = await c.env.DB.prepare(`
    INSERT INTO cs_repairs
      (customer_id, contact_name, contact_phone, contact_email, hospital_id,
       product_unit_id, product_name, serial_no_text,
       inquiry_id, status, priority, warranty_status,
       symptom, diagnosis, resolution,
       assignee_id, cost,
       received_at, expected_completion_at,
       notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?,  ?, ?,  ?, ?,  ?, ?, ?, ?)
  `).bind(
    b.customer_id || null,
    b.contact_name || null,
    b.contact_phone || null,
    b.contact_email || null,
    b.hospital_id || null,
    b.product_unit_id || null,
    b.product_name || null,
    b.serial_no_text || null,
    b.inquiry_id || null,
    b.status || 'received',
    b.priority || 'mid',
    b.warranty_status || 'unknown',
    symptom,
    b.diagnosis || null,
    b.resolution || null,
    b.assignee_id || null,
    b.cost != null && b.cost !== '' ? Number(b.cost) : null,
    receivedAt,
    b.expected_completion_at || null,
    b.notes || null,
    createdBy,
    now,
    now,
  ).run()

  const newId = rs.meta.last_row_id
  // 초기 접수 이력 로그
  await c.env.DB.prepare(`
    INSERT INTO cs_repair_steps (repair_id, user_id, step_type, to_value, content, created_at)
    VALUES (?, ?, 'status_change', ?, ?, ?)
  `).bind(newId, userId || null, b.status || 'received', '접수', now).run()

  await logActivity(c.env.DB, 'create', 'cs_repair', newId as number, symptom.slice(0, 50), null)

  // Slack 알림: 신규 접수 (실패해도 응답 지연 없이 진행)
  try {
    const detail = await getRepairForNotify(c.env.DB, newId as number)
    const userName = c.get('user')?.name || (await getUserName(c.env.DB, userId as number))
    if (detail) await notifyRepair(c.env, { kind: 'created', repair: detail, user_name: userName })
  } catch (e) { console.error('[slack] created notify wrap error', e) }

  return c.json({ data: { id: newId } }, 201)
})

// -------------------- UPDATE --------------------
rep.put('/:id', async (c) => {
  const userId = c.get('userId')
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const prev = await c.env.DB.prepare('SELECT * FROM cs_repairs WHERE id = ?').bind(id).first() as any
  if (!prev) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  const b = await c.req.json().catch(() => ({} as any))
  const now = new Date().toISOString()

  // 자동 타임스탬프
  let completed_at = prev.completed_at
  let shipped_at = prev.shipped_at
  let closed_at = prev.closed_at

  const newStatus = b.status ?? prev.status
  if (newStatus === 'completed' && prev.status !== 'completed') completed_at = now
  if (newStatus !== 'completed' && prev.status === 'completed') completed_at = null

  if (newStatus === 'shipped' && prev.status !== 'shipped') shipped_at = now
  if (newStatus !== 'shipped' && prev.status === 'shipped') shipped_at = null

  if ((newStatus === 'closed' || newStatus === 'rejected') && !closed_at) closed_at = now
  if (newStatus !== 'closed' && newStatus !== 'rejected') closed_at = null

  // 접수일시: 유효한 값이 오면 갱신, 아니면 이전 값 유지
  // ⚠️ 폼이 값을 안 보내거나 형식이 어긋날 때 절대 NULL 로 덮어쓰지 않습니다.
  const receivedAt = normalizeReceivedAt(b.received_at) || prev.received_at
  // 접수자: 필드가 아예 없으면 이전 값 유지, ''(미지정)이면 null
  const createdBy = b.created_by !== undefined
    ? (b.created_by === '' || b.created_by === null ? null : safeInt(b.created_by))
    : prev.created_by

  await c.env.DB.prepare(`
    UPDATE cs_repairs SET
      customer_id = ?, contact_name = ?, contact_phone = ?, contact_email = ?, hospital_id = ?,
      product_unit_id = ?, product_name = ?, serial_no_text = ?,
      inquiry_id = ?, status = ?, priority = ?, warranty_status = ?,
      symptom = ?, diagnosis = ?, resolution = ?,
      assignee_id = ?, cost = ?,
      received_at = ?, expected_completion_at = ?,
      completed_at = ?, shipped_at = ?, closed_at = ?,
      notes = ?, created_by = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    b.customer_id ?? prev.customer_id,
    b.contact_name ?? prev.contact_name,
    b.contact_phone ?? prev.contact_phone,
    b.contact_email ?? prev.contact_email,
    b.hospital_id ?? prev.hospital_id,
    b.product_unit_id ?? prev.product_unit_id,
    b.product_name ?? prev.product_name,
    b.serial_no_text ?? prev.serial_no_text,
    b.inquiry_id ?? prev.inquiry_id,
    newStatus,
    b.priority ?? prev.priority,
    b.warranty_status ?? prev.warranty_status,
    b.symptom ?? prev.symptom,
    b.diagnosis ?? prev.diagnosis,
    b.resolution ?? prev.resolution,
    b.assignee_id ?? prev.assignee_id,
    b.cost !== undefined ? (b.cost === '' || b.cost === null ? null : Number(b.cost)) : prev.cost,
    receivedAt,
    b.expected_completion_at ?? prev.expected_completion_at,
    completed_at,
    shipped_at,
    closed_at,
    b.notes ?? prev.notes,
    createdBy,
    now,
    id,
  ).run()

  // 자동 로그: 상태 변경
  if (b.status !== undefined && b.status !== prev.status) {
    await c.env.DB.prepare(`
      INSERT INTO cs_repair_steps (repair_id, user_id, step_type, from_value, to_value, created_at)
      VALUES (?, ?, 'status_change', ?, ?, ?)
    `).bind(id, userId || null, prev.status, b.status, now).run()
  }
  // 자동 로그: 담당자 변경
  if (b.assignee_id !== undefined && (b.assignee_id ?? null) !== (prev.assignee_id ?? null)) {
    await c.env.DB.prepare(`
      INSERT INTO cs_repair_steps (repair_id, user_id, step_type, from_value, to_value, created_at)
      VALUES (?, ?, 'assignee_change', ?, ?, ?)
    `).bind(id, userId || null, String(prev.assignee_id ?? ''), String(b.assignee_id ?? ''), now).run()
  }
  // 자동 로그: 진단 추가/변경
  if (b.diagnosis !== undefined && (b.diagnosis || '') !== (prev.diagnosis || '') && b.diagnosis) {
    await c.env.DB.prepare(`
      INSERT INTO cs_repair_steps (repair_id, user_id, step_type, content, created_at)
      VALUES (?, ?, 'diagnosis', ?, ?)
    `).bind(id, userId || null, b.diagnosis, now).run()
  }
  // 자동 로그: 처리 내용
  if (b.resolution !== undefined && (b.resolution || '') !== (prev.resolution || '') && b.resolution) {
    await c.env.DB.prepare(`
      INSERT INTO cs_repair_steps (repair_id, user_id, step_type, content, created_at)
      VALUES (?, ?, 'resolution', ?, ?)
    `).bind(id, userId || null, b.resolution, now).run()
  }
  // 자동 로그: 비용 업데이트
  if (b.cost !== undefined && Number(b.cost || 0) !== Number(prev.cost || 0)) {
    await c.env.DB.prepare(`
      INSERT INTO cs_repair_steps (repair_id, user_id, step_type, from_value, to_value, created_at)
      VALUES (?, ?, 'cost_update', ?, ?, ?)
    `).bind(id, userId || null, String(prev.cost ?? ''), String(b.cost ?? ''), now).run()
  }

  await logActivity(c.env.DB, 'update', 'cs_repair', id, (b.symptom ?? prev.symptom).slice(0, 50), null)

  // Slack 알림: 상태 변경 / 담당자 배정
  const statusChanged = b.status !== undefined && b.status !== prev.status
  const assigneeChanged = b.assignee_id !== undefined && (b.assignee_id ?? null) !== (prev.assignee_id ?? null)
  if (statusChanged || assigneeChanged) {
    try {
      const detail = await getRepairForNotify(c.env.DB, id)
      const userName = c.get('user')?.name || (await getUserName(c.env.DB, userId as number))
      if (detail) {
        if (statusChanged) {
          await notifyRepair(c.env, {
            kind: 'status_changed',
            repair: detail,
            from_status: prev.status,
            to_status: b.status,
            user_name: userName,
          })
        }
        if (assigneeChanged) {
          const fromName = prev.assignee_id ? (await getUserName(c.env.DB, prev.assignee_id)) : undefined
          const toName = b.assignee_id ? (await getUserName(c.env.DB, b.assignee_id)) : undefined
          await notifyRepair(c.env, {
            kind: 'assigned',
            repair: detail,
            from_assignee: fromName,
            to_assignee: toName,
            user_name: userName,
          })
        }
      }
    } catch (e) { console.error('[slack] update notify wrap error', e) }
  }

  return c.json({ data: { id } })
})

// -------------------- DELETE --------------------
rep.delete('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const prev = await c.env.DB.prepare('SELECT symptom FROM cs_repairs WHERE id = ?').bind(id).first() as any
  if (!prev) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)
  await c.env.DB.prepare('DELETE FROM cs_repairs WHERE id = ?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'cs_repair', id, (prev.symptom || '').slice(0, 50), null)
  return c.json({ data: { id } })
})

// -------------------- STEPS: ADD MANUAL NOTE / PART_ORDER --------------------
rep.post('/:id/steps', async (c) => {
  const userId = c.get('userId')
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const b = await c.req.json().catch(() => ({} as any))
  const step_type = b.step_type || 'note'
  const content = (b.content || '').trim()
  if (!content) return apiError(c, 400, '내용을 입력하세요.', ErrorCodes.VALIDATION)

  const now = new Date().toISOString()
  const rs = await c.env.DB.prepare(`
    INSERT INTO cs_repair_steps (repair_id, user_id, step_type, content, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, userId || null, step_type, content, b.meta ? JSON.stringify(b.meta) : null, now).run()

  return c.json({ data: { id: rs.meta.last_row_id } }, 201)
})

rep.delete('/:id/steps/:sid', async (c) => {
  const id = safeInt(c.req.param('id'))
  const sid = safeInt(c.req.param('sid'))
  if (!id || !sid) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  await c.env.DB.prepare('DELETE FROM cs_repair_steps WHERE id = ? AND repair_id = ?').bind(sid, id).run()
  return c.json({ data: { id: sid } })
})

export default rep
