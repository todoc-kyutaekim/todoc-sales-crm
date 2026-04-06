import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const templates = new Hono<{ Bindings: Bindings }>()

// Get all meeting templates
templates.get('/', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM meeting_templates ORDER BY name').all()
  return c.json({ data: r.results })
})

// Create template
templates.post('/', async (c) => {
  const { name, meeting_type, purpose, content } = await c.req.json()
  if (!name) return c.json({ error: 'name required' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO meeting_templates (name, meeting_type, purpose, content) VALUES (?, ?, ?, ?)'
  ).bind(name.trim(), meeting_type || 'visit', purpose || '', content || '').run()
  return c.json({ data: { id: r.meta.last_row_id, name, meeting_type, purpose, content } }, 201)
})

// Update template
templates.put('/:id', async (c) => {
  const id = c.req.param('id')
  const { name, meeting_type, purpose, content } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE meeting_templates SET name=?, meeting_type=?, purpose=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(name || '', meeting_type || 'visit', purpose || '', content || '', id).run()
  return c.json({ data: { id: Number(id), name, meeting_type, purpose, content } })
})

// Delete template
templates.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM meeting_templates WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

export default templates
