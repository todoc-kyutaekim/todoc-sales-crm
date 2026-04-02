import { Hono } from 'hono'
import { safeLike } from '../helpers'

type Bindings = { DB: D1Database }
const search = new Hono<{ Bindings: Bindings }>()

// Global search across hospitals, doctors, meetings, papers
search.get('/', async (c) => {
  const q = c.req.query('q')
  if (!q || q.trim().length < 1) return c.json({ data: { hospitals: [], doctors: [], meetings: [], papers: [] } })

  const s = `%${safeLike(q.trim())}%`

  const [hospR, docR, meetR, paperR] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, region, grade, status, type FROM hospitals WHERE name LIKE ? OR region LIKE ? OR address LIKE ? LIMIT 10').bind(s, s, s).all(),
    c.env.DB.prepare('SELECT d.id, d.name, d.position, d.department, d.specialty, h.name as hospital_name FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id WHERE d.name LIKE ? OR d.specialty LIKE ? OR d.department LIKE ? LIMIT 10').bind(s, s, s).all(),
    c.env.DB.prepare(`SELECT m.id, m.meeting_date, m.meeting_type, m.purpose, h.name as hospital_name, m.hospital_id,
      (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_name
      FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id 
      WHERE h.name LIKE ? OR m.purpose LIKE ? OR m.content LIKE ? 
        OR m.id IN (SELECT md.meeting_id FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE d.name LIKE ?)
      ORDER BY m.meeting_date DESC LIMIT 10`).bind(s, s, s, s).all(),
    c.env.DB.prepare('SELECT dp.id, dp.title, dp.journal, dp.year, dp.doctor_id, d.name as doctor_name FROM doctor_papers dp LEFT JOIN doctors d ON dp.doctor_id=d.id WHERE dp.title LIKE ? OR dp.journal LIKE ? OR dp.authors LIKE ? LIMIT 10').bind(s, s, s).all(),
  ])

  return c.json({
    data: {
      hospitals: hospR.results,
      doctors: docR.results,
      meetings: meetR.results,
      papers: paperR.results,
    }
  })
})

export default search
