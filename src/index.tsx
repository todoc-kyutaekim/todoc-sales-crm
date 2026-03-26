import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// ===== 병원 API =====
app.get('/api/hospitals', async (c) => {
  const { region, status, search } = c.req.query()
  let query = 'SELECT h.*, COUNT(d.id) as doctor_count, MAX(m.meeting_date) as last_meeting FROM hospitals h LEFT JOIN doctors d ON h.id = d.hospital_id LEFT JOIN meetings m ON h.id = m.hospital_id'
  const conditions: string[] = []
  const params: any[] = []

  if (region) { conditions.push('h.region = ?'); params.push(region) }
  if (status) { conditions.push('h.status = ?'); params.push(status) }
  if (search) { conditions.push('h.name LIKE ?'); params.push(`%${search}%`) }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
  query += ' GROUP BY h.id ORDER BY h.grade ASC, h.name ASC'

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ data: result.results })
})

app.get('/api/hospitals/:id', async (c) => {
  const id = c.req.param('id')
  const hospital = await c.env.DB.prepare('SELECT * FROM hospitals WHERE id = ?').bind(id).first()
  if (!hospital) return c.json({ error: 'Not found' }, 404)
  return c.json({ data: hospital })
})

app.post('/api/hospitals', async (c) => {
  const body = await c.req.json()
  const { name, region, address, phone, grade, notes, status } = body
  const result = await c.env.DB.prepare(
    'INSERT INTO hospitals (name, region, address, phone, grade, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(name, region || '', address || '', phone || '', grade || 'A', notes || '', status || 'active').run()
  return c.json({ data: { id: result.meta.last_row_id, ...body } }, 201)
})

app.put('/api/hospitals/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, region, address, phone, grade, notes, status } = body
  await c.env.DB.prepare(
    'UPDATE hospitals SET name=?, region=?, address=?, phone=?, grade=?, notes=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(name, region || '', address || '', phone || '', grade || 'A', notes || '', status || 'active', id).run()
  return c.json({ data: { id: Number(id), ...body } })
})

app.delete('/api/hospitals/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM hospitals WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// ===== 교수 API =====
app.get('/api/hospitals/:hospitalId/doctors', async (c) => {
  const hospitalId = c.req.param('hospitalId')
  const result = await c.env.DB.prepare(
    'SELECT d.*, MAX(m.meeting_date) as last_meeting, COUNT(m.id) as meeting_count FROM doctors d LEFT JOIN meetings m ON d.id = m.doctor_id WHERE d.hospital_id = ? GROUP BY d.id ORDER BY d.influence_level DESC, d.name ASC'
  ).bind(hospitalId).all()
  return c.json({ data: result.results })
})

app.get('/api/doctors', async (c) => {
  const { search } = c.req.query()
  let query = 'SELECT d.*, h.name as hospital_name, MAX(m.meeting_date) as last_meeting, COUNT(m.id) as meeting_count FROM doctors d LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN meetings m ON d.id = m.doctor_id'
  const params: any[] = []
  if (search) { query += ' WHERE d.name LIKE ? OR h.name LIKE ?'; params.push(`%${search}%`, `%${search}%`) }
  query += ' GROUP BY d.id ORDER BY d.name ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ data: result.results })
})

app.post('/api/doctors', async (c) => {
  const body = await c.req.json()
  const { hospital_id, name, department, position, phone, email, specialty, influence_level, notes } = body
  const result = await c.env.DB.prepare(
    'INSERT INTO doctors (hospital_id, name, department, position, phone, email, specialty, influence_level, notes) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(hospital_id, name, department || '', position || '', phone || '', email || '', specialty || '', influence_level || 'medium', notes || '').run()
  return c.json({ data: { id: result.meta.last_row_id, ...body } }, 201)
})

app.put('/api/doctors/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { hospital_id, name, department, position, phone, email, specialty, influence_level, notes } = body
  await c.env.DB.prepare(
    'UPDATE doctors SET hospital_id=?, name=?, department=?, position=?, phone=?, email=?, specialty=?, influence_level=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(hospital_id, name, department || '', position || '', phone || '', email || '', specialty || '', influence_level || 'medium', notes || '', id).run()
  return c.json({ data: { id: Number(id), ...body } })
})

app.delete('/api/doctors/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM doctors WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// ===== 미팅 API =====
app.get('/api/meetings', async (c) => {
  const { doctor_id, hospital_id, limit } = c.req.query()
  let query = 'SELECT m.*, d.name as doctor_name, h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id = d.id LEFT JOIN hospitals h ON m.hospital_id = h.id'
  const conditions: string[] = []
  const params: any[] = []

  if (doctor_id) { conditions.push('m.doctor_id = ?'); params.push(doctor_id) }
  if (hospital_id) { conditions.push('m.hospital_id = ?'); params.push(hospital_id) }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
  query += ' ORDER BY m.meeting_date DESC'
  if (limit) query += ` LIMIT ${parseInt(limit)}`

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ data: result.results })
})

app.post('/api/meetings', async (c) => {
  const body = await c.req.json()
  const { doctor_id, hospital_id, meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date } = body
  const res = await c.env.DB.prepare(
    'INSERT INTO meetings (doctor_id, hospital_id, meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(doctor_id, hospital_id, meeting_date, meeting_type || 'visit', purpose || '', content || '', result || '', next_action || '', next_meeting_date || null).run()
  return c.json({ data: { id: res.meta.last_row_id, ...body } }, 201)
})

app.put('/api/meetings/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { doctor_id, hospital_id, meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date } = body
  await c.env.DB.prepare(
    'UPDATE meetings SET doctor_id=?, hospital_id=?, meeting_date=?, meeting_type=?, purpose=?, content=?, result=?, next_action=?, next_meeting_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
  ).bind(doctor_id, hospital_id, meeting_date, meeting_type || 'visit', purpose || '', content || '', result || '', next_action || '', next_meeting_date || null, id).run()
  return c.json({ data: { id: Number(id), ...body } })
})

app.delete('/api/meetings/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(id).run()
  return c.json({ success: true })
})

// ===== 대시보드 통계 API =====
app.get('/api/dashboard', async (c) => {
  const [hospitals, doctors, meetings, recentMeetings, upcomingActions] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM hospitals WHERE status = "active"').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM doctors').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM meetings').first(),
    c.env.DB.prepare(
      'SELECT m.*, d.name as doctor_name, h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id = d.id LEFT JOIN hospitals h ON m.hospital_id = h.id ORDER BY m.meeting_date DESC LIMIT 5'
    ).all(),
    c.env.DB.prepare(
      "SELECT m.*, d.name as doctor_name, h.name as hospital_name FROM meetings m LEFT JOIN doctors d ON m.doctor_id = d.id LEFT JOIN hospitals h ON m.hospital_id = h.id WHERE m.next_action != '' AND m.next_action IS NOT NULL ORDER BY m.next_meeting_date ASC LIMIT 10"
    ).all(),
  ])

  return c.json({
    data: {
      stats: {
        hospitals: (hospitals as any)?.count || 0,
        doctors: (doctors as any)?.count || 0,
        meetings: (meetings as any)?.count || 0,
      },
      recentMeetings: recentMeetings.results,
      upcomingActions: upcomingActions.results,
    }
  })
})

