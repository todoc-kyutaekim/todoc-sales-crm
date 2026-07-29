import { Hono } from 'hono'
import { logActivity, safeInt, safeLike, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ─────────────────────────────────────────────────────────────
// 유틸: 색상 검증 (#RGB / #RRGGBB)
// ─────────────────────────────────────────────────────────────
function normColor(v: any): string {
  const s = String(v || '').trim()
  if (!s) return '#64748b'
  if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(s)) return s
  return '#64748b'
}

// ─────────────────────────────────────────────────────────────
// GET /api/customer-groups
//   ?search=&limit=
//   → 그룹 목록 (+ member_count)
// ─────────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const { search, limit } = c.req.query()
  const lim = safeLimit(limit, 200)

  let q = `
    SELECT g.*,
      (SELECT COUNT(*) FROM customer_group_members WHERE group_id = g.id) AS member_count,
      u.name AS created_by_name
    FROM customer_groups g
    LEFT JOIN users u ON u.id = g.created_by
  `
  const conds: string[] = []
  const params: any[] = []
  if (search) {
    conds.push('(g.name LIKE ? OR g.description LIKE ?)')
    const s = `%${safeLike(search)}%`
    params.push(s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY g.sort_order ASC, g.name ASC LIMIT ?'
  params.push(lim)

  const r = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: r.results })
})

// ─────────────────────────────────────────────────────────────
// GET /api/customer-groups/stats
//   → 통계: 전체 그룹 수, 멤버쉽 총합, 미소속 고객 수
// ─────────────────────────────────────────────────────────────
app.get('/stats', async (c) => {
  const [total, mem, unassigned] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM customer_groups').first() as Promise<any>,
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM customer_group_members').first() as Promise<any>,
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM customers
      WHERE id NOT IN (SELECT DISTINCT customer_id FROM customer_group_members)
    `).first() as Promise<any>,
  ])
  return c.json({
    data: {
      total_groups: total?.n || 0,
      total_memberships: mem?.n || 0,
      unassigned_customers: unassigned?.n || 0,
    },
  })
})

// ─────────────────────────────────────────────────────────────
// GET /api/customer-groups/:id
// ─────────────────────────────────────────────────────────────
app.get('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const row = await c.env.DB.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM customer_group_members WHERE group_id = g.id) AS member_count,
      u.name AS created_by_name
    FROM customer_groups g
    LEFT JOIN users u ON u.id = g.created_by
    WHERE g.id = ?
  `).bind(id).first<any>()

  if (!row) return apiError(c, 404, 'group not found', ErrorCodes.NOT_FOUND)
  return c.json({ data: row })
})

// ─────────────────────────────────────────────────────────────
// POST /api/customer-groups
//   body: { name, color?, description?, sort_order? }
// ─────────────────────────────────────────────────────────────
app.post('/', async (c) => {
  const userId = c.get('userId')
  const b = await c.req.json<any>().catch(() => ({}))
  const name = String(b.name || '').trim()
  if (!name) return apiError(c, 400, 'name is required', ErrorCodes.VALIDATION)
  if (name.length > 60) return apiError(c, 400, 'name too long (max 60)', ErrorCodes.VALIDATION)

  const color = normColor(b.color)
  const description = b.description ? String(b.description).trim() : null
  const sortOrder = safeInt(b.sort_order) || 0

  // UNIQUE 이름 체크
  const exists = await c.env.DB.prepare('SELECT id FROM customer_groups WHERE name = ?').bind(name).first()
  if (exists) return apiError(c, 409, '이미 존재하는 그룹 이름입니다', ErrorCodes.CONFLICT)

  const r = await c.env.DB.prepare(`
    INSERT INTO customer_groups (name, color, description, sort_order, created_by)
    VALUES (?,?,?,?,?)
  `).bind(name, color, description, sortOrder, userId).run()

  const newId = r.meta.last_row_id
  await logActivity(c.env.DB, 'create', 'customer_group', newId as number, name, '고객 그룹 생성')
  return c.json({ data: { id: newId } })
})

