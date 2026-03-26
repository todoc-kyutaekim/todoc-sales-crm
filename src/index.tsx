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

// Photo upload (Base64)
app.post('/api/doctors/:id/photo', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  if (!body.photo) return c.json({ error: 'No photo data' }, 400)
  await c.env.DB.prepare('UPDATE doctors SET photo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.photo, id).run()
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

// ===== SPA =====
app.get('*', (c) => c.html(HTML))

const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TODOC CRM</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/axios@1.7.0/dist/axios.min.js"></script>
<script>tailwind.config={theme:{extend:{fontFamily:{sans:['Inter','-apple-system','sans-serif']},colors:{brand:{50:'#eef4ff',100:'#d9e6ff',200:'#bcd2ff',300:'#8eb5ff',400:'#598eff',500:'#3366ff',600:'#1a4fff',700:'#0a3ae6',800:'#0d32ba',900:'#102d92',950:'#0c1d5e'}}}}}</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',-apple-system,sans-serif;background:#f1f5f9}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px}::-webkit-scrollbar-thumb:hover{background:#94a3b8}
.fade-in{animation:fadeIn .25s ease}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.modal-bg{background:rgba(15,23,42,.6);backdrop-filter:blur(8px)}
.card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;transition:all .2s}
.card:hover{box-shadow:0 4px 24px rgba(0,0,0,.08);border-color:#cbd5e1}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;transition:all .15s;cursor:pointer;border:none}
.btn-primary{background:#3366ff;color:#fff}.btn-primary:hover{background:#1a4fff}
.btn-success{background:#059669;color:#fff}.btn-success:hover{background:#047857}
.btn-danger{background:#fee2e2;color:#dc2626}.btn-danger:hover{background:#fecaca}
.btn-ghost{background:transparent;color:#64748b}.btn-ghost:hover{background:#f1f5f9;color:#334155}
.btn-outline{background:#fff;color:#334155;border:1px solid #e2e8f0}.btn-outline:hover{background:#f8fafc;border-color:#cbd5e1}
.input{width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;transition:all .15s;outline:none;font-family:inherit;background:#fff}
.input:focus{border-color:#3366ff;box-shadow:0 0 0 3px rgba(51,102,255,.1)}
.input-label{display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:5px;letter-spacing:.02em}
select.input{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:30px}
textarea.input{resize:vertical;min-height:70px}
.badge{display:inline-flex;align-items:center;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:.02em}
.grade-S{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#78350f}
.grade-A{background:linear-gradient(135deg,#60a5fa,#3b82f6);color:#fff}
.grade-B{background:linear-gradient(135deg,#34d399,#10b981);color:#064e3b}
.grade-C{background:linear-gradient(135deg,#a1a1aa,#71717a);color:#fff}
.inf-high{color:#dc2626;font-weight:700}.inf-medium{color:#d97706;font-weight:600}.inf-low{color:#9ca3af}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:500;color:#94a3b8;cursor:pointer;transition:all .15s;margin:2px 8px}
.nav-item:hover{background:rgba(255,255,255,.08);color:#e2e8f0}
.nav-item.active{background:rgba(51,102,255,.2);color:#fff;font-weight:600}
.nav-item .nav-icon{width:20px;text-align:center;font-size:14px}
.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#64748b;font-size:14px;flex-shrink:0;overflow:hidden}
.avatar img{width:100%;height:100%;object-fit:cover}
.avatar-lg{width:72px;height:72px;font-size:24px;border-radius:50%}
.photo-upload{position:relative;cursor:pointer}
.photo-upload:hover .photo-overlay{opacity:1}
.photo-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s;color:#fff;font-size:16px}
.stat-card{background:#fff;border-radius:12px;padding:20px;border:1px solid #e2e8f0;position:relative;overflow:hidden}
.stat-card::after{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.stat-card.blue::after{background:linear-gradient(90deg,#3366ff,#60a5fa)}
.stat-card.green::after{background:linear-gradient(90deg,#059669,#34d399)}
.stat-card.purple::after{background:linear-gradient(90deg,#7c3aed,#a78bfa)}
.stat-card.amber::after{background:linear-gradient(90deg,#d97706,#fbbf24)}
.table-row{transition:background .1s}.table-row:hover{background:#f8fafc}
.meeting-type{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600}
.mt-visit{background:#dbeafe;color:#1d4ed8}.mt-phone{background:#dcfce7;color:#15803d}.mt-conference{background:#f3e8ff;color:#7c3aed}.mt-email{background:#fef3c7;color:#92400e}.mt-online{background:#e0e7ff;color:#4338ca}
.empty-state{text-align:center;padding:48px 20px;color:#94a3b8}
.empty-state i{font-size:40px;margin-bottom:12px;opacity:.5}
</style>
</head>
<body class="h-screen overflow-hidden">
<div class="flex h-screen">

<!-- Sidebar -->
<aside id="sidebar" class="w-[240px] bg-slate-900 flex flex-col flex-shrink-0 select-none">
  <div class="p-5 flex items-center gap-3">
    <div class="w-9 h-9 rounded-lg bg-brand-500 flex items-center justify-center">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" fill="#fff"/></svg>
    </div>
    <div>
      <div class="text-white font-bold text-sm tracking-wide">TODOC CRM</div>
      <div class="text-slate-400 text-[10px] tracking-wider">SALES MANAGEMENT</div>
    </div>
  </div>
  <div class="h-px bg-slate-800 mx-4"></div>
  <nav class="flex-1 py-3 space-y-0.5">
    <div onclick="nav('dashboard')" id="n-dashboard" class="nav-item"><span class="nav-icon"><i class="fas fa-grid-2"></i></span>대시보드</div>
    <div onclick="nav('hospitals')" id="n-hospitals" class="nav-item"><span class="nav-icon"><i class="fas fa-hospital"></i></span>병원 관리</div>
    <div onclick="nav('doctors')" id="n-doctors" class="nav-item"><span class="nav-icon"><i class="fas fa-user-doctor"></i></span>교수 관리</div>
    <div onclick="nav('meetings')" id="n-meetings" class="nav-item"><span class="nav-icon"><i class="fas fa-calendar-check"></i></span>미팅 기록</div>
  </nav>
  <div class="p-4 border-t border-slate-800">
    <div class="text-[10px] text-slate-500 leading-relaxed">&copy; 2026 TODOC Inc.<br>Cochlear Implant Solutions</div>
  </div>
</aside>

<!-- Main -->
<main class="flex-1 flex flex-col overflow-hidden min-w-0">
  <header class="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
    <div class="flex items-center gap-3">
      <h2 id="page-title" class="text-[15px] font-bold text-slate-800"></h2>
      <span id="page-subtitle" class="text-xs text-slate-400"></span>
    </div>
    <div id="header-actions" class="flex items-center gap-2"></div>
  </header>
  <div id="content" class="flex-1 overflow-y-auto"></div>
</main>
</div>

<!-- Modal -->
<div id="modal" class="fixed inset-0 modal-bg z-50 hidden flex items-center justify-center p-4" onclick="if(event.target===this)closeModal()">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] overflow-y-auto" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10 rounded-t-2xl">
      <h3 id="modal-title" class="font-bold text-slate-800 text-[15px]"></h3>
      <button onclick="closeModal()" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"><i class="fas fa-xmark"></i></button>
    </div>
    <div id="modal-body" class="p-6"></div>
  </div>
</div>

<script>
const API = axios.create({baseURL:'/api'});
let curPage='', hospList=[], docList=[];

// Nav
function nav(p) {
  curPage=p;
  document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
  document.getElementById('n-'+p)?.classList.add('active');
  document.getElementById('page-subtitle').textContent='';
  document.getElementById('header-actions').innerHTML='';
  ({dashboard:loadDash, hospitals:loadHosp, doctors:loadDoc, meetings:loadMeet})[p]?.();
}

function openModal(t,h){document.getElementById('modal-title').textContent=t;document.getElementById('modal-body').innerHTML=h;document.getElementById('modal').classList.remove('hidden')}
function closeModal(){document.getElementById('modal').classList.add('hidden')}
function fmtDate(d){if(!d)return'-';return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'short',day:'numeric'})}
function fmtDateShort(d){if(!d)return'-';return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{month:'short',day:'numeric'})}
function daysAgo(d){if(!d)return'';const diff=Math.floor((Date.now()-new Date(d+'T00:00:00').getTime())/86400000);if(diff===0)return'오늘';if(diff<0)return Math.abs(diff)+'일 후';return diff+'일 전'}
function gradeBadge(g){return'<span class="badge grade-'+g+'">'+g+'</span>'}
function statusDot(s){return s==='active'?'<span class="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>활성</span>':'<span class="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium"><span class="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block"></span>비활성</span>'}
function infText(l){return{high:'<span class="inf-high"><i class="fas fa-fire text-[10px]"></i> 핵심</span>',medium:'<span class="inf-medium"><i class="fas fa-star text-[10px]"></i> 주요</span>',low:'<span class="inf-low">일반</span>'}[l]||l}
function mtBadge(t){const m={visit:['방문','mt-visit','fa-building'],phone:['전화','mt-phone','fa-phone'],conference:['학회','mt-conference','fa-users'],email:['이메일','mt-email','fa-envelope'],online:['온라인','mt-online','fa-video']};const v=m[t]||['기타','mt-visit','fa-circle'];return'<span class="meeting-type '+v[1]+'"><i class="fas '+v[2]+' text-[9px]"></i>'+v[0]+'</span>'}
function avatar(photo,name,cls=''){const c=cls||'avatar';if(photo)return'<div class="'+c+'"><img src="'+photo+'" alt=""></div>';const ini=(name||'?').charAt(0);return'<div class="'+c+'" style="background:#e2e8f0">'+ini+'</div>'}
function field(label,name,type,val,opts){
  if(type==='select')return'<div><label class="input-label">'+label+'</label><select name="'+name+'" class="input">'+opts.map(o=>'<option value="'+o.v+'"'+(o.v==val?' selected':'')+'>'+o.l+'</option>').join('')+'</select></div>';
  if(type==='textarea')return'<div class="col-span-2"><label class="input-label">'+label+'</label><textarea name="'+name+'" class="input">'+(val||'')+'</textarea></div>';
  return'<div><label class="input-label">'+label+'</label><input type="'+type+'" name="'+name+'" value="'+(val||'')+'" class="input"></div>';
}

// ===== DASHBOARD =====
async function loadDash(){
  document.getElementById('page-title').textContent='대시보드';
  document.getElementById('page-subtitle').textContent='영업 현황 요약';
  try{
    const{data:d}=await API.get('/dashboard');const s=d.data;
    document.getElementById('content').innerHTML='<div class="p-6 fade-in space-y-6">'+
    '<div class="grid grid-cols-4 gap-4">'+
      statCard('관리 병원',s.stats.hospitals,'개','fas fa-hospital','blue','hospitals')+
      statCard('등록 교수',s.stats.doctors,'명','fas fa-user-doctor','purple','doctors')+
      statCard('총 미팅',s.stats.meetings,'건','fas fa-handshake','green','meetings')+
      statCard('이번 달',s.stats.monthMeetings,'건','fas fa-calendar-day','amber','')+
    '</div>'+
    '<div class="grid grid-cols-5 gap-5">'+
      '<div class="col-span-3 card p-0 overflow-hidden">'+
        '<div class="px-5 py-3 border-b border-slate-100 flex items-center justify-between"><span class="font-bold text-sm text-slate-800"><i class="fas fa-clock text-brand-400 mr-1.5"></i>최근 미팅</span><span class="text-[11px] text-slate-400">최근 8건</span></div>'+
        (s.recentMeetings.length?'<div class="divide-y divide-slate-50">'+s.recentMeetings.map(m=>
          '<div class="px-5 py-3 table-row flex items-center gap-3 cursor-pointer" onclick="viewHosp('+m.hospital_id+')">'+
            avatar(m.doctor_photo,m.doctor_name)+
            '<div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="font-semibold text-sm text-slate-800">'+m.doctor_name+'</span>'+mtBadge(m.meeting_type)+'</div><div class="text-xs text-slate-400 mt-0.5 truncate">'+m.hospital_name+(m.purpose?' · '+m.purpose:'')+'</div></div>'+
            '<div class="text-right flex-shrink-0"><div class="text-xs text-slate-500">'+fmtDateShort(m.meeting_date)+'</div><div class="text-[10px] text-slate-400">'+daysAgo(m.meeting_date)+'</div></div>'+
          '</div>'
        ).join('')+'</div>':'<div class="empty-state"><i class="fas fa-calendar-xmark block"></i><p class="text-sm">미팅 기록이 없습니다</p></div>')+
      '</div>'+
      '<div class="col-span-2 space-y-5">'+
        '<div class="card p-0 overflow-hidden">'+
          '<div class="px-5 py-3 border-b border-slate-100"><span class="font-bold text-sm text-slate-800"><i class="fas fa-list-check text-amber-500 mr-1.5"></i>후속 액션</span></div>'+
          (s.upcomingActions.length?'<div class="divide-y divide-slate-50">'+s.upcomingActions.map(m=>
            '<div class="px-5 py-3 table-row"><div class="flex items-center justify-between mb-1"><span class="text-sm font-semibold text-slate-700">'+m.doctor_name+'</span>'+(m.next_meeting_date?'<span class="text-[10px] text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">'+fmtDateShort(m.next_meeting_date)+'</span>':'')+'</div><p class="text-xs text-slate-500 leading-relaxed"><i class="fas fa-arrow-right text-amber-400 mr-1"></i>'+m.next_action+'</p></div>'
          ).join('')+'</div>':'<div class="empty-state py-8"><i class="fas fa-check-circle block text-2xl"></i><p class="text-sm">모든 액션 완료</p></div>')+
        '</div>'+
        '<div class="card p-0 overflow-hidden">'+
          '<div class="px-5 py-3 border-b border-slate-100"><span class="font-bold text-sm text-slate-800"><i class="fas fa-map-location-dot text-emerald-500 mr-1.5"></i>지역별 분포</span></div>'+
          (s.regionStats.length?'<div class="p-4 space-y-2">'+s.regionStats.map(r=>'<div class="flex items-center gap-3"><span class="text-xs font-medium text-slate-600 w-12">'+r.region+'</span><div class="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden"><div class="bg-brand-400 h-full rounded-full flex items-center justify-end pr-2" style="width:'+Math.max(r.count/Math.max(...s.regionStats.map(x=>x.count))*100,15)+'%"><span class="text-[10px] font-bold text-white">'+r.count+'</span></div></div></div>').join('')+'</div>':'<div class="empty-state py-8"><i class="fas fa-map block text-2xl"></i><p class="text-sm">데이터 없음</p></div>')+
        '</div>'+
      '</div>'+
    '</div>'+
    '</div>';
  }catch(e){document.getElementById('content').innerHTML='<div class="p-6 text-red-500">데이터 로드 실패</div>'}
}
function statCard(label,val,unit,icon,color,link){
  return'<div class="stat-card '+color+' cursor-pointer hover:shadow-md transition" onclick="'+(link?'nav(\\''+link+'\\')':'')+'">'+'<div class="flex items-center justify-between"><div><p class="text-xs text-slate-400 mb-1">'+label+'</p><div class="flex items-baseline gap-1"><span class="text-2xl font-extrabold text-slate-800">'+val+'</span><span class="text-xs text-slate-400">'+unit+'</span></div></div><div class="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center"><i class="'+icon+' text-slate-400"></i></div></div></div>';
}

// ===== HOSPITALS =====
async function loadHosp(){
  document.getElementById('page-title').textContent='병원 관리';
  document.getElementById('page-subtitle').textContent='영업 대상 병원 목록';
  document.getElementById('header-actions').innerHTML='<button class="btn btn-primary" onclick="showHospForm()"><i class="fas fa-plus text-xs"></i>병원 추가</button>';
  try{
    const[hRes,rRes]=await Promise.all([API.get('/hospitals'),API.get('/regions')]);
    hospList=hRes.data.data; const regions=rRes.data.data;
    document.getElementById('content').innerHTML='<div class="p-6 fade-in">'+
      '<div class="flex items-center gap-3 mb-5">'+
        '<div class="relative flex-1 max-w-xs"><i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="h-search" oninput="filterH()" placeholder="병원명 검색" class="input pl-9 text-sm" style="max-width:280px"></div>'+
        '<select id="h-region" onchange="filterH()" class="input" style="width:130px"><option value="">전체 지역</option>'+regions.map(r=>'<option value="'+r+'">'+r+'</option>').join('')+'</select>'+
        '<select id="h-grade" onchange="filterH()" class="input" style="width:130px"><option value="">전체 등급</option><option value="S">S급</option><option value="A">A급</option><option value="B">B급</option><option value="C">C급</option></select>'+
        '<span id="h-count" class="text-xs text-slate-400 ml-auto"></span>'+
      '</div>'+
      '<div id="h-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"></div>'+
    '</div>';
    renderHCards(hospList);
  }catch(e){document.getElementById('content').innerHTML='<div class="p-6 text-red-500">로드 실패</div>'}
}
function renderHCards(list){
  document.getElementById('h-count').textContent=list.length+'개 병원';
  document.getElementById('h-grid').innerHTML=list.length?list.map(h=>
    '<div class="card p-5 cursor-pointer" onclick="viewHosp('+h.id+')">'+
      '<div class="flex items-start justify-between mb-3"><div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1">'+gradeBadge(h.grade)+' '+statusDot(h.status)+'</div><h3 class="font-bold text-slate-800 truncate">'+h.name+'</h3><p class="text-xs text-slate-400 mt-0.5"><i class="fas fa-location-dot mr-1"></i>'+(h.region||'미지정')+(h.address?' · '+h.address:'')+'</p></div></div>'+
      '<div class="flex gap-2 mt-4">'+
        '<div class="flex-1 bg-slate-50 rounded-lg px-3 py-2 text-center"><p class="text-[10px] text-slate-400 mb-0.5">교수</p><p class="text-sm font-bold text-brand-600">'+(h.doctor_count||0)+'</p></div>'+
        '<div class="flex-1 bg-slate-50 rounded-lg px-3 py-2 text-center"><p class="text-[10px] text-slate-400 mb-0.5">미팅</p><p class="text-sm font-bold text-slate-700">'+(h.meeting_count||0)+'</p></div>'+
        '<div class="flex-1 bg-slate-50 rounded-lg px-3 py-2 text-center"><p class="text-[10px] text-slate-400 mb-0.5">최근</p><p class="text-[11px] font-semibold text-slate-600">'+(h.last_meeting?fmtDateShort(h.last_meeting):'없음')+'</p></div>'+
      '</div>'+
      (h.notes?'<p class="text-[11px] text-slate-400 mt-3 line-clamp-2 leading-relaxed">'+h.notes+'</p>':'')+
    '</div>'
  ).join(''):'<div class="col-span-full empty-state"><i class="fas fa-hospital block"></i><p>등록된 병원이 없습니다</p></div>';
}
function filterH(){
  const s=(document.getElementById('h-search')?.value||'').toLowerCase(), r=document.getElementById('h-region')?.value||'', g=document.getElementById('h-grade')?.value||'';
  renderHCards(hospList.filter(h=>(!s||h.name.toLowerCase().includes(s))&&(!r||h.region===r)&&(!g||h.grade===g)));
}

// ===== HOSPITAL DETAIL =====
async function viewHosp(id){
  try{
    const[hR,dR,mR]=await Promise.all([API.get('/hospitals/'+id),API.get('/hospitals/'+id+'/doctors'),API.get('/meetings?hospital_id='+id)]);
    const h=hR.data.data, docs=dR.data.data, meets=mR.data.data;
    document.getElementById('page-title').textContent=h.name;
    document.getElementById('page-subtitle').innerHTML='<span class="cursor-pointer hover:text-brand-500" onclick="nav(\\'hospitals\\')"><i class="fas fa-arrow-left mr-1"></i>병원 목록</span>';
    document.getElementById('header-actions').innerHTML=
      '<button class="btn btn-primary" onclick="showDocForm('+h.id+')"><i class="fas fa-user-plus text-xs"></i>교수</button>'+
      '<button class="btn btn-success" onclick="showMeetForm('+h.id+')"><i class="fas fa-plus text-xs"></i>미팅</button>'+
      '<button class="btn btn-outline" onclick="showHospForm('+h.id+')"><i class="fas fa-pen text-xs"></i>수정</button>'+
      '<button class="btn btn-danger" onclick="delHosp('+h.id+')"><i class="fas fa-trash text-xs"></i></button>';

    document.getElementById('content').innerHTML='<div class="p-6 fade-in space-y-5">'+
      // Info
      '<div class="card p-5"><div class="flex items-center gap-3 mb-4">'+gradeBadge(h.grade)+' '+statusDot(h.status)+(h.phone?'<span class="text-xs text-slate-400 ml-auto"><i class="fas fa-phone mr-1"></i>'+h.phone+'</span>':'')+'</div>'+
      '<div class="grid grid-cols-3 gap-4 text-sm"><div><span class="text-slate-400 text-xs">지역</span><p class="font-medium text-slate-700 mt-0.5">'+(h.region||'-')+'</p></div><div><span class="text-slate-400 text-xs">주소</span><p class="font-medium text-slate-700 mt-0.5">'+(h.address||'-')+'</p></div><div><span class="text-slate-400 text-xs">등록일</span><p class="font-medium text-slate-700 mt-0.5">'+fmtDate(h.created_at?.split(' ')[0])+'</p></div></div>'+
      (h.notes?'<div class="mt-4 bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-800"><i class="fas fa-sticky-note text-amber-400 mr-1"></i>'+h.notes+'</div>':'')+
      '</div>'+

      // Doctors
      '<div class="card p-0 overflow-hidden"><div class="px-5 py-3 border-b border-slate-100 flex items-center justify-between"><span class="font-bold text-sm text-slate-800"><i class="fas fa-user-doctor text-brand-400 mr-1.5"></i>소속 교수 <span class="text-slate-400 font-normal">('+docs.length+')</span></span></div>'+
      (docs.length?'<div class="divide-y divide-slate-50">'+docs.map(d=>
        '<div class="px-5 py-3.5 table-row flex items-center gap-4">'+
          '<div class="photo-upload" onclick="event.stopPropagation();triggerPhoto('+d.id+','+h.id+')">'+avatar(d.photo,d.name)+'<div class="photo-overlay"><i class="fas fa-camera"></i></div></div>'+
          '<input type="file" id="photo-input-'+d.id+'" accept="image/*" style="display:none" onchange="uploadPhoto('+d.id+','+h.id+',this)">'+
          '<div class="flex-1 min-w-0">'+
            '<div class="flex items-center gap-2"><span class="font-semibold text-sm text-slate-800">'+d.name+'</span><span class="text-xs text-slate-400">'+(d.position||'')+'</span>'+infText(d.influence_level)+'</div>'+
            '<div class="flex items-center gap-3 mt-1 text-xs text-slate-400">'+(d.department?'<span><i class="fas fa-stethoscope mr-0.5"></i>'+d.department+'</span>':'')+(d.specialty?'<span><i class="fas fa-microscope mr-0.5"></i>'+d.specialty+'</span>':'')+'<span><i class="fas fa-calendar mr-0.5"></i>'+((d.meeting_count||0))+'회'+(d.last_meeting?' ('+daysAgo(d.last_meeting)+')':'')+'</span></div>'+
          '</div>'+
          '<div class="flex gap-1 flex-shrink-0">'+
            '<button class="btn btn-ghost text-xs px-2" onclick="event.stopPropagation();showMeetForm('+h.id+','+d.id+')" title="미팅 추가"><i class="fas fa-plus"></i></button>'+
            '<button class="btn btn-ghost text-xs px-2" onclick="event.stopPropagation();showDocForm('+h.id+','+d.id+')" title="수정"><i class="fas fa-pen"></i></button>'+
            '<button class="btn btn-ghost text-xs px-2 text-red-400 hover:text-red-600" onclick="event.stopPropagation();delDoc('+d.id+','+h.id+')" title="삭제"><i class="fas fa-trash"></i></button>'+
          '</div>'+
        '</div>'
      ).join('')+'</div>':'<div class="empty-state py-8"><i class="fas fa-user-plus block"></i><p class="text-sm">교수를 추가해주세요</p></div>')+
      '</div>'+

      // Meetings
      '<div class="card p-0 overflow-hidden"><div class="px-5 py-3 border-b border-slate-100 flex items-center justify-between"><span class="font-bold text-sm text-slate-800"><i class="fas fa-calendar-check text-emerald-500 mr-1.5"></i>미팅 기록 <span class="text-slate-400 font-normal">('+meets.length+')</span></span></div>'+
      (meets.length?'<div class="divide-y divide-slate-50">'+meets.map(m=>
        '<div class="px-5 py-4 table-row">'+
          '<div class="flex items-center justify-between mb-2">'+
            '<div class="flex items-center gap-2.5">'+avatar(m.doctor_photo,m.doctor_name,'avatar" style="width:28px;height:28px;font-size:11px')+'<span class="font-semibold text-sm text-slate-800">'+(m.doctor_name||'-')+'</span>'+mtBadge(m.meeting_type)+'</div>'+
            '<div class="flex items-center gap-2"><span class="text-xs text-slate-400">'+fmtDate(m.meeting_date)+'</span><button class="btn btn-ghost text-xs px-1.5" onclick="showMeetForm('+h.id+','+m.doctor_id+','+m.id+')"><i class="fas fa-pen"></i></button><button class="btn btn-ghost text-xs px-1.5 text-red-400" onclick="delMeet('+m.id+','+h.id+')"><i class="fas fa-trash"></i></button></div>'+
          '</div>'+
          (m.purpose?'<div class="text-sm font-medium text-slate-700 mb-1">'+m.purpose+'</div>':'')+
          (m.content?'<div class="text-xs text-slate-500 leading-relaxed mb-1.5">'+m.content+'</div>':'')+
          (m.result?'<div class="text-xs text-emerald-700 bg-emerald-50 rounded-md px-2.5 py-1.5 mb-1.5 inline-block"><i class="fas fa-check-circle mr-1"></i>'+m.result+'</div>':'')+
          (m.next_action?'<div class="text-xs text-amber-700 bg-amber-50 rounded-md px-2.5 py-1.5 inline-block"><i class="fas fa-arrow-right mr-1"></i>'+m.next_action+(m.next_meeting_date?' <span class="font-semibold">('+fmtDateShort(m.next_meeting_date)+')</span>':'')+'</div>':'')+
        '</div>'
      ).join('')+'</div>':'<div class="empty-state py-8"><i class="fas fa-calendar-plus block"></i><p class="text-sm">미팅 기록이 없습니다</p></div>')+
      '</div>'+
    '</div>';
  }catch(e){console.error(e)}
}

// ===== DOCTORS PAGE =====
async function loadDoc(){
  document.getElementById('page-title').textContent='교수 관리';
  document.getElementById('page-subtitle').textContent='전체 교수 목록';
  try{
    const{data}=await API.get('/doctors');docList=data.data;
    document.getElementById('content').innerHTML='<div class="p-6 fade-in">'+
      '<div class="flex items-center gap-3 mb-5">'+
        '<div class="relative"><i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="d-search" oninput="filterD()" placeholder="교수명 / 병원명 검색" class="input pl-9" style="width:300px"></div>'+
        '<span id="d-count" class="text-xs text-slate-400 ml-auto">'+docList.length+'명</span>'+
      '</div>'+
      '<div class="card overflow-hidden"><table class="w-full"><thead><tr class="bg-slate-50 text-[11px] text-slate-500 font-semibold uppercase tracking-wider">'+
        '<th class="px-5 py-3 text-left">교수</th><th class="px-4 py-3 text-left">소속 병원</th><th class="px-4 py-3 text-left">진료과</th><th class="px-4 py-3 text-left">전문분야</th><th class="px-4 py-3 text-center">영향력</th><th class="px-4 py-3 text-center">미팅</th><th class="px-4 py-3 text-left">최근 미팅</th></tr></thead>'+
        '<tbody id="d-tbody" class="divide-y divide-slate-50"></tbody></table></div>'+
    '</div>';
    renderDRows(docList);
  }catch(e){document.getElementById('content').innerHTML='<div class="p-6 text-red-500">로드 실패</div>'}
}
function renderDRows(list){
  document.getElementById('d-count').textContent=list.length+'명';
  document.getElementById('d-tbody').innerHTML=list.map(d=>
    '<tr class="table-row cursor-pointer" onclick="viewHosp('+d.hospital_id+')">'+
      '<td class="px-5 py-3"><div class="flex items-center gap-3">'+avatar(d.photo,d.name)+'<div><div class="font-semibold text-sm text-slate-800">'+d.name+'</div><div class="text-[11px] text-slate-400">'+(d.position||'')+'</div></div></div></td>'+
      '<td class="px-4 py-3 text-sm text-slate-600">'+(d.hospital_name||'-')+'</td>'+
      '<td class="px-4 py-3 text-sm text-slate-600">'+(d.department||'-')+'</td>'+
      '<td class="px-4 py-3 text-sm text-slate-600">'+(d.specialty||'-')+'</td>'+
      '<td class="px-4 py-3 text-center">'+infText(d.influence_level)+'</td>'+
      '<td class="px-4 py-3 text-center text-sm font-semibold text-slate-700">'+(d.meeting_count||0)+'</td>'+
      '<td class="px-4 py-3"><div class="text-sm text-slate-600">'+(d.last_meeting?fmtDateShort(d.last_meeting):'<span class="text-slate-300">-</span>')+'</div>'+(d.last_meeting?'<div class="text-[10px] text-slate-400">'+daysAgo(d.last_meeting)+'</div>':'')+'</td>'+
    '</tr>'
  ).join('');
}
function filterD(){const q=(document.getElementById('d-search')?.value||'').toLowerCase();renderDRows(docList.filter(d=>d.name.toLowerCase().includes(q)||(d.hospital_name||'').toLowerCase().includes(q)))}

// ===== MEETINGS PAGE =====
async function loadMeet(){
  document.getElementById('page-title').textContent='미팅 기록';
  document.getElementById('page-subtitle').textContent='전체 미팅 히스토리';
  try{
    const{data}=await API.get('/meetings');
    document.getElementById('content').innerHTML='<div class="p-6 fade-in"><div class="card p-0 overflow-hidden">'+
      (data.data.length?'<div class="divide-y divide-slate-50">'+data.data.map(m=>
        '<div class="px-5 py-4 table-row">'+
          '<div class="flex items-center gap-3 mb-2">'+
            avatar(m.doctor_photo,m.doctor_name,'avatar" style="width:32px;height:32px;font-size:12px')+
            '<div class="flex-1"><div class="flex items-center gap-2"><span class="font-semibold text-sm text-slate-800">'+(m.doctor_name||'-')+'</span><span class="text-xs text-slate-400">'+(m.hospital_name||'')+'</span>'+mtBadge(m.meeting_type)+'</div></div>'+
            '<span class="text-xs text-slate-400">'+fmtDate(m.meeting_date)+' <span class="text-slate-300 ml-1">'+daysAgo(m.meeting_date)+'</span></span>'+
          '</div>'+
          (m.purpose?'<div class="ml-11 text-sm font-medium text-slate-700 mb-1">'+m.purpose+'</div>':'')+
          (m.content?'<div class="ml-11 text-xs text-slate-500 leading-relaxed mb-1.5">'+m.content+'</div>':'')+
          '<div class="ml-11 flex flex-wrap gap-2">'+(m.result?'<span class="text-xs text-emerald-700 bg-emerald-50 rounded-md px-2 py-1"><i class="fas fa-check-circle mr-1"></i>'+m.result+'</span>':'')+(m.next_action?'<span class="text-xs text-amber-700 bg-amber-50 rounded-md px-2 py-1"><i class="fas fa-arrow-right mr-1"></i>'+m.next_action+'</span>':'')+'</div>'+
        '</div>'
      ).join('')+'</div>':'<div class="empty-state"><i class="fas fa-calendar-xmark block"></i><p>미팅 기록이 없습니다</p></div>')+
    '</div></div>';
  }catch(e){document.getElementById('content').innerHTML='<div class="p-6 text-red-500">로드 실패</div>'}
}

// ===== PHOTO UPLOAD =====
function triggerPhoto(docId,hospId){document.getElementById('photo-input-'+docId)?.click()}
async function uploadPhoto(docId,hospId,input){
  const file=input.files?.[0]; if(!file)return;
  if(file.size>2*1024*1024){alert('2MB 이하 이미지만 업로드 가능합니다.');return}
  const reader=new FileReader();
  reader.onload=async function(e){
    try{
      // Resize to 200x200
      const img=new Image();img.onload=async function(){
        const c=document.createElement('canvas');const sz=200;c.width=sz;c.height=sz;
        const ctx=c.getContext('2d');const min=Math.min(img.width,img.height);
        const sx=(img.width-min)/2,sy=(img.height-min)/2;
        ctx.drawImage(img,sx,sy,min,min,0,0,sz,sz);
        const b64=c.toDataURL('image/jpeg',0.8);
        await API.post('/doctors/'+docId+'/photo',{photo:b64});
        viewHosp(hospId);
      };img.src=e.target.result;
    }catch(err){alert('업로드 실패');}
  };reader.readAsDataURL(file);
}

// ===== FORMS =====
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
    '<div class="col-span-2 flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">'+(id?'수정 저장':'병원 추가')+'</button></div></form>');
  document.getElementById('fm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.name){alert('병원명을 입력하세요');return}try{if(id)await API.put('/hospitals/'+id,f);else await API.post('/hospitals',f);closeModal();if(id)viewHosp(id);else loadHosp()}catch(e){alert('저장 실패')}};
}

async function showDocForm(hospId,docId){
  let d={name:'',department:'이비인후과',position:'교수',phone:'',email:'',specialty:'',influence_level:'medium',notes:'',hospital_id:hospId};
  if(docId){try{const ds=(await API.get('/hospitals/'+hospId+'/doctors')).data.data;d=ds.find(x=>x.id===docId)||d}catch(e){}}
  openModal(docId?'교수 수정':'새 교수 추가',
    '<form id="fm" class="grid grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="'+hospId+'">'+
    field('이름 *','name','text',d.name)+field('진료과','department','text',d.department)+
    field('직위','position','text',d.position)+field('전화번호','phone','tel',d.phone)+
    field('이메일','email','email',d.email)+field('전문분야','specialty','text',d.specialty)+
    field('영향력','influence_level','select',d.influence_level,[{v:'high',l:'핵심 (High)'},{v:'medium',l:'주요 (Medium)'},{v:'low',l:'일반 (Low)'}])+
    '<div></div>'+
    field('메모','notes','textarea',d.notes)+
    '<div class="col-span-2 flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">'+(docId?'수정 저장':'교수 추가')+'</button></div></form>');
  document.getElementById('fm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.name){alert('이름을 입력하세요');return}try{if(docId)await API.put('/doctors/'+docId,f);else await API.post('/doctors',f);closeModal();viewHosp(hospId)}catch(e){alert('저장 실패')}};
}

async function showMeetForm(hospId,docId,meetId){
  let m={meeting_date:new Date().toISOString().split('T')[0],meeting_type:'visit',purpose:'',content:'',result:'',next_action:'',next_meeting_date:'',doctor_id:docId||'',hospital_id:hospId};
  if(meetId){try{const ms=(await API.get('/meetings?hospital_id='+hospId)).data.data;m=ms.find(x=>x.id===meetId)||m}catch(e){}}
  let docs=[];try{docs=(await API.get('/hospitals/'+hospId+'/doctors')).data.data}catch(e){}
  const dOpts=[{v:'',l:'-- 교수 선택 --'}].concat(docs.map(d=>({v:d.id,l:d.name+' ('+(d.position||'')+')'})));
  openModal(meetId?'미팅 수정':'새 미팅 기록',
    '<form id="fm" class="grid grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="'+hospId+'">'+
    field('교수 *','doctor_id','select',m.doctor_id||docId||'',dOpts)+field('미팅일자 *','meeting_date','date',m.meeting_date)+
    field('유형','meeting_type','select',m.meeting_type,[{v:'visit',l:'방문'},{v:'phone',l:'전화'},{v:'conference',l:'학회'},{v:'email',l:'이메일'},{v:'online',l:'온라인'}])+
    field('목적','purpose','text',m.purpose)+
    field('내용','content','textarea',m.content)+field('결과','result','textarea',m.result)+field('후속 액션','next_action','textarea',m.next_action)+
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="'+(m.next_meeting_date||'')+'" class="input"></div>'+
    '<div class="col-span-2 flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">'+(meetId?'수정 저장':'미팅 추가')+'</button></div></form>');
  document.getElementById('fm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(!f.doctor_id){alert('교수를 선택하세요');return}if(!f.meeting_date){alert('미팅일자를 입력하세요');return}try{if(meetId)await API.put('/meetings/'+meetId,f);else await API.post('/meetings',f);closeModal();viewHosp(hospId)}catch(e){alert('저장 실패')}};
}

// ===== DELETE =====
async function delHosp(id){if(!confirm('이 병원 및 관련 모든 데이터가 삭제됩니다. 계속하시겠습니까?'))return;try{await API.delete('/hospitals/'+id);nav('hospitals')}catch(e){alert('삭제 실패')}}
async function delDoc(id,hid){if(!confirm('이 교수 및 관련 미팅 기록이 삭제됩니다.'))return;try{await API.delete('/doctors/'+id);viewHosp(hid)}catch(e){alert('삭제 실패')}}
async function delMeet(id,hid){if(!confirm('이 미팅 기록을 삭제하시겠습니까?'))return;try{await API.delete('/meetings/'+id);viewHosp(hid)}catch(e){alert('삭제 실패')}}

// Init
nav('dashboard');
</script>
</body>
</html>`

export default app
