import { Hono } from 'hono'
import { logActivity, safeInt, safeLimit, safeLike } from '../helpers'

type Bindings = { DB: D1Database }
const meetings = new Hono<{ Bindings: Bindings }>()

// Helper: get doctors for a list of meeting IDs
async function getMeetingDoctors(db: D1Database, meetingIds: number[]): Promise<Map<number, any[]>> {
  const map = new Map<number, any[]>()
  if (!meetingIds.length) return map
  // Batch query meeting_doctors join doctors
  const placeholders = meetingIds.map(() => '?').join(',')
  const r = await db.prepare(
    `SELECT md.meeting_id, d.id as doctor_id, d.name as doctor_name, d.photo as doctor_photo, d.position as doctor_position
     FROM meeting_doctors md
     LEFT JOIN doctors d ON md.doctor_id = d.id
     WHERE md.meeting_id IN (${placeholders})
     ORDER BY md.meeting_id, d.name`
  ).bind(...meetingIds).all()
  for (const row of r.results as any[]) {
    if (!map.has(row.meeting_id)) map.set(row.meeting_id, [])
    map.get(row.meeting_id)!.push({
      id: row.doctor_id,
      name: row.doctor_name,
      photo: row.doctor_photo,
      position: row.doctor_position,
    })
  }
  return map
}

// Helper: sync meeting_doctors for a meeting
async function syncMeetingDoctors(db: D1Database, meetingId: number, doctorIds: number[]) {
  // Delete existing
  await db.prepare('DELETE FROM meeting_doctors WHERE meeting_id = ?').bind(meetingId).run()
  // Insert new
  for (const did of doctorIds) {
    await db.prepare('INSERT INTO meeting_doctors (meeting_id, doctor_id) VALUES (?, ?)').bind(meetingId, did).run()
  }
}

// Extract doctor_ids from request body (supports both doctor_id single and doctor_ids array)
function extractDoctorIds(body: any): number[] {
  if (Array.isArray(body.doctor_ids) && body.doctor_ids.length > 0) {
    return body.doctor_ids.map((id: any) => Number(id)).filter((id: number) => id > 0)
  }
  if (body.doctor_id) {
    return [Number(body.doctor_id)].filter(id => id > 0)
  }
  return []
}

meetings.get('/', async (c) => {
  const { doctor_id, hospital_id, limit, meeting_type, date_from, date_to, search } = c.req.query()
  
  let q = 'SELECT m.*, h.name as hospital_name FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id'
  const conds: string[] = [], p: any[] = []
  
  if (doctor_id) {
    // Filter by doctor: check meeting_doctors join table
    conds.push('m.id IN (SELECT meeting_id FROM meeting_doctors WHERE doctor_id = ?)')
    p.push(safeInt(doctor_id))
  }
  if (hospital_id) { conds.push('m.hospital_id=?'); p.push(safeInt(hospital_id)) }
  if (meeting_type) { conds.push('m.meeting_type=?'); p.push(meeting_type) }
  if (date_from) { conds.push('m.meeting_date>=?'); p.push(date_from) }
  if (date_to) { conds.push('m.meeting_date<=?'); p.push(date_to) }
  if (search) {
    const s = `%${safeLike(search)}%`
    conds.push(`(h.name LIKE ? OR m.purpose LIKE ? OR m.content LIKE ? OR m.id IN (
      SELECT md.meeting_id FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE d.name LIKE ?
    ))`)
    p.push(s, s, s, s)
  }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY m.meeting_date DESC'
  if (limit) q += ` LIMIT ${safeLimit(limit, 200)}`
  
  const r = await c.env.DB.prepare(q).bind(...p).all()
  const meetingsList = r.results as any[]
  
  // Fetch doctors for all meetings
  const meetingIds = meetingsList.map(m => m.id)
  const doctorsMap = await getMeetingDoctors(c.env.DB, meetingIds)
  
  // Attach doctors array to each meeting + backward compat fields
  const data = meetingsList.map(m => {
    const doctors = doctorsMap.get(m.id) || []
    return {
      ...m,
      doctors,
      doctor_ids: doctors.map((d: any) => d.id),
      // Backward compat: first doctor info
      doctor_id: doctors.length > 0 ? doctors[0].id : m.doctor_id,
      doctor_name: doctors.length > 0 ? doctors.map((d: any) => d.name).join(', ') : null,
      doctor_photo: doctors.length > 0 ? doctors[0].photo : null,
    }
  })
  
  return c.json({ data })
})

