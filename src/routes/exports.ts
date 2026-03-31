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
  const r = await c.env.DB.prepare('SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meeting_doctors md ON d.id = md.doctor_id LEFT JOIN meetings m ON md.meeting_id = m.id AND m.hospital_id = h.id GROUP BY h.id ORDER BY h.name').all()
  const header = toCsvRow(['ID', '병원명', '지역', '주소', '전화번호', '등급', '상태', '교수수', '미팅수', '최근미팅', '메모', '등록일'])
  const rows = (r.results as any[]).map(h => toCsvRow([h.id, h.name, h.region, h.address, h.phone, h.grade, h.status, h.doctor_count, h.meeting_count, h.last_meeting || '', h.notes, h.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="hospitals.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export doctors CSV
exports.get('/doctors', async (c) => {
  const r = await c.env.DB.prepare('SELECT d.*, h.name as hospital_name, COUNT(DISTINCT md.meeting_id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meeting_doctors md ON d.id=md.doctor_id LEFT JOIN meetings m ON md.meeting_id=m.id GROUP BY d.id ORDER BY d.name').all()
  const header = toCsvRow(['ID', '이름', '소속병원', '진료과', '직위', '전문분야', '영향력', '전화', '이메일', '미팅수', '최근미팅', '메모', '등록일'])
  const rows = (r.results as any[]).map(d => toCsvRow([d.id, d.name, d.hospital_name, d.department, d.position, d.specialty, d.influence_level, d.phone, d.email, d.meeting_count, d.last_meeting || '', d.notes, d.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="doctors.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export meetings CSV
exports.get('/meetings', async (c) => {
  const r = await c.env.DB.prepare(`SELECT m.*, 
    (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names,
    h.name as hospital_name 
    FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id ORDER BY m.meeting_date DESC`).all()
  const header = toCsvRow(['ID', '일자', '유형', '교수', '병원', '목적', '내용', '결과', '후속액션', '다음미팅예정', '등록일'])
  const rows = (r.results as any[]).map(m => toCsvRow([m.id, m.meeting_date, m.meeting_type, m.doctor_names || '', m.hospital_name, m.purpose, m.content, m.result, m.next_action, m.next_meeting_date || '', m.created_at]))
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

// Export clinics CSV
exports.get('/clinics', async (c) => {
  const r = await c.env.DB.prepare(`SELECT cl.*, COUNT(DISTINCT cc.id) as contact_count, COUNT(DISTINCT cv.id) as visit_count, MAX(cv.visit_date) as last_visit 
    FROM clinics cl LEFT JOIN clinic_contacts cc ON cl.id=cc.clinic_id LEFT JOIN clinic_visits cv ON cl.id=cv.clinic_id 
    GROUP BY cl.id ORDER BY cl.name`).all()
  const header = toCsvRow(['ID', '의원명', '지역', '주소', '전화번호', '우선순위', '토닥접점', '상태', '관계자수', '방문수', '최근방문', '환자수', '보청기판매', 'CI의뢰', '메모', '등록일'])
  const rows = (r.results as any[]).map(cl => toCsvRow([cl.id, cl.name, cl.region, cl.address, cl.phone, cl.priority, cl.todoc_contact, cl.status, cl.contact_count, cl.visit_count, cl.last_visit || '', cl.patient_count, cl.hearing_aid_sales, cl.ci_referrals, cl.notes, cl.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', 'attachment; filename="clinics.csv"')
  return c.body(bom + header + '\n' + rows.join('\n'))
})

export default exports
