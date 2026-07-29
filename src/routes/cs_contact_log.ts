import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ---------------- 통계 ----------------
// GET /api/cs/contact-logs/stats
app.get('/stats', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS inbound,
      SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) AS outbound,
      SUM(CASE WHEN outcome='needs_followup' THEN 1 ELSE 0 END) AS needs_followup,
      SUM(CASE WHEN outcome='no_answer' THEN 1 ELSE 0 END) AS no_answer,
      SUM(CASE WHEN DATE(contacted_at)=DATE('now','localtime') THEN 1 ELSE 0 END) AS today
    FROM cs_contact_logs
  `).first<any>()

  return c.json({ data: rows || { total: 0, inbound: 0, outbound: 0, needs_followup: 0, no_answer: 0, today: 0 } })
})

// ---------------- 목록 ----------------
// GET /api/cs/contact-logs?search=&direction=&channel=&outcome=&customer_id=&user_id=&limit=
app.get('/', async (c) => {
  const { search, direction, channel, outcome, customer_id, user_id, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT ctl.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      u.name AS user_name,
      h.name AS hospital_name,
      inq.subject AS related_inquiry_subject,
      rep.symptom AS related_repair_symptom
    FROM cs_contact_logs ctl
    LEFT JOIN customers cust ON cust.id = ctl.customer_id
    LEFT JOIN users u ON u.id = ctl.user_id
    LEFT JOIN hospitals h ON h.id = ctl.hospital_id
    LEFT JOIN cs_inquiries inq ON inq.id = ctl.related_inquiry_id
    LEFT JOIN cs_repairs rep ON rep.id = ctl.related_repair_id
  `
  const conds: string[] = []
  const params: any[] = []
  if (direction) { conds.push('ctl.direction = ?'); params.push(direction) }
  if (channel) { conds.push('ctl.channel = ?'); params.push(channel) }
  if (outcome) { conds.push('ctl.outcome = ?'); params.push(outcome) }
  if (customer_id) { conds.push('ctl.customer_id = ?'); params.push(safeInt(customer_id)) }
  if (user_id) { conds.push('ctl.user_id = ?'); params.push(safeInt(user_id)) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push('(ctl.subject LIKE ? OR ctl.content LIKE ? OR ctl.contact_name LIKE ? OR ctl.contact_phone LIKE ? OR cust.name LIKE ?)')
    params.push(s, s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  // 후속 필요 → 상단, 그리고 최신순
  q += `
    ORDER BY
      CASE ctl.outcome WHEN 'needs_followup' THEN 0 ELSE 1 END ASC,
      ctl.contacted_at DESC
    LIMIT ?
  `
  params.push(lim)

  const { results } = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: results || [] })
})

// ---------------- 상세 ----------------
app.get('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const row = await c.env.DB.prepare(`
    SELECT ctl.*,
      cust.name AS customer_name,
      cust.phone AS customer_phone,
      cust.email AS customer_email,
      u.name AS user_name,
      h.name AS hospital_name,
      inq.subject AS related_inquiry_subject,
      inq.status AS related_inquiry_status,
      rep.symptom AS related_repair_symptom,
      rep.status AS related_repair_status
    FROM cs_contact_logs ctl
    LEFT JOIN customers cust ON cust.id = ctl.customer_id
    LEFT JOIN users u ON u.id = ctl.user_id
    LEFT JOIN hospitals h ON h.id = ctl.hospital_id
    LEFT JOIN cs_inquiries inq ON inq.id = ctl.related_inquiry_id
    LEFT JOIN cs_repairs rep ON rep.id = ctl.related_repair_id
    WHERE ctl.id = ?
  `).bind(id).first<any>()

  if (!row) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)
  return c.json({ data: row })
})

// ---------------- 생성 ----------------
app.post('/', async (c) => {
  const userId = c.get('userId')
  const b = await c.req.json<any>().catch(() => ({}))

  if (!b.subject || !String(b.subject).trim()) {
    return apiError(c, 400, 'subject is required', ErrorCodes.VALIDATION)
  }

  const direction = b.direction || 'inbound'
  const channel = b.channel || 'phone'
  const outcome = b.outcome || 'resolved'
  const contactedAt = b.contacted_at || null

  const res = await c.env.DB.prepare(`
    INSERT INTO cs_contact_logs
      (customer_id, hospital_id, contact_name, contact_phone, contact_email,
       direction, channel, subject, content, duration_min,
       outcome, followup_at, related_inquiry_id, related_repair_id,
       user_id, contacted_at, notes)
    VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
  `).bind(
    b.customer_id || null,
    b.hospital_id || null,
    b.contact_name || null,
    b.contact_phone || null,
    b.contact_email || null,
    direction,
    channel,
    String(b.subject).trim(),
    b.content || null,
    b.duration_min != null && b.duration_min !== '' ? safeInt(String(b.duration_min)) : null,
    outcome,
    b.followup_at || null,
    b.related_inquiry_id || null,
    b.related_repair_id || null,
    userId,
    contactedAt,
    b.notes || null
  ).run()

  const newId = res.meta.last_row_id
  await logActivity(c.env.DB, 'create', 'cs_contact_log', newId as number, String(b.subject).trim(), '응대 로그 기록')
  return c.json({ data: { id: newId } })
})

// ---------------- 수정 ----------------
app.put('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const b = await c.req.json<any>().catch(() => ({}))

  const prev = await c.env.DB.prepare('SELECT * FROM cs_contact_logs WHERE id = ?').bind(id).first<any>()
  if (!prev) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare(`
    UPDATE cs_contact_logs SET
      customer_id = ?,
      hospital_id = ?,
      contact_name = ?,
      contact_phone = ?,
      contact_email = ?,
      direction = COALESCE(?, direction),
      channel = COALESCE(?, channel),
      subject = COALESCE(?, subject),
      content = ?,
      duration_min = ?,
      outcome = COALESCE(?, outcome),
      followup_at = ?,
      related_inquiry_id = ?,
      related_repair_id = ?,
      contacted_at = COALESCE(?, contacted_at),
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    b.customer_id === '' ? null : (b.customer_id ?? prev.customer_id),
    b.hospital_id === '' ? null : (b.hospital_id ?? prev.hospital_id),
    b.contact_name ?? prev.contact_name,
    b.contact_phone ?? prev.contact_phone,
    b.contact_email ?? prev.contact_email,
    b.direction ?? null,
    b.channel ?? null,
    b.subject ? String(b.subject).trim() : null,
    b.content ?? prev.content,
    b.duration_min != null && b.duration_min !== '' ? safeInt(String(b.duration_min)) : (b.duration_min === '' ? null : prev.duration_min),
    b.outcome ?? null,
    b.followup_at === '' ? null : (b.followup_at ?? prev.followup_at),
    b.related_inquiry_id === '' ? null : (b.related_inquiry_id ?? prev.related_inquiry_id),
    b.related_repair_id === '' ? null : (b.related_repair_id ?? prev.related_repair_id),
    b.contacted_at || null,
    b.notes ?? prev.notes,
    id
  ).run()

  await logActivity(c.env.DB, 'update', 'cs_contact_log', id, b.subject || prev.subject, '응대 로그 수정')
  return c.json({ data: { id } })
})

// ---------------- 삭제 ----------------
app.delete('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const prev = await c.env.DB.prepare('SELECT subject FROM cs_contact_logs WHERE id = ?').bind(id).first<any>()
  if (!prev) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare('DELETE FROM cs_contact_logs WHERE id = ?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'cs_contact_log', id, prev.subject, '응대 로그 삭제')
  return c.json({ data: { id } })
})

export default app
