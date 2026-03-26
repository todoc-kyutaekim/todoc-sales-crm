import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = { DB: D1Database }
const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// ===== Hospitals =====
app.get('/api/hospitals', async (c) => {
  const { region, status, search, grade } = c.req.query()
  let q = `SELECT h.*, COUNT(DISTINCT d.id) as doctor_count, COUNT(DISTINCT m.id) as meeting_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meetings m ON h.id = m.hospital_id`
  const conds: string[] = [], params: any[] = []
  if (region) { conds.push('h.region = ?'); params.push(region) }
  if (status) { conds.push('h.status = ?'); params.push(status) }
  if (grade) { conds.push('h.grade = ?'); params.push(grade) }
  if (search) { conds.push('h.name LIKE ?'); params.push(`%${search}%`) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' GROUP BY h.id ORDER BY h.grade ASC, h.name ASC'
  const r = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ data: r.results })
})
app.get('/api/hospitals/:id', async (c) => {
  const h = await c.env.DB.prepare('SELECT * FROM hospitals WHERE id = ?').bind(c.req.param('id')).first()
  return h ? c.json({ data: h }) : c.json({ error: 'Not found' }, 404)
})
app.post('/api/hospitals', async (c) => {
  const b = await c.req.json()
  const r = await c.env.DB.prepare('INSERT INTO hospitals (name,region,address,phone,grade,notes,status) VALUES (?,?,?,?,?,?,?)').bind(b.name, b.region||'', b.address||'', b.phone||'', b.grade||'A', b.notes||'', b.status||'active').run()
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})
app.put('/api/hospitals/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE hospitals SET name=?,region=?,address=?,phone=?,grade=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.name, b.region||'', b.address||'', b.phone||'', b.grade||'A', b.notes||'', b.status||'active', id).run()
  return c.json({ data: { id: Number(id), ...b } })
})
app.delete('/api/hospitals/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM hospitals WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ===== Doctors =====
app.get('/api/hospitals/:hid/doctors', async (c) => {
  const r = await c.env.DB.prepare('SELECT d.*, MAX(m.meeting_date) as last_meeting, COUNT(m.id) as meeting_count FROM doctors d LEFT JOIN meetings m ON d.id=m.doctor_id WHERE d.hospital_id=? GROUP BY d.id ORDER BY d.influence_level DESC, d.name').bind(c.req.param('hid')).all()
  return c.json({ data: r.results })
})
app.get('/api/doctors', async (c) => {
  const { search } = c.req.query()
  let q = 'SELECT d.*, h.name as hospital_name, MAX(m.meeting_date) as last_meeting, COUNT(m.id) as meeting_count FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id LEFT JOIN meetings m ON d.id=m.doctor_id'
  const p: any[] = []
  if (search) { q += ' WHERE d.name LIKE ? OR h.name LIKE ?'; p.push(`%${search}%`, `%${search}%`) }
  q += ' GROUP BY d.id ORDER BY d.name'
  const r = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ data: r.results })
})
app.post('/api/doctors', async (c) => {
  const b = await c.req.json()
  const r = await c.env.DB.prepare('INSERT INTO doctors (hospital_id,name,department,position,phone,email,specialty,influence_level,notes,photo) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(b.hospital_id, b.name, b.department||'', b.position||'', b.phone||'', b.email||'', b.specialty||'', b.influence_level||'medium', b.notes||'', b.photo||'').run()
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})
app.put('/api/doctors/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE doctors SET hospital_id=?,name=?,department=?,position=?,phone=?,email=?,specialty=?,influence_level=?,notes=?,photo=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.hospital_id, b.name, b.department||'', b.position||'', b.phone||'', b.email||'', b.specialty||'', b.influence_level||'medium', b.notes||'', b.photo||'', id).run()
  return c.json({ data: { id: Number(id), ...b } })
})
app.delete('/api/doctors/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM doctors WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})
app.post('/api/doctors/:id/photo', async (c) => {
  const body = await c.req.json()
  if (!body.photo) return c.json({ error: 'No photo' }, 400)
  await c.env.DB.prepare('UPDATE doctors SET photo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.photo, c.req.param('id')).run()
  return c.json({ success: true })
})
app.delete('/api/doctors/:id/photo', async (c) => {
  await c.env.DB.prepare("UPDATE doctors SET photo='', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ===== Meetings =====
app.get('/api/meetings', async (c) => {
  const { doctor_id, hospital_id, limit } = c.req.query()
  let q = 'SELECT m.*, d.name as doctor_name, d.photo as doctor_photo, h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id=d.id LEFT JOIN hospitals h ON m.hospital_id=h.id'
  const conds: string[] = [], p: any[] = []
  if (doctor_id) { conds.push('m.doctor_id=?'); p.push(doctor_id) }
  if (hospital_id) { conds.push('m.hospital_id=?'); p.push(hospital_id) }
  if (conds.length) q += ' WHERE ' + conds.join(' AND ')
  q += ' ORDER BY m.meeting_date DESC'
  if (limit) q += ` LIMIT ${parseInt(limit)}`
  const r = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ data: r.results })
})
app.post('/api/meetings', async (c) => {
  const b = await c.req.json()
  const r = await c.env.DB.prepare('INSERT INTO meetings (doctor_id,hospital_id,meeting_date,meeting_type,purpose,content,result,next_action,next_meeting_date) VALUES (?,?,?,?,?,?,?,?,?)').bind(b.doctor_id, b.hospital_id, b.meeting_date, b.meeting_type||'visit', b.purpose||'', b.content||'', b.result||'', b.next_action||'', b.next_meeting_date||null).run()
  return c.json({ data: { id: r.meta.last_row_id, ...b } }, 201)
})
app.put('/api/meetings/:id', async (c) => {
  const b = await c.req.json(); const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE meetings SET doctor_id=?,hospital_id=?,meeting_date=?,meeting_type=?,purpose=?,content=?,result=?,next_action=?,next_meeting_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(b.doctor_id, b.hospital_id, b.meeting_date, b.meeting_type||'visit', b.purpose||'', b.content||'', b.result||'', b.next_action||'', b.next_meeting_date||null, id).run()
  return c.json({ data: { id: Number(id), ...b } })
})
app.delete('/api/meetings/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// ===== Dashboard =====
app.get('/api/dashboard', async (c) => {
  const [hospitals, doctors, meetings, monthMeetings, recentMeetings, upcomingActions, regionStats] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as c FROM hospitals WHERE status="active"').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM doctors').first(),
    c.env.DB.prepare('SELECT COUNT(*) as c FROM meetings').first(),
    c.env.DB.prepare("SELECT COUNT(*) as c FROM meetings WHERE meeting_date >= date('now','start of month')").first(),
    c.env.DB.prepare('SELECT m.*,d.name as doctor_name,d.photo as doctor_photo,h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id=d.id LEFT JOIN hospitals h ON m.hospital_id=h.id ORDER BY m.meeting_date DESC LIMIT 8').all(),
    c.env.DB.prepare("SELECT m.*,d.name as doctor_name,h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id=d.id LEFT JOIN hospitals h ON m.hospital_id=h.id WHERE m.next_action!='' AND m.next_action IS NOT NULL ORDER BY m.next_meeting_date ASC LIMIT 10").all(),
    c.env.DB.prepare('SELECT region, COUNT(*) as count FROM hospitals WHERE status="active" AND region!="" GROUP BY region ORDER BY count DESC').all(),
  ])
  return c.json({ data: {
    stats: { hospitals: (hospitals as any)?.c||0, doctors: (doctors as any)?.c||0, meetings: (meetings as any)?.c||0, monthMeetings: (monthMeetings as any)?.c||0 },
    recentMeetings: recentMeetings.results, upcomingActions: upcomingActions.results, regionStats: regionStats.results
  }})
})
app.get('/api/regions', async (c) => {
  const r = await c.env.DB.prepare('SELECT DISTINCT region FROM hospitals WHERE region!="" ORDER BY region').all()
  return c.json({ data: r.results.map((x: any) => x.region) })
})

// ===== CI Statistics (S5800) - 실제 HIRA 데이터 =====
app.get('/api/ci-stats', async (c) => {
  const [ioAll, age10All, age5All, regionAll, instAll] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient ORDER BY year ASC, gender ASC").all(),
    c.env.DB.prepare("SELECT * FROM ci_age10_stats WHERE gender != '계' AND age_group NOT IN ('계','소계') ORDER BY year ASC, gender ASC, id ASC").all(),
    c.env.DB.prepare("SELECT * FROM ci_age5_stats WHERE gender != '계' AND age_group NOT IN ('계','소계') ORDER BY year ASC, gender ASC, id ASC").all(),
    c.env.DB.prepare("SELECT * FROM ci_region_stats WHERE region != '계' ORDER BY year ASC, patients DESC").all(),
    c.env.DB.prepare("SELECT * FROM ci_institution_stats WHERE institution_type != '계' ORDER BY year ASC, patients DESC").all(),
  ])

  // 연도별 총계 (입원외래에서)
  const ioTotals = (ioAll.results as any[]).filter(r => r.gender === '계' && r.visit_type === '계')
  const ioMale = (ioAll.results as any[]).filter(r => r.gender === '남' && r.visit_type === '소계')
  const ioFemale = (ioAll.results as any[]).filter(r => r.gender === '여' && r.visit_type === '소계')

  const yearlyData = ioTotals.map(t => {
    const m = ioMale.find(x => x.year === t.year)
    const f = ioFemale.find(x => x.year === t.year)
    return {
      year: t.year, patients: t.patients, usage: t.usage, amount: t.amount,
      male_patients: m?.patients || 0, male_usage: m?.usage || 0, male_amount: m?.amount || 0,
      female_patients: f?.patients || 0, female_usage: f?.usage || 0, female_amount: f?.amount || 0
    }
  })

  // 연령대 10세 구간 (성별)
  const age10Data = age10All.results as any[]
  const age5Data = age5All.results as any[]

  // 지역별 (연도별)
  const regionData = regionAll.results as any[]
  const years = [...new Set(regionData.map((r:any) => r.year))].sort()

  // 요양기관 종별 (연도별)
  const instData = instAll.results as any[]

  // 인사이트 자동 계산
  const insights: any[] = []
  if (yearlyData.length >= 2) {
    const first = yearlyData[0], last = yearlyData[yearlyData.length - 1]
    const cagrP = (Math.pow(last.patients / first.patients, 1 / (last.year - first.year)) - 1) * 100
    const cagrU = (Math.pow(last.usage / first.usage, 1 / (last.year - first.year)) - 1) * 100
    insights.push({ icon: 'fa-chart-line', title: '환자수 연평균 성장률', value: cagrP.toFixed(1) + '%', desc: first.year + '년 ' + first.patients + '명 → ' + last.year + '년 ' + last.patients + '명' })
    insights.push({ icon: 'fa-arrow-trend-up', title: '시술건수 연평균 성장률', value: cagrU.toFixed(1) + '%', desc: first.year + '년 ' + first.usage + '건 → ' + last.year + '년 ' + last.usage + '건' })
    const totalM = yearlyData.reduce((a, b) => a + b.male_patients, 0)
    const totalF = yearlyData.reduce((a, b) => a + b.female_patients, 0)
    const total = totalM + totalF
    if (total > 0) insights.push({ icon: 'fa-venus-mars', title: '성비 (남:여)', value: (totalM / total * 100).toFixed(1) + ':' + (totalF / total * 100).toFixed(1), desc: '전체 기간 누적 성비' })
    const totalAmount = yearlyData.reduce((a, b) => a + b.amount, 0)
    insights.push({ icon: 'fa-won-sign', title: '6년간 총 진료금액', value: (totalAmount / 1000).toFixed(0) + '억원', desc: '2019-2024 누적 (단위: 천원 기준)' })
  }

  // 최신 연도 지역 집중도
  const latestYear = years[years.length - 1]
  const latestRegion = regionData.filter((r: any) => r.year === latestYear)
  const totalRegPat = latestRegion.reduce((a: number, b: any) => a + b.patients, 0)
  const seoulGyeonggi = latestRegion.filter((r: any) => r.region === '서울' || r.region === '경기').reduce((a: number, b: any) => a + b.patients, 0)
  if (totalRegPat > 0) insights.push({ icon: 'fa-city', title: '수도권 집중도', value: (seoulGyeonggi / totalRegPat * 100).toFixed(1) + '%', desc: latestYear + '년 서울+경기 환자 비율' })

  // 최신 연도 상급종합 비율
  const latestInst = instData.filter((i: any) => i.year === latestYear)
  const totalInstPat = latestInst.reduce((a: number, b: any) => a + b.patients, 0)
  const topInst = latestInst[0]
  if (topInst && totalInstPat > 0) insights.push({ icon: 'fa-hospital', title: topInst.institution_type + ' 비율', value: (topInst.patients / totalInstPat * 100).toFixed(1) + '%', desc: latestYear + '년 기준 환자수 비율' })

  return c.json({
    data: {
      source: '건강보험심사평가원 보건의료빅데이터개방시스템',
      code: 'S5800 (인공와우이식술)',
      period: yearlyData.length ? yearlyData[0].year + '-' + yearlyData[yearlyData.length - 1].year : '-',
      years: years,
      yearly: yearlyData,
      age10: age10Data,
      age5: age5Data,
      region: regionData,
      institution: instData,
      insights,
      policyChanges: [
        { year: 2005, event: '인공와우 이식술 요양급여 대상 최초 지정' },
        { year: 2009, event: '2세 미만 소아 양측 인공와우 건강보험 급여 인정' },
        { year: 2015, event: '건강보험 인정 기준 대폭 확대 (보장성 강화)' },
        { year: 2017, event: '건강보험 적용 연령 15세 → 19세 미만 확대' },
        { year: 2018, event: '모든 어린이 건강보험 비용 전액 지원 시작' },
        { year: 2025, event: '급여 기준 지속 확대 논의 중' }
      ]
    }
  })
})

