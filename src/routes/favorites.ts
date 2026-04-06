import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const favorites = new Hono<{ Bindings: Bindings }>()

// Get all favorites for current user (user_id from session)
favorites.get('/', async (c) => {
  const sid = c.req.header('X-Session-Id') || ''
  const session = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE id=?').bind(sid).first() as any
  const userId = session?.user_id || 0
  const r = await c.env.DB.prepare(
    `SELECT f.*, 
      CASE WHEN f.entity_type='hospital' THEN (SELECT name FROM hospitals WHERE id=f.entity_id)
           WHEN f.entity_type='doctor' THEN (SELECT name FROM doctors WHERE id=f.entity_id)
      END as entity_name,
      CASE WHEN f.entity_type='hospital' THEN (SELECT region FROM hospitals WHERE id=f.entity_id)
           WHEN f.entity_type='doctor' THEN (SELECT h.name FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id WHERE d.id=f.entity_id)
      END as entity_detail
    FROM favorites f WHERE f.user_id=? ORDER BY f.created_at DESC`
  ).bind(userId).all()
  return c.json({ data: r.results })
})

// Toggle favorite
favorites.post('/toggle', async (c) => {
  const { entity_type, entity_id } = await c.req.json()
  if (!entity_type || !entity_id) return c.json({ error: 'entity_type and entity_id required' }, 400)
  const sid = c.req.header('X-Session-Id') || ''
  const session = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE id=?').bind(sid).first() as any
  const userId = session?.user_id || 0
  
  const exists = await c.env.DB.prepare(
    'SELECT id FROM favorites WHERE entity_type=? AND entity_id=? AND user_id=?'
  ).bind(entity_type, Number(entity_id), userId).first()
  
  if (exists) {
    await c.env.DB.prepare('DELETE FROM favorites WHERE entity_type=? AND entity_id=? AND user_id=?')
      .bind(entity_type, Number(entity_id), userId).run()
    return c.json({ data: { favorited: false } })
  } else {
    await c.env.DB.prepare('INSERT INTO favorites (entity_type, entity_id, user_id) VALUES (?, ?, ?)')
      .bind(entity_type, Number(entity_id), userId).run()
    return c.json({ data: { favorited: true } })
  }
})

// Check if favorited
favorites.get('/check/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  const sid = c.req.header('X-Session-Id') || ''
  const session = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE id=?').bind(sid).first() as any
  const userId = session?.user_id || 0
  const exists = await c.env.DB.prepare(
    'SELECT id FROM favorites WHERE entity_type=? AND entity_id=? AND user_id=?'
  ).bind(entityType, Number(entityId), userId).first()
  return c.json({ data: { favorited: !!exists } })
})

export default favorites
