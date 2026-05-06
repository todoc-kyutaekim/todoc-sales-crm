import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const exports = new Hono<{ Bindings: Bindings }>()

function toCsvRow(arr: any[]): string {
  return arr.map(v => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

function ts(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

function escXml(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildSheet(name: string, headers: string[], rows: any[][]): string {
  let xml = `<Worksheet ss:Name="${escXml(name)}"><Table>\n<Row>`
  for (const h of headers) xml += `<Cell ss:StyleID="header"><Data ss:Type="String">${escXml(h)}</Data></Cell>`
  xml += '</Row>\n'
  for (const row of rows) {
    xml += '<Row>'
    for (const cell of row) {
      const v = String(cell ?? '')
      const isNum = v !== '' && !isNaN(Number(v)) && v.length < 15 && !/^0\d/.test(v)
      xml += `<Cell><Data ss:Type="${isNum ? 'Number' : 'String'}">${escXml(v)}</Data></Cell>`
    }
    xml += '</Row>\n'
  }
  xml += '</Table></Worksheet>\n'
  return xml
}

// Export hospitals CSV (includes both hospitals and clinics) — supports ?status=&region=
exports.get('/hospitals', async (c) => {
  const status = c.req.query('status') || ''
  const region = c.req.query('region') || ''
  const where: string[] = []
  const params: any[] = []
  if (status) { where.push('h.status = ?'); params.push(status) }
  if (region) { where.push('h.region = ?'); params.push(region) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const sql = 'SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meeting_doctors md ON d.id = md.doctor_id LEFT JOIN meetings m ON md.meeting_id = m.id AND m.hospital_id = h.id' + whereSql + ' GROUP BY h.id ORDER BY h.name'
  const r = await c.env.DB.prepare(sql).bind(...params).all()
  const header = toCsvRow(['ID', '병원명', '유형', '지역', '주소', '전화번호', '상태', '파이프라인', '우선순위', '토닥접점', '의료진수', '미팅수', '최근미팅', '난청환자', '보청기판매', 'CI의뢰', '메모', '등록일'])
  const rows = (r.results as any[]).map(h => toCsvRow([h.id, h.name, h.type === 'clinic' ? '의원' : '병원', h.region, h.address, h.phone, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.priority || '', h.todoc_contact || '', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0, h.notes, h.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="hospitals_${ts()}.csv"`)
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export doctors CSV — supports ?hospital_id=&department=
exports.get('/doctors', async (c) => {
  const hospitalId = c.req.query('hospital_id') || ''
  const department = c.req.query('department') || ''
  const where: string[] = []
  const params: any[] = []
  if (hospitalId) { where.push('d.hospital_id = ?'); params.push(Number(hospitalId)) }
  if (department) { where.push('d.department = ?'); params.push(department) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const sql = 'SELECT d.*, h.name as hospital_name, COUNT(DISTINCT md.meeting_id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meeting_doctors md ON d.id=md.doctor_id LEFT JOIN meetings m ON md.meeting_id=m.id' + whereSql + ' GROUP BY d.id ORDER BY d.name'
  const r = await c.env.DB.prepare(sql).bind(...params).all()
  const header = toCsvRow(['ID', '이름', '소속병원', '진료과', '직위', '전문분야', '영향력', '전화', '이메일', '미팅수', '최근미팅', '메모', '등록일'])
  const rows = (r.results as any[]).map(d => toCsvRow([d.id, d.name, d.hospital_name, d.department, d.position, d.specialty, d.influence_level, d.phone, d.email, d.meeting_count, d.last_meeting || '', d.notes, d.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="doctors_${ts()}.csv"`)
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export meetings CSV — supports ?from=&to=&type=&hospital_id=
exports.get('/meetings', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const type = c.req.query('type') || ''
  const hospitalId = c.req.query('hospital_id') || ''
  const where: string[] = []
  const params: any[] = []
  if (from) { where.push('m.meeting_date >= ?'); params.push(from) }
  if (to) { where.push('m.meeting_date <= ?'); params.push(to) }
  if (type) { where.push('m.meeting_type = ?'); params.push(type) }
  if (hospitalId) { where.push('m.hospital_id = ?'); params.push(Number(hospitalId)) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const sql = `SELECT m.*,
    (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names,
    (SELECT GROUP_CONCAT(u.name, ', ') FROM meeting_users mu LEFT JOIN users u ON mu.user_id=u.id WHERE mu.meeting_id=m.id) as user_names,
    h.name as hospital_name
    FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id` + whereSql + ' ORDER BY m.meeting_date DESC'
  const r = await c.env.DB.prepare(sql).bind(...params).all()
  const vtMap: Record<string,string> = { am: '오전', pm: '오후', full: '종일' }
  const tyMap: Record<string,string> = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' }
  const header = toCsvRow(['ID', '일자', '시간대', '시작시각', '종료시각', '유형', '의료진', '병원', '담당자', '목적', '내용', '결과', '후속액션', '다음미팅예정', '등록일'])
  const rows = (r.results as any[]).map(m => toCsvRow([m.id, m.meeting_date, vtMap[m.visit_time] || '', m.start_time || '', m.end_time || '', tyMap[m.meeting_type] || m.meeting_type, m.doctor_names || '', m.hospital_name, m.user_names || '', m.purpose, m.content, m.result, m.next_action, m.next_meeting_date || '', m.created_at]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="meetings_${ts()}.csv"`)
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export CI stats CSV
exports.get('/cistats', async (c) => {
  const r = await c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient WHERE gender='계' AND visit_type='계' ORDER BY year ASC").all()
  const header = toCsvRow(['연도', '환자수', '총사용량', '진료금액(천원)'])
  const rows = (r.results as any[]).map(d => toCsvRow([d.year, d.patients, d.usage, d.amount]))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="ci_stats_${ts()}.csv"`)
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export activity log CSV — supports ?from=&to=&entity_type=
exports.get('/activity', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const entityType = c.req.query('entity_type') || ''
  const where: string[] = []
  const params: any[] = []
  if (from) { where.push("DATE(created_at) >= ?"); params.push(from) }
  if (to) { where.push("DATE(created_at) <= ?"); params.push(to) }
  if (entityType) { where.push('entity_type = ?'); params.push(entityType) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const sql = 'SELECT * FROM activity_log' + whereSql + ' ORDER BY created_at DESC LIMIT 5000'
  const r = await c.env.DB.prepare(sql).bind(...params).all()
  const actMap: Record<string,string> = { create: '생성', update: '수정', delete: '삭제' }
  const entMap: Record<string,string> = { hospital: '기관', doctor: '의료진', meeting: '미팅' }
  const header = toCsvRow(['일시', '액션', '대상유형', '대상명', '대상ID', '상세'])
  const rows = (r.results as any[]).map(a => toCsvRow([a.created_at, actMap[a.action] || a.action, entMap[a.entity_type] || a.entity_type, a.entity_name || '', a.entity_id || '', a.details || '']))
  const bom = '\uFEFF'
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="activity_log_${ts()}.csv"`)
  return c.body(bom + header + '\n' + rows.join('\n'))
})

// Export as XLSX (XML Spreadsheet format - opens in Excel)
// Supports same query filters as CSV endpoints
exports.get('/xlsx/:type', async (c) => {
  const type = c.req.param('type')
  let sheets: { name: string; headers: string[]; rows: any[][] }[] = []

  if (type === 'hospitals') {
    const status = c.req.query('status') || ''
    const region = c.req.query('region') || ''
    const where: string[] = []
    const params: any[] = []
    if (status) { where.push('h.status = ?'); params.push(status) }
    if (region) { where.push('h.region = ?'); params.push(region) }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const sql = 'SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meeting_doctors md ON d.id = md.doctor_id LEFT JOIN meetings m ON md.meeting_id = m.id AND m.hospital_id = h.id' + whereSql + ' GROUP BY h.id ORDER BY h.name'
    const r = await c.env.DB.prepare(sql).bind(...params).all()
    sheets.push({
      name: '기관',
      headers: ['ID', '병원명', '유형', '지역', '주소', '전화번호', '상태', '파이프라인', '우선순위', '의료진수', '미팅수', '최근미팅', '난청환자', '보청기판매', 'CI의뢰'],
      rows: (r.results as any[]).map(h => [h.id, h.name, h.type === 'clinic' ? '의원' : '병원', h.region, h.address, h.phone, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.priority || '', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0])
    })
  } else if (type === 'doctors') {
    const hospitalId = c.req.query('hospital_id') || ''
    const department = c.req.query('department') || ''
    const where: string[] = []
    const params: any[] = []
    if (hospitalId) { where.push('d.hospital_id = ?'); params.push(Number(hospitalId)) }
    if (department) { where.push('d.department = ?'); params.push(department) }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const sql = 'SELECT d.*, h.name as hospital_name, COUNT(DISTINCT md.meeting_id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meeting_doctors md ON d.id=md.doctor_id LEFT JOIN meetings m ON md.meeting_id=m.id' + whereSql + ' GROUP BY d.id ORDER BY d.name'
    const r = await c.env.DB.prepare(sql).bind(...params).all()
    sheets.push({
      name: '의료진',
      headers: ['ID', '이름', '소속병원', '진료과', '직위', '전문분야', '영향력', '전화', '이메일', '미팅수', '최근미팅'],
      rows: (r.results as any[]).map(d => [d.id, d.name, d.hospital_name, d.department, d.position, d.specialty, d.influence_level, d.phone, d.email, d.meeting_count, d.last_meeting || ''])
    })
  } else if (type === 'meetings') {
    const from = c.req.query('from') || ''
    const to = c.req.query('to') || ''
    const mtype = c.req.query('type') || ''
    const hospitalId = c.req.query('hospital_id') || ''
    const where: string[] = []
    const params: any[] = []
    if (from) { where.push('m.meeting_date >= ?'); params.push(from) }
    if (to) { where.push('m.meeting_date <= ?'); params.push(to) }
    if (mtype) { where.push('m.meeting_type = ?'); params.push(mtype) }
    if (hospitalId) { where.push('m.hospital_id = ?'); params.push(Number(hospitalId)) }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const sql = `SELECT m.*,
      (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names,
      (SELECT GROUP_CONCAT(u.name, ', ') FROM meeting_users mu LEFT JOIN users u ON mu.user_id=u.id WHERE mu.meeting_id=m.id) as user_names,
      h.name as hospital_name FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id` + whereSql + ' ORDER BY m.meeting_date DESC'
    const r = await c.env.DB.prepare(sql).bind(...params).all()
    const vtMap: Record<string,string> = { am: '오전', pm: '오후', full: '종일' }
    const tyMap: Record<string,string> = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' }
    sheets.push({
      name: '미팅',
      headers: ['ID', '일자', '시간대', '시작시각', '종료시각', '유형', '의료진', '병원', '담당자', '목적', '내용', '결과', '후속액션', '다음미팅예정'],
      rows: (r.results as any[]).map(m => [m.id, m.meeting_date, vtMap[m.visit_time] || '', m.start_time || '', m.end_time || '', tyMap[m.meeting_type] || m.meeting_type, m.doctor_names || '', m.hospital_name, m.user_names || '', m.purpose, m.content, m.result, m.next_action, m.next_meeting_date || ''])
    })
  } else if (type === 'activity') {
    const r = await c.env.DB.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 5000').all()
    const actMap: Record<string,string> = { create: '생성', update: '수정', delete: '삭제' }
    const entMap: Record<string,string> = { hospital: '기관', doctor: '의료진', meeting: '미팅' }
    sheets.push({
      name: '활동로그',
      headers: ['일시', '액션', '대상유형', '대상명', '대상ID', '상세'],
      rows: (r.results as any[]).map(a => [a.created_at, actMap[a.action] || a.action, entMap[a.entity_type] || a.entity_type, a.entity_name || '', a.entity_id || '', a.details || ''])
    })
  } else {
    return c.json({ error: 'Invalid type' }, 400)
  }

  // Generate XML Spreadsheet (compatible with Excel)
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
  xml += '<Styles><Style ss:ID="header"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style></Styles>\n'
  for (const s of sheets) xml += buildSheet(s.name, s.headers, s.rows)
  xml += '</Workbook>'

  c.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="${type}_${ts()}.xls"`)
  return c.body('\uFEFF' + xml)
})

// Comprehensive report — multi-sheet XLSX with summary + hospitals + doctors + meetings + activity
// Supports ?from=&to= for time-bounded report
exports.get('/report/full', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''

  // 1) Hospitals sheet (with stats)
  const hospR = await c.env.DB.prepare('SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meeting_doctors md ON d.id = md.doctor_id LEFT JOIN meetings m ON md.meeting_id = m.id AND m.hospital_id = h.id GROUP BY h.id ORDER BY h.name').all()
  const hospitals = hospR.results as any[]

  // 2) Doctors sheet
  const docR = await c.env.DB.prepare('SELECT d.*, h.name as hospital_name, COUNT(DISTINCT md.meeting_id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meeting_doctors md ON d.id=md.doctor_id LEFT JOIN meetings m ON md.meeting_id=m.id GROUP BY d.id ORDER BY d.name').all()
  const doctors = docR.results as any[]

  // 3) Meetings sheet (filtered by date range if provided)
  const where: string[] = []
  const params: any[] = []
  if (from) { where.push('m.meeting_date >= ?'); params.push(from) }
  if (to) { where.push('m.meeting_date <= ?'); params.push(to) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
  const meetSql = `SELECT m.*,
    (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names,
    (SELECT GROUP_CONCAT(u.name, ', ') FROM meeting_users mu LEFT JOIN users u ON mu.user_id=u.id WHERE mu.meeting_id=m.id) as user_names,
    h.name as hospital_name FROM meetings m LEFT JOIN hospitals h ON m.hospital_id=h.id` + whereSql + ' ORDER BY m.meeting_date DESC'
  const meetR = await c.env.DB.prepare(meetSql).bind(...params).all()
  const meetings = meetR.results as any[]

  // 4) Activity log (last 1000)
  const actR = await c.env.DB.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 1000').all()
  const activities = actR.results as any[]

  // 5) Summary metrics
  const stageCount: Record<string, number> = {}
  const regionCount: Record<string, number> = {}
  for (const h of hospitals) {
    const s = h.pipeline_stage || 'contact'; stageCount[s] = (stageCount[s] || 0) + 1
    const r = h.region || '-'; regionCount[r] = (regionCount[r] || 0) + 1
  }
  const typeCount: Record<string, number> = {}
  for (const m of meetings) { const t = m.meeting_type || '-'; typeCount[t] = (typeCount[t] || 0) + 1 }

  const summaryRows: any[][] = [
    ['집계 시점', new Date().toISOString().substring(0, 19).replace('T', ' ')],
    ['보고서 기간', (from || '전체') + ' ~ ' + (to || '전체')],
    ['', ''],
    ['총 기관 수', hospitals.length],
    ['총 의료진 수', doctors.length],
    ['총 미팅 수', meetings.length],
    ['', ''],
    ['── 파이프라인 단계별 기관 ──', ''],
    ...Object.entries(stageCount).map(([k, v]) => [k, v]),
    ['', ''],
    ['── 지역별 기관 ──', ''],
    ...Object.entries(regionCount).map(([k, v]) => [k, v]),
    ['', ''],
    ['── 미팅 유형별 ──', ''],
    ...Object.entries(typeCount).map(([k, v]) => [k, v]),
  ]

  const vtMap: Record<string,string> = { am: '오전', pm: '오후', full: '종일' }
  const tyMap: Record<string,string> = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' }
  const actMap: Record<string,string> = { create: '생성', update: '수정', delete: '삭제' }
  const entMap: Record<string,string> = { hospital: '기관', doctor: '의료진', meeting: '미팅' }

  const sheets = [
    { name: '요약', headers: ['항목', '값'], rows: summaryRows },
    {
      name: '기관',
      headers: ['ID', '병원명', '유형', '지역', '상태', '파이프라인', '의료진수', '미팅수', '최근미팅', '난청환자', '보청기판매', 'CI의뢰'],
      rows: hospitals.map(h => [h.id, h.name, h.type === 'clinic' ? '의원' : '병원', h.region, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0])
    },
    {
      name: '의료진',
      headers: ['ID', '이름', '소속병원', '진료과', '직위', '전문분야', '영향력', '미팅수', '최근미팅'],
      rows: doctors.map(d => [d.id, d.name, d.hospital_name, d.department, d.position, d.specialty, d.influence_level, d.meeting_count, d.last_meeting || ''])
    },
    {
      name: '미팅',
      headers: ['ID', '일자', '시간대', '시작', '종료', '유형', '의료진', '병원', '담당자', '목적', '결과', '후속액션', '다음미팅'],
      rows: meetings.map(m => [m.id, m.meeting_date, vtMap[m.visit_time] || '', m.start_time || '', m.end_time || '', tyMap[m.meeting_type] || m.meeting_type, m.doctor_names || '', m.hospital_name, m.user_names || '', m.purpose, m.result, m.next_action, m.next_meeting_date || ''])
    },
    {
      name: '활동로그',
      headers: ['일시', '액션', '대상유형', '대상명', '상세'],
      rows: activities.map(a => [a.created_at, actMap[a.action] || a.action, entMap[a.entity_type] || a.entity_type, a.entity_name || '', a.details || ''])
    }
  ]

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
  xml += '<Styles><Style ss:ID="header"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style></Styles>\n'
  for (const s of sheets) xml += buildSheet(s.name, s.headers, s.rows)
  xml += '</Workbook>'

  c.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="todoc_full_report_${ts()}.xls"`)
  return c.body('\uFEFF' + xml)
})

export default exports
