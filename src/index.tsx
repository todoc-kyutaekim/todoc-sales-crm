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
import tags from './routes/tags'
import favorites from './routes/favorites'
import templates from './routes/templates'
import pipeline from './routes/pipeline'
import schedule from './routes/schedule'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
app.use('/api/*', cors())

// Auth routes (no auth required)
app.route('/api/auth', auth)

// Auth middleware for all other API routes
app.use('/api/*', async (c, next) => {
  // Skip auth check for /api/auth/* routes
  if (c.req.path.startsWith('/api/auth')) return next()

  const sessionId = c.req.header('X-Session-Id') || ''
  if (!sessionId) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id=? AND expires_at > datetime("now")'
  ).bind(sessionId).first() as any

  if (!session) {
    return c.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  // Store user_id in header for downstream routes
  c.set('userId', session.user_id)
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
app.route('/api/tags', tags)
app.route('/api/favorites', favorites)
app.route('/api/templates', templates)
app.route('/api/pipeline', pipeline)
app.route('/api/schedule', schedule)
app.get('/api/regions', async (c) => {
  const r = await c.env.DB.prepare('SELECT DISTINCT region FROM hospitals WHERE region!="" ORDER BY region').all()
  return c.json({ data: r.results.map((x:any) => x.region) })
})

// Users list (for sales rep selection)
app.get('/api/users', async (c) => {
  const r = await c.env.DB.prepare('SELECT id, name, email FROM users ORDER BY name').all()
  return c.json({ data: r.results })
})

// PWA Manifest
app.get('/manifest.json', (c) => {
  return c.json({
    name: 'TODOC CRM',
    short_name: 'TODOC',
    description: '토닥 인공와우 영업 관리 시스템',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8f9fb',
    theme_color: '#3366ff',
    orientation: 'any',
    scope: '/',
    lang: 'ko',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/static/icons/icon-72x72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-96x96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-128x128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-144x144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-152x152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-384x384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/static/icons/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  })
})

// PWA Service Worker
app.get('/sw.js', (c) => {
  c.header('Content-Type', 'application/javascript')
  c.header('Service-Worker-Allowed', '/')
  c.header('Cache-Control', 'no-cache')
  return c.body(SW_JS)
})

// SPA - serves HTML shell, all JS/CSS from CDN or inline
app.get('*', (c) => c.html(HTML))

const SW_JS = `const CACHE_NAME='todoc-crm-v6';
const API_CACHE='todoc-api-v1';
const STATIC_ASSETS=['/','/static/style.css','/static/app.js','/static/icons/icon-192x192.png'];
const API_CACHE_PATHS=['/api/dashboard','/api/hospitals','/api/doctors','/api/meetings','/api/regions'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC_ASSETS).catch(()=>{})));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME&&k!==API_CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET')return;
if(u.pathname.startsWith('/api/')&&u.origin===self.location.origin){const shouldCache=API_CACHE_PATHS.some(p=>u.pathname===p||u.pathname.startsWith(p+'?'));if(shouldCache){e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(API_CACHE).then(ca=>ca.put(e.request,cl))}return r}).catch(()=>caches.match(e.request).then(c=>c||new Response(JSON.stringify({data:null,offline:true}),{headers:{'Content-Type':'application/json'}}))));return}return}
if(u.origin!==self.location.origin){e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(CACHE_NAME).then(ca=>ca.put(e.request,cl))}return r}).catch(()=>c)}));return}
e.respondWith(caches.match(e.request).then(c=>{const f=fetch(e.request).then(r=>{if(r.ok){const cl=r.clone();caches.open(CACHE_NAME).then(ca=>ca.put(e.request,cl))}return r}).catch(()=>c);return c||f}))});`

const HTML = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="TODOC">
<meta name="theme-color" content="#2563eb">
<meta name="description" content="토닥 인공와우 영업 관리 시스템">
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" sizes="32x32" href="/static/icons/favicon-32x32.png">
<link rel="icon" type="image/x-icon" href="/static/icons/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="/static/icons/apple-touch-icon.png">
<title>TODOC CRM</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/axios@1.7.0/dist/axios.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script>tailwind.config={theme:{extend:{fontFamily:{sans:['Pretendard','Inter','-apple-system','sans-serif']},colors:{brand:{50:'#eef4ff',100:'#d9e6ff',200:'#bcd2ff',300:'#8eb5ff',400:'#598eff',500:'#2563eb',600:'#1d4ed8',700:'#1e40af',800:'#1e3a8a',900:'#102d92'}}}}}</script>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="h-screen overflow-hidden overflow-x-hidden" style="height:100vh;height:100dvh">
<div id="toast-wrap"></div>

<!-- Auth Screen -->
<div id="auth-screen" class="fixed inset-0 z-[100] flex items-center justify-center p-4 hidden" style="background:linear-gradient(135deg, #f8f9fc 0%, #eef4ff 50%, #f1f3f9 100%)">
  <div class="w-full max-w-md">
    <div id="auth-box" class="bg-white rounded-2xl border border-gray-100/80 p-8" style="box-shadow:0 20px 40px -12px rgba(16,24,40,.12), 0 0 0 1px rgba(0,0,0,.03)"></div>
    <div class="text-center mt-8 text-[11px] text-slate-300 tracking-wide">&copy; 2026 TODOC Inc. &middot; Cochlear Implant Solutions</div>
  </div>
</div>

<!-- Pull-to-Refresh indicator -->
<div id="ptr-indicator" class="fixed top-0 left-0 right-0 z-[80] flex items-center justify-center py-3 text-white text-sm font-semibold transform -translate-y-full transition-transform duration-200" style="display:none;background:linear-gradient(135deg,#2563eb,#1d4ed8)">
  <i class="fas fa-sync-alt mr-2 ptr-spin"></i>새로고침 중...
</div>

<!-- App Main -->
<div id="app-main" class="flex hidden" style="height:100vh;height:100dvh">

<!-- Mobile overlay -->
<div id="sidebar-overlay" class="fixed inset-0 bg-black/50 z-40 hidden lg:hidden" style="backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)" onclick="toggleSidebar()"></div>

<!-- Sidebar -->
<aside id="sidebar" class="w-[250px] flex-col flex-shrink-0 select-none fixed lg:relative z-50 h-full -translate-x-full lg:translate-x-0 transition-transform duration-200 hidden lg:flex" style="background:linear-gradient(180deg, #0f172a 0%, #1e293b 100%)">
  <div class="px-5 py-5 flex items-center gap-3">
    <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#3b7bf7,#2563eb);box-shadow:0 4px 12px rgba(37,99,235,.35)">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm-2 13H8V9h2v7zm4 0h-2V9h2v7z" fill="#fff"/></svg>
    </div>
    <div>
      <div class="text-white font-extrabold text-[15px] tracking-tight leading-tight">TODOC</div>
      <div class="text-[10px] tracking-[.18em] font-semibold" style="color:rgba(148,163,184,.6)">SALES CRM</div>
    </div>
    <button class="lg:hidden ml-auto text-slate-400 hover:text-white transition" onclick="toggleSidebar()"><i class="fas fa-xmark text-lg"></i></button>
  </div>
  <div class="h-px mx-5" style="background:linear-gradient(90deg,transparent,rgba(148,163,184,.15),transparent)"></div>
  <nav class="flex-1 py-4 space-y-0.5 overflow-y-auto px-1">
    <div class="px-4 mb-2"><span class="text-[9px] font-bold tracking-[.15em] uppercase" style="color:rgba(148,163,184,.4)">Main</span></div>
    <div onclick="nav('dashboard')" id="n-dashboard" class="nav-item"><span class="nav-icon"><i class="fas fa-chart-pie"></i></span>대시보드</div>
    <div onclick="nav('hospitals')" id="n-hospitals" class="nav-item"><span class="nav-icon"><i class="fas fa-hospital"></i></span>기관 관리</div>
    <div onclick="nav('doctors')" id="n-doctors" class="nav-item"><span class="nav-icon"><i class="fas fa-user-doctor"></i></span>의료진 관리</div>
    <div onclick="nav('meetings')" id="n-meetings" class="nav-item"><span class="nav-icon"><i class="fas fa-calendar-check"></i></span>미팅 관리</div>
    <div onclick="nav('schedule')" id="n-schedule" class="nav-item"><span class="nav-icon"><i class="fas fa-route"></i></span>일정 플래너</div>
    <div class="h-px mx-5 my-3" style="background:linear-gradient(90deg,transparent,rgba(148,163,184,.12),transparent)"></div>
    <div class="px-4 mb-2"><span class="text-[9px] font-bold tracking-[.15em] uppercase" style="color:rgba(148,163,184,.4)">Analytics</span></div>
    <div onclick="nav('cistats')" id="n-cistats" class="nav-item"><span class="nav-icon"><i class="fas fa-chart-bar"></i></span>인공와우 통계</div>
    <div class="h-px mx-5 my-3" style="background:linear-gradient(90deg,transparent,rgba(148,163,184,.12),transparent)"></div>
    <div class="px-4 mb-2"><span class="text-[9px] font-bold tracking-[.15em] uppercase" style="color:rgba(148,163,184,.4)">System</span></div>
    <div onclick="nav('activity')" id="n-activity" class="nav-item"><span class="nav-icon"><i class="fas fa-clock-rotate-left"></i></span>활동 로그</div>
  </nav>
  <div class="px-5 py-4" style="border-top:1px solid rgba(148,163,184,.1)">
    <div class="text-[10px] leading-relaxed font-medium" style="color:rgba(148,163,184,.35)">&copy; 2026 TODOC Inc.<br>Cochlear Implant Solutions</div>
  </div>
</aside>

<!-- Main -->
<main class="flex-1 flex flex-col overflow-hidden min-w-0" style="background:#f8f9fc">
  <header id="app-header" class="h-[48px] lg:h-[60px] bg-white/90 flex items-center px-3 lg:px-7 flex-shrink-0 gap-1.5 lg:gap-3 safe-top" style="min-height:48px;border-bottom:1px solid #eef0f5;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)">
    <div class="flex items-center gap-1.5 lg:gap-3 min-w-0 flex-1 overflow-hidden">
      <button class="lg:hidden text-slate-400 hover:text-slate-600 p-1 hidden" onclick="toggleSidebar()"><i class="fas fa-bars text-lg"></i></button>
      <h2 id="page-title" class="text-[14px] lg:text-[16px] font-bold text-slate-800 tracking-tight truncate leading-none"></h2>
      <span id="page-subtitle" class="text-xs text-slate-400 font-medium hidden sm:inline"></span>
    </div>
    <!-- Mobile Search Button -->
    <button id="mobile-search-btn" class="mobile-search-btn sm:hidden" onclick="toggleMobileSearch()"><i class="fas fa-search"></i></button>
    <!-- Global Search -->
    <div id="search-wrap-outer" class="flex-1 max-w-md mx-2 hidden sm:block">
      <div class="relative" id="search-wrap">
        <i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
        <input id="global-search" type="text" placeholder="기관, 의료진, 미팅 검색... (Ctrl+K)" class="input pl-10 pr-3 py-2 text-sm w-full !border-gray-200 bg-gray-50/80 focus:bg-white" style="border-radius:10px" oninput="onGlobalSearch(this.value)" onfocus="showSearchResults()" autocomplete="off">
        <div id="search-results" class="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 z-50 hidden max-h-[70vh] overflow-y-auto" style="border-radius:14px;box-shadow:0 12px 32px -4px rgba(16,24,40,.12),0 0 0 1px rgba(0,0,0,.03)"></div>
      </div>
    </div>
    <div id="header-actions" class="flex items-center gap-1 lg:gap-2 flex-shrink-0"></div>
    <div class="h-5 w-px bg-gray-200 mx-1.5 hidden lg:block"></div>
    <div id="user-menu" class="relative flex-shrink-0"></div>
  </header>
  <div id="content" class="flex-1 overflow-y-auto overflow-x-hidden" style="padding-bottom:calc(64px + env(safe-area-inset-bottom, 0px))"></div>
  <style>@media(min-width:1024px){#content{padding-bottom:0!important}}</style>
</main>
</div><!-- /app-main -->

<!-- Mobile Bottom Navigation -->
<nav id="bottom-nav" class="btm-nav">
  <div onclick="nav('dashboard')" id="bn-dashboard" class="btm-nav-item">
    <div class="relative"><i class="fas fa-chart-pie"></i><span id="bn-reminder-badge" class="btm-badge hidden">0</span></div><span>대시보드</span>
  </div>
  <div onclick="nav('hospitals')" id="bn-hospitals" class="btm-nav-item">
    <i class="fas fa-hospital"></i><span>기관</span>
  </div>
  <!-- FAB spacer -->
  <div class="btm-nav-fab-spacer"></div>
  <div onclick="nav('doctors')" id="bn-doctors" class="btm-nav-item">
    <i class="fas fa-user-doctor"></i><span>의료진</span>
  </div>
  <div onclick="nav('meetings')" id="bn-meetings" class="btm-nav-item">
    <i class="fas fa-calendar-check"></i><span>미팅</span>
  </div>
</nav>

<!-- Mobile FAB (Floating Action Button) -->
<button id="mobile-fab" class="mobile-fab hidden" onclick="toggleFabMenu()">
  <i class="fas fa-plus"></i>
</button>
<div id="fab-menu" class="fab-menu hidden">
  <div class="fab-menu-bg" onclick="closeFabMenu()"></div>
  <div class="fab-menu-items">
    <div class="fab-menu-item" onclick="closeFabMenu();showNewMeetGlobal()">
      <span class="fab-menu-label">빠른 미팅</span>
      <div class="fab-menu-icon bg-emerald-500"><i class="fas fa-calendar-plus"></i></div>
    </div>
    <div class="fab-menu-item" onclick="closeFabMenu();showHospForm()">
      <span class="fab-menu-label">기관 추가</span>
      <div class="fab-menu-icon bg-blue-500"><i class="fas fa-hospital"></i></div>
    </div>
    <div class="fab-menu-item" onclick="closeFabMenu();nav('cistats')">
      <span class="fab-menu-label">CI 통계</span>
      <div class="fab-menu-icon bg-violet-500"><i class="fas fa-chart-bar"></i></div>
    </div>
    <div class="fab-menu-item" onclick="closeFabMenu();nav('activity')">
      <span class="fab-menu-label">활동 로그</span>
      <div class="fab-menu-icon bg-slate-500"><i class="fas fa-clock-rotate-left"></i></div>
    </div>
  </div>
</div>

<!-- Modal -->
<div id="modal" class="fixed inset-0 modal-bg z-50 hidden items-end lg:items-center justify-center lg:p-4" onclick="if(event.target===this)tryCloseModal()">
  <div id="modal-content" class="modal-box bg-white w-full max-w-lg overflow-y-auto" style="max-height:calc(100dvh - 48px);max-height:calc(100vh - 48px);border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.12)" onclick="event.stopPropagation()">
    <div class="flex items-center justify-between px-5 lg:px-6 py-3.5 lg:py-4 sticky top-0 bg-white z-10" style="border-bottom:1px solid #eef0f5;border-radius:20px 20px 0 0">
      <h3 id="modal-title" class="font-bold text-slate-800 text-[15px] tracking-tight"></h3>
      <button onclick="tryCloseModal()" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 hover:bg-slate-100 hover:text-slate-500 transition"><i class="fas fa-xmark text-lg"></i></button>
    </div>
    <div id="modal-body" class="p-5 lg:p-6"></div>
  </div>
</div>

<!-- Confirm Dialog -->
<div id="confirm-dialog" class="fixed inset-0 modal-bg z-[60] hidden flex items-center justify-center p-4">
  <div class="bg-white w-full max-w-sm p-6 text-center" style="border-radius:20px;box-shadow:0 24px 48px -12px rgba(16,24,40,.18);animation:scaleIn .2s ease">
    <div id="confirm-icon" class="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"></div>
    <h4 id="confirm-title" class="font-bold text-slate-800 text-[15px] mb-2"></h4>
    <p id="confirm-msg" class="text-sm text-slate-500 mb-6 leading-relaxed"></p>
    <div id="confirm-extra" class="mb-4 hidden"></div>
    <div class="flex gap-3 justify-center">
      <button onclick="confirmNo()" class="btn btn-outline flex-1">취소</button>
      <button id="confirm-yes" class="flex-1"></button>
    </div>
  </div>
</div>

<script src="/static/app.js"></script>
<script>
// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('SW registered:', reg.scope);
    }).catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
</script>
</body></html>`

export default app
