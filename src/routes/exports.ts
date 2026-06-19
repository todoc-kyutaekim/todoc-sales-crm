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
  } else if (type === 'products') {
    // 제품 재고 현황 (유닛 + 보유자) + 카테고리별 요약
    const category = c.req.query('category') || ''
    const status = c.req.query('status') || ''
    const where: string[] = []
    const params: any[] = []
    if (category) { where.push('p.category = ?'); params.push(category) }
    if (status) { where.push('pu.status = ?'); params.push(status) }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const sql = `SELECT pu.*, p.category, p.model, p.name as product_name, p.description as product_desc,
        h.name as hospital_name,
        (SELECT GROUP_CONCAT(u.name, ', ') FROM product_holders ph LEFT JOIN users u ON u.id=ph.user_id
         WHERE ph.product_unit_id=pu.id AND ph.released_at IS NULL) as holders,
        (SELECT pm.performed_at FROM product_movements pm WHERE pm.product_unit_id=pu.id
         ORDER BY pm.performed_at DESC LIMIT 1) as last_movement_at,
        (SELECT pm.movement_type FROM product_movements pm WHERE pm.product_unit_id=pu.id
         ORDER BY pm.performed_at DESC LIMIT 1) as last_movement_type,
        (SELECT pm.expected_return_date FROM product_movements pm
         WHERE pm.product_unit_id=pu.id AND pm.is_loan=1 AND pm.actual_return_date IS NULL
         ORDER BY pm.performed_at DESC LIMIT 1) as expected_return_date
       FROM product_units pu
       JOIN products p ON p.id = pu.product_id
       LEFT JOIN hospitals h ON h.id = pu.current_hospital_id
       ${whereSql}
       ORDER BY p.category, p.model, pu.asset_code, pu.serial_no`
    const r = await c.env.DB.prepare(sql).bind(...params).all()
    const catMap: Record<string,string> = { internal: '내부기', external: '외부기', carry_case: '휴대보관함' }
    const stMap: Record<string,string> = {
      in_stock: '재고', at_hospital: '기관 비치', out: '반출',
      delivered: '납품완료', lost: '분실', repair: '수리', retired: '폐기'
    }
    const movMap: Record<string,string> = {
      inbound: '입고', checkout: '반출', demo: '시연', deliver: '납품', return: '회수',
      transfer: '이전', assign: '보유추가', release: '보유해제', lost: '분실', repair: '수리', retire: '폐기'
    }
    sheets.push({
      name: '제품_재고_현황',
      headers: ['카테고리', '모델', '제품명', 'S/N', '모델명', '상태', '현재 위치(기관)', '보유자', '대여 반환예정일', '마지막 이동', '마지막 이동 유형', '취득일', '비고'],
      rows: (r.results as any[]).map(u => [
        catMap[u.category] || u.category,
        u.model || '',
        u.product_name || '',
        u.serial_no || '',
        u.asset_code || '',
        stMap[u.status] || u.status,
        u.hospital_name || '',
        u.holders || '',
        u.expected_return_date || '',
        u.last_movement_at || '',
        movMap[u.last_movement_type] || u.last_movement_type || '',
        u.acquired_at || '',
        u.notes || ''
      ])
    })
    // 카테고리별 요약 시트
    const sumR = await c.env.DB.prepare(
      `SELECT p.category, p.model, p.name as product_name,
        COUNT(pu.id) as total,
        SUM(CASE WHEN pu.status='in_stock' THEN 1 ELSE 0 END) as in_stock,
        SUM(CASE WHEN pu.status IN ('at_hospital','out') THEN 1 ELSE 0 END) as out,
        SUM(CASE WHEN pu.status='delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN pu.status IN ('lost','repair','retired') THEN 1 ELSE 0 END) as inactive
       FROM products p
       LEFT JOIN product_units pu ON pu.product_id=p.id
       WHERE p.active=1
       GROUP BY p.id
       ORDER BY p.category, p.model`
    ).all()
    sheets.push({
      name: '카테고리별_요약',
      headers: ['카테고리', '모델', '제품명', '전체', '재고', '반출중', '납품완료', '비활성(분실/수리/폐기)'],
      rows: (sumR.results as any[]).map(s => [
        catMap[s.category] || s.category,
        s.model || '',
        s.product_name || '',
        s.total || 0,
        s.in_stock || 0,
        s.out || 0,
        s.delivered || 0,
        s.inactive || 0
      ])
    })
  } else if (type === 'product_movements') {
    // 제품 이동 이력
    const from = c.req.query('from') || ''
    const to = c.req.query('to') || ''
    const mtype = c.req.query('movement_type') || ''
    const hospitalId = c.req.query('hospital_id') || ''
    const where: string[] = []
    const params: any[] = []
    if (from) { where.push('DATE(pm.performed_at) >= ?'); params.push(from) }
    if (to) { where.push('DATE(pm.performed_at) <= ?'); params.push(to) }
    if (mtype) { where.push('pm.movement_type = ?'); params.push(mtype) }
    if (hospitalId) { where.push('pm.hospital_id = ?'); params.push(Number(hospitalId)) }
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''
    const sql = `SELECT pm.*,
        p.category, p.model, p.name as product_name,
        pu.serial_no, pu.asset_code,
        h.name as hospital_name, d.name as doctor_name,
        fu.name as from_user_name, tu.name as to_user_name,
        per.name as performed_by_name,
        m.meeting_date
       FROM product_movements pm
       JOIN product_units pu ON pu.id = pm.product_unit_id
       JOIN products p ON p.id = pu.product_id
       LEFT JOIN hospitals h ON h.id = pm.hospital_id
       LEFT JOIN doctors d ON d.id = pm.doctor_id
       LEFT JOIN users fu ON fu.id = pm.from_user_id
       LEFT JOIN users tu ON tu.id = pm.to_user_id
       LEFT JOIN users per ON per.id = pm.performed_by
       LEFT JOIN meetings m ON m.id = pm.meeting_id
       ${whereSql}
       ORDER BY pm.performed_at DESC
       LIMIT 5000`
    const r = await c.env.DB.prepare(sql).bind(...params).all()
    const catMap: Record<string,string> = { internal: '내부기', external: '외부기', carry_case: '휴대보관함' }
    const movMap: Record<string,string> = {
      inbound: '입고', checkout: '반출', demo: '시연', deliver: '납품', return: '회수',
      transfer: '이전', assign: '보유추가', release: '보유해제', lost: '분실', repair: '수리', retire: '폐기'
    }
    sheets.push({
      name: '제품_이동_이력',
      headers: ['일시', '이동유형', '카테고리', '모델', '제품명', 'S/N', '모델명', '기관', '의사', '반출자', '반입자', '처리자', '대여여부', '반환예정일', '실반환일', '미팅일자', '미팅ID', '비고'],
      rows: (r.results as any[]).map(row => [
        row.performed_at || '',
        movMap[row.movement_type] || row.movement_type,
        catMap[row.category] || row.category,
        row.model || '',
        row.product_name || '',
        row.serial_no || '',
        row.asset_code || '',
        row.hospital_name || '',
        row.doctor_name || '',
        row.from_user_name || '',
        row.to_user_name || '',
        row.performed_by_name || '',
        row.is_loan ? '대여' : '',
        row.expected_return_date || '',
        row.actual_return_date || '',
        row.meeting_date || '',
        row.meeting_id || '',
        row.reason || ''
      ])
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

// ============================================================================
// Sales Report — 상급자 보고용 전용 보고서
// 4 sheets:
//   1) 표지 + 요약 통계
//   2) 미팅 상세 (코드상태/파이프라인/지역 포함)
//   3) 참석자별 펼침 (1 row = 1 meeting × 1 doctor)
//   4) 병원별 요약 (방문 횟수, 의사 수, 코드 상태)
// Query params: ?from=&to=&hospital_id=&type=&user_id=&format=xlsx|csv
// ============================================================================
exports.get('/report/sales', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const hospitalId = c.req.query('hospital_id') || ''
  const mtype = c.req.query('type') || ''
  const userId = c.req.query('user_id') || ''
  const format = (c.req.query('format') || 'xlsx').toLowerCase()

  // Build WHERE for meetings
  const where: string[] = []
  const params: any[] = []
  if (from) { where.push('m.meeting_date >= ?'); params.push(from) }
  if (to) { where.push('m.meeting_date <= ?'); params.push(to) }
  if (hospitalId) { where.push('m.hospital_id = ?'); params.push(Number(hospitalId)) }
  if (mtype) { where.push('m.meeting_type = ?'); params.push(mtype) }
  if (userId) { where.push('m.user_id = ?'); params.push(Number(userId)) }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : ''

  // 1) Meeting detail with all needed fields
  const meetSql = `SELECT m.*,
      h.name as hospital_name,
      h.region as hospital_region,
      h.type as hospital_type,
      h.status as hospital_status,
      h.pipeline_stage as hospital_pipeline,
      h.todoc_contact as hospital_todoc_contact,
      h.priority as hospital_priority,
      (SELECT GROUP_CONCAT(d.name || '(' || COALESCE(d.position,'') ||
        CASE WHEN d.department IS NOT NULL AND d.department != '' THEN '/' || d.department ELSE '' END || ')', ', ')
       FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_details,
      (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names,
      (SELECT COUNT(*) FROM meeting_doctors md WHERE md.meeting_id=m.id) as doctor_count,
      (SELECT GROUP_CONCAT(u.name, ', ') FROM meeting_users mu LEFT JOIN users u ON mu.user_id=u.id WHERE mu.meeting_id=m.id) as user_names,
      u_owner.name as owner_name
    FROM meetings m
    LEFT JOIN hospitals h ON m.hospital_id=h.id
    LEFT JOIN users u_owner ON m.user_id=u_owner.id
    ${whereSql}
    ORDER BY m.meeting_date DESC, m.id DESC`
  const meetR = await c.env.DB.prepare(meetSql).bind(...params).all()
  const meetings = (meetR.results || []) as any[]

  // 2) Per-attendee (1 row per meeting × doctor) expansion
  const meetingIds = meetings.map(m => m.id)
  let attendees: any[] = []
  if (meetingIds.length > 0) {
    const ph = meetingIds.map(() => '?').join(',')
    const attR = await c.env.DB.prepare(
      `SELECT md.meeting_id, m.meeting_date, m.meeting_type, m.visit_time, m.start_time, m.end_time,
              m.purpose, m.content, m.result, m.next_action, m.next_meeting_date,
              h.name as hospital_name, h.region as hospital_region,
              h.status as hospital_status, h.pipeline_stage as hospital_pipeline,
              d.id as doctor_id, d.name as doctor_name, d.position as doctor_position,
              d.department as doctor_department, d.specialty as doctor_specialty,
              d.influence_level as doctor_influence,
              u.name as owner_name
       FROM meeting_doctors md
       JOIN meetings m ON md.meeting_id = m.id
       LEFT JOIN hospitals h ON m.hospital_id = h.id
       LEFT JOIN doctors d ON md.doctor_id = d.id
       LEFT JOIN users u ON m.user_id = u.id
       WHERE md.meeting_id IN (${ph})
       ORDER BY m.meeting_date DESC, m.id DESC, d.name ASC`
    ).bind(...meetingIds).all()
    attendees = (attR.results || []) as any[]
  }

  // 3) Hospital-level summary aggregation
  const hospitalAgg: Record<number, any> = {}
  for (const m of meetings) {
    const hid = m.hospital_id
    if (!hid) continue
    if (!hospitalAgg[hid]) {
      hospitalAgg[hid] = {
        hospital_id: hid,
        hospital_name: m.hospital_name,
        region: m.hospital_region,
        type: m.hospital_type,
        status: m.hospital_status,
        pipeline_stage: m.hospital_pipeline,
        meeting_count: 0,
        last_meeting_date: '',
        doctor_set: new Set<string>(),
        meeting_types: {} as Record<string, number>
      }
    }
    const agg = hospitalAgg[hid]
    agg.meeting_count++
    if (!agg.last_meeting_date || m.meeting_date > agg.last_meeting_date) agg.last_meeting_date = m.meeting_date
    const mt = m.meeting_type || '-'
    agg.meeting_types[mt] = (agg.meeting_types[mt] || 0) + 1
    if (m.doctor_names) {
      m.doctor_names.split(', ').forEach((nm: string) => agg.doctor_set.add(nm))
    }
  }

  // 4) Summary stats
  const typeCount: Record<string, number> = {}
  const userCount: Record<string, number> = {}
  const regionCount: Record<string, number> = {}
  const dailyCount: Record<string, number> = {}
  const codeRegCount = { active: 0, inactive: 0 }
  for (const m of meetings) {
    const t = m.meeting_type || '-'; typeCount[t] = (typeCount[t] || 0) + 1
    const owner = m.owner_name || '-'; userCount[owner] = (userCount[owner] || 0) + 1
    const region = m.hospital_region || '-'; regionCount[region] = (regionCount[region] || 0) + 1
    const day = m.meeting_date || '-'; dailyCount[day] = (dailyCount[day] || 0) + 1
    if (m.hospital_status === 'active') codeRegCount.active++
    else codeRegCount.inactive++
  }

  // Maps
  const vtMap: Record<string,string> = { am: '오전', pm: '오후', full: '종일' }
  const tyMap: Record<string,string> = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' }
  const stMap: Record<string,string> = { active: '코드 등록', inactive: '미등록' }
  const pipeMap: Record<string,string> = {
    contact: '컨택', meeting: '미팅', demo: '데모', proposal: '제안', contract: '계약', active_customer: '활성 고객'
  }
  const infMap: Record<string,string> = { high: '높음', medium: '중간', low: '낮음' }

  // =================== Build sheets ===================
  const periodLabel = (from || '전체') + ' ~ ' + (to || '전체')
  const generatedAt = new Date().toISOString().substring(0, 19).replace('T', ' ')

  // Sheet 1: 표지 + 요약 통계
  const coverRows: any[][] = [
    ['보고서', 'TODOC CRM 영업 활동 보고서'],
    ['보고서 기간', periodLabel],
    ['생성 일시', generatedAt],
    ['', ''],
    ['── 핵심 지표 ──', ''],
    ['총 미팅 수', meetings.length],
    ['방문 기관 수 (중복 제거)', Object.keys(hospitalAgg).length],
    ['만난 의료진 수 (중복 제거)', new Set(attendees.map(a => a.doctor_id).filter(Boolean)).size],
    ['총 참석자 수 (연인원)', attendees.length],
    ['', ''],
    ['── 코드 상태별 ──', ''],
    ['코드 등록 기관 미팅', codeRegCount.active],
    ['미등록 기관 미팅', codeRegCount.inactive],
    ['', ''],
    ['── 미팅 유형별 ──', ''],
    ...Object.entries(typeCount).sort((a,b)=>b[1]-a[1]).map(([k, v]) => [tyMap[k] || k, v]),
    ['', ''],
    ['── 담당자별 미팅 수 ──', ''],
    ...Object.entries(userCount).sort((a,b)=>b[1]-a[1]).map(([k, v]) => [k, v]),
    ['', ''],
    ['── 지역별 미팅 수 ──', ''],
    ...Object.entries(regionCount).sort((a,b)=>b[1]-a[1]).map(([k, v]) => [k, v]),
  ]

  // Sheet 2: 미팅 상세
  const meetingDetailRows = meetings.map((m, idx) => [
    idx + 1,
    m.meeting_date || '',
    vtMap[m.visit_time] || m.visit_time || '',
    m.start_time || '',
    m.end_time || '',
    tyMap[m.meeting_type] || m.meeting_type || '',
    m.hospital_name || '',
    m.hospital_region || '',
    stMap[m.hospital_status] || (m.hospital_status === 'active' ? '코드 등록' : '미등록'),
    pipeMap[m.hospital_pipeline] || m.hospital_pipeline || 'contact',
    m.doctor_count || 0,
    m.doctor_details || m.doctor_names || '',
    m.owner_name || '',
    m.purpose || '',
    m.content || '',
    m.result || '',
    m.next_action || '',
    m.next_meeting_date || '',
  ])

  // Sheet 3: 참석자별 펼침 (1 미팅 × 1 의사)
  const attendeeRows = attendees.map((a, idx) => [
    idx + 1,
    a.meeting_date || '',
    tyMap[a.meeting_type] || a.meeting_type || '',
    a.hospital_name || '',
    a.hospital_region || '',
    stMap[a.hospital_status] || (a.hospital_status === 'active' ? '코드 등록' : '미등록'),
    pipeMap[a.hospital_pipeline] || a.hospital_pipeline || 'contact',
    a.doctor_name || '',
    a.doctor_position || '',
    a.doctor_department || '',
    a.doctor_specialty || '',
    infMap[a.doctor_influence] || a.doctor_influence || '',
    a.owner_name || '',
    a.purpose || '',
    a.next_action || '',
  ])

  // Sheet 4: 병원별 요약
  const hospitalSummaryRows = Object.values(hospitalAgg)
    .sort((a: any, b: any) => b.meeting_count - a.meeting_count)
    .map((h: any, idx: number) => [
      idx + 1,
      h.hospital_name || '',
      h.region || '',
      h.type === 'clinic' ? '의원' : '병원',
      stMap[h.status] || (h.status === 'active' ? '코드 등록' : '미등록'),
      pipeMap[h.pipeline_stage] || h.pipeline_stage || 'contact',
      h.meeting_count,
      h.doctor_set.size,
      Array.from(h.doctor_set).join(', '),
      h.last_meeting_date || '',
      Object.entries(h.meeting_types).map(([k, v]) => (tyMap[k] || k) + ':' + v).join(', '),
    ])

  const sheets = [
    { name: '요약', headers: ['항목', '값'], rows: coverRows },
    {
      name: '미팅 상세',
      headers: ['No', '미팅일자', '시간대', '시작', '종료', '유형', '병원', '지역', '코드상태', '파이프라인', '참석의료진수', '의료진(직책/부서)', '담당자', '목적', '내용', '결과', '후속액션', '다음미팅예정'],
      rows: meetingDetailRows
    },
    {
      name: '참석자별',
      headers: ['No', '미팅일자', '유형', '병원', '지역', '코드상태', '파이프라인', '의사명', '직책', '부서', '전문분야', '영향력', '담당자', '목적', '후속액션'],
      rows: attendeeRows
    },
    {
      name: '병원별 요약',
      headers: ['No', '병원', '지역', '유형', '코드상태', '파이프라인', '미팅횟수', '만난의사수', '만난의사목록', '마지막미팅일', '미팅유형 분포'],
      rows: hospitalSummaryRows
    },
  ]

  // CSV 포맷 요청 시: 미팅 상세 시트만 단일 CSV 로 반환
  if (format === 'csv') {
    const lines: string[] = []
    lines.push('# TODOC CRM 영업 보고서 (' + periodLabel + ')')
    lines.push('# 생성 일시: ' + generatedAt)
    lines.push('')
    lines.push(toCsvRow(sheets[1].headers))
    for (const r of meetingDetailRows) lines.push(toCsvRow(r))
    lines.push('')
    lines.push('# ── 병원별 요약 ──')
    lines.push(toCsvRow(sheets[3].headers))
    for (const r of hospitalSummaryRows) lines.push(toCsvRow(r))
    const bom = '\uFEFF'
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="todoc_sales_report_${ts()}.csv"`)
    return c.body(bom + lines.join('\n'))
  }

  // XLSX (XML Spreadsheet format)
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n'
  xml += '<Styles><Style ss:ID="header"><Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/></Style></Styles>\n'
  for (const s of sheets) xml += buildSheet(s.name, s.headers, s.rows)
  xml += '</Workbook>'

  c.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="todoc_sales_report_${ts()}.xls"`)
  return c.body('\uFEFF' + xml)
})

export default exports