// ===== SPA =====
app.get('*', (c) => c.html(HTML))

const HTML = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>TODOC CRM</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/axios@1.7.0/dist/axios.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>tailwind.config={theme:{extend:{fontFamily:{sans:['Pretendard','Inter','-apple-system','sans-serif']},colors:{brand:{50:'#eef4ff',100:'#d9e6ff',200:'#bcd2ff',300:'#8eb5ff',400:'#598eff',500:'#3366ff',600:'#1a4fff',700:'#0a3ae6',800:'#0d32ba',900:'#102d92'}}}}}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Pretendard','Inter',-apple-system,sans-serif;background:#f8f9fb}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:10px}
.fade-in{animation:fadeIn .3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes toastIn{from{transform:translateX(110%);opacity:0}to{transform:none;opacity:1}}
@keyframes toastOut{to{transform:translateX(110%);opacity:0}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.skeleton{background:linear-gradient(90deg,#e5e7eb 25%,#f3f4f6 50%,#e5e7eb 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}

/* Modal */
.modal-bg{background:rgba(15,23,42,.5);backdrop-filter:blur(6px)}
.modal-box{animation:slideUp .25s ease}

/* Card */
.card{background:#fff;border-radius:14px;border:1px solid #f0f0f3;transition:all .2s ease}
.card:hover{box-shadow:0 8px 30px rgba(0,0,0,.06);transform:translateY(-1px)}
.card-flat{background:#fff;border-radius:14px;border:1px solid #f0f0f3}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:7px;padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;transition:all .15s;cursor:pointer;border:none;letter-spacing:-.01em}
.btn-primary{background:#3366ff;color:#fff;box-shadow:0 2px 8px rgba(51,102,255,.25)}.btn-primary:hover{background:#1a4fff;box-shadow:0 4px 14px rgba(51,102,255,.35)}
.btn-success{background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,.25)}.btn-success:hover{background:#047857}
.btn-danger-fill{background:#ef4444;color:#fff}.btn-danger-fill:hover{background:#dc2626}
.btn-ghost{background:transparent;color:#64748b;padding:7px 10px}.btn-ghost:hover{background:#f1f5f9;color:#334155}
.btn-outline{background:#fff;color:#334155;border:1.5px solid #e5e7eb}.btn-outline:hover{background:#f9fafb;border-color:#d1d5db}

/* Input */
.input{width:100%;padding:10px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;transition:all .15s;outline:none;font-family:inherit;background:#fff;color:#1e293b}
.input:focus{border-color:#3366ff;box-shadow:0 0 0 3px rgba(51,102,255,.08)}
.input::placeholder{color:#a0aec0}
.input-label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px}
select.input{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}
textarea.input{resize:vertical;min-height:76px}

/* Badges */
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.02em}
.grade-S{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.grade-A{background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe}
.grade-B{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.grade-C{background:#f3f4f6;color:#4b5563;border:1px solid #e5e7eb}
.inf-high{background:#fef2f2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
.inf-medium{background:#fffbeb;color:#92400e;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600}
.inf-low{color:#9ca3af;font-size:11px}

/* Nav */
.nav-item{display:flex;align-items:center;gap:11px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:500;color:rgba(255,255,255,.55);cursor:pointer;transition:all .15s;margin:2px 10px}
.nav-item:hover{background:rgba(255,255,255,.07);color:rgba(255,255,255,.85)}
.nav-item.active{background:rgba(51,102,255,.25);color:#fff;font-weight:700}
.nav-item .nav-icon{width:18px;text-align:center;font-size:14px}

/* Avatar */
.avatar{width:40px;height:40px;border-radius:12px;object-fit:cover;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-weight:700;color:#64748b;font-size:14px;flex-shrink:0;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.photo-up{position:relative;cursor:pointer}
.photo-up:hover .photo-ov{opacity:1}
.photo-ov{position:absolute;inset:0;background:rgba(0,0,0,.45);border-radius:12px;display:flex;align-items:center;justify-content:center;opacity:0;transition:.2s;color:#fff;font-size:14px}

/* Stat card */
.sc{background:#fff;border-radius:14px;padding:22px;border:1px solid #f0f0f3;position:relative;overflow:hidden;transition:all .2s}
.sc:hover{box-shadow:0 6px 20px rgba(0,0,0,.05);transform:translateY(-2px)}
.sc-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px}

/* Meeting type */
.mt{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600}
.mt-visit{background:#eff6ff;color:#1d4ed8}.mt-phone{background:#ecfdf5;color:#047857}.mt-conference{background:#faf5ff;color:#7c3aed}.mt-email{background:#fefce8;color:#a16207}.mt-online{background:#eef2ff;color:#4338ca}

/* Table */
.tr{transition:.1s}.tr:hover{background:#fafbfc}

/* Empty state */
.empty{text-align:center;padding:56px 20px;color:#94a3b8}
.empty .empty-icon{width:64px;height:64px;border-radius:20px;background:#f8fafc;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;font-size:24px;color:#cbd5e1}

/* Toast */
#toast-wrap{position:fixed;top:20px;right:20px;z-index:100;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:500;box-shadow:0 8px 30px rgba(0,0,0,.12);animation:toastIn .3s ease;min-width:280px;color:#fff}
.toast.out{animation:toastOut .25s ease forwards}
.toast-ok{background:#059669}.toast-err{background:#dc2626}.toast-warn{background:#d97706}

/* Accent bar */
.accent-S{border-left:4px solid #f59e0b}
.accent-A{border-left:4px solid #3b82f6}
.accent-B{border-left:4px solid #10b981}
.accent-C{border-left:4px solid #9ca3af}

/* Tab */
.tab{display:inline-flex;align-items:center;gap:6px;padding:10px 18px;font-size:13px;font-weight:600;color:#94a3b8;border-bottom:2px solid transparent;cursor:pointer;transition:.15s}
.tab:hover{color:#64748b}
.tab.active{color:#3366ff;border-color:#3366ff}

/* Timeline */
.tl-dot{width:10px;height:10px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 2px #3b82f6;flex-shrink:0}
.tl-line{width:2px;background:#e5e7eb;flex-shrink:0;min-height:20px}
</style>
</head>
<body class="h-screen overflow-hidden">
<div id="toast-wrap"></div>
<div class="flex h-screen">

<!-- Sidebar -->
<aside class="w-[250px] bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col flex-shrink-0 select-none">
  <div class="px-6 py-5 flex items-center gap-3">
    <div class="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm-2 13H8V9h2v7zm4 0h-2V9h2v7z" fill="#fff"/></svg>
    </div>
    <div>
      <div class="text-white font-extrabold text-[15px] tracking-tight">TODOC</div>
      <div class="text-slate-400 text-[10px] tracking-widest font-medium">SALES CRM</div>
    </div>
  </div>
  <div class="h-px bg-slate-700/50 mx-5"></div>
  <nav class="flex-1 py-4 space-y-1">
    <div onclick="nav('dashboard')" id="n-dashboard" class="nav-item"><span class="nav-icon"><i class="fas fa-chart-pie"></i></span>대시보드</div>
    <div onclick="nav('hospitals')" id="n-hospitals" class="nav-item"><span class="nav-icon"><i class="fas fa-hospital"></i></span>병원 관리</div>
    <div onclick="nav('doctors')" id="n-doctors" class="nav-item"><span class="nav-icon"><i class="fas fa-user-doctor"></i></span>교수 관리</div>
    <div onclick="nav('meetings')" id="n-meetings" class="nav-item"><span class="nav-icon"><i class="fas fa-calendar-check"></i></span>미팅 기록</div>
    <div class="h-px bg-slate-700/50 mx-5 my-3"></div>
    <div class="px-5 mb-2"><span class="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Market Data</span></div>
    <div onclick="nav('cistats')" id="n-cistats" class="nav-item"><span class="nav-icon"><i class="fas fa-chart-bar"></i></span>인공와우 통계</div>
  </nav>
  <div class="px-5 py-4 border-t border-slate-700/50">
    <div class="text-[10px] text-slate-500 leading-relaxed font-medium">&copy; 2026 TODOC Inc.<br>Cochlear Implant Solutions</div>
  </div>
</aside>

<!-- Main -->
<main class="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#f8f9fb]">
  <header class="h-[60px] bg-white border-b border-gray-100 flex items-center justify-between px-7 flex-shrink-0">
    <div class="flex items-center gap-3">
      <h2 id="page-title" class="text-[16px] font-bold text-slate-800 tracking-tight"></h2>
      <span id="page-subtitle" class="text-xs text-slate-400 font-medium"></span>
    </div>
    <div id="header-actions" class="flex items-center gap-2"></div>
  </header>
  <div id="content" class="flex-1 overflow-y-auto"></div>
</main>
</div>

<!-- Modal -->
<div id="modal" class="fixed inset-0 modal-bg z-50 hidden flex items-center justify-center p-4" onclick="if(event.target===this)closeModal()">
  <div class="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
      <h3 id="modal-title" class="font-bold text-slate-800 text-[15px]"></h3>
      <button onclick="closeModal()" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition"><i class="fas fa-xmark text-lg"></i></button>
    </div>
    <div id="modal-body" class="p-6"></div>
  </div>
</div>

<!-- Confirm Dialog -->
<div id="confirm-dialog" class="fixed inset-0 modal-bg z-[60] hidden flex items-center justify-center p-4">
  <div class="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
    <div id="confirm-icon" class="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4"><i class="fas fa-trash text-red-400 text-xl"></i></div>
    <h4 id="confirm-title" class="font-bold text-slate-800 text-[15px] mb-2"></h4>
    <p id="confirm-msg" class="text-sm text-slate-500 mb-6 leading-relaxed"></p>
    <div class="flex gap-3 justify-center">
      <button onclick="confirmNo()" class="btn btn-outline flex-1">취소</button>
      <button id="confirm-yes" class="btn btn-danger-fill flex-1">삭제</button>
    </div>
  </div>
</div>

<script>
const API=axios.create({baseURL:'/api'});
let curPage='',hospList=[],docList=[],confirmCb=null;

/* Toast */
function toast(msg,type='ok'){
  const el=document.createElement('div');el.className='toast toast-'+type;
  el.innerHTML='<i class="fas '+(type==='ok'?'fa-check-circle':type==='err'?'fa-exclamation-circle':'fa-exclamation-triangle')+'"></i><span>'+msg+'</span>';
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),300)},2800);
}

/* Confirm */
function showConfirm(title,msg,cb){
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').textContent=msg;
  confirmCb=cb;document.getElementById('confirm-dialog').classList.remove('hidden');
}
function confirmNo(){document.getElementById('confirm-dialog').classList.add('hidden');confirmCb=null}
function confirmYes(){document.getElementById('confirm-dialog').classList.add('hidden');if(confirmCb)confirmCb();confirmCb=null}
document.getElementById('confirm-yes').onclick=confirmYes;

/* Nav */
function nav(p){
  curPage=p;
  document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
  document.getElementById('n-'+p)?.classList.add('active');
  document.getElementById('page-subtitle').textContent='';
  document.getElementById('header-actions').innerHTML='';
  ({dashboard:loadDash,hospitals:loadHosp,doctors:loadDoc,meetings:loadMeet,cistats:loadCIStats})[p]?.();
}
function openModal(t,h){document.getElementById('modal-title').textContent=t;document.getElementById('modal-body').innerHTML=h;document.getElementById('modal').classList.remove('hidden')}
function closeModal(){document.getElementById('modal').classList.add('hidden')}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();confirmNo()}});

/* Helpers */
function fmtDate(d){if(!d)return'-';return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'})}
function fmtShort(d){if(!d)return'-';return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{month:'short',day:'numeric'})}
function daysAgo(d){if(!d)return'';const diff=Math.floor((Date.now()-new Date(d+'T00:00:00').getTime())/86400000);if(diff===0)return'오늘';if(diff<0)return Math.abs(diff)+'일 후';return diff+'일 전'}
function daysClass(d){if(!d)return'';const diff=Math.floor((Date.now()-new Date(d+'T00:00:00').getTime())/86400000);if(diff>30)return'text-red-500';if(diff>14)return'text-amber-500';return'text-slate-400'}
function gradeBadge(g){return'<span class="badge grade-'+g+'">'+g+'급</span>'}
function statusDot(s){return s==='active'?'<span class="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>활성</span>':'<span class="inline-flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold"><span class="w-2 h-2 rounded-full bg-slate-300"></span>비활성</span>'}
function infBadge(l){return{high:'<span class="inf-high"><i class="fas fa-fire text-[9px]"></i> 핵심</span>',medium:'<span class="inf-medium"><i class="fas fa-star text-[9px]"></i> 주요</span>',low:'<span class="inf-low">일반</span>'}[l]||l}
function mtBadge(t){const m={visit:['방문','mt-visit','fa-building'],phone:['전화','mt-phone','fa-phone'],conference:['학회','mt-conference','fa-users'],email:['이메일','mt-email','fa-envelope'],online:['온라인','mt-online','fa-video']};const v=m[t]||['기타','mt-visit','fa-circle'];return'<span class="mt '+v[1]+'"><i class="fas '+v[2]+' text-[9px]"></i>'+v[0]+'</span>'}
function avatar(ph,nm,extra=''){const st=extra?'style="'+extra+'"':'';if(ph)return'<div class="avatar" '+st+'><img src="'+ph+'" alt=""></div>';const c=['#818cf8','#f472b6','#34d399','#fbbf24','#60a5fa','#a78bfa'];const i=(nm||'?').charCodeAt(0)%c.length;return'<div class="avatar" '+st+' style="background:'+c[i]+';color:#fff;'+(extra||'')+'">'+(nm||'?').charAt(0)+'</div>'}
function field(l,n,tp,v,opts){
  if(tp==='select')return'<div><label class="input-label">'+l+'</label><select name="'+n+'" class="input">'+opts.map(o=>'<option value="'+o.v+'"'+(o.v==v?' selected':'')+'>'+o.l+'</option>').join('')+'</select></div>';
  if(tp==='textarea')return'<div class="col-span-2"><label class="input-label">'+l+'</label><textarea name="'+n+'" class="input">'+(v||'')+'</textarea></div>';
  return'<div><label class="input-label">'+l+'</label><input type="'+tp+'" name="'+n+'" value="'+(v||'')+'" class="input" placeholder="'+l.replace(' *','')+'"></div>';
}
function skeleton(rows){let h='';for(let i=0;i<rows;i++)h+='<div class="flex items-center gap-4 p-5"><div class="skeleton rounded-xl" style="width:40px;height:40px"></div><div class="flex-1 space-y-2"><div class="skeleton rounded h-4" style="width:'+(60+Math.random()*30)+'%"></div><div class="skeleton rounded h-3" style="width:'+(30+Math.random()*20)+'%"></div></div></div>';return h}

/* ===== DASHBOARD ===== */
async function loadDash(){
  document.getElementById('page-title').textContent='대시보드';
  document.getElementById('page-subtitle').textContent='';
  document.getElementById('content').innerHTML='<div class="p-7 space-y-6"><div class="grid grid-cols-4 gap-5">'+Array(4).fill('<div class="sc"><div class="flex gap-4"><div class="skeleton rounded-xl" style="width:44px;height:44px"></div><div class="flex-1 space-y-2"><div class="skeleton rounded h-3 w-16"></div><div class="skeleton rounded h-6 w-20"></div></div></div></div>').join('')+'</div><div class="grid grid-cols-5 gap-6"><div class="col-span-3 card-flat p-0">'+skeleton(5)+'</div><div class="col-span-2 card-flat p-0">'+skeleton(4)+'</div></div></div>';
  try{
    const{data:d}=await API.get('/dashboard');const s=d.data;
    const C=document.getElementById('content');
    C.innerHTML='<div class="p-7 fade-in space-y-6">'+
    '<div class="grid grid-cols-4 gap-5">'+
      sc('관리 병원',s.stats.hospitals,'개','fa-hospital','#3366ff','#eef4ff','hospitals')+
      sc('등록 교수',s.stats.doctors,'명','fa-user-doctor','#7c3aed','#f5f3ff','doctors')+
      sc('총 미팅',s.stats.meetings,'건','fa-handshake','#059669','#ecfdf5','meetings')+
      sc('이번 달',s.stats.monthMeetings,'건','fa-calendar-day','#d97706','#fffbeb','')+
    '</div>'+
    '<div class="grid grid-cols-5 gap-6">'+
      '<div class="col-span-3 card-flat p-0 overflow-hidden">'+
        '<div class="px-6 py-4 flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-clock text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">최근 미팅</span></div><span class="text-[11px] text-slate-300 font-medium">최근 8건</span></div>'+
        '<div class="border-t border-gray-50">'+(s.recentMeetings.length?s.recentMeetings.map(m=>
          '<div class="px-6 py-3.5 tr flex items-center gap-4 cursor-pointer border-b border-gray-50 last:border-0" onclick="viewHosp('+m.hospital_id+')">'+
            avatar(m.doctor_photo,m.doctor_name)+
            '<div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-0.5"><span class="font-semibold text-[13px] text-slate-800">'+m.doctor_name+'</span>'+mtBadge(m.meeting_type)+'</div><div class="text-xs text-slate-400 truncate">'+m.hospital_name+(m.purpose?' &middot; '+m.purpose:'')+'</div></div>'+
            '<div class="text-right flex-shrink-0"><div class="text-xs font-medium text-slate-500">'+fmtShort(m.meeting_date)+'</div><div class="text-[10px] '+daysClass(m.meeting_date)+'">'+daysAgo(m.meeting_date)+'</div></div>'+
          '</div>'
        ).join(''):'<div class="empty"><div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div><p class="text-sm">아직 미팅 기록이 없습니다</p></div>')+'</div>'+
      '</div>'+
      '<div class="col-span-2 space-y-6">'+
        '<div class="card-flat p-0 overflow-hidden">'+
          '<div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><i class="fas fa-list-check text-amber-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">후속 액션</span></div>'+
          '<div class="border-t border-gray-50">'+(s.upcomingActions.length?s.upcomingActions.map(m=>
            '<div class="px-6 py-3 tr border-b border-gray-50 last:border-0"><div class="flex items-center justify-between mb-1"><span class="text-[13px] font-semibold text-slate-700">'+m.doctor_name+'</span>'+(m.next_meeting_date?'<span class="text-[10px] font-bold '+daysClass(m.next_meeting_date)+' bg-gray-50 px-2.5 py-1 rounded-full">'+fmtShort(m.next_meeting_date)+'</span>':'')+'</div><p class="text-xs text-slate-400 leading-relaxed"><i class="fas fa-arrow-right text-amber-300 mr-1.5"></i>'+m.next_action+'</p></div>'
          ).join(''):'<div class="empty py-10"><div class="empty-icon"><i class="fas fa-check-circle"></i></div><p class="text-sm">완료할 액션이 없습니다</p></div>')+'</div>'+
        '</div>'+
        '<div class="card-flat p-0 overflow-hidden">'+
          '<div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-map-location-dot text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">지역별 현황</span></div>'+
          '<div class="border-t border-gray-50 p-5 space-y-3">'+(s.regionStats.length?s.regionStats.map(r=>{const mx=Math.max(...s.regionStats.map(x=>x.count));return'<div class="flex items-center gap-3"><span class="text-xs font-semibold text-slate-500 w-10 text-right">'+r.region+'</span><div class="flex-1 bg-gray-100 rounded-full h-[22px] overflow-hidden"><div class="bg-gradient-to-r from-brand-400 to-brand-500 h-full rounded-full flex items-center px-3 transition-all duration-500" style="width:'+Math.max(r.count/mx*100,20)+'%"><span class="text-[10px] font-bold text-white">'+r.count+'개</span></div></div></div>'}).join(''):'<div class="text-center text-sm text-slate-300 py-4">데이터 없음</div>')+'</div>'+
        '</div>'+
      '</div>'+
    '</div></div>';
  }catch(e){document.getElementById('content').innerHTML='<div class="p-7"><div class="card-flat p-8 text-center text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>데이터를 불러올 수 없습니다</div></div>'}
}
function sc(label,val,unit,icon,color,bg,link){
  return'<div class="sc cursor-pointer" onclick="'+(link?'nav(\\''+link+'\\')':'')+'"><div class="flex items-center gap-4"><div class="sc-icon" style="background:'+bg+'"><i class="fas '+icon+'" style="color:'+color+'"></i></div><div><p class="text-[11px] text-slate-400 font-medium mb-0.5">'+label+'</p><div class="flex items-baseline gap-1"><span class="text-[22px] font-extrabold text-slate-800 tracking-tight">'+val+'</span><span class="text-xs text-slate-300 font-medium">'+unit+'</span></div></div></div></div>';
}

/* ===== HOSPITALS ===== */
async function loadHosp(){
  document.getElementById('page-title').textContent='병원 관리';
  document.getElementById('page-subtitle').textContent='';
  document.getElementById('header-actions').innerHTML='<button class="btn btn-primary" onclick="showHospForm()"><i class="fas fa-plus text-xs"></i>병원 추가</button>';
  document.getElementById('content').innerHTML='<div class="p-7"><div class="grid grid-cols-3 gap-5">'+Array(6).fill('<div class="card p-5"><div class="space-y-3"><div class="skeleton rounded h-5 w-32"></div><div class="skeleton rounded h-3 w-48"></div><div class="flex gap-2 mt-4">'+Array(3).fill('<div class="skeleton rounded-lg flex-1 h-14"></div>').join('')+'</div></div></div>').join('')+'</div></div>';
  try{
    const[hR,rR]=await Promise.all([API.get('/hospitals'),API.get('/regions')]);
    hospList=hR.data.data;const regions=rR.data.data;
    document.getElementById('content').innerHTML='<div class="p-7 fade-in">'+
      '<div class="flex items-center gap-3 mb-6">'+
        '<div class="relative"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="h-search" oninput="filterH()" placeholder="병원명으로 검색" class="input pl-10" style="width:260px"></div>'+
        '<select id="h-region" onchange="filterH()" class="input" style="width:120px"><option value="">전체 지역</option>'+regions.map(r=>'<option>'+r+'</option>').join('')+'</select>'+
        '<select id="h-grade" onchange="filterH()" class="input" style="width:120px"><option value="">전체 등급</option><option value="S">S급</option><option value="A">A급</option><option value="B">B급</option><option value="C">C급</option></select>'+
        '<span id="h-count" class="text-xs text-slate-300 font-medium ml-auto"></span>'+
      '</div>'+
      '<div id="h-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"></div></div>';
    renderH(hospList);
  }catch(e){toast('병원 목록을 불러올 수 없습니다','err')}
}
function renderH(list){
  document.getElementById('h-count').textContent=list.length+'개 병원';
  document.getElementById('h-grid').innerHTML=list.length?list.map(h=>{
    const warn=h.last_meeting?Math.floor((Date.now()-new Date(h.last_meeting+'T00:00:00').getTime())/86400000)>30:'';
    return'<div class="card accent-'+h.grade+' p-5 cursor-pointer" onclick="viewHosp('+h.id+')">'+
      '<div class="flex items-center gap-2 mb-3">'+gradeBadge(h.grade)+statusDot(h.status)+(warn?'<span class="ml-auto text-[10px] text-red-400 bg-red-50 px-2 py-0.5 rounded-full font-semibold"><i class="fas fa-exclamation-triangle mr-0.5"></i>30일+ 미방문</span>':'')+'</div>'+
      '<h3 class="font-bold text-slate-800 text-[15px] mb-1 truncate">'+h.name+'</h3>'+
      '<p class="text-xs text-slate-400"><i class="fas fa-location-dot mr-1"></i>'+(h.region||'미지정')+'</p>'+
      '<div class="flex gap-2 mt-4">'+
        '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5">교수</p><p class="text-sm font-bold text-brand-600">'+(h.doctor_count||0)+'</p></div>'+
        '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5">미팅</p><p class="text-sm font-bold text-slate-600">'+(h.meeting_count||0)+'</p></div>'+
        '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5">최근 미팅</p><p class="text-[11px] font-semibold '+(h.last_meeting?daysClass(h.last_meeting):'text-slate-300')+'">'+(h.last_meeting?daysAgo(h.last_meeting):'없음')+'</p></div>'+
      '</div>'+
      (h.notes?'<p class="text-[11px] text-slate-400 mt-3 line-clamp-1 leading-relaxed border-t border-gray-50 pt-3"><i class="fas fa-quote-left text-slate-200 mr-1"></i>'+h.notes+'</p>':'')+
    '</div>'}).join(''):'<div class="col-span-full empty"><div class="empty-icon"><i class="fas fa-hospital"></i></div><p class="font-medium text-slate-500 mb-1">등록된 병원이 없습니다</p><p class="text-sm text-slate-300">상단의 "병원 추가" 버튼으로 시작하세요</p></div>';
}
function filterH(){
  const s=(document.getElementById('h-search')?.value||'').toLowerCase(),r=document.getElementById('h-region')?.value||'',g=document.getElementById('h-grade')?.value||'';
  renderH(hospList.filter(h=>(!s||h.name.toLowerCase().includes(s))&&(!r||h.region===r)&&(!g||h.grade===g)));
}

/* ===== HOSPITAL DETAIL ===== */
let detailTab='doctors';
async function viewHosp(id){
  document.getElementById('content').innerHTML='<div class="p-7 space-y-5"><div class="card-flat p-5"><div class="skeleton rounded h-6 w-48 mb-3"></div><div class="skeleton rounded h-4 w-72"></div></div><div class="card-flat p-0">'+skeleton(4)+'</div></div>';
  try{
    const[hR,dR,mR]=await Promise.all([API.get('/hospitals/'+id),API.get('/hospitals/'+id+'/doctors'),API.get('/meetings?hospital_id='+id)]);
    const h=hR.data.data,docs=dR.data.data,meets=mR.data.data;
    document.getElementById('page-title').textContent=h.name;
    document.getElementById('page-subtitle').innerHTML='<span class="cursor-pointer hover:text-brand-500 transition" onclick="nav(\\'hospitals\\')"><i class="fas fa-chevron-left mr-1 text-[10px]"></i>병원 목록</span>';
    document.getElementById('header-actions').innerHTML=
      '<button class="btn btn-primary" onclick="showDocForm('+h.id+')"><i class="fas fa-user-plus text-xs"></i>교수 추가</button>'+
      '<button class="btn btn-success" onclick="showMeetForm('+h.id+')"><i class="fas fa-calendar-plus text-xs"></i>미팅 추가</button>'+
      '<button class="btn btn-outline" onclick="showHospForm('+h.id+')"><i class="fas fa-pen text-xs"></i></button>'+
      '<button class="btn btn-ghost text-red-400 hover:text-red-600 hover:bg-red-50" onclick="delHosp('+h.id+')"><i class="fas fa-trash text-xs"></i></button>';

    window._hospDetail={h,docs,meets};detailTab='doctors';
    renderDetail();
  }catch(e){toast('병원 정보를 불러올 수 없습니다','err')}
}

function renderDetail(){
  const{h,docs,meets}=window._hospDetail;
  document.getElementById('content').innerHTML='<div class="p-7 fade-in space-y-5">'+
    // Info card
    '<div class="card-flat p-6">'+
      '<div class="flex items-center gap-3 mb-5">'+gradeBadge(h.grade)+statusDot(h.status)+'<div class="ml-auto flex items-center gap-4 text-xs text-slate-400">'+(h.phone?'<span><i class="fas fa-phone mr-1"></i>'+h.phone+'</span>':'')+'<span><i class="fas fa-calendar-plus mr-1"></i>등록 '+fmtDate(h.created_at?.split(' ')[0])+'</span></div></div>'+
      '<div class="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">'+
        '<div><span class="text-slate-400 text-xs font-medium">지역</span><p class="font-semibold text-slate-700 mt-0.5">'+(h.region||'-')+'</p></div>'+
        '<div><span class="text-slate-400 text-xs font-medium">주소</span><p class="font-semibold text-slate-700 mt-0.5">'+(h.address||'-')+'</p></div>'+
      '</div>'+
      (h.notes?'<div class="mt-5 bg-amber-50/70 rounded-xl p-4 text-[13px] text-amber-800 leading-relaxed"><i class="fas fa-lightbulb text-amber-400 mr-1.5"></i>'+h.notes+'</div>':'')+
    '</div>'+

    // Tabs
    '<div class="flex border-b border-gray-100 px-1">'+
      '<div class="tab '+(detailTab==='doctors'?'active':'')+'" onclick="detailTab=\\'doctors\\';renderDetail()"><i class="fas fa-user-doctor text-xs"></i>교수 <span class="text-slate-300 font-normal ml-0.5">('+docs.length+')</span></div>'+
      '<div class="tab '+(detailTab==='meetings'?'active':'')+'" onclick="detailTab=\\'meetings\\';renderDetail()"><i class="fas fa-calendar-check text-xs"></i>미팅 기록 <span class="text-slate-300 font-normal ml-0.5">('+meets.length+')</span></div>'+
    '</div>'+

    (detailTab==='doctors'?renderDoctorsTab(h,docs):renderMeetingsTab(h,meets))+
  '</div>';
}

function renderDoctorsTab(h,docs){
  if(!docs.length)return'<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-user-plus"></i></div><p class="font-medium text-slate-500 mb-1">소속 교수가 없습니다</p><p class="text-sm text-slate-300">교수를 추가하여 영업 관리를 시작하세요</p></div></div>';
  return'<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">'+docs.map(d=>
    '<div class="card-flat p-5 flex gap-4">'+
      '<div class="photo-up" onclick="triggerPhoto('+d.id+','+h.id+')">'+
        avatar(d.photo,d.name,'width:52px;height:52px;border-radius:14px;font-size:18px')+
        '<div class="photo-ov" style="border-radius:14px"><i class="fas fa-camera"></i></div>'+
      '</div>'+
      '<input type="file" id="pi-'+d.id+'" accept="image/*" style="display:none" onchange="uploadPhoto('+d.id+','+h.id+',this)">'+
      '<div class="flex-1 min-w-0">'+
        '<div class="flex items-center gap-2 mb-1"><span class="font-bold text-[14px] text-slate-800">'+d.name+'</span><span class="text-xs text-slate-400">'+(d.position||'')+'</span>'+infBadge(d.influence_level)+'</div>'+
        '<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mb-2">'+(d.department?'<span><i class="fas fa-stethoscope mr-1 text-slate-300"></i>'+d.department+'</span>':'')+(d.specialty?'<span><i class="fas fa-microscope mr-1 text-slate-300"></i>'+d.specialty+'</span>':'')+'</div>'+
        '<div class="flex items-center gap-3 text-[11px]">'+
          '<span class="text-slate-400"><i class="fas fa-handshake mr-1"></i>미팅 '+(d.meeting_count||0)+'회</span>'+
          (d.last_meeting?'<span class="'+daysClass(d.last_meeting)+'"><i class="fas fa-clock mr-1"></i>'+daysAgo(d.last_meeting)+'</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="flex flex-col gap-1 flex-shrink-0">'+
        '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();showMeetForm('+h.id+','+d.id+')" title="미팅 추가"><i class="fas fa-calendar-plus text-emerald-500"></i></button>'+
        '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();showDocForm('+h.id+','+d.id+')" title="수정"><i class="fas fa-pen text-slate-400"></i></button>'+
        '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();delDoc('+d.id+','+h.id+')" title="삭제"><i class="fas fa-trash text-red-300 hover:text-red-500"></i></button>'+
      '</div>'+
    '</div>'
  ).join('')+'</div>';
}

function renderMeetingsTab(h,meets){
  if(!meets.length)return'<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-calendar-plus"></i></div><p class="font-medium text-slate-500 mb-1">미팅 기록이 없습니다</p><p class="text-sm text-slate-300">첫 번째 미팅을 기록해보세요</p></div></div>';
  return'<div class="card-flat p-6">'+meets.map((m,i)=>
    '<div class="flex gap-4 '+(i<meets.length-1?'mb-6':'')+'">'+
      '<div class="flex flex-col items-center pt-1"><div class="tl-dot"></div>'+(i<meets.length-1?'<div class="tl-line flex-1 mt-1"></div>':'')+'</div>'+
      '<div class="flex-1 pb-'+(i<meets.length-1?'0':'0')+'">'+
        '<div class="flex items-center justify-between mb-2">'+
          '<div class="flex items-center gap-2">'+mtBadge(m.meeting_type)+'<span class="font-semibold text-[13px] text-slate-800">'+(m.doctor_name||'-')+'</span></div>'+
          '<div class="flex items-center gap-2"><span class="text-xs text-slate-400">'+fmtDate(m.meeting_date)+'</span><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="showMeetForm('+h.id+','+m.doctor_id+','+m.id+')"><i class="fas fa-pen text-[10px]"></i></button><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="delMeet('+m.id+','+h.id+')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div>'+
        '</div>'+
        (m.purpose?'<div class="text-[13px] font-medium text-slate-700 mb-1.5">'+m.purpose+'</div>':'')+
        (m.content?'<div class="text-xs text-slate-500 leading-relaxed mb-2 bg-slate-50 rounded-lg p-3">'+m.content+'</div>':'')+
        '<div class="flex flex-wrap gap-2">'+
          (m.result?'<div class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex-1 min-w-[200px]"><i class="fas fa-check-circle mr-1.5"></i><strong>결과:</strong> '+m.result+'</div>':'')+
          (m.next_action?'<div class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex-1 min-w-[200px]"><i class="fas fa-arrow-right mr-1.5"></i><strong>후속:</strong> '+m.next_action+(m.next_meeting_date?' <span class="font-bold">('+fmtShort(m.next_meeting_date)+')</span>':'')+'</div>':'')+
        '</div>'+
      '</div>'+
    '</div>'
  ).join('')+'</div>';
}

/* ===== DOCTORS PAGE ===== */
async function loadDoc(){
  document.getElementById('page-title').textContent='교수 관리';
  document.getElementById('page-subtitle').textContent='';
  document.getElementById('content').innerHTML='<div class="p-7"><div class="card-flat overflow-hidden">'+skeleton(6)+'</div></div>';
  try{
    const{data}=await API.get('/doctors');docList=data.data;
    document.getElementById('content').innerHTML='<div class="p-7 fade-in">'+
      '<div class="flex items-center gap-3 mb-6"><div class="relative"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="d-search" oninput="filterD()" placeholder="교수명 또는 병원명 검색" class="input pl-10" style="width:300px"></div><span id="d-count" class="text-xs text-slate-300 font-medium ml-auto"></span></div>'+
      '<div class="card-flat overflow-hidden"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold uppercase tracking-wider border-b border-gray-100">'+
        '<th class="px-6 py-3.5 text-left">교수</th><th class="px-4 py-3.5 text-left">소속 병원</th><th class="px-4 py-3.5 text-left">진료과</th><th class="px-4 py-3.5 text-left">전문분야</th><th class="px-4 py-3.5 text-center">영향력</th><th class="px-4 py-3.5 text-center">미팅</th><th class="px-5 py-3.5 text-left">최근 미팅</th></tr></thead>'+
        '<tbody id="d-tbody" class="divide-y divide-gray-50"></tbody></table></div></div>';
    renderDR(docList);
  }catch(e){toast('교수 목록을 불러올 수 없습니다','err')}
}
function renderDR(list){
  document.getElementById('d-count').textContent=list.length+'명';
  document.getElementById('d-tbody').innerHTML=list.map(d=>
    '<tr class="tr cursor-pointer" onclick="viewHosp('+d.hospital_id+')">'+
      '<td class="px-6 py-3.5"><div class="flex items-center gap-3">'+avatar(d.photo,d.name)+'<div><div class="font-semibold text-[13px] text-slate-800">'+d.name+'</div><div class="text-[11px] text-slate-400">'+(d.position||'')+'</div></div></div></td>'+
      '<td class="px-4 py-3.5 text-[13px] text-slate-600">'+(d.hospital_name||'-')+'</td>'+
      '<td class="px-4 py-3.5 text-[13px] text-slate-500">'+(d.department||'-')+'</td>'+
      '<td class="px-4 py-3.5 text-[13px] text-slate-500">'+(d.specialty||'-')+'</td>'+
      '<td class="px-4 py-3.5 text-center">'+infBadge(d.influence_level)+'</td>'+
      '<td class="px-4 py-3.5 text-center text-[13px] font-bold text-slate-700">'+(d.meeting_count||0)+'</td>'+
      '<td class="px-5 py-3.5"><div class="text-[13px] text-slate-600">'+(d.last_meeting?fmtShort(d.last_meeting):'<span class="text-slate-200">-</span>')+'</div>'+(d.last_meeting?'<div class="text-[10px] '+daysClass(d.last_meeting)+'">'+daysAgo(d.last_meeting)+'</div>':'')+'</td></tr>'
  ).join('');
}
function filterD(){const q=(document.getElementById('d-search')?.value||'').toLowerCase();renderDR(docList.filter(d=>d.name.toLowerCase().includes(q)||(d.hospital_name||'').toLowerCase().includes(q)))}

/* ===== MEETINGS PAGE ===== */
async function loadMeet(){
  document.getElementById('page-title').textContent='미팅 기록';
  document.getElementById('page-subtitle').textContent='';
  document.getElementById('content').innerHTML='<div class="p-7"><div class="card-flat p-0">'+skeleton(6)+'</div></div>';
  try{
    const{data}=await API.get('/meetings');
    document.getElementById('content').innerHTML='<div class="p-7 fade-in"><div class="card-flat p-0 overflow-hidden">'+
      (data.data.length?data.data.map((m,i)=>
        '<div class="px-6 py-4 tr flex gap-4 border-b border-gray-50 last:border-0 cursor-pointer" onclick="viewHosp('+m.hospital_id+')">'+
          avatar(m.doctor_photo,m.doctor_name,'width:36px;height:36px;border-radius:10px;font-size:13px')+
          '<div class="flex-1 min-w-0">'+
            '<div class="flex items-center gap-2 mb-0.5"><span class="font-semibold text-[13px] text-slate-800">'+(m.doctor_name||'-')+'</span><span class="text-xs text-slate-300">'+(m.hospital_name||'')+'</span>'+mtBadge(m.meeting_type)+'</div>'+
            (m.purpose?'<div class="text-[13px] text-slate-600 mb-1">'+m.purpose+'</div>':'')+
            '<div class="flex flex-wrap gap-2 mt-1">'+(m.result?'<span class="text-[11px] text-emerald-600 bg-emerald-50 rounded-md px-2 py-0.5"><i class="fas fa-check mr-0.5"></i>'+m.result+'</span>':'')+(m.next_action?'<span class="text-[11px] text-amber-600 bg-amber-50 rounded-md px-2 py-0.5"><i class="fas fa-arrow-right mr-0.5"></i>'+m.next_action+'</span>':'')+'</div>'+
          '</div>'+
          '<div class="text-right flex-shrink-0"><div class="text-xs font-medium text-slate-500">'+fmtShort(m.meeting_date)+'</div><div class="text-[10px] '+daysClass(m.meeting_date)+'">'+daysAgo(m.meeting_date)+'</div></div>'+
        '</div>'
      ).join(''):'<div class="empty"><div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div><p class="font-medium text-slate-500 mb-1">미팅 기록이 없습니다</p><p class="text-sm text-slate-300">병원 상세에서 미팅을 기록해보세요</p></div>')+
    '</div></div>';
  }catch(e){toast('미팅 기록을 불러올 수 없습니다','err')}
}

/* ===== PHOTO ===== */
function triggerPhoto(did,hid){document.getElementById('pi-'+did)?.click()}
async function uploadPhoto(did,hid,inp){
  const f=inp.files?.[0];if(!f)return;
  if(f.size>2*1024*1024){toast('2MB 이하 이미지만 업로드 가능합니다','warn');return}
  const r=new FileReader();r.onload=async function(e){
    const img=new Image();img.onload=async function(){
      const c=document.createElement('canvas');c.width=c.height=200;
      const ctx=c.getContext('2d'),mn=Math.min(img.width,img.height);
      ctx.drawImage(img,(img.width-mn)/2,(img.height-mn)/2,mn,mn,0,0,200,200);
      try{await API.post('/doctors/'+did+'/photo',{photo:c.toDataURL('image/jpeg',.8)});toast('사진이 업로드되었습니다');viewHosp(hid)}catch(e){toast('업로드에 실패했습니다','err')}
    };img.src=e.target.result;
  };r.readAsDataURL(f);
}

/* ===== FORMS ===== */
async function showHospForm(id){
  let h={name:'',region:'',address:'',phone:'',grade:'A',notes:'',status:'active'};
  if(id){try{h=(await API.get('/hospitals/'+id)).data.data}catch(e){}}
  openModal(id?'병원 수정':'새 병원 추가',
    '<form id="fm" class="grid grid-cols-2 gap-4">'+
    field('병원명 *','name','text',h.name)+field('지역','region','text',h.region)+
    field('주소','address','text',h.address)+field('전화번호','phone','tel',h.phone)+
    field('등급','grade','select',h.grade,[{v:'S',l:'S급 (최상위)'},{v:'A',l:'A급 (주요)'},{v:'B',l:'B급 (일반)'},{v:'C',l:'C급 (기타)'}])+
    field('상태','status','select',h.status,[{v:'active',l:'활성'},{v:'inactive',l:'비활성'}])+
    field('메모','notes','textarea',h.notes)+
    '<div class="col-span-2 flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">'+(id?'저장':'추가')+'</button></div></form>');
  document.getElementById('fm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.name){toast('병원명을 입력하세요','warn');return}try{if(id){await API.put('/hospitals/'+id,f);toast('병원 정보가 수정되었습니다')}else{await API.post('/hospitals',f);toast('새 병원이 추가되었습니다')}closeModal();if(id)viewHosp(id);else loadHosp()}catch(e){toast('저장에 실패했습니다','err')}};
  setTimeout(()=>document.querySelector('#fm input[name="name"]')?.focus(),100);
}
async function showDocForm(hid,did){
  let d={name:'',department:'이비인후과',position:'교수',phone:'',email:'',specialty:'',influence_level:'medium',notes:'',hospital_id:hid};
  if(did){try{const ds=(await API.get('/hospitals/'+hid+'/doctors')).data.data;d=ds.find(x=>x.id===did)||d}catch(e){}}
  openModal(did?'교수 수정':'새 교수 추가',
    '<form id="fm" class="grid grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="'+hid+'">'+
    field('이름 *','name','text',d.name)+field('진료과','department','text',d.department)+
    field('직위','position','text',d.position)+field('전화번호','phone','tel',d.phone)+
    field('이메일','email','email',d.email)+field('전문분야','specialty','text',d.specialty)+
    field('영향력','influence_level','select',d.influence_level,[{v:'high',l:'핵심 (High)'},{v:'medium',l:'주요 (Medium)'},{v:'low',l:'일반 (Low)'}])+
    '<div></div>'+field('메모','notes','textarea',d.notes)+
    '<div class="col-span-2 flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">'+(did?'저장':'추가')+'</button></div></form>');
  document.getElementById('fm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.name){toast('이름을 입력하세요','warn');return}try{if(did){await API.put('/doctors/'+did,f);toast('교수 정보가 수정되었습니다')}else{await API.post('/doctors',f);toast('새 교수가 추가되었습니다')}closeModal();viewHosp(hid)}catch(e){toast('저장에 실패했습니다','err')}};
  setTimeout(()=>document.querySelector('#fm input[name="name"]')?.focus(),100);
}
async function showMeetForm(hid,did,mid){
  let m={meeting_date:new Date().toISOString().split('T')[0],meeting_type:'visit',purpose:'',content:'',result:'',next_action:'',next_meeting_date:'',doctor_id:did||'',hospital_id:hid};
  if(mid){try{const ms=(await API.get('/meetings?hospital_id='+hid)).data.data;m=ms.find(x=>x.id===mid)||m}catch(e){}}
  let docs=[];try{docs=(await API.get('/hospitals/'+hid+'/doctors')).data.data}catch(e){}
  const dO=[{v:'',l:'-- 교수 선택 --'}].concat(docs.map(d=>({v:d.id,l:d.name+' ('+(d.position||'')+')'})));
  openModal(mid?'미팅 수정':'새 미팅 기록',
    '<form id="fm" class="grid grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="'+hid+'">'+
    field('교수 *','doctor_id','select',m.doctor_id||did||'',dO)+field('미팅일자 *','meeting_date','date',m.meeting_date)+
    field('유형','meeting_type','select',m.meeting_type,[{v:'visit',l:'방문'},{v:'phone',l:'전화'},{v:'conference',l:'학회'},{v:'email',l:'이메일'},{v:'online',l:'온라인'}])+
    field('목적','purpose','text',m.purpose)+
    field('미팅 내용','content','textarea',m.content)+field('결과','result','textarea',m.result)+field('후속 액션','next_action','textarea',m.next_action)+
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="'+(m.next_meeting_date||'')+'" class="input"></div>'+
    '<div class="col-span-2 flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">'+(mid?'저장':'추가')+'</button></div></form>');
  document.getElementById('fm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.doctor_id){toast('교수를 선택하세요','warn');return}if(!f.meeting_date){toast('미팅일자를 입력하세요','warn');return}try{if(mid){await API.put('/meetings/'+mid,f);toast('미팅 기록이 수정되었습니다')}else{await API.post('/meetings',f);toast('새 미팅이 기록되었습니다')}closeModal();viewHosp(hid)}catch(e){toast('저장에 실패했습니다','err')}};
}

/* ===== DELETE ===== */
async function delHosp(id){showConfirm('병원 삭제','이 병원과 소속 교수, 미팅 기록이 모두 삭제됩니다. 되돌릴 수 없습니다.',async()=>{try{await API.delete('/hospitals/'+id);toast('병원이 삭제되었습니다');nav('hospitals')}catch(e){toast('삭제에 실패했습니다','err')}})}
async function delDoc(id,hid){showConfirm('교수 삭제','이 교수와 관련된 미팅 기록이 모두 삭제됩니다.',async()=>{try{await API.delete('/doctors/'+id);toast('교수가 삭제되었습니다');viewHosp(hid)}catch(e){toast('삭제에 실패했습니다','err')}})}
async function delMeet(id,hid){showConfirm('미팅 삭제','이 미팅 기록을 삭제하시겠습니까?',async()=>{try{await API.delete('/meetings/'+id);toast('미팅 기록이 삭제되었습니다');viewHosp(hid)}catch(e){toast('삭제에 실패했습니다','err')}})}

async function delMeet(id,hid){showConfirm('미팅 삭제','이 미팅 기록을 삭제하시겠습니까?',async()=>{try{await API.delete('/meetings/'+id);toast('미팅 기록이 삭제되었습니다');viewHosp(hid)}catch(e){toast('삭제에 실패했습니다','err')}})}

/* ===== CI STATS PAGE - 실제 HIRA 데이터 기반 ===== */
let ciCharts=[];
function destroyCICharts(){ciCharts.forEach(c=>{try{c.destroy()}catch(e){}});ciCharts=[]}

function fmtAmount(v){
  if(v>=1000000) return (v/1000000).toFixed(1)+'조원';
  if(v>=1000) return (v/1000).toFixed(0)+'억원';
  return v+'천원';
}
function fmtNum(n){return n.toLocaleString('ko-KR')}

async function loadCIStats(){
  destroyCICharts();
  document.getElementById('page-title').textContent='인공와우 이식술 통계';
  document.getElementById('page-subtitle').innerHTML='<span class="text-[11px] text-slate-400">S5800 | 건강보험심사평가원 실제 데이터</span>';
  document.getElementById('header-actions').innerHTML='';
  document.getElementById('content').innerHTML='<div class="p-7 space-y-6"><div class="grid grid-cols-3 gap-5">'+Array(6).fill('<div class="sc"><div class="space-y-2"><div class="skeleton rounded h-4 w-24"></div><div class="skeleton rounded h-7 w-16"></div></div></div>').join('')+'</div></div>';
  try{
    const{data:d}=await API.get('/ci-stats');const s=d.data;
    const y=s.yearly;
    // Tab state
    let ciTab='overview';
    window._ciData=s;
    renderCITab(ciTab);
  }catch(e){document.getElementById('content').innerHTML='<div class="p-7"><div class="card-flat p-8 text-center text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>통계 데이터를 불러올 수 없습니다<br><span class="text-xs text-slate-400 mt-2 block">'+e.message+'</span></div></div>'}
}

function renderCITab(tab){
  destroyCICharts();
  const s=window._ciData;
  const y=s.yearly;
  const tabs=['overview','age','region','institution','amount'];
  const tabLabels={'overview':'종합 현황','age':'연령별 분석','region':'지역별 분석','institution':'기관 종별','amount':'진료금액'};
  const tabIcons={'overview':'fa-chart-pie','age':'fa-cake-candles','region':'fa-map-location-dot','institution':'fa-hospital','amount':'fa-won-sign'};

  document.getElementById('content').innerHTML='<div class="p-7 fade-in space-y-6">'+
    // Source banner
    '<div class="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-5 flex items-center gap-4 border border-indigo-100">'+
      '<div class="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0"><i class="fas fa-database text-indigo-500 text-lg"></i></div>'+
      '<div class="flex-1 min-w-0"><div class="font-bold text-indigo-900 text-sm mb-0.5">건강보험심사평가원 보건의료빅데이터개방시스템</div><div class="text-xs text-indigo-400">'+s.code+' | 기간: '+s.period+' | 공공누리 제1유형</div></div>'+
      '<div class="flex items-center gap-2"><span class="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold bg-emerald-50 px-3 py-1.5 rounded-full"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>100% 실제 데이터</span></div>'+
    '</div>'+

    // Tabs
    '<div class="flex border-b border-gray-100 px-1">'+
      tabs.map(t=>'<div class="tab '+(tab===t?'active':'')+'" onclick="renderCITab(\\''+t+'\\')"><i class="fas '+tabIcons[t]+' text-xs"></i>'+tabLabels[t]+'</div>').join('')+
    '</div>'+

    // Tab content
    renderCIContent(tab,s)+

    // Data source note
    '<div class="text-[10px] text-slate-300 text-center leading-relaxed pb-4">'+
      '본 통계는 건강보험심사평가원에서 공공누리 제1유형으로 개방한 보건의료빅데이터를 이용하였습니다. 모든 데이터는 HIRA 공식 데이터이며 추정치가 포함되어 있지 않습니다.<br>'+
      '단위: 환자수(명), 총사용량(회), 진료금액(천원)'+
    '</div>'+
  '</div>';
  setTimeout(()=>renderCIChartsForTab(tab,s),100);
}

function renderCIContent(tab,s){
  if(tab==='overview') return renderOverview(s);
  if(tab==='age') return renderAge(s);
  if(tab==='region') return renderRegion(s);
  if(tab==='institution') return renderInstitution(s);
  if(tab==='amount') return renderAmount(s);
  return '';
}

function renderOverview(s){
  const y=s.yearly;
  const last=y[y.length-1];const prev=y[y.length-2];
  const growP=((last.patients-prev.patients)/prev.patients*100).toFixed(1);
  const growU=((last.usage-prev.usage)/prev.usage*100).toFixed(1);
  return '<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">'+
    s.insights.map(i=>'<div class="sc !p-4"><div class="flex items-center gap-2 mb-2"><div class="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center"><i class="fas '+i.icon+' text-brand-500 text-xs"></i></div></div><div class="text-[20px] font-extrabold text-slate-800 tracking-tight mb-0.5">'+i.value+'</div><div class="text-[11px] font-semibold text-slate-500 mb-1">'+i.title+'</div><div class="text-[10px] text-slate-400 leading-relaxed">'+i.desc+'</div></div>').join('')+
  '</div>'+
  // Charts
  '<div class="grid grid-cols-5 gap-6">'+
    '<div class="col-span-3 card-flat p-6"><div class="flex items-center justify-between mb-5"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-chart-line text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 환자수 · 시술건수 추이</span></div></div><div style="height:300px"><canvas id="chart-yearly"></canvas></div></div>'+
    '<div class="col-span-2 card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center"><i class="fas fa-venus-mars text-purple-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">성별 환자수 추이</span></div><div style="height:300px"><canvas id="chart-gender"></canvas></div></div>'+
  '</div>'+
  // Data table
  '<div class="card-flat overflow-hidden"><div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><i class="fas fa-table text-slate-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 상세 데이터 (입원외래별)</span></div>'+
    '<table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold uppercase tracking-wider border-y border-gray-100">'+
      '<th class="px-4 py-3 text-left">연도</th><th class="px-4 py-3 text-right">환자수</th><th class="px-4 py-3 text-right">총사용량</th><th class="px-4 py-3 text-right">진료금액(천원)</th><th class="px-4 py-3 text-right">남성</th><th class="px-4 py-3 text-right">여성</th><th class="px-4 py-3 text-right">전년대비</th></tr></thead>'+
    '<tbody class="divide-y divide-gray-50">'+y.map((r,i)=>{
      const g=i>0?((r.patients-y[i-1].patients)/y[i-1].patients*100).toFixed(1):'—';
      const gc=i>0?(r.patients>y[i-1].patients?'text-emerald-600':'text-red-500'):'text-slate-400';
      return '<tr class="tr"><td class="px-4 py-3 font-bold text-slate-800 text-sm">'+r.year+'년</td><td class="px-4 py-3 text-right font-semibold text-sm text-brand-600">'+fmtNum(r.patients)+'명</td><td class="px-4 py-3 text-right text-sm text-slate-600">'+fmtNum(r.usage)+'회</td><td class="px-4 py-3 text-right text-sm text-slate-600">'+fmtNum(r.amount)+'</td><td class="px-4 py-3 text-right text-sm text-blue-600">'+fmtNum(r.male_patients)+'</td><td class="px-4 py-3 text-right text-sm text-pink-600">'+fmtNum(r.female_patients)+'</td><td class="px-4 py-3 text-right text-sm font-semibold '+gc+'">'+(i>0?(g>0?'+':'')+g+'%':'—')+'</td></tr>'
    }).join('')+'</tbody></table></div>'+
  // Policy timeline
  '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><i class="fas fa-landmark text-violet-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">건강보험 급여 정책 변천</span></div>'+
    '<div class="flex items-start gap-0 overflow-x-auto pb-2">'+s.policyChanges.map((p,i)=>
      '<div class="flex flex-col items-center min-w-[140px] flex-1 relative">'+
        '<div class="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-brand-500/20 z-10">'+p.year+'</div>'+
        (i<s.policyChanges.length-1?'<div class="absolute top-5 left-[calc(50%+20px)] right-0 h-0.5 bg-gradient-to-r from-brand-200 to-brand-100"></div>':'')+
        '<div class="text-[11px] text-slate-500 text-center leading-relaxed mt-3 px-2">'+p.event+'</div>'+
      '</div>'
    ).join('')+'</div>'+
  '</div>';
}

function renderAge(s){
  const years=s.years;
  const latestY=years[years.length-1];
  // 10세 구간 - 남녀 합계
  const ageGroups10=['0_9세','10_19세','20_29세','30_39세','40_49세','50_59세','60_69세','70_79세','80세이상'];
  const ageLabels10=['0-9세','10-19세','20-29세','30-39세','40-49세','50-59세','60-69세','70-79세','80세이상'];
  // 5세 구간 그룹
  const ageGroups5=['5세미만','5_9세','10_14세','15_19세','20_24세','25_29세','30_34세','35_39세','40_44세','45_49세','50_54세','55_59세','60_64세','65_69세','70_74세','75_79세','80세이상'];

  // 최근 연도 연령별 테이블 (10세)
  const age10Latest = s.age10.filter(r=>r.year===latestY);
  const maleAge=age10Latest.filter(r=>r.gender==='남');
  const femaleAge=age10Latest.filter(r=>r.gender==='여');

  return '<div class="grid grid-cols-2 gap-6">'+
    '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><i class="fas fa-chart-bar text-amber-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">10세 구간별 환자수 추이</span></div><div style="height:320px"><canvas id="chart-age10-trend"></canvas></div></div>'+
    '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center"><i class="fas fa-chart-pie text-rose-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 연령분포 (10세 구간)</span></div><div style="height:320px"><canvas id="chart-age10-pie"></canvas></div></div>'+
  '</div>'+
  '<div class="grid grid-cols-2 gap-6">'+
    '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-person text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 남성 연령분포 (5세 구간)</span></div><div style="height:320px"><canvas id="chart-age5-male"></canvas></div></div>'+
    '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-pink-50 flex items-center justify-center"><i class="fas fa-person-dress text-pink-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 여성 연령분포 (5세 구간)</span></div><div style="height:320px"><canvas id="chart-age5-female"></canvas></div></div>'+
  '</div>'+
  // 연령대별 성장률 비교
  '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-arrow-trend-up text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연령대별 성장률 ('+years[0]+'→'+latestY+'년, 10세 구간)</span></div><div style="height:280px"><canvas id="chart-age-growth"></canvas></div></div>'+
  // 상세 테이블
  '<div class="card-flat overflow-hidden"><div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><i class="fas fa-table text-slate-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 연령대별 상세 (10세 구간, 남/여)</span></div>'+
    '<table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100">'+
      '<th class="px-4 py-3 text-left">연령대</th><th class="px-3 py-3 text-right">남 환자수</th><th class="px-3 py-3 text-right">남 사용량</th><th class="px-3 py-3 text-right">남 금액</th><th class="px-3 py-3 text-right">여 환자수</th><th class="px-3 py-3 text-right">여 사용량</th><th class="px-3 py-3 text-right">여 금액</th><th class="px-3 py-3 text-right">합계</th></tr></thead>'+
    '<tbody class="divide-y divide-gray-50">'+ageGroups10.map((ag,i)=>{
      const m=maleAge.find(r=>r.age_group===ag)||{patients:0,usage:0,amount:0};
      const f=femaleAge.find(r=>r.age_group===ag)||{patients:0,usage:0,amount:0};
      return '<tr class="tr"><td class="px-4 py-2.5 font-semibold text-sm text-slate-700">'+ageLabels10[i]+'</td><td class="px-3 py-2.5 text-right text-sm text-blue-600">'+fmtNum(m.patients)+'</td><td class="px-3 py-2.5 text-right text-xs text-slate-500">'+fmtNum(m.usage)+'</td><td class="px-3 py-2.5 text-right text-xs text-slate-500">'+fmtNum(m.amount)+'</td><td class="px-3 py-2.5 text-right text-sm text-pink-600">'+fmtNum(f.patients)+'</td><td class="px-3 py-2.5 text-right text-xs text-slate-500">'+fmtNum(f.usage)+'</td><td class="px-3 py-2.5 text-right text-xs text-slate-500">'+fmtNum(f.amount)+'</td><td class="px-3 py-2.5 text-right font-bold text-sm text-slate-800">'+fmtNum(m.patients+f.patients)+'</td></tr>'
    }).join('')+'</tbody></table></div>';
}

function renderRegion(s){
  const years=s.years;
  const latestY=years[years.length-1];
  const regLatest=s.region.filter(r=>r.year===latestY && r.patients>0);
  const totalP=regLatest.reduce((a,b)=>a+b.patients,0);
  return '<div class="grid grid-cols-5 gap-6">'+
    '<div class="col-span-3 card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-chart-bar text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 지역별 환자수</span></div><div style="height:320px"><canvas id="chart-region-bar"></canvas></div></div>'+
    '<div class="col-span-2 card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-cyan-50 flex items-center justify-center"><i class="fas fa-chart-pie text-cyan-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 지역 점유율</span></div><div style="height:320px"><canvas id="chart-region-pie"></canvas></div></div>'+
  '</div>'+
  '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-chart-area text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">주요 지역 환자수 연도별 추이</span></div><div style="height:300px"><canvas id="chart-region-trend"></canvas></div></div>'+
  // 상세 테이블
  '<div class="card-flat overflow-hidden"><div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><i class="fas fa-table text-slate-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 지역별 환자수 상세</span></div>'+
    '<div class="overflow-x-auto"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100">'+
      '<th class="px-4 py-3 text-left sticky left-0 bg-gray-50/80 z-10">지역</th>'+years.map(yr=>'<th class="px-3 py-3 text-right">'+yr+'</th>').join('')+'<th class="px-3 py-3 text-right">변화율</th></tr></thead>'+
    '<tbody class="divide-y divide-gray-50">'+
      regLatest.sort((a,b)=>b.patients-a.patients).map(rl=>{
        const region=rl.region;
        const vals=years.map(yr=>{const r=s.region.find(x=>x.year===yr&&x.region===region);return r?r.patients:0});
        const first=vals.find(v=>v>0)||1;const last=vals[vals.length-1];
        const change=first>0?((last-first)/first*100).toFixed(1):'—';
        const cc=last>first?'text-emerald-600':'text-red-500';
        return '<tr class="tr"><td class="px-4 py-2.5 font-semibold text-sm text-slate-700 sticky left-0 bg-white z-10">'+region+'</td>'+vals.map(v=>'<td class="px-3 py-2.5 text-right text-sm '+(v===0?'text-slate-300':'text-slate-600')+'">'+(v>0?fmtNum(v)+' <span class="text-[10px] text-slate-300">('+((v/totalP)*100|0>0?(v/totalP*100).toFixed(1):'<1')+'%)</span>':'-')+'</td>').join('')+'<td class="px-3 py-2.5 text-right text-sm font-semibold '+cc+'">'+change+'%</td></tr>'
      }).join('')+
    '</tbody></table></div></div>';
}

function renderInstitution(s){
  const years=s.years;
  const latestY=years[years.length-1];
  const instLatest=s.institution.filter(r=>r.year===latestY && r.patients>0);
  const totalP=instLatest.reduce((a,b)=>a+b.patients,0);
  return '<div class="grid grid-cols-5 gap-6">'+
    '<div class="col-span-3 card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-chart-bar text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">요양기관 종별 환자수 추이</span></div><div style="height:320px"><canvas id="chart-inst-trend"></canvas></div></div>'+
    '<div class="col-span-2 card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><i class="fas fa-chart-pie text-amber-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">'+latestY+'년 기관 종별 비율</span></div><div style="height:320px"><canvas id="chart-inst-pie"></canvas></div></div>'+
  '</div>'+
  // 상세 테이블
  '<div class="card-flat overflow-hidden"><div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><i class="fas fa-table text-slate-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 요양기관 종별 상세</span></div>'+
    '<table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100">'+
      '<th class="px-4 py-3 text-left">기관 종별</th>'+years.map(yr=>'<th class="px-3 py-3 text-right">'+yr+'년</th>').join('')+'<th class="px-3 py-3 text-right">비중('+latestY+')</th></tr></thead>'+
    '<tbody class="divide-y divide-gray-50">'+
      ['상급종합병원','종합병원','병원급','의원급','보건기관등'].map(it=>{
        const vals=years.map(yr=>{const r=s.institution.find(x=>x.year===yr&&x.institution_type===it);return r?r.patients:0});
        const last=vals[vals.length-1];
        const ratio=totalP>0?(last/totalP*100).toFixed(1):'0';
        return '<tr class="tr"><td class="px-4 py-2.5 font-semibold text-sm text-slate-700">'+it+'</td>'+vals.map(v=>'<td class="px-3 py-2.5 text-right text-sm '+(v===0?'text-slate-300':'text-slate-600')+'">'+(v>0?fmtNum(v):'-')+'</td>').join('')+'<td class="px-3 py-2.5 text-right text-sm font-bold text-brand-600">'+ratio+'%</td></tr>'
      }).join('')+
    '</tbody></table></div>';
}

function renderAmount(s){
  const years=s.years;
  const y=s.yearly;
  const totalAmount=y.reduce((a,b)=>a+b.amount,0);
  return '<div class="grid grid-cols-3 gap-4 mb-2">'+
    '<div class="sc !p-4"><div class="text-[11px] text-slate-400 font-medium mb-1">6년간 총 진료금액</div><div class="text-[22px] font-extrabold text-slate-800">'+fmtAmount(totalAmount)+'</div><div class="text-[10px] text-slate-400">2019-2024 누적</div></div>'+
    '<div class="sc !p-4"><div class="text-[11px] text-slate-400 font-medium mb-1">'+y[y.length-1].year+'년 진료금액</div><div class="text-[22px] font-extrabold text-brand-600">'+fmtAmount(y[y.length-1].amount)+'</div><div class="text-[10px] text-slate-400">전년대비 +'+(((y[y.length-1].amount-y[y.length-2].amount)/y[y.length-2].amount)*100).toFixed(1)+'%</div></div>'+
    '<div class="sc !p-4"><div class="text-[11px] text-slate-400 font-medium mb-1">1인당 평균 진료비</div><div class="text-[22px] font-extrabold text-emerald-600">'+(y[y.length-1].amount/y[y.length-1].patients).toFixed(0)+'천원</div><div class="text-[10px] text-slate-400">'+y[y.length-1].year+'년 기준 (약 '+(y[y.length-1].amount/y[y.length-1].patients/1000).toFixed(1)+'백만원)</div></div>'+
  '</div>'+
  '<div class="grid grid-cols-2 gap-6">'+
    '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-chart-area text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 진료금액 추이 (천원)</span></div><div style="height:300px"><canvas id="chart-amount-trend"></canvas></div></div>'+
    '<div class="card-flat p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><i class="fas fa-chart-bar text-violet-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">성별 진료금액 비교</span></div><div style="height:300px"><canvas id="chart-amount-gender"></canvas></div></div>'+
  '</div>'+
  // 금액 상세 테이블
  '<div class="card-flat overflow-hidden"><div class="px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><i class="fas fa-table text-slate-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 진료금액 상세</span></div>'+
    '<table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100">'+
      '<th class="px-4 py-3 text-left">연도</th><th class="px-3 py-3 text-right">총 진료금액</th><th class="px-3 py-3 text-right">남성</th><th class="px-3 py-3 text-right">여성</th><th class="px-3 py-3 text-right">1인당 평균</th><th class="px-3 py-3 text-right">전년대비</th></tr></thead>'+
    '<tbody class="divide-y divide-gray-50">'+y.map((r,i)=>{
      const perP=(r.amount/r.patients).toFixed(0);
      const g=i>0?((r.amount-y[i-1].amount)/y[i-1].amount*100).toFixed(1):'—';
      const gc=i>0?(r.amount>y[i-1].amount?'text-emerald-600':'text-red-500'):'text-slate-400';
      return '<tr class="tr"><td class="px-4 py-2.5 font-bold text-sm text-slate-800">'+r.year+'년</td><td class="px-3 py-2.5 text-right font-semibold text-sm text-brand-600">'+fmtNum(r.amount)+'</td><td class="px-3 py-2.5 text-right text-sm text-blue-600">'+fmtNum(r.male_amount)+'</td><td class="px-3 py-2.5 text-right text-sm text-pink-600">'+fmtNum(r.female_amount)+'</td><td class="px-3 py-2.5 text-right text-sm text-slate-600">'+fmtNum(parseInt(perP))+'</td><td class="px-3 py-2.5 text-right text-sm font-semibold '+gc+'">'+(i>0?(g>0?'+':'')+g+'%':'—')+'</td></tr>'
    }).join('')+'</tbody></table></div>';
}

function renderCIChartsForTab(tab,s){
  const font='Pretendard,Inter,-apple-system,sans-serif';
  Chart.defaults.font.family=font;Chart.defaults.font.size=11;
  const defs={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}}};
  const years=s.years;
  const y=s.yearly;
  const colors10=['#818cf8','#60a5fa','#34d399','#fbbf24','#f472b6','#a78bfa','#38bdf8','#fb923c','#ef4444'];

  if(tab==='overview'){
    // Yearly trend
    ciCharts.push(new Chart(document.getElementById('chart-yearly'),{
      type:'bar',data:{labels:y.map(d=>d.year+'년'),datasets:[
        {label:'시술건수(사용량)',data:y.map(d=>d.usage),backgroundColor:'rgba(51,102,255,0.7)',borderRadius:8,barPercentage:0.4,order:2},
        {label:'환자수',data:y.map(d=>d.patients),type:'line',borderColor:'#10b981',backgroundColor:'rgba(16,185,129,0.1)',borderWidth:2.5,pointRadius:5,pointBackgroundColor:'#10b981',fill:true,tension:0.4,order:1}
      ]},options:{...defs,plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,padding:15}}},scales:{y:{beginAtZero:false,grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false}}}}
    }));
    // Gender
    ciCharts.push(new Chart(document.getElementById('chart-gender'),{
      type:'bar',data:{labels:y.map(d=>d.year+'년'),datasets:[
        {label:'남성',data:y.map(d=>d.male_patients),backgroundColor:'rgba(59,130,246,0.7)',borderRadius:6,barPercentage:0.6},
        {label:'여성',data:y.map(d=>d.female_patients),backgroundColor:'rgba(244,114,182,0.7)',borderRadius:6,barPercentage:0.6}
      ]},options:{...defs,plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,padding:15}}},scales:{y:{beginAtZero:false,grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false}}}}
    }));
  }

  if(tab==='age'){
    const ageGroups10=['0_9세','10_19세','20_29세','30_39세','40_49세','50_59세','60_69세','70_79세','80세이상'];
    const ageLabels10=['0-9세','10-19세','20-29세','30-39세','40-49세','50-59세','60-69세','70-79세','80+'];
    // Age10 trend - stacked bar
    const datasets10=ageGroups10.map((ag,i)=>({
      label:ageLabels10[i],
      data:years.map(yr=>{
        const male=s.age10.find(r=>r.year===yr&&r.gender==='남'&&r.age_group===ag);
        const female=s.age10.find(r=>r.year===yr&&r.gender==='여'&&r.age_group===ag);
        return (male?.patients||0)+(female?.patients||0);
      }),
      backgroundColor:colors10[i],borderRadius:2,barPercentage:0.7
    }));
    ciCharts.push(new Chart(document.getElementById('chart-age10-trend'),{
      type:'bar',data:{labels:years.map(y=>y+'년'),datasets:datasets10},
      options:{...defs,plugins:{legend:{display:true,position:'top',labels:{boxWidth:8,padding:8,font:{size:9}}}},scales:{y:{stacked:true,grid:{color:'rgba(0,0,0,0.04)'}},x:{stacked:true,grid:{display:false}}}}
    }));

    // Age10 pie (latest year)
    const latestY=years[years.length-1];
    const pieData=ageGroups10.map(ag=>{
      const m=s.age10.find(r=>r.year===latestY&&r.gender==='남'&&r.age_group===ag);
      const f=s.age10.find(r=>r.year===latestY&&r.gender==='여'&&r.age_group===ag);
      return (m?.patients||0)+(f?.patients||0);
    });
    ciCharts.push(new Chart(document.getElementById('chart-age10-pie'),{
      type:'doughnut',data:{labels:ageLabels10,datasets:[{data:pieData,backgroundColor:colors10,borderWidth:2,borderColor:'#fff',hoverOffset:8}]},
      options:{...defs,cutout:'50%',plugins:{legend:{display:true,position:'right',labels:{boxWidth:10,padding:8,font:{size:10}}}}}
    }));

    // Age5 male (latest)
    const ageGroups5=['5세미만','5_9세','10_14세','15_19세','20_24세','25_29세','30_34세','35_39세','40_44세','45_49세','50_54세','55_59세','60_64세','65_69세','70_74세','75_79세','80세이상'];
    const ageLabels5=['<5','5-9','10-14','15-19','20-24','25-29','30-34','35-39','40-44','45-49','50-54','55-59','60-64','65-69','70-74','75-79','80+'];
    const maleData5=ageGroups5.map(ag=>{const r=s.age5.find(x=>x.year===latestY&&x.gender==='남'&&x.age_group===ag);return r?.patients||0});
    const femaleData5=ageGroups5.map(ag=>{const r=s.age5.find(x=>x.year===latestY&&x.gender==='여'&&x.age_group===ag);return r?.patients||0});
    ciCharts.push(new Chart(document.getElementById('chart-age5-male'),{
      type:'bar',data:{labels:ageLabels5,datasets:[{data:maleData5,backgroundColor:'rgba(59,130,246,0.7)',borderRadius:4,barPercentage:0.7}]},
      options:{...defs,scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false},ticks:{font:{size:9}}}}}
    }));
    ciCharts.push(new Chart(document.getElementById('chart-age5-female'),{
      type:'bar',data:{labels:ageLabels5,datasets:[{data:femaleData5,backgroundColor:'rgba(244,114,182,0.7)',borderRadius:4,barPercentage:0.7}]},
      options:{...defs,scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false},ticks:{font:{size:9}}}}}
    }));

    // Age growth rate (CAGR from first to last year)
    const firstY=years[0],lastY=years[years.length-1],span=lastY-firstY;
    const growthData=ageGroups10.map((ag,i)=>{
      const firstM=s.age10.find(r=>r.year===firstY&&r.gender==='남'&&r.age_group===ag);
      const firstF=s.age10.find(r=>r.year===firstY&&r.gender==='여'&&r.age_group===ag);
      const lastM=s.age10.find(r=>r.year===lastY&&r.gender==='남'&&r.age_group===ag);
      const lastF=s.age10.find(r=>r.year===lastY&&r.gender==='여'&&r.age_group===ag);
      const f=(firstM?.patients||0)+(firstF?.patients||0);
      const l=(lastM?.patients||0)+(lastF?.patients||0);
      if(f===0)return{label:ageLabels10[i],rate:l>0?100:0};
      return{label:ageLabels10[i],rate:(Math.pow(l/f,1/span)-1)*100};
    });
    ciCharts.push(new Chart(document.getElementById('chart-age-growth'),{
      type:'bar',data:{labels:growthData.map(d=>d.label),datasets:[{data:growthData.map(d=>parseFloat(d.rate.toFixed(1))),backgroundColor:growthData.map(d=>d.rate>=0?'rgba(16,185,129,0.7)':'rgba(239,68,68,0.7)'),borderRadius:6,barPercentage:0.6}]},
      options:{...defs,indexAxis:'y',scales:{x:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:11,weight:'600'}}}}}
    }));
  }

  if(tab==='region'){
    const latestY=years[years.length-1];
    const regL=s.region.filter(r=>r.year===latestY&&r.patients>0).sort((a,b)=>b.patients-a.patients);
    const totalP=regL.reduce((a,b)=>a+b.patients,0);
    const regionColors=['#3366ff','#059669','#d97706','#8b5cf6','#ef4444','#ec4899','#06b6d4','#f97316','#84cc16','#64748b','#0ea5e9','#a855f7','#14b8a6','#f43f5e','#eab308','#6366f1','#10b981'];
    // Region bar
    ciCharts.push(new Chart(document.getElementById('chart-region-bar'),{
      type:'bar',data:{labels:regL.map(r=>r.region),datasets:[{data:regL.map(r=>r.patients),backgroundColor:regionColors.slice(0,regL.length),borderRadius:8,barPercentage:0.6}]},
      options:{...defs,scales:{y:{grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false},ticks:{font:{size:10}}}},plugins:{...defs.plugins,tooltip:{callbacks:{label:ctx=>ctx.raw+'명 ('+(ctx.raw/totalP*100).toFixed(1)+'%)'}}}}
    }));
    // Region pie
    ciCharts.push(new Chart(document.getElementById('chart-region-pie'),{
      type:'doughnut',data:{labels:regL.map(r=>r.region),datasets:[{data:regL.map(r=>r.patients),backgroundColor:regionColors.slice(0,regL.length),borderWidth:2,borderColor:'#fff'}]},
      options:{...defs,cutout:'45%',plugins:{legend:{display:true,position:'right',labels:{boxWidth:8,padding:6,font:{size:9}}}}}
    }));
    // Region trend (top 5)
    const topRegions=regL.slice(0,5).map(r=>r.region);
    const trendColors=['#3366ff','#059669','#d97706','#8b5cf6','#ef4444'];
    ciCharts.push(new Chart(document.getElementById('chart-region-trend'),{
      type:'line',data:{labels:years.map(y=>y+'년'),datasets:topRegions.map((reg,i)=>({
        label:reg,
        data:years.map(yr=>{const r=s.region.find(x=>x.year===yr&&x.region===reg);return r?.patients||0}),
        borderColor:trendColors[i],backgroundColor:trendColors[i]+'20',borderWidth:2.5,pointRadius:4,pointBackgroundColor:trendColors[i],tension:0.4,fill:false
      }))},options:{...defs,plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,padding:15}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false}}}}
    }));
  }

  if(tab==='institution'){
    const latestY=years[years.length-1];
    const instTypes=['상급종합병원','종합병원','병원급','의원급','보건기관등'];
    const instColors=['#3366ff','#059669','#d97706','#8b5cf6','#94a3b8'];
    // Inst trend
    ciCharts.push(new Chart(document.getElementById('chart-inst-trend'),{
      type:'line',data:{labels:years.map(y=>y+'년'),datasets:instTypes.filter(it=>{
        return years.some(yr=>s.institution.find(x=>x.year===yr&&x.institution_type===it&&x.patients>0))
      }).map((it,i)=>({
        label:it,
        data:years.map(yr=>{const r=s.institution.find(x=>x.year===yr&&x.institution_type===it);return r?.patients||0}),
        borderColor:instColors[i],backgroundColor:instColors[i]+'20',borderWidth:2.5,pointRadius:4,pointBackgroundColor:instColors[i],tension:0.4,fill:false
      }))},options:{...defs,plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,padding:15}}},scales:{y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.04)'}},x:{grid:{display:false}}}}
    }));
    // Inst pie
    const instL=s.institution.filter(r=>r.year===latestY&&r.patients>0);
    ciCharts.push(new Chart(document.getElementById('chart-inst-pie'),{
      type:'doughnut',data:{labels:instL.map(r=>r.institution_type),datasets:[{data:instL.map(r=>r.patients),backgroundColor:instColors.slice(0,instL.length),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},
      options:{...defs,cutout:'50%',plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,padding:12,font:{size:11}}}}}
    }));
  }

  if(tab==='amount'){
    // Amount trend
    ciCharts.push(new Chart(document.getElementById('chart-amount-trend'),{
      type:'line',data:{labels:y.map(d=>d.year+'년'),datasets:[
        {label:'총 진료금액',data:y.map(d=>d.amount),borderColor:'#3366ff',backgroundColor:'rgba(51,102,255,0.1)',borderWidth:3,pointRadius:5,pointBackgroundColor:'#3366ff',fill:true,tension:0.4}
      ]},options:{...defs,plugins:{legend:{display:false}},scales:{y:{beginAtZero:false,grid:{color:'rgba(0,0,0,0.04)'},ticks:{callback:v=>fmtAmount(v)}},x:{grid:{display:false}}}}
    }));
    // Amount gender
    ciCharts.push(new Chart(document.getElementById('chart-amount-gender'),{
      type:'bar',data:{labels:y.map(d=>d.year+'년'),datasets:[
        {label:'남성',data:y.map(d=>d.male_amount),backgroundColor:'rgba(59,130,246,0.7)',borderRadius:6,barPercentage:0.6},
        {label:'여성',data:y.map(d=>d.female_amount),backgroundColor:'rgba(244,114,182,0.7)',borderRadius:6,barPercentage:0.6}
      ]},options:{...defs,plugins:{legend:{display:true,position:'top',labels:{boxWidth:10,padding:15}}},scales:{y:{stacked:true,grid:{color:'rgba(0,0,0,0.04)'},ticks:{callback:v=>fmtAmount(v)}},x:{stacked:true,grid:{display:false}}}}
    }));
  }
}

nav('dashboard');
</script></body></html>`

export default app
