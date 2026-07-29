import { Hono } from 'hono'
import { logActivity, safeLike, safeInt, safeLimit, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// ---------------- 통계 ----------------
// GET /api/cs/kb/stats
app.get('/stats', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published,
      SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft,
      SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END) AS archived,
      SUM(view_count) AS total_views
    FROM cs_kb_articles
  `).first<any>()

  return c.json({ data: rows || { total: 0, published: 0, draft: 0, archived: 0, total_views: 0 } })
})

// ---------------- 목록 ----------------
// GET /api/cs/kb?search=&category=&status=&visibility=&limit=
app.get('/', async (c) => {
  const { search, category, status, visibility, limit } = c.req.query()
  const lim = safeLimit(limit, 500)

  let q = `
    SELECT kb.id, kb.category, kb.title,
      substr(kb.content, 1, 200) AS excerpt,
      kb.tags, kb.visibility, kb.status, kb.view_count,
      kb.author_id, kb.created_at, kb.updated_at,
      u.name AS author_name
    FROM cs_kb_articles kb
    LEFT JOIN users u ON u.id = kb.author_id
  `
  const conds: string[] = []
  const params: any[] = []
  if (category) { conds.push('kb.category = ?'); params.push(category) }
  if (status) { conds.push('kb.status = ?'); params.push(status) }
  if (visibility) { conds.push('kb.visibility = ?'); params.push(visibility) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push('(kb.title LIKE ? OR kb.content LIKE ? OR kb.tags LIKE ?)')
    params.push(s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += `
    ORDER BY
      CASE kb.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END ASC,
      kb.updated_at DESC
    LIMIT ?
  `
  params.push(lim)

  const { results } = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: results || [] })
})

// ---------------- 상세 (조회수 증가) ----------------
// GET /api/cs/kb/:id?count=1  → count=1 이면 조회수 증가
app.get('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const count = c.req.query('count')

  const row = await c.env.DB.prepare(`
    SELECT kb.*, u.name AS author_name
    FROM cs_kb_articles kb
    LEFT JOIN users u ON u.id = kb.author_id
    WHERE kb.id = ?
  `).bind(id).first<any>()

  if (!row) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  // 조회수 증가 (published 상태만)
  if (count === '1' && row.status === 'published') {
    try {
      await c.env.DB.prepare('UPDATE cs_kb_articles SET view_count = view_count + 1 WHERE id = ?').bind(id).run()
      row.view_count = (row.view_count || 0) + 1
    } catch (e) { /* ignore */ }
  }

  return c.json({ data: row })
})

// ---------------- 생성 ----------------
app.post('/', async (c) => {
  const userId = c.get('userId')
  const b = await c.req.json<any>().catch(() => ({}))

  if (!b.title || !String(b.title).trim()) {
    return apiError(c, 400, 'title is required', ErrorCodes.VALIDATION)
  }

  // tags 정규화 (배열 또는 콤마 문자열 → JSON 배열)
  let tags: string | null = null
  if (Array.isArray(b.tags)) {
    tags = JSON.stringify(b.tags.filter((t: any) => t && String(t).trim()).map((t: any) => String(t).trim()))
  } else if (typeof b.tags === 'string' && b.tags.trim()) {
    tags = JSON.stringify(b.tags.split(',').map((t: string) => t.trim()).filter(Boolean))
  }

  const res = await c.env.DB.prepare(`
    INSERT INTO cs_kb_articles
      (category, title, content, tags, visibility, status, author_id)
    VALUES (?,?,?,?,?,?,?)
  `).bind(
    b.category || 'other',
    String(b.title).trim(),
    b.content || '',
    tags,
    b.visibility || 'internal',
    b.status || 'published',
    userId
  ).run()

  const newId = res.meta.last_row_id
  await logActivity(c.env.DB, 'create', 'cs_kb', newId as number, String(b.title).trim(), 'KB 문서 생성')
  return c.json({ data: { id: newId } })
})

// ---------------- 수정 ----------------
app.put('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)
  const b = await c.req.json<any>().catch(() => ({}))

  const prev = await c.env.DB.prepare('SELECT * FROM cs_kb_articles WHERE id = ?').bind(id).first<any>()
  if (!prev) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  // tags 정규화
  let tags: string | null = prev.tags
  if (b.tags !== undefined) {
    if (Array.isArray(b.tags)) {
      tags = JSON.stringify(b.tags.filter((t: any) => t && String(t).trim()).map((t: any) => String(t).trim()))
    } else if (typeof b.tags === 'string') {
      tags = b.tags.trim() ? JSON.stringify(b.tags.split(',').map((t: string) => t.trim()).filter(Boolean)) : null
    } else if (b.tags === null) {
      tags = null
    }
  }

  await c.env.DB.prepare(`
    UPDATE cs_kb_articles SET
      category = COALESCE(?, category),
      title = COALESCE(?, title),
      content = COALESCE(?, content),
      tags = ?,
      visibility = COALESCE(?, visibility),
      status = COALESCE(?, status),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    b.category || null,
    b.title ? String(b.title).trim() : null,
    b.content != null ? b.content : null,
    tags,
    b.visibility || null,
    b.status || null,
    id
  ).run()

  await logActivity(c.env.DB, 'update', 'cs_kb', id, b.title || prev.title, 'KB 문서 수정')
  return c.json({ data: { id } })
})

// ---------------- 삭제 ----------------
app.delete('/:id', async (c) => {
  const id = safeInt(c.req.param('id'))
  if (!id) return apiError(c, 400, 'invalid id', ErrorCodes.VALIDATION)

  const prev = await c.env.DB.prepare('SELECT title FROM cs_kb_articles WHERE id = ?').bind(id).first<any>()
  if (!prev) return apiError(c, 404, 'not found', ErrorCodes.NOT_FOUND)

  await c.env.DB.prepare('DELETE FROM cs_kb_articles WHERE id = ?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'cs_kb', id, prev.title, 'KB 문서 삭제')
  return c.json({ data: { id } })
})

export default app
