import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const tags = new Hono<{ Bindings: Bindings }>()

// Get all tags
tags.get('/', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM tags ORDER BY name').all()
  return c.json({ data: r.results })
})

// Create tag
tags.post('/', async (c) => {
  const { name, color } = await c.req.json()
  if (!name) return c.json({ error: 'name is required' }, 400)
  try {
    const r = await c.env.DB.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').bind(name.trim(), color || '#64748b').run()
    return c.json({ data: { id: r.meta.last_row_id, name: name.trim(), color } }, 201)
  } catch (e) {
    return c.json({ error: 'Tag already exists' }, 409)
  }
})

// Delete tag
tags.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM entity_tags WHERE tag_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM tags WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// Get tags for an entity
tags.get('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  const r = await c.env.DB.prepare(
    'SELECT t.* FROM tags t INNER JOIN entity_tags et ON t.id=et.tag_id WHERE et.entity_type=? AND et.entity_id=?'
  ).bind(entityType, entityId).all()
  return c.json({ data: r.results })
})

// Add tag to entity
tags.post('/:entityType/:entityId', async (c) => {
  const { entityType, entityId } = c.req.param()
  const { tag_id } = await c.req.json()
  if (!tag_id) return c.json({ error: 'tag_id required' }, 400)
  try {
    await c.env.DB.prepare('INSERT INTO entity_tags (entity_type, entity_id, tag_id) VALUES (?, ?, ?)')
      .bind(entityType, Number(entityId), tag_id).run()
    return c.json({ success: true }, 201)
  } catch (e) {
    return c.json({ error: 'Already tagged' }, 409)
  }
})

// Remove tag from entity
tags.delete('/:entityType/:entityId/:tagId', async (c) => {
  const { entityType, entityId, tagId } = c.req.param()
  await c.env.DB.prepare('DELETE FROM entity_tags WHERE entity_type=? AND entity_id=? AND tag_id=?')
    .bind(entityType, Number(entityId), Number(tagId)).run()
  return c.json({ success: true })
})

export default tags
