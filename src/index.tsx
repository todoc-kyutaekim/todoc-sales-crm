import { Hono } from 'hono'
import { cors } from 'hono/cors'
import hospitals from './routes/hospitals'
import doctors from './routes/doctors'
import meetings from './routes/meetings'
import dashboard from './routes/dashboard'
import cistats from './routes/cistats'
import search from './routes/search'
import activity from './routes/activity'
import exports from './routes/exports'
import auth from './routes/auth'
import ai from './routes/ai'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
const app = new Hono<{ Bindings: Bindings }>()
app.use('/api/*', cors())

// Auth routes (no auth required)
app.route('/api/auth', auth)

// Auth middleware for all other API routes
app.use('/api/*', async (c, next) => {
  // Skip auth check for /api/auth/* routes
  if (c.req.path.startsWith('/api/auth')) return next()

  const sessionId = c.req.header('X-Session-Id') || ''
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id=? AND expires_at > datetime("now")'
  ).bind(sessionId).first()

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
})

// API Routes
app.route('/api/hospitals', hospitals)
app.route('/api', doctors)          // handles /api/doctors/*, /api/hospitals/:hid/doctors, /api/papers/*
app.route('/api/meetings', meetings)
app.route('/api/dashboard', dashboard)
app.route('/api/ci-stats', cistats)
app.route('/api/search', search)
app.route('/api/activity', activity)
app.route('/api/export', exports)
app.route('/api/ai', ai)
app.get('/api/regions', async (c) => {
  const r = await c.env.DB.prepare('SELECT DISTINCT region FROM hospitals WHERE region!="" ORDER BY region').all()
  return c.json({ data: r.results.map((x:any) => x.region) })
})

// SPA - serves HTML shell, all JS/CSS from CDN or inline
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
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="h-screen overflow-hidden">
<div id="toast-wrap"></div>

<!-- Auth Screen -->
<div id="auth-screen" class="fixed inset-0 bg-gradient-to-br from-slate-50 via-white to-brand-50 z-[100] flex items-center justify-center p-4 hidden">
  <div class="w-full max-w-md">
    <div id="auth-box" class="bg-white rounded-2xl shadow-xl border border-gray-100 p-8"></div>
    <div class="text-center mt-6 text-[11px] text-slate-300">&copy; 2026 TODOC Inc. &middot; Cochlear Implant Solutions</div>
  </div>
</div>

<!-- App Main -->
<div id="app-main" class="flex h-screen hidden">

<!-- Mobile overlay -->
<div id="sidebar-overlay" class="fixed inset-0 bg-black/50 z-40 hidden lg:hidden" onclick="toggleSidebar()"></div>

