import { Hono } from 'hono'
import { safeLimit } from '../helpers'

type Bindings = { DB: D1Database }
const activity = new Hono<{ Bindings: Bindings }>()

activity.get('/', async (c) => {
  const { limit, entity_type } = c.req.query()
  let q = 'SELECT * FROM activity_log'
  const conds: string[] = [], p: any[] = []
  if (entity_type) { conds.push('entity_type=?'); p.push(entity_type) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ` ORDER BY created_at DESC LIMIT ${safeLimit(limit, 50)}`
  const r = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ data: r.results })
})

export default activity
