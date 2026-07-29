import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const cs = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// GET /api/cs/inquiries?search=&status=&category=&priority=&assignee_id=&customer_id=&channel=&limit=
cs.get('/', async (c) => {
  const { search, status, category, priority, assignee_id, customer_id, channel, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT i.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      u.name AS assignee_name,
      h.name AS hospital_name,
      creator.name AS created_by_name,
      (SELECT COUNT(*) FROM cs_inquiry_responses WHERE inquiry_id = i.id) AS response_count,
      (SELECT MAX(created_at) FROM cs_inquiry_responses WHERE inquiry_id = i.id) AS last_response_at
    FROM cs_inquiries i
    LEFT JOIN customers cust ON cust.id = i.customer_id
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN hospitals h ON h.id = i.hospital_id
  `
  const conds: string[] = []
  const params: any[] = []
  if (status) { conds.push('i.status = ?'); params.push(status) }
  if (category) { conds.push('i.category = ?'); params.push(category) }
  if (priority) { conds.push('i.priority = ?'); params.push(priority) }
  if (channel) { conds.push('i.channel = ?'); params.push(channel) }
  if (assignee_id) { conds.push('i.assignee_id = ?'); params.push(safeInt(assignee_id)) }
  if (customer_id) { conds.push('i.customer_id = ?'); params.push(safeInt(customer_id)) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push('(i.subject LIKE ? OR i.first_message LIKE ? OR i.contact_name LIKE ? OR i.contact_phone LIKE ? OR cust.name LIKE ?)')
    params.push(s, s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  // 상태별 정렬: open/in_progress 우선, priority 순, 최신순
  q += `
    ORDER BY
      CASE i.status
        WHEN 'open' THEN 0
        WHEN 'in_progress' THEN 1
        WHEN 'resolved' THEN 2
        WHEN 'closed' THEN 3
        WHEN 'canceled' THEN 4
        ELSE 5
      END ASC,
      CASE i.priority
        WHEN 'urgent' THEN 0
        WHEN 'high' THEN 1
        WHEN 'mid' THEN 2
        WHEN 'low' THEN 3
        ELSE 4
      END ASC,
      i.created_at DESC
    LIMIT ?
  `
  params.push(lim)

  const r = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: r.results })
})

// GET /api/cs/inquiries/stats — 대시보드/필터바용 카운트
cs.get('/stats', async (c) => {
  const [byStatus, byPriority, todayOpen, myOpen] = await Promise.all([
    c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM cs_inquiries GROUP BY status').all(),
    c.env.DB.prepare("SELECT priority, COUNT(*) AS n FROM cs_inquiries WHERE status IN ('open','in_progress') GROUP BY priority").all(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM cs_inquiries WHERE date(created_at,'+9 hours') = date('now','+9 hours')").first(),
    c.env.DB.prepare("SELECT assignee_id, COUNT(*) AS n FROM cs_inquiries WHERE status IN ('open','in_progress') GROUP BY assignee_id").all(),
  ])
  return c.json({
    data: {
      by_status: byStatus.results || [],
      by_priority: byPriority.results || [],
      today_new: (todayOpen as any)?.n || 0,
      open_by_assignee: myOpen.results || [],
    }
  })
})

// GET /api/cs/inquiries/:id — 상세 + 응답 이력 타임라인
cs.get('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`
    SELECT i.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      cust.email AS customer_email,
      cust.customer_type AS customer_type,
      u.name AS assignee_name,
      h.name AS hospital_name,
      creator.name AS created_by_name
    FROM cs_inquiries i
    LEFT JOIN customers cust ON cust.id = i.customer_id
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN hospitals h ON h.id = i.hospital_id
    WHERE i.id = ?
  `).bind(id).first()
  if (!row) return apiError(c, 404, '문의를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  const resp = await c.env.DB.prepare(`
    SELECT r.*, u.name AS user_name
    FROM cs_inquiry_responses r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.inquiry_id = ?
    ORDER BY r.created_at ASC
  `).bind(id).all()

  return c.json({ data: { ...row, responses: resp.results || [] } })
})

// POST /api/cs/inquiries
cs.post('/', async (c) => {
  const b = await c.req.json()
  if (!b.subject || typeof b.subject !== 'string' || b.subject.trim().length === 0) {
    return apiError(c, 400, '제목(문의 요약)을 입력하세요', ErrorCodes.VALIDATION)
  }
  const uid = c.get('userId')
  const r = await c.env.DB.prepare(`
    INSERT INTO cs_inquiries (
      customer_id, contact_name, contact_phone, contact_email,
      subject, category, channel, priority, status,
      assignee_id, first_message, hospital_id, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    b.customer_id ? safeInt(String(b.customer_id)) : null,
    b.contact_name || '', b.contact_phone || '', b.contact_email || '',
    b.subject.trim(),
    b.category || 'general',
    b.channel || 'phone',
    b.priority || 'mid',
    b.status || 'open',
    b.assignee_id ? safeInt(String(b.assignee_id)) : null,
    b.first_message || '',
    b.hospital_id ? safeInt(String(b.hospital_id)) : null,
    uid || null
  ).run()

  const newId = r.meta.last_row_id as number

  // 최초 메시지가 있으면 응답 이력에도 초기 항목으로 남김 (타임라인 완결성)
  if (b.first_message && b.first_message.trim()) {
    await c.env.DB.prepare(`
      INSERT INTO cs_inquiry_responses (inquiry_id, user_id, response_type, channel, content)
      VALUES (?,?,?,?,?)
    `).bind(newId, uid || null, 'reply', b.channel || 'phone', b.first_message.trim()).run()
  }

  await logActivity(c.env.DB, 'create', 'cs_inquiry', newId, b.subject.trim())
  return c.json({ data: { id: newId, ...b } }, 201)
})

// PUT /api/cs/inquiries/:id
cs.put('/:id', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  if (!b.subject || typeof b.subject !== 'string' || b.subject.trim().length === 0) {
    return apiError(c, 400, '제목(문의 요약)을 입력하세요', ErrorCodes.VALIDATION)
  }
  const uid = c.get('userId')

  // 상태·담당자 변경 감지 → 이력 자동 기록
  const prev = await c.env.DB.prepare('SELECT status, assignee_id FROM cs_inquiries WHERE id=?').bind(id).first() as any
  const nowStatus = b.status || 'open'
  const nowAssignee = b.assignee_id ? safeInt(String(b.assignee_id)) : null
  const nowResolvedAt = (prev?.status !== 'resolved' && nowStatus === 'resolved') ? "datetime('now')"
    : (prev?.status === 'resolved' && nowStatus !== 'resolved') ? 'NULL'
    : null // 유지

  // resolved_at은 상태 전환 시에만 갱신
  if (nowResolvedAt === "datetime('now')") {
    await c.env.DB.prepare(`
      UPDATE cs_inquiries SET
        customer_id=?, contact_name=?, contact_phone=?, contact_email=?,
        subject=?, category=?, channel=?, priority=?, status=?,
        assignee_id=?, first_message=?, hospital_id=?,
        updated_at=CURRENT_TIMESTAMP, resolved_at=datetime('now')
      WHERE id=?
    `).bind(
      b.customer_id ? safeInt(String(b.customer_id)) : null,
      b.contact_name || '', b.contact_phone || '', b.contact_email || '',
      b.subject.trim(),
      b.category || 'general', b.channel || 'phone',
      b.priority || 'mid', nowStatus,
      nowAssignee, b.first_message || '',
      b.hospital_id ? safeInt(String(b.hospital_id)) : null,
      id
    ).run()
  } else if (nowResolvedAt === 'NULL') {
    await c.env.DB.prepare(`
      UPDATE cs_inquiries SET
        customer_id=?, contact_name=?, contact_phone=?, contact_email=?,
        subject=?, category=?, channel=?, priority=?, status=?,
        assignee_id=?, first_message=?, hospital_id=?,
        updated_at=CURRENT_TIMESTAMP, resolved_at=NULL
      WHERE id=?
    `).bind(
      b.customer_id ? safeInt(String(b.customer_id)) : null,
      b.contact_name || '', b.contact_phone || '', b.contact_email || '',
      b.subject.trim(),
      b.category || 'general', b.channel || 'phone',
      b.priority || 'mid', nowStatus,
      nowAssignee, b.first_message || '',
      b.hospital_id ? safeInt(String(b.hospital_id)) : null,
      id
    ).run()
  } else {
    await c.env.DB.prepare(`
      UPDATE cs_inquiries SET
        customer_id=?, contact_name=?, contact_phone=?, contact_email=?,
        subject=?, category=?, channel=?, priority=?, status=?,
        assignee_id=?, first_message=?, hospital_id=?,
        updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      b.customer_id ? safeInt(String(b.customer_id)) : null,
      b.contact_name || '', b.contact_phone || '', b.contact_email || '',
      b.subject.trim(),
      b.category || 'general', b.channel || 'phone',
      b.priority || 'mid', nowStatus,
      nowAssignee, b.first_message || '',
      b.hospital_id ? safeInt(String(b.hospital_id)) : null,
      id
    ).run()
  }

  // 상태 변경 이력 기록
  if (prev && prev.status !== nowStatus) {
    await c.env.DB.prepare(`
      INSERT INTO cs_inquiry_responses (inquiry_id, user_id, response_type, content, meta)
      VALUES (?,?,?,?,?)
    `).bind(id, uid || null, 'status_change',
      `상태 변경: ${prev.status} → ${nowStatus}`,
      JSON.stringify({ from: prev.status, to: nowStatus })
    ).run()
  }
  // 담당자 변경 이력 기록
  if (prev && (prev.assignee_id || null) !== nowAssignee) {
    await c.env.DB.prepare(`
      INSERT INTO cs_inquiry_responses (inquiry_id, user_id, response_type, content, meta)
      VALUES (?,?,?,?,?)
    `).bind(id, uid || null, 'assignee_change',
      `담당자 변경`,
      JSON.stringify({ from: prev.assignee_id, to: nowAssignee })
    ).run()
  }

  await logActivity(c.env.DB, 'update', 'cs_inquiry', Number(id), b.subject.trim())
  return c.json({ data: { id: Number(id), ...b } })
})

// DELETE /api/cs/inquiries/:id
cs.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT subject FROM cs_inquiries WHERE id=?').bind(id).first() as any
  if (!row) return apiError(c, 404, '문의를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)
  await c.env.DB.prepare('DELETE FROM cs_inquiries WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'cs_inquiry', Number(id), row.subject || '')
  return c.json({ data: { id: Number(id) } })
})

// ============================================================
// 응답 이력 (Responses)
// ============================================================

// POST /api/cs/inquiries/:id/responses — 응답/노트 추가
cs.post('/:id/responses', async (c) => {
  const id = c.req.param('id')
  const b = await c.req.json()
  if (!b.content || typeof b.content !== 'string' || b.content.trim().length === 0) {
    return apiError(c, 400, '내용을 입력하세요', ErrorCodes.VALIDATION)
  }
  const uid = c.get('userId')
  const inq = await c.env.DB.prepare('SELECT id, subject FROM cs_inquiries WHERE id=?').bind(id).first() as any
  if (!inq) return apiError(c, 404, '문의를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  const r = await c.env.DB.prepare(`
    INSERT INTO cs_inquiry_responses (inquiry_id, user_id, response_type, channel, content)
    VALUES (?,?,?,?,?)
  `).bind(
    id, uid || null,
    b.response_type || 'reply',
    b.channel || '',
    b.content.trim()
  ).run()

  // 응답 추가 시 문의의 updated_at 갱신 (open 상태면 in_progress로 승격)
  if (b.response_type !== 'note') {
    await c.env.DB.prepare(`
      UPDATE cs_inquiries SET
        status = CASE WHEN status='open' THEN 'in_progress' ELSE status END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(id).run()
  } else {
    await c.env.DB.prepare('UPDATE cs_inquiries SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run()
  }

  await logActivity(c.env.DB, 'update', 'cs_inquiry', Number(id), inq.subject || '', 'response added')
  return c.json({ data: { id: r.meta.last_row_id } }, 201)
})

// DELETE /api/cs/inquiries/:id/responses/:rid
cs.delete('/:id/responses/:rid', async (c) => {
  const rid = c.req.param('rid')
  await c.env.DB.prepare('DELETE FROM cs_inquiry_responses WHERE id=?').bind(rid).run()
  return c.json({ data: { id: Number(rid) } })
})

export default cs
