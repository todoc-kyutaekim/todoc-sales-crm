import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const exports = new Hono<{ Bindings: Bindings }>()

function toCsvRow(arr: string[]): string {
  return arr.map(v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

// Export hospitals CSV
exports.get('/hospitals', async (c) => {
  const r = await c.env.DB.prepare('SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meetings m ON h.id = m.hospital_id GROUP BY h.id ORDER BY h.name').all()
  const header = toCsvRow(['ID', '병원명', '지역', '주소', '전화번호', '등급', '상태', '교수수', '미팅수', '최근미팅', '메모', '등록일'])
  const rows = (r.results as any[]).map(h => toCsvRow([h.id, h.name, h.region, h.address, h.phone, h.grade, h.status, h.doctor_count, h.meeting_count, h.last_meeting || '', h.notes, h.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="hospitals.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export doctors CSV
exports.get('/doctors', async (c) => {
  const r = await c.env.DB.prepare('SELECT d.*, h.name as hospital_name, COUNT(m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meetings m ON d.id=m.doctor_id GROUP BY d.id ORDER BY d.name').all()
  const header = toCsvRow(['ID', '이름', '소속병원', '진료과', '직위', '전문분야', '영향력', '전화', '이메일', '미팅수', '최근미팅', '메모', '등록일'])
  const rows = (r.results as any[]).map(d => toCsvRow([d.id, d.name, d.hospital_name, d.department, d.position, d.specialty, d.influence_level, d.phone, d.email, d.meeting_count, d.last_meeting || '', d.notes, d.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="doctors.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export meetings CSV
exports.get('/meetings', async (c) => {
  const r = await c.env.DB.prepare('SELECT m.*, d.name as doctor_name, h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id=d.id LEFT JOIN hospitals h ON m.hospital_id=h.id ORDER BY m.meeting_date DESC').all()
  const header = toCsvRow(['ID', '일자', '유형', '교수', '병원', '목적', '내용', '결과', '후속액션', '다음미팅예정', '등록일'])
  const rows = (r.results as any[]).map(m => toCsvRow([m.id, m.meeting_date, m.meeting_type, m.doctor_name, m.hospital_name, m.purpose, m.content, m.result, m.next_action, m.next_meeting_date || '', m.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="meetings.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export CI stats CSV
exports.get('/cistats', async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient WHERE gender='계' AND visit_type='계' ORDER BY year ASC").all()
  const header = toCsvRow(['연도', '환자수', '총사용량', '진료금액(천원)'])
  const rows = (r.results as any[]).map(d => toCsvRow([d.year, d.patients, d.usage, d.amount]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="ci_stats.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

export default exports