// ─────────────────────────────────────────────────────────────
// PUT /api/customer-groups/:id
// ─────────────────────────────────────────────────────────────
app.put('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const b = await c.req.json<any>().catch(() => ({}))

  const prev = await c.env.DB.prepare('SELECT * FROM customer_groups WHERE id = ?').bind(id).first<any>()
  if (!prev) return apiError(c, 404, 'group not found', ErrorCodes.NOT_FOUND)

  let name = prev.name as string
  if (b.name !== undefined) {
    name = String(b.name || '').trim()
    if (!name) return apiError(c, 400, 'name is required', ErrorCodes.VALIDATION)
    if (name.length > 60) return apiError(c, 400, 'name too long (max 60)', ErrorCodes.VALIDATION)
    if (name !== prev.name) {
      const dup = await c.env.DB.prepare('SELECT id FROM customer_groups WHERE name = ? AND id != ?').bind(name, id).first()
      if (dup) return apiError(c, 409, '이미 존재하는 그룹 이름입니다', ErrorCodes.CONFLICT)
    }
  }
  const color = b.color !== undefined ? normColor(b.color) : prev.color
  const description = b.description !== undefined ? (b.description ? String(b.description).trim() : null) : prev.description
  const sortOrder = b.sort_order !== undefined ? (safeInt(b.sort_order) || 0) : prev.sort_order

  await c.env.DB.prepare(`
    UPDATE customer_groups SET
      name = ?, color = ?, description = ?, sort_order = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(name, color, description, sortOrder, id).run()

  await logActivity(c.env.DB, 'update', 'customer_group', id, name, '고객 그룹 수정')
  return c.json({ data: { id } })
})

// ─────────────────────────────────────────────────────────────
// DELETE /api/customer-groups/:id
//   (멤버쉽만 함께 삭제, 고객은 유지 - ON DELETE CASCADE)
// ─────────────────────────────────────────────────────────────
app.delete('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const prev = await c.env.DB.prepare('SELECT name FROM customer_groups WHERE id = ?').bind(id).first<any>()
  if (!prev) return apiError(c, 404, 'group not found', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare('DELETE FROM customer_groups WHERE id = ?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'customer_group', id, prev.name, '고객 그룹 삭제')
  return c.json({ data: { id } })
})

// ─────────────────────────────────────────────────────────────
// GET /api/customer-groups/:id/members
//   → 그룹 소속 고객 목록 (요약)
// ─────────────────────────────────────────────────────────────
app.get('/:id/members', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const r = await c.env.DB.prepare(`
    SELECT c.id, c.name, c.phone, c.customer_type, c.status, c.region,
      h.name AS hospital_name, m.added_at
    FROM customer_group_members m
    JOIN customers c ON c.id = m.customer_id
    LEFT JOIN hospitals h ON h.id = c.hospital_id
    WHERE m.group_id = ?
    ORDER BY m.added_at DESC, c.name ASC
  `).bind(id).all()

  return c.json({ data: r.results })
})

// ─────────────────────────────────────────────────────────────
// POST /api/customer-groups/:id/members
//   body: { customer_ids: number[] }
//   (여러 고객을 그룹에 일괄 추가, 이미 있으면 스킵)
// ─────────────────────────────────────────────────────────────
app.post('/:id/members', async (c) => {
  const userId = c.get('userId')
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const b = await c.req.json<any>().catch(() => ({}))
  const rawIds: any[] = Array.isArray(b.customer_ids) ? b.customer_ids : []
  const cids = rawIds.map((x) => safeInt(x)).filter((x): x is number => !!x && x > 0)
  if (!cids.length) return apiError(c, 400, 'customer_ids required', ErrorCodes.VALIDATION)

  const grp = await c.env.DB.prepare('SELECT name FROM customer_groups WHERE id = ?').bind(id).first<any>()
  if (!grp) return apiError(c, 404, 'group not found', ErrorCodes.NOT_FOUND)

  // 배치 삽입 (INSERT OR IGNORE)
  const stmts = cids.map((cid) =>
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO customer_group_members (group_id, customer_id, added_by)
      VALUES (?, ?, ?)
    `).bind(id, cid, userId)
  )
  const results = await c.env.DB.batch(stmts)
  const added = results.reduce((acc, r: any) => acc + (r?.meta?.changes || 0), 0)

  await logActivity(c.env.DB, 'update', 'customer_group', id, grp.name, `${added}명 그룹에 추가`)
  return c.json({ data: { added, requested: cids.length } })
})

// ─────────────────────────────────────────────────────────────
// DELETE /api/customer-groups/:id/members/:customer_id
// ─────────────────────────────────────────────────────────────
app.delete('/:id/members/:customer_id', async (c) => {
  const id = safeInt(c.req.param('id'))
  const cid = safeInt(c.req.param('customer_id'))
  if (!id || !cid) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const grp = await c.env.DB.prepare('SELECT name FROM customer_groups WHERE id = ?').bind(id).first<any>()
  if (!grp) return apiError(c, 404, 'group not found', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare('DELETE FROM customer_group_members WHERE group_id = ? AND customer_id = ?')
    .bind(id, cid).run()

  await logActivity(c.env.DB, 'update', 'customer_group', id, grp.name, `고객#${cid} 그룹에서 제외`)
  return c.json({ data: { id, customer_id: cid } })
})

export default app
