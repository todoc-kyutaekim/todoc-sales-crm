import { Hono } from 'hono'
import { buildReportData } from './dashboard'
import { queryByIds } from '../helpers'
import { buildXlsx, XLSX_CONTENT_TYPE } from '../xlsx'
import {
  buildFormSheet, buildEvidenceSheet, buildTollEvidenceSheet,
  FORM_STYLES, MONTHLY_DEPRECIATION, regionLabel,
  type FormLeg, type FormSheetInput, type FormVehicle,
} from '../travel_report_form'
import { buildDailyRoutes, settleAmount, PLACE_TYPE_LABEL } from './travel'

type Bindings = { DB: D1Database; KAKAO_REST_API_KEY?: string }
const exports = new Hono<{ Bindings: Bindings }>()

function escHtml(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

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

// 기관 유형 라벨 변환 (hospital/clinic/other)
function hospTypeLabel(t: any): string {
  if (t === 'clinic') return '의원'
  if (t === 'other') return '기타 기관'
  return '병원'
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
  const rows = (r.results as any[]).map(h => toCsvRow([h.id, h.name, hospTypeLabel(h.type), h.region, h.address, h.phone, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.priority || '', h.todoc_contact || '', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0, h.notes, h.created_at]))
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
      rows: (r.results as any[]).map(h => [h.id, h.name, hospTypeLabel(h.type), h.region, h.address, h.phone, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.priority || '', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0])
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
      rows: hospitals.map(h => [h.id, h.name, hospTypeLabel(h.type), h.region, h.status === 'active' ? '활성' : '비활성', h.pipeline_stage || 'contact', h.doctor_count, h.meeting_count, h.last_meeting || '', h.patient_count || 0, h.hearing_aid_sales || 0, h.ci_referrals || 0])
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
    // ⚠️ ID 100개 초과 시 D1 'too many SQL variables' — queryByIds 로 분할 질의.
    //    단, 청크로 나누면 전역 정렬이 깨지므로 밑에서 다시 정렬합니다(내보내기 행 순서 유지).
    attendees = await queryByIds<any>(
      c.env.DB,
      ph => `SELECT md.meeting_id, m.id as _mid, m.meeting_date, m.meeting_type, m.visit_time, m.start_time, m.end_time,
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
       ORDER BY m.meeting_date DESC, m.id DESC, d.name ASC`,
      meetingIds
    )
    // 원본 SQL 의 ORDER BY m.meeting_date DESC, m.id DESC, d.name ASC 재현
    attendees.sort((a, b) => {
      const ad = String(a.meeting_date || ''), bd = String(b.meeting_date || '')
      if (ad !== bd) return ad < bd ? 1 : -1
      const ai = Number(a._mid || 0), bi = Number(b._mid || 0)
      if (ai !== bi) return bi - ai
      return String(a.doctor_name || '').localeCompare(String(b.doctor_name || ''))
    })
    for (const r of attendees) delete r._mid
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
      hospTypeLabel(h.type),
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

  // ========================================================================
  // HTML 포맷 요청 시: 상급자 보고용 전문 양식 (단조·진중한 톤)
  // ========================================================================
  if (format === 'html') {
    const download = c.req.query('download') === '1'

    // 표지/필터 정보
    const filterDesc: string[] = []
    if (hospitalId) {
      const hospName = meetings[0]?.hospital_name || `ID ${hospitalId}`
      filterDesc.push('대상 기관: ' + hospName)
    }
    if (mtype) filterDesc.push('미팅 유형: ' + (tyMap[mtype] || mtype))
    if (userId) {
      const userName = meetings[0]?.owner_name || `ID ${userId}`
      filterDesc.push('담당자: ' + userName)
    }

    // KST 출력 시각
    const nowKstStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' KST'

    // 집계
    const totalMeetings = meetings.length
    const totalHospitals = Object.keys(hospitalAgg).length
    const totalDoctors = new Set(attendees.map(a => a.doctor_id).filter(Boolean)).size
    const totalAttendees = attendees.length

    // 상위 유형/지역/담당자
    const typeSorted = Object.entries(typeCount).sort((a, b) => Number(b[1]) - Number(a[1]))
    const userSorted = Object.entries(userCount).sort((a, b) => Number(b[1]) - Number(a[1]))
    const regionSorted = Object.entries(regionCount).sort((a, b) => Number(b[1]) - Number(a[1]))

    // 기관별 요약 (상위)
    const hospAgg = Object.values(hospitalAgg)
      .sort((a: any, b: any) => b.meeting_count - a.meeting_count) as any[]

    // ========== HTML 본문 ==========
    let body = ''

    // 표지 (Cover)
    body += `
    <section class="cover">
      <div class="cover-eyebrow">CONFIDENTIAL · INTERNAL REPORT</div>
      <h1 class="cover-title">영업 활동 보고서</h1>
      <div class="cover-sub">TODOC CRM Sales Activity Report</div>
      <div class="cover-divider"></div>
      <table class="cover-meta">
        <tr><th>보고 기간</th><td>${escHtml(periodLabel)}</td></tr>
        <tr><th>생성 일시</th><td>${escHtml(nowKstStr)}</td></tr>
        ${filterDesc.length ? `<tr><th>적용 필터</th><td>${escHtml(filterDesc.join(' · '))}</td></tr>` : ''}
        <tr><th>총 미팅</th><td><strong>${totalMeetings.toLocaleString()}건</strong></td></tr>
        <tr><th>방문 기관</th><td>${totalHospitals.toLocaleString()}곳</td></tr>
        <tr><th>접촉 의료진</th><td>${totalDoctors.toLocaleString()}명</td></tr>
      </table>
    </section>`

    // I. 요약 (Executive Summary)
    body += `
    <section class="section">
      <h2 class="section-title"><span class="section-num">I.</span> 요약 (Executive Summary)</h2>
      <div class="kpi-row">
        <div class="kpi-cell"><div class="kpi-num">${totalMeetings.toLocaleString()}</div><div class="kpi-lbl">총 미팅 건수</div></div>
        <div class="kpi-cell"><div class="kpi-num">${totalHospitals.toLocaleString()}</div><div class="kpi-lbl">방문 기관 수</div></div>
        <div class="kpi-cell"><div class="kpi-num">${totalDoctors.toLocaleString()}</div><div class="kpi-lbl">접촉 의료진 수</div></div>
        <div class="kpi-cell"><div class="kpi-num">${totalAttendees.toLocaleString()}</div><div class="kpi-lbl">연인원 (참석자 합계)</div></div>
      </div>
      <table class="data-table mt-3">
        <thead><tr><th style="width:30%">구분</th><th>내용</th></tr></thead>
        <tbody>
          <tr><th>코드 등록 기관 미팅</th><td>${codeRegCount.active.toLocaleString()}건 (${totalMeetings ? Math.round((codeRegCount.active / totalMeetings) * 100) : 0}%)</td></tr>
          <tr><th>미등록 기관 미팅</th><td>${codeRegCount.inactive.toLocaleString()}건 (${totalMeetings ? Math.round((codeRegCount.inactive / totalMeetings) * 100) : 0}%)</td></tr>
          <tr><th>유형별 분포</th><td>${typeSorted.map(([k, v]) => `${escHtml(tyMap[k] || k)} ${v}건`).join(' · ') || '-'}</td></tr>
          <tr><th>주요 지역</th><td>${regionSorted.slice(0, 5).map(([k, v]) => `${escHtml(k)} ${v}건`).join(' · ') || '-'}</td></tr>
          <tr><th>담당자별 활동</th><td>${userSorted.slice(0, 5).map(([k, v]) => `${escHtml(k)} ${v}건`).join(' · ') || '-'}</td></tr>
        </tbody>
      </table>
    </section>`

    // II. 기관별 요약 표
    body += `
    <section class="section">
      <h2 class="section-title"><span class="section-num">II.</span> 기관별 활동 요약</h2>
      ${hospAgg.length === 0 ? '<p class="muted">해당 기간에 미팅이 없습니다.</p>' : `
      <table class="data-table compact">
        <thead>
          <tr>
            <th style="width:36px">No</th>
            <th>기관명</th>
            <th style="width:80px">지역</th>
            <th style="width:80px">코드</th>
            <th style="width:80px">파이프라인</th>
            <th style="width:60px;text-align:right">미팅</th>
            <th style="width:60px;text-align:right">의사</th>
            <th style="width:100px">최근 미팅일</th>
          </tr>
        </thead>
        <tbody>
          ${hospAgg.map((h: any, i: number) => `
            <tr>
              <td>${i + 1}</td>
              <td class="strong">${escHtml(h.hospital_name || '-')}</td>
              <td>${escHtml(h.region || '-')}</td>
              <td>${h.status === 'active' ? '<span class="badge badge-dark">등록</span>' : '<span class="badge badge-light">미등록</span>'}</td>
              <td>${escHtml(pipeMap[h.pipeline_stage] || h.pipeline_stage || '-')}</td>
              <td style="text-align:right" class="num">${h.meeting_count}</td>
              <td style="text-align:right" class="num">${h.doctor_set.size}</td>
              <td>${escHtml(h.last_meeting_date || '-')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </section>`

    // III. 미팅 상세 내역
    body += `
    <section class="section">
      <h2 class="section-title"><span class="section-num">III.</span> 미팅 상세 내역</h2>
      ${meetings.length === 0 ? '<p class="muted">해당 기간에 미팅이 없습니다.</p>' : `
      <div class="meet-detail-list">
        ${meetings.map((m: any, i: number) => `
          <article class="meet-item">
            <header class="meet-item-head">
              <span class="meet-no">No. ${String(i + 1).padStart(3, '0')}</span>
              <span class="meet-date">${escHtml(m.meeting_date || '-')}</span>
              ${m.start_time ? `<span class="meet-time">${escHtml(m.start_time)}${m.end_time ? ' - ' + escHtml(m.end_time) : ''}</span>` : (m.visit_time ? `<span class="meet-time">${escHtml(vtMap[m.visit_time] || m.visit_time)}</span>` : '')}
              <span class="meet-type">${escHtml(tyMap[m.meeting_type] || m.meeting_type || '-')}</span>
            </header>
            <table class="meet-meta-table">
              <tr>
                <th>기관</th><td class="strong">${escHtml(m.hospital_name || '-')} <span class="muted-inline">(${escHtml(m.hospital_region || '-')})</span></td>
                <th>코드 상태</th><td>${m.hospital_status === 'active' ? '<span class="badge badge-dark">등록</span>' : '<span class="badge badge-light">미등록</span>'}</td>
              </tr>
              <tr>
                <th>파이프라인</th><td>${escHtml(pipeMap[m.hospital_pipeline] || m.hospital_pipeline || '-')}</td>
                <th>담당자</th><td>${escHtml(m.owner_name || '-')}</td>
              </tr>
              <tr>
                <th>참석 의료진</th><td colspan="3">${escHtml(m.doctor_details || m.doctor_names || '-')} <span class="muted-inline">(${m.doctor_count || 0}명)</span></td>
              </tr>
            </table>
            ${m.purpose ? `<div class="meet-block"><span class="meet-block-lbl">목적</span><div class="meet-block-body">${escHtml(m.purpose)}</div></div>` : ''}
            ${m.content ? `<div class="meet-block"><span class="meet-block-lbl">내용</span><div class="meet-block-body">${escHtml(m.content)}</div></div>` : ''}
            ${m.result ? `<div class="meet-block"><span class="meet-block-lbl">결과</span><div class="meet-block-body">${escHtml(m.result)}</div></div>` : ''}
            ${m.next_action ? `<div class="meet-block followup"><span class="meet-block-lbl">후속 액션</span><div class="meet-block-body">${escHtml(m.next_action)}${m.next_meeting_date ? ` <span class="muted-inline">(예정: ${escHtml(m.next_meeting_date)})</span>` : ''}</div></div>` : ''}
          </article>`).join('')}
      </div>`}
    </section>`

    // IV. 참석자별 명단 (테이블)
    body += `
    <section class="section">
      <h2 class="section-title"><span class="section-num">IV.</span> 참석 의료진 명단</h2>
      ${attendees.length === 0 ? '<p class="muted">참석자 정보가 없습니다.</p>' : `
      <table class="data-table compact">
        <thead>
          <tr>
            <th style="width:36px">No</th>
            <th style="width:100px">미팅일</th>
            <th>의료진</th>
            <th>직책</th>
            <th>부서</th>
            <th>전문분야</th>
            <th>소속 기관</th>
            <th style="width:80px">담당자</th>
          </tr>
        </thead>
        <tbody>
          ${attendees.map((a: any, i: number) => `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(a.meeting_date || '-')}</td>
              <td class="strong">${escHtml(a.doctor_name || '-')}</td>
              <td>${escHtml(a.doctor_position || '-')}</td>
              <td>${escHtml(a.doctor_department || '-')}</td>
              <td>${escHtml(a.doctor_specialty || '-')}</td>
              <td>${escHtml(a.hospital_name || '-')}</td>
              <td>${escHtml(a.owner_name || '-')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </section>`

    // 푸터
    body += `
    <footer class="report-footer">
      <div>본 보고서는 TODOC CRM 시스템에 등록된 데이터를 기반으로 자동 생성된 내부 자료입니다.</div>
      <div>생성: ${escHtml(nowKstStr)} · 문서 기밀 등급: 내부용</div>
    </footer>`

    // ========== CSS — 단조·진중한 보고서 디자인 ==========
    const css = `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1a1a1a;
      background: #f5f5f4;
      line-height: 1.6;
      font-size: 13px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc { max-width: 880px; margin: 0 auto; background: #ffffff; padding: 56px 64px 72px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
    /* === 표지 === */
    .cover { text-align: center; padding: 24px 0 40px; border-bottom: 2px solid #1a1a1a; margin-bottom: 36px; }
    .cover-eyebrow { font-size: 10px; letter-spacing: 4px; color: #6b7280; font-weight: 600; margin-bottom: 28px; }
    .cover-title {
      font-family: "Noto Serif KR", "Times New Roman", serif;
      font-size: 32px;
      font-weight: 700;
      margin: 0 0 6px;
      color: #111;
      letter-spacing: -.5px;
    }
    .cover-sub { font-size: 11px; color: #6b7280; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 28px; }
    .cover-divider { width: 48px; height: 2px; background: #1a1a1a; margin: 0 auto 28px; }
    .cover-meta { margin: 0 auto; border-collapse: collapse; font-size: 12px; min-width: 380px; }
    .cover-meta th { text-align: left; padding: 6px 16px 6px 0; color: #6b7280; font-weight: 500; width: 110px; vertical-align: top; }
    .cover-meta td { text-align: left; padding: 6px 0; color: #1a1a1a; font-weight: 500; }
    .cover-meta strong { color: #111; font-weight: 700; }

    /* === 섹션 === */
    .section { margin-bottom: 44px; page-break-inside: auto; }
    .section-title {
      font-family: "Noto Serif KR", serif;
      font-size: 17px;
      font-weight: 700;
      color: #111;
      margin: 0 0 18px;
      padding: 0 0 8px;
      border-bottom: 1px solid #1a1a1a;
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .section-num {
      font-family: "Times New Roman", serif;
      font-size: 15px;
      color: #6b7280;
      font-weight: 600;
      min-width: 26px;
    }
    .mt-3 { margin-top: 14px; }

    /* === 핵심 지표 (KPI) === */
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #d6d3d1; }
    .kpi-cell { padding: 16px 18px; border-right: 1px solid #e7e5e4; text-align: center; }
    .kpi-cell:last-child { border-right: none; }
    .kpi-num {
      font-family: "Noto Serif KR", serif;
      font-size: 26px;
      font-weight: 700;
      color: #111;
      line-height: 1;
      margin-bottom: 6px;
    }
    .kpi-lbl { font-size: 11px; color: #6b7280; font-weight: 500; letter-spacing: .3px; }

    /* === 데이터 테이블 === */
    .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .data-table thead th {
      background: #f5f5f4;
      color: #1a1a1a;
      font-weight: 600;
      text-align: left;
      padding: 9px 10px;
      border-top: 1px solid #1a1a1a;
      border-bottom: 1px solid #1a1a1a;
      font-size: 11px;
      letter-spacing: .2px;
    }
    .data-table tbody td, .data-table tbody th {
      padding: 8px 10px;
      border-bottom: 1px solid #e7e5e4;
      vertical-align: top;
    }
    .data-table tbody th { background: #fafaf9; color: #4b5563; font-weight: 500; text-align: left; }
    .data-table tbody tr:last-child td, .data-table tbody tr:last-child th { border-bottom: 1px solid #1a1a1a; }
    .data-table.compact tbody td { padding: 6px 10px; font-size: 12px; }
    .data-table .strong { font-weight: 600; color: #111; }
    .data-table .num { font-variant-numeric: tabular-nums; }

    /* === 배지 === */
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 2px;
      letter-spacing: .3px;
    }
    .badge-dark { background: #1a1a1a; color: #fff; }
    .badge-light { background: #fff; color: #6b7280; border: 1px solid #d6d3d1; }

    /* === 미팅 상세 카드 === */
    .meet-detail-list { display: flex; flex-direction: column; gap: 18px; }
    .meet-item {
      border: 1px solid #d6d3d1;
      padding: 16px 20px;
      background: #fff;
      page-break-inside: avoid;
    }
    .meet-item-head {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: baseline;
      padding-bottom: 10px;
      margin-bottom: 12px;
      border-bottom: 1px solid #1a1a1a;
    }
    .meet-no {
      font-family: "Times New Roman", serif;
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
      letter-spacing: .5px;
    }
    .meet-date { font-size: 13px; font-weight: 700; color: #111; }
    .meet-time { font-size: 11px; color: #6b7280; }
    .meet-type {
      margin-left: auto;
      font-size: 11px;
      font-weight: 600;
      color: #1a1a1a;
      padding: 3px 10px;
      border: 1px solid #1a1a1a;
      letter-spacing: .3px;
    }
    .meet-meta-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
    .meet-meta-table th {
      text-align: left;
      padding: 5px 12px 5px 0;
      color: #6b7280;
      font-weight: 500;
      width: 80px;
      vertical-align: top;
      font-size: 11px;
    }
    .meet-meta-table td {
      padding: 5px 24px 5px 0;
      color: #1a1a1a;
      vertical-align: top;
    }
    .meet-meta-table td.strong { font-weight: 600; }
    .muted-inline { color: #6b7280; font-weight: 400; font-size: 11px; }
    .meet-block { margin-top: 8px; padding-left: 12px; border-left: 2px solid #d6d3d1; }
    .meet-block.followup { border-left-color: #1a1a1a; }
    .meet-block-lbl {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      color: #6b7280;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 3px;
    }
    .meet-block.followup .meet-block-lbl { color: #1a1a1a; }
    .meet-block-body { font-size: 12px; color: #1a1a1a; line-height: 1.6; white-space: pre-wrap; }

    /* === 푸터 === */
    .report-footer {
      margin-top: 56px;
      padding-top: 18px;
      border-top: 1px solid #1a1a1a;
      font-size: 10px;
      color: #6b7280;
      text-align: center;
      line-height: 1.7;
    }
    .muted { color: #6b7280; font-size: 12px; padding: 12px 0; }

    /* === 툴바 (인쇄 시 숨김) === */
    .toolbar {
      position: sticky;
      top: 0;
      background: rgba(255,255,255,.97);
      backdrop-filter: blur(8px);
      padding: 10px 24px;
      border-bottom: 1px solid #d6d3d1;
      display: flex;
      gap: 10px;
      align-items: center;
      z-index: 100;
    }
    .toolbar .lbl { font-size: 11px; color: #6b7280; font-weight: 600; letter-spacing: .3px; }
    .toolbar button {
      background: #1a1a1a;
      color: #fff;
      border: 0;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      letter-spacing: .3px;
    }
    .toolbar button:hover { background: #000; }
    .toolbar button.secondary { background: #fff; color: #1a1a1a; border: 1px solid #1a1a1a; }
    .toolbar button.secondary:hover { background: #f5f5f4; }

    /* === 인쇄용 === */
    @media print {
      body { background: #fff; }
      .toolbar { display: none; }
      .doc { box-shadow: none; max-width: 100%; padding: 0 16mm; }
      .section, .meet-item { page-break-inside: avoid; }
      .cover { page-break-after: avoid; }
    }

    /* === 모바일 === */
    @media (max-width: 720px) {
      .doc { padding: 28px 20px 40px; }
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .kpi-cell:nth-child(2) { border-right: none; }
      .kpi-cell:nth-child(1), .kpi-cell:nth-child(2) { border-bottom: 1px solid #e7e5e4; }
      .cover-title { font-size: 24px; }
      .meet-item-head { gap: 8px; }
      .meet-type { margin-left: 0; }
      .data-table { font-size: 11px; }
    }
    `

    const docTitle = `TODOC 영업 활동 보고서 ${from || ''} ~ ${to || ''}`.trim()
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(docTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&family=Noto+Serif+KR:wght@600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div class="toolbar">
  <span class="lbl">${escHtml(docTitle)}</span>
  <div style="flex:1"></div>
  <button onclick="window.print()">인쇄 / PDF 저장</button>
  <button class="secondary" onclick="window.close()">닫기</button>
</div>
<div class="doc">
${body}
</div>
</body>
</html>`

    c.header('Content-Type', 'text/html; charset=utf-8')
    if (download) {
      const fn = `todoc_sales_report_${ts()}.html`
      c.header('Content-Disposition', `attachment; filename="${fn}"`)
    }
    return c.body(html)
  }

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

// ============================================================================
// HTML Report — 보기 편한 자체완결형 HTML 보고서
// 대시보드 주/월간 보고서를 인쇄/공유/오프라인 열람용 HTML 단일 파일로 렌더
// Query: ?range=week|last_week|month|last_month|custom &from= &to= &download=1
// ============================================================================
exports.get('/report/html', async (c) => {
  const range = c.req.query('range') || 'week'
  const fromQ = c.req.query('from') || ''
  const toQ = c.req.query('to') || ''
  const download = c.req.query('download') === '1'

  const d = await buildReportData(c.env.DB, range, fromQ, toQ)
  if (!d) return c.text('Invalid date range', 400)

  const typeLabels: Record<string,string> = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' }
  const typeColors: Record<string,string> = { visit: '#2563eb', phone: '#10b981', conference: '#8b5cf6', email: '#f59e0b', online: '#6366f1' }
  const stageLabels: Record<string,string> = { contact: '접촉', meeting: '미팅', demo: '데모', proposal: '제안', negotiation: '협상', contract: '계약', closed_won: '성사', closed_lost: '실패', lost: '이탈', inactive: '휴면', active_customer: '기존고객' }
  const stageColors: Record<string,string> = { contact: '#94a3b8', meeting: '#2563eb', demo: '#8b5cf6', proposal: '#f59e0b', negotiation: '#f97316', contract: '#ef4444', closed_won: '#059669', active_customer: '#059669', lost: '#ef4444', inactive: '#64748b' }
  const rangeLabel: Record<string,string> = { week: '이번 주', last_week: '지난 주', month: '이번 달', last_month: '지난 달', custom: '사용자 지정' }

  const s = d.summary as any
  const diffSign = s.diffPct > 0 ? '+' : ''
  const diffColor = s.diffPct > 0 ? '#059669' : (s.diffPct < 0 ? '#dc2626' : '#94a3b8')
  const hospDiff = (s.uniqueHospitals || 0) - (s.prevUniqueHospitals || 0)
  const hospDiffSign = hospDiff > 0 ? '+' : ''
  const hospDiffColor = hospDiff > 0 ? '#059669' : (hospDiff < 0 ? '#dc2626' : '#94a3b8')

  const nowKstStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' KST'

  // ===== Sections =====
  let body = ''

  // 표지
  body += `
  <section class="cover">
    <div class="brand">TODOC CRM</div>
    <h1>영업 활동 보고서</h1>
    <div class="period">${escHtml(d.from)} ~ ${escHtml(d.to)} <span class="period-tag">${escHtml(rangeLabel[d.range] || d.range)}</span></div>
    <div class="meta">비교 기간: ${escHtml(d.prevFrom || '-')} ~ ${escHtml(d.prevTo || '-')} · 출력 ${escHtml(nowKstStr)}</div>
  </section>`

  // 1) 핵심 지표
  body += `
  <section class="card">
    <h2>핵심 지표</h2>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">총 미팅</div>
        <div class="kpi-value">${s.totalMeetings}<span class="unit">건</span></div>
        <div class="kpi-sub" style="color:${diffColor}">${diffSign}${s.diffPct}% (이전 ${s.prevTotalMeetings}건)</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">방문 기관 수</div>
        <div class="kpi-value" style="color:#2563eb">${s.uniqueHospitals || 0}<span class="unit">곳</span></div>
        <div class="kpi-sub" style="color:${hospDiffColor}">${hospDiffSign}${hospDiff} (이전 ${s.prevUniqueHospitals || 0}곳)</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">접촉 의료진</div>
        <div class="kpi-value" style="color:#8b5cf6">${s.uniqueDoctors || 0}<span class="unit">명</span></div>
        <div class="kpi-sub">기간 내 만난 의료진</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">후속 액션 생성률</div>
        <div class="kpi-value" style="color:#d97706">${s.followupRate || 0}<span class="unit">%</span></div>
        <div class="kpi-sub">미팅 기록률 ${s.summaryRate || 0}%</div>
      </div>
    </div>
  </section>`

  // 2) 미팅 유형/지역 분포
  const tb = (d.typeBreakdown as any[]) || []
  const maxTb = tb.length ? Math.max(...tb.map(t => Number(t.c))) : 0
  const rb = (d.regionBreakdown as any[]) || []
  const maxRb = rb.length ? Math.max(...rb.map(r => Number(r.c))) : 0

  body += `
  <div class="grid-2">
    <section class="card">
      <h2>미팅 유형별 분포</h2>
      ${tb.length === 0 ? '<div class="muted">데이터 없음</div>' : `
      <table class="bars">
        ${tb.map(t => {
          const w = maxTb > 0 ? Math.round((Number(t.c) / maxTb) * 100) : 0
          const pct = s.totalMeetings > 0 ? Math.round((Number(t.c) / s.totalMeetings) * 100) : 0
          const col = typeColors[t.meeting_type] || '#94a3b8'
          return `<tr>
            <td class="label">${escHtml(typeLabels[t.meeting_type] || t.meeting_type)}</td>
            <td class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:${w}%;background:${col}"></div></div></td>
            <td class="value">${t.c}건 (${pct}%)</td>
          </tr>`
        }).join('')}
      </table>`}
    </section>

    <section class="card">
      <h2>지역별 활동</h2>
      ${rb.length === 0 ? '<div class="muted">데이터 없음</div>' : `
      <table class="bars">
        ${rb.slice(0, 8).map(r => {
          const w = maxRb > 0 ? Math.round((Number(r.c) / maxRb) * 100) : 0
          return `<tr>
            <td class="label">${escHtml(r.region || '기타')}</td>
            <td class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:${w}%;background:#10b981"></div></div></td>
            <td class="value">${r.c}건 / ${r.hosp_count}곳</td>
          </tr>`
        }).join('')}
      </table>`}
    </section>
  </div>`

  // 3) 활동 상위 기관
  const top = (d.topHospitals as any[]) || []
  body += `
  <section class="card">
    <h2>활동 상위 기관 <span class="count">총 ${top.length}곳</span></h2>
    ${top.length === 0 ? '<div class="muted">데이터 없음</div>' : `
    <div class="hosp-grid">
      ${top.slice(0, 12).map((h, i) => {
        const stageBg = stageColors[h.pipeline_stage] || '#94a3b8'
        const stageLbl = stageLabels[h.pipeline_stage] || h.pipeline_stage || '-'
        return `<div class="hosp-row">
          <span class="rank">${i + 1}</span>
          <div class="hosp-main">
            <div class="hosp-name">${escHtml(h.name || '-')} <span class="stage" style="background:${stageBg}1a;color:${stageBg}">${escHtml(stageLbl)}</span></div>
            <div class="hosp-sub">${escHtml(h.region || '-')} · 마지막 ${escHtml(h.last_date ? String(h.last_date).slice(5) : '-')}</div>
          </div>
          <span class="hosp-count">${h.c}회</span>
        </div>`
      }).join('')}
    </div>`}
  </section>`

  // 4) 미팅 상세 내역
  const meets = (d.meetingDetails as any[]) || []
  body += `
  <section class="card">
    <h2>미팅 상세 내역 <span class="count">${meets.length}건</span></h2>
    ${meets.length === 0 ? '<div class="muted">기간 내 미팅이 없습니다</div>' : `
    <div class="meet-list">
      ${meets.map(m => {
        const typeCol = typeColors[m.meeting_type] || '#94a3b8'
        const typeLbl = typeLabels[m.meeting_type] || m.meeting_type || '-'
        return `<div class="meet-row" style="border-left-color:${typeCol}">
          <div class="meet-head">
            <span class="date">${escHtml(m.meeting_date || '')}</span>
            <span class="type" style="background:${typeCol}1a;color:${typeCol}">${escHtml(typeLbl)}</span>
            <span class="hosp">${escHtml(m.hospital_name || '-')}</span>
            ${m.region ? `<span class="region">· ${escHtml(m.region)}</span>` : ''}
            ${m.doctor_name ? `<span class="doctor">👨‍⚕️ ${escHtml(m.doctor_name)}${m.doctor_position ? ' ' + escHtml(m.doctor_position) : ''}</span>` : ''}
          </div>
          ${m.purpose ? `<div class="purpose">${escHtml(m.purpose)}</div>` : ''}
          ${m.summary ? `<div class="summary">${escHtml(m.summary)}</div>` : ''}
          ${m.next_action ? `<div class="next">🚩 다음: ${escHtml(m.next_action)}${m.next_meeting_date ? ' (' + escHtml(m.next_meeting_date) + ')' : ''}</div>` : ''}
        </div>`
      }).join('')}
    </div>`}
  </section>`

  // 5) 담당자별 / 파이프라인 이동
  const topUsers = (d.topUsers as any[]) || []
  const pipeMoves = (d.pipelineMoves as any[]) || []
  body += `
  <div class="grid-2">
    <section class="card">
      <h2>담당자별 미팅</h2>
      ${topUsers.length === 0 ? '<div class="muted">데이터 없음</div>' : `
      <table class="users">
        ${topUsers.map((u, i) => `<tr><td class="rank">${i + 1}</td><td>${escHtml(u.name || '-')}</td><td class="value" style="color:#8b5cf6">${u.c}회</td></tr>`).join('')}
      </table>`}
    </section>
    <section class="card">
      <h2>파이프라인 이동</h2>
      ${pipeMoves.length === 0 ? '<div class="muted">파이프라인 변경 없음</div>' : `
      <table class="pipe">
        ${pipeMoves.slice(0, 8).map(p => `<tr>
          <td><span class="pill gray">${escHtml(stageLabels[p.from_stage] || p.from_stage || '-')}</span></td>
          <td class="arrow">→</td>
          <td><span class="pill green">${escHtml(stageLabels[p.to_stage] || p.to_stage || '-')}</span></td>
          <td class="value">${p.c}건</td>
        </tr>`).join('')}
      </table>`}
    </section>
  </div>`

  // 6) 위험 신호: 30일 이상 미접촉 활성 기관
  const notMet = (d.notMetHospitals as any[]) || []
  if (notMet.length) {
    body += `
    <section class="card warn">
      <h2>⚠️ 주의: 30일 이상 미접촉 기관 <span class="count">${notMet.length}곳</span></h2>
      <div class="warn-sub">활성 거래처 중 한동안 만나지 못한 곳입니다. 후속 미팅을 잡아보세요.</div>
      <div class="warn-grid">
        ${notMet.map(h => {
          const stageBg = stageColors[h.pipeline_stage] || '#94a3b8'
          const stageLbl = stageLabels[h.pipeline_stage] || h.pipeline_stage || '-'
          const daysAgo = h.last_date ? Math.floor((Date.now() - new Date(String(h.last_date)).getTime()) / 86400000) : null
          return `<div class="warn-row">
            <span class="hosp-name">${escHtml(h.name)}</span>
            <span class="stage" style="background:${stageBg}1a;color:${stageBg}">${escHtml(stageLbl)}</span>
            <span class="ago">${daysAgo !== null ? daysAgo + '일 전' : '미방문'}</span>
          </div>`
        }).join('')}
      </div>
    </section>`
  }

  // 7) 2주 이내 예정 후속 액션
  const upcoming = (d.upcomingNextActions as any[]) || []
  body += `
  <section class="card">
    <h2>2주 이내 예정 후속 액션 <span class="count">${upcoming.length}건</span></h2>
    ${upcoming.length === 0 ? '<div class="muted">예정된 후속 액션 없음</div>' : `
    <table class="next-actions">
      <thead><tr><th>예정일</th><th>기관</th><th>다음 액션</th></tr></thead>
      <tbody>
        ${upcoming.slice(0, 20).map(n => `<tr>
          <td class="date">${escHtml(n.next_meeting_date || '')}</td>
          <td class="hosp">${escHtml(n.hospital_name || '-')}</td>
          <td>${escHtml(n.next_action || '-')}</td>
        </tr>`).join('')}
      </tbody>
    </table>`}
  </section>`

  // CSS — inline self-contained
  const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", "Apple SD Gothic Neo", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1e293b; background: #f8fafc; line-height: 1.55; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 28px 64px; }
  .cover { background: linear-gradient(135deg, #2563eb 0%, #6366f1 100%); color: #fff; padding: 32px 28px; border-radius: 16px; margin-bottom: 24px; box-shadow: 0 4px 14px rgba(37,99,235,.15); }
  .cover .brand { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; opacity: .85; }
  .cover h1 { margin: 8px 0 12px; font-size: 28px; font-weight: 800; letter-spacing: -.5px; }
  .cover .period { font-size: 16px; font-weight: 600; }
  .cover .period-tag { display: inline-block; background: rgba(255,255,255,.2); padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-left: 8px; vertical-align: middle; }
  .cover .meta { margin-top: 10px; font-size: 12px; opacity: .85; }
  .card { background: #fff; border-radius: 12px; padding: 20px 22px; box-shadow: 0 1px 3px rgba(15,23,42,.06); border: 1px solid #f1f5f9; margin-bottom: 18px; }
  .card.warn { background: #fffbeb; border-color: #fde68a; border-left: 4px solid #f59e0b; }
  .card h2 { margin: 0 0 14px; font-size: 16px; font-weight: 700; color: #0f172a; display: flex; align-items: center; justify-content: space-between; }
  .card h2 .count { font-size: 11px; color: #94a3b8; font-weight: 500; }
  .warn-sub { font-size: 12px; color: #92400e; margin-bottom: 12px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
  .grid-2 .card { margin-bottom: 0; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .kpi { background: #f8fafc; border-radius: 10px; padding: 14px; border: 1px solid #e2e8f0; }
  .kpi-label { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
  .kpi-value { font-size: 24px; font-weight: 800; color: #0f172a; line-height: 1.1; }
  .kpi-value .unit { font-size: 11px; color: #94a3b8; margin-left: 3px; font-weight: 500; }
  .kpi-sub { font-size: 11px; color: #94a3b8; margin-top: 4px; font-weight: 600; }
  table.bars { width: 100%; border-collapse: collapse; }
  table.bars tr { border-bottom: 1px solid #f1f5f9; }
  table.bars tr:last-child { border-bottom: none; }
  table.bars td { padding: 8px 4px; vertical-align: middle; }
  table.bars td.label { font-size: 12px; color: #475569; font-weight: 600; width: 70px; }
  table.bars td.bar-cell { width: auto; }
  table.bars td.value { font-size: 12px; color: #1e293b; font-weight: 700; text-align: right; width: 120px; white-space: nowrap; }
  .bar-bg { width: 100%; height: 10px; background: #f1f5f9; border-radius: 5px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 5px; }
  .hosp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .hosp-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #f1f5f9; }
  .hosp-row .rank { font-size: 11px; font-weight: 700; color: #94a3b8; width: 18px; text-align: center; }
  .hosp-row .hosp-main { flex: 1; min-width: 0; }
  .hosp-row .hosp-name { font-size: 13px; font-weight: 700; color: #1e293b; }
  .hosp-row .hosp-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .hosp-row .hosp-count { font-size: 14px; font-weight: 800; color: #2563eb; }
  .stage { display: inline-block; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: 4px; margin-left: 6px; vertical-align: middle; }
  .meet-list { display: flex; flex-direction: column; gap: 10px; }
  .meet-row { border-left: 3px solid #94a3b8; padding: 10px 14px; background: #fafbfc; border-radius: 0 8px 8px 0; }
  .meet-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .meet-head .date { font-size: 11px; font-weight: 700; color: #64748b; }
  .meet-head .type { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
  .meet-head .hosp { font-size: 13px; font-weight: 700; color: #1e293b; }
  .meet-head .region { font-size: 11px; color: #94a3b8; }
  .meet-head .doctor { font-size: 11px; color: #8b5cf6; font-weight: 600; }
  .meet-row .purpose { font-size: 12px; color: #1e293b; font-weight: 600; margin-top: 6px; }
  .meet-row .summary { font-size: 12px; color: #475569; margin-top: 4px; line-height: 1.6; }
  .meet-row .next { display: inline-block; font-size: 11px; color: #92400e; background: #fef3c7; padding: 3px 10px; border-radius: 5px; margin-top: 6px; font-weight: 600; }
  table.users, table.pipe, table.next-actions { width: 100%; border-collapse: collapse; }
  table.users td, table.pipe td, table.next-actions td, table.next-actions th { padding: 8px 6px; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
  table.next-actions th { text-align: left; font-weight: 700; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; background: #f8fafc; }
  table.next-actions td.date { color: #d97706; font-weight: 700; white-space: nowrap; width: 90px; }
  table.next-actions td.hosp { color: #1e293b; font-weight: 600; width: 180px; }
  table.users td.rank { width: 24px; color: #94a3b8; font-weight: 700; }
  table.users td.value { text-align: right; font-weight: 700; width: 60px; }
  table.pipe td { vertical-align: middle; }
  table.pipe td.arrow { color: #cbd5e1; text-align: center; width: 20px; }
  table.pipe td.value { text-align: right; font-weight: 700; color: #1e293b; }
  .pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .pill.gray { background: #f1f5f9; color: #64748b; }
  .pill.green { background: #d1fae5; color: #065f46; }
  .warn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .warn-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #fff; border-radius: 6px; border: 1px solid #fef3c7; }
  .warn-row .hosp-name { flex: 1; font-size: 12px; font-weight: 600; color: #1e293b; }
  .warn-row .ago { font-size: 11px; color: #d97706; font-weight: 700; }
  .muted { font-size: 12px; color: #94a3b8; padding: 8px 0; }
  .toolbar { position: sticky; top: 0; background: rgba(255,255,255,.95); backdrop-filter: blur(8px); padding: 12px 16px; border-bottom: 1px solid #e2e8f0; display: flex; gap: 10px; align-items: center; z-index: 100; }
  .toolbar .label { font-size: 12px; color: #64748b; font-weight: 600; }
  .toolbar button { background: #2563eb; color: #fff; border: 0; padding: 7px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .toolbar button:hover { background: #1d4ed8; }
  .toolbar button.secondary { background: #fff; color: #475569; border: 1px solid #e2e8f0; }
  .toolbar button.secondary:hover { background: #f8fafc; }
  @media print {
    .toolbar { display: none; }
    body { background: #fff; }
    .wrap { max-width: 100%; padding: 0; }
    .card { box-shadow: none; border: 1px solid #e2e8f0; page-break-inside: avoid; }
    .meet-row { page-break-inside: avoid; }
    .cover { background: #2563eb !important; }
  }
  @media (max-width: 720px) {
    .wrap { padding: 16px 12px 40px; }
    .kpi-grid { grid-template-columns: 1fr 1fr; }
    .grid-2 { grid-template-columns: 1fr; }
    .hosp-grid { grid-template-columns: 1fr; }
    .warn-grid { grid-template-columns: 1fr; }
    .cover h1 { font-size: 22px; }
  }
  `

  const title = `TODOC CRM 보고서 ${d.from} ~ ${d.to}`
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<div class="toolbar">
  <span class="label">📄 ${escHtml(title)}</span>
  <div style="flex:1"></div>
  <button onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
  <button class="secondary" onclick="window.close()">닫기</button>
</div>
<div class="wrap">
${body}
</div>
</body>
</html>`

  c.header('Content-Type', 'text/html; charset=utf-8')
  if (download) {
    const fn = `todoc_report_${d.from}_${d.to}.html`
    c.header('Content-Disposition', `attachment; filename="${fn}"`)
  }
  return c.body(html)
})

// ============================================================================
// 출장 거리 정산 보고서 (유류비 / 톨게이트비 증빙)
// GET /api/export/report/travel?from=&to=&user_id=&format=csv|xlsx&refresh=1
//
// 재무팀 제출용. 3개 섹션으로 구성합니다.
//   ① 일자별 운행 내역   — 국세청 별지 제65호(업무용승용차 운행기록부) 항목 포함
//   ② 구간별 이동 상세   — 어디서 어디로 몇 km 를 이동했는지 (거리 증빙의 근거)
//   ③ 방문 기관 좌표     — 거리 산출에 쓴 좌표를 그대로 노출 (검증 가능성 확보)
//
// 거리는 카카오모빌리티 길찾기 API 의 실제 도로 주행거리입니다. 직선거리가 아닙니다.
// 통행료는 카카오 추정치이며, 실제 증빙은 하이패스 내역(직접 입력값)이 우선합니다.
// ============================================================================
exports.get('/report/travel', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const userId = Number(c.req.query('user_id') || 0) || undefined
  const format = (c.req.query('format') || 'xlsx').toLowerCase()
  const noCache = c.req.query('refresh') === '1'

  if (!c.env.KAKAO_REST_API_KEY) {
    return c.json({
      error: '카카오 REST API 키가 서버에 설정되지 않았습니다.',
      message: '카카오 REST API 키가 서버에 설정되지 않았습니다. 거리 계산을 할 수 없습니다.',
    }, 503)
  }

  const { days, settings } = await buildDailyRoutes(c.env.DB, c.env.KAKAO_REST_API_KEY, {
    from, to, userId, noCache,
  })

  const periodLabel = (from || '전체') + ' ~ ' + (to || '전체')
  const generatedAt = new Date().toISOString().substring(0, 19).replace('T', ' ')

  // 정산 방식은 담당자 차량 형태(마이페이지 입력)에 따라 달라집니다.
  // 한 명이라도 금액 산출 대상이면 금액 열을 넣습니다.
  const showAmount = days.some(d => d.rule && d.rule.mode !== 'none')
  const modeLabels = Array.from(new Set(days.map(d => {
    const label = d.rule?.label || '미설정'
    return d.user_name ? `${d.user_name}: ${label}` : label
  })))
  const modeLabel = modeLabels.length ? modeLabels.join(' / ') : '해당 기간 운행 기록 없음'
  const taxWarnings = Array.from(new Set(
    days.filter(d => d.rule?.warning).map(d => `${d.user_name || '담당자 미지정'}: ${d.rule!.warning}`)
  ))

  // ── ① 일자별 운행 내역 ────────────────────────────────────────────────────
  // 계기판 주행거리(사용자 입력)와 API 산출 거리를 나란히 두어 재무팀이 대조할 수 있게 합니다.
  const dailyHeaders = [
    'No', '사용일자', '운전자', '차종', '자동차등록번호', '연료 종류',
    '주행전 계기판(km)', '주행후 계기판(km)', '계기판 주행거리(km)',
    '출발지', '복귀지', '경로 산출 방식', '보정 경유지',
    '방문 기관수', '행선지(방문 순서)', '방문 목적',
    'API 산출 주행거리(km)', '예상 소요시간(분)',
    '카카오 추정 통행료(원)', '실제 통행료(원)', '주유 금액(원)',
    ...(showAmount ? ['정산 금액(원)'] : []),
    '업무용 사용거리(km)', '업무사용비율(%)', '비고',
  ]
  const dailyRows: any[][] = []

  // ── ② 구간별 이동 상세 ────────────────────────────────────────────────────
  const legHeaders = ['No', '사용일자', '운전자', '구간순서', '출발지', '도착지', '거리(km)', '소요시간(분)']
  const legRows: any[][] = []

  // ── ③ 방문 기관 좌표 ──────────────────────────────────────────────────────
  const coordMap = new Map<string, any[]>()

  let no = 0
  let legNo = 0
  let totalKm = 0
  let totalTollEst = 0
  let totalTollActual = 0
  let totalFuel = 0
  let totalAmount = 0
  const failedDays: string[] = []
  const missingAll = new Set<string>()

  for (const d of days) {
    no++
    const log = d.log || {}
    const odoStart = log.odo_start ?? ''
    const odoEnd = log.odo_end ?? ''
    const odoDist = (odoStart !== '' && odoEnd !== '' && Number(odoEnd) >= Number(odoStart))
      ? Number(odoEnd) - Number(odoStart) : ''

    // 실제 방문 기관만 (출발지/복귀 제외)
    const visits = d.stops.filter(s => !s.is_origin && !s.is_return)

    // 출발지·복귀지는 날마다 다릅니다 (집에서 출발해 사무실로 복귀하는 등).
    // 재무팀이 동선을 확인할 수 있도록 종류(집/사무실)까지 함께 표기합니다.
    const originStop = d.stops.find(s => s.is_origin)
    const returnStop = d.stops.find(s => s.is_return)
    const endpointLabel = (s: typeof originStop) => {
      if (!s) return ''
      const t = s.place_type ? PLACE_TYPE_LABEL[s.place_type] : ''
      return t && t !== '기타' ? `${s.name} (${t})` : s.name
    }
    const originLabel = originStop ? endpointLabel(originStop) : '(첫 방문지에서 시작)'
    const returnLabel = returnStop ? endpointLabel(returnStop) : '(복귀 구간 없음)'
    const routeLabel = d.stops.map(s => s.name).join(' → ')
    const purposes = Array.from(new Set(visits.map(s => s.purpose).filter(Boolean))).join(' / ')

    // 담당자가 지도에서 찍은 '보정 경유지' — 추천·최단거리 어디에도 없는 길로 간 경우의 근거입니다.
    // 좌표만으로는 재무팀이 확인하기 어려우므로 개수와 좌표를 함께 남깁니다.
    const wps = d.route_waypoints || []
    const waypointLabel = wps.length
      ? `${wps.length}곳: ` + wps.map(w => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join(' / ')
      : ''

    const amount = settleAmount(d.distance_km, settings, d.rule)

    // 업무용 사용거리: 영업 방문이므로 전 구간 업무용으로 봅니다.
    // 총 주행거리는 계기판 값이 있으면 계기판 기준(국세청 서식 원칙), 없으면 API 거리입니다.
    // 업무사용비율은 정의상 100%를 넘을 수 없으므로 업무용 거리를 총 주행거리로 상한 처리합니다.
    const baseDist = odoDist !== '' ? Number(odoDist) : d.distance_km
    const odoShort = odoDist !== '' && d.distance_km > 0 && Number(odoDist) < d.distance_km
    const bizDistNum = baseDist ? Math.min(d.distance_km || baseDist, baseDist) : 0
    const bizDist = bizDistNum ? Math.round(bizDistNum * 10) / 10 : ''
    const bizRatio = baseDist ? Math.min(100, Math.round((bizDistNum / baseDist) * 1000) / 10) : ''

    const noteParts: string[] = []
    if (d.error) noteParts.push(`거리 계산 실패: ${d.error}`)
    if (d.missing_coords.length) noteParts.push(`좌표 미등록: ${d.missing_coords.join(', ')}`)
    if (odoShort) {
      noteParts.push(
        `계기판 주행거리(${odoDist}km)가 경로 산출 거리(${d.distance_km}km)보다 짧습니다 — 계기판 입력값 확인 필요`
      )
    }
    if (log.note) noteParts.push(String(log.note))

    // 차종·등록번호는 마이페이지 차량 정보를 기본값으로 쓰고,
    // 그 날 다른 차를 썼다면 운행기록(travel_logs)에 입력한 값이 우선합니다.
    const vehModel = log.vehicle_model || d.vehicle?.vehicle_model || ''
    const vehPlate = log.vehicle_plate || d.vehicle?.vehicle_plate || ''

    dailyRows.push([
      no,
      d.date,
      d.user_name || '',
      vehModel,
      vehPlate,
      // 통행료가 연료 종류에 따라 달라지므로(전기차 감면) 어떤 기준으로 계산했는지 남깁니다.
      d.fuel_label || '휘발유',
      odoStart,
      odoEnd,
      odoDist,
      originLabel,
      returnLabel,
      // 카카오 추천경로가 실제 동선과 다를 수 있어, 어떤 방식으로 산출했는지 밝혀둡니다.
      d.route_priority_label || '추천',
      waypointLabel,
      visits.length,
      routeLabel,
      purposes,
      d.distance_km || '',
      d.duration_min || '',
      d.toll || '',
      log.toll_amount ?? '',
      log.fuel_amount ?? '',
      ...(showAmount ? [amount || ''] : []),
      bizDist,
      bizRatio,
      noteParts.join(' / '),
    ])

    for (let i = 0; i < d.legs.length; i++) {
      const l = d.legs[i]
      legNo++
      legRows.push([legNo, d.date, d.user_name || '', i + 1, l.from, l.to, l.distance_km, l.duration_min])
    }

    for (const s of visits) {
      if (!s.name) continue
      if (!coordMap.has(s.name)) {
        coordMap.set(s.name, [s.name, s.region || '', s.address || '', s.lat ?? '', s.lng ?? '', 0])
      }
      const row = coordMap.get(s.name)!
      row[5] = Number(row[5]) + 1
    }

    totalKm += d.distance_km
    totalTollEst += d.toll
    totalTollActual += Number(log.toll_amount) || 0
    totalFuel += Number(log.fuel_amount) || 0
    totalAmount += amount
    if (d.error) failedDays.push(d.date)
    for (const m of d.missing_coords) missingAll.add(m)
  }

  totalKm = Math.round(totalKm * 10) / 10

  const coordHeaders = ['No', '기관명', '지역', '주소', '위도', '경도', '방문횟수']
  const coordRows: any[][] = Array.from(coordMap.values())
    .sort((a, b) => Number(b[5]) - Number(a[5]))
    .map((r, i) => [i + 1, ...r])

  // ── 요약 ──────────────────────────────────────────────────────────────────
  // 출발지·복귀지가 날마다 다르므로 요약에는 실제로 쓰인 조합을 모아 보여줍니다.
  const endpointPairs = new Map<string, number>()
  for (const d of days) {
    const o = d.stops.find(s => s.is_origin)
    const r = d.stops.find(s => s.is_return)
    const lbl = (s: any, none: string) => {
      if (!s) return none
      const t = s.place_type ? PLACE_TYPE_LABEL[s.place_type] : ''
      return t && t !== '기타' ? `${s.name}(${t})` : s.name
    }
    const k = `${lbl(o, '첫 방문지')} → ${lbl(r, '복귀 없음')}`
    endpointPairs.set(k, (endpointPairs.get(k) || 0) + 1)
  }
  const endpointSummary = endpointPairs.size
    ? Array.from(endpointPairs.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}일`)
        .join(' / ')
    : '해당 없음'

  // 경로 방식·연료 종류가 섞여 있으면 통행료 기준이 달라지므로 요약에 분포를 남깁니다.
  const countBy = (vals: string[]) => {
    const m = new Map<string, number>()
    for (const v of vals) m.set(v, (m.get(v) || 0) + 1)
    return m.size
      ? Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}일`).join(' / ')
      : '해당 없음'
  }
  const prioritySummary = countBy(days.map(d => d.route_priority_label || '추천'))
  const fuelSummary = countBy(days.map(d => d.fuel_label || '휘발유'))
  const waypointDays = days.filter(d => (d.route_waypoints || []).length > 0)

  const summaryRows: any[][] = [
    ['보고서 기간', periodLabel],
    ['생성 일시', generatedAt],
    ['거리 산출 방식', '카카오모빌리티 길찾기 API — 실제 도로 주행거리 (직선거리 아님)'],
    ['경로 산출 방식', prioritySummary],
    ['통행료 산출 방식', '카카오 추정치 (차량 연료 종류 반영 · 실제 증빙은 하이패스 이용내역 기준)'],
    ['차량 연료 종류', fuelSummary + ' — 전기차는 통행료 감면이 적용됩니다'],
    ['지도 보정 경유지 사용', waypointDays.length
      ? `${waypointDays.length}일 (${waypointDays.map(d => d.date).join(', ')}) — 추천·최단거리에 없는 실제 동선을 반영`
      : '없음'],
    ['정산 방식', modeLabel],
    ['출발지·복귀지', endpointSummary],
    ['기본 출발지(전역 설정)', settings.origin_lat !== null
      ? `${settings.origin_name || '(이름 미설정)'} ${settings.origin_address || ''}`.trim()
      : '미설정 — 등록한 장소나 그 날의 첫 방문지를 기준으로 계산합니다'],
    ['운행 일수', days.length],
    ['총 주행거리(km)', totalKm],
    ['카카오 추정 통행료 합계(원)', totalTollEst],
    ['실제 통행료 합계(원)', totalTollActual],
    ['주유 금액 합계(원)', totalFuel],
    ...(showAmount ? [['정산 금액 합계(원)', totalAmount]] : []),
    ['거리 계산 실패 일자', failedDays.length ? failedDays.join(', ') : '없음'],
    ['좌표 미등록 기관', missingAll.size ? Array.from(missingAll).join(', ') : '없음'],
    ...taxWarnings.map(w => ['⚠️ 확인 필요', w]),
  ]

  const fnBase = `todoc_travel_report_${ts()}`

  if (format === 'csv') {
    const lines: string[] = []
    lines.push('# TODOC CRM 출장 거리 정산 보고서 (' + periodLabel + ')')
    lines.push('# 생성 일시: ' + generatedAt)
    lines.push('# 거리 산출: 카카오모빌리티 길찾기 API 실제 도로 주행거리')
    lines.push('')
    lines.push(toCsvRow(dailyHeaders))
    for (const r of dailyRows) lines.push(toCsvRow(r))
    lines.push('')
    lines.push('# ── 구간별 이동 상세 ──')
    lines.push(toCsvRow(legHeaders))
    for (const r of legRows) lines.push(toCsvRow(r))
    lines.push('')
    lines.push('# ── 방문 기관 좌표 ──')
    lines.push(toCsvRow(coordHeaders))
    for (const r of coordRows) lines.push(toCsvRow(r))
    lines.push('')
    lines.push('# ── 요약 ──')
    lines.push(toCsvRow(['항목', '값']))
    for (const r of summaryRows) lines.push(toCsvRow(r))
    const bom = '\uFEFF'
    c.header('Content-Type', 'text/csv; charset=utf-8')
    c.header('Content-Disposition', `attachment; filename="${fnBase}.csv"`)
    return c.body(bom + lines.join('\n'))
  }

  // ── 재무팀 제출 양식 (.xlsx) ──────────────────────────────────────────────
  // 사내에서 쓰는 「월 교통비 정산내역」 양식과 동일한 레이아웃으로 만듭니다.
  // 담당자 1명 = 시트 3장 (정산내역 / 증빙 / 증빙 톨게이트).
  //
  // 양식은 '편도 구간 1건 = 1행' 구조입니다. 우리 데이터는 하루 단위로
  // 모여 있으므로 legs(구간)를 펼쳐서 행으로 만듭니다.
  const byUser = new Map<string, typeof days>()
  for (const d of days) {
    const k = d.user_name || '담당자 미지정'
    if (!byUser.has(k)) byUser.set(k, [] as any)
    ;(byUser.get(k) as any).push(d)
  }

  // 정산 월 — 기간이 한 달 안에 있을 때만 표기합니다.
  const monthOf = (v: string) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(v || ''))
    return m ? `${m[1]}-${m[2]}` : ''
  }
  const monthsUsed = Array.from(new Set(days.map(d => monthOf(d.date)).filter(Boolean)))
  const reportMonth = monthsUsed.length === 1 ? Number(monthsUsed[0].substring(5, 7)) : null

  const formSheets: any[] = []
  for (const [userName, uDays] of byUser) {
    const legs: FormLeg[] = []
    let iceVeh: FormVehicle | null = null
    let evVeh: FormVehicle | null = null
    let department = ''

    for (const d of uDays) {
      const log: any = d.log || {}
      department = department || String(d.vehicle?.department || '')

      // 차량정보 블록 — 실제로 쓴 차량을 연료 종류별로 하나씩 채웁니다.
      const veh: FormVehicle = {
        model: log.vehicle_model || d.vehicle?.vehicle_model || '',
        fuel: String(d.fuel || 'GASOLINE'),
        efficiency: Number(d.rule?.fuel_efficiency || settings.fuel_efficiency || 0),
        price: Number(d.rule?.fuel_price || settings.fuel_price || 0),
      }
      if (String(d.fuel || '').toUpperCase() === 'ELECTRIC') {
        if (!evVeh) evVeh = veh
      } else if (!iceVeh) {
        iceVeh = veh
      }

      // 그 날 통행료는 구간별로 나눌 근거가 없습니다 (카카오는 하루 총액만 제공).
      // 하이패스 증빙과 대조할 수 있도록 그 날 마지막 구간 행에만 총액을 넣습니다.
      const dayToll = Number(log.toll_amount) || d.toll || 0
      const tollIsEstimate = !(Number(log.toll_amount) > 0) && d.toll > 0

      if (!d.legs.length) {
        // 거리 계산이 실패했거나 방문 1곳뿐이라 구간이 없는 날 — 사실을 남깁니다.
        const only = d.stops[0]
        legs.push({
          date: d.date,
          from_name: only?.name || '', from_region: regionLabel(only?.address, only?.region),
          to_name: '', to_region: '',
          distance_km: 0, toll: dayToll, parking: 0, etc: 0,
          fuel: String(d.fuel || 'GASOLINE'),
          note: d.error ? `거리 계산 실패: ${d.error}` : (log.note || ''),
        })
        continue
      }

      for (let i = 0; i < d.legs.length; i++) {
        const l = d.legs[i]
        const fromStop = d.stops[i]
        const toStop = d.stops[i + 1]
        const isLast = i === d.legs.length - 1

        const notes: string[] = []
        if (isLast && tollIsEstimate && dayToll > 0) {
          notes.push('톨비는 카카오 추정치 — 하이패스 내역으로 확인 필요')
        }
        if (isLast && d.missing_coords.length) {
          notes.push(`좌표 미등록: ${d.missing_coords.join(', ')}`)
        }
        if (isLast && (d.route_waypoints || []).length) {
          notes.push(`실제 동선 반영(보정 경유지 ${d.route_waypoints.length}곳)`)
        }
        if (isLast && d.route_priority_label && d.route_priority_label !== '추천') {
          notes.push(`경로: ${d.route_priority_label}`)
        }
        if (isLast && log.note) notes.push(String(log.note))

        legs.push({
          date: d.date,
          from_name: l.from,
          from_region: regionLabel(fromStop?.address, fromStop?.region),
          to_name: l.to,
          to_region: regionLabel(toStop?.address, toStop?.region),
          distance_km: l.distance_km,
          // 톨비는 마지막 구간에만 (일 총액). 나머지 구간은 비웁니다.
          toll: isLast ? dayToll : 0,
          // 주차비·기타는 법인카드 항목으로 우리 데이터에 없습니다 — 담당자가 직접 입력합니다.
          parking: 0,
          etc: 0,
          fuel: String(d.fuel || 'GASOLINE'),
          note: notes.join(' / '),
        })
      }
    }

    const input: FormSheetInput = {
      userName,
      department: department || '영업팀',
      month: reportMonth,
      legs,
      ice: iceVeh,
      ev: evVeh,
      // 양식처럼 빈 행도 수식을 유지해 담당자가 직접 추가 입력할 수 있게 합니다.
      minRows: Math.max(legs.length + 6, 20),
    }
    formSheets.push(buildFormSheet(input))
    formSheets.push(buildEvidenceSheet(userName))
    formSheets.push(buildTollEvidenceSheet(userName, periodLabel))
  }

  // 기간 내 운행 기록이 없으면 산출근거 시트만 남아 「양식이 없다」고
  // 오해하기 쉬우므로, 빈 양식 1장을 넣어 수식과 안내문을 그대로 쓰게 합니다.
  if (!formSheets.length) {
    formSheets.push(buildFormSheet({
      userName: '정산내역',
      department: '',
      month: reportMonth,
      legs: [],
      ice: {
        model: '',
        fuel: 'GASOLINE',
        efficiency: Number(settings.fuel_efficiency || 0),
        price: Number(settings.fuel_price || 0),
      },
      ev: null,
      minRows: 20,
    }))
    formSheets.push(buildEvidenceSheet('정산내역'))
    formSheets.push(buildTollEvidenceSheet('정산내역', periodLabel))
  }

  // 산출 근거 — 재무팀이 거리·좌표를 역추적할 수 있도록 남깁니다.
  const plain = (name: string, headers: string[], rows: any[][]) => ({
    name,
    cols: headers.map(h => Math.min(28, Math.max(10, h.length * 2.2))),
    rows: [
      headers.map(h => ({ v: h, s: 3 })),
      ...rows.map(r => r.map(v => ({ v: (v === '' || v === null || v === undefined) ? '' : v, s: 5 }))),
    ],
    freeze: 'A2',
  })

  const sheets = [
    ...formSheets,
    plain('산출근거 요약', ['항목', '값'], summaryRows),
    plain('산출근거 일자별', dailyHeaders, dailyRows),
    plain('산출근거 구간별', legHeaders, legRows),
    plain('산출근거 좌표', coordHeaders, coordRows),
  ]

  const bin = buildXlsx(sheets, FORM_STYLES)
  c.header('Content-Type', XLSX_CONTENT_TYPE)
  c.header('Content-Disposition', `attachment; filename="${fnBase}.xlsx"`)
  return c.body(bin)
})

export default exports
