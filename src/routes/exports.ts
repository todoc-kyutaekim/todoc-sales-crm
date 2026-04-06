import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const exports = new Hono<{ Bindings: Bindings }>()

function toCsvRow(arr: string[]): string {
  return arr.map(v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

// Export hospitals CSV (includes both hospitals and clinics)
exports.get('/hospitals', async (c) => {
  const r = await c.env.DB.prepare('SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meeting_doctors md ON d.id = md.doctor_id LEFT JOIN meetings m ON md.meeting_id = m.id AND m.hospital_id = h.id GROUP BY h.id ORDER BY h.name').all()
  const header = toCsvRow(['ID', '병원명', '유형', '지역', '주소', '전화번호', '등급', '상태', '우선순위', '토닥접점', '의료진수', '미팅수', '최근미팅', '난청환자', '보청기판매', 'CI의뢰', '메모', '등록일'])
  const rows = (r.results as any[]).map(h => toCsvRow([h.id, h.name, h.type === 'clinic' ? '의원' : '병원', h.region, h.address, h.phone, h.grade, h.status, h.priority || '', h.todoc_contact || '', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0, h.notes, h.created_at]))
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
  const header = toCsvRow(['ID', '일자', '유형', '의료진', '병원', '목적', '내용', '결과', '후속액션', '다음미팅예정', '등록일'])
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

// Export as XLSX (XML Spreadsheet format - opens in Excel)
exports.get('/xlsx/:type', async (c) => {
  const type = c.req.param('type')
  let headers: string[] = []
  let rows: string[][] = []

  if (type === 'hospitals') {
    const r = await c.env.DB.prepare('SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meeting_doctors md ON d.id = md.doctor_id LEFT JOIN meetings m ON md.meeting_id = m.id AND m.hospital_id = h.id GROUP BY h.id ORDER BY h.name').all()
    headers = ['ID', '병원명', '유형', '지역', '주소', '전화번호', '등급', '상태', '파이프라인', '우선순위', '의료진수', '미팅수', '최근미팅', '난청환자', '보청기판매', 'CI의뢰']
    rows = (r.results as any[]).map(h => [h.id, h.name, h.type === 'clinic' ? '의원' : '병원', h.region, h.address, h.phone, h.grade, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.priority || '', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0])
  } else if (type === 'doctors') {
    const r = await c.env.DB.prepare('SELECT d.*, h.name as hospital_name, COUNT(DISTINCT md.meeting_id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meeting_doctors md ON d.id=md.doctor_id LEFT JOIN meetings m ON md.meeting_id=m.id GROUP BY d.id ORDER BY d.name').all()
    headers = ['ID', '이름', '소속병원', '진료과', '직위', '전문분야', '영향력', '전화', '이메일', '미팅수', '최근미팅']
    rows = (r.results as any[]).map(d => [d.id, d.name, d.hospital_name, d.department, d.position, d.specialty, d.influence_level, d.phone, d.email, d.meeting_count, d.last_meeting || ''])
  } else if (type === 'meetings') {
    const r = await c.env.DB.prepare(`SELECT m.*, 
      (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names,
      h.name as hospital_name FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id ORDER BY m.meeting_date DESC`).all()
    headers = ['ID', '일자', '유형', '의료진', '병원', '목적', '내용', '결과', '후속액션', '다음미팅예정']
    rows = (r.results as any[]).map(m => [m.id, m.meeting_date, m.meeting_type, m.doctor_names || '', m.hospital_name, m.purpose, m.content, m.result, m.next_action, m.next_meeting_date || ''])
  } else {
    return c.json({ error: 'Invalid type' }, 400)
  }

  // Generate XML Spreadsheet (compatible with Excel)
  const escXml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
  xml += '<Styles><Style ss:ID="header"><Font ss:Bold="1" ss:Size="11"/><Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/></Style></Styles>\n'
  xml += '<Worksheet ss:Name="데이터"><Table>\n'
  // Header row
  xml += '<Row>'
  for (const h of headers) xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${escXml(h)}</Data></Cell>`
  xml += '</Row>\n'
  // Data rows
  for (const row of rows) {
    xml += '<Row>'
    for (const cell of row) {
      const v = String(cell ?? '')
      const isNum = v !== '' && !isNaN(Number(v)) && v.length < 15
      xml += `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escXml(v)}</Data></Cell>`
    }
    xml += '</Row>\n'
  }
  xml += '</Table></Worksheet></Workbook>'

  c.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${type}.xls"`)
  return c.body(xml)
})

export default exports