<!-- Sidebar -->
<aside id="sidebar" class="w-[250px] bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col flex-shrink-0 select-none fixed lg:relative z-50 h-full -translate-x-full lg:translate-x-0 transition-transform duration-200">
  <div class="px-6 py-5 flex items-center gap-3">
    <div class="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm-2 13H8V9h2v7zm4 0h-2V9h2v7z" fill="#fff"/></svg>
    </div>
    <div>
      <div class="text-white font-extrabold text-[15px] tracking-tight">TODOC</div>
      <div class="text-slate-400 text-[10px] tracking-widest font-medium">SALES CRM</div>
    </div>
    <button class="lg:hidden ml-auto text-slate-400 hover:text-white" onclick="toggleSidebar()"><i class="fas fa-xmark text-lg"></i></button>
  </div>
  <div class="h-px bg-slate-700/50 mx-5"></div>
  <nav class="flex-1 py-4 space-y-1 overflow-y-auto">
    <div onclick="nav('dashboard')" id="n-dashboard" class="nav-item"><span class="nav-icon"><i class="fas fa-chart-pie"></i></span>대시보드</div>
    <div onclick="nav('hospitals')" id="n-hospitals" class="nav-item"><span class="nav-icon"><i class="fas fa-hospital"></i></span>병원 관리</div>
    <div onclick="nav('doctors')" id="n-doctors" class="nav-item"><span class="nav-icon"><i class="fas fa-user-doctor"></i></span>교수 관리</div>
    <div onclick="nav('meetings')" id="n-meetings" class="nav-item"><span class="nav-icon"><i class="fas fa-calendar-check"></i></span>미팅 기록</div>
    <div class="h-px bg-slate-700/50 mx-5 my-3"></div>
    <div class="px-5 mb-2"><span class="text-[9px] text-slate-500 font-bold tracking-widest uppercase">Market Data</span></div>
    <div onclick="nav('cistats')" id="n-cistats" class="nav-item"><span class="nav-icon"><i class="fas fa-chart-bar"></i></span>인공와우 통계</div>
    <div class="h-px bg-slate-700/50 mx-5 my-3"></div>
    <div class="px-5 mb-2"><span class="text-[9px] text-slate-500 font-bold tracking-widest uppercase">System</span></div>
    <div onclick="nav('activity')" id="n-activity" class="nav-item"><span class="nav-icon"><i class="fas fa-clock-rotate-left"></i></span>활동 로그</div>
  </nav>
  <div class="px-5 py-4 border-t border-slate-700/50">
    <div class="text-[10px] text-slate-500 leading-relaxed font-medium">&copy; 2026 TODOC Inc.<br>Cochlear Implant Solutions</div>
  </div>
</aside>

<!-- Main -->
<main class="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#f8f9fb]">
  <header class="h-[60px] bg-white border-b border-gray-100 flex items-center justify-between px-4 lg:px-7 flex-shrink-0 gap-2">
    <div class="flex items-center gap-2 lg:gap-3 min-w-0">
      <button class="lg:hidden text-slate-400 hover:text-slate-600 p-1" onclick="toggleSidebar()"><i class="fas fa-bars text-lg"></i></button>
      <h2 id="page-title" class="text-[15px] lg:text-[16px] font-bold text-slate-800 tracking-tight truncate"></h2>
      <span id="page-subtitle" class="text-xs text-slate-400 font-medium hidden sm:inline"></span>
    </div>
    <!-- Mobile Search Button -->
    <button id="mobile-search-btn" class="mobile-search-btn sm:hidden" onclick="toggleMobileSearch()"><i class="fas fa-search"></i></button>
    <!-- Global Search -->
    <div id="search-wrap-outer" class="flex-1 max-w-md mx-2 hidden sm:block">
      <div class="relative" id="search-wrap">
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
        <input id="global-search" type="text" placeholder="병원, 교수, 미팅 검색... (Ctrl+K)" class="input pl-9 pr-3 py-2 text-sm w-full !rounded-xl !border-gray-200 bg-gray-50 focus:bg-white" oninput="onGlobalSearch(this.value)" onfocus="showSearchResults()" autocomplete="off">
        <div id="search-results" class="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 hidden max-h-[70vh] overflow-y-auto"></div>
      </div>
    </div>
    <div id="header-actions" class="flex items-center gap-1 lg:gap-2 flex-shrink-0"></div>
    <div class="h-5 w-px bg-gray-200 mx-1 hidden lg:block"></div>
    <div id="user-menu" class="relative flex-shrink-0"></div>
  </header>
  <div id="content" class="flex-1 overflow-y-auto"></div>
</main>
</div><!-- /app-main -->

<!-- Modal -->
<div id="modal" class="fixed inset-0 modal-bg z-50 hidden flex items-center justify-center p-4" onclick="if(event.target===this)tryCloseModal()">
  <div id="modal-content" class="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
      <h3 id="modal-title" class="font-bold text-slate-800 text-[15px]"></h3>
      <button onclick="tryCloseModal()" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition"><i class="fas fa-xmark text-lg"></i></button>
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

<script src="/static/app.js"></script>
</body></html>`

export default app