// ===== 지역 목록 =====
app.get('/api/regions', async (c) => {
  const result = await c.env.DB.prepare('SELECT DISTINCT region FROM hospitals WHERE region != "" ORDER BY region').all()
  return c.json({ data: result.results.map((r: any) => r.region) })
})

// ===== 메인 페이지 (SPA) =====
app.get('*', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TODOC CRM - 병원 영업 관리</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            todoc: { 50:'#eff6ff', 100:'#dbeafe', 200:'#bfdbfe', 300:'#93c5fd', 400:'#60a5fa', 500:'#3b82f6', 600:'#2563eb', 700:'#1d4ed8', 800:'#1e3a5f', 900:'#0f2440' }
          }
        }
      }
    }
  </script>
  <style>
    .fade-in { animation: fadeIn 0.3s ease-in; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
    .modal-overlay { background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
    .grade-S { background: linear-gradient(135deg, #f59e0b, #d97706); }
    .grade-A { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .grade-B { background: linear-gradient(135deg, #10b981, #059669); }
    .grade-C { background: linear-gradient(135deg, #6b7280, #4b5563); }
    .influence-high { color: #dc2626; font-weight: 700; }
    .influence-medium { color: #f59e0b; font-weight: 600; }
    .influence-low { color: #6b7280; }
    .sidebar-link { transition: all 0.2s; }
    .sidebar-link:hover, .sidebar-link.active { background: rgba(255,255,255,0.15); border-left: 3px solid #60a5fa; }
    ::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-track { background:#f1f5f9; } ::-webkit-scrollbar-thumb { background:#94a3b8; border-radius:3px; }
    .tag { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:0.75rem; font-weight:500; }
  </style>
</head>
<body class="bg-gray-50 h-screen overflow-hidden">
  <div class="flex h-screen">
    <!-- Sidebar -->
    <aside class="w-64 bg-todoc-900 text-white flex flex-col flex-shrink-0">
      <div class="p-5 border-b border-todoc-800">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-todoc-500 rounded-lg flex items-center justify-center font-bold text-lg">T</div>
          <div>
            <h1 class="font-bold text-lg leading-tight">TODOC</h1>
            <p class="text-xs text-todoc-300">병원 영업 관리 시스템</p>
          </div>
        </div>
      </div>
      <nav class="flex-1 py-4">
        <a href="#" onclick="navigate('dashboard')" id="nav-dashboard" class="sidebar-link flex items-center gap-3 px-5 py-3 text-sm text-todoc-200 hover:text-white">
          <i class="fas fa-chart-pie w-5 text-center"></i> 대시보드
        </a>
        <a href="#" onclick="navigate('hospitals')" id="nav-hospitals" class="sidebar-link flex items-center gap-3 px-5 py-3 text-sm text-todoc-200 hover:text-white">
          <i class="fas fa-hospital w-5 text-center"></i> 병원 관리
        </a>
        <a href="#" onclick="navigate('doctors')" id="nav-doctors" class="sidebar-link flex items-center gap-3 px-5 py-3 text-sm text-todoc-200 hover:text-white">
          <i class="fas fa-user-md w-5 text-center"></i> 교수 관리
        </a>
        <a href="#" onclick="navigate('meetings')" id="nav-meetings" class="sidebar-link flex items-center gap-3 px-5 py-3 text-sm text-todoc-200 hover:text-white">
          <i class="fas fa-calendar-check w-5 text-center"></i> 미팅 기록
        </a>
      </nav>
      <div class="p-4 border-t border-todoc-800 text-xs text-todoc-400">
        <p>&copy; 2026 TODOC Inc.</p>
        <p>인공와우 전문기업</p>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <header class="bg-white shadow-sm border-b px-6 py-4 flex items-center justify-between flex-shrink-0">
        <h2 id="page-title" class="text-xl font-bold text-gray-800">대시보드</h2>
        <div class="flex items-center gap-3">
          <div id="header-actions"></div>
        </div>
      </header>
      <div id="content" class="flex-1 overflow-y-auto p-6"></div>
    </main>
  </div>

  <!-- Modal -->
  <div id="modal" class="fixed inset-0 modal-overlay z-50 hidden flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      <div id="modal-header" class="px-6 py-4 border-b flex items-center justify-between">
        <h3 id="modal-title" class="text-lg font-bold text-gray-800"></h3>
        <button onclick="closeModal()" class="text-gray-400 hover:text-gray-600 text-xl"><i class="fas fa-times"></i></button>
      </div>
      <div id="modal-body" class="p-6"></div>
    </div>
  </div>

  <script>
  // ===== State =====
  let currentPage = 'dashboard';
  let hospitalsList = [];
  let doctorsList = [];

  // ===== Navigation =====
  function navigate(page) {
    currentPage = page;
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-' + page)?.classList.add('active');
    const titles = { dashboard:'대시보드', hospitals:'병원 관리', doctors:'교수 관리', meetings:'미팅 기록' };
    document.getElementById('page-title').textContent = titles[page] || '';
    document.getElementById('header-actions').innerHTML = '';
    
    const loaders = { dashboard: loadDashboard, hospitals: loadHospitals, doctors: loadDoctors, meetings: loadMeetings };
    (loaders[page] || loaders.dashboard)();
  }

  // ===== Modal =====
  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
  }
  function closeModal() { document.getElementById('modal').classList.add('hidden'); }

  // ===== Helpers =====
  function formatDate(d) { if (!d) return '-'; const dt = new Date(d); return dt.toLocaleDateString('ko-KR'); }
  function gradeTag(g) { return '<span class="tag text-white grade-' + g + '">' + g + '급</span>'; }
  function influenceTag(l) { const labels = {high:'핵심',medium:'주요',low:'일반'}; return '<span class="influence-' + l + '">' + (labels[l]||l) + '</span>'; }
  function meetingTypeTag(t) {
    const colors = {visit:'bg-blue-100 text-blue-700', phone:'bg-green-100 text-green-700', conference:'bg-purple-100 text-purple-700', email:'bg-yellow-100 text-yellow-700', online:'bg-indigo-100 text-indigo-700'};
    const labels = {visit:'방문',phone:'전화',conference:'학회',email:'이메일',online:'온라인'};
    return '<span class="tag ' + (colors[t]||'bg-gray-100 text-gray-700') + '">' + (labels[t]||t) + '</span>';
  }
  function statusTag(s) { return s==='active' ? '<span class="tag bg-green-100 text-green-700">활성</span>' : '<span class="tag bg-gray-100 text-gray-500">비활성</span>'; }

  // ===== DASHBOARD =====
  async function loadDashboard() {
    document.getElementById('header-actions').innerHTML = '';
    try {
      const { data } = await axios.get('/api/dashboard');
      const d = data.data;
      document.getElementById('content').innerHTML = \`
        <div class="fade-in space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="navigate('hospitals')">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-500 mb-1">관리 병원</p>
                  <p class="text-3xl font-bold text-todoc-700">\${d.stats.hospitals}</p>
                </div>
                <div class="w-12 h-12 bg-todoc-50 rounded-xl flex items-center justify-center"><i class="fas fa-hospital text-todoc-500 text-xl"></i></div>
              </div>
            </div>
            <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="navigate('doctors')">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-500 mb-1">등록 교수</p>
                  <p class="text-3xl font-bold text-blue-600">\${d.stats.doctors}</p>
                </div>
                <div class="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center"><i class="fas fa-user-md text-blue-500 text-xl"></i></div>
              </div>
            </div>
            <div class="bg-white rounded-xl shadow-sm p-6 border border-gray-100 hover:shadow-md transition cursor-pointer" onclick="navigate('meetings')">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm text-gray-500 mb-1">총 미팅</p>
                  <p class="text-3xl font-bold text-green-600">\${d.stats.meetings}</p>
                </div>
                <div class="w-12 h-12 bg-green-50 rounded-xl flex items-center justify-center"><i class="fas fa-calendar-check text-green-500 text-xl"></i></div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div class="px-6 py-4 border-b bg-gray-50 flex items-center gap-2"><i class="fas fa-clock text-todoc-500"></i><h3 class="font-bold text-gray-800">최근 미팅</h3></div>
              <div class="divide-y">\${d.recentMeetings.length === 0 ? '<p class="p-6 text-gray-400 text-center">미팅 기록이 없습니다</p>' : d.recentMeetings.map(m => \`
                <div class="px-6 py-4 hover:bg-gray-50 transition">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-semibold text-gray-800">\${m.doctor_name} <span class="text-sm text-gray-400 font-normal">(\${m.hospital_name})</span></span>
                    <span class="text-sm text-gray-500">\${formatDate(m.meeting_date)}</span>
                  </div>
                  <div class="flex items-center gap-2">\${meetingTypeTag(m.meeting_type)}<span class="text-sm text-gray-600">\${m.purpose}</span></div>
                </div>
              \`).join('')}</div>
            </div>

            <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div class="px-6 py-4 border-b bg-gray-50 flex items-center gap-2"><i class="fas fa-tasks text-orange-500"></i><h3 class="font-bold text-gray-800">후속 액션</h3></div>
              <div class="divide-y">\${d.upcomingActions.length === 0 ? '<p class="p-6 text-gray-400 text-center">후속 액션이 없습니다</p>' : d.upcomingActions.map(m => \`
                <div class="px-6 py-4 hover:bg-gray-50 transition">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-semibold text-gray-800">\${m.doctor_name}</span>
                    \${m.next_meeting_date ? '<span class="text-sm text-orange-600"><i class="fas fa-calendar mr-1"></i>' + formatDate(m.next_meeting_date) + '</span>' : ''}
                  </div>
                  <p class="text-sm text-gray-600"><i class="fas fa-arrow-right text-orange-400 mr-1"></i>\${m.next_action}</p>
                </div>
              \`).join('')}</div>
            </div>
          </div>
        </div>
      \`;
    } catch(e) { document.getElementById('content').innerHTML = '<p class="text-red-500">데이터를 불러오지 못했습니다.</p>'; }
  }

  // ===== HOSPITALS =====
  async function loadHospitals() {
    document.getElementById('header-actions').innerHTML = '<button onclick="showHospitalForm()" class="bg-todoc-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-todoc-700 transition"><i class="fas fa-plus mr-1"></i>병원 추가</button>';
    try {
      const { data } = await axios.get('/api/hospitals');
      hospitalsList = data.data;
      renderHospitals(hospitalsList);
    } catch(e) { document.getElementById('content').innerHTML = '<p class="text-red-500">병원 목록을 불러오지 못했습니다.</p>'; }
  }

  function renderHospitals(list) {
    document.getElementById('content').innerHTML = \`
      <div class="fade-in">
        <div class="mb-5 flex flex-wrap gap-3">
          <input type="text" id="hospital-search" placeholder="병원명 검색..." oninput="filterHospitals()" class="border rounded-lg px-4 py-2 text-sm w-64 focus:ring-2 focus:ring-todoc-300 focus:border-todoc-500 outline-none">
          <select id="hospital-region-filter" onchange="filterHospitals()" class="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-todoc-300 outline-none">
            <option value="">전체 지역</option>
          </select>
          <select id="hospital-grade-filter" onchange="filterHospitals()" class="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-todoc-300 outline-none">
            <option value="">전체 등급</option><option value="S">S급</option><option value="A">A급</option><option value="B">B급</option><option value="C">C급</option>
          </select>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" id="hospitals-grid">
          \${list.map(h => hospitalCard(h)).join('')}
        </div>
        \${list.length === 0 ? '<p class="text-gray-400 text-center py-12">등록된 병원이 없습니다.</p>' : ''}
      </div>
    \`;
    loadRegionFilter();
  }

  function hospitalCard(h) {
    return \`
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer overflow-hidden" onclick="viewHospital(\${h.id})">
        <div class="p-5">
          <div class="flex items-start justify-between mb-3">
            <div class="flex-1 min-w-0">
              <h3 class="font-bold text-gray-900 text-lg truncate">\${h.name}</h3>
              <p class="text-sm text-gray-500 mt-0.5"><i class="fas fa-map-marker-alt mr-1"></i>\${h.region || '-'}</p>
            </div>
            <div class="flex items-center gap-2 ml-2">\${gradeTag(h.grade)} \${statusTag(h.status)}</div>
          </div>
          <div class="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div class="bg-gray-50 rounded-lg p-2.5 text-center"><p class="text-gray-400 text-xs">교수</p><p class="font-bold text-todoc-700">\${h.doctor_count || 0}명</p></div>
            <div class="bg-gray-50 rounded-lg p-2.5 text-center"><p class="text-gray-400 text-xs">최근 미팅</p><p class="font-bold text-gray-700 text-xs">\${h.last_meeting ? formatDate(h.last_meeting) : '없음'}</p></div>
          </div>
          \${h.notes ? '<p class="text-xs text-gray-500 mt-3 line-clamp-2">' + h.notes + '</p>' : ''}
        </div>
      </div>
    \`;
  }

  async function loadRegionFilter() {
    try {
      const { data } = await axios.get('/api/regions');
      const sel = document.getElementById('hospital-region-filter');
      if(sel) data.data.forEach(r => { const o=document.createElement('option'); o.value=r; o.textContent=r; sel.appendChild(o); });
    } catch(e) {}
  }

  function filterHospitals() {
    const search = (document.getElementById('hospital-search')?.value || '').toLowerCase();
    const region = document.getElementById('hospital-region-filter')?.value || '';
    const grade = document.getElementById('hospital-grade-filter')?.value || '';
    let filtered = hospitalsList.filter(h => {
      if (search && !h.name.toLowerCase().includes(search)) return false;
      if (region && h.region !== region) return false;
      if (grade && h.grade !== grade) return false;
      return true;
    });
    const grid = document.getElementById('hospitals-grid');
    if (grid) grid.innerHTML = filtered.map(h => hospitalCard(h)).join('') || '<p class="text-gray-400 text-center py-12 col-span-full">검색 결과가 없습니다.</p>';
  }

  // ===== Hospital Detail =====
  async function viewHospital(id) {
    try {
      const [hRes, dRes, mRes] = await Promise.all([
        axios.get('/api/hospitals/' + id),
        axios.get('/api/hospitals/' + id + '/doctors'),
        axios.get('/api/meetings?hospital_id=' + id)
      ]);
      const h = hRes.data.data;
      const doctors = dRes.data.data;
      const meetings = mRes.data.data;
      
      document.getElementById('page-title').textContent = h.name;
      document.getElementById('header-actions').innerHTML = \`
        <button onclick="showDoctorForm(\${h.id})" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition mr-2"><i class="fas fa-user-plus mr-1"></i>교수 추가</button>
        <button onclick="showMeetingForm(\${h.id})" class="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition mr-2"><i class="fas fa-plus mr-1"></i>미팅 추가</button>
        <button onclick="showHospitalForm(\${h.id})" class="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition mr-2"><i class="fas fa-edit mr-1"></i>수정</button>
        <button onclick="deleteHospital(\${h.id})" class="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm hover:bg-red-100 transition"><i class="fas fa-trash mr-1"></i>삭제</button>
      \`;

      document.getElementById('content').innerHTML = \`
        <div class="fade-in space-y-6">
          <div class="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <a href="#" onclick="navigate('hospitals')" class="hover:text-todoc-600">병원 관리</a>
            <i class="fas fa-chevron-right text-xs"></i>
            <span class="text-gray-800 font-medium">\${h.name}</span>
          </div>

          <div class="bg-white rounded-xl shadow-sm border p-6">
            <div class="flex flex-wrap items-center gap-3 mb-4">
              <h3 class="text-xl font-bold text-gray-900">\${h.name}</h3>
              \${gradeTag(h.grade)} \${statusTag(h.status)}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div><span class="text-gray-400">지역:</span> <span class="text-gray-800 ml-1">\${h.region||'-'}</span></div>
              <div><span class="text-gray-400">주소:</span> <span class="text-gray-800 ml-1">\${h.address||'-'}</span></div>
              <div><span class="text-gray-400">전화:</span> <span class="text-gray-800 ml-1">\${h.phone||'-'}</span></div>
            </div>
            \${h.notes ? '<p class="text-sm text-gray-600 mt-3 bg-gray-50 rounded-lg p-3"><i class="fas fa-sticky-note text-yellow-400 mr-1"></i>' + h.notes + '</p>' : ''}
          </div>

          <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <h3 class="font-bold text-gray-800"><i class="fas fa-user-md text-blue-500 mr-2"></i>소속 교수 (\${doctors.length})</h3>
            </div>
            <div class="divide-y">\${doctors.length === 0 ? '<p class="p-6 text-gray-400 text-center">등록된 교수가 없습니다.</p>' : doctors.map(d => \`
              <div class="px-6 py-4 hover:bg-gray-50 transition flex items-center justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-semibold text-gray-900">\${d.name}</span>
                    <span class="text-sm text-gray-500">\${d.position || ''}</span>
                    \${influenceTag(d.influence_level)}
                  </div>
                  <div class="text-sm text-gray-500 flex flex-wrap gap-3">
                    \${d.department ? '<span><i class="fas fa-stethoscope mr-1"></i>' + d.department + '</span>' : ''}
                    \${d.specialty ? '<span><i class="fas fa-star mr-1"></i>' + d.specialty + '</span>' : ''}
                    <span><i class="fas fa-calendar mr-1"></i>미팅 \${d.meeting_count||0}회 \${d.last_meeting ? '(최근 ' + formatDate(d.last_meeting) + ')' : ''}</span>
                  </div>
                </div>
                <div class="flex gap-1 ml-3">
                  <button onclick="event.stopPropagation();showMeetingForm(\${h.id},\${d.id})" class="text-green-600 hover:bg-green-50 px-2 py-1 rounded text-sm" title="미팅 추가"><i class="fas fa-plus-circle"></i></button>
                  <button onclick="event.stopPropagation();showDoctorForm(\${h.id},\${d.id})" class="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-sm" title="수정"><i class="fas fa-edit"></i></button>
                  <button onclick="event.stopPropagation();deleteDoctor(\${d.id},\${h.id})" class="text-red-400 hover:bg-red-50 px-2 py-1 rounded text-sm" title="삭제"><i class="fas fa-trash"></i></button>
                </div>
              </div>
            \`).join('')}</div>
          </div>

          <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="px-6 py-4 border-b bg-gray-50 flex items-center justify-between">
              <h3 class="font-bold text-gray-800"><i class="fas fa-calendar-check text-green-500 mr-2"></i>미팅 기록 (\${meetings.length})</h3>
            </div>
            <div class="divide-y">\${meetings.length === 0 ? '<p class="p-6 text-gray-400 text-center">미팅 기록이 없습니다.</p>' : meetings.map(m => \`
              <div class="px-6 py-4 hover:bg-gray-50 transition">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="font-semibold text-gray-900">\${m.doctor_name||'-'}</span>
                    \${meetingTypeTag(m.meeting_type)}
                    <span class="text-sm text-gray-500">\${formatDate(m.meeting_date)}</span>
                  </div>
                  <div class="flex gap-1">
                    <button onclick="showMeetingForm(\${h.id}, \${m.doctor_id}, \${m.id})" class="text-blue-500 hover:bg-blue-50 px-2 py-1 rounded text-sm"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteMeeting(\${m.id},\${h.id})" class="text-red-400 hover:bg-red-50 px-2 py-1 rounded text-sm"><i class="fas fa-trash"></i></button>
                  </div>
                </div>
                \${m.purpose ? '<p class="text-sm font-medium text-gray-700 mb-1"><i class="fas fa-bullseye text-todoc-400 mr-1"></i>' + m.purpose + '</p>' : ''}
                \${m.content ? '<p class="text-sm text-gray-600 mb-1">' + m.content + '</p>' : ''}
                \${m.result ? '<p class="text-sm text-green-700 mb-1"><i class="fas fa-check-circle mr-1"></i>' + m.result + '</p>' : ''}
                \${m.next_action ? '<p class="text-sm text-orange-600"><i class="fas fa-arrow-right mr-1"></i>후속: ' + m.next_action + (m.next_meeting_date ? ' (' + formatDate(m.next_meeting_date) + ')' : '') + '</p>' : ''}
              </div>
            \`).join('')}</div>
          </div>
        </div>
      \`;
    } catch(e) { console.error(e); }
  }

  // ===== FORMS =====
  function formField(label, name, type, value, options) {
    if(type === 'select') {
      return '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + label + '</label><select name="' + name + '" class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-todoc-300 outline-none">' + options.map(o => '<option value="' + o.value + '" ' + (o.value==value?'selected':'') + '>' + o.label + '</option>').join('') + '</select></div>';
    }
    if(type === 'textarea') {
      return '<div class="md:col-span-2"><label class="block text-sm font-medium text-gray-700 mb-1">' + label + '</label><textarea name="' + name + '" rows="3" class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-todoc-300 outline-none">' + (value||'') + '</textarea></div>';
    }
    return '<div><label class="block text-sm font-medium text-gray-700 mb-1">' + label + '</label><input type="' + type + '" name="' + name + '" value="' + (value||'') + '" class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-todoc-300 outline-none"></div>';
  }

  async function showHospitalForm(id) {
    let h = {name:'',region:'',address:'',phone:'',grade:'A',notes:'',status:'active'};
    if(id) { try { h = (await axios.get('/api/hospitals/' + id)).data.data; } catch(e){} }
    const grades = [{value:'S',label:'S급 (최상위)'},{value:'A',label:'A급 (주요)'},{value:'B',label:'B급 (일반)'},{value:'C',label:'C급 (기타)'}];
    const statuses = [{value:'active',label:'활성'},{value:'inactive',label:'비활성'}];
    openModal(id ? '병원 수정' : '병원 추가', \`
      <form id="hospital-form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        \${formField('병원명 *','name','text',h.name)}
        \${formField('지역','region','text',h.region)}
        \${formField('주소','address','text',h.address)}
        \${formField('전화번호','phone','text',h.phone)}
        \${formField('등급','grade','select',h.grade,grades)}
        \${formField('상태','status','select',h.status,statuses)}
        \${formField('메모','notes','textarea',h.notes)}
        <div class="md:col-span-2 flex justify-end gap-2 mt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">취소</button>
          <button type="submit" class="px-6 py-2 bg-todoc-600 text-white rounded-lg text-sm hover:bg-todoc-700">\${id?'수정':'추가'}</button>
        </div>
      </form>
    \`);
    document.getElementById('hospital-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if(!body.name) { alert('병원명을 입력하세요.'); return; }
      try {
        if(id) await axios.put('/api/hospitals/' + id, body);
        else await axios.post('/api/hospitals', body);
        closeModal(); loadHospitals();
      } catch(e) { alert('저장 실패'); }
    };
  }

  async function showDoctorForm(hospitalId, doctorId) {
    let d = {name:'',department:'이비인후과',position:'교수',phone:'',email:'',specialty:'',influence_level:'medium',notes:'',hospital_id:hospitalId};
    if(doctorId) { try { const docs = (await axios.get('/api/hospitals/' + hospitalId + '/doctors')).data.data; d = docs.find(x=>x.id===doctorId)||d; } catch(e){} }
    const levels = [{value:'high',label:'핵심 (High)'},{value:'medium',label:'주요 (Medium)'},{value:'low',label:'일반 (Low)'}];
    openModal(doctorId ? '교수 수정' : '교수 추가', \`
      <form id="doctor-form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="hospital_id" value="\${hospitalId}">
        \${formField('이름 *','name','text',d.name)}
        \${formField('진료과','department','text',d.department)}
        \${formField('직위','position','text',d.position)}
        \${formField('전화번호','phone','text',d.phone)}
        \${formField('이메일','email','email',d.email)}
        \${formField('전문분야','specialty','text',d.specialty)}
        \${formField('영향력','influence_level','select',d.influence_level,levels)}
        \${formField('메모','notes','textarea',d.notes)}
        <div class="md:col-span-2 flex justify-end gap-2 mt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">취소</button>
          <button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">\${doctorId?'수정':'추가'}</button>
        </div>
      </form>
    \`);
    document.getElementById('doctor-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if(!body.name) { alert('이름을 입력하세요.'); return; }
      try {
        if(doctorId) await axios.put('/api/doctors/' + doctorId, body);
        else await axios.post('/api/doctors', body);
        closeModal(); viewHospital(hospitalId);
      } catch(e) { alert('저장 실패'); }
    };
  }

  async function showMeetingForm(hospitalId, doctorId, meetingId) {
    let m = {meeting_date:new Date().toISOString().split('T')[0],meeting_type:'visit',purpose:'',content:'',result:'',next_action:'',next_meeting_date:'',doctor_id:doctorId||'',hospital_id:hospitalId};
    if(meetingId) { try { const ms = (await axios.get('/api/meetings?hospital_id=' + hospitalId)).data.data; m = ms.find(x=>x.id===meetingId)||m; } catch(e){} }
    
    let doctors = [];
    try { doctors = (await axios.get('/api/hospitals/' + hospitalId + '/doctors')).data.data; } catch(e){}
    
    const types = [{value:'visit',label:'방문'},{value:'phone',label:'전화'},{value:'conference',label:'학회'},{value:'email',label:'이메일'},{value:'online',label:'온라인'}];
    const doctorOptions = [{value:'',label:'선택하세요'}].concat(doctors.map(d => ({value:d.id, label:d.name + ' (' + (d.position||'') + ')'})));
    
    openModal(meetingId ? '미팅 수정' : '미팅 기록 추가', \`
      <form id="meeting-form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input type="hidden" name="hospital_id" value="\${hospitalId}">
        \${formField('교수 *','doctor_id','select',m.doctor_id||doctorId||'',doctorOptions)}
        \${formField('미팅일자 *','meeting_date','date',m.meeting_date)}
        \${formField('유형','meeting_type','select',m.meeting_type,types)}
        \${formField('목적','purpose','text',m.purpose)}
        \${formField('내용','content','textarea',m.content)}
        \${formField('결과','result','textarea',m.result)}
        \${formField('후속 액션','next_action','textarea',m.next_action)}
        <div><label class="block text-sm font-medium text-gray-700 mb-1">다음 미팅 예정일</label><input type="date" name="next_meeting_date" value="\${m.next_meeting_date||''}" class="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-todoc-300 outline-none"></div>
        <div class="md:col-span-2 flex justify-end gap-2 mt-2">
          <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">취소</button>
          <button type="submit" class="px-6 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">\${meetingId?'수정':'추가'}</button>
        </div>
      </form>
    \`);
    document.getElementById('meeting-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if(!body.doctor_id) { alert('교수를 선택하세요.'); return; }
      if(!body.meeting_date) { alert('미팅일자를 입력하세요.'); return; }
      try {
        if(meetingId) await axios.put('/api/meetings/' + meetingId, body);
        else await axios.post('/api/meetings', body);
        closeModal(); viewHospital(hospitalId);
      } catch(e) { alert('저장 실패'); }
    };
  }

  // ===== DOCTORS PAGE =====
  async function loadDoctors() {
    document.getElementById('header-actions').innerHTML = '';
    try {
      const { data } = await axios.get('/api/doctors');
      doctorsList = data.data;
      document.getElementById('content').innerHTML = \`
        <div class="fade-in">
          <div class="mb-5">
            <input type="text" placeholder="교수명 또는 병원명 검색..." oninput="filterDoctorsPage(this.value)" class="border rounded-lg px-4 py-2 text-sm w-80 focus:ring-2 focus:ring-todoc-300 outline-none">
          </div>
          <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-gray-50"><tr>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">이름</th>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">소속 병원</th>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">진료과</th>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">전문분야</th>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">영향력</th>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">미팅</th>
                <th class="px-5 py-3 text-left font-semibold text-gray-600">최근 미팅</th>
              </tr></thead>
              <tbody class="divide-y" id="doctors-tbody">
                \${doctorsList.map(d => \`
                  <tr class="hover:bg-gray-50 cursor-pointer" onclick="viewHospital(\${d.hospital_id})">
                    <td class="px-5 py-3 font-semibold text-gray-900">\${d.name}<br><span class="text-xs text-gray-400">\${d.position||''}</span></td>
                    <td class="px-5 py-3 text-gray-700">\${d.hospital_name||'-'}</td>
                    <td class="px-5 py-3 text-gray-600">\${d.department||'-'}</td>
                    <td class="px-5 py-3 text-gray-600">\${d.specialty||'-'}</td>
                    <td class="px-5 py-3">\${influenceTag(d.influence_level)}</td>
                    <td class="px-5 py-3 text-gray-600">\${d.meeting_count||0}회</td>
                    <td class="px-5 py-3 text-gray-600">\${d.last_meeting ? formatDate(d.last_meeting) : '-'}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
    } catch(e) { document.getElementById('content').innerHTML = '<p class="text-red-500">교수 목록을 불러오지 못했습니다.</p>'; }
  }

  function filterDoctorsPage(query) {
    const q = query.toLowerCase();
    const filtered = doctorsList.filter(d => d.name.toLowerCase().includes(q) || (d.hospital_name||'').toLowerCase().includes(q));
    const tbody = document.getElementById('doctors-tbody');
    if(tbody) tbody.innerHTML = filtered.map(d => \`
      <tr class="hover:bg-gray-50 cursor-pointer" onclick="viewHospital(\${d.hospital_id})">
        <td class="px-5 py-3 font-semibold text-gray-900">\${d.name}<br><span class="text-xs text-gray-400">\${d.position||''}</span></td>
        <td class="px-5 py-3 text-gray-700">\${d.hospital_name||'-'}</td>
        <td class="px-5 py-3 text-gray-600">\${d.department||'-'}</td>
        <td class="px-5 py-3 text-gray-600">\${d.specialty||'-'}</td>
        <td class="px-5 py-3">\${influenceTag(d.influence_level)}</td>
        <td class="px-5 py-3 text-gray-600">\${d.meeting_count||0}회</td>
        <td class="px-5 py-3 text-gray-600">\${d.last_meeting ? formatDate(d.last_meeting) : '-'}</td>
      </tr>
    \`).join('');
  }

  // ===== MEETINGS PAGE =====
  async function loadMeetings() {
    document.getElementById('header-actions').innerHTML = '';
    try {
      const { data } = await axios.get('/api/meetings');
      document.getElementById('content').innerHTML = \`
        <div class="fade-in">
          <div class="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div class="divide-y">\${data.data.length === 0 ? '<p class="p-8 text-gray-400 text-center">미팅 기록이 없습니다.</p>' : data.data.map(m => \`
              <div class="px-6 py-4 hover:bg-gray-50 transition">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-3">
                    <span class="text-sm text-gray-500 font-mono">\${formatDate(m.meeting_date)}</span>
                    \${meetingTypeTag(m.meeting_type)}
                    <span class="font-semibold text-gray-900 cursor-pointer hover:text-todoc-600" onclick="viewHospital(\${m.hospital_id})">\${m.doctor_name||'-'}</span>
                    <span class="text-sm text-gray-400">(\${m.hospital_name||'-'})</span>
                  </div>
                </div>
                \${m.purpose ? '<p class="text-sm font-medium text-gray-700 mb-1">' + m.purpose + '</p>' : ''}
                \${m.content ? '<p class="text-sm text-gray-600 mb-1">' + m.content + '</p>' : ''}
                \${m.result ? '<p class="text-sm text-green-700 mb-1"><i class="fas fa-check-circle mr-1"></i>' + m.result + '</p>' : ''}
                \${m.next_action ? '<p class="text-sm text-orange-600"><i class="fas fa-arrow-right mr-1"></i>' + m.next_action + (m.next_meeting_date ? ' (' + formatDate(m.next_meeting_date) + ')' : '') + '</p>' : ''}
              </div>
            \`).join('')}</div>
          </div>
        </div>
      \`;
    } catch(e) { document.getElementById('content').innerHTML = '<p class="text-red-500">미팅 기록을 불러오지 못했습니다.</p>'; }
  }

  // ===== DELETE =====
  async function deleteHospital(id) {
    if(!confirm('이 병원과 관련된 모든 교수, 미팅 기록이 삭제됩니다. 삭제하시겠습니까?')) return;
    try { await axios.delete('/api/hospitals/' + id); navigate('hospitals'); } catch(e) { alert('삭제 실패'); }
  }
  async function deleteDoctor(id, hospitalId) {
    if(!confirm('이 교수와 관련된 모든 미팅 기록이 삭제됩니다. 삭제하시겠습니까?')) return;
    try { await axios.delete('/api/doctors/' + id); viewHospital(hospitalId); } catch(e) { alert('삭제 실패'); }
  }
  async function deleteMeeting(id, hospitalId) {
    if(!confirm('이 미팅 기록을 삭제하시겠습니까?')) return;
    try { await axios.delete('/api/meetings/' + id); viewHospital(hospitalId); } catch(e) { alert('삭제 실패'); }
  }

  // ===== Init =====
  navigate('dashboard');
  </script>
</body>
</html>`);
})

export default app
