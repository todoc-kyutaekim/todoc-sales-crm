import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { user?: { id: number, name: string, email: string } }
const comments = new Hono<{ Bindings: Bindings, Variables: Variables }>()

// Extract @mentions from text. Pattern: @[name](id) or @username
// We use the explicit @[Name](user_id) form when frontend builds it,
// fall back to plain @name parsing if needed.
function extractMentionIds(content: string): number[] {
  const ids = new Set<number>()
  const re = /@\[[^\]]+\]\((\d+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const id = Number(m[1])
    if (!isNaN(id)) ids.add(id)
  }
  return Array.from(ids)
}

// GET /api/comments/meeting/:id  — list comments of a meeting
comments.get('/meeting/:id', async (c) => {
  const meetingId = Number(c.req.param('id'))
  if (!meetingId) return c.json({ error: 'Invalid meeting id' }, 400)
  const r = await c.env.DB.prepare(`
    SELECT mc.*, u.name as user_name, u.email as user_email
    FROM meeting_comments mc
    LEFT JOIN users u ON mc.user_id = u.id
    WHERE mc.meeting_id = ?
    ORDER BY mc.created_at ASC
  `).bind(meetingId).all()
  return c.json({ data: r.results })
})

// POST /api/comments/meeting/:id  — add a comment
comments.post('/meeting/:id', async (c) => {
  const meetingId = Number(c.req.param('id'))
  if (!meetingId) return c.json({ error: 'Invalid meeting id' }, 400)
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as any
  const content = String(body.content || '').trim()
  if (!content) return c.json({ error: 'content required' }, 400)
  if (content.length > 2000) return c.json({ error: 'content too long' }, 400)

  const mentionIds = extractMentionIds(content)
  const mentionsJson = mentionIds.length ? JSON.stringify(mentionIds) : null

  const result = await c.env.DB.prepare(
    `INSERT INTO meeting_comments (meeting_id, user_id, content, mentions, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','+9 hours'), datetime('now','+9 hours'))`
  ).bind(meetingId, user.id, content, mentionsJson).run()

  const cid = Number(result.meta.last_row_id)

  // Insert mention notifications (skip self-mention)
  for (const uid of mentionIds) {
    if (uid === user.id) continue
    await c.env.DB.prepare(
      `INSERT INTO mention_notifications (comment_id, user_id, created_at) VALUES (?, ?, datetime('now','+9 hours'))`
    ).bind(cid, uid).run().catch(() => {})
  }

  // Return the new comment with user info
  const created = await c.env.DB.prepare(
    `SELECT mc.*, u.name as user_name, u.email as user_email
     FROM meeting_comments mc LEFT JOIN users u ON mc.user_id = u.id
     WHERE mc.id = ?`
  ).bind(cid).first()
  return c.json({ data: created })
})

// PUT /api/comments/:id  — update own comment
comments.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'Invalid id' }, 400)
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as any
  const content = String(body.content || '').trim()
  if (!content) return c.json({ error: 'content required' }, 400)

  const existing = await c.env.DB.prepare('SELECT user_id FROM meeting_comments WHERE id = ?').bind(id).first() as any
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403)

  const mentionIds = extractMentionIds(content)
  const mentionsJson = mentionIds.length ? JSON.stringify(mentionIds) : null
  await c.env.DB.prepare(
    `UPDATE meeting_comments SET content = ?, mentions = ?, updated_at = datetime('now','+9 hours') WHERE id = ?`
  ).bind(content, mentionsJson, id).run()
  return c.json({ ok: true })
})

// DELETE /api/comments/:id
comments.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'Invalid id' }, 400)
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  const existing = await c.env.DB.prepare('SELECT user_id FROM meeting_comments WHERE id = ?').bind(id).first() as any
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== user.id) return c.json({ error: 'Forbidden' }, 403)
  await c.env.DB.prepare('DELETE FROM meeting_comments WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// GET /api/comments/mentions  — current user's unread mentions
comments.get('/mentions', async (c) => {
  try {
    const user = c.get('user')
    if (!user) return c.json({ error: 'Unauthorized' }, 401)
    const r = await c.env.DB.prepare(`
      SELECT mn.id as notif_id, mn.read_at, mn.created_at as notif_created_at,
        mc.id as comment_id, mc.meeting_id, mc.content, mc.user_id as author_id,
        u.name as author_name,
        m.meeting_date, h.name as hospital_name
      FROM mention_notifications mn
      LEFT JOIN meeting_comments mc ON mn.comment_id = mc.id
      LEFT JOIN users u ON mc.user_id = u.id
      LEFT JOIN meetings m ON mc.meeting_id = m.id
      LEFT JOIN hospitals h ON m.hospital_id = h.id
      WHERE mn.user_id = ?
      ORDER BY mn.created_at DESC LIMIT 50
    `).bind(user.id).all()
    const unread = (r.results as any[]).filter(x => !x.read_at).length
    return c.json({ data: r.results, unread })
  } catch (err: any) {
    console.error('[GET /api/comments/mentions] error:', err && err.message, err && err.stack)
    return c.json({ error: 'mentions_list_failed', message: String(err && err.message || err) }, 500)
  }
})

// POST /api/comments/mentions/:id/read
comments.post('/mentions/:id/read', async (c) => {
  const id = Number(c.req.param('id'))
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  await c.env.DB.prepare(
    `UPDATE mention_notifications SET read_at = datetime('now','+9 hours') WHERE id = ? AND user_id = ?`
  ).bind(id, user.id).run()
  return c.json({ ok: true })
})

// POST /api/comments/mentions/read-all
comments.post('/mentions/read-all', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Unauthorized' }, 401)
  await c.env.DB.prepare(
    `UPDATE mention_notifications SET read_at = datetime('now','+9 hours') WHERE user_id = ? AND read_at IS NULL`
  ).bind(user.id).run()
  return c.json({ ok: true })
})

export default comments
