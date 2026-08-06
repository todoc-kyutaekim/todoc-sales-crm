import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const cs = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ────────────────────────────────────────────────────────────────
// 접수일시(created_at) 정규화
//
// ⚠️ DB의 DATETIME은 모두 UTC 기준입니다(CURRENT_TIMESTAMP가 UTC).
// 프런트는 사용자의 로컬 시각을 UTC로 변환해 'YYYY-MM-DD HH:MM:SS'로 보냅니다.
// 여기서는 그 형식만 검증하고, 형식이 어긋나면 null을 돌려 "변경하지 않음"으로 처리합니다.
// (잘못된 값으로 접수일시를 덮어써서 통계·추이 그래프가 깨지는 것을 막습니다)
// ────────────────────────────────────────────────────────────────
function normalizeDateTime(v: any): string | null {
  if (v == null || v === '') return null
  const s = String(v).trim().replace('T', ' ')
  // 'YYYY-MM-DD HH:MM' 또는 'YYYY-MM-DD HH:MM:SS' 허용
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, sec] = m
  // 실제로 존재하는 날짜인지 확인 (2026-02-30 같은 값 차단)
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec || 0)))
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return null
  return `${y}-${mo}-${d} ${h}:${mi}:${sec || '00'}`
}

// GET /api/cs/inquiries?search=&status=&category=&priority=&assignee_id=&customer_id=&channel=&limit=
cs.get('/', async (c) => {
  const { search, status, category, priority, assignee_id, customer_id, channel, direction, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT i.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      u.name AS assignee_name,
      h.name AS hospital_name,
      creator.name AS created_by_name,
      rep.symptom AS related_repair_symptom,
      rep.status AS related_repair_status,
      (SELECT COUNT(*) FROM cs_inquiry_responses WHERE inquiry_id = i.id) AS response_count,
      (SELECT MAX(created_at) FROM cs_inquiry_responses WHERE inquiry_id = i.id) AS last_response_at
    FROM cs_inquiries i
    LEFT JOIN customers cust ON cust.id = i.customer_id
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN hospitals h ON h.id = i.hospital_id
    LEFT JOIN cs_repairs rep ON rep.id = i.related_repair_id
  `
  const conds: string[] = []
  const params: any[] = []
  if (status) { conds.push('i.status = ?'); params.push(status) }
  if (category) { conds.push('i.category = ?'); params.push(category) }
  if (priority) { conds.push('i.priority = ?'); params.push(priority) }
  if (channel) { conds.push('i.channel = ?'); params.push(channel) }
  if (direction) { conds.push('i.direction = ?'); params.push(direction) }
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
      creator.name AS created_by_name,
      rep.symptom AS related_repair_symptom,
      rep.status AS related_repair_status
    FROM cs_inquiries i
    LEFT JOIN customers cust ON cust.id = i.customer_id
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN users creator ON creator.id = i.created_by
    LEFT JOIN hospitals h ON h.id = i.hospital_id
    LEFT JOIN cs_repairs rep ON rep.id = i.related_repair_id
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

  // 접수일시: 사용자가 지정하면 그 값, 없거나 형식이 잘못되면 현재시각(UTC)
  const createdAt = normalizeDateTime(b.created_at)
  // 접수자: 사용자가 지정하면 그 값, 없으면 요청한 본인
  const createdBy = b.created_by ? safeInt(String(b.created_by)) : (uid || null)

  const r = await c.env.DB.prepare(`
    INSERT INTO cs_inquiries (
      customer_id, contact_name, contact_phone, contact_email,
      subject, category, channel, priority, status,
      assignee_id, first_message, hospital_id, created_by,
      direction, duration_min, followup_at, related_repair_id,
      created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, CURRENT_TIMESTAMP))
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
    createdBy,
    b.direction === 'outbound' ? 'outbound' : 'inbound',
    b.duration_min != null && b.duration_min !== '' ? safeInt(String(b.duration_min)) : null,
    b.followup_at || null,
    b.related_repair_id ? safeInt(String(b.related_repair_id)) : null,
    createdAt
  ).run()

  const newId = r.meta.last_row_id as number

  // 최초 메시지가 있으면 응답 이력에도 초기 항목으로 남김 (타임라인 완결성)
  // 접수일시를 지정했다면 이 항목도 같은 시각으로 맞춥니다(타임라인 순서 보존).
  if (b.first_message && b.first_message.trim()) {
    await c.env.DB.prepare(`
      INSERT INTO cs_inquiry_responses (inquiry_id, user_id, response_type, channel, content, created_at)
      VALUES (?,?,?,?,?, COALESCE(?, CURRENT_TIMESTAMP))
    `).bind(newId, createdBy, 'reply', b.channel || 'phone', b.first_message.trim(), createdAt).run()
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

  // 신규 필드 정규화
  const nowDirection = b.direction === 'outbound' ? 'outbound' : 'inbound'
  const nowDuration = (b.duration_min != null && b.duration_min !== '') ? safeInt(String(b.duration_min)) : null
  const nowFollowupAt = b.followup_at || null
  const nowRelatedRepair = b.related_repair_id ? safeInt(String(b.related_repair_id)) : null

  // ⚠️ 이전에는 resolved_at 처리 방식(설정/해제/유지) 때문에 거의 동일한
  //    UPDATE 문을 3벌 복사해 두었습니다. 필드를 하나 추가할 때 3곳을 모두
  //    고쳐야 해서 누락이 나기 쉬웠으므로, SQL 조각만 분기해 1벌로 합쳤습니다.
  const resolvedAtSql =
    nowResolvedAt === "datetime('now')" ? ", resolved_at=datetime('now')"
    : nowResolvedAt === 'NULL' ? ', resolved_at=NULL'
    : ''  // 유지

  // 접수일시/접수자: 값이 오면 갱신, 없으면 기존 값 유지(COALESCE로 보호)
  const createdAt = normalizeDateTime(b.created_at)
  const createdBy = b.created_by ? safeInt(String(b.created_by)) : null

  await c.env.DB.prepare(`
    UPDATE cs_inquiries SET
      customer_id=?, contact_name=?, contact_phone=?, contact_email=?,
      subject=?, category=?, channel=?, priority=?, status=?,
      assignee_id=?, first_message=?, hospital_id=?,
      direction=?, duration_min=?, followup_at=?, related_repair_id=?,
      created_at=COALESCE(?, created_at),
      created_by=COALESCE(?, created_by),
      updated_at=CURRENT_TIMESTAMP${resolvedAtSql}
    WHERE id=?
  `).bind(
    b.customer_id ? safeInt(String(b.customer_id)) : null,
    b.contact_name || '', b.contact_phone || '', b.contact_email || '',
    b.subject.trim(),
    b.category || 'general', b.channel || 'phone',
    b.priority || 'mid', nowStatus,
    nowAssignee, b.first_message || '',
    b.hospital_id ? safeInt(String(b.hospital_id)) : null,
    nowDirection, nowDuration, nowFollowupAt, nowRelatedRepair,
    createdAt, createdBy,
    id
  ).run()

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

// PUT /api/cs/inquiries/:id/responses/:rid — 응답/메모 수정
//
// ⚠️ response_type이 'status_change'/'assignee_change'인 항목은 시스템이 자동 기록한
//    감사(audit) 이력이므로 수정을 막습니다. 사람이 쓴 'reply'/'note'만 수정 가능합니다.
cs.put('/:id/responses/:rid', async (c) => {
  const id = c.req.param('id')
  const rid = c.req.param('rid')
  const b = await c.req.json()
  if (!b.content || typeof b.content !== 'string' || b.content.trim().length === 0) {
    return apiError(c, 400, '내용을 입력하세요', ErrorCodes.VALIDATION)
  }

  // 해당 문의에 속한 항목인지 확인 (다른 문의의 응답을 수정하는 것 차단)
  const row = await c.env.DB.prepare(
    'SELECT id, response_type FROM cs_inquiry_responses WHERE id=? AND inquiry_id=?'
  ).bind(rid, id).first() as any
  if (!row) return apiError(c, 404, '응답을 찾을 수 없습니다', ErrorCodes.NOT_FOUND)
  if (row.response_type === 'status_change' || row.response_type === 'assignee_change') {
    return apiError(c, 400, '시스템이 기록한 변경 이력은 수정할 수 없습니다', ErrorCodes.VALIDATION)
  }

  // response_type은 reply ↔ note 사이에서만 변경 허용
  const nextType = (b.response_type === 'note' || b.response_type === 'reply')
    ? b.response_type : row.response_type

  await c.env.DB.prepare(`
    UPDATE cs_inquiry_responses
    SET content=?, response_type=?, channel=?
    WHERE id=?
  `).bind(b.content.trim(), nextType, b.channel || '', rid).run()

  await c.env.DB.prepare('UPDATE cs_inquiries SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'update', 'cs_inquiry', Number(id), '', 'response edited')
  return c.json({ data: { id: Number(rid) } })
})

// DELETE /api/cs/inquiries/:id/responses/:rid
cs.delete('/:id/responses/:rid', async (c) => {
  const id = c.req.param('id')
  const rid = c.req.param('rid')

  // 소속 확인 + 시스템 이력 보호 (수정과 동일한 규칙)
  const row = await c.env.DB.prepare(
    'SELECT id, response_type FROM cs_inquiry_responses WHERE id=? AND inquiry_id=?'
  ).bind(rid, id).first() as any
  if (!row) return apiError(c, 404, '응답을 찾을 수 없습니다', ErrorCodes.NOT_FOUND)
  if (row.response_type === 'status_change' || row.response_type === 'assignee_change') {
    return apiError(c, 400, '시스템이 기록한 변경 이력은 삭제할 수 없습니다', ErrorCodes.VALIDATION)
  }

  await c.env.DB.prepare('DELETE FROM cs_inquiry_responses WHERE id=?').bind(rid).run()
  await c.env.DB.prepare('UPDATE cs_inquiries SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'update', 'cs_inquiry', Number(id), '', 'response deleted')
  return c.json({ data: { id: Number(rid) } })
})

export default cs