meetings.post('/', async (c) => {
  const b = await c.req.json()
  const doctorIds = extractDoctorIds(b)
  if (!doctorIds.length) return c.json({ error: 'doctor_id or doctor_ids is required' }, 400)
  if (!b.hospital_id) return c.json({ error: 'hospital_id is required' }, 400)
  if (!b.meeting_date) return c.json({ error: 'meeting_date is required' }, 400)
  
  // Insert meeting (keep doctor_id as first doctor for backward compat)
  const primaryDoctorId = doctorIds[0]
  const r = await c.env.DB.prepare('INSERT INTO meetings (doctor_id,hospital_id,meeting_date,meeting_type,purpose,content,result,next_action,next_meeting_date) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(primaryDoctorId, b.hospital_id, b.meeting_date, b.meeting_type || 'visit', b.purpose || '', b.content || '', b.result || '', b.next_action || '', b.next_meeting_date || null).run()
  
  const meetingId = r.meta.last_row_id as number
  
  // Sync meeting_doctors
  await syncMeetingDoctors(c.env.DB, meetingId, doctorIds)
  
  // Get doctor names for activity log
  const names: string[] = []
  for (const did of doctorIds) {
    const doc = await c.env.DB.prepare('SELECT name FROM doctors WHERE id=?').bind(did).first() as any
    if (doc?.name) names.push(doc.name)
  }
  await logActivity(c.env.DB, 'create', 'meeting', meetingId, names.join(', '), `type:${b.meeting_type || 'visit'}, purpose:${b.purpose || ''}`)
  
  return c.json({ data: { id: meetingId, ...b, doctor_ids: doctorIds } }, 201)
})

meetings.put('/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  const doctorIds = extractDoctorIds(b)
  if (!doctorIds.length) return c.json({ error: 'doctor_id or doctor_ids is required' }, 400)
  if (!b.hospital_id || !b.meeting_date) return c.json({ error: 'Required fields missing' }, 400)
  
  const primaryDoctorId = doctorIds[0]
  await c.env.DB.prepare('UPDATE meetings SET doctor_id=?,hospital_id=?,meeting_date=?,meeting_type=?,purpose=?,content=?,result=?,next_action=?,next_meeting_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(primaryDoctorId, b.hospital_id, b.meeting_date, b.meeting_type || 'visit', b.purpose || '', b.content || '', b.result || '', b.next_action || '', b.next_meeting_date || null, id).run()
  
  // Sync meeting_doctors
  await syncMeetingDoctors(c.env.DB, Number(id), doctorIds)
  
  await logActivity(c.env.DB, 'update', 'meeting', Number(id), '', `type:${b.meeting_type}`)
  return c.json({ data: { id: Number(id), ...b, doctor_ids: doctorIds } })
})

meetings.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM meeting_doctors WHERE meeting_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(id).run()
  await logActivity(c.env.DB, 'delete', 'meeting', Number(id), '')
  return c.json({ success: true })
})

// Quick list of hospitals + doctors for global meeting form
meetings.get('/form-data', async (c) => {
  const [hosps, docs] = await Promise.all([
    c.env.DB.prepare('SELECT id, name, region FROM hospitals WHERE status="active" ORDER BY name').all(),
    c.env.DB.prepare('SELECT d.id, d.name, d.hospital_id, d.position, h.name as hospital_name FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id ORDER BY d.name').all(),
  ])
  return c.json({ data: { hospitals: hosps.results, doctors: docs.results } })
})

export default meetings
