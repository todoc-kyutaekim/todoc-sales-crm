// ===== TODOC CRM - Frontend Application =====
const API = axios.create({ baseURL: '/api' });

// ===== Theme (Dark/Light/Auto) =====
function applyTheme(t) {
  // t: 'light' | 'dark' | 'auto'
  var html = document.documentElement;
  if (t === 'auto') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', t);
  }
  // Update button icon
  var btn = document.getElementById('theme-toggle');
  if (btn) {
    var resolved = t === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    var icon = resolved === 'dark' ? 'fa-sun' : 'fa-moon';
    btn.innerHTML = '<i class="fas ' + icon + '"></i>';
    btn.setAttribute('title', t === 'auto' ? '시스템 설정 (' + (resolved === 'dark' ? '다크' : '라이트') + ')' : (resolved === 'dark' ? '다크 모드' : '라이트 모드'));
    btn.setAttribute('aria-label', '테마 전환 (현재: ' + (t === 'auto' ? '자동' : (resolved === 'dark' ? '다크' : '라이트')) + ')');
  }
  // Update theme-color meta for mobile chrome
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    var resolved = t === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    meta.setAttribute('content', resolved === 'dark' ? '#0f1218' : '#2563eb');
  }
}
function toggleTheme() {
  var cur = localStorage.getItem('todoc_theme') || 'auto';
  // cycle: auto -> light -> dark -> auto
  var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
  localStorage.setItem('todoc_theme', next);
  applyTheme(next);
  if (typeof toast === 'function') {
    var label = next === 'auto' ? '시스템 설정' : (next === 'dark' ? '다크 모드' : '라이트 모드');
    toast('테마: ' + label);
  }
}
// Initial theme apply (early)
(function() {
  var saved = localStorage.getItem('todoc_theme') || 'auto';
  applyTheme(saved);
  // React to system theme change in 'auto' mode
  if (window.matchMedia) {
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
        var cur = localStorage.getItem('todoc_theme') || 'auto';
        if (cur === 'auto') applyTheme('auto');
      });
    } catch(e) {}
  }
})();
window.toggleTheme = toggleTheme;
let curPage = '', hospList = [], docList = [], confirmCb = null, searchTimer = null;
let currentUser = null;
let _reminderCount = 0;
let _dashPeriod = 'month';
let _searchHistory = JSON.parse(localStorage.getItem('todoc_search_history') || '[]');
let _favorites = new Set();
let _offlineMode = !navigator.onLine;

// ===== Sort State =====
var _hospSort = { key: 'name', dir: 'asc' };
var _docSort = { key: 'name', dir: 'asc' };
var _meetSort = { key: 'meeting_date', dir: 'desc' };

function sortList(list, key, dir) {
  return list.slice().sort(function(a, b) {
    var va = a[key], vb = b[key];
    if (va == null) va = '';
    if (vb == null) vb = '';
    // Numeric sort for known numeric fields
    if (['meeting_count', 'total_meetings', 'doctor_count', 'score'].includes(key)) {
      va = Number(va) || 0; vb = Number(vb) || 0;
    }
    // Influence sort: high > medium > low
    if (key === 'influence_level') {
      var io = { high: 3, medium: 2, low: 1 };
      va = io[va] || 0; vb = io[vb] || 0;
    }
    // Date fields
    if (['last_meeting', 'meeting_date', 'last_meeting_date', 'created_at'].includes(key)) {
      va = va ? new Date(va + (va.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
      vb = vb ? new Date(vb + (vb.length === 10 ? 'T00:00:00' : '')).getTime() : 0;
    }
    // String compare
    if (typeof va === 'string' && typeof vb === 'string') {
      va = va.toLowerCase(); vb = vb.toLowerCase();
    }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}
function sortIcon(currentKey, sortState) {
  if (sortState.key !== currentKey) return '<i class="fas fa-sort text-slate-200 ml-1 text-[9px]"></i>';
  return sortState.dir === 'asc' ? '<i class="fas fa-sort-up text-brand-500 ml-1 text-[9px]"></i>' : '<i class="fas fa-sort-down text-brand-500 ml-1 text-[9px]"></i>';
}
function toggleSort(sortState, key, refreshFn) {
  if (sortState.key === key) { sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc'; }
  else { sortState.key = key; sortState.dir = 'asc'; }
  refreshFn();
}

// ===== Auth: Session Management =====
function getSession() { return localStorage.getItem('todoc_session') || '' }
function setSession(sid, user) {
  localStorage.setItem('todoc_session', sid);
  localStorage.setItem('todoc_user', JSON.stringify(user));
  currentUser = user;
  API.defaults.headers.common['X-Session-Id'] = sid;
}
function clearSession() {
  localStorage.removeItem('todoc_session');
  localStorage.removeItem('todoc_user');
  currentUser = null;
  delete API.defaults.headers.common['X-Session-Id'];
  if (typeof stopMentionPolling === 'function') stopMentionPolling();
}

function clearAutoLogin() {
  localStorage.removeItem('todoc_remember');
  localStorage.removeItem('todoc_saved_email');
}

// Attach session header on every request
API.interceptors.request.use(cfg => {
  const sid = getSession();
  if (sid) cfg.headers['X-Session-Id'] = sid;
  return cfg;
});
// Intercept 401 => redirect to login
API.interceptors.response.use(r => r, err => {
  if (err.response && err.response.status === 401 && !err.config.url.includes('/auth/')) {
    clearSession();
    showAuthScreen();
  }
  return Promise.reject(err);
});

// ===== Auth Screen =====
function showAuthScreen() {
  document.getElementById('app-main').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
  var bn = document.getElementById('bottom-nav');
  if (bn) bn.classList.remove('show');
  var fab = document.getElementById('mobile-fab');
  if (fab) fab.classList.add('hidden');
  closeFabMenu();
  renderLoginForm();
}
function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-main').classList.remove('hidden');
  var bn = document.getElementById('bottom-nav');
  if (bn) bn.classList.add('show');
  // Show FAB on mobile
  var fab = document.getElementById('mobile-fab');
  if (fab && window.innerWidth < 1024) fab.classList.remove('hidden');
  updateUserUI();
  loadFavorites();
  nav('dashboard');
}
function updateUserUI() {
  const el = document.getElementById('user-menu');
  if (el && currentUser) {
    el.innerHTML = '<div class="flex items-center gap-2 cursor-pointer group" onclick="toggleUserDropdown()">' +
      '<div class="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style="background:linear-gradient(135deg,#3b7bf7,#2563eb);box-shadow:0 2px 6px rgba(37,99,235,.25)">' + (currentUser.name || '?').charAt(0) + '</div>' +
      '<span class="text-[12px] font-semibold text-slate-600 hidden lg:inline group-hover:text-brand-600 transition">' + currentUser.name + '</span>' +
      '<i class="fas fa-chevron-down text-[9px] text-slate-300 hidden lg:inline"></i></div>' +
      '<div id="user-dropdown" class="absolute right-0 top-full mt-2 w-56 bg-white z-50 hidden py-1" style="border-radius:14px;border:1px solid #eef0f5;box-shadow:0 12px 32px -4px rgba(16,24,40,.12),0 0 0 1px rgba(0,0,0,.03)">' +
      '<div class="px-4 py-3" style="border-bottom:1px solid #eef0f5"><div class="text-[13px] font-bold text-slate-800">' + currentUser.name + '</div><div class="text-[11px] text-slate-400 mt-0.5">' + currentUser.email + '</div></div>' +
      '<div class="py-1">' +
      '<div class="px-4 py-2.5 text-[13px] text-slate-600 hover:bg-gray-50 cursor-pointer flex items-center gap-2.5 transition" onclick="showChangePassword()"><i class="fas fa-key text-slate-400 text-xs w-4"></i>비밀번호 변경</div>' +
      '<div class="px-4 py-2.5 text-[13px] text-red-500 hover:bg-red-50 cursor-pointer flex items-center gap-2.5 transition" onclick="doLogout()"><i class="fas fa-sign-out-alt text-xs w-4"></i>로그아웃</div>' +
      '</div></div>';
  }
}
function toggleUserDropdown() {
  const dd = document.getElementById('user-dropdown');
  if (dd) dd.classList.toggle('hidden');
}
// Close dropdown on outside click
document.addEventListener('click', e => {
  const um = document.getElementById('user-menu');
  if (um && !um.contains(e.target)) {
    const dd = document.getElementById('user-dropdown');
    if (dd) dd.classList.add('hidden');
  }
});

function renderLoginForm() {
  document.getElementById('auth-box').innerHTML =
    '<div class="text-center mb-8">' +
    '<div class="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5" style="background:linear-gradient(135deg,#3b7bf7,#2563eb);box-shadow:0 8px 24px rgba(37,99,235,.3)">' +
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm-2 13H8V9h2v7zm4 0h-2V9h2v7z" fill="#fff"/></svg></div>' +
    '<h1 class="text-[22px] font-extrabold text-slate-800 tracking-tight leading-tight">TODOC CRM</h1>' +
    '<p class="text-[13px] text-slate-400 mt-1.5 font-medium">인공와우 영업 관리 시스템</p></div>' +
    '<form id="auth-form" class="space-y-5">' +
    '<div><label class="input-label">이메일</label><div class="relative"><i class="fas fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="email" type="email" class="input pl-10 w-full" placeholder="name@to-doc.com" autocomplete="email"></div></div>' +
    '<div><label class="input-label">비밀번호</label><div class="relative"><i class="fas fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="password" type="password" class="input pl-10 w-full" placeholder="비밀번호" autocomplete="current-password"></div></div>' +
    '<div class="flex items-center justify-between"><label class="flex items-center gap-2 cursor-pointer select-none"><input name="rememberMe" type="checkbox" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer" checked><span class="text-[13px] text-slate-500">자동 로그인</span></label></div>' +
    '<button type="submit" class="btn btn-primary w-full !py-3 text-[13px] font-bold" style="border-radius:10px">로그인</button></form>' +
    '<div class="mt-6 text-center"><span class="text-[13px] text-slate-400">계정이 없으신가요? </span><button onclick="renderRegisterForm()" class="text-[13px] text-brand-600 font-bold hover:text-brand-700 transition">회원가입</button></div>';
  document.getElementById('auth-form').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rememberMe = !!e.target.querySelector('input[name="rememberMe"]')?.checked;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>로그인 중...';
    try {
      const { data } = await API.post('/auth/login', { email: f.email, password: f.password, rememberMe });
      setSession(data.data.sessionId, data.data.user);
      if (rememberMe) {
        localStorage.setItem('todoc_remember', '1');
        localStorage.setItem('todoc_saved_email', f.email);
      } else {
        localStorage.removeItem('todoc_remember');
        localStorage.removeItem('todoc_saved_email');
      }
      toast('환영합니다, ' + data.data.user.name + '님!');
      showAppScreen();
    } catch (err) {
      toast(err.response?.data?.error || '로그인 실패', 'err');
      btn.disabled = false; btn.textContent = '로그인';
    }
  };
  setTimeout(() => document.querySelector('#auth-form input[name="email"]')?.focus(), 100);
}

function renderRegisterForm() {
  document.getElementById('auth-box').innerHTML =
    '<div class="text-center mb-8">' +
    '<div class="w-16 h-16 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/30">' +
    '<i class="fas fa-user-plus text-white text-2xl"></i></div>' +
    '<h1 class="text-2xl font-extrabold text-slate-800 tracking-tight">회원가입</h1>' +
    '<p class="text-sm text-slate-400 mt-1">TODOC CRM 계정 만들기</p></div>' +
    '<form id="auth-form" class="space-y-4">' +
    '<div><label class="input-label">이름</label><div class="relative"><i class="fas fa-user absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="name" type="text" class="input pl-10 w-full" placeholder="홍길동" autocomplete="name"></div></div>' +
    '<div><label class="input-label">이메일</label><div class="relative"><i class="fas fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="email" type="email" class="input pl-10 w-full" placeholder="name@to-doc.com" autocomplete="email"></div></div>' +
    '<div><label class="input-label">비밀번호</label><div class="relative"><i class="fas fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="password" type="password" class="input pl-10 w-full" placeholder="6자 이상" autocomplete="new-password"></div></div>' +
    '<button type="submit" class="btn btn-success w-full !py-3 text-sm font-bold">가입하기</button></form>' +
    '<div class="mt-6 text-center"><span class="text-sm text-slate-400">이미 계정이 있으신가요? </span><button onclick="renderLoginForm()" class="text-sm text-brand-600 font-bold hover:text-brand-700 transition">로그인</button></div>';
  document.getElementById('auth-form').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>가입 중...';
    try {
      const { data } = await API.post('/auth/register', { name: f.name, email: f.email, password: f.password });
      setSession(data.data.sessionId, data.data.user, true);
      toast('가입 완료! 환영합니다, ' + data.data.user.name + '님!');
      showAppScreen();
    } catch (err) {
      toast(err.response?.data?.error || '가입 실패', 'err');
      btn.disabled = false; btn.textContent = '가입하기';
    }
  };
  setTimeout(() => document.querySelector('#auth-form input[name="name"]')?.focus(), 100);
}

async function doLogout() {
  try { await API.post('/auth/logout') } catch(e) {}
  clearSession();
  toast('로그아웃되었습니다');
  showAuthScreen();
}

function showChangePassword() {
  toggleUserDropdown();
  openModal('비밀번호 변경',
    '<form id="fm" class="space-y-4">' +
    '<div><label class="input-label">현재 비밀번호</label><div class="relative"><i class="fas fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="currentPassword" type="password" class="input pl-10 w-full" placeholder="현재 비밀번호" autocomplete="current-password"></div></div>' +
    '<div><label class="input-label">새 비밀번호</label><div class="relative"><i class="fas fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="newPassword" type="password" class="input pl-10 w-full" placeholder="6자 이상" autocomplete="new-password"></div></div>' +
    '<div><label class="input-label">새 비밀번호 확인</label><div class="relative"><i class="fas fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="confirmPassword" type="password" class="input pl-10 w-full" placeholder="새 비밀번호 다시 입력" autocomplete="new-password"></div></div>' +
    '<div class="flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">변경</button></div></form>');
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.currentPassword) { toast('현재 비밀번호를 입력하세요', 'warn'); return }
    if (!f.newPassword || f.newPassword.length < 6) { toast('새 비밀번호는 6자 이상이어야 합니다', 'warn'); return }
    if (f.newPassword !== f.confirmPassword) { toast('새 비밀번호가 일치하지 않습니다', 'warn'); return }
    try {
      await API.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword });
      toast('비밀번호가 변경되었습니다');
      closeModal();
    } catch (err) { toast(err.response?.data?.error || '변경 실패', 'err') }
  };
  setTimeout(() => document.querySelector('#fm input[name="currentPassword"]')?.focus(), 100);
}

// ===== Auth Init =====
async function initAuth() {
  const sid = getSession();
  if (!sid) { showAuthScreen(); return }
  API.defaults.headers.common['X-Session-Id'] = sid;
  try {
    const { data } = await API.get('/auth/me');
    currentUser = data.data;
    localStorage.setItem('todoc_user', JSON.stringify(currentUser));
    showAppScreen();
    preloadUsers();
    startMentionPolling();
  } catch (e) {
    clearSession();
    showAuthScreen();
  }
}

// ===== Toast =====
function toast(msg, type = 'ok') {
  const el = document.createElement('div'); el.className = 'toast toast-' + type;
  el.innerHTML = '<i class="fas ' + (type === 'ok' ? 'fa-check-circle' : type === 'err' ? 'fa-exclamation-circle' : 'fa-exclamation-triangle') + '"></i><span>' + msg + '</span>';
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300) }, 2800);
}

// ===== Confirm =====
function showConfirm(title, msg, cb, opts) {
  opts = opts || {};
  var type = opts.type || 'delete';
  var themes = {
    delete: { icon: 'fas fa-trash', bg: 'bg-red-50', color: 'text-red-400', btn: 'btn btn-danger-fill', label: '삭제' },
    create: { icon: 'fas fa-calendar-plus', bg: 'bg-blue-50', color: 'text-blue-500', btn: 'btn btn-primary', label: '생성' },
    confirm: { icon: 'fas fa-check-circle', bg: 'bg-green-50', color: 'text-green-500', btn: 'btn btn-success', label: '확인' },
    warning: { icon: 'fas fa-exclamation-triangle', bg: 'bg-amber-50', color: 'text-amber-500', btn: 'btn bg-amber-500 text-white hover:bg-amber-600', label: '확인' }
  };
  var t = themes[type] || themes.confirm;
  document.getElementById('confirm-icon').className = 'w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ' + t.bg;
  document.getElementById('confirm-icon').innerHTML = '<i class="' + t.icon + ' ' + t.color + ' text-xl"></i>';
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').innerHTML = msg;
  var yesBtn = document.getElementById('confirm-yes');
  yesBtn.className = t.btn + ' flex-1';
  yesBtn.textContent = opts.yesLabel || t.label;
  var extraDiv = document.getElementById('confirm-extra');
  if (opts.extraHtml) { extraDiv.innerHTML = opts.extraHtml; extraDiv.classList.remove('hidden'); }
  else { extraDiv.innerHTML = ''; extraDiv.classList.add('hidden'); }
  confirmCb = cb;
  document.getElementById('confirm-dialog').classList.remove('hidden');
}
function confirmNo() { document.getElementById('confirm-dialog').classList.add('hidden'); confirmCb = null }
function confirmYes() { document.getElementById('confirm-dialog').classList.add('hidden'); if (confirmCb) confirmCb(); confirmCb = null }
document.getElementById('confirm-yes').onclick = confirmYes;

// ===== Sidebar Toggle (Mobile) =====
function toggleSidebar() {
  const sb = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
  const open = !sb.classList.contains('-translate-x-full');
  if (open) { sb.classList.add('-translate-x-full'); ov.classList.add('hidden'); }
  else { sb.classList.remove('-translate-x-full'); ov.classList.remove('hidden'); }
}

// ===== Nav =====
function nav(p) {
  curPage = p;
  // 일정 페이지를 떠날 때 sticky bottom action bar 제거
  if (p !== 'schedule') {
    var sb = document.getElementById('sch-sticky-bar');
    if (sb) sb.remove();
  }
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  document.getElementById('n-' + p)?.classList.add('active');
  // Update bottom nav (also handle aliases: doctors -> stays unmapped now, cistats/activity -> none)
  document.querySelectorAll('.btm-nav-item').forEach(e => { e.classList.remove('active'); e.setAttribute('aria-current','false'); });
  var bnItem = document.getElementById('bn-' + p);
  if (bnItem) { bnItem.classList.add('active'); bnItem.setAttribute('aria-current','page'); }
  document.getElementById('page-subtitle').textContent = '';
  document.getElementById('header-actions').innerHTML = '';
  // Close mobile search if open
  var sw = document.getElementById('search-wrap-outer');
  if (sw && sw.classList.contains('mobile-search-open')) {
    sw.classList.remove('mobile-search-open');
    sw.classList.add('hidden');
    sw.style.cssText = '';
  }
  if (window.innerWidth < 1024) {
    const sb = document.getElementById('sidebar');
    if (sb && !sb.classList.contains('-translate-x-full')) toggleSidebar();
  }
  ({ dashboard: loadDash, hospitals: loadHosp, doctors: loadDoc, meetings: loadMeet, cistats: loadCIStats, activity: loadActivity, schedule: loadSchedule, products: loadProducts })[p]?.();
}

// ===== Mobile More Menu =====
function toggleMoreMenu() {
  var mm = document.getElementById('more-menu');
  if (mm) mm.classList.toggle('hidden');
}
function closeMoreMenu() {
  var mm = document.getElementById('more-menu');
  if (mm) mm.classList.add('hidden');
}

// ===== Mobile FAB =====
function toggleFabMenu() {
  var fm = document.getElementById('fab-menu');
  var fab = document.getElementById('mobile-fab');
  if (!fm) return;
  var isOpen = !fm.classList.contains('hidden');
  if (isOpen) {
    closeFabMenu();
  } else {
    fm.classList.remove('hidden');
    fab.classList.add('fab-open');
    if (fab) fab.setAttribute('aria-expanded', 'true');
    setTimeout(function() { fm.classList.add('fab-menu-show'); }, 10);
    // Focus first item for keyboard a11y
    setTimeout(function() {
      var first = fm.querySelector('.fab-menu-item');
      if (first && first.focus) first.focus();
    }, 60);
  }
}
function closeFabMenu() {
  var fm = document.getElementById('fab-menu');
  var fab = document.getElementById('mobile-fab');
  if (!fm) return;
  fm.classList.remove('fab-menu-show');
  if (fab) { fab.classList.remove('fab-open'); fab.setAttribute('aria-expanded', 'false'); }
  setTimeout(function() { fm.classList.add('hidden'); }, 200);
}
// Show/hide FAB based on screen size
function updateFabVisibility() {
  var fab = document.getElementById('mobile-fab');
  if (!fab) return;
  if (window.innerWidth < 1024 && !document.getElementById('auth-screen').classList.contains('hidden') === false) {
    fab.classList.remove('hidden');
  } else if (window.innerWidth >= 1024) {
    fab.classList.add('hidden');
    closeFabMenu();
  }
}
window.addEventListener('resize', updateFabVisibility);

function openModal(t, h, wide) {
  // Use innerHTML for title to support icon markup, fallback escaping handled by callers
  var titleEl = document.getElementById('modal-title');
  if (typeof t === 'string' && /<[a-z][^>]*>/i.test(t)) titleEl.innerHTML = t; else titleEl.textContent = t;
  document.getElementById('modal-body').innerHTML = h;
  const mc = document.getElementById('modal-content');
  mc.className = 'modal-box bg-white w-full overflow-y-auto ' + (wide === true || wide === 'wide' ? 'max-w-2xl' : wide === 'narrow' ? 'max-w-md' : 'max-w-lg');
  mc.style.cssText = 'max-height:calc(100dvh - 48px);max-height:calc(100vh - 48px);border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.12)';
  var mdl = document.getElementById('modal');
  mdl.classList.remove('hidden');
  mdl.style.display = 'flex';
  mdl.setAttribute('aria-hidden', 'false');
  // Lock body scroll on mobile when modal opens
  if (window.innerWidth < 1024) document.body.style.overflow = 'hidden';
  // Setup swipe-to-close on mobile
  setupModalSwipeClose(mc);
  // Save current focus for restoration
  window._modalLastFocus = document.activeElement;
  // Move focus into the modal (first focusable element, or content)
  setTimeout(function(){
    var firstFocusable = mc.querySelector('input:not([type=hidden]),textarea,select,button,[href],[tabindex]:not([tabindex="-1"])');
    if (firstFocusable) firstFocusable.focus();
    else mc.focus();
  }, 30);
}

// Swipe down to close modal on mobile (only when scrolled to top)
function setupModalSwipeClose(mc) {
  if (!mc || window.innerWidth >= 1024) return;
  if (mc._swipeBound) return;
  mc._swipeBound = true;
  var startY = 0, currentY = 0, dragging = false;
  mc.addEventListener('touchstart', function(e) {
    if (mc.scrollTop > 0) { dragging = false; return; }
    startY = e.touches[0].clientY;
    currentY = startY;
    dragging = true;
    mc.style.transition = '';
  }, { passive: true });
  mc.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    var diff = currentY - startY;
    if (diff > 0) {
      mc.style.transform = 'translateY(' + diff + 'px)';
      mc.style.opacity = String(Math.max(0.6, 1 - diff / 600));
    }
  }, { passive: true });
  mc.addEventListener('touchend', function() {
    if (!dragging) return;
    dragging = false;
    var diff = currentY - startY;
    mc.style.transition = 'transform .25s var(--ease-smooth), opacity .25s';
    if (diff > 120) {
      // Close
      mc.style.transform = 'translateY(100%)';
      mc.style.opacity = '0';
      setTimeout(function() {
        mc.style.transform = ''; mc.style.opacity = '';
        if (typeof tryCloseModal === 'function') tryCloseModal();
      }, 240);
    } else {
      mc.style.transform = ''; mc.style.opacity = '';
    }
  });
}
function closeModal() {
  var mdl = document.getElementById('modal');
  mdl.classList.add('hidden');
  mdl.style.display = '';
  mdl.setAttribute('aria-hidden', 'true');
  // Unlock body scroll
  document.body.style.overflow = '';
  // Reset modal-content transform/opacity in case swipe was in progress
  var mc = document.getElementById('modal-content');
  if (mc) { mc.style.transform = ''; mc.style.opacity = ''; mc.style.transition = ''; }
  // Restore previous focus
  try { if (window._modalLastFocus && window._modalLastFocus.focus) window._modalLastFocus.focus(); } catch(e) {}
  window._modalLastFocus = null;
}
function tryCloseModal() {
  // 제출 진행 중이면 닫지 않음
  var mc0 = document.getElementById('modal-content');
  if (mc0 && mc0.classList.contains('modal-submitting')) return;
  var form = document.querySelector('#modal-body form');
  if (form) {
    var inputs = form.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea');
    var hasContent = false;
    inputs.forEach(function(el) {
      if (el.value && el.value.trim() !== '' && el.defaultValue !== undefined && el.value !== el.defaultValue) hasContent = true;
      else if (el.value && el.value.trim() !== '' && el.defaultValue === '') hasContent = true;
    });
    if (hasContent) {
      showConfirm('작성 중인 내용이 있습니다', '모달을 닫으면 입력한 내용이 사라집니다. 닫으시겠습니까?', function() { closeModal(); });
      return;
    }
  }
  closeModal();
}

// ===== 모달 form 제출 진행 표시 (progress bar + 버튼 스피너 + 입력 잠금) =====
// 모든 모달 내부의 onsubmit 핸들러를 감싸 자동으로 UX 진행 상태를 적용
function _setModalSubmitting(form, isSubmitting) {
  var modal = document.getElementById('modal');
  if (!modal || modal.classList.contains('hidden')) return;
  var mc = document.getElementById('modal-content');
  var pb = document.getElementById('modal-progress');
  var submitBtns = form.querySelectorAll('button[type="submit"]');
  if (isSubmitting) {
    if (mc) mc.classList.add('modal-submitting');
    if (pb) pb.classList.remove('hidden');
    submitBtns.forEach(function(btn) {
      if (btn._origHtml === undefined) btn._origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      // 기존 아이콘 제거하고 스피너 + "처리 중..." 으로 교체
      btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>처리 중...';
    });
  } else {
    if (mc) mc.classList.remove('modal-submitting');
    if (pb) pb.classList.add('hidden');
    submitBtns.forEach(function(btn) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn._origHtml !== undefined) { btn.innerHTML = btn._origHtml; btn._origHtml = undefined; }
    });
  }
}

// 캡처 단계에서 submit 이벤트를 가로채 진행 UI를 적용하고
// 기존 핸들러가 반환한 Promise(또는 비동기 작업)가 끝나면 해제
document.addEventListener('submit', function(e) {
  var form = e.target;
  if (!form || form.tagName !== 'FORM') return;
  // modal-body 내부의 form만 대상
  if (!form.closest('#modal-body')) return;
  // 이미 진행 중이면 중복 제출 차단
  var mc = document.getElementById('modal-content');
  if (mc && mc.classList.contains('modal-submitting')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  _setModalSubmitting(form, true);

  // 안전장치: 기존 핸들러가 Promise를 반환하지 않더라도
  // (a) closeModal 호출 시 자동 해제, (b) 15초 후 자동 해제, (c) DOM 교체 시 자동 해제
  var releaseTimer = setTimeout(function() {
    try { _setModalSubmitting(form, false); } catch (e) {}
  }, 15000);

  // 다음 마이크로/매크로태스크에 form이 여전히 DOM에 있는지 확인해서 풀어줌
  var poll = setInterval(function() {
    var stillThere = document.body.contains(form);
    var modalHidden = !mc || mc.classList.contains('hidden') || document.getElementById('modal').classList.contains('hidden');
    if (!stillThere || modalHidden) {
      clearInterval(poll);
      clearTimeout(releaseTimer);
      try { _setModalSubmitting(form, false); } catch (e) {}
    }
  }, 200);

  // form에 풀기 함수 노출 (필요 시 핸들러가 명시적으로 호출 가능)
  form._releaseSubmitting = function() {
    clearInterval(poll);
    clearTimeout(releaseTimer);
    try { _setModalSubmitting(form, false); } catch (e) {}
  };
}, true);

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    var modalEl = document.getElementById('modal');
    if (modalEl && !modalEl.classList.contains('hidden')) { tryCloseModal(); }
    var fmEl = document.getElementById('fab-menu');
    if (fmEl && !fmEl.classList.contains('hidden')) { closeFabMenu(); }
    confirmNo(); hideSearchResults();
  }
  // Focus trap for modal: cycle Tab / Shift+Tab inside modal-content
  if (e.key === 'Tab') {
    var modalEl2 = document.getElementById('modal');
    if (modalEl2 && !modalEl2.classList.contains('hidden')) {
      var mc = document.getElementById('modal-content');
      if (mc) {
        var focusables = mc.querySelectorAll('input:not([type=hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])');
        if (focusables.length) {
          var first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); toggleMobileSearch(true); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    if (curPage === 'hospitals') showHospForm();
    else if (curPage === 'meetings') showNewMeetGlobal();
  }
});

// ===== Mobile Search Toggle (모바일에서는 검색 비활성화 — 데스크톱 전용) =====
function toggleMobileSearch(forceOpen) {
  // 데스크톱에서만 동작 (모바일에서는 검색 UI 제거됨)
  if (window.innerWidth < 1024) return;
  const sw = document.getElementById('search-wrap-outer');
  if (!sw) return;
  const isOpen = sw.classList.contains('mobile-search-open');
  if (forceOpen || !isOpen) {
    sw.classList.remove('hidden');
    sw.classList.add('mobile-search-open');
    sw.style.cssText = '';
    setTimeout(() => document.getElementById('global-search')?.focus(), 50);
  } else {
    sw.classList.remove('mobile-search-open');
    sw.classList.add('hidden');
    sw.style.cssText = '';
    hideSearchResults();
  }
}

// 모바일 검색 시트 진입점 (현재는 비활성화 — 검색은 데스크톱에서만)
function openMobileSearchSheet() {
  if (window.innerWidth < 1024) {
    if (typeof toast === 'function') toast('검색은 PC에서 이용 가능합니다', 'info');
    return;
  }
  toggleMobileSearch(true);
}
window.openMobileSearchSheet = openMobileSearchSheet;

// ===== Header More Menu (모바일 전용 더보기) =====
function toggleHeaderMore(e) {
  if (e) e.stopPropagation();
  var menu = document.getElementById('header-more-menu');
  var btn = document.getElementById('header-more-btn');
  if (!menu || !btn) return;
  var isOpen = !menu.classList.contains('hidden');
  if (isOpen) {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  // 메뉴 콘텐츠 빌드
  var savedTheme = localStorage.getItem('todoc_theme') || 'auto';
  var resolved = savedTheme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : savedTheme;
  var themeIcon = resolved === 'dark' ? 'fa-sun' : 'fa-moon';
  var themeLabel = savedTheme === 'auto' ? '시스템 설정' : (resolved === 'dark' ? '다크 모드' : '라이트 모드');
  var headerActions = document.getElementById('header-actions');
  var pageActionsHtml = '';
  if (headerActions && headerActions.children.length > 0) {
    pageActionsHtml = '<div class="hm-section"><div class="hm-label">현재 페이지</div><div id="hm-page-actions" class="hm-page-actions"></div></div>';
  }
  menu.innerHTML =
    pageActionsHtml +
    '<div class="hm-section">' +
      '<button class="hm-item" onclick="toggleTheme();toggleHeaderMore()">' +
        '<i class="fas ' + themeIcon + ' hm-icon"></i>' +
        '<span class="hm-text"><b>테마</b><span class="hm-sub">' + themeLabel + '</span></span>' +
      '</button>' +
    '</div>' +
    '<div class="hm-section hm-user-section" id="hm-user-section"></div>';
  menu.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');

  // 페이지 액션 복제 (헤더 액션 영역의 버튼들을 더보기 메뉴에 표시)
  if (headerActions && headerActions.children.length > 0) {
    var hmPageActions = document.getElementById('hm-page-actions');
    if (hmPageActions) {
      // 원본을 복제하지 않고 직접 이동했다가 복귀시키는 방식 대신, 단순 클론 + 이벤트 리프트
      hmPageActions.innerHTML = headerActions.innerHTML;
      // 클론된 버튼들을 풀-너비/모바일 친화적 스타일로 변환
      Array.from(hmPageActions.querySelectorAll('button')).forEach(function(b) {
        b.classList.remove('btn-sm');
        b.classList.add('hm-action-btn');
        // 클론에서 onclick 닫기 처리 추가
        var orig = b.getAttribute('onclick') || '';
        if (orig && !orig.includes('toggleHeaderMore')) {
          b.setAttribute('onclick', orig + ';toggleHeaderMore()');
        }
      });
    }
  }

  // 유저 메뉴 복제
  var userMenu = document.getElementById('user-menu');
  var hmUser = document.getElementById('hm-user-section');
  if (userMenu && hmUser && currentUser) {
    hmUser.innerHTML =
      '<div class="hm-label">계정</div>' +
      '<div class="hm-user-info">' +
        '<div class="hm-user-name">' + (currentUser.name || '사용자') + '</div>' +
        '<div class="hm-user-email">' + (currentUser.email || '') + '</div>' +
      '</div>' +
      '<button class="hm-item hm-item-danger" onclick="logout();toggleHeaderMore()">' +
        '<i class="fas fa-right-from-bracket hm-icon"></i>' +
        '<span class="hm-text"><b>로그아웃</b></span>' +
      '</button>';
  }
}
window.toggleHeaderMore = toggleHeaderMore;
// 외부 클릭 시 더보기 메뉴 닫기
document.addEventListener('click', function(e) {
  var menu = document.getElementById('header-more-menu');
  var btn = document.getElementById('header-more-btn');
  if (!menu || menu.classList.contains('hidden')) return;
  if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
  menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
});

// ===== Global Search =====
function onGlobalSearch(q) {
  clearTimeout(searchTimer);
  if (!q || q.trim().length < 1) { hideSearchResults(); return; }
  searchTimer = setTimeout(async () => {
    try {
      addSearchHistory(q.trim());
      const { data } = await API.get('/search?q=' + encodeURIComponent(q.trim()));
      renderSearchResults(data.data);
    } catch (e) { }
  }, 250);
}

function renderSearchResults(d) {
  const el = document.getElementById('search-results');
  let html = '';
  const total = (d.hospitals?.length || 0) + (d.doctors?.length || 0) + (d.meetings?.length || 0);
  if (total === 0) { el.innerHTML = '<div class="p-6 text-center text-sm text-slate-400">검색 결과가 없습니다</div>'; el.classList.remove('hidden'); return; }

  if (d.hospitals?.length) {
    html += '<div class="search-cat"><i class="fas fa-hospital mr-1"></i>기관</div>';
    d.hospitals.forEach(h => { html += '<div class="search-item" onclick="hideSearchResults();viewHosp(' + h.id + ')"><div class="si-icon bg-blue-50 text-blue-500"><i class="fas fa-hospital"></i></div><div><div class="font-semibold text-slate-700">' + h.name + '</div><div class="text-[11px] text-slate-400">' + (h.region || '') + '</div></div></div>'; });
  }
  if (d.doctors?.length) {
    html += '<div class="search-cat"><i class="fas fa-user-doctor mr-1"></i>의료진</div>';
    d.doctors.forEach(dc => { html += '<div class="search-item" onclick="hideSearchResults();viewDocProfile(' + dc.id + ')"><div class="si-icon bg-purple-50 text-purple-500"><i class="fas fa-user-doctor"></i></div><div><div class="font-semibold text-slate-700">' + dc.name + ' <span class="text-slate-400 font-normal text-xs">' + (dc.position || '') + '</span></div><div class="text-[11px] text-slate-400">' + (dc.hospital_name || '') + ' · ' + (dc.department || '') + '</div></div></div>'; });
  }
  if (d.meetings?.length) {
    html += '<div class="search-cat"><i class="fas fa-calendar-check mr-1"></i>미팅</div>';
    d.meetings.forEach(m => { html += '<div class="search-item" onclick="hideSearchResults();viewHosp(' + m.hospital_id + ')"><div class="si-icon bg-emerald-50 text-emerald-500"><i class="fas fa-calendar-check"></i></div><div><div class="font-semibold text-slate-700">' + (m.purpose || '미팅') + '</div><div class="text-[11px] text-slate-400">' + (m.doctor_name || '') + ' · ' + fmtShort(m.meeting_date) + '</div></div></div>'; });
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
}
function showSearchResults() { if (document.getElementById('global-search')?.value) onGlobalSearch(document.getElementById('global-search').value); else showSearchHistory(); }
function hideSearchResults() { document.getElementById('search-results')?.classList.add('hidden'); }
document.addEventListener('click', e => { if (!document.getElementById('search-wrap')?.contains(e.target) && !document.getElementById('mobile-search-btn')?.contains(e.target)) { hideSearchResults(); } });

// ===== Helpers =====
function _parseDateOrDateTime(d) {
  if (!d) return null;
  var s = String(d).trim();
  if (!s) return null;
  // datetime form: 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH:MM:SS(...)?
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    var iso = s.replace(' ', 'T');
    var dt = new Date(iso);
    if (!isNaN(dt.getTime())) return dt;
    return null;
  }
  // date-only form: 'YYYY-MM-DD'
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var dt2 = new Date(s + 'T00:00:00');
    if (!isNaN(dt2.getTime())) return dt2;
    return null;
  }
  // fallback
  var dt3 = new Date(s);
  return isNaN(dt3.getTime()) ? null : dt3;
}
function fmtDate(d) { var dt = _parseDateOrDateTime(d); if (!dt) return '-'; return dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) }
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function fmtShort(d) {
  var dt = _parseDateOrDateTime(d);
  if (!dt) return '-';
  var s = String(d).trim();
  // Include time when datetime is given
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    return dt.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return dt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}
function fmtMonthLabel(m) { if (!m) return ''; const [y, mo] = m.split('-'); return parseInt(mo) + '월' }
function daysAgo(d) { if (!d) return ''; var now = new Date(); var todayKST = new Date(now.getFullYear(), now.getMonth(), now.getDate()); var target = new Date(d + 'T00:00:00'); var diff = Math.round((todayKST.getTime() - target.getTime()) / 86400000); if (diff === 0) return '오늘'; if (diff < 0) return Math.abs(diff) + '일 후'; return diff + '일 전' }
function daysUntil(d) { if (!d) return Infinity; var now = new Date(); var todayKST = new Date(now.getFullYear(), now.getMonth(), now.getDate()); var target = new Date(d + 'T00:00:00'); return Math.round((target.getTime() - todayKST.getTime()) / 86400000) }
function daysClass(d) { if (!d) return ''; var now = new Date(); var todayKST = new Date(now.getFullYear(), now.getMonth(), now.getDate()); var target = new Date(d + 'T00:00:00'); var diff = Math.round((todayKST.getTime() - target.getTime()) / 86400000); if (diff > 30) return 'text-red-500'; if (diff > 14) return 'text-amber-500'; return 'text-slate-400' }
function statusDot(s) { return s === 'active' ? '<span class="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold px-2 py-0.5 bg-emerald-50 rounded-full"><i class="fas fa-check-circle text-[9px]"></i>코드등록</span>' : '<span class="inline-flex items-center gap-1.5 text-[11px] text-amber-600 font-semibold px-2 py-0.5 bg-amber-50 rounded-full"><i class="fas fa-clock text-[9px]"></i>미등록</span>' }
function infBadge(l) { return { high: '<span class="inf-high"><i class="fas fa-fire text-[9px]"></i> 핵심</span>', medium: '<span class="inf-medium"><i class="fas fa-star text-[9px]"></i> 주요</span>', low: '<span class="inf-low">일반</span>' }[l] || l }
function mtBadge(t) { const m = { visit: ['방문', 'mt-visit', 'fa-building'], phone: ['전화', 'mt-phone', 'fa-phone'], conference: ['학회', 'mt-conference', 'fa-users'], email: ['이메일', 'mt-email', 'fa-envelope'], online: ['온라인', 'mt-online', 'fa-video'] }; const v = m[t] || ['기타', 'mt-visit', 'fa-circle']; return '<span class="mt ' + v[1] + '"><i class="fas ' + v[2] + ' text-[9px]"></i>' + v[0] + '</span>' }
function vtBadge(vt) {
  if (!vt) return '';
  var map = {
    am:   { label: '오전', icon: 'fa-sun',         bg: '#fff7ed', fg: '#c2410c', bd: '#fed7aa' },
    pm:   { label: '오후', icon: 'fa-cloud-sun',   bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' },
    full: { label: '종일', icon: 'fa-clock',       bg: '#f3e8ff', fg: '#7e22ce', bd: '#e9d5ff' }
  };
  var v = map[vt]; if (!v) return '';
  return '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md" style="background:' + v.bg + ';color:' + v.fg + ';border:1px solid ' + v.bd + '"><i class="fas ' + v.icon + ' text-[8px]"></i>' + v.label + '</span>';
}

// ===== Team Calendar — User color mapping =====
// Generates a stable color for a user based on their id (HSL palette, accessible)
var USER_COLOR_PALETTE = [
  { bg: '#dbeafe', fg: '#1e40af', dot: '#3b82f6' }, // blue
  { bg: '#fce7f3', fg: '#9d174d', dot: '#ec4899' }, // pink
  { bg: '#dcfce7', fg: '#166534', dot: '#22c55e' }, // green
  { bg: '#fef3c7', fg: '#92400e', dot: '#f59e0b' }, // amber
  { bg: '#ede9fe', fg: '#5b21b6', dot: '#8b5cf6' }, // violet
  { bg: '#cffafe', fg: '#155e75', dot: '#06b6d4' }, // cyan
  { bg: '#fee2e2', fg: '#991b1b', dot: '#ef4444' }, // red
  { bg: '#e0e7ff', fg: '#3730a3', dot: '#6366f1' }, // indigo
  { bg: '#d1fae5', fg: '#065f46', dot: '#10b981' }, // emerald
  { bg: '#fed7aa', fg: '#9a3412', dot: '#f97316' }, // orange
];
function userColor(uid) {
  if (uid == null) return { bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' };
  var idx = Math.abs(Number(uid) || 0) % USER_COLOR_PALETTE.length;
  return USER_COLOR_PALETTE[idx];
}
function userDots(users, max) {
  if (!users || !users.length) return '';
  max = max || 3;
  var arr = users.slice(0, max);
  var html = '<span class="inline-flex items-center -space-x-0.5">';
  arr.forEach(function(u) {
    var c = userColor(u.user_id || u.id);
    var nm = (u.user_name || u.name || '?').charAt(0);
    html += '<span class="inline-flex items-center justify-center rounded-full text-[7px] font-bold border border-white" style="width:13px;height:13px;background:' + c.dot + ';color:#fff" title="' + (u.user_name || u.name || '') + '" aria-label="' + (u.user_name || u.name || '') + '">' + nm + '</span>';
  });
  if (users.length > max) html += '<span class="inline-flex items-center justify-center rounded-full text-[7px] font-bold border border-white" style="width:13px;height:13px;background:#94a3b8;color:#fff">+' + (users.length - max) + '</span>';
  html += '</span>';
  return html;
}
// User filter state for team calendar
window._calUserFilter = window._calUserFilter || 'all';

// ===== Dashboard Widget Customization =====
// Each widget has a stable id. Hidden ids are stored in localStorage.
var DASH_WIDGETS = [
  { id: 'todayTasks',     label: '오늘의 할 일',        icon: 'fa-bolt',           desc: '오늘 미팅 / 지연 액션 / 미작성 / 후속' },
  { id: 'myKpi',          label: '나의 KPI / 팀 랭킹',  icon: 'fa-user-shield',    desc: '개인 활동 KPI 및 팀 랭킹' },
  { id: 'reminders',      label: '미팅 리마인더',       icon: 'fa-bell',           desc: '7일 이내 예정된 미팅 알림' },
  { id: 'stats',          label: '통계 요약 카드',      icon: 'fa-chart-simple',   desc: '관리 기관 / 코드 / 의료진 / 미팅 등 6개' },
  { id: 'codeRegistration', label: '병원코드 등록률',   icon: 'fa-id-card',        desc: '코드 등록 진행률 미터' },
  { id: 'pipelineSummary', label: '파이프라인 현황',    icon: 'fa-filter',         desc: '단계별 기관 수 카운트' },
  { id: 'thisWeek',       label: '이번 주 일정',        icon: 'fa-calendar-week',  desc: '이번 주 예정 미팅 리스트' },
  { id: 'longInactive',   label: '장기 미접촉 기관',    icon: 'fa-triangle-exclamation', desc: '30일+ 미팅 없는 기관' },
  { id: 'kpiGauge',       label: 'KPI 달성률',          icon: 'fa-bullseye',       desc: '월간 KPI 게이지' },
  { id: 'ciKpi',          label: 'CI 시장 현황',        icon: 'fa-chart-line',     desc: '인공와우 시장 KPI 배너' },
  { id: 'recentHighlights', label: '최근 등록 기관/의료진', icon: 'fa-plus',         desc: '14일 이내 신규 등록' },
  { id: 'monthlyTrend',   label: '월별 미팅 추이',      icon: 'fa-chart-bar',      desc: '최근 6개월 추이 차트' },
  { id: 'recentMeetings', label: '최근 미팅',           icon: 'fa-clock',          desc: '최근 8건' },
  { id: 'upcomingActions', label: '후속 액션',          icon: 'fa-list-check',     desc: '예정된 액션 리스트' },
  { id: 'regionStats',    label: '지역별 현황',         icon: 'fa-map-location-dot', desc: '지역별 기관 분포' }
];
function getHiddenWidgets() {
  try { return JSON.parse(localStorage.getItem('todoc_dash_hidden') || '[]') || []; }
  catch(e) { return []; }
}
function setHiddenWidgets(arr) {
  try { localStorage.setItem('todoc_dash_hidden', JSON.stringify(arr || [])); } catch(e) {}
}
function isWidgetHidden(id) { return getHiddenWidgets().indexOf(id) >= 0; }
function widgetWrap(id, html) {
  if (!html || isWidgetHidden(id)) return '';
  return '<div data-widget="' + id + '">' + html + '</div>';
}
function showWidgetSettings() {
  var hidden = getHiddenWidgets();
  var rows = DASH_WIDGETS.map(function(w) {
    var checked = hidden.indexOf(w.id) < 0 ? 'checked' : '';
    return '<label class="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer border border-gray-100 transition" style="display:flex">' +
      '<input type="checkbox" data-widget-id="' + w.id + '" ' + checked + ' class="mt-1 w-4 h-4 accent-blue-600">' +
      '<div class="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style="background:#eef4ff"><i class="fas ' + w.icon + ' text-brand-600 text-[11px]"></i></div>' +
      '<div class="flex-1 min-w-0"><div class="font-semibold text-[13px] text-slate-800">' + w.label + '</div><div class="text-[11px] text-slate-400 truncate">' + w.desc + '</div></div>' +
      '</label>';
  }).join('');
  openModal('대시보드 위젯 설정',
    '<div class="space-y-3">' +
      '<div class="text-[11px] text-slate-500 leading-relaxed bg-blue-50 px-3 py-2 rounded-lg border border-blue-100"><i class="fas fa-info-circle text-blue-500 mr-1"></i>표시할 위젯을 선택하세요. 설정은 이 브라우저에 저장됩니다.</div>' +
      '<div id="widget-settings-list" class="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">' + rows + '</div>' +
      '<div class="flex justify-between items-center gap-2 pt-3 border-t border-gray-100">' +
        '<button type="button" class="btn btn-ghost btn-sm" onclick="resetWidgetSettings()"><i class="fas fa-rotate-left text-xs mr-1"></i>모두 표시</button>' +
        '<div class="flex gap-2"><button type="button" class="btn btn-outline" onclick="closeModal()">취소</button><button type="button" class="btn btn-primary" onclick="saveWidgetSettings()">저장</button></div>' +
      '</div>' +
    '</div>'
  );
}
function saveWidgetSettings() {
  var inputs = document.querySelectorAll('#widget-settings-list input[type="checkbox"]');
  var hidden = [];
  inputs.forEach(function(inp) {
    if (!inp.checked) hidden.push(inp.getAttribute('data-widget-id'));
  });
  setHiddenWidgets(hidden);
  toast('대시보드 설정 저장됨');
  closeModal();
  if (typeof loadDash === 'function') loadDash();
}
function resetWidgetSettings() {
  setHiddenWidgets([]);
  var inputs = document.querySelectorAll('#widget-settings-list input[type="checkbox"]');
  inputs.forEach(function(inp) { inp.checked = true; });
  toast('모든 위젯 표시로 초기화');
}

// ===== Quick Action Bar — Today's Tasks =====
function renderTodayTasks(t) {
  if (!t) return '';
  var today = (t.todayMeetings || []), overdue = (t.overdueActions || []), unwritten = (t.unwrittenMeetings || []), upfu = (t.dueFollowups || []);
  var total = today.length + overdue.length + unwritten.length + upfu.length;
  if (total === 0) {
    return '<div class="card-flat p-4 flex items-center gap-3" style="background:linear-gradient(135deg,#ecfdf5,#f0fdfa);border-left:3px solid #10b981">' +
      '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:#fff;color:#059669"><i class="fas fa-circle-check text-base"></i></div>' +
      '<div class="flex-1 min-w-0"><div class="font-bold text-[13px] text-slate-800">오늘의 할 일이 모두 정리되었습니다</div><div class="text-[11px] text-slate-500">오늘 예정 미팅, 미작성 결과, 지연 액션이 없습니다</div></div>' +
      '<button class="btn btn-success btn-sm" onclick="showNewMeetGlobal()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">미팅 추가</span></button>' +
      '</div>';
  }

  function row(items, type, color, icon, label, emptyMsg) {
    if (!items.length) return '';
    return '<div class="border-t border-gray-100 first:border-t-0">' +
      '<div class="px-4 lg:px-5 py-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider" style="color:' + color + ';background:' + color + '08">' +
        '<i class="fas ' + icon + ' text-[10px]"></i>' + label +
        '<span class="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold" style="background:' + color + ';color:#fff">' + items.length + '</span>' +
      '</div>' +
      '<div class="divide-y divide-gray-50">' + items.slice(0, 5).map(function(m) {
        var mDate = type === 'overdue' || type === 'upcoming_followup' ? m.next_meeting_date : m.meeting_date;
        var du = daysUntil(mDate);
        var duLabel = du === 0 ? '오늘' : du === 1 ? '내일' : du > 0 ? '+' + du + '일' : Math.abs(du) + '일 지연';
        var actionBtn = '';
        if (type === 'today') {
          // 오늘 미팅 → 결과 작성 버튼
          actionBtn = '<button class="btn btn-success btn-sm flex-shrink-0" onclick="event.stopPropagation();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || []).replace(/"/g, '&quot;') + ',' + m.id + ')" aria-label="결과 작성"><i class="fas fa-pen text-xs"></i><span class="hidden sm:inline">작성</span></button>';
        } else if (type === 'overdue') {
          // 지연된 후속 → 결과 작성 또는 일정 변경
          actionBtn = '<button class="btn btn-outline btn-sm flex-shrink-0" onclick="event.stopPropagation();showMeetFormForConvert(' + m.id + ')" aria-label="후속 미팅 작성"><i class="fas fa-calendar-check text-xs"></i><span class="hidden sm:inline">처리</span></button>';
        } else if (type === 'unwritten') {
          // 결과 미작성 → 결과 입력
          actionBtn = '<button class="btn btn-primary btn-sm flex-shrink-0" onclick="event.stopPropagation();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || []).replace(/"/g, '&quot;') + ',' + m.id + ')" aria-label="결과 입력"><i class="fas fa-edit text-xs"></i><span class="hidden sm:inline">입력</span></button>';
        } else if (type === 'upcoming_followup') {
          // 다가오는 후속 → 미팅 변환
          actionBtn = '<button class="btn btn-outline btn-sm flex-shrink-0" onclick="event.stopPropagation();showMeetFormForConvert(' + m.id + ')" aria-label="미팅 작성"><i class="fas fa-calendar-plus text-xs"></i><span class="hidden sm:inline">진행</span></button>';
        }
        return '<div class="px-4 lg:px-5 py-2.5 flex items-center gap-3 tr cursor-pointer" onclick="viewHosp(' + m.hospital_id + ')">' +
          '<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5 mb-0.5 flex-wrap"><span class="font-semibold text-[13px] text-slate-800 truncate">' + (meetDoctorNames(m) || '-') + '</span>' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + '</div>' +
          '<div class="text-[11px] text-slate-400 truncate">' + (m.hospital_name || '') + (m.purpose ? ' · ' + m.purpose : '') + '</div></div>' +
          '<div class="text-right flex-shrink-0 hidden sm:block"><div class="text-[11px] font-bold ' + (du < 0 ? 'text-red-500' : du === 0 ? 'text-amber-600' : 'text-slate-500') + '">' + duLabel + '</div><div class="text-[10px] text-slate-400">' + fmtShort(mDate) + '</div></div>' +
          actionBtn +
          '</div>';
      }).join('') +
      (items.length > 5 ? '<div class="px-4 py-2 text-[11px] text-slate-400 text-center">외 ' + (items.length - 5) + '건</div>' : '') +
      '</div>' +
      '</div>';
  }

  return '<div class="card-flat p-0 overflow-hidden" style="border-left:3px solid #2563eb">' +
    '<div class="px-4 lg:px-5 py-3 flex items-center gap-2.5" style="background:linear-gradient(135deg,#eff6ff,#eef2ff);border-bottom:1px solid #dbeafe">' +
      '<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#3b7bf7,#2563eb)"><i class="fas fa-bolt text-white text-xs"></i></div>' +
      '<span class="font-bold text-[14px] text-slate-800 tracking-tight">오늘의 할 일</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:#2563eb;color:#fff">' + total + '건</span>' +
      '<button class="ml-auto btn btn-ghost btn-sm" onclick="loadDash()" aria-label="새로고침"><i class="fas fa-arrows-rotate text-xs"></i></button>' +
    '</div>' +
    row(today, 'today', '#dc2626', 'fa-calendar-day', '오늘 예정 미팅') +
    row(overdue, 'overdue', '#d97706', 'fa-triangle-exclamation', '지연된 후속 액션') +
    row(unwritten, 'unwritten', '#2563eb', 'fa-pen-to-square', '결과 미작성 (최근 7일)') +
    row(upfu, 'upcoming_followup', '#7c3aed', 'fa-forward', '다가오는 후속 (3일 내)') +
    '</div>';
}
function avatar(ph, nm, extra) { const st = extra ? 'style="' + extra + '"' : ''; if (ph) return '<div class="avatar" ' + st + '><img src="' + ph + '" alt=""></div>'; const c = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#60a5fa', '#a78bfa']; const i = (nm || '?').charCodeAt(0) % c.length; return '<div class="avatar" ' + st + ' style="background:' + c[i] + ';color:#fff;' + (extra || '') + '">' + (nm || '?').charAt(0) + '</div>' }
function field(l, n, tp, v, opts) {
  if (tp === 'select') return '<div><label class="input-label">' + l + '</label><select name="' + n + '" class="input">' + opts.map(o => '<option value="' + o.v + '"' + (o.v == v ? ' selected' : '') + '>' + o.l + '</option>').join('') + '</select></div>';
  if (tp === 'textarea') return '<div class="col-span-2"><label class="input-label">' + l + '</label><textarea name="' + n + '" class="input">' + (v || '') + '</textarea></div>';
  return '<div><label class="input-label">' + l + '</label><input type="' + tp + '" name="' + n + '" value="' + (v || '') + '" class="input" placeholder="' + l.replace(' *', '') + '"></div>';
}
function skeleton(rows) { let h = ''; for (let i = 0; i < rows; i++) h += '<div class="flex items-center gap-4 p-5"><div class="skeleton rounded-xl" style="width:40px;height:40px"></div><div class="flex-1 space-y-2"><div class="skeleton rounded h-4" style="width:' + (60 + Math.random() * 30) + '%"></div><div class="skeleton rounded h-3" style="width:' + (30 + Math.random() * 20) + '%"></div></div></div>'; return h }
function fmtAmount(v) {
  // v is in 천원 (thousands of won). 100000천원 = 1000억원
  var won = v * 1000; // convert to won
  if (won >= 1000000000000) return (won / 1000000000000).toFixed(1) + '조원';
  if (won >= 100000000) return (won / 100000000).toFixed(1) + '억원';
  if (won >= 10000) return (won / 10000).toFixed(0) + '만원';
  return fmtNum(won) + '원';
}
function fmtNum(n) { return n.toLocaleString('ko-KR') }
function infoRow(label, val) { return '<div class="flex items-center justify-between py-1"><span class="text-[12px] text-slate-400">' + label + '</span><span class="text-[13px] font-medium text-slate-700">' + (val || '-') + '</span></div>' }

// ===== CSV/XLSX Download =====
function _withSid(qs) {
  var sid = localStorage.getItem('todoc_session') || '';
  var pair = sid ? ('sid=' + encodeURIComponent(sid)) : '';
  if (!pair) return qs || '';
  return qs ? (qs + '&' + pair) : pair;
}
function downloadCSV(type, qs) {
  var q = _withSid(qs);
  window.open('/api/export/' + type + (q ? ('?' + q) : ''), '_blank');
}
function downloadXLSX(type, qs) {
  var q = _withSid(qs);
  window.open('/api/export/xlsx/' + type + (q ? ('?' + q) : ''), '_blank');
}
function downloadFullReport() {
  var q = _withSid('');
  window.open('/api/export/report/full' + (q ? ('?' + q) : ''), '_blank');
}
// 제품 관리 전용 내보내기 메뉴 (재고 현황 + 이동 이력)
function productExportMenu() {
  var id = 'expmenu_products_' + Math.random().toString(36).slice(2,7);
  return '<div class="relative inline-block" id="' + id + '">'
    + '<button class="btn btn-outline btn-sm" onclick="(function(e){e.stopPropagation();var m=document.getElementById(\''+id+'\').querySelector(\'.exp-menu\');var open=!m.classList.contains(\'hidden\');document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')});if(!open)m.classList.remove(\'hidden\');})(event)" aria-label="제품 내보내기" title="Excel/CSV 내보내기"><i class="fas fa-file-export text-xs" aria-hidden="true"></i><span class="hidden sm:inline ml-1">내보내기</span></button>'
    + '<div class="exp-menu hidden absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50" style="min-width:220px" role="menu">'
    + '<div class="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">제품 재고 현황</div>'
    + '<button role="menuitem" class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2" onclick="downloadProductExport(\'products\',\'xlsx\');document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')})"><i class="fas fa-file-excel text-emerald-600" aria-hidden="true"></i>Excel (.xls) — 현재 필터 반영</button>'
    + '<div class="border-t border-slate-100 my-1"></div>'
    + '<div class="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">제품 이동 이력</div>'
    + '<button role="menuitem" class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2" onclick="downloadProductExport(\'product_movements\',\'xlsx\');document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')})"><i class="fas fa-file-excel text-emerald-600" aria-hidden="true"></i>Excel (.xls)</button>'
    + '<button role="menuitem" class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2" onclick="downloadProductMovementsCsv();document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')})"><i class="fas fa-file-csv text-slate-600" aria-hidden="true"></i>CSV (.csv)</button>'
    + '</div></div>';
}
function downloadProductExport(type, fmt) {
  var qs = [];
  // 현재 탭(카테고리) 필터를 반영 (재고에만 적용)
  if (type === 'products' && window._prodTab && window._prodTab !== 'all') {
    qs.push('category=' + encodeURIComponent(window._prodTab));
  }
  // 이력 화면의 날짜/유형 필터 반영
  if (type === 'product_movements') {
    var f = window._prodFilter || {};
    if (f.from) qs.push('from=' + encodeURIComponent(f.from));
    if (f.to) qs.push('to=' + encodeURIComponent(f.to));
    if (f.movement_type) qs.push('movement_type=' + encodeURIComponent(f.movement_type));
  }
  var q = _withSid(qs.join('&'));
  window.open('/api/export/xlsx/' + type + (q ? ('?' + q) : ''), '_blank');
}
function downloadProductMovementsCsv() {
  var qs = [];
  var f = window._prodFilter || {};
  if (f.from) qs.push('from=' + encodeURIComponent(f.from));
  if (f.to) qs.push('to=' + encodeURIComponent(f.to));
  if (f.movement_type) qs.push('type=' + encodeURIComponent(f.movement_type));
  var q = _withSid(qs.join('&'));
  window.open('/api/products/movements/export.csv' + (q ? ('?' + q) : ''), '_blank');
}
function exportMenu(type, label) {
  // Returns HTML for a unified export dropdown button
  const id = 'expmenu_' + type + '_' + Math.random().toString(36).slice(2,7);
  return '<div class="relative inline-block" id="' + id + '">'
    + '<button class="btn btn-outline btn-sm" onclick="(function(e){e.stopPropagation();var m=document.getElementById(\''+id+'\').querySelector(\'.exp-menu\');var open=!m.classList.contains(\'hidden\');document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')});if(!open)m.classList.remove(\'hidden\');})(event)" aria-label="' + (label || '내보내기') + ' 내보내기"><i class="fas fa-file-export text-xs" aria-hidden="true"></i><span class="hidden sm:inline">내보내기</span></button>'
    + '<div class="exp-menu hidden absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50" style="min-width:180px" role="menu">'
    + '<button role="menuitem" class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2" onclick="downloadXLSX(\'' + type + '\');document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')})"><i class="fas fa-file-excel text-emerald-600" aria-hidden="true"></i>Excel (.xls)</button>'
    + '<button role="menuitem" class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2" onclick="downloadCSV(\'' + type + '\');document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')})"><i class="fas fa-file-csv text-slate-600" aria-hidden="true"></i>CSV (.csv)</button>'
    + '<div class="border-t border-slate-100 my-1"></div>'
    + '<button role="menuitem" class="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2" onclick="downloadFullReport();document.querySelectorAll(\'.exp-menu\').forEach(function(x){x.classList.add(\'hidden\')})" title="요약 + 기관/의료진/미팅/활동로그를 포함한 통합 보고서"><i class="fas fa-file-invoice text-brand-500" aria-hidden="true"></i>통합 보고서</button>'
    + '</div></div>';
}
document.addEventListener('click', function() { document.querySelectorAll('.exp-menu').forEach(function(x){x.classList.add('hidden')}); });

// ===== DASHBOARD =====
let dashCharts = [];
function destroyDashCharts() { dashCharts.forEach(c => { try { c.destroy() } catch(e) {} }); dashCharts = []; }

async function loadDash() {
  destroyDashCharts();
  document.getElementById('page-title').textContent = '대시보드';
  document.getElementById('page-subtitle').textContent = '';
  document.getElementById('header-actions').innerHTML = 
    '<select id="dash-period" class="input !py-1.5 !text-xs !w-auto !pr-7" onchange="_dashPeriod=this.value;loadDash()" style="max-width:110px;border-radius:8px" aria-label="기간 선택"><option value="month"' + (_dashPeriod==='month'?' selected':'') + '>이번 달</option><option value="quarter"' + (_dashPeriod==='quarter'?' selected':'') + '>이번 분기</option><option value="year"' + (_dashPeriod==='year'?' selected':'') + '>올해</option></select>' +
    '<button class="btn btn-outline btn-sm" onclick="showReportPreview()" title="주/월간 보고서"><i class="fas fa-file-lines text-xs" aria-hidden="true"></i><span class="hidden sm:inline">보고서</span></button>' +
    '<button class="btn btn-outline btn-sm" onclick="showPipelineAnalytics()" title="파이프라인 전환 분석"><i class="fas fa-diagram-project text-xs" aria-hidden="true"></i><span class="hidden sm:inline">전환 분석</span></button>' +
    '<button class="btn btn-outline btn-sm" onclick="showPipelineView()"><i class="fas fa-columns text-xs" aria-hidden="true"></i><span class="hidden sm:inline">파이프라인</span></button>' +
    '<button class="btn btn-ghost btn-sm" onclick="showWidgetSettings()" title="대시보드 위젯 설정" aria-label="대시보드 위젯 설정"><i class="fas fa-sliders text-xs" aria-hidden="true"></i><span class="hidden sm:inline">위젯</span></button>' +
    '<button class="btn btn-success btn-sm" onclick="showNewMeetGlobal()"><i class="fas fa-calendar-plus text-xs" aria-hidden="true"></i><span class="hidden sm:inline">빠른 미팅</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 space-y-6"><div class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">' + Array(4).fill('<div class="sc"><div class="flex items-center gap-3"><div class="skeleton" style="width:42px;height:42px;border-radius:10px"></div><div class="flex-1 space-y-2"><div class="skeleton" style="height:10px;width:50px;border-radius:4px"></div><div class="skeleton" style="height:20px;width:64px;border-radius:4px"></div></div></div></div>').join('') + '</div><div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div class="card-flat p-5"><div class="skeleton" style="height:14px;width:120px;border-radius:4px;margin-bottom:12px"></div><div class="skeleton" style="height:10px;width:100%;border-radius:6px"></div></div><div class="card-flat p-5"><div class="skeleton" style="height:14px;width:120px;border-radius:4px;margin-bottom:12px"></div><div class="flex gap-2">' + Array(4).fill('<div class="skeleton flex-1" style="height:48px;border-radius:8px"></div>').join('') + '</div></div></div></div>';
  try {
    const { data: d } = await API.get('/dashboard?period=' + _dashPeriod); const s = d.data;
    // Update reminder badge
    updateReminderBadge(s.reminderCount || s.reminders?.length || 0);
    const C = document.getElementById('content');
    // Month comparison
    const monthDiff = s.stats.lastMonthMeetings > 0 ? ((s.stats.monthMeetings - s.stats.lastMonthMeetings) / s.stats.lastMonthMeetings * 100).toFixed(0) : (s.stats.monthMeetings > 0 ? '+100' : '0');
    const monthDiffText = monthDiff > 0 ? '<span class="text-emerald-500 text-[10px] font-bold">+' + monthDiff + '% ↑</span>' : (monthDiff < 0 ? '<span class="text-red-500 text-[10px] font-bold">' + monthDiff + '% ↓</span>' : '<span class="text-slate-400 text-[10px]">변동없음</span>');
    
    // Pipeline stage labels
    var pipeLabels = { contact: '첫 접촉', meeting: '미팅 진행', demo: '데모', proposal: '제안', contract: '계약', active_customer: '활성 거래처' };
    var pipeColors = { contact: '#94a3b8', meeting: '#3b82f6', demo: '#8b5cf6', proposal: '#f59e0b', contract: '#059669', active_customer: '#2563eb' };

    C.innerHTML = '<div class="p-4 lg:p-7 fade-in space-y-5">' +
      // ===== Quick Action Bar (오늘의 할 일) =====
      widgetWrap('todayTasks', renderTodayTasks(s.todayTasks)) +
      // ===== Personal KPI + Team Ranking =====
      widgetWrap('myKpi', '<div id="my-kpi-section" class="grid grid-cols-1 lg:grid-cols-3 gap-4">' +
        '<div id="my-kpi-card" class="lg:col-span-2 card-flat p-5"><div class="skeleton" style="height:14px;width:140px;border-radius:4px;margin-bottom:12px"></div><div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' + Array(4).fill('<div class="skeleton" style="height:60px;border-radius:10px"></div>').join('') + '</div></div>' +
        '<div id="team-rank-card" class="card-flat p-5"><div class="skeleton" style="height:14px;width:120px;border-radius:4px;margin-bottom:12px"></div>' + Array(4).fill('<div class="skeleton" style="height:36px;border-radius:8px;margin-bottom:6px"></div>').join('') + '</div>' +
      '</div>') +
      // Reminder banner
      (s.reminders?.length && !isWidgetHidden('reminders') ? '<div class="reminder-banner" data-widget="reminders"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style="background:rgba(255,255,255,.12)"><i class="fas fa-bell text-white text-lg animate-bounce-gentle"></i></div><div class="flex-1 min-w-0"><div class="font-bold text-white text-sm mb-0.5">미팅 리마인더</div><div class="text-white/70 text-xs">앞으로 7일 이내 예정된 미팅이 <strong class="text-white">' + s.reminders.length + '건</strong> 있습니다</div></div></div>' +
        '<div class="mt-3 space-y-2">' + s.reminders.map(r => {
          const rdate = r.reminder_type === 'scheduled' ? r.meeting_date : r.next_meeting_date;
          const du = daysUntil(rdate);
          const urgency = du <= 1 ? 'bg-red-500/30 border-red-400/50' : du <= 3 ? 'bg-amber-500/20 border-amber-400/40' : 'bg-white/10 border-white/20';
          const typeLabel = r.reminder_type === 'scheduled' ? '<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-white/15 text-white/80">플래너</span>' : '';
          const userLabel = r.user_names ? '<span class="text-white/50 text-[10px] ml-1">[' + r.user_names + ']</span>' : '';
          const todayBtn = du === 0 ? '<button class="ml-2 px-2 py-0.5 rounded bg-white/25 hover:bg-white/40 text-white text-[10px] font-bold transition" onclick="event.stopPropagation();showMeetFormGlobal(' + r.hospital_id + ',' + JSON.stringify(r.doctor_ids || []).replace(/"/g, '&quot;') + ',' + r.id + ')"><i class="fas fa-pen mr-0.5"></i>작성</button>' : '';
          return '<div class="flex items-center gap-3 px-3 py-2 rounded-lg border ' + urgency + ' cursor-pointer" onclick="viewHosp(' + r.hospital_id + ')">' +
            '<div class="text-white/90 text-sm flex-1 min-w-0 truncate"><span class="font-semibold">' + meetDoctorNames(r) + '</span>' + (r.doctors && r.doctors.length > 1 ? '<span class="text-[10px] text-white/50 ml-1">(' + r.doctors.length + '명)</span>' : '') + typeLabel + userLabel + ' <span class="text-white/60">· ' + (r.hospital_name || '') + '</span>' + todayBtn + '</div>' +
            '<div class="text-right flex-shrink-0"><div class="text-white font-bold text-sm">' + fmtShort(rdate) + '</div><div class="text-white/70 text-[10px]">' + (du === 0 ? '오늘!' : du === 1 ? '내일' : du + '일 후') + '</div></div></div>'
        }).join('') + '</div></div>' : '') +

      // ===== Stats overview row =====
      widgetWrap('stats', '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">' +
      sc('관리 기관', s.stats.hospitalsAll || s.stats.hospitals, '개', 'fa-hospital', '#2563eb', '#eef4ff', 'hospitals') +
      sc('코드 등록', s.stats.codeRegistered || 0, '개', 'fa-check-circle', '#059669', '#ecfdf5', 'hospitals') +
      sc('등록 의료진', s.stats.doctors, '명', 'fa-user-doctor', '#7c3aed', '#f5f3ff', 'doctors') +
      sc('총 미팅', s.stats.meetings, '건', 'fa-handshake', '#0891b2', '#ecfeff', 'meetings') +
      sc('이번 달', s.stats.monthMeetings, '건', 'fa-calendar-day', '#d97706', '#fffbeb', 'meetings') +
      '<div class="sc cursor-pointer" onclick="nav(\'meetings\')">' +
        '<div class="flex items-center gap-3">' +
          '<div class="sc-icon" style="background:#fef2f2"><i class="fas fa-chart-simple" style="color:#ef4444"></i></div>' +
          '<div><p class="text-[11px] text-slate-400 font-medium mb-0.5">전월 대비</p>' +
            '<div class="flex items-baseline gap-1">' + monthDiffText + '</div>' +
          '</div></div></div>' +
      '</div>') +

      // ===== Hospital Code Registration + Pipeline Summary =====
      (function() {
        var codeHtml = widgetWrap('codeRegistration', '<div class="card-flat p-5">' +
          '<div class="flex items-center gap-2.5 mb-4"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#ecfdf5,#d1fae5)"><i class="fas fa-id-card text-emerald-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">병원코드 등록 현황</span></div>' +
          (function() {
            var reg = s.stats.codeRegistered || 0, unreg = s.stats.codeUnregistered || 0, total = reg + unreg;
            var pct = total > 0 ? Math.round(reg / total * 100) : 0;
            return '<div class="flex items-center gap-4 mb-3"><div class="flex-1"><div class="flex justify-between text-[11px] mb-1.5"><span class="text-slate-500 font-medium">등록완료 <strong class="text-emerald-600">' + reg + '</strong></span><span class="text-slate-500 font-medium">미등록 <strong class="text-amber-600">' + unreg + '</strong></span></div><div class="w-full bg-gray-100 rounded-full h-3.5 overflow-hidden"><div class="h-3.5 rounded-full transition-all duration-700" style="width:' + pct + '%;background:linear-gradient(90deg,#10b981,#059669)"></div></div></div><div class="text-right pl-2"><span class="text-2xl font-extrabold text-emerald-600 tracking-tight">' + pct + '</span><span class="text-[11px] text-emerald-600 font-bold">%</span></div></div>';
          })() +
        '</div>');
        var pipeHtml = widgetWrap('pipelineSummary', '<div class="card-flat p-5">' +
          '<div class="flex items-center justify-between mb-4"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe)"><i class="fas fa-filter text-violet-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">파이프라인 현황</span></div><button class="text-[11px] text-brand-500 font-bold hover:text-brand-600 transition" onclick="showPipelineView()">상세보기 <i class="fas fa-chevron-right text-[8px] ml-0.5"></i></button></div>' +
          '<div class="flex gap-2 flex-wrap">' + (function() {
            var pipeOrder = ['contact','meeting','demo','proposal','contract','active_customer'];
            var pipeMap = {};
            (s.pipelineSummary || []).forEach(function(p) { pipeMap[p.pipeline_stage] = p.count; });
            return pipeOrder.map(function(stage) {
              var label = pipeLabels[stage] || stage;
              var color = pipeColors[stage] || '#94a3b8';
              var count = pipeMap[stage] || 0;
              return '<div class="flex-1 min-w-[60px] text-center p-2 rounded-xl" style="background:' + color + '10"><div class="text-lg font-extrabold" style="color:' + color + '">' + count + '</div><div class="text-[10px] text-slate-500 font-medium mt-0.5">' + label + '</div></div>';
            }).join('');
          })() + '</div>' +
        '</div>');
        if (!codeHtml && !pipeHtml) return '';
        return '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' + codeHtml + pipeHtml + '</div>';
      })() +

      // ===== This Week's Tasks =====
      (s.thisWeekMeetings?.length && !isWidgetHidden('thisWeek') ? '<div class="card-flat p-0 overflow-hidden" data-widget="thisWeek">' +
        '<div class="px-5 lg:px-6 py-4 flex items-center justify-between" style="background:linear-gradient(135deg,#eff6ff 0%,#eef2ff 100%);border-bottom:1px solid #e0e7ff"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#dbeafe,#c7d2fe)"><i class="fas fa-calendar-week text-blue-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">이번 주 일정</span><span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold" style="background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff">' + s.thisWeekMeetings.length + '건</span></div></div>' +
        '<div class="border-t border-gray-50 divide-y divide-gray-50">' + s.thisWeekMeetings.slice(0, 6).map(function(m) {
          var mDate = m.next_meeting_date || m.meeting_date;
          var du = daysUntil(mDate);
          var dayLabel = du === 0 ? '<span class="text-red-600 font-bold">오늘</span>' : du === 1 ? '<span class="text-amber-600 font-bold">내일</span>' : du > 0 ? '<span class="text-blue-600">' + du + '일 후</span>' : '<span class="text-slate-400">' + Math.abs(du) + '일 전</span>';
          return '<div class="px-4 lg:px-6 py-3 flex items-center gap-3 tr cursor-pointer" onclick="viewHosp(' + m.hospital_id + ')">' +
            '<div class="w-10 text-center flex-shrink-0"><div class="text-[10px] text-slate-400">' + fmtShort(mDate) + '</div><div class="text-[11px] font-bold">' + dayLabel + '</div></div>' +
            '<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5 mb-0.5 flex-wrap"><span class="font-semibold text-[13px] text-slate-800 truncate">' + meetDoctorNames(m) + '</span>' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + '</div><div class="text-[11px] text-slate-400 truncate">' + (m.hospital_name || '') + (m.purpose ? ' · ' + m.purpose : '') + '</div></div>' +
            '</div>';
        }).join('') + '</div></div>' : '') +

      // ===== Long-inactive hospitals alert =====
      (s.longInactive?.length && !isWidgetHidden('longInactive') ? '<div class="card-flat p-0 overflow-hidden" data-widget="longInactive" style="border-left:3px solid #fca5a5">' +
        '<div class="px-5 lg:px-6 py-4 flex items-center justify-between" style="background:linear-gradient(135deg,#fef2f2 0%,#fff1f2 100%);border-bottom:1px solid #fecaca"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fee2e2,#fecaca)"><i class="fas fa-exclamation-triangle text-red-500 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">장기 미접촉 기관</span><span class="text-[10px] text-red-500 font-bold">30일+ 미팅 없음</span></div></div>' +
        '<div class="border-t border-gray-50 divide-y divide-gray-50">' + s.longInactive.slice(0, 5).map(function(h) {
          return '<div class="px-4 lg:px-6 py-3 flex items-center gap-3 tr cursor-pointer" onclick="viewHosp(' + h.id + ')">' +
            '<div class="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0 bg-slate-100 text-slate-500"><i class="fas fa-hospital text-xs"></i></div>' +
            '<div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="font-semibold text-[13px] text-slate-800 truncate">' + h.name + '</span>' + statusDot(h.status) + '</div><div class="text-[11px] text-slate-400">' + (h.region || '-') + '</div></div>' +
            '<div class="text-right flex-shrink-0"><div class="text-[11px] font-bold text-red-500">' + (h.days_since != null ? h.days_since + '일' : '미방문') + '</div></div>' +
            '</div>';
        }).join('') + '</div></div>' : '') +

      // KPI gauge (if target set)
      widgetWrap('kpiGauge', (s.kpiTarget && s.kpiTarget.target_meetings > 0 ? '<div class="card-flat p-5"><div class="flex items-center justify-between mb-4"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#eef4ff,#dbeafe)"><i class="fas fa-bullseye text-brand-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">KPI 달성률</span></div><button class="btn btn-ghost btn-sm text-xs" onclick="showKPISettings()"><i class="fas fa-cog text-xs"></i> 설정</button></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-4">' + kpiGaugeCard('미팅', s.stats.monthMeetings, s.kpiTarget.target_meetings, 'fa-handshake', '#2563eb') + '</div></div>' :
        '<div class="card-flat p-4 flex items-center justify-between"><div class="flex items-center gap-2 text-sm text-slate-400"><i class="fas fa-bullseye text-slate-300"></i>KPI 목표가 설정되지 않았습니다</div><button class="btn btn-outline btn-sm" onclick="showKPISettings()"><i class="fas fa-plus text-xs mr-1"></i>설정</button></div>')) +
      // CI KPI banner
      (s.ciKpi && !isWidgetHidden('ciKpi') ? '<div class="card-flat p-4 lg:p-5 flex flex-wrap items-center gap-4 lg:gap-8" data-widget="ciKpi"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><i class="fas fa-chart-line text-indigo-500"></i></div><div><div class="text-[11px] text-slate-400 font-medium">인공와우 시장 현황 (' + s.ciKpi.year + '년)</div><div class="text-sm font-bold text-slate-800">환자 ' + fmtNum(s.ciKpi.patients) + '명</div></div></div><div class="flex gap-4 lg:gap-6 text-center flex-wrap"><div><div class="text-[10px] text-slate-400">시술건수</div><div class="text-sm font-bold text-brand-600">' + fmtNum(s.ciKpi.usage) + '</div></div><div><div class="text-[10px] text-slate-400">진료금액</div><div class="text-sm font-bold text-emerald-600">' + fmtAmount(s.ciKpi.amount) + '</div></div><div><div class="text-[10px] text-slate-400">환자 증가율</div><div class="text-sm font-bold ' + (parseFloat(s.ciKpi.growth_patients) > 0 ? 'text-emerald-600' : 'text-red-500') + '">' + (parseFloat(s.ciKpi.growth_patients) > 0 ? '+' : '') + s.ciKpi.growth_patients + '%</div></div></div><button class="btn btn-outline btn-sm ml-auto" onclick="nav(\'cistats\')">통계 상세 <i class="fas fa-arrow-right text-[10px]"></i></button></div>' : '') +

      // ===== Recently added highlights =====
      ((s.recentHospitals?.length || s.recentDoctors?.length) && !isWidgetHidden('recentHighlights') ?
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4" data-widget="recentHighlights">' +
      (s.recentHospitals?.length ? '<div class="card-flat p-0 overflow-hidden"><div class="px-5 lg:px-6 py-4 flex items-center gap-2.5" style="background:linear-gradient(135deg,#ecfdf5 0%,#f0fdfa 100%);border-bottom:1px solid #a7f3d0"><div class="w-7 h-7 rounded-md flex items-center justify-center" style="background:linear-gradient(135deg,#6ee7b7,#34d399)"><i class="fas fa-plus text-white text-[9px]"></i></div><span class="font-bold text-[13px] text-slate-800">최근 등록 기관</span><span class="text-[10px] text-emerald-600 font-medium">14일 이내</span></div><div class="divide-y divide-gray-50">' +
        s.recentHospitals.map(function(h) {
          return '<div class="px-4 lg:px-6 py-2.5 flex items-center gap-3 tr cursor-pointer" onclick="viewHosp(' + h.id + ')"><div class="flex-1 min-w-0"><span class="text-[13px] font-semibold text-slate-800 truncate">' + h.name + '</span><span class="text-[10px] text-slate-400 ml-2">' + (h.region || '') + '</span></div>' + statusDot(h.status) + '</div>';
        }).join('') + '</div></div>' : '') +
      (s.recentDoctors?.length ? '<div class="card-flat p-0 overflow-hidden"><div class="px-5 lg:px-6 py-4 flex items-center gap-2.5" style="background:linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%);border-bottom:1px solid #ddd6fe"><div class="w-7 h-7 rounded-md flex items-center justify-center" style="background:linear-gradient(135deg,#c4b5fd,#a78bfa)"><i class="fas fa-user-plus text-white text-[9px]"></i></div><span class="font-bold text-[13px] text-slate-800">최근 등록 의료진</span><span class="text-[10px] text-violet-600 font-medium">14일 이내</span></div><div class="divide-y divide-gray-50">' +
        s.recentDoctors.map(function(d) {
          return '<div class="px-4 lg:px-6 py-2.5 flex items-center gap-3 tr cursor-pointer" onclick="viewDocProfile(' + d.id + ')"><div class="flex-1 min-w-0"><span class="text-[13px] font-semibold text-slate-800">' + d.name + '</span><span class="text-[10px] text-slate-400 ml-2">' + (d.position || '') + ' · ' + (d.hospital_name || '') + '</span></div></div>';
        }).join('') + '</div></div>' : '') +
      '</div>' : '') +

      // Monthly trend chart + right column
      (function() {
        var trendHtml = (s.monthlyTrend?.length ? widgetWrap('monthlyTrend', '<div class="card-flat p-5 lg:p-6"><div class="flex items-center justify-between mb-5"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#eef2ff,#e0e7ff)"><i class="fas fa-chart-bar text-indigo-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">월별 미팅 추이</span></div><span class="text-[11px] text-slate-300 font-medium">최근 6개월</span></div><div style="height:200px"><canvas id="chart-monthly"></canvas></div></div>') : '');
        var recentHtml = widgetWrap('recentMeetings', '<div class="card-flat p-0 overflow-hidden">' +
          '<div class="px-5 lg:px-6 py-4 flex items-center justify-between" style="border-bottom:1px solid #eef0f5"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#eff6ff,#dbeafe)"><i class="fas fa-clock text-blue-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">최근 미팅</span></div><span class="text-[11px] text-slate-300 font-medium">최근 8건</span></div>' +
          '<div class="border-t border-gray-50">' + (s.recentMeetings.length ? s.recentMeetings.map(function(m){ return '<div class="px-4 lg:px-6 py-3 tr flex items-center gap-3 cursor-pointer border-b border-gray-50 last:border-0" onclick="viewHosp(' + m.hospital_id + ')">' +
            '<div class="hidden sm:block">' + meetDoctorAvatars(m, 'width:36px;height:36px;border-radius:10px;font-size:14px') + '</div>' +
            '<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5 mb-0.5 flex-wrap"><span class="font-semibold text-[13px] text-slate-800 truncate">' + meetDoctorNames(m) + '</span>' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + '</div><div class="text-[11px] text-slate-400 truncate">' + m.hospital_name + (m.purpose ? ' · ' + m.purpose : '') + '</div></div>' +
            '<div class="text-right flex-shrink-0"><div class="text-[11px] font-medium text-slate-500">' + fmtShort(m.meeting_date) + '</div><div class="text-[10px] ' + daysClass(m.meeting_date) + '">' + daysAgo(m.meeting_date) + '</div></div></div>' }).join('') : '<div class="empty"><div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div><p class="text-sm">아직 미팅이 없습니다</p></div>') + '</div></div>');
        var upHtml = widgetWrap('upcomingActions', '<div class="card-flat p-0 overflow-hidden">' +
          '<div class="px-5 lg:px-6 py-4 flex items-center gap-2.5" style="border-bottom:1px solid #eef0f5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fffbeb,#fef3c7)"><i class="fas fa-list-check text-amber-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">후속 액션</span></div>' +
          '<div class="border-t border-gray-50">' + (s.upcomingActions.length ? s.upcomingActions.map(function(m){ return '<div class="px-4 lg:px-6 py-3 tr border-b border-gray-50 last:border-0"><div class="flex items-center justify-between mb-1"><span class="text-[13px] font-semibold text-slate-700 truncate">' + (m.doctor_name || '-') + '</span>' + (m.next_meeting_date ? '<span class="text-[10px] font-bold ' + daysClass(m.next_meeting_date) + ' bg-gray-50 px-2 py-0.5 rounded-full">' + fmtShort(m.next_meeting_date) + '</span>' : '') + '</div><p class="text-[11px] text-slate-400 leading-relaxed truncate"><i class="fas fa-arrow-right text-amber-300 mr-1"></i>' + m.next_action + '</p></div>' }).join('') : '<div class="empty py-8"><div class="empty-icon"><i class="fas fa-check-circle"></i></div><p class="text-sm">완료할 액션이 없습니다</p></div>') + '</div></div>');
        var regHtml = widgetWrap('regionStats', '<div class="card-flat p-0 overflow-hidden">' +
          '<div class="px-5 lg:px-6 py-4 flex items-center gap-2.5" style="border-bottom:1px solid #eef0f5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#ecfdf5,#d1fae5)"><i class="fas fa-map-location-dot text-emerald-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">지역별 현황</span></div>' +
          '<div class="border-t border-gray-50 p-4 lg:p-5 space-y-3">' + (s.regionStats.length ? s.regionStats.map(function(r){ var mx = Math.max.apply(null, s.regionStats.map(function(x){return x.count;})); return '<div class="flex items-center gap-3"><span class="text-[11px] font-semibold text-slate-500 w-10 text-right">' + r.region + '</span><div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden"><div class="h-full rounded-full flex items-center px-2.5 transition-all duration-700" style="width:' + Math.max(r.count / mx * 100, 22) + '%;background:linear-gradient(90deg,#3b82f6,#2563eb)"><span class="text-[10px] font-bold text-white">' + r.count + '개</span></div></div></div>' }).join('') : '<div class="text-center text-sm text-slate-300 py-4">데이터 없음</div>') + '</div></div>');
        var leftCol = (trendHtml || recentHtml) ? '<div class="lg:col-span-3 space-y-4">' + trendHtml + recentHtml + '</div>' : '';
        var rightCol = (upHtml || regHtml) ? '<div class="lg:col-span-2 space-y-4">' + upHtml + regHtml + '</div>' : '';
        if (!leftCol && !rightCol) return '';
        return '<div class="grid grid-cols-1 lg:grid-cols-5 gap-4">' + leftCol + rightCol + '</div>';
      })() + '</div>';
    
    // Render monthly trend chart
    if (s.monthlyTrend?.length) {
      setTimeout(() => {
        const el = document.getElementById('chart-monthly');
        if (!el) return;
        Chart.defaults.font.family = 'Pretendard,sans-serif'; Chart.defaults.font.size = 11; Chart.defaults.color = '#9aa1b4';
        dashCharts.push(new Chart(el, {
          type: 'bar',
          data: {
            labels: s.monthlyTrend.map(m => fmtMonthLabel(m.month)),
            datasets: [
              { label: '방문', data: s.monthlyTrend.map(m => m.visit_count || 0), backgroundColor: '#3b82f6', borderRadius: 6, barPercentage: 0.5 },
              { label: '전화', data: s.monthlyTrend.map(m => m.phone_count || 0), backgroundColor: '#10b981', borderRadius: 6, barPercentage: 0.5 },
              { label: '학회', data: s.monthlyTrend.map(m => m.conf_count || 0), backgroundColor: '#8b5cf6', borderRadius: 6, barPercentage: 0.5 },
              { label: '이메일', data: s.monthlyTrend.map(m => m.email_count || 0), backgroundColor: '#f59e0b', borderRadius: 6, barPercentage: 0.5 },
              { label: '온라인', data: s.monthlyTrend.map(m => m.online_count || 0), backgroundColor: '#6366f1', borderRadius: 6, barPercentage: 0.5 },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 10, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } } },
            scales: { y: { stacked: true, beginAtZero: true, grid: { color: '#eef0f5', drawBorder: false }, ticks: { stepSize: 1, font: { size: 10 }, padding: 8 }, border: { display: false } }, x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11, weight: '600' }, padding: 6 }, border: { display: false } } }
          }
        }));
      }, 150);
    }
    // Load personal KPI + team ranking asynchronously
    loadMyKpi(_dashPeriod);
    loadTeamRanking(_dashPeriod);
  } catch (e) { console.error(e); document.getElementById('content').innerHTML = '<div class="p-7"><div class="card-flat p-8 text-center text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>데이터를 불러올 수 없습니다</div></div>' }
}

// ===== Personal KPI Card =====
async function loadMyKpi(period) {
  var el = document.getElementById('my-kpi-card');
  if (!el) return;
  try {
    var r = await API.get('/dashboard/me?period=' + (period || 'month'));
    var d = r.data && r.data.data;
    if (!d) { el.innerHTML = '<div class="text-xs text-slate-300 text-center py-4">데이터 없음</div>'; return; }
    var changeText = d.change > 0 ? '<span class="text-emerald-500 font-bold">+' + d.change + '%</span>'
      : (d.change < 0 ? '<span class="text-red-500 font-bold">' + d.change + '%</span>'
      : '<span class="text-slate-400">변동없음</span>');
    var nm = (currentUser && currentUser.name) ? currentUser.name : '나';

    // Try to load personal KPI target (only meaningful for monthly view)
    var targetData = null;
    try {
      var tr = await API.get('/dashboard/kpi-target');
      targetData = tr.data && tr.data.data;
    } catch (e) {}

    // Activity badge (motivational)
    var badge = activityBadge(d.activityScore || 0);

    el.innerHTML = '<div class="flex items-center justify-between mb-4 flex-wrap gap-2">' +
        '<div class="flex items-center gap-2.5">' +
          '<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fef3c7,#fde68a)"><i class="fas fa-user-shield text-amber-600 text-xs"></i></div>' +
          '<span class="font-bold text-[14px] text-slate-800 tracking-tight">' + nm + '님의 활동</span>' +
          '<span class="text-[10px] text-slate-400">' + (period === 'year' ? '올해' : period === 'quarter' ? '이번 분기' : '이번 달') + '</span>' +
          (badge ? '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background:' + badge.bg + ';color:' + badge.color + '" title="' + badge.tooltip + '"><i class="fas ' + badge.icon + ' mr-0.5"></i>' + badge.label + '</span>' : '') +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-[11px] text-slate-400">전기 대비 ' + changeText + '</span>' +
          '<button onclick="showKPISettings()" class="text-[10px] px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold" title="목표 설정"><i class="fas fa-bullseye mr-0.5"></i>목표</button>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
        '<div class="rounded-xl p-3 text-center" style="background:linear-gradient(135deg,#eef4ff,#dbeafe)">' +
          '<div class="text-[10px] text-slate-500 font-semibold mb-1">미팅 수</div>' +
          '<div class="text-2xl font-extrabold text-brand-600 tracking-tight">' + d.myMeetings + '</div>' +
          '<div class="text-[10px] text-slate-400 mt-0.5">전기 ' + d.myMeetingsPrev + '건</div>' +
        '</div>' +
        '<div class="rounded-xl p-3 text-center" style="background:linear-gradient(135deg,#ecfdf5,#d1fae5)">' +
          '<div class="text-[10px] text-slate-500 font-semibold mb-1">신규 기관</div>' +
          '<div class="text-2xl font-extrabold text-emerald-600 tracking-tight">' + d.myNewHospitals + '</div>' +
          '<div class="text-[10px] text-slate-400 mt-0.5">개</div>' +
        '</div>' +
        '<div class="rounded-xl p-3 text-center" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe)">' +
          '<div class="text-[10px] text-slate-500 font-semibold mb-1">전환율</div>' +
          '<div class="text-2xl font-extrabold text-violet-600 tracking-tight">' + d.conversionRate + '<span class="text-sm">%</span></div>' +
          '<div class="text-[10px] text-slate-400 mt-0.5">결과 작성 ' + d.successCount + '건</div>' +
        '</div>' +
        '<div class="rounded-xl p-3 text-center" style="background:linear-gradient(135deg,#fff7ed,#fed7aa)">' +
          '<div class="text-[10px] text-slate-500 font-semibold mb-1">활동 점수</div>' +
          '<div class="text-2xl font-extrabold text-orange-600 tracking-tight">' + d.activityScore + '</div>' +
          '<div class="text-[10px] text-slate-400 mt-0.5">pt</div>' +
        '</div>' +
      '</div>' +
      // Goal achievement section
      renderGoalProgress(targetData);
  } catch (e) {
    el.innerHTML = '<div class="text-xs text-red-400 text-center py-4">개인 KPI를 불러올 수 없습니다</div>';
  }
}

// Achievement badge based on activity score (gamification)
function activityBadge(score) {
  if (score >= 90) return { label: '레전드', icon: 'fa-crown', color: '#7c2d12', bg: 'linear-gradient(135deg,#fef3c7,#fcd34d)', tooltip: '활동 점수 90+ : 최고 성과' };
  if (score >= 60) return { label: '에이스', icon: 'fa-fire', color: '#b91c1c', bg: 'linear-gradient(135deg,#fee2e2,#fecaca)', tooltip: '활동 점수 60+ : 우수 성과' };
  if (score >= 30) return { label: '러너', icon: 'fa-bolt', color: '#1d4ed8', bg: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', tooltip: '활동 점수 30+ : 안정 성과' };
  if (score >= 10) return { label: '스타터', icon: 'fa-seedling', color: '#15803d', bg: 'linear-gradient(135deg,#d1fae5,#a7f3d0)', tooltip: '활동 점수 10+ : 시작 단계' };
  return null;
}

function renderGoalProgress(td) {
  if (!td) return '';
  var t = td.target || {}, c = td.current || {}, a = td.achievement || {};
  var hasAny = (t.target_meetings || t.target_new_hospitals || t.target_contracts);
  if (!hasAny) {
    return '<div class="mt-3 flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2 text-[11px] text-slate-500">' +
      '<span><i class="fas fa-bullseye text-amber-400 mr-1"></i>아직 월간 목표가 설정되지 않았습니다.</span>' +
      '<button onclick="showKPISettings()" class="text-[10px] font-bold text-brand-600 hover:underline">목표 설정 →</button>' +
    '</div>';
  }
  function bar(label, cur, tgt, pct, color) {
    if (!tgt) return '';
    var w = Math.min(pct, 100);
    var barBg = pct >= 100 ? 'linear-gradient(90deg,#10b981,#059669)' : pct >= 70 ? 'linear-gradient(90deg,#3b82f6,#2563eb)' : pct >= 40 ? 'linear-gradient(90deg,#fbbf24,#d97706)' : 'linear-gradient(90deg,#f87171,#ef4444)';
    var pctColor = pct >= 100 ? '#059669' : pct >= 70 ? '#2563eb' : pct >= 40 ? '#d97706' : '#ef4444';
    return '<div class="flex-1 min-w-[150px]">' +
      '<div class="flex items-center justify-between mb-1">' +
        '<span class="text-[10px] font-semibold text-slate-600">' + label + '</span>' +
        '<span class="text-[10px] font-bold" style="color:' + pctColor + '">' + pct + '%</span>' +
      '</div>' +
      '<div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden"><div class="h-2 rounded-full transition-all duration-700" style="width:' + w + '%;background:' + barBg + '"></div></div>' +
      '<div class="text-[9px] text-slate-400 mt-0.5">' + cur + ' / ' + tgt + '</div>' +
    '</div>';
  }
  return '<div class="mt-3 bg-slate-50 rounded-xl p-3">' +
    '<div class="flex items-center justify-between mb-2">' +
      '<span class="text-[11px] font-bold text-slate-700"><i class="fas fa-bullseye text-amber-500 mr-1"></i>' + (td.year || '') + '년 ' + (td.month || '') + '월 목표 달성률</span>' +
      '<button onclick="showKPISettings()" class="text-[10px] text-slate-500 hover:text-brand-600"><i class="fas fa-pen mr-0.5"></i>편집</button>' +
    '</div>' +
    '<div class="flex flex-wrap gap-3">' +
      bar('미팅', c.meetings || 0, t.target_meetings || 0, a.meetings_pct || 0, '#2563eb') +
      bar('신규 기관', c.new_hospitals || 0, t.target_new_hospitals || 0, a.new_hospitals_pct || 0, '#059669') +
      bar('계약', c.contracts || 0, t.target_contracts || 0, a.contracts_pct || 0, '#7c3aed') +
    '</div>' +
  '</div>';
}

// ===== Team Ranking Widget =====
async function loadTeamRanking(period) {
  var el = document.getElementById('team-rank-card');
  if (!el) return;
  try {
    var r = await API.get('/dashboard/ranking?period=' + (period || 'month'));
    var list = (r.data && r.data.data && r.data.data.ranking) || [];
    var top = list.slice(0, 5);
    var medal = ['fa-trophy text-amber-400', 'fa-medal text-slate-400', 'fa-medal text-orange-400'];
    var myId = currentUser ? currentUser.id : null;
    if (!top.length) {
      el.innerHTML = '<div class="flex items-center gap-2.5 mb-3"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fef3c7,#fde68a)"><i class="fas fa-ranking-star text-amber-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">팀 랭킹</span></div><div class="text-xs text-slate-300 text-center py-4">데이터 없음</div>';
      return;
    }
    el.innerHTML = '<div class="flex items-center gap-2.5 mb-3">' +
        '<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fef3c7,#fde68a)"><i class="fas fa-ranking-star text-amber-600 text-xs"></i></div>' +
        '<span class="font-bold text-[14px] text-slate-800 tracking-tight">팀 랭킹</span>' +
        '<span class="text-[10px] text-slate-400 ml-auto">' + (period === 'year' ? '올해' : period === 'quarter' ? '이번 분기' : '이번 달') + '</span>' +
      '</div>' +
      '<div class="space-y-1.5">' +
      top.map(function(u) {
        var iconHtml = u.rank <= 3 ? '<i class="fas ' + medal[u.rank - 1] + ' text-sm"></i>' : '<span class="text-[11px] font-bold text-slate-400">' + u.rank + '</span>';
        var mine = myId && u.user_id === myId;
        var bg = mine ? 'background:linear-gradient(90deg,#eef4ff,#fff);border:1px solid #c7d2fe' : '';
        return '<div class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg" style="' + bg + '">' +
          '<div class="w-6 text-center flex-shrink-0">' + iconHtml + '</div>' +
          avatar(null, u.user_name || '?', 'width:24px;height:24px;border-radius:6px;font-size:10px') +
          '<div class="flex-1 min-w-0"><div class="text-[12px] font-semibold text-slate-700 truncate">' + (u.user_name || '익명') + (mine ? ' <span class="text-[9px] text-brand-500 font-bold">나</span>' : '') + '</div>' +
          '<div class="text-[10px] text-slate-400">미팅 ' + u.meeting_count + '건 · 기관 ' + u.hospital_count + '개</div></div>' +
          '<div class="text-right flex-shrink-0"><div class="text-[13px] font-extrabold text-amber-600">' + u.activity_score + '</div><div class="text-[9px] text-slate-400">pt</div></div>' +
        '</div>';
      }).join('') +
      '</div>';
  } catch (e) {
    el.innerHTML = '<div class="text-xs text-red-400 text-center py-4">랭킹을 불러올 수 없습니다</div>';
  }
}
function sc(label, val, unit, icon, color, bg, link) {
  return '<div class="sc cursor-pointer" onclick="' + (link ? "nav('" + link + "')" : '') + '">' +
    '<div class="flex items-center gap-3">' +
    '<div class="sc-icon" style="background:' + bg + '"><i class="fas ' + icon + '" style="color:' + color + '"></i></div>' +
    '<div class="min-w-0">' +
    '<p class="text-[11px] text-slate-400 font-medium mb-0.5 truncate">' + label + '</p>' +
    '<div class="flex items-baseline gap-1"><span class="text-[22px] font-extrabold tracking-tight" style="color:#1f2937;line-height:1.1">' + val + '</span><span class="text-[11px] text-slate-300 font-semibold">' + unit + '</span></div>' +
    '</div></div></div>';
}

// ===== KPI Gauge =====
function kpiGaugeCard(label, actual, target, icon, color) {
  var pct = target > 0 ? Math.min(Math.round(actual / target * 100), 100) : 0;
  var barColor = pct >= 100 ? '#059669' : pct >= 70 ? '#2563eb' : pct >= 40 ? '#d97706' : '#ef4444';
  var barBg = pct >= 100 ? 'linear-gradient(90deg,#10b981,#059669)' : pct >= 70 ? 'linear-gradient(90deg,#3b82f6,#2563eb)' : pct >= 40 ? 'linear-gradient(90deg,#fbbf24,#d97706)' : 'linear-gradient(90deg,#f87171,#ef4444)';
  return '<div class="flex items-center gap-3"><div class="flex-1"><div class="flex items-center justify-between mb-1.5"><span class="text-xs font-semibold text-slate-600"><i class="fas ' + icon + ' mr-1" style="color:' + color + '"></i>' + label + '</span><span class="text-xs font-bold" style="color:' + barColor + '">' + pct + '%</span></div><div class="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden"><div class="h-2.5 rounded-full transition-all duration-700" style="width:' + pct + '%;background:' + barBg + '"></div></div><div class="text-[10px] text-slate-400 mt-1 font-medium">' + actual + ' / ' + target + ' ' + (label === '미팅' ? '건' : '개') + '</div></div></div>';
}

// ===== KPI Settings Modal (Personal) =====
async function showKPISettings() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  openModal('<i class="fas fa-bullseye text-brand-500 mr-1.5"></i>나의 월간 KPI 목표',
    '<form id="fm" class="space-y-4">' +
      '<div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-700"><i class="fas fa-info-circle mr-1"></i>개인별 목표를 설정하면 대시보드에서 달성률이 게이지로 표시됩니다.</div>' +
      '<div class="grid grid-cols-2 gap-3">' +
        '<div><label class="input-label">연도</label><input type="number" name="year" value="' + y + '" class="input"></div>' +
        '<div><label class="input-label">월</label><input type="number" name="month" value="' + m + '" class="input" min="1" max="12"></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
        '<div><label class="input-label"><i class="fas fa-handshake text-blue-500 mr-1"></i>미팅 (건)</label><input type="number" name="target_meetings" value="0" class="input" min="0" placeholder="예: 30"></div>' +
        '<div><label class="input-label"><i class="fas fa-hospital text-emerald-500 mr-1"></i>신규 기관 (개)</label><input type="number" name="target_new_hospitals" value="0" class="input" min="0" placeholder="예: 5"></div>' +
        '<div><label class="input-label"><i class="fas fa-file-signature text-violet-500 mr-1"></i>계약 (건)</label><input type="number" name="target_contracts" value="0" class="input" min="0" placeholder="예: 3"></div>' +
      '</div>' +
      '<div class="flex justify-end gap-2 pt-3 border-t border-gray-50"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary"><i class="fas fa-save mr-1"></i>저장</button></div>' +
    '</form>');
  // Load existing target
  try {
    var r = await API.get('/dashboard/kpi-target?year=' + y + '&month=' + m);
    var t = r.data && r.data.data && r.data.data.target;
    if (t) {
      document.querySelector('#fm input[name="target_meetings"]').value = t.target_meetings || 0;
      var nh = document.querySelector('#fm input[name="target_new_hospitals"]'); if (nh) nh.value = t.target_new_hospitals || 0;
      var cn = document.querySelector('#fm input[name="target_contracts"]'); if (cn) cn.value = t.target_contracts || 0;
    }
  } catch(e) {}
  document.getElementById('fm').onsubmit = async function(e) {
    e.preventDefault();
    var f = Object.fromEntries(new FormData(e.target));
    try {
      await API.post('/dashboard/kpi-target', f);
      toast('KPI 목표가 저장되었습니다'); closeModal();
      if (typeof loadMyKpi === 'function') loadMyKpi(_dashPeriod);
      if (typeof loadDash === 'function') loadDash();
    } catch(e) { toast('저장 실패', 'err'); }
  };
}

// ===== Pipeline View =====
var _pipelineTab = 'board';
var _pipelinePeriod = 90;

// ===== Auto Report Preview =====
var _reportRange = 'week';
async function showReportPreview() {
  openModal('<i class="fas fa-file-lines text-brand-500 mr-2" aria-hidden="true"></i>주/월간 자동 보고서',
    '<div class="space-y-3">' +
      '<div class="flex flex-wrap gap-2 items-center">' +
        '<span class="text-[11px] text-slate-400 font-bold">기간:</span>' +
        '<div class="flex bg-slate-100 rounded-lg p-0.5 gap-0.5" role="tablist" aria-label="보고서 기간">' +
          ['week','last_week','month','last_month'].map(function(r){
            var lbl = ({week:'이번 주', last_week:'지난 주', month:'이번 달', last_month:'지난 달'})[r];
            return '<button role="tab" aria-selected="' + (_reportRange===r) + '" class="px-3 py-1.5 text-[11px] font-bold rounded-md transition ' + (_reportRange===r?'bg-white text-brand-600 shadow-sm':'text-slate-500 hover:text-slate-700') + '" onclick="_reportRange=\'' + r + '\';showReportPreview()">' + lbl + '</button>';
          }).join('') +
        '</div>' +
        '<div class="ml-auto flex gap-2">' +
          '<button class="btn btn-outline btn-sm" onclick="printReport()" title="보고서 인쇄/PDF"><i class="fas fa-print text-xs" aria-hidden="true"></i><span class="hidden sm:inline">인쇄</span></button>' +
          '<button class="btn btn-primary btn-sm" onclick="window.open(\'/api/export/report/full\',\'_blank\')"><i class="fas fa-file-excel text-xs" aria-hidden="true"></i><span class="hidden sm:inline">엑셀</span></button>' +
        '</div>' +
      '</div>' +
      '<div id="report-body" class="text-sm"><div class="text-center py-8 text-slate-400"><i class="fas fa-spinner fa-spin text-xl"></i></div></div>' +
    '</div>', 'wide');
  try {
    var r = await API.get('/dashboard/report?range=' + _reportRange);
    var d = r.data.data;
    renderReportBody(d);
  } catch (e) {
    document.getElementById('report-body').innerHTML = '<div class="text-center py-8 text-red-400"><i class="fas fa-circle-exclamation mr-1"></i>보고서를 불러올 수 없습니다</div>';
  }
}
function renderReportBody(d) {
  var typeLabels = { visit:'방문', phone:'전화', conference:'학회', email:'이메일', online:'온라인' };
  var typeColors = { visit:'#2563eb', phone:'#10b981', conference:'#8b5cf6', email:'#f59e0b', online:'#6366f1' };
  var stageLabels = { contact:'접촉', meeting:'미팅', demo:'데모', proposal:'제안', negotiation:'협상', contract:'계약', closed_won:'성사', closed_lost:'실패', lost:'이탈', inactive:'휴면', active_customer:'기존고객' };
  var stageColors = { contact:'#94a3b8', meeting:'#2563eb', demo:'#8b5cf6', proposal:'#f59e0b', contract:'#ef4444', active_customer:'#059669' };
  var diffSign = d.summary.diffPct > 0 ? '+' : '';
  var diffColor = d.summary.diffPct > 0 ? 'text-emerald-600' : (d.summary.diffPct < 0 ? 'text-red-500' : 'text-slate-400');
  var diffIcon = d.summary.diffPct > 0 ? 'fa-arrow-trend-up' : (d.summary.diffPct < 0 ? 'fa-arrow-trend-down' : 'fa-minus');
  var hospDiff = (d.summary.uniqueHospitals || 0) - (d.summary.prevUniqueHospitals || 0);
  var hospDiffSign = hospDiff > 0 ? '+' : '';
  var hospDiffColor = hospDiff > 0 ? 'text-emerald-600' : (hospDiff < 0 ? 'text-red-500' : 'text-slate-400');

  var html = '<div id="report-print-target" class="space-y-4">';
  // Title block
  html += '<div class="card-flat p-4">' +
    '<div class="flex items-center justify-between flex-wrap gap-2">' +
      '<div><div class="font-extrabold text-slate-800 text-base">TODOC CRM 영업 활동 보고서</div>' +
        '<div class="text-xs text-slate-500 mt-0.5">' + d.from + ' ~ ' + d.to + ' (비교: ' + (d.prevFrom || '-') + ' ~ ' + (d.prevTo || '-') + ')</div>' +
      '</div>' +
    '</div></div>';

  // ===== 1) 핵심 지표 (미팅 중심) =====
  html += '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-handshake mr-1"></i>총 미팅</div><div class="text-lg font-extrabold text-slate-800">' + d.summary.totalMeetings + '<span class="text-[10px] text-slate-400 ml-0.5">건</span></div><div class="text-[10px] ' + diffColor + ' mt-0.5"><i class="fas ' + diffIcon + ' mr-0.5"></i>' + diffSign + d.summary.diffPct + '% (이전 ' + d.summary.prevTotalMeetings + '건)</div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-hospital mr-1"></i>방문 기관 수</div><div class="text-lg font-extrabold text-blue-600">' + (d.summary.uniqueHospitals || 0) + '<span class="text-[10px] text-slate-400 ml-0.5">곳</span></div><div class="text-[10px] ' + hospDiffColor + ' mt-0.5">' + hospDiffSign + hospDiff + ' (이전 ' + (d.summary.prevUniqueHospitals || 0) + '곳)</div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-user-doctor mr-1"></i>접촉 의료진</div><div class="text-lg font-extrabold text-purple-600">' + (d.summary.uniqueDoctors || 0) + '<span class="text-[10px] text-slate-400 ml-0.5">명</span></div><div class="text-[10px] text-slate-400 mt-0.5">기간 내 만난 의료진</div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-flag mr-1"></i>후속 액션 생성률</div><div class="text-lg font-extrabold text-amber-600">' + (d.summary.followupRate || 0) + '<span class="text-[10px] text-slate-400 ml-0.5">%</span></div><div class="text-[10px] text-slate-400 mt-0.5">미팅 기록 ' + (d.summary.summaryRate || 0) + '%</div></div>' +
    '</div>';

  // ===== 2) 미팅 유형/지역 분포 + 활동 상위 기관 =====
  html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">';
  // Meeting type breakdown
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-chart-pie text-brand-500 mr-1.5"></i>미팅 유형별</div>';
  if (!d.typeBreakdown || !d.typeBreakdown.length) html += '<div class="text-xs text-slate-400">데이터 없음</div>';
  else {
    var maxC = Math.max.apply(null, d.typeBreakdown.map(function(t){return t.c}));
    html += '<div class="space-y-1.5">' + d.typeBreakdown.map(function(t){
      var w = Math.round((t.c / maxC) * 100);
      var col = typeColors[t.meeting_type] || '#94a3b8';
      var pct = d.summary.totalMeetings > 0 ? Math.round((t.c / d.summary.totalMeetings) * 100) : 0;
      return '<div class="flex items-center gap-2"><span class="text-[11px] text-slate-600 w-12 flex-shrink-0">' + (typeLabels[t.meeting_type] || t.meeting_type) + '</span><div class="flex-1 bg-slate-100 rounded h-3 relative overflow-hidden"><div class="h-full" style="width:' + w + '%;background:' + col + '"></div></div><span class="text-[11px] font-bold text-slate-700 w-14 text-right">' + t.c + '건 (' + pct + '%)</span></div>';
    }).join('') + '</div>';
  }
  html += '</div>';

  // 지역별 미팅 분포
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-map-location-dot text-emerald-500 mr-1.5"></i>지역별 활동</div>';
  if (!d.regionBreakdown || !d.regionBreakdown.length) html += '<div class="text-xs text-slate-400">데이터 없음</div>';
  else {
    var maxR = Math.max.apply(null, d.regionBreakdown.map(function(r){return r.c}));
    html += '<div class="space-y-1.5">' + d.regionBreakdown.slice(0,8).map(function(r){
      var w = Math.round((r.c / maxR) * 100);
      return '<div class="flex items-center gap-2"><span class="text-[11px] text-slate-600 w-14 flex-shrink-0 truncate">' + (r.region || '기타') + '</span><div class="flex-1 bg-slate-100 rounded h-3 relative overflow-hidden"><div class="bg-emerald-400 h-full" style="width:' + w + '%"></div></div><span class="text-[11px] font-bold text-slate-700 w-20 text-right">' + r.c + '건 / ' + r.hosp_count + '곳</span></div>';
    }).join('') + '</div>';
  }
  html += '</div>';
  html += '</div>';

  // ===== 3) 핵심: 미팅한 기관 상세 (Top + 전체 리스트) =====
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2 flex items-center justify-between"><span><i class="fas fa-trophy text-amber-500 mr-1.5"></i>활동 상위 기관 (미팅한 곳)</span><span class="text-[10px] text-slate-400 font-medium">총 ' + (d.topHospitals ? d.topHospitals.length : 0) + '곳 표시</span></div>';
  if (!d.topHospitals || !d.topHospitals.length) html += '<div class="text-xs text-slate-400">데이터 없음</div>';
  else {
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' + d.topHospitals.slice(0, 12).map(function(h, i) {
      var stageBg = stageColors[h.pipeline_stage] || '#94a3b8';
      var stageLbl = stageLabels[h.pipeline_stage] || h.pipeline_stage || '-';
      return '<div class="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer" onclick="closeModal();viewHosp(' + h.id + ')">' +
        '<span class="text-[11px] font-bold text-slate-400 w-5 text-center flex-shrink-0">' + (i+1) + '</span>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-1.5 flex-wrap">' +
            '<span class="text-[12px] font-semibold text-slate-700 truncate hover:text-brand-500">' + (h.name || '-') + '</span>' +
            '<span class="text-[9px] px-1.5 py-0.5 rounded font-medium" style="background:' + stageBg + '15;color:' + stageBg + '">' + stageLbl + '</span>' +
          '</div>' +
          '<div class="text-[10px] text-slate-400 mt-0.5"><i class="fas fa-map-marker-alt mr-0.5"></i>' + (h.region || '-') + ' · 마지막 ' + (h.last_date ? h.last_date.slice(5) : '-') + '</div>' +
        '</div>' +
        '<span class="text-[12px] font-extrabold text-brand-600 flex-shrink-0">' + h.c + '회</span>' +
      '</div>';
    }).join('') + '</div>';
  }
  html += '</div>';

  // ===== 4) 핵심: 미팅 상세 내역 (어떤 곳과 무슨 미팅을 했는가) =====
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2 flex items-center justify-between"><span><i class="fas fa-list-check text-blue-500 mr-1.5"></i>미팅 상세 내역</span><span class="text-[10px] text-slate-400 font-medium">' + (d.meetingDetails ? d.meetingDetails.length : 0) + '건</span></div>';
  if (!d.meetingDetails || !d.meetingDetails.length) html += '<div class="text-xs text-slate-400">기간 내 미팅이 없습니다</div>';
  else {
    html += '<div class="space-y-2 max-h-[400px] overflow-y-auto">';
    d.meetingDetails.slice(0, 50).forEach(function(m) {
      var typeCol = typeColors[m.meeting_type] || '#94a3b8';
      var typeLbl = typeLabels[m.meeting_type] || m.meeting_type || '-';
      html +=
        '<div class="border-l-2 pl-3 py-1.5 hover:bg-slate-50 cursor-pointer rounded-r" style="border-color:' + typeCol + '" onclick="closeModal();viewHosp(' + m.hospital_id + ')">' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="text-[10px] font-bold text-slate-500">' + (m.meeting_date || '') + '</span>' +
            '<span class="text-[9px] px-1.5 py-0.5 rounded font-medium" style="background:' + typeCol + '15;color:' + typeCol + '">' + typeLbl + '</span>' +
            '<span class="text-[12px] font-bold text-slate-700 truncate">' + (m.hospital_name || '-') + '</span>' +
            (m.region ? '<span class="text-[9px] text-slate-400">· ' + m.region + '</span>' : '') +
            (m.doctor_name ? '<span class="text-[10px] text-purple-600 font-medium"><i class="fas fa-user-doctor mr-0.5"></i>' + m.doctor_name + (m.doctor_position ? ' ' + m.doctor_position : '') + '</span>' : '') +
          '</div>' +
          (m.purpose ? '<div class="text-[11px] text-slate-700 mt-1 font-medium">' + escapeHtml(m.purpose) + '</div>' : '') +
          (m.summary ? '<div class="text-[11px] text-slate-500 mt-0.5 line-clamp-2">' + escapeHtml(m.summary).slice(0, 200) + (m.summary.length > 200 ? '...' : '') + '</div>' : '') +
          (m.next_action ? '<div class="text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded mt-1 inline-block"><i class="fas fa-flag mr-1"></i>다음: ' + escapeHtml(m.next_action) + (m.next_meeting_date ? ' (' + m.next_meeting_date + ')' : '') + '</div>' : '') +
        '</div>';
    });
    if (d.meetingDetails.length > 50) {
      html += '<div class="text-[11px] text-slate-400 text-center pt-2">... 외 ' + (d.meetingDetails.length - 50) + '건 (엑셀 다운로드로 전체 확인)</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // ===== 5) 담당자별 미팅 + 파이프라인 이동 =====
  html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">';
  // Top users
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-medal text-purple-500 mr-1.5"></i>담당자별 미팅</div>';
  if (!d.topUsers || !d.topUsers.length) html += '<div class="text-xs text-slate-400">데이터 없음</div>';
  else html += '<div class="space-y-1">' + d.topUsers.map(function(u, i){
    return '<div class="flex items-center gap-2 py-0.5"><span class="text-[11px] font-bold text-slate-400 w-5 text-center">' + (i+1) + '</span><span class="text-[12px] font-semibold text-slate-700 flex-1 truncate">' + (u.name || '-') + '</span><span class="text-[11px] font-bold text-purple-600 w-10 text-right">' + u.c + '회</span></div>';
  }).join('') + '</div>';
  html += '</div>';
  // Pipeline moves
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-arrows-turn-to-dots text-emerald-500 mr-1.5"></i>파이프라인 이동</div>';
  if (!d.pipelineMoves || !d.pipelineMoves.length) html += '<div class="text-xs text-slate-400">파이프라인 변경 없음</div>';
  else html += '<div class="space-y-1">' + d.pipelineMoves.slice(0,8).map(function(p){
    return '<div class="flex items-center gap-2 text-[11px] py-0.5"><span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">' + (stageLabels[p.from_stage] || p.from_stage || '-') + '</span><i class="fas fa-arrow-right text-slate-300 text-[9px]"></i><span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">' + (stageLabels[p.to_stage] || p.to_stage || '-') + '</span><span class="ml-auto font-bold text-slate-700">' + p.c + '건</span></div>';
  }).join('') + '</div>';
  html += '</div>';
  html += '</div>';

  // ===== 6) 위험 신호: 한동안 만나지 못한 활성 기관 =====
  if (d.notMetHospitals && d.notMetHospitals.length) {
    html += '<div class="card-flat p-4 border-l-4 border-amber-400">' +
      '<div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-triangle-exclamation text-amber-500 mr-1.5"></i>주의: 30일 이상 미접촉 기관 (' + d.notMetHospitals.length + ')</div>' +
      '<div class="text-[11px] text-slate-500 mb-2">활성 거래처 중 한동안 만나지 못한 곳입니다. 후속 미팅을 잡아보세요.</div>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">' +
      d.notMetHospitals.map(function(h) {
        var stageBg = stageColors[h.pipeline_stage] || '#94a3b8';
        var stageLbl = stageLabels[h.pipeline_stage] || h.pipeline_stage || '-';
        var daysAgo = h.last_date ? Math.floor((Date.now() - new Date(h.last_date).getTime()) / 86400000) : null;
        return '<div class="flex items-center gap-2 p-1.5 rounded hover:bg-amber-50 cursor-pointer" onclick="closeModal();viewHosp(' + h.id + ')">' +
          '<span class="text-[11px] font-semibold text-slate-700 truncate flex-1 hover:text-brand-500">' + h.name + '</span>' +
          '<span class="text-[9px] px-1 py-0.5 rounded" style="background:' + stageBg + '15;color:' + stageBg + '">' + stageLbl + '</span>' +
          '<span class="text-[10px] text-amber-600 font-bold">' + (daysAgo !== null ? daysAgo + '일 전' : '미방문') + '</span>' +
        '</div>';
      }).join('') +
      '</div></div>';
  }

  // ===== 7) 2주 이내 예정 후속 액션 =====
  html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-flag-checkered text-amber-500 mr-1.5"></i>2주 이내 예정 후속 액션 (' + (d.upcomingNextActions ? d.upcomingNextActions.length : 0) + ')</div>';
  if (!d.upcomingNextActions || !d.upcomingNextActions.length) html += '<div class="text-xs text-slate-400">예정된 후속 액션 없음</div>';
  else html += '<div class="space-y-1 max-h-44 overflow-y-auto">' + d.upcomingNextActions.slice(0,20).map(function(n){
    return '<div class="flex items-start gap-2 text-[11px] py-1 border-b border-slate-50 last:border-0 hover:bg-amber-50 cursor-pointer rounded" onclick="closeModal();viewHosp(' + (n.hospital_id || 0) + ')"><span class="font-bold text-amber-600 w-20 flex-shrink-0">' + (n.next_meeting_date || '') + '</span><span class="font-semibold text-slate-700 w-32 truncate flex-shrink-0">' + (n.hospital_name || '-') + '</span><span class="text-slate-500 flex-1">' + escapeHtml(n.next_action || '-') + '</span></div>';
  }).join('') + '</div>';
  html += '</div>';
  // Daily trend chart
  if (d.dailyTrend && d.dailyTrend.length) {
    html += '<div class="card-flat p-4"><div class="font-bold text-sm text-slate-800 mb-2"><i class="fas fa-chart-line text-brand-500 mr-1.5"></i>일별 미팅 추이</div>' +
      '<div style="position:relative;height:180px"><canvas id="report-daily-chart"></canvas></div></div>';
  }
  html += '</div>';

  document.getElementById('report-body').innerHTML = html;

  // Initialize daily trend chart after DOM injection
  if (d.dailyTrend && d.dailyTrend.length && window.Chart) {
    try {
      var ctx = document.getElementById('report-daily-chart');
      if (ctx) {
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: d.dailyTrend.map(function(x){ return (x.d || '').slice(5); }),
            datasets: [{
              label: '미팅 건수',
              data: d.dailyTrend.map(function(x){ return Number(x.c||0); }),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59,130,246,.15)',
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointRadius: 3,
              pointBackgroundColor: '#3b82f6'
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { display: false } },
              y: { beginAtZero: true, ticks: { font: { size: 10 }, color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(148,163,184,.1)' } }
            }
          }
        });
      }
    } catch (e) { /* ignore chart errors */ }
  }
}
function printReport() {
  var src = document.getElementById('report-print-target');
  if (!src) return;
  try {
    var content = document.getElementById('content');
    var modal = document.getElementById('modal');
    var origModalDisplay = modal ? modal.style.display : '';
    if (modal) modal.style.display = 'none';
    var origContentClasses = content ? content.className : '';
    if (content) content.classList.add('not-print-target');
    document.body.classList.add('print-mode');
    var wrap = document.createElement('div');
    wrap.className = 'print-target';
    wrap.id = 'print-target-temp';
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    var userName = (window._me && window._me.name) ? window._me.name : '';
    var header = '<div class="print-header"><div class="print-title">TODOC CRM 활동 보고서</div><div class="print-meta">출력일 ' + dateStr + (userName ? ' · ' + userName : '') + '</div></div>';
    var footer = '<div class="print-footer">TODOC CRM · ' + dateStr + '</div>';
    wrap.innerHTML = header + src.outerHTML + footer;
    document.body.appendChild(wrap);
    var cleanup = function(){
      document.body.classList.remove('print-mode');
      if (content) content.className = origContentClasses;
      if (modal) modal.style.display = origModalDisplay;
      var t = document.getElementById('print-target-temp');
      if (t && t.parentNode) t.parentNode.removeChild(t);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(function(){ window.print(); }, 50);
    setTimeout(function(){ if (document.getElementById('print-target-temp')) cleanup(); }, 10000);
  } catch (e) { toast('인쇄 준비 중 오류', 'err'); }
}

// ===== Pipeline Conversion Analytics =====
var _plaCharts = [];
function destroyPlaCharts() { _plaCharts.forEach(function(c){ try { c.destroy(); } catch(e) {} }); _plaCharts = []; }
var _plaPeriod = 90;
async function showPipelineAnalytics() {
  _plaPeriod = 90;
  openModal('<i class="fas fa-diagram-project text-emerald-500 mr-2" aria-hidden="true"></i>파이프라인 전환 분석',
    '<div id="pl-analytics-body"><div class="text-center py-8 text-slate-400"><i class="fas fa-spinner fa-spin text-xl"></i></div></div>', 'wide');
  loadPipelineAnalytics();
}
async function loadPipelineAnalytics() {
  destroyPlaCharts();
  var box = document.getElementById('pl-analytics-body');
  if (!box) return;
  box.innerHTML = '<div class="text-center py-8 text-slate-400"><i class="fas fa-spinner fa-spin text-xl"></i></div>';
  try {
    // Use the richer /pipeline/analytics endpoint with period filter
    var r = await API.get('/pipeline/analytics?period=' + _plaPeriod);
    renderPipelineAnalyticsRich(r.data.data);
  } catch (e) {
    if (box) box.innerHTML = '<div class="text-center py-8 text-red-400"><i class="fas fa-circle-exclamation mr-1"></i>분석 데이터를 불러올 수 없습니다</div>';
  }
}
function renderPipelineAnalyticsRich(d) {
  var stageColors = { contact:'#94a3b8', meeting:'#3b82f6', demo:'#8b5cf6', proposal:'#f59e0b', contract:'#059669', active_customer:'#2563eb' };
  var stageLabels = { contact:'첫 접촉', meeting:'미팅 진행', demo:'데모/시연', proposal:'제안/협의', contract:'계약', active_customer:'활성 거래처' };
  var funnel = d.funnel || [];
  var totalActive = funnel.reduce(function(s,x){ return s + Number(x.current||0); }, 0);
  var totalEntries = funnel.reduce(function(s,x){ return s + Number(x.entries||0); }, 0);
  var totalProgressed = funnel.reduce(function(s,x){ return s + Number(x.progressed||0); }, 0);
  var overallConv = totalEntries > 0 ? Math.round(totalProgressed / totalEntries * 100) : 0;

  var html = '<div class="space-y-4">';

  // Period selector + KPI summary cards
  html += '<div class="flex flex-wrap items-center justify-between gap-3">' +
    '<div class="flex items-center gap-2">' +
      '<span class="text-xs text-slate-400 font-semibold">분석 기간</span>' +
      '<select class="input !py-1.5 !text-xs !w-auto !pr-7" style="border-radius:8px" onchange="_plaPeriod=Number(this.value);loadPipelineAnalytics()">' +
        ['30','90','180','365'].map(function(v){ return '<option value="'+v+'"'+(Number(v)===_plaPeriod?' selected':'')+'>'+(v==='365'?'최근 1년':'최근 '+v+'일')+'</option>'; }).join('') +
      '</select>' +
    '</div>' +
    '<button class="btn btn-outline btn-sm" onclick="loadPipelineAnalytics()" aria-label="새로고침"><i class="fas fa-arrows-rotate text-xs"></i><span class="hidden sm:inline">새로고침</span></button>' +
  '</div>';

  // Top KPI summary (4 cards)
  html += '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
    '<div class="card-flat p-4"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:#eef4ff"><i class="fas fa-users text-brand-600"></i></div><div><div class="text-[10px] text-slate-400 font-medium">활성 기관</div><div class="text-xl font-extrabold text-slate-800">'+totalActive+'<span class="text-[11px] text-slate-400 ml-1">개</span></div></div></div></div>' +
    '<div class="card-flat p-4"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:#ecfdf5"><i class="fas fa-arrows-turn-to-dots text-emerald-600"></i></div><div><div class="text-[10px] text-slate-400 font-medium">기간 내 진입</div><div class="text-xl font-extrabold text-slate-800">'+totalEntries+'<span class="text-[11px] text-slate-400 ml-1">건</span></div></div></div></div>' +
    '<div class="card-flat p-4"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:#f5f3ff"><i class="fas fa-percent text-violet-600"></i></div><div><div class="text-[10px] text-slate-400 font-medium">평균 전환율</div><div class="text-xl font-extrabold text-slate-800">'+overallConv+'<span class="text-[11px] text-slate-400 ml-1">%</span></div></div></div></div>' +
    '<div class="card-flat p-4"><div class="flex items-center gap-2.5"><div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:#fff7ed"><i class="fas fa-hourglass-half text-amber-600"></i></div><div><div class="text-[10px] text-slate-400 font-medium">병목 단계</div><div class="text-sm font-extrabold text-slate-800 truncate">'+(d.bottleneck ? d.bottleneck.label : '-')+'</div><div class="text-[10px] text-amber-600 font-semibold">'+(d.bottleneck ? d.bottleneck.avg_dwell_days+'일 체류' : '데이터 부족')+'</div></div></div></div>' +
  '</div>';

  // Funnel visualization (visual + chart)
  var maxCurrent = Math.max.apply(null, funnel.map(function(s){return s.current;})) || 1;
  html += '<div class="card-flat p-5">' +
    '<div class="flex items-center gap-2.5 mb-4"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#eef4ff,#dbeafe)"><i class="fas fa-filter text-brand-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">단계별 깔때기</span><span class="ml-auto text-[10px] text-slate-400">현재 분포 + 단계 간 전환율</span></div>' +
    '<div class="space-y-2.5">' +
    funnel.map(function(s, i){
      var pct = Math.max(8, Math.round((s.current / maxCurrent) * 100));
      var color = stageColors[s.stage] || '#94a3b8';
      var arrow = i < funnel.length - 1 ? '<div class="flex items-center justify-center text-[10px] text-slate-400 my-0.5"><i class="fas fa-chevron-down"></i> 전환율 <strong class="text-slate-600 mx-1">' + s.conversion_rate + '%</strong> (' + s.progressed + '/' + s.entries + ')</div>' : '';
      var convBadge = s.conversion_rate >= 70 ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">우수</span>' : (s.conversion_rate >= 40 ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">양호</span>' : (s.entries > 0 ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">개선 필요</span>' : ''));
      return '<div>' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-20 text-right text-[11px] font-semibold text-slate-600 flex-shrink-0">' + (stageLabels[s.stage] || s.label) + '</div>' +
          '<div class="flex-1 h-9 rounded-lg flex items-center px-3 transition-all duration-700" style="width:' + pct + '%;background:linear-gradient(90deg,' + color + 'cc,' + color + ')">' +
            '<span class="text-white font-bold text-sm">' + s.current + '</span>' +
            '<span class="text-white/80 text-[10px] ml-2">개 기관</span>' +
            '<span class="ml-auto">' + convBadge + '</span>' +
          '</div>' +
          '<div class="w-24 text-right flex-shrink-0"><div class="text-[10px] text-slate-400">평균 체류</div><div class="text-[13px] font-extrabold text-slate-700">' + s.avg_dwell_days + '<span class="text-[10px] text-slate-400 ml-0.5">일</span></div></div>' +
        '</div>' +
        arrow +
      '</div>';
    }).join('') +
    '</div>' +
  '</div>';

  // Charts row: conversion rate bar + dwell days bar
  html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
    '<div class="card-flat p-5">' +
      '<div class="flex items-center gap-2.5 mb-3"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#ecfdf5,#d1fae5)"><i class="fas fa-chart-column text-emerald-600 text-xs"></i></div><span class="font-bold text-[13px] text-slate-800">단계별 전환율</span></div>' +
      '<div style="height:180px"><canvas id="pla-chart-conv"></canvas></div>' +
    '</div>' +
    '<div class="card-flat p-5">' +
      '<div class="flex items-center gap-2.5 mb-3"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fff7ed,#fed7aa)"><i class="fas fa-clock text-amber-600 text-xs"></i></div><span class="font-bold text-[13px] text-slate-800">단계별 평균 체류 일수</span></div>' +
      '<div style="height:180px"><canvas id="pla-chart-dwell"></canvas></div>' +
    '</div>' +
  '</div>';

  // Bottleneck warning + Recent transitions timeline
  if (d.bottleneck) {
    html += '<div class="card-flat p-4" style="border-left:3px solid #f59e0b;background:linear-gradient(90deg,#fff7ed 0%,transparent 100%)">' +
      '<div class="flex items-start gap-3"><div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:#fed7aa"><i class="fas fa-triangle-exclamation text-amber-700"></i></div>' +
      '<div class="flex-1"><div class="font-bold text-[13px] text-slate-800 mb-0.5">병목 단계: ' + d.bottleneck.label + '</div>' +
      '<div class="text-[12px] text-slate-600">현재 <strong class="text-amber-700">' + d.bottleneck.current + '개 기관</strong>이 평균 <strong class="text-amber-700">' + d.bottleneck.avg_dwell_days + '일</strong> 체류 중이며, 기간 내 전환율 <strong class="text-amber-700">' + d.bottleneck.conversion_rate + '%</strong>로 다른 단계 대비 정체되어 있습니다.</div>' +
      '</div></div>' +
    '</div>';
  }

  // Recent transitions
  html += '<div class="card-flat p-5">' +
    '<div class="flex items-center gap-2.5 mb-3"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe)"><i class="fas fa-clock-rotate-left text-violet-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">최근 단계 변경</span><span class="ml-auto text-[10px] text-slate-400">최근 15건</span></div>' +
    ((d.recent_changes && d.recent_changes.length) ?
      '<div class="space-y-2 max-h-[280px] overflow-y-auto pr-1">' + d.recent_changes.map(function(c){
        var fc = stageColors[c.from_stage] || '#94a3b8';
        var tc = stageColors[c.to_stage] || '#94a3b8';
        return '<div class="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition" onclick="closeModal();viewHosp(' + c.hospital_id + ')">' +
          '<div class="flex-1 min-w-0"><div class="text-[13px] font-semibold text-slate-700 truncate">' + (c.hospital_name || '') + '</div>' +
          '<div class="flex items-center gap-1.5 mt-0.5 text-[10px]">' +
            '<span class="px-1.5 py-0.5 rounded" style="background:' + fc + '20;color:' + fc + '">' + (stageLabels[c.from_stage] || c.from_stage || '-') + '</span>' +
            '<i class="fas fa-arrow-right text-slate-300 text-[8px]"></i>' +
            '<span class="px-1.5 py-0.5 rounded font-bold" style="background:' + tc + '20;color:' + tc + '">' + (stageLabels[c.to_stage] || c.to_stage) + '</span>' +
            (c.changed_by_name ? '<span class="text-slate-400 ml-1">· ' + c.changed_by_name + '</span>' : '') +
          '</div></div>' +
          '<div class="text-[10px] text-slate-400 flex-shrink-0">' + fmtShort(c.changed_at) + '</div>' +
        '</div>';
      }).join('') + '</div>' :
      '<div class="text-xs text-slate-300 text-center py-4">최근 단계 변경 이력이 없습니다</div>'
    ) +
  '</div>';

  html += '</div>';
  document.getElementById('pl-analytics-body').innerHTML = html;

  // Render charts
  setTimeout(function() {
    try {
      var convEl = document.getElementById('pla-chart-conv');
      var dwellEl = document.getElementById('pla-chart-dwell');
      if (convEl && window.Chart) {
        Chart.defaults.font.family = 'Pretendard,sans-serif';
        var convChart = new Chart(convEl, {
          type: 'bar',
          data: {
            labels: funnel.map(function(s){ return stageLabels[s.stage] || s.label; }),
            datasets: [{
              label: '전환율(%)',
              data: funnel.map(function(s){ return s.conversion_rate; }),
              backgroundColor: funnel.map(function(s){ return stageColors[s.stage] || '#94a3b8'; }),
              borderRadius: 6, barPercentage: 0.6
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx){ var s=funnel[ctx.dataIndex]; return s.conversion_rate+'% ('+s.progressed+'/'+s.entries+')'; } } } },
            scales: { y: { beginAtZero: true, max: 100, grid: { color: '#eef0f5' }, ticks: { font: { size: 10 }, callback: function(v){ return v+'%'; } } }, x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' } } } }
          }
        });
        _plaCharts.push(convChart);
      }
      if (dwellEl && window.Chart) {
        var dwellChart = new Chart(dwellEl, {
          type: 'bar',
          data: {
            labels: funnel.map(function(s){ return stageLabels[s.stage] || s.label; }),
            datasets: [{
              label: '평균 체류(일)',
              data: funnel.map(function(s){ return s.avg_dwell_days; }),
              backgroundColor: funnel.map(function(s){ return (stageColors[s.stage] || '#94a3b8')+'aa'; }),
              borderColor: funnel.map(function(s){ return stageColors[s.stage] || '#94a3b8'; }),
              borderWidth: 1, borderRadius: 6, barPercentage: 0.6
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx){ return ctx.parsed.y + '일'; } } } },
            scales: { y: { beginAtZero: true, grid: { color: '#eef0f5' }, ticks: { font: { size: 10 }, callback: function(v){ return v+'일'; } } }, x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' } } } }
          }
        });
        _plaCharts.push(dwellChart);
      }
    } catch(e) { console.error(e); }
  }, 100);
}

async function showPipelineView() {
  _pipelineTab = 'board';
  openModal('영업 파이프라인', '<div class="text-center py-6"><i class="fas fa-spinner fa-spin text-xl text-slate-300"></i></div>', 'wide');
  renderPipelineShell();
}

function renderPipelineShell() {
  var tabs = '<div class="flex items-center gap-1 mb-4 border-b border-gray-100">' +
    '<button class="px-4 py-2 text-sm font-semibold transition ' + (_pipelineTab === 'board' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-400 hover:text-slate-600') + '" onclick="_pipelineTab=\'board\';renderPipelineShell()"><i class="fas fa-columns mr-1.5 text-xs"></i>보드</button>' +
    '<button class="px-4 py-2 text-sm font-semibold transition ' + (_pipelineTab === 'analytics' ? 'text-brand-600 border-b-2 border-brand-500' : 'text-slate-400 hover:text-slate-600') + '" onclick="_pipelineTab=\'analytics\';renderPipelineShell()"><i class="fas fa-chart-line mr-1.5 text-xs"></i>전환 분석</button>' +
  '</div>';
  document.getElementById('modal-body').innerHTML = tabs + '<div id="pipeline-tab-content"><div class="text-center py-6"><i class="fas fa-spinner fa-spin text-xl text-slate-300"></i></div></div>';
  if (_pipelineTab === 'board') renderPipelineBoard();
  else renderPipelineAnalytics();
}

async function renderPipelineBoard() {
  try {
    var r = await API.get('/pipeline');
    var stages = r.data.data.stages;
    var stageColors = { contact: 'slate', meeting: 'blue', demo: 'violet', proposal: 'amber', contract: 'emerald', active_customer: 'brand' };
    var stageIcons = { contact: 'fa-handshake-angle', meeting: 'fa-calendar-check', demo: 'fa-laptop', proposal: 'fa-file-contract', contract: 'fa-file-signature', active_customer: 'fa-building-circle-check' };
    var html = '<div class="overflow-x-auto -mx-4 lg:-mx-6 px-4 lg:px-6 pb-4"><div class="flex gap-3" style="min-width:' + (stages.length * 200) + 'px">';
    stages.forEach(function(s) {
      var color = stageColors[s.key] || 'slate';
      html += '<div class="flex-1 min-w-[180px]"><div class="text-center mb-3"><span class="text-xs font-bold text-' + color + '-600 bg-' + color + '-50 px-3 py-1 rounded-full"><i class="fas ' + (stageIcons[s.key]||'fa-circle') + ' mr-1"></i>' + s.label + '</span><div class="text-[10px] text-slate-400 mt-1">' + s.hospitals.length + '개</div></div>';
      html += '<div class="space-y-2">';
      s.hospitals.forEach(function(h) {
        html += '<div class="card-flat !p-3 cursor-pointer hover:shadow-md transition" onclick="closeModal();viewHosp(' + h.id + ')" draggable="true" data-hosp-id="' + h.id + '">' +
          '<div class="flex items-center gap-2 mb-1"><span class="text-[12px] font-bold text-slate-700 truncate">' + h.name + '</span></div>' +
          '<div class="flex items-center justify-between text-[10px] text-slate-400"><span>' + (h.region || '') + '</span><span>' + (h.meeting_count || 0) + '회</span></div></div>';
      });
      if (!s.hospitals.length) html += '<div class="text-center py-6 text-[11px] text-slate-300 border border-dashed border-gray-200 rounded-xl">비어 있음</div>';
      html += '</div></div>';
    });
    html += '</div></div>';
    html += '<div class="text-[10px] text-slate-400 mt-2"><i class="fas fa-info-circle mr-1"></i>기관 상세에서 파이프라인 단계를 변경할 수 있습니다</div>';
    document.getElementById('pipeline-tab-content').innerHTML = html;
  } catch(e) { document.getElementById('pipeline-tab-content').innerHTML = '<div class="text-center text-red-400 py-4">파이프라인 데이터를 불러올 수 없습니다</div>'; }
}

async function renderPipelineAnalytics() {
  try {
    var r = await API.get('/pipeline/analytics?period=' + _pipelinePeriod);
    var d = r.data.data;
    var stageColors = { contact: '#94a3b8', meeting: '#3b82f6', demo: '#8b5cf6', proposal: '#f59e0b', contract: '#059669', active_customer: '#2563eb' };
    var maxCurrent = Math.max.apply(null, d.funnel.map(function(s) { return s.current; })) || 1;

    // Period selector
    var periodSel = '<div class="flex items-center justify-between mb-4 flex-wrap gap-2">' +
      '<div class="flex items-center gap-2">' +
        '<span class="text-xs text-slate-400 font-semibold">분석 기간</span>' +
        '<select class="input !py-1.5 !text-xs !w-auto !pr-7" style="border-radius:8px" onchange="_pipelinePeriod=Number(this.value);renderPipelineAnalytics()">' +
          ['30','90','180','365'].map(function(v) {
            return '<option value="' + v + '"' + (Number(v) === _pipelinePeriod ? ' selected' : '') + '>' + (v === '365' ? '최근 1년' : '최근 ' + v + '일') + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
    '</div>';

    // Funnel visualization
    var funnel = '<div class="card-flat p-5 mb-4">' +
      '<div class="flex items-center gap-2.5 mb-4"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#eef4ff,#dbeafe)"><i class="fas fa-filter text-brand-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">단계별 깔때기</span></div>' +
      '<div class="space-y-2.5">' +
      d.funnel.map(function(s, i) {
        var pct = Math.max(8, Math.round((s.current / maxCurrent) * 100));
        var color = stageColors[s.stage] || '#94a3b8';
        var arrow = i < d.funnel.length - 1 ? '<div class="flex items-center justify-center text-[10px] text-slate-400 my-0.5"><i class="fas fa-chevron-down"></i> 전환율 <strong class="text-slate-600 mx-1">' + s.conversion_rate + '%</strong> (' + s.progressed + '/' + s.entries + ')</div>' : '';
        return '<div>' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-20 text-right text-[11px] font-semibold text-slate-600 flex-shrink-0">' + s.label + '</div>' +
            '<div class="flex-1 h-9 rounded-lg flex items-center px-3 transition-all duration-700" style="width:' + pct + '%;background:linear-gradient(90deg,' + color + 'cc,' + color + ')">' +
              '<span class="text-white font-bold text-sm">' + s.current + '</span>' +
              '<span class="text-white/80 text-[10px] ml-2">개 기관</span>' +
            '</div>' +
            '<div class="w-24 text-right flex-shrink-0"><div class="text-[10px] text-slate-400">평균 체류</div><div class="text-[13px] font-extrabold text-slate-700">' + s.avg_dwell_days + '<span class="text-[10px] text-slate-400 ml-0.5">일</span></div></div>' +
          '</div>' +
          arrow +
        '</div>';
      }).join('') +
      '</div>' +
    '</div>';

    // Bottleneck card
    var bottleneck = '';
    if (d.bottleneck) {
      bottleneck = '<div class="card-flat p-5 mb-4" style="border-left:3px solid #f59e0b">' +
        '<div class="flex items-center gap-2.5 mb-2"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fff7ed,#fed7aa)"><i class="fas fa-hourglass-half text-amber-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">병목 단계</span></div>' +
        '<div class="text-sm text-slate-600">현재 <strong class="text-amber-600">' + d.bottleneck.label + '</strong> 단계에서 평균 <strong class="text-amber-600">' + d.bottleneck.avg_dwell_days + '일</strong> 체류 중이며, ' + d.bottleneck.current + '개 기관이 정체되어 있습니다.</div>' +
        (d.bottleneck.entries > 0 ? '<div class="text-[11px] text-slate-400 mt-1">기간 내 전환율: ' + d.bottleneck.conversion_rate + '% (' + d.bottleneck.progressed + '/' + d.bottleneck.entries + ')</div>' : '') +
      '</div>';
    }

    // Recent stage changes timeline
    var recent = '<div class="card-flat p-5">' +
      '<div class="flex items-center gap-2.5 mb-3"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#f5f3ff,#ede9fe)"><i class="fas fa-clock-rotate-left text-violet-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">최근 단계 변경</span></div>' +
      ((d.recent_changes && d.recent_changes.length) ?
        '<div class="space-y-2">' + d.recent_changes.map(function(c) {
          var fc = stageColors[c.from_stage] || '#94a3b8';
          var tc = stageColors[c.to_stage] || '#94a3b8';
          var fl = ({ contact: '첫 접촉', meeting: '미팅 진행', demo: '데모/시연', proposal: '제안/협의', contract: '계약', active_customer: '활성 거래처' });
          return '<div class="flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 cursor-pointer hover:bg-gray-100 transition" onclick="closeModal();viewHosp(' + c.hospital_id + ')">' +
            '<div class="flex-1 min-w-0"><div class="text-[13px] font-semibold text-slate-700 truncate">' + (c.hospital_name || '') + '</div>' +
            '<div class="flex items-center gap-1.5 mt-0.5 text-[10px]">' +
              '<span class="px-1.5 py-0.5 rounded" style="background:' + fc + '20;color:' + fc + '">' + (fl[c.from_stage] || c.from_stage || '-') + '</span>' +
              '<i class="fas fa-arrow-right text-slate-300 text-[8px]"></i>' +
              '<span class="px-1.5 py-0.5 rounded font-bold" style="background:' + tc + '20;color:' + tc + '">' + (fl[c.to_stage] || c.to_stage) + '</span>' +
              (c.changed_by_name ? '<span class="text-slate-400 ml-1">· ' + c.changed_by_name + '</span>' : '') +
            '</div></div>' +
            '<div class="text-[10px] text-slate-400 flex-shrink-0">' + fmtShort(c.changed_at) + '</div>' +
          '</div>';
        }).join('') + '</div>' :
        '<div class="text-xs text-slate-300 text-center py-4">최근 단계 변경 이력이 없습니다</div>'
      ) +
    '</div>';

    document.getElementById('pipeline-tab-content').innerHTML = periodSel + funnel + bottleneck + recent;
  } catch (e) {
    document.getElementById('pipeline-tab-content').innerHTML = '<div class="text-center text-red-400 py-4">전환 분석 데이터를 불러올 수 없습니다</div>';
  }
}

// ===== HOSPITALS =====
var _hospViewMode = localStorage.getItem('todoc_hosp_view') || 'card';
async function loadHosp(typeFilter) {
  document.getElementById('page-title').textContent = '기관 관리';
  document.getElementById('header-actions').innerHTML = exportMenu('hospitals','기관') + '<button class="btn btn-primary" onclick="showHospForm()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">추가</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">' + Array(6).fill('<div class="card p-5"><div class="space-y-3"><div class="skeleton rounded h-5 w-32"></div><div class="skeleton rounded h-3 w-48"></div></div></div>').join('') + '</div></div>';
  try {
    const [hR, rR] = await Promise.all([API.get('/hospitals'), API.get('/regions')]);
    hospList = hR.data.data; const regions = rR.data.data;
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' +
      '<div class="relative flex-1 filter-search"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="h-search" oninput="filterH()" placeholder="기관명 검색" class="input pl-10"></div>' +
      '<select id="h-type" onchange="filterH()" class="input filter-select"><option value="">전체 유형</option><option value="hospital">병원</option><option value="clinic">의원</option></select>' +
      '<select id="h-region" onchange="filterH()" class="input filter-select"><option value="">전체 지역</option>' + regions.map(r => '<option>' + r + '</option>').join('') + '</select>' +

      '<label class="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0"><input type="checkbox" id="h-fav-only" onchange="filterH()" class="w-3.5 h-3.5 rounded border-gray-300 text-amber-500"><span class="text-[11px] text-slate-500"><i class="fas fa-star text-amber-400"></i></span></label>' +
      '<select id="h-sort" onchange="applyHospSort()" class="input filter-select text-[11px] !w-auto !min-w-0"><option value="name-asc">\uc774\ub984 \u2191</option><option value="name-desc">\uc774\ub984 \u2193</option><option value="total_meetings-desc">\ubbf8\ud305 \u2191</option><option value="total_meetings-asc">\ubbf8\ud305 \u2193</option><option value="last_meeting-desc">\ucd5c\uadfc\ubc29\ubb38 \u2191</option><option value="last_meeting-asc">\ucd5c\uadfc\ubc29\ubb38 \u2193</option><option value="doctor_count-desc">\uc758\ub8cc\uc9c4 \u2191</option><option value="doctor_count-asc">\uc758\ub8cc\uc9c4 \u2193</option></select>' +
      // View mode switcher
      '<div class="flex items-center bg-slate-100 rounded-lg p-0.5 gap-0.5 flex-shrink-0">' +
      '<button id="hv-card" class="hv-btn" onclick="setHospView(\'card\')" title="카드뷰"><i class="fas fa-th-large"></i></button>' +
      '<button id="hv-list" class="hv-btn" onclick="setHospView(\'list\')" title="리스트뷰"><i class="fas fa-list"></i></button>' +
      '<button id="hv-table" class="hv-btn" onclick="setHospView(\'table\')" title="테이블뷰"><i class="fas fa-table"></i></button>' +
      '<button id="hv-map" class="hv-btn" onclick="setHospView(\'map\')" title="지도뷰"><i class="fas fa-map-location-dot"></i></button>' +
      '</div>' +
      '<span id="h-count" class="text-xs text-slate-300 font-medium"></span></div>' +
      '<div id="h-grid"></div></div>';
    if (typeFilter) { document.getElementById('h-type').value = typeFilter; }
    updateHospViewButtons();
    filterH();
  } catch (e) { toast('기관 목록을 불러올 수 없습니다', 'err') }
}
function setHospView(mode) {
  _hospViewMode = mode;
  localStorage.setItem('todoc_hosp_view', mode);
  updateHospViewButtons();
  filterH();
}
function updateHospViewButtons() {
  ['card','list','table','map'].forEach(function(m) {
    var btn = document.getElementById('hv-' + m);
    if (btn) {
      btn.className = 'hv-btn ' + (_hospViewMode === m ? 'hv-active' : '');
    }
  });
}
function renderH(list) {
  document.getElementById('h-count').textContent = list.length + '개 기관';
  var grid = document.getElementById('h-grid');
  if (!list.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fas fa-hospital"></i></div><p class="font-medium text-slate-500 mb-1">등록된 기관이 없습니다</p><p class="text-sm text-slate-300">"추가" 버튼으로 시작하세요</p></div>';
    return;
  }
  if (_hospViewMode === 'card') renderHCard(grid, list);
  else if (_hospViewMode === 'list') renderHList(grid, list);
  else if (_hospViewMode === 'table') renderHTable(grid, list);
  else if (_hospViewMode === 'map') renderHMap(grid, list);
  else renderHCard(grid, list);
}
// === Card View ===
function renderHCard(el, list) {
  el.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5';
  el.innerHTML = list.map(h => {
    const warn = h.last_meeting ? Math.floor((Date.now() - new Date(h.last_meeting + 'T00:00:00').getTime()) / 86400000) > 30 : '';
    return '<div class="card p-5 cursor-pointer" onclick="viewHosp(' + h.id + ')">' +
      '<div class="flex items-center gap-2 mb-3">' +
      todocBadge(h.todoc_contact) +
      statusDot(h.status) + (warn ? '<span class="ml-auto text-[10px] text-red-400 bg-red-50 px-2 py-0.5 rounded-full font-semibold"><i class="fas fa-exclamation-triangle mr-0.5"></i>30일+</span>' : '') +
      '<span class="ml-auto">' + favStar('hospital', h.id) + '</span></div>' +
      '<h3 class="font-bold text-slate-800 text-[15px] mb-1 truncate">' + h.name + '</h3>' +
      '<p class="text-xs text-slate-400"><i class="fas fa-location-dot mr-1"></i>' + (h.region || '미지정') + '</p>' +
      '<div class="flex gap-2 mt-4">' +
      '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5">인원</p><p class="text-sm font-bold text-brand-600">' + (h.doctor_count || 0) + '</p></div>' +
      '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5">미팅</p><p class="text-sm font-bold text-slate-600">' + (h.meeting_count || 0) + '</p></div>' +
      '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5">최근</p><p class="text-[11px] font-semibold ' + (h.last_meeting ? daysClass(h.last_meeting) : 'text-slate-300') + '">' + (h.last_meeting ? daysAgo(h.last_meeting) : '없음') + '</p></div>' +
      '</div>' +
      '<div class="flex gap-2 mt-3 pt-3 border-t border-gray-50">' + clinicMetric('fa-ear-listen', '난청환자', h.patient_count || 0) + clinicMetric('fa-headphones', '보청기', h.hearing_aid_sales || 0) + clinicMetric('fa-microchip', 'CI의뢰', h.ci_referrals || 0, h.ci_referrals > 0 ? 'text-violet-600' : '') + '</div>' +
      (h.notes ? '<p class="text-[11px] text-slate-400 mt-3 line-clamp-1 leading-relaxed border-t border-gray-50 pt-3"><i class="fas fa-quote-left text-slate-200 mr-1"></i>' + h.notes + '</p>' : '') +
      '</div>'
  }).join('');
}
// === List View ===
function renderHList(el, list) {
  el.className = '';
  el.innerHTML = '<div class="card-flat p-0 overflow-hidden">' + list.map(function(h) {
    var warn = h.last_meeting ? Math.floor((Date.now() - new Date(h.last_meeting + 'T00:00:00').getTime()) / 86400000) > 30 : false;
    return '<div class="flex items-center gap-3 px-4 lg:px-5 py-3.5 border-b border-gray-50 last:border-0 tr cursor-pointer" onclick="viewHosp(' + h.id + ')">' +
      '<div class="w-10 h-10 rounded-xl flex items-center justify-center text-sm flex-shrink-0 bg-brand-50 text-brand-600"><i class="fas fa-hospital text-base"></i></div>' +
      '<div class="flex-1 min-w-0">' +
      '<div class="flex items-center gap-2"><span class="font-bold text-[13px] text-slate-800 truncate">' + h.name + '</span>' + statusDot(h.status) + (warn ? '<span class="text-[9px] text-red-400 bg-red-50 px-1.5 py-0.5 rounded-full font-bold">30일+</span>' : '') + '</div>' +
      '<div class="flex items-center gap-3 mt-0.5 text-[11px] text-slate-400">' +
      '<span><i class="fas fa-location-dot mr-0.5"></i>' + (h.region || '-') + '</span>' +
      '<span><i class="fas fa-user-doctor mr-0.5"></i>' + (h.doctor_count || 0) + '명</span>' +
      '<span><i class="fas fa-handshake mr-0.5"></i>' + (h.meeting_count || 0) + '건</span>' +
      (h.ci_referrals > 0 ? '<span class="text-violet-500 font-bold"><i class="fas fa-microchip mr-0.5"></i>CI ' + h.ci_referrals + '</span>' : '') +
      '</div></div>' +
      '<div class="text-right flex-shrink-0">' +
      '<div class="text-[11px] font-semibold ' + (h.last_meeting ? daysClass(h.last_meeting) : 'text-slate-300') + '">' + (h.last_meeting ? daysAgo(h.last_meeting) : '미방문') + '</div>' +
      '</div>' +
      '<span class="flex-shrink-0">' + favStar('hospital', h.id) + '</span>' +
      '</div>';
  }).join('') + '</div>';
}
// === Table View ===
function renderHTable(el, list) {
  el.className = '';
  el.innerHTML = '<div class="card-flat overflow-hidden"><div class="table-wrap"><table class="w-full text-left">' +
    '<thead><tr class="bg-slate-50 border-b border-gray-200">' +

    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500">기관명</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500">지역</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500 text-center">인원</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500 text-center">미팅</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500 text-center">난청</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500 text-center">보청기</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500 text-center">CI</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500">최근 미팅</th>' +
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500">상태</th>' +
    '</tr></thead><tbody>' +
    list.map(function(h) {
      return '<tr class="border-b border-gray-50 tr cursor-pointer hover:bg-slate-50/50" onclick="viewHosp(' + h.id + ')">' +

        '<td class="px-3 py-2.5"><span class="font-bold text-[12px] text-slate-800">' + h.name + '</span></td>' +
        '<td class="px-3 py-2.5 text-[11px] text-slate-500">' + (h.region || '-') + '</td>' +
        '<td class="px-3 py-2.5 text-center text-[12px] font-bold text-brand-600">' + (h.doctor_count || 0) + '</td>' +
        '<td class="px-3 py-2.5 text-center text-[12px] font-bold">' + (h.meeting_count || 0) + '</td>' +
        '<td class="px-3 py-2.5 text-center text-[12px]">' + (h.patient_count || 0) + '</td>' +
        '<td class="px-3 py-2.5 text-center text-[12px]">' + (h.hearing_aid_sales || 0) + '</td>' +
        '<td class="px-3 py-2.5 text-center text-[12px] ' + (h.ci_referrals > 0 ? 'font-bold text-violet-600' : '') + '">' + (h.ci_referrals || 0) + '</td>' +
        '<td class="px-3 py-2.5 text-[11px] ' + (h.last_meeting ? daysClass(h.last_meeting) : 'text-slate-300') + '">' + (h.last_meeting ? daysAgo(h.last_meeting) : '-') + '</td>' +
        '<td class="px-3 py-2.5">' + statusDot(h.status) + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table></div></div>';
}
// === Map View ===
function renderHMap(el, list) {
  el.className = '';
  // Count hospitals per region
  var regionCounts = {};
  var regionGrades = {};
  list.forEach(function(h) {
    var r = h.region || '미지정';
    regionCounts[r] = (regionCounts[r] || 0) + 1;
    if (!regionGrades[r]) regionGrades[r] = { total: 0, ci: 0, meetings: 0, names: [] };
    regionGrades[r].total++;
    regionGrades[r].ci += (h.ci_referrals || 0);
    regionGrades[r].meetings += (h.meeting_count || 0);
    if (regionGrades[r].names.length < 3) regionGrades[r].names.push(h.name);
  });
  
  var html = '<div class="grid grid-cols-1 lg:grid-cols-3 gap-5">';
  // Map column
  html += '<div class="lg:col-span-2 card-flat p-4 lg:p-6">' +
    '<div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center"><i class="fas fa-map-location-dot text-brand-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">기관 분포 지도</span><span class="text-xs text-slate-400">' + list.length + '개 기관</span></div>' +
    '<div id="korea-map-container" class="relative" style="max-width:420px;margin:0 auto">' + renderKoreaMap(regionCounts, regionGrades) + '</div>' +
    '<div class="flex flex-wrap gap-3 mt-4 justify-center text-[10px]">' +
    '<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-brand-500"></span>5개+</span>' +
    '<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-brand-300"></span>3-4개</span>' +
    '<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-brand-100"></span>1-2개</span>' +
    '<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200"></span>없음</span></div>' +
    '</div>';
  // Region list column
  html += '<div class="space-y-3">';
  var sortedRegions = Object.keys(regionGrades).sort(function(a, b) { return regionGrades[b].total - regionGrades[a].total; });
  sortedRegions.forEach(function(r) {
    var rg = regionGrades[r];
    html += '<div class="card-flat p-3 cursor-pointer hover:shadow-md transition" onclick="document.getElementById(\'h-region\').value=\'' + r + '\';setHospView(\'card\');filterH()">' +
      '<div class="flex items-center justify-between mb-1"><span class="font-bold text-[13px] text-slate-800"><i class="fas fa-location-dot text-brand-400 mr-1.5"></i>' + r + '</span><span class="text-[12px] font-extrabold text-brand-600">' + rg.total + '개</span></div>' +
      '<div class="flex gap-2 text-[10px] text-slate-400">' +
      '<span><i class="fas fa-handshake mr-0.5"></i>' + rg.meetings + '</span>' +
      (rg.ci > 0 ? '<span class="text-violet-600 font-bold"><i class="fas fa-microchip mr-0.5"></i>' + rg.ci + '</span>' : '') +
      '</div>' +
      '<div class="text-[10px] text-slate-300 mt-1 truncate">' + rg.names.join(', ') + (rg.total > 3 ? ' 외 ' + (rg.total - 3) + '곳' : '') + '</div>' +
      '</div>';
  });
  html += '</div></div>';
  el.innerHTML = html;
}

// Korea SVG Map - High quality paths from GADM GeoJSON (free for commercial use)
function renderKoreaMap(counts, grades) {
  // High-quality Korea map from GADM GeoJSON (free for commercial use)
  var regions = {
    '경기': { path: 'M174.1,24.9 L176.4,29.6 L181.8,29.4 L182.1,35.5 L188.8,36.0 L195.7,31.1 L194.8,37.8 L197.5,36.4 L200.6,38.9 L202.5,36.6 L205.3,38.2 L207.3,36.6 L209.3,46.2 L213.9,47.2 L214.8,50.6 L218.1,51.6 L217.6,56.8 L212.8,60.5 L211.3,70.2 L213.5,71.2 L213.2,76.3 L233.0,84.0 L229.3,89.2 L231.6,94.8 L229.8,109.1 L222.3,119.3 L219.7,119.1 L217.6,126.1 L214.0,128.7 L208.1,128.1 L193.8,140.0 L183.4,133.9 L168.7,136.4 L167.5,133.0 L163.5,133.6 L165.4,131.8 L159.1,127.2 L160.6,125.2 L157.4,125.0 L154.0,119.1 L158.0,122.8 L158.3,117.2 L163.0,114.6 L159.5,114.6 L160.4,111.9 L153.2,118.3 L151.8,115.8 L153.4,114.3 L150.5,114.4 L150.4,112.0 L153.2,105.1 L157.9,105.8 L158.8,109.2 L161.6,103.1 L164.4,105.6 L162.2,102.2 L153.7,99.2 L148.4,100.7 L144.9,104.1 L148.3,105.6 L150.5,110.9 L148.6,107.5 L148.0,109.9 L142.4,110.6 L144.5,105.7 L142.3,102.9 L144.5,103.9 L153.2,99.1 L157.0,93.7 L160.0,94.2 L157.5,93.3 L158.9,83.7 L162.1,83.3 L162.5,87.6 L168.4,90.4 L176.5,89.4 L180.2,92.2 L185.9,88.7 L187.0,83.5 L183.8,81.9 L181.4,71.8 L176.1,71.1 L168.3,74.6 L166.4,78.8 L160.5,79.9 L153.9,77.5 L145.6,78.2 L141.9,70.3 L141.3,62.5 L151.7,60.8 L153.0,46.5 L159.9,45.2 L166.7,34.7 L173.0,30.3 L174.1,24.9 Z', cx: 175, cy: 87, labelY: 100 },
    '서울': { path: 'M178.9,71.4 L182.0,72.2 L183.3,74.7 L183.8,81.9 L186.0,82.0 L187.0,83.5 L185.2,85.5 L185.9,88.7 L184.6,90.6 L179.3,92.2 L176.5,89.4 L168.4,90.4 L162.5,87.6 L162.1,83.3 L160.6,84.1 L158.9,83.7 L160.5,79.9 L162.6,78.1 L164.6,79.2 L166.4,78.8 L168.7,74.3 L172.6,73.8 L176.1,71.1 L178.9,71.4 Z', cx: 174, cy: 82 },
    '인천': { path: 'M153.9,77.5 L160.5,79.9 L158.9,90.5 L150.4,97.9 L145.8,98.8 L152.8,94.8 L149.1,89.3 L148.8,91.0 L147.8,89.0 L146.0,90.2 L147.0,86.5 L150.4,85.7 L147.2,85.1 L147.4,80.6 L143.0,83.2 L145.8,85.9 L136.3,91.6 L130.5,90.0 L130.2,87.2 L147.4,80.5 L145.7,78.2 L153.9,77.5 Z M135.0,56.8 L141.8,63.9 L142.5,75.3 L137.4,77.5 L130.9,75.5 L130.6,73.4 L133.7,71.8 L129.6,66.8 L129.6,60.1 L135.0,56.8 Z', cx: 147, cy: 87 },
    '강원': { path: 'M270.2,-9.5 L283.6,16.6 L284.2,22.2 L287.2,24.3 L289.3,35.7 L290.2,33.7 L292.6,35.7 L306.6,57.2 L319.0,70.0 L318.1,73.3 L323.3,78.4 L325.3,85.0 L323.8,86.0 L333.2,95.1 L333.7,100.0 L340.0,107.4 L339.7,114.3 L332.3,121.1 L332.0,126.2 L323.2,122.7 L320.1,125.9 L310.6,123.2 L306.9,124.7 L298.5,121.1 L299.6,125.1 L290.6,126.3 L282.3,121.1 L274.8,122.0 L271.9,117.6 L264.9,118.8 L263.3,116.9 L267.4,112.6 L259.5,110.2 L247.4,114.3 L246.0,110.4 L242.5,109.4 L239.3,111.2 L240.0,116.8 L231.7,117.4 L229.3,109.4 L231.5,92.7 L229.3,89.2 L233.0,84.0 L213.8,76.8 L213.5,71.2 L211.3,70.2 L212.8,60.5 L217.6,56.8 L217.9,50.9 L209.3,46.2 L207.3,36.6 L205.3,38.2 L202.5,36.6 L200.6,38.9 L197.5,36.4 L194.8,37.8 L195.7,31.1 L188.8,36.0 L182.1,35.5 L181.8,29.4 L176.4,29.6 L174.0,25.5 L184.1,16.7 L191.7,14.7 L202.6,14.3 L210.3,17.2 L216.0,14.2 L230.3,13.7 L233.3,17.0 L237.4,14.6 L250.3,16.3 L265.2,5.6 L267.1,-7.5 L270.2,-9.5 Z', cx: 272, cy: 67 },
    '충북': { path: 'M246.9,114.1 L257.6,110.2 L266.9,112.1 L263.3,116.9 L264.9,118.8 L271.9,117.6 L274.8,122.0 L282.3,121.1 L290.1,126.1 L285.3,127.6 L276.4,135.8 L274.1,146.1 L265.9,146.4 L261.5,141.7 L258.9,146.8 L253.7,144.8 L251.9,147.5 L249.0,146.1 L246.4,152.0 L248.8,155.0 L241.7,153.2 L237.0,157.7 L238.9,159.7 L237.8,163.4 L234.0,161.0 L230.2,163.6 L237.1,172.0 L234.6,173.7 L235.9,184.9 L233.0,191.2 L245.8,193.6 L247.5,198.7 L242.5,199.5 L241.1,209.9 L236.6,212.3 L219.4,211.5 L214.4,202.8 L214.8,197.6 L207.7,194.5 L211.7,180.8 L208.9,180.9 L206.8,175.4 L203.9,176.9 L198.7,173.7 L199.8,168.5 L191.9,161.4 L197.7,150.3 L202.5,149.8 L193.8,140.0 L208.1,128.1 L214.0,128.7 L217.6,126.1 L219.7,119.1 L222.3,119.3 L228.6,109.6 L232.4,117.6 L240.0,116.8 L239.3,111.2 L242.5,109.4 L246.0,110.4 L246.9,114.1 Z', cx: 238, cy: 152 },
    '충남': { path: 'M140.7,121.9 L149.1,127.3 L159.7,129.4 L162.9,137.2 L184.7,134.2 L192.9,139.0 L201.0,147.7 L202.4,150.4 L197.7,150.3 L191.9,160.9 L199.8,168.5 L198.2,176.8 L193.4,179.2 L192.0,189.1 L196.6,195.5 L199.1,190.5 L203.5,197.0 L208.0,195.1 L214.1,196.7 L215.0,204.4 L220.4,210.8 L219.5,214.0 L206.9,213.2 L202.3,210.7 L196.5,201.6 L181.1,206.7 L176.8,201.1 L170.9,198.9 L167.1,200.5 L165.4,206.7 L162.0,209.3 L151.7,212.2 L148.3,206.0 L150.1,204.6 L145.1,200.6 L139.6,201.2 L143.4,190.2 L140.0,184.9 L146.1,183.1 L138.7,180.1 L138.9,177.9 L147.9,171.4 L144.4,171.3 L139.8,175.8 L138.8,169.4 L144.3,169.1 L139.2,168.3 L136.9,161.9 L133.3,160.0 L130.3,159.3 L125.4,163.4 L125.8,156.5 L123.2,153.8 L124.5,150.4 L116.4,155.1 L115.2,152.8 L120.0,152.3 L120.1,149.5 L114.8,147.8 L115.7,150.2 L113.3,152.4 L112.8,146.8 L115.2,145.5 L116.1,140.2 L118.9,146.0 L117.4,137.1 L121.5,134.8 L125.1,136.0 L126.3,129.2 L126.0,134.4 L128.2,136.9 L125.0,144.3 L128.6,143.1 L128.1,139.1 L130.6,141.8 L130.5,137.9 L135.2,135.8 L134.4,132.9 L128.3,130.8 L132.1,129.8 L127.9,127.4 L133.2,125.4 L137.1,127.4 L140.7,121.9 Z', cx: 155, cy: 166 },
    '세종': { path: 'M199.8,168.5 L198.7,173.7 L200.9,173.9 L201.6,176.1 L203.9,176.9 L206.2,175.2 L206.8,175.4 L203.9,176.9 L198.7,173.7 L199.8,168.5 Z', cx: 202, cy: 172 },
    '대전': { path: 'M198.7,173.7 L200.9,173.9 L201.6,176.1 L203.9,176.9 L205.1,176.9 L206.2,175.2 L206.8,175.4 L208.7,177.6 L208.9,180.9 L210.8,180.1 L212.1,181.8 L210.9,182.8 L209.6,186.9 L208.5,188.1 L207.6,193.1 L208.0,195.1 L205.9,195.6 L204.6,197.2 L203.5,197.0 L200.5,194.0 L200.4,191.2 L199.1,190.5 L198.3,193.9 L196.6,195.5 L194.1,193.3 L193.6,191.1 L192.0,189.1 L192.8,183.1 L193.6,182.2 L193.0,180.8 L193.4,179.2 L195.9,178.6 L198.2,176.8 L198.7,173.7 Z', cx: 202, cy: 185 },
    '전북': { path: 'M135.3,261.1 L138.9,253.1 L146.7,252.5 L149.3,248.7 L152.4,251.0 L152.2,247.7 L149.7,246.5 L142.1,248.3 L137.6,246.7 L137.0,243.3 L143.8,238.2 L141.1,234.6 L144.9,239.2 L149.0,233.8 L149.2,229.5 L157.3,230.5 L161.1,234.3 L159.7,229.2 L152.9,225.8 L160.2,224.1 L163.2,220.6 L147.8,222.2 L148.1,217.4 L142.7,217.4 L141.8,219.5 L141.5,215.2 L142.7,217.3 L144.7,216.3 L141.5,214.8 L157.0,213.5 L157.7,210.3 L165.4,206.7 L167.6,200.2 L170.9,198.9 L176.8,201.1 L181.1,206.7 L196.5,201.6 L202.3,210.7 L206.9,213.2 L212.1,212.3 L213.5,214.6 L218.0,214.7 L220.8,210.5 L228.0,213.2 L236.6,212.3 L239.3,217.5 L238.8,223.9 L235.1,227.5 L229.3,228.3 L223.5,236.5 L222.3,246.8 L219.0,252.0 L223.6,265.2 L220.2,267.6 L218.2,274.6 L207.9,269.6 L197.4,273.3 L185.1,272.3 L182.4,271.4 L183.0,266.7 L179.5,261.3 L174.6,265.1 L166.3,258.1 L160.4,260.0 L157.1,269.9 L144.5,272.7 L135.3,261.1 Z', cx: 180, cy: 237 },
    '광주': { path: 'M172.9,281.0 L172.9,283.0 L177.0,284.5 L176.2,288.5 L175.0,290.3 L169.3,291.3 L167.8,293.8 L165.8,292.9 L161.0,293.5 L159.5,290.5 L152.2,288.2 L152.3,285.9 L154.2,282.6 L157.0,281.6 L158.7,279.1 L163.8,281.3 L166.2,278.9 L169.1,278.6 L172.5,280.0 L172.9,281.0 Z', cx: 166, cy: 285 },
    '전남': { path: 'M228.0,319.4 L223.9,321.3 L221.0,318.3 L218.0,322.3 L220.6,328.5 L215.8,329.0 L213.4,321.8 L217.2,319.2 L211.7,313.7 L211.2,307.8 L209.0,311.1 L200.1,311.3 L205.0,313.3 L200.6,316.2 L203.2,317.1 L201.4,320.8 L208.5,325.4 L209.4,327.9 L207.1,327.7 L210.6,332.2 L199.7,332.7 L205.7,335.9 L201.8,341.8 L197.8,342.0 L198.0,345.0 L189.6,336.0 L189.8,338.6 L182.9,336.1 L192.6,322.0 L197.1,326.0 L197.9,318.6 L193.2,320.3 L191.0,318.1 L188.0,323.5 L184.0,322.7 L178.2,328.6 L171.8,328.8 L175.6,330.7 L172.2,337.3 L173.5,342.5 L170.4,340.5 L170.7,344.5 L165.9,343.8 L167.0,346.7 L160.0,342.7 L160.1,328.1 L156.4,344.0 L148.4,348.0 L147.4,355.7 L141.5,357.7 L141.4,351.8 L137.5,351.8 L141.1,347.4 L136.8,344.5 L137.6,336.7 L126.9,334.3 L123.1,322.9 L126.0,317.7 L130.8,331.1 L136.5,333.0 L139.0,330.1 L134.1,325.8 L132.0,327.5 L131.9,321.9 L136.9,323.1 L135.0,325.8 L137.7,328.0 L148.6,328.7 L139.9,319.9 L130.4,319.7 L134.2,307.0 L132.1,307.9 L131.2,297.6 L130.8,304.4 L126.4,303.6 L125.6,300.4 L132.3,294.5 L126.3,289.6 L127.0,293.0 L123.4,293.0 L122.1,287.4 L129.3,283.9 L128.1,289.5 L130.8,292.2 L133.1,290.5 L133.1,295.1 L137.0,291.1 L130.2,283.2 L131.4,279.5 L126.0,277.9 L131.7,272.1 L132.7,266.2 L136.3,267.3 L133.2,264.4 L134.5,261.0 L144.5,272.7 L157.1,269.9 L160.4,260.0 L166.3,258.1 L174.6,265.1 L179.5,261.3 L182.4,271.4 L185.8,272.5 L211.0,270.0 L218.2,274.6 L221.3,285.9 L230.4,298.0 L226.5,301.3 L225.3,297.5 L226.2,301.4 L219.7,307.0 L217.0,301.6 L218.0,306.7 L215.2,306.7 L219.6,312.6 L223.7,309.0 L229.2,309.3 L228.0,319.4 Z', cx: 172, cy: 310, labelY: 320 },
    '경북': { path: 'M339.6,113.5 L345.2,122.5 L343.0,130.5 L348.5,147.2 L343.9,159.4 L345.6,176.3 L342.4,182.0 L341.3,180.2 L341.0,195.5 L345.5,202.9 L340.9,209.2 L346.5,213.3 L353.3,205.2 L355.9,208.5 L346.3,246.1 L338.6,243.8 L334.3,245.7 L332.5,241.7 L324.2,239.7 L319.8,242.1 L320.1,246.3 L313.8,249.2 L307.6,247.3 L300.0,253.1 L288.5,251.8 L283.3,245.1 L283.8,241.0 L293.2,239.6 L298.4,227.3 L296.7,217.7 L292.8,215.2 L283.0,220.0 L280.3,225.7 L278.3,222.4 L273.8,224.8 L279.2,231.6 L274.5,235.5 L277.0,240.9 L272.5,241.1 L275.5,247.6 L261.1,245.7 L254.3,230.6 L239.1,223.4 L236.6,211.5 L241.1,209.9 L242.5,199.5 L247.5,198.1 L245.8,193.6 L233.0,191.2 L235.9,184.9 L234.6,173.7 L237.1,172.0 L230.2,163.6 L234.0,161.0 L237.8,163.4 L237.0,157.7 L241.7,153.2 L248.8,155.0 L246.4,152.0 L249.0,146.1 L258.9,146.8 L261.1,141.7 L265.9,146.4 L274.1,146.1 L276.4,135.8 L285.3,127.6 L299.6,125.1 L298.5,121.1 L320.1,125.9 L323.2,122.7 L331.5,126.4 L332.3,121.1 L339.6,113.5 Z', cx: 300, cy: 190 },
    '대구': { path: 'M293.4,215.4 L296.7,217.7 L296.3,221.5 L295.6,221.9 L297.7,223.8 L298.4,227.3 L297.8,229.6 L296.3,230.1 L293.2,235.5 L293.9,237.3 L293.2,239.6 L291.3,241.1 L288.6,241.0 L288.9,239.3 L287.6,238.7 L284.0,240.6 L283.2,243.8 L283.9,245.7 L283.1,246.6 L278.8,249.4 L274.7,249.1 L274.2,248.6 L275.5,247.6 L275.9,245.8 L272.5,241.1 L275.9,241.5 L277.0,240.9 L277.3,239.4 L274.8,237.8 L274.5,235.5 L276.1,231.9 L279.2,231.6 L279.1,230.4 L277.7,229.3 L274.3,228.4 L273.8,224.8 L275.4,223.3 L278.3,222.4 L278.6,224.6 L280.3,225.7 L282.3,223.3 L283.0,220.0 L285.1,219.2 L288.2,215.7 L293.4,215.4 Z', cx: 284, cy: 233 },
    '울산': { path: 'M324.9,239.7 L332.5,241.7 L332.2,243.9 L334.3,245.7 L337.3,246.0 L338.6,243.8 L344.9,246.0 L346.3,246.1 L347.6,247.7 L347.1,250.6 L346.5,252.6 L346.2,254.1 L345.2,255.6 L346.3,255.7 L345.5,256.7 L343.4,257.4 L342.6,253.2 L341.0,251.2 L342.1,253.6 L342.5,256.7 L340.4,258.3 L341.0,259.2 L339.4,259.7 L340.9,259.3 L340.8,260.8 L339.6,261.7 L340.4,263.0 L339.1,265.0 L340.2,267.3 L337.7,268.1 L335.8,264.1 L332.3,264.4 L331.0,262.0 L326.7,260.7 L324.5,257.2 L320.7,254.1 L316.2,254.1 L317.7,248.8 L316.7,246.9 L317.8,245.9 L320.1,246.3 L319.8,242.1 L324.9,239.7 Z', cx: 333, cy: 254 },
    '경남': { path: 'M243.3,227.5 L254.3,230.6 L260.0,238.4 L258.9,244.0 L262.4,246.4 L268.3,245.2 L278.8,249.4 L283.9,245.7 L288.5,251.8 L299.6,253.1 L307.1,247.4 L316.8,247.4 L316.2,254.1 L320.7,254.1 L332.3,264.4 L315.0,279.9 L308.4,281.3 L303.3,290.0 L299.9,290.8 L300.3,287.3 L293.6,289.3 L293.3,284.8 L291.7,287.5 L287.5,285.8 L286.3,280.5 L289.3,278.7 L284.6,282.0 L289.4,291.8 L283.7,292.9 L285.8,289.8 L282.7,287.3 L270.6,293.5 L270.2,296.6 L277.8,291.0 L280.1,295.7 L273.5,298.1 L276.1,299.3 L274.5,308.3 L275.8,304.8 L278.3,306.8 L273.7,311.6 L276.0,312.7 L274.7,317.8 L268.1,312.3 L272.0,313.4 L270.9,310.1 L274.4,308.9 L266.6,307.3 L269.9,305.3 L267.4,300.7 L264.1,306.0 L261.8,302.2 L258.7,302.8 L259.1,306.6 L248.6,303.5 L249.3,290.8 L246.9,288.1 L246.8,294.8 L243.1,294.2 L245.6,299.0 L241.1,299.4 L239.7,296.1 L237.8,301.2 L230.2,302.6 L229.2,295.3 L221.3,285.9 L217.7,275.4 L223.6,265.2 L219.0,252.0 L224.2,234.8 L229.3,228.3 L239.1,223.4 L243.3,227.5 Z', cx: 268, cy: 275 },
    '부산': { path: 'M336.0,264.7 L337.7,268.1 L336.0,270.5 L333.5,270.4 L333.0,274.1 L332.8,276.6 L331.5,279.2 L330.6,279.3 L331.2,280.3 L329.0,282.2 L326.5,283.9 L325.5,284.7 L323.8,283.2 L323.1,284.7 L324.1,287.4 L323.8,289.3 L321.6,289.3 L320.0,287.1 L318.1,288.6 L316.1,291.1 L315.3,290.3 L315.2,293.4 L314.4,292.6 L313.1,292.9 L312.7,294.8 L311.5,290.9 L310.3,288.2 L308.8,290.9 L306.9,290.8 L303.6,290.5 L304.9,288.7 L304.1,285.4 L308.1,284.7 L308.4,281.3 L313.6,280.5 L318.0,274.6 L322.6,270.8 L325.9,267.8 L331.8,264.5 L336.0,264.7 Z', cx: 320, cy: 280 },
    '제주': { path: 'M142.5,422.9 L150.1,420.2 L162.5,419.8 L165.1,422.9 L168.3,422.9 L169.3,429.0 L170.5,426.8 L171.3,428.8 L163.1,441.5 L151.1,444.2 L147.0,447.5 L127.8,447.1 L123.5,450.8 L116.3,443.3 L116.7,438.2 L126.8,427.6 L142.5,422.9 Z', cx: 148, cy: 433 }
  };
  var drawOrder = ['경기','강원','경북','전남','경남','전북','충남','충북','인천','서울','세종','대전','광주','대구','울산','부산','제주'];
  // Color scales
  var fillColor = function(count) {
    if (!count || count === 0) return '#f0f4f8';
    if (count >= 5) return '#1e40af';
    if (count >= 3) return '#3b82f6';
    if (count >= 2) return '#93c5fd';
    return '#bfdbfe';
  };
  var strokeColor = function(count) {
    if (!count || count === 0) return '#cbd5e1';
    if (count >= 3) return '#1e3a8a';
    return '#60a5fa';
  };
  var textColor = function(count) {
    if (!count || count === 0) return '#94a3b8';
    if (count >= 3) return '#ffffff';
    return '#1e3a8a';
  };
  // SVG container - viewBox covers full Korea from GeoJSON data
  var svg = '<svg viewBox="95 -20 275 490" xmlns="http://www.w3.org/2000/svg" class="w-full" style="max-height:560px">';
  // Defs: gradients, filters, patterns
  svg += '<defs>' +
    '<filter id="mapShadow" x="-3%" y="-3%" width="106%" height="106%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#1e3a8a" flood-opacity="0.15"/></filter>' +
    '<filter id="mapGlow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="3" result="blur"/><feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>' +
    '<linearGradient id="seaBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e0ecff"/><stop offset="50%" stop-color="#dbeafe"/><stop offset="100%" stop-color="#eff6ff"/></linearGradient>' +
    '<radialGradient id="seaShine" cx="25%" cy="20%" r="60%"><stop offset="0%" stop-color="#f0f7ff" stop-opacity="0.7"/><stop offset="100%" stop-color="transparent"/></radialGradient>' +
    '<pattern id="seaPattern" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.3" fill="#93c5fd" opacity="0.15"/></pattern>' +
    '</defs>';
  // Ocean background
  svg += '<rect x="95" y="-20" width="275" height="490" rx="12" fill="url(#seaBg)"/>';
  svg += '<rect x="95" y="-20" width="275" height="490" rx="12" fill="url(#seaShine)"/>';
  svg += '<rect x="95" y="-20" width="275" height="490" rx="12" fill="url(#seaPattern)"/>';
  // Water decoration - small island dots
  svg += '<circle cx="118" cy="300" r="1.5" fill="#c7d8f0" opacity="0.5"/>';
  svg += '<circle cx="108" cy="310" r="1" fill="#c7d8f0" opacity="0.4"/>';
  svg += '<circle cx="355" cy="210" r="1.2" fill="#c7d8f0" opacity="0.4"/>';
  svg += '<circle cx="350" cy="195" r="0.8" fill="#c7d8f0" opacity="0.3"/>';
  // Jeju separation dashed line
  svg += '<line x1="105" y1="400" x2="185" y2="400" stroke="#93c5fd" stroke-width="0.6" stroke-dasharray="4 3" opacity="0.5"/>';
  // Title
  svg += '<text x="360" y="-5" text-anchor="end" fill="#93c5fd" font-size="9" font-weight="600" letter-spacing="3" opacity="0.6">SOUTH KOREA</text>';
  // Draw each region
  drawOrder.forEach(function(name) {
    var r = regions[name];
    if (!r) return;
    var count = counts[name] || 0;
    var fill = fillColor(count);
    var sc = strokeColor(count);
    var tc = textColor(count);
    var isActive = count > 0;
    var isSmall = ['서울','세종','대전','광주','대구','울산','부산'].indexOf(name) >= 0;
    var ly = r.labelY || r.cy;
    var fs = isSmall ? '7' : '9';
    var fsNum = isSmall ? '8' : '10';
    svg += '<g class="cursor-pointer" onclick="document.getElementById(\'h-region\').value=\'' + name + '\';setHospView(\'card\');filterH()" ' +
      'onmouseenter="this.querySelector(\'path\').style.opacity=\'0.8\';this.querySelector(\'path\').style.transform=\'scale(1.02)\';this.querySelector(\'path\').style.transformOrigin=\'' + r.cx + 'px ' + r.cy + 'px\'" ' +
      'onmouseleave="this.querySelector(\'path\').style.opacity=\'1\';this.querySelector(\'path\').style.transform=\'scale(1)\'">' +
      '<path d="' + r.path + '" fill="' + fill + '" stroke="' + sc + '" stroke-width="' + (isActive ? '1.2' : '0.5') + '" stroke-linejoin="round" ' +
      (isActive ? 'filter="url(#mapShadow)"' : '') + ' style="transition:all 0.25s ease"/>' +
      '<text x="' + r.cx + '" y="' + (count > 0 ? ly - 4 : ly) + '" text-anchor="middle" dominant-baseline="central" fill="' + tc + '" font-size="' + fs + '" font-weight="700" style="pointer-events:none;text-shadow:0 0 3px rgba(255,255,255,0.5)">' + name + '</text>' +
      (count > 0 ? '<text x="' + r.cx + '" y="' + (ly + 7) + '" text-anchor="middle" dominant-baseline="central" fill="' + tc + '" font-size="' + fsNum + '" font-weight="800" style="pointer-events:none">' + count + '</text>' : '') +
      '</g>';
  });
  svg += '</svg>';
  return svg;
}
function filterH() {
  const s = (document.getElementById('h-search')?.value || '').toLowerCase(), r = document.getElementById('h-region')?.value || '', t = document.getElementById('h-type')?.value || '';
  const favOnly = document.getElementById('h-fav-only')?.checked || false;
  var filtered = hospList.filter(h => (!s || h.name.toLowerCase().includes(s)) && (!r || h.region === r) && (!t || h.type === t) && (!favOnly || isFavorited('hospital', h.id)));
  renderH(sortList(filtered, _hospSort.key, _hospSort.dir));
}
function applyHospSort() {
  var v = (document.getElementById('h-sort')?.value || 'name-asc').split('-');
  _hospSort.key = v[0]; _hospSort.dir = v[1] || 'asc';
  filterH();
}

// ===== HOSPITAL DETAIL =====
let detailTab = 'doctors';
async function viewHosp(id) {
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 space-y-5"><div class="card-flat p-5"><div class="skeleton rounded h-6 w-48 mb-3"></div><div class="skeleton rounded h-4 w-72"></div></div><div class="card-flat p-0">' + skeleton(4) + '</div></div>';
  try {
    const [hR, dR, mR] = await Promise.all([API.get('/hospitals/' + id), API.get('/hospitals/' + id + '/doctors'), API.get('/meetings?hospital_id=' + id)]);
    const h = hR.data.data, docs = dR.data.data, meets = mR.data.data;
    document.getElementById('page-title').textContent = h.name;
    document.getElementById('page-subtitle').innerHTML = '<span class="cursor-pointer hover:text-brand-500 transition" onclick="nav(\'hospitals\')"><i class="fas fa-chevron-left mr-1 text-[10px]"></i>기관 목록</span>';
    document.getElementById('header-actions').innerHTML =
      '<button class="btn btn-outline btn-sm" onclick="showTagManager(\'hospital\',' + h.id + ')"><i class="fas fa-tags text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showMeetingStats(\'hospital\',' + h.id + ')"><i class="fas fa-chart-bar text-xs"></i></button>' +
      '<button class="btn btn-primary btn-sm" onclick="showDocForm(' + h.id + ')"><i class="fas fa-user-plus text-xs"></i><span class="hidden sm:inline">인원</span></button>' +
      '<button class="btn btn-success btn-sm" onclick="showMeetForm(' + h.id + ')"><i class="fas fa-calendar-plus text-xs"></i><span class="hidden sm:inline">미팅</span></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showHospForm(' + h.id + ')"><i class="fas fa-pen text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" title="PDF 저장 / 인쇄" onclick="printHospDetail(' + h.id + ')"><i class="fas fa-file-pdf text-xs"></i><span class="hidden sm:inline">PDF</span></button>' +
      '<button class="btn btn-ghost text-red-400 hover:text-red-600 hover:bg-red-50 btn-sm" onclick="delHosp(' + h.id + ')"><i class="fas fa-trash text-xs"></i></button>';
    window._hospDetail = { h, docs, meets }; detailTab = 'doctors';
    renderDetail();
  } catch (e) { toast('기관 정보를 불러올 수 없습니다', 'err') }
}
function renderDetail() {
  const { h, docs, meets } = window._hospDetail;
  // Summary stats
  const recent30 = meets.filter(m => { const diff = Math.floor((Date.now() - new Date(m.meeting_date + 'T00:00:00').getTime()) / 86400000); return diff >= 0 && diff <= 30; }).length;
  const topDoc = docs.reduce((best, d) => (!best || (d.meeting_count || 0) > (best.meeting_count || 0)) ? d : best, null);
  
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in space-y-5">' +
    // Pipeline stage selector
    '<div class="card-flat p-3 flex items-center gap-3 overflow-x-auto">' +
    '<span class="text-[10px] text-slate-400 font-bold flex-shrink-0">파이프라인:</span>' +
    pipelineStageButtons(h) +
    '</div>' +
    // Summary stats — unified layout
    '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">소속 인원</div><div class="text-lg font-extrabold text-brand-600">' + docs.length + '<span class="text-xs text-slate-400 ml-0.5">명</span></div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">총 미팅</div><div class="text-lg font-extrabold text-slate-800">' + meets.length + '<span class="text-xs text-slate-400 ml-0.5">건</span></div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">최근 30일</div><div class="text-lg font-extrabold ' + (recent30 > 0 ? 'text-emerald-600' : 'text-red-400') + '">' + recent30 + '<span class="text-xs text-slate-400 ml-0.5">건</span></div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">최다 미팅</div><div class="text-sm font-bold text-slate-700 truncate">' + (topDoc ? topDoc.name + ' (' + (topDoc.meeting_count || 0) + ')' : '-') + '</div></div>' +
    '</div>' +
    // Business metrics — always shown
    '<div class="grid grid-cols-2 sm:grid-cols-5 gap-3">' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-ear-listen text-slate-300 mr-0.5"></i>난청환자</div><div class="text-lg font-extrabold text-blue-600">' + (h.patient_count || 0) + '</div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-headphones text-slate-300 mr-0.5"></i>보청기</div><div class="text-lg font-extrabold text-teal-600">' + (h.hearing_aid_sales || 0) + '</div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5"><i class="fas fa-microchip text-slate-300 mr-0.5"></i>CI의뢰</div><div class="text-lg font-extrabold text-violet-600">' + (h.ci_referrals || 0) + '</div></div>' +

    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">토닥접점</div><div class="mt-1">' + todocBadge(h.todoc_contact) + '</div></div>' +
    '</div>' +
    // Info card
    '<div class="card-flat p-4 lg:p-6">' +
    '<div class="flex flex-wrap items-center gap-2 mb-4">' + statusDot(h.status) + '<div class="ml-auto flex items-center gap-4 text-xs text-slate-400">' + (h.phone ? '<span><i class="fas fa-phone mr-1"></i>' + h.phone + '</span>' : '') + '</div></div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">' +
    '<div><span class="text-slate-400 text-xs font-medium">지역</span><p class="font-semibold text-slate-700 mt-0.5">' + (h.region || '-') + '</p></div>' +
    '<div><span class="text-slate-400 text-xs font-medium">주소</span><p class="font-semibold text-slate-700 mt-0.5">' + (h.address || '-') + '</p></div>' +
    '</div>' +
    (h.notes ? '<div class="mt-5 bg-amber-50/70 rounded-xl p-4 text-[13px] text-amber-800 leading-relaxed"><i class="fas fa-lightbulb text-amber-400 mr-1.5"></i>' + h.notes + '</div>' : '') +
    '</div>' +
    // Audiology/Mapping Room Info
    '<div class="card-flat p-4 lg:p-6">' +
    '<div class="flex items-center justify-between mb-4"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-cyan-50 flex items-center justify-center"><i class="fas fa-ear-listen text-cyan-600 text-xs"></i></div><span class="font-bold text-sm text-slate-800">청각실 / 매핑실 정보</span></div><button class="text-[11px] text-brand-500 font-bold hover:text-brand-600 transition" onclick="editRoomInfo(' + h.id + ')"><i class="fas fa-pen text-[9px] mr-0.5"></i>편집</button></div>' +
    (function() {
      var aud = h.audiology_room ? (typeof h.audiology_room === 'string' ? (function(){ try { return JSON.parse(h.audiology_room) } catch(e) { return null } })() : h.audiology_room) : null;
      var mp = h.mapping_room ? (typeof h.mapping_room === 'string' ? (function(){ try { return JSON.parse(h.mapping_room) } catch(e) { return null } })() : h.mapping_room) : null;
      if (!aud && !mp) return '<div class="text-sm text-slate-400 text-center py-4"><i class="fas fa-info-circle text-slate-300 mr-1"></i>등록된 정보가 없습니다. 편집 버튼을 눌러 추가하세요.</div>';
      var html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">';
      // Audiology room
      html += '<div class="rounded-xl border border-cyan-100 p-4 ' + (aud && aud.exists ? 'bg-cyan-50/40' : 'bg-slate-50') + '">';
      html += '<div class="flex items-center gap-2 mb-3"><i class="fas fa-headphones text-cyan-500"></i><span class="font-bold text-[13px] text-slate-700">청각실 (청력검사실)</span>';
      html += aud && aud.exists ? '<span class="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">있음</span>' : '<span class="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-bold">없음</span>';
      html += '</div>';
      if (aud && aud.exists) {
        html += '<div class="space-y-2 text-[12px]">';
        if (aud.location) html += '<div class="flex items-center gap-2"><i class="fas fa-map-pin text-slate-300 w-4 text-center"></i><span class="text-slate-600"><strong>위치:</strong> ' + aud.location + '</span></div>';
        if (aud.staff_count) html += '<div class="flex items-center gap-2"><i class="fas fa-users text-slate-300 w-4 text-center"></i><span class="text-slate-600"><strong>인원:</strong> ' + aud.staff_count + '명</span></div>';
        if (aud.meeting_type) html += '<div class="flex items-center gap-2"><i class="fas fa-handshake text-slate-300 w-4 text-center"></i><span class="text-slate-600"><strong>미팅:</strong> ' + aud.meeting_type + '</span></div>';
        if (aud.notes) html += '<div class="flex items-start gap-2"><i class="fas fa-sticky-note text-slate-300 w-4 text-center mt-0.5"></i><span class="text-slate-500">' + aud.notes + '</span></div>';
        html += '</div>';
      }
      html += '</div>';
      // Mapping room
      html += '<div class="rounded-xl border border-violet-100 p-4 ' + (mp && mp.exists ? 'bg-violet-50/40' : 'bg-slate-50') + '">';
      html += '<div class="flex items-center gap-2 mb-3"><i class="fas fa-microchip text-violet-500"></i><span class="font-bold text-[13px] text-slate-700">매핑실</span>';
      html += mp && mp.exists ? '<span class="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold">있음</span>' : '<span class="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-bold">없음</span>';
      html += '</div>';
      if (mp && mp.exists) {
        html += '<div class="space-y-2 text-[12px]">';
        if (mp.location) html += '<div class="flex items-center gap-2"><i class="fas fa-map-pin text-slate-300 w-4 text-center"></i><span class="text-slate-600"><strong>위치:</strong> ' + mp.location + '</span></div>';
        if (mp.staff_count) html += '<div class="flex items-center gap-2"><i class="fas fa-users text-slate-300 w-4 text-center"></i><span class="text-slate-600"><strong>인원:</strong> ' + mp.staff_count + '명</span></div>';
        if (mp.meeting_type) html += '<div class="flex items-center gap-2"><i class="fas fa-handshake text-slate-300 w-4 text-center"></i><span class="text-slate-600"><strong>미팅:</strong> ' + mp.meeting_type + '</span></div>';
        if (mp.notes) html += '<div class="flex items-start gap-2"><i class="fas fa-sticky-note text-slate-300 w-4 text-center mt-0.5"></i><span class="text-slate-500">' + mp.notes + '</span></div>';
        html += '</div>';
      }
      html += '</div></div>';
      return html;
    })() +
    '</div>' +
    // Score trend chart
    '<div id="hosp-score-card" class="card-flat p-5">' +
      '<div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2.5"><div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background:linear-gradient(135deg,#fef3c7,#fde68a)"><i class="fas fa-chart-line text-amber-600 text-xs"></i></div><span class="font-bold text-[14px] text-slate-800 tracking-tight">기관 점수 추이</span><span class="text-[10px] text-slate-400">미팅 · 파이프라인 가중 합산</span></div>' +
        '<select id="hosp-score-months" class="input !py-1 !text-[11px] !w-auto !pr-7" style="border-radius:8px" onchange="loadHospScore(' + h.id + ', Number(this.value))">' +
          '<option value="6">최근 6개월</option><option value="12" selected>최근 12개월</option><option value="24">최근 24개월</option>' +
        '</select>' +
      '</div>' +
      '<div style="height:200px"><canvas id="hosp-score-chart"></canvas></div>' +
      '<div id="hosp-score-meta" class="mt-3 text-[11px] text-slate-400"></div>' +
    '</div>' +
    '<div class="flex border-b border-gray-100 px-1 overflow-x-auto">' +
    '<div class="tab ' + (detailTab === 'doctors' ? 'active' : '') + '" onclick="detailTab=\'doctors\';renderDetail()"><i class="fas fa-user-doctor text-xs"></i>인원 (' + docs.length + ')</div>' +
    '<div class="tab ' + (detailTab === 'meetings' ? 'active' : '') + '" onclick="detailTab=\'meetings\';renderDetail()"><i class="fas fa-calendar-check text-xs"></i>미팅 (' + meets.length + ')</div>' +
    '<div class="tab ' + (detailTab === 'timeline' ? 'active' : '') + '" onclick="detailTab=\'timeline\';renderDetail()"><i class="fas fa-stream text-xs"></i>타임라인</div>' +
    '</div>' +
    (detailTab === 'doctors' ? renderDoctorsTab(h, docs)
      : detailTab === 'timeline' ? renderTimelineTab(h)
      : renderMeetingsTab(h, meets)) +
    '</div>';
  // Async load score chart
  loadHospScore(h.id, 12);
  // Async load timeline if active
  if (detailTab === 'timeline') loadHospTimeline(h.id);
}

// ===== Print / PDF: Hospital detail =====
function printHospDetail(hospitalId) {
  try {
    var hd = window._hospDetail;
    if (!hd || !hd.h || hd.h.id !== hospitalId) {
      toast('상세 정보를 먼저 불러와야 합니다', 'err');
      return;
    }
    var h = hd.h, docs = hd.docs || [], meets = hd.meets || [];
    var content = document.getElementById('content');
    if (!content) return;

    // Build print container
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    var userName = (window._me && window._me.name) ? window._me.name : '';

    // Header
    var header = '<div class="print-header">' +
      '<div class="print-title">' + (h.name || '기관 상세') + '</div>' +
      '<div class="print-meta">' +
        '지역: ' + (h.region || '-') + ' · 주소: ' + (h.address || '-') + ' · ' +
        '소속 인원 ' + docs.length + '명 · 총 미팅 ' + meets.length + '건' +
        ' · 출력일 ' + dateStr + (userName ? ' · ' + userName : '') +
      '</div>' +
    '</div>';

    // Doctors section
    var docsRows = docs.map(function(d){
      return '<tr>' +
        '<td>' + (d.name || '') + '</td>' +
        '<td>' + (d.position || '-') + '</td>' +
        '<td>' + (d.department || '-') + '</td>' +
        '<td>' + (d.specialty || '-') + '</td>' +
        '<td style="text-align:right">' + (d.meeting_count || 0) + '</td>' +
        '<td>' + (d.last_meeting_date || '-') + '</td>' +
      '</tr>';
    }).join('');
    var docsTable = '<h2 style="margin:6mm 0 2mm 0;font-size:13pt;">소속 인원 (' + docs.length + ')</h2>' +
      (docs.length === 0 ? '<div style="color:#6b7280">등록된 인원이 없습니다.</div>' :
        '<table><thead><tr><th>이름</th><th>직책</th><th>진료과</th><th>전문분야</th><th>미팅수</th><th>최근미팅</th></tr></thead><tbody>' + docsRows + '</tbody></table>');

    // Meetings section
    var meetsSorted = meets.slice().sort(function(a,b){ return (b.meeting_date || '').localeCompare(a.meeting_date || ''); });
    var typeLabel = function(t){ return ({visit:'방문', phone:'전화', conference:'학회', email:'이메일', online:'온라인'})[t] || t || '-'; };
    var vtLabel = function(v){ return ({am:'오전', pm:'오후', full:'종일'})[v] || '미지정'; };
    var meetsRows = meetsSorted.map(function(m){
      var range = (m.start_time && m.end_time) ? (m.start_time + '~' + m.end_time) : vtLabel(m.visit_time);
      return '<tr>' +
        '<td>' + (m.meeting_date || '') + '</td>' +
        '<td>' + range + '</td>' +
        '<td>' + typeLabel(m.type) + '</td>' +
        '<td>' + (m.doctor_name || '-') + '</td>' +
        '<td>' + (m.purpose || '-') + '</td>' +
        '<td>' + ((m.result || '') + (m.next_action ? ' / 후속: ' + m.next_action : '')) + '</td>' +
      '</tr>';
    }).join('');
    var meetsTable = '<h2 style="margin:8mm 0 2mm 0;font-size:13pt;" class="print-page-break">미팅 이력 (' + meets.length + ')</h2>' +
      (meets.length === 0 ? '<div style="color:#6b7280">등록된 미팅이 없습니다.</div>' :
        '<table><thead><tr><th>날짜</th><th>시간</th><th>유형</th><th>담당자</th><th>목적</th><th>결과/후속</th></tr></thead><tbody>' + meetsRows + '</tbody></table>');

    // Footer
    var footer = '<div class="print-footer">TODOC CRM · ' + (h.name || '') + ' · ' + dateStr + '</div>';

    // Build temporary print container
    var wrap = document.createElement('div');
    wrap.className = 'print-target';
    wrap.id = 'print-target-temp';
    wrap.innerHTML = header + docsTable + meetsTable + footer;

    // Mark existing content as not-print-target and append temp wrap
    document.body.classList.add('print-mode');
    var origClasses = content.className;
    content.classList.add('not-print-target');
    document.body.appendChild(wrap);

    // Trigger print, then cleanup
    var cleanup = function(){
      document.body.classList.remove('print-mode');
      content.className = origClasses;
      var t = document.getElementById('print-target-temp');
      if (t && t.parentNode) t.parentNode.removeChild(t);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(function(){ window.print(); }, 50);
    // Safety cleanup in case afterprint isn't fired (some browsers)
    setTimeout(function(){ if (document.getElementById('print-target-temp')) cleanup(); }, 10000);
  } catch (e) {
    toast('PDF 저장 준비 중 오류가 발생했습니다', 'err');
  }
}

async function loadHospScore(hospitalId, months) {
  var canvas = document.getElementById('hosp-score-chart');
  if (!canvas) return;
  // Destroy any existing chart on this canvas
  try { if (window._hospScoreChart) window._hospScoreChart.destroy(); } catch(e) {}
  try {
    var r = await API.get('/hospitals/' + hospitalId + '/score-history?months=' + (months || 12));
    var d = r.data.data;
    var labels = d.series.map(function(s) { return fmtMonthLabel(s.month); });
    var scores = d.series.map(function(s) { return s.score; });
    var meets = d.series.map(function(s) { return s.meeting_count; });
    var pipes = d.series.map(function(s) { return s.pipeline_stage; });

    Chart.defaults.font.family = 'Pretendard,sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.color = '#9aa1b4';
    window._hospScoreChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            type: 'line',
            label: '점수',
            data: scores,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,.15)',
            tension: 0.35,
            fill: true,
            yAxisID: 'y',
            pointRadius: 4,
            pointBackgroundColor: '#f59e0b',
          },
          {
            type: 'bar',
            label: '월 미팅 수',
            data: meets,
            backgroundColor: 'rgba(59,130,246,.4)',
            borderRadius: 6,
            yAxisID: 'y1',
            barPercentage: 0.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 10, weight: '600' }, usePointStyle: true } },
          tooltip: {
            callbacks: {
              afterBody: function(items) {
                if (!items || !items.length) return '';
                var idx = items[0].dataIndex;
                return ['단계: ' + (pipes[idx] || '-')];
              }
            }
          }
        },
        scales: {
          y: { position: 'left', beginAtZero: true, grid: { color: '#eef0f5', drawBorder: false }, ticks: { font: { size: 10 } }, border: { display: false }, title: { display: true, text: '점수', font: { size: 10 }, color: '#9aa1b4' } },
          y1: { position: 'right', beginAtZero: true, grid: { display: false }, ticks: { font: { size: 10 }, stepSize: 1 }, border: { display: false }, title: { display: true, text: '미팅', font: { size: 10 }, color: '#9aa1b4' } },
          x: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' } }, border: { display: false } }
        }
      }
    });

    // Meta summary
    var meta = document.getElementById('hosp-score-meta');
    if (meta) {
      var firstScore = scores.length ? scores[0] : 0;
      var lastScore = scores.length ? scores[scores.length - 1] : 0;
      var diff = lastScore - firstScore;
      var diffText = diff > 0 ? '<span class="text-emerald-500 font-bold">+' + diff + '</span>' : (diff < 0 ? '<span class="text-red-500 font-bold">' + diff + '</span>' : '<span class="text-slate-400">변동없음</span>');
      var totalMeets = meets.reduce(function(a,b){ return a+b; }, 0);
      var pChanges = (d.pipeline_changes || []).filter(function(p){ return p.from_stage; }).length;
      meta.innerHTML = '<i class="fas fa-info-circle mr-1"></i>현재 점수 <strong class="text-amber-600">' + lastScore + '</strong> · 시작 대비 ' + diffText + ' · 누적 미팅 <strong class="text-blue-600">' + totalMeets + '</strong>건 · 단계 이동 ' + pChanges + '회';
    }
  } catch (e) {
    var meta = document.getElementById('hosp-score-meta');
    if (meta) meta.innerHTML = '<span class="text-red-400">점수 추이를 불러올 수 없습니다</span>';
  }
}
function renderDoctorsTab(h, docs) {
  if (!docs.length) return '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-user-plus"></i></div><p class="font-medium text-slate-500 mb-1">소속 의료진이 없습니다</p><p class="text-xs text-slate-400 mb-4">의료진을 수동으로 추가해주세요</p><button class="btn btn-primary btn-sm" onclick="showDocForm(' + h.id + ')"><i class="fas fa-plus mr-1.5 text-xs"></i>의료진 추가</button></div></div>';
  return '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' + docs.map(d =>
    '<div class="card-flat p-4 lg:p-5 flex gap-3 lg:gap-4 cursor-pointer" onclick="viewDocProfile(' + d.id + ')">' +
    '<div class="photo-up" onclick="event.stopPropagation();triggerPhoto(' + d.id + ',' + h.id + ')">' +
    avatar(d.photo, d.name, 'width:52px;height:52px;border-radius:14px;font-size:18px') +
    '<div class="photo-ov" style="border-radius:14px"><i class="fas fa-camera"></i></div></div>' +
    '<input type="file" id="pi-' + d.id + '" accept="image/*" style="display:none" onchange="uploadPhoto(' + d.id + ',' + h.id + ',this)">' +
    '<div class="flex-1 min-w-0">' +
    '<div class="flex items-center gap-2 mb-1"><span class="font-bold text-[14px] text-slate-800">' + d.name + '</span><span class="text-xs text-slate-400">' + (d.position || '') + '</span></div>' +
    '<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mb-2">' + (d.department ? '<span><i class="fas fa-stethoscope mr-1 text-slate-300"></i>' + d.department + '</span>' : '') + (d.specialty ? '<span class="hidden sm:inline"><i class="fas fa-microscope mr-1 text-slate-300"></i>' + d.specialty + '</span>' : '') + '</div>' +
    '<div class="flex items-center gap-3 text-[11px]"><span class="text-slate-400"><i class="fas fa-handshake mr-1"></i>' + (d.meeting_count || 0) + '회</span>' + (d.last_meeting ? '<span class="' + daysClass(d.last_meeting) + '"><i class="fas fa-clock mr-1"></i>' + daysAgo(d.last_meeting) + '</span>' : '') + (d.clinic_hours ? '<span class="text-cyan-500"><i class="fas fa-calendar-days mr-1"></i>외래</span>' : '') + '</div></div>' +
    '<div class="flex flex-col gap-1 flex-shrink-0">' +
    '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();showMeetForm(' + h.id + ',' + d.id + ')" title="미팅 추가"><i class="fas fa-calendar-plus text-emerald-500"></i></button>' +
    '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();showDocForm(' + h.id + ',' + d.id + ')" title="수정"><i class="fas fa-pen text-slate-400"></i></button>' +
    '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();delDoc(' + d.id + ',' + h.id + ')" title="삭제"><i class="fas fa-trash text-red-300"></i></button>' +
    '</div></div>'
  ).join('') + '</div>';
}
function meetDoctorNames(m) {
  if (m.doctors && m.doctors.length) return m.doctors.map(function(d) { return d.doctor_name || d.name }).join(', ');
  return m.doctor_name || '-';
}
function meetDoctorAvatars(m, size) {
  var sz = size || 'width:28px;height:28px;border-radius:8px;font-size:11px';
  if (m.doctors && m.doctors.length > 1) {
    return '<div class="flex -space-x-2">' + m.doctors.slice(0, 3).map(function(d) {
      return avatar(d.doctor_photo || d.photo, d.doctor_name || d.name, sz)
    }).join('') + (m.doctors.length > 3 ? '<div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 border-2 border-white">+' + (m.doctors.length - 3) + '</div>' : '') + '</div>';
  }
  return avatar(m.doctor_photo, m.doctor_name, sz);
}
function meetDoctorBadges(m) {
  if (m.doctors && m.doctors.length > 1) {
    return '<div class="flex flex-wrap gap-1 mt-1">' + m.doctors.map(function(d) {
      return '<span class="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md font-medium">' + (d.doctor_name || d.name) + '</span>';
    }).join('') + '</div>';
  }
  return '';
}
function renderMeetingsTab(h, meets) {
  if (!meets.length) return '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-calendar-plus"></i></div><p class="font-medium text-slate-500 mb-1">미팅이 없습니다</p></div></div>';
  // Collect all doctors' clinic hours for this hospital
  var docs = window._hospDetail?.docs || [];
  var docsWithHours = docs.filter(function(d) { return d.clinic_hours; });
  // Clinic hours reference panel
  var clinicHoursPanel = '';
  if (docsWithHours.length > 0) {
    clinicHoursPanel = '<div class="card-flat p-4 lg:p-5 mb-4 border-l-4 border-cyan-400">' +
      '<div class="flex items-center gap-2 mb-3"><div class="w-7 h-7 rounded-lg bg-cyan-50 flex items-center justify-center"><i class="fas fa-calendar-days text-cyan-500 text-xs"></i></div>' +
      '<span class="font-bold text-sm text-slate-800">의료진 외래 스케줄</span>' +
      '<span class="text-[10px] text-slate-400 ml-1">— 방문 시간 참고</span></div>' +
      '<div class="space-y-3">' + docsWithHours.map(function(d) {
        var ch = parseClinicHours(d.clinic_hours);
        var isOld = ch.mon && !ch.mon_am && typeof ch.mon === 'string';
        if (isOld) { var m2 = {}; DAYS_KEY.forEach(function(k){ if(ch[k]) m2[k+'_am']=ch[k]; }); m2.notes=ch.notes||''; ch=m2; }
        var slotBg = function(v) {
          if (!v) return '';
          if (v === '진료') return 'bg-cyan-500 text-white';
          if (v === '수술') return 'bg-rose-500 text-white';
          if (v === '휴진') return 'bg-gray-200 text-gray-400 line-through';
          if (v === '순환진료') return 'bg-amber-400 text-white';
          return 'bg-blue-400 text-white';
        };
        // 빈 값은 휴진으로 정규화
        var normSlot = function(v) { return (v == null || String(v).trim() === '') ? '휴진' : String(v); };
        return '<div class="bg-gray-50 rounded-xl p-3">' +
          '<div class="flex items-center gap-2 mb-2"><span class="text-[12px] font-bold text-slate-700">' + d.name + '</span>' +
          '<span class="text-[10px] text-slate-400">' + (d.position || '') + '</span>' +
          (d.specialty ? '<span class="text-[9px] text-cyan-500">' + d.specialty.split(',')[0] + '</span>' : '') + '</div>' +
          '<div class="grid grid-cols-7 gap-1">' +
          '<div></div>' + DAYS_KR.map(function(dk, i) { return '<div class="text-[9px] font-bold text-center ' + (i===5?'text-blue-500':'text-slate-500') + '">' + dk + '</div>'; }).join('') +
          '<div class="text-[8px] text-amber-500 font-bold text-center flex items-center justify-center">AM</div>' +
          DAYS_KEY.map(function(k) { var v = normSlot(ch[k+'_am']); return '<div class="text-center"><div class="rounded text-[9px] font-bold py-0.5 px-0.5 ' + slotBg(v) + '">' + v + '</div></div>'; }).join('') +
          '<div class="text-[8px] text-indigo-500 font-bold text-center flex items-center justify-center">PM</div>' +
          DAYS_KEY.map(function(k) { var v = normSlot(ch[k+'_pm']); return '<div class="text-center"><div class="rounded text-[9px] font-bold py-0.5 px-0.5 ' + slotBg(v) + '">' + v + '</div></div>'; }).join('') +
          '</div>' +
          (ch.notes ? '<div class="text-[10px] text-amber-600 mt-1.5"><i class="fas fa-exclamation-circle mr-0.5"></i>' + ch.notes + '</div>' : '') +
          '</div>';
      }).join('') + '</div></div>';
  }
  // Meeting timeline
  return clinicHoursPanel + '<div class="card-flat p-4 lg:p-6">' + meets.map(function(m, i) {
    // Get clinic hours for meeting's doctors
    var meetDocs = (m.doctors || []).map(function(md) { return docs.find(function(d) { return d.id === (md.doctor_id || md.id); }); }).filter(Boolean);
    var meetDay = m.meeting_date ? new Date(m.meeting_date + 'T00:00:00') : null;
    var dayIdx = meetDay ? (meetDay.getDay() + 6) % 7 : -1; // 0=Mon...5=Sat
    var dayKey = dayIdx >= 0 && dayIdx < 6 ? DAYS_KEY[dayIdx] : '';
    // Build per-doctor schedule hint for this meeting day
    var schedHints = [];
    if (dayKey) {
      meetDocs.forEach(function(doc) {
        if (!doc.clinic_hours) return;
        var ch = parseClinicHours(doc.clinic_hours);
        if (ch.mon && !ch.mon_am && typeof ch.mon === 'string') { var m2={}; DAYS_KEY.forEach(function(k){if(ch[k])m2[k+'_am']=ch[k];}); m2.notes=ch.notes||''; ch=m2; }
        var am = ch[dayKey + '_am'] || '', pm = ch[dayKey + '_pm'] || '';
        if (am || pm) {
          var hint = doc.name + ': ';
          if (am && am !== '휴진') hint += '오전(' + am + ')';
          if (am && am !== '휴진' && pm && pm !== '휴진') hint += ' / ';
          if (pm && pm !== '휴진') hint += '오후(' + pm + ')';
          if (am === '휴진' && pm === '휴진') hint += '휴진';
          else if (am === '휴진') hint += '오후만';
          else if (pm === '휴진') hint += '오전만';
          schedHints.push({ name: doc.name, hint: hint, isOff: am === '휴진' && pm === '휴진' });
        }
      });
    }
    var schedHtml = schedHints.length ? '<div class="flex flex-wrap gap-1.5 mt-1.5">' + schedHints.map(function(sh) {
      return '<span class="text-[10px] px-2 py-0.5 rounded-full font-medium ' + (sh.isOff ? 'bg-red-50 text-red-400 border border-red-100' : 'bg-cyan-50 text-cyan-600 border border-cyan-100') + '">' +
        (sh.isOff ? '<i class="fas fa-ban mr-0.5"></i>' : '<i class="fas fa-clock mr-0.5"></i>') + sh.hint + '</span>';
    }).join('') + '</div>' : '';

    return '<div class="flex gap-3 lg:gap-4 ' + (i < meets.length - 1 ? 'mb-6' : '') + '">' +
      '<div class="flex flex-col items-center pt-1"><div class="tl-dot"></div>' + (i < meets.length - 1 ? '<div class="tl-line flex-1 mt-1"></div>' : '') + '</div>' +
      '<div class="flex-1">' +
      '<div class="flex items-center justify-between mb-2 flex-wrap gap-2">' +
      '<div class="flex items-center gap-2 flex-wrap">' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + '<span class="font-semibold text-[13px] text-slate-800">' + meetDoctorNames(m) + '</span>' + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div>' +
      '<div class="flex items-center gap-2"><span class="text-xs text-slate-400">' + fmtDate(m.meeting_date) + ' <span class="text-[10px] text-slate-300">(' + DAYS_KR[dayIdx >= 0 && dayIdx < 6 ? dayIdx : 0] + ')</span></span><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="showMeetForm(' + h.id + ',null,' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="delMeet(' + m.id + ',' + h.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div></div>' +
      schedHtml +
      (m.purpose ? '<div class="text-[13px] font-medium text-slate-700 mb-1.5 mt-1">' + m.purpose + '</div>' : '') +
      (m.content ? '<div class="text-xs text-slate-500 leading-relaxed mb-2 bg-slate-50 rounded-lg p-3">' + m.content + '</div>' : '') +
      '<div class="flex flex-wrap gap-2">' +
      (m.result ? '<div class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-check-circle mr-1.5"></i><strong>결과:</strong> ' + m.result + '</div>' : '') +
      (m.next_action ? '<div class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-arrow-right mr-1.5"></i><strong>후속:</strong> ' + m.next_action + (m.next_meeting_date ? ' <span class="font-bold' + (daysUntil(m.next_meeting_date) < 0 ? ' text-red-500 line-through' : '') + '">(' + fmtShort(m.next_meeting_date) + ')</span>' : '') + '</div>' : '') +
      '</div></div></div>';
  }).join('') + '</div>';
}

// ===== Hospital Integrated Timeline Tab =====
window._hospTlFilter = window._hospTlFilter || 'all'; // all|meeting|pipeline|doctor_activity|hospital_activity|comment
function setHospTlFilter(f) {
  window._hospTlFilter = f;
  var hid = window._hospDetail && window._hospDetail.h && window._hospDetail.h.id;
  if (hid) loadHospTimeline(hid);
}
function renderTimelineTab(h) {
  return '<div class="card-flat p-4 lg:p-6">' +
    '<div class="flex items-center gap-2 mb-3 flex-wrap">' +
      '<div class="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><i class="fas fa-stream text-violet-500 text-xs"></i></div>' +
      '<span class="font-bold text-sm text-slate-800">통합 타임라인</span>' +
      '<span class="text-[11px] text-slate-400">미팅 · 파이프라인 · 의료진 · 댓글 변경 이력</span>' +
    '</div>' +
    '<div id="hosp-tl-filters" class="flex items-center gap-1 mb-4 overflow-x-auto pb-1"></div>' +
    '<div id="hosp-tl-body"><div class="text-center py-10 text-slate-300"><i class="fas fa-spinner fa-spin text-xl"></i></div></div>' +
  '</div>';
}
async function loadHospTimeline(hospitalId) {
  var bodyEl = document.getElementById('hosp-tl-body');
  var filtersEl = document.getElementById('hosp-tl-filters');
  if (!bodyEl) return;
  try {
    var r = await API.get('/hospitals/' + hospitalId + '/timeline?limit=200');
    var data = r.data.data;
    var events = data.events || [];
    var counts = data.counts || {};
    var f = window._hospTlFilter || 'all';

    // Filter buttons
    var fb = function(key, label, icon, color, count) {
      var active = f === key;
      var cls = active
        ? 'bg-' + color + '-500 text-white shadow'
        : 'bg-' + color + '-50 text-' + color + '-700 hover:bg-' + color + '-100';
      return '<button class="text-[11px] font-bold px-2.5 py-1 rounded-full transition flex-shrink-0 flex items-center gap-1 ' + cls + '" onclick="setHospTlFilter(\'' + key + '\')"><i class="fas ' + icon + ' text-[9px]"></i>' + label + ' (' + (count || 0) + ')</button>';
    };
    var allActive = f === 'all';
    filtersEl.innerHTML =
      '<button class="text-[11px] font-bold px-2.5 py-1 rounded-full transition flex-shrink-0 ' + (allActive ? 'bg-slate-700 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '" onclick="setHospTlFilter(\'all\')"><i class="fas fa-list text-[9px] mr-1"></i>전체 (' + (counts.total || 0) + ')</button>' +
      fb('meeting', '미팅', 'fa-calendar-check', 'blue', counts.meeting) +
      fb('pipeline', '파이프라인', 'fa-arrows-turn-right', 'violet', counts.pipeline) +
      fb('doctor_activity', '의료진', 'fa-user-doctor', 'emerald', counts.doctor) +
      fb('hospital_activity', '기관', 'fa-hospital', 'sky', counts.hospital) +
      fb('comment', '댓글', 'fa-comment', 'rose', counts.comment);

    // Apply filter
    var filtered = (f === 'all') ? events : events.filter(function(e) { return e.type === f; });
    if (!filtered.length) {
      bodyEl.innerHTML = '<div class="text-center py-10 text-slate-300"><i class="fas fa-inbox text-2xl mb-2 block"></i><div class="text-sm">표시할 이력이 없습니다</div></div>';
      return;
    }

    // Group by year-month for nicer reading
    var grouped = {};
    filtered.forEach(function(ev) {
      var ts = (ev.sortTs || ev.ts || '').substring(0, 10);
      var ym = ts.substring(0, 7) || '미상';
      if (!grouped[ym]) grouped[ym] = [];
      grouped[ym].push(ev);
    });
    var ymKeys = Object.keys(grouped).sort(function(a, b) { return b.localeCompare(a); });

    var typeMeta = {
      meeting: { icon: 'fa-calendar-check', color: 'blue', label: '미팅' },
      pipeline: { icon: 'fa-arrows-turn-right', color: 'violet', label: '파이프라인' },
      doctor_activity: { icon: 'fa-user-doctor', color: 'emerald', label: '의료진' },
      hospital_activity: { icon: 'fa-hospital', color: 'sky', label: '기관' },
      comment: { icon: 'fa-comment', color: 'rose', label: '댓글' },
    };
    var meetTypeIcon = { visit:'fa-hospital', phone:'fa-phone', conference:'fa-chalkboard-user', email:'fa-envelope', online:'fa-video' };
    var meetTypeLabel = { visit:'방문', phone:'전화', conference:'학회', email:'이메일', online:'온라인' };

    var html = '<div class="relative pl-6">' +
      '<div class="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200" aria-hidden="true"></div>';
    ymKeys.forEach(function(ym) {
      html += '<div class="relative mb-1 mt-3 first:mt-0">' +
        '<div class="text-[11px] font-extrabold text-slate-500 sticky top-0 bg-white py-1 pl-1">' + ym + '</div>' +
      '</div>';
      grouped[ym].forEach(function(ev) {
        var meta = typeMeta[ev.type] || { icon: 'fa-circle', color: 'slate', label: ev.type };
        var dotBg = 'bg-' + meta.color + '-500';
        var pillBg = 'bg-' + meta.color + '-50 text-' + meta.color + '-700';
        var dateLabel = (ev.sortTs || ev.ts || '').substring(0, 16).replace('T', ' ');
        var actorBadge = '';
        if (ev.meta && ev.meta.user_name) actorBadge = '<span class="text-[10px] text-slate-400"><i class="fas fa-user-tie mr-0.5"></i>' + ev.meta.user_name + '</span>';
        else if (ev.meta && ev.meta.changed_by) actorBadge = '<span class="text-[10px] text-slate-400"><i class="fas fa-user-pen mr-0.5"></i>' + ev.meta.changed_by + '</span>';

        var extra = '';
        if (ev.type === 'meeting') {
          var mt = ev.meta && ev.meta.meeting_type;
          var mtIcon = meetTypeIcon[mt] || 'fa-calendar';
          var mtLabel = meetTypeLabel[mt] || mt || '';
          var timeStr = '';
          if (ev.meta && ev.meta.start_time) {
            timeStr = ev.meta.start_time + (ev.meta.end_time ? '~' + ev.meta.end_time : '');
          }
          extra = '<div class="flex items-center gap-1.5 mb-1 flex-wrap">' +
            '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600"><i class="fas ' + mtIcon + ' mr-0.5 text-[8px]"></i>' + mtLabel + '</span>' +
            (timeStr ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-50 text-slate-600"><i class="fas fa-clock mr-0.5 text-[8px]"></i>' + timeStr + '</span>' : '') +
            (ev.meta && ev.meta.next_action ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-600"><i class="fas fa-arrow-right mr-0.5 text-[8px]"></i>후속</span>' : '') +
          '</div>';
        }
        var clickAttr = '';
        if (ev.type === 'meeting' && ev.meta && ev.meta.meeting_id) {
          clickAttr = ' onclick="var m=(window._hospDetail&&window._hospDetail.meets||[]).find(function(x){return x.id===' + ev.meta.meeting_id + '});if(m)showMeetDetail(m)" style="cursor:pointer"';
        } else if (ev.type === 'comment' && ev.meta && ev.meta.meeting_id) {
          clickAttr = ' onclick="var m=(window._hospDetail&&window._hospDetail.meets||[]).find(function(x){return x.id===' + ev.meta.meeting_id + '});if(m)showMeetDetail(m)" style="cursor:pointer"';
        } else if (ev.type === 'doctor_activity' && ev.meta && ev.meta.doctor_id && ev.meta.action !== 'delete') {
          clickAttr = ' onclick="viewDocProfile(' + ev.meta.doctor_id + ')" style="cursor:pointer"';
        }

        html += '<div class="relative mb-3"' + clickAttr + '>' +
          '<div class="absolute -left-[18px] top-2 w-3 h-3 rounded-full ' + dotBg + ' ring-2 ring-white shadow"></div>' +
          '<div class="card-flat p-3 hover:shadow-sm transition border border-slate-100">' +
            '<div class="flex items-center gap-2 mb-1 flex-wrap">' +
              '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded ' + pillBg + '"><i class="fas ' + meta.icon + ' mr-0.5 text-[8px]"></i>' + meta.label + '</span>' +
              '<span class="text-[10px] text-slate-400">' + dateLabel + '</span>' +
              (actorBadge ? '<span class="ml-auto">' + actorBadge + '</span>' : '') +
            '</div>' +
            extra +
            '<div class="text-[13px] font-semibold text-slate-700 mb-0.5">' + (ev.title || '') + '</div>' +
            (ev.body ? '<div class="text-xs text-slate-500 leading-relaxed line-clamp-2">' + ev.body + '</div>' : '') +
          '</div>' +
        '</div>';
      });
    });
    html += '</div>';
    bodyEl.innerHTML = html;
  } catch (e) {
    bodyEl.innerHTML = '<div class="text-center py-10 text-red-400"><i class="fas fa-exclamation-triangle mr-1"></i>타임라인을 불러올 수 없습니다</div>';
  }
}

// ===== DOCTORS PAGE =====
async function loadDoc() {
  document.getElementById('page-title').textContent = '의료진 관리';
  document.getElementById('header-actions').innerHTML = exportMenu('doctors','의료진');
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="card-flat overflow-hidden">' + skeleton(6) + '</div></div>';
  try {
    const [dr, deptR] = await Promise.all([API.get('/doctors'), API.get('/doctors/departments')]);
    docList = dr.data.data;
    const depts = deptR.data.data || [];
    var docViewMode = localStorage.getItem('docViewMode') || 'table';
    window._docViewMode = docViewMode;
    var viewToggle = '<div class="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">' +
      '<button class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ' + (docViewMode === 'table' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') + '" onclick="setDocViewMode(\'table\')"><i class="fas fa-list mr-1"></i>목록</button>' +
      '<button class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ' + (docViewMode === 'grid' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') + '" onclick="setDocViewMode(\'grid\')"><i class="fas fa-table-cells mr-1"></i>주간 그리드</button>' +
    '</div>';
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' + viewToggle +
      '<div class="relative flex-1 filter-search"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="d-search" oninput="filterD()" placeholder="의료진명/병원명" class="input pl-10"></div>' +

      '<select id="d-dept" onchange="filterD()" class="input filter-select"><option value="">전체 진료과</option>' + depts.map(dp => '<option>' + dp + '</option>').join('') + '</select>' +
      '<select id="d-visit" onchange="filterD()" class="input filter-select"><option value="">전체 방문</option><option value="30">30일+ 미방문</option><option value="60">60일+ 미방문</option><option value="90">90일+ 미방문</option></select>' +
      '<label class="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0"><input type="checkbox" id="d-fav-only" onchange="filterD()" class="w-3.5 h-3.5 rounded border-gray-300 text-amber-500"><span class="text-[11px] text-slate-500"><i class="fas fa-star text-amber-400"></i></span></label>' +
      '<span id="d-count" class="text-xs text-slate-300 font-medium"></span></div>' +
      '<div id="d-table-view" class="card-flat overflow-hidden ' + (docViewMode === 'grid' ? 'hidden' : '') + '"><div class="table-wrap"><table class="w-full"><thead id="d-thead"></thead>' +
      '<tbody id="d-tbody" class="divide-y divide-gray-50"></tbody></table></div></div>' +
      '<div id="d-grid-view" class="' + (docViewMode === 'table' ? 'hidden' : '') + '"></div>' +
      '</div>';
    renderDR(docList);
  } catch (e) { toast('의료진 목록을 불러올 수 없습니다', 'err') }
}
function setDocViewMode(mode) {
  window._docViewMode = mode;
  localStorage.setItem('docViewMode', mode);
  // Toggle visibility
  var tableEl = document.getElementById('d-table-view');
  var gridEl = document.getElementById('d-grid-view');
  if (tableEl) tableEl.classList.toggle('hidden', mode !== 'table');
  if (gridEl) gridEl.classList.toggle('hidden', mode !== 'grid');
  // Refresh toggle buttons
  filterD();
  // Update toggle buttons style
  var toggleBtns = document.querySelectorAll('.filter-row > div:first-child button');
  toggleBtns.forEach(function(btn, i) {
    var isActive = (i === 0 && mode === 'table') || (i === 1 && mode === 'grid');
    btn.className = 'px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ' +
      (isActive ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700');
  });
}
function renderDR(list) {
  document.getElementById('d-count').textContent = list.length + '명';
  var mode = window._docViewMode || 'table';

  // ===== Table view =====
  var thCls = 'cursor-pointer select-none hover:text-brand-500 transition';
  var theadEl = document.getElementById('d-thead');
  if (theadEl) {
    theadEl.innerHTML = '<tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold uppercase tracking-wider border-b border-gray-100">' +
      '<th class="px-4 lg:px-6 py-3.5 text-left ' + thCls + '" onclick="toggleSort(_docSort,\'name\',filterD)">의료진' + sortIcon('name', _docSort) + '</th>' +
      '<th class="px-4 py-3.5 text-left ' + thCls + '" onclick="toggleSort(_docSort,\'hospital_name\',filterD)">소속 병원' + sortIcon('hospital_name', _docSort) + '</th>' +
      '<th class="px-4 py-3.5 text-left hide-mobile ' + thCls + '" onclick="toggleSort(_docSort,\'department\',filterD)">진료과' + sortIcon('department', _docSort) + '</th>' +
      '<th class="px-4 py-3.5 text-left hide-mobile ' + thCls + '" onclick="toggleSort(_docSort,\'specialty\',filterD)">전문분야' + sortIcon('specialty', _docSort) + '</th>' +
      '<th class="px-4 py-3.5 text-center ' + thCls + '" onclick="toggleSort(_docSort,\'meeting_count\',filterD)">미팅' + sortIcon('meeting_count', _docSort) + '</th>' +
      '<th class="px-4 py-3.5 text-left ' + thCls + '" onclick="toggleSort(_docSort,\'last_meeting\',filterD)">최근' + sortIcon('last_meeting', _docSort) + '</th></tr>';
  }
  var tbodyEl = document.getElementById('d-tbody');
  if (tbodyEl) {
    tbodyEl.innerHTML = list.map(function(d) {
      return '<tr class="tr cursor-pointer" onclick="viewDocProfile(' + d.id + ')">' +
        '<td class="px-4 lg:px-6 py-3.5"><div class="flex items-center gap-3">' + avatar(d.photo, d.name) + '<div><div class="font-semibold text-[13px] text-slate-800">' + d.name + '</div><div class="text-[11px] text-slate-400">' + (d.position || '') + '</div></div></div></td>' +
        '<td class="px-4 py-3.5 text-[13px] text-slate-600">' + (d.hospital_name || '-') + '</td>' +
        '<td class="px-4 py-3.5 text-[13px] text-slate-500 hide-mobile">' + (d.department || '-') + '</td>' +
        '<td class="px-4 py-3.5 text-[13px] text-slate-500 hide-mobile">' + (d.specialty || '-') + '</td>' +
        '<td class="px-4 py-3.5 text-center text-[13px] font-bold text-slate-700">' + (d.meeting_count || 0) + '</td>' +
        '<td class="px-4 py-3.5"><div class="text-[13px] text-slate-600">' + (d.last_meeting ? fmtShort(d.last_meeting) : '-') + '</div>' + (d.last_meeting ? '<div class="text-[10px] ' + daysClass(d.last_meeting) + '">' + daysAgo(d.last_meeting) + '</div>' : '') + '</td></tr>';
    }).join('');
  }

  // ===== Grid (weekly schedule) view =====
  var gridEl = document.getElementById('d-grid-view');
  if (gridEl) {
    if (!list.length) {
      gridEl.innerHTML = '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-user-doctor"></i></div><p class="font-medium text-slate-500 mb-1">표시할 의료진이 없습니다</p></div></div>';
    } else {
      gridEl.innerHTML = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' +
        list.map(function(d) { return docWeeklyGridCard(d); }).join('') +
      '</div>';
    }
  }
}

// Reusable 7-day × AM/PM weekly schedule card for a doctor
function docWeeklyGridCard(d) {
  var ch = parseClinicHours(d.clinic_hours);
  // Backward compat: old format { mon: "09-12" }
  var isOld = ch.mon && !ch.mon_am && typeof ch.mon === 'string';
  if (isOld) { var m2 = {}; DAYS_KEY.forEach(function(k){ if(ch[k]) m2[k+'_am']=ch[k]; }); m2.notes=ch.notes||''; ch=m2; }

  var hasAnyDay = DAYS_KEY.some(function(k) { return ch[k + '_am'] || ch[k + '_pm']; });

  // 빈 값은 휴진으로 정규화
  var normSlot = function(v) { return (v == null || String(v).trim() === '') ? '휴진' : String(v); };

  var slotInfo = function(v) {
    if (!v) return { bg: 'bg-gray-100', fg: 'text-gray-400 line-through', icon: '<i class="fas fa-ban text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '✕' };
    if (v === '진료') return { bg: 'bg-cyan-100', fg: 'text-cyan-700', icon: '<i class="fas fa-stethoscope text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '●' };
    if (v === '수술') return { bg: 'bg-rose-100', fg: 'text-rose-700', icon: '<i class="fas fa-scissors text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '◆' };
    if (v === '휴진') return { bg: 'bg-gray-100', fg: 'text-gray-400 line-through', icon: '<i class="fas fa-ban text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '✕' };
    if (v === '순환진료') return { bg: 'bg-amber-100', fg: 'text-amber-700', icon: '<i class="fas fa-rotate text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '↻' };
    if (v === '오전진료' || v === '오후진료') return { bg: 'bg-cyan-50', fg: 'text-cyan-600', icon: '<i class="fas fa-sun text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '◐' };
    if (v.indexOf('검사') !== -1) return { bg: 'bg-purple-100', fg: 'text-purple-700', icon: '<i class="fas fa-microscope text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '▲' };
    if (v.indexOf('학회') !== -1) return { bg: 'bg-indigo-100', fg: 'text-indigo-700', icon: '<i class="fas fa-chalkboard-user text-[8px] mr-0.5" aria-hidden="true"></i>', dot: '★' };
    return { bg: 'bg-blue-50', fg: 'text-blue-600', icon: '', dot: '·' };
  };

  // Best-time hint: find days with 진료 in AM or PM
  var bestSlots = [];
  DAYS_KEY.forEach(function(k, i) {
    if ((ch[k + '_am'] || '') === '진료') bestSlots.push(DAYS_KR[i] + '오전');
    if ((ch[k + '_pm'] || '') === '진료') bestSlots.push(DAYS_KR[i] + '오후');
  });
  var bestHint = bestSlots.length ? bestSlots.slice(0, 4).join(', ') + (bestSlots.length > 4 ? ' …' : '') : '';

  // Header section
  var lastClass = d.last_meeting ? daysClass(d.last_meeting) : 'text-slate-300';
  var lastLabel = d.last_meeting ? daysAgo(d.last_meeting) : '미방문';

  var html = '<div class="card-flat p-4 lg:p-5 cursor-pointer hover:shadow-md transition" onclick="viewDocProfile(' + d.id + ')">' +
    // Header
    '<div class="flex items-start gap-3 mb-3">' +
      avatar(d.photo, d.name, 'width:44px;height:44px;border-radius:12px;font-size:16px') +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-1.5 mb-0.5 flex-wrap">' +
          '<span class="font-extrabold text-[14px] text-slate-800 truncate">' + d.name + '</span>' +
          (d.position ? '<span class="text-[11px] text-slate-400">' + d.position + '</span>' : '') +
        '</div>' +
        '<div class="text-[11px] text-slate-500 truncate"><i class="fas fa-hospital text-brand-400 mr-1 text-[10px]" aria-hidden="true"></i>' + (d.hospital_name || '-') + (d.department ? ' · ' + d.department : '') + '</div>' +
      '</div>' +
      '<div class="text-right flex-shrink-0">' +
        '<div class="text-[11px] font-bold text-slate-700"><i class="fas fa-handshake text-blue-400 mr-1 text-[10px]" aria-hidden="true"></i>' + (d.meeting_count || 0) + '회</div>' +
        '<div class="text-[10px] ' + lastClass + ' mt-0.5">' + lastLabel + '</div>' +
      '</div>' +
    '</div>';

  // Weekly grid
  if (hasAnyDay) {
    html += '<div class="border border-slate-100 rounded-lg overflow-hidden">' +
      // Day header
      '<div class="grid grid-cols-8 bg-slate-50 text-[10px] font-bold">' +
        '<div class="p-1.5 text-center text-slate-400"></div>' +
        DAYS_KR.map(function(dk, i) { return '<div class="p-1.5 text-center ' + (i === 5 ? 'text-blue-500' : 'text-slate-600') + '">' + dk + '</div>'; }).join('') +
      '</div>' +
      // AM row
      '<div class="grid grid-cols-8 border-t border-slate-100">' +
        '<div class="p-1.5 text-[9px] font-bold text-amber-600 text-center bg-amber-50/40 flex items-center justify-center"><i class="fas fa-sun text-[10px] mr-0.5" aria-hidden="true"></i>AM</div>' +
        DAYS_KEY.map(function(k) {
          var v = normSlot(ch[k + '_am']);
          var s = slotInfo(v);
          return '<div class="p-0.5"><div class="' + s.bg + ' ' + s.fg + ' rounded text-center text-[10px] font-semibold py-1.5 leading-none" title="' + v + '" aria-label="' + v + '">' + s.icon + (v.length > 3 ? v.substring(0, 2) : v) + '</div></div>';
        }).join('') +
      '</div>' +
      // PM row
      '<div class="grid grid-cols-8 border-t border-slate-100">' +
        '<div class="p-1.5 text-[9px] font-bold text-indigo-600 text-center bg-indigo-50/40 flex items-center justify-center"><i class="fas fa-moon text-[10px] mr-0.5" aria-hidden="true"></i>PM</div>' +
        DAYS_KEY.map(function(k) {
          var v = normSlot(ch[k + '_pm']);
          var s = slotInfo(v);
          return '<div class="p-0.5"><div class="' + s.bg + ' ' + s.fg + ' rounded text-center text-[10px] font-semibold py-1.5 leading-none" title="' + v + '" aria-label="' + v + '">' + s.icon + (v.length > 3 ? v.substring(0, 2) : v) + '</div></div>';
        }).join('') +
      '</div>' +
    '</div>';
    if (bestHint) {
      html += '<div class="text-[10px] text-emerald-600 mt-2 bg-emerald-50/60 rounded-md px-2 py-1.5"><i class="fas fa-thumbs-up mr-1 text-[9px]" aria-hidden="true"></i><strong>방문 추천:</strong> ' + bestHint + '</div>';
    }
    if (ch.notes) {
      html += '<div class="text-[10px] text-amber-700 mt-1.5 bg-amber-50/70 rounded-md px-2 py-1.5"><i class="fas fa-exclamation-circle mr-1 text-[9px]" aria-hidden="true"></i>' + ch.notes + '</div>';
    }
  } else {
    html += '<div class="text-[11px] text-slate-300 text-center py-6 border border-dashed border-slate-200 rounded-lg"><i class="fas fa-calendar-xmark text-lg mb-1 block" aria-hidden="true"></i>외래 시간이 등록되지 않았습니다</div>';
  }

  html += '</div>';
  return html;
}
function filterD() {
  const q = (document.getElementById('d-search')?.value || '').toLowerCase();
  const dept = document.getElementById('d-dept')?.value || '';
  const vis = document.getElementById('d-visit')?.value || '';
  const favOnly = document.getElementById('d-fav-only')?.checked || false;
  renderDR(sortList(docList.filter(d => {
    if (q && !d.name.toLowerCase().includes(q) && !(d.hospital_name || '').toLowerCase().includes(q)) return false;
    if (dept && d.department !== dept) return false;
    if (favOnly && !isFavorited('doctor', d.id)) return false;
    if (vis) {
      const days = parseInt(vis);
      if (d.last_meeting) { const diff = Math.floor((Date.now() - new Date(d.last_meeting + 'T00:00:00').getTime()) / 86400000); if (diff < days) return false; }
    }
    return true;
  }), _docSort.key, _docSort.dir));
}

// ===== DOCTOR PROFILE =====
let profileTab = 'overview';
async function viewDocProfile(id) {
  document.getElementById('page-title').textContent = '';
  document.getElementById('page-subtitle').innerHTML = '';
  document.getElementById('header-actions').innerHTML = '';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 space-y-5"><div class="card-flat p-6"><div class="flex gap-5"><div class="skeleton rounded-2xl" style="width:110px;height:110px"></div><div class="flex-1 space-y-3"><div class="skeleton rounded h-6 w-48"></div><div class="skeleton rounded h-4 w-72"></div></div></div></div></div>';
  try {
    const { data } = await API.get('/doctors/' + id); const d = data.data;
    window._docProfile = d; profileTab = 'overview';
    document.getElementById('page-title').textContent = d.name + ' ' + (d.position || '의료진');
    document.getElementById('page-subtitle').innerHTML = '<span class="cursor-pointer hover:text-brand-500 transition" onclick="nav(\'doctors\')"><i class="fas fa-chevron-left mr-1 text-[10px]"></i>의료진 목록</span>';
    document.getElementById('header-actions').innerHTML =
      '<button class="btn btn-outline btn-sm" onclick="showTagManager(\'doctor\',' + d.id + ')"><i class="fas fa-tags text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showMeetingStats(\'doctor\',' + d.id + ')"><i class="fas fa-chart-bar text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showTransferForm(' + d.id + ')"><i class="fas fa-right-left text-xs"></i></button>' +
      '<button class="btn btn-success btn-sm" onclick="showMeetForm(' + d.hospital_id + ',' + d.id + ')"><i class="fas fa-calendar-plus text-xs"></i><span class="hidden sm:inline">미팅</span></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showDocForm(' + d.hospital_id + ',' + d.id + ')"><i class="fas fa-pen text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" title="PDF 저장 / 인쇄" onclick="printDocProfile(' + d.id + ')"><i class="fas fa-file-pdf text-xs"></i><span class="hidden sm:inline">PDF</span></button>';
    renderDocProfile();
  } catch (e) { toast('의료진 정보를 불러올 수 없습니다', 'err') }
}
function renderDocProfile() {
  const d = window._docProfile;
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in space-y-5">' +
    '<div class="card-flat overflow-hidden">' +
    '<div class="h-20 lg:h-24 bg-gradient-to-r from-brand-500 via-brand-400 to-purple-400 relative"></div>' +
    '<div class="px-4 lg:px-8 pb-6 -mt-12 lg:-mt-14 relative">' +
    '<div class="flex flex-col sm:flex-row items-start sm:items-end gap-4 lg:gap-6">' +
    '<div class="w-[90px] h-[90px] lg:w-[110px] lg:h-[110px] rounded-2xl border-4 border-white shadow-lg overflow-hidden bg-white flex-shrink-0 photo-up" onclick="triggerProfilePhoto(' + d.id + ')">' +
    (d.photo ? '<img src="' + d.photo + '" class="w-full h-full object-cover">' : '<div class="w-full h-full bg-gradient-to-br from-brand-100 to-brand-200 flex items-center justify-center text-3xl lg:text-4xl font-bold text-brand-500">' + d.name.charAt(0) + '</div>') +
    '<div class="photo-ov" style="border-radius:12px"><i class="fas fa-camera text-lg"></i>' + (d.photo ? '<br><i class="fas fa-trash text-xs mt-1" onclick="event.stopPropagation();delProfilePhoto(' + d.id + ')"></i>' : '') + '</div></div>' +
    '<input type="file" id="pi-profile" accept="image/*" style="display:none" onchange="uploadProfilePhoto(' + d.id + ',this)">' +
    '<div class="flex-1 pt-2 sm:pt-14">' +
    '<div class="flex flex-wrap items-center gap-2 lg:gap-3 mb-1"><h2 class="text-xl lg:text-2xl font-extrabold text-slate-800">' + d.name + '</h2><span class="text-sm lg:text-base text-slate-400 font-medium">' + (d.position || '') + '</span></div>' +
    '<div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-500">' +
    (d.hospital_name ? '<span class="flex items-center gap-1.5"><i class="fas fa-hospital text-brand-400"></i><span class="font-semibold cursor-pointer hover:text-brand-600" onclick="viewHosp(' + d.hospital_id + ')">' + d.hospital_name + '</span></span>' : '') +
    (d.department ? '<span class="flex items-center gap-1.5"><i class="fas fa-stethoscope text-emerald-400"></i>' + d.department + '</span>' : '') +
    (d.specialty ? '<span class="flex items-center gap-1.5"><i class="fas fa-microscope text-purple-400"></i>' + d.specialty + '</span>' : '') +
    '</div></div>' +
    '<div class="flex gap-2 lg:gap-3 pt-2 sm:pt-14 flex-wrap profile-header-stats">' +
    profileStatBox('미팅', d.meeting_count || 0, '회', 'fa-handshake', '#2563eb', '#eef4ff') +
    profileStatBox('최근', d.last_meeting ? daysAgo(d.last_meeting) : '없음', '', 'fa-clock', '#059669', '#ecfdf5') +
    '</div></div></div></div>' +
    '<div class="flex flex-wrap gap-3 lg:gap-4">' +
    (d.phone ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-phone text-blue-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">전화번호</div><div class="text-sm font-semibold text-slate-700 truncate">' + d.phone + '</div></div></div>' : '') +
    (d.email ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-envelope text-purple-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">이메일</div><div class="text-sm font-semibold text-slate-700 truncate">' + d.email + '</div></div></div>' : '') +
    (d.hospital_region ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-map-marker-alt text-emerald-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">근무지</div><div class="text-sm font-semibold text-slate-700 truncate">' + (d.hospital_address || d.hospital_region) + '</div></div></div>' : '') +
    (d.profile_url ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3 cursor-pointer hover:border-cyan-200 transition" onclick="window.open(\'' + d.profile_url.replace(/'/g, "\\'") + '\',\'_blank\')"><div class="w-9 h-9 rounded-lg bg-cyan-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-globe text-cyan-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">병원 프로필</div><a href="' + d.profile_url + '" target="_blank" rel="noopener" class="text-sm font-semibold text-cyan-600 truncate block hover:underline" onclick="event.stopPropagation()">' + (d.profile_url.length > 35 ? d.profile_url.substring(0, 35) + '...' : d.profile_url) + '</a></div></div>' : '') +
    '</div>' +
    '<div class="flex border-b border-gray-100 px-1 overflow-x-auto">' +
    '<div class="tab ' + (profileTab === 'overview' ? 'active' : '') + '" onclick="profileTab=\'overview\';renderDocProfile()"><i class="fas fa-user text-xs"></i>소개</div>' +
    '<div class="tab ' + (profileTab === 'meetings' ? 'active' : '') + '" onclick="profileTab=\'meetings\';renderDocProfile()"><i class="fas fa-calendar-check text-xs"></i>미팅 (' + (d.meetings?.length || 0) + ')</div>' +
    '</div>' +
    renderProfileTab(d) + '</div>';
}
function profileStatBox(label, val, unit, icon, color, bg) {
  return '<div class="bg-white rounded-xl border border-gray-100 px-4 lg:px-5 py-3 text-center min-w-[80px]"><div class="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5" style="background:' + bg + '"><i class="fas ' + icon + ' text-xs" style="color:' + color + '"></i></div><div class="text-[15px] font-extrabold text-slate-800">' + val + '<span class="text-[11px] text-slate-400 font-medium ml-0.5">' + unit + '</span></div><div class="text-[10px] text-slate-400 font-medium">' + label + '</div></div>';
}
function renderProfileTab(d) {
  if (profileTab === 'overview') return renderProfileOverview(d);
  if (profileTab === 'meetings') return renderProfileMeetings(d);

  return '';
}
function renderProfileOverview(d) {
  let html = '<div class="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6">';
  html += '<div class="lg:col-span-3 space-y-5">';
  if (!d.bio && !d.education && !d.career) { html += '<div class="card-flat p-5 lg:p-6"><div class="empty"><div class="empty-icon"><i class="fas fa-user-graduate"></i></div><p class="font-medium text-slate-500 mb-1">학력/경력/소개 정보가 없습니다</p><p class="text-xs text-slate-400 mb-4">의료진 수정에서 직접 입력해주세요</p><button class="btn btn-outline btn-sm" onclick="showDocForm(' + d.hospital_id + ',' + d.id + ')"><i class="fas fa-pen mr-1.5 text-xs"></i>의료진 수정</button></div></div>'; }
  if (d.bio) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center"><i class="fas fa-user-tie text-brand-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">소개</span></div><p class="text-sm text-slate-600 leading-relaxed">' + d.bio + '</p></div>'; }
  if (d.education) { const eduLines = d.education.split('\n').filter(e => e.trim()); html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><i class="fas fa-graduation-cap text-amber-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">학력</span></div><div class="space-y-2.5">' + eduLines.map(e => '<div class="flex items-start gap-3"><div class="w-2 h-2 rounded-full bg-amber-300 mt-1.5 flex-shrink-0"></div><span class="text-sm text-slate-600">' + e + '</span></div>').join('') + '</div></div>'; }
  if (d.career) { const cl = d.career.split('\n').filter(c => c.trim()); html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-briefcase text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">경력</span></div><div class="relative pl-5"><div class="absolute left-[3px] top-1 bottom-1 w-0.5 bg-emerald-100"></div><div class="space-y-3">' + cl.map(c => '<div class="flex items-start gap-3 relative"><div class="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white shadow-sm flex-shrink-0 mt-1 -ml-[7px]"></div><span class="text-sm text-slate-600">' + c + '</span></div>').join('') + '</div></div></div>'; }
  if (d.notes) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><i class="fas fa-sticky-note text-violet-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">영업 메모</span></div><div class="bg-amber-50/70 rounded-xl p-4 text-[13px] text-amber-800 leading-relaxed"><i class="fas fa-lightbulb text-amber-400 mr-1.5"></i>' + d.notes + '</div></div>'; }
  html += renderClinicHours(d.clinic_hours);
  html += '</div><div class="lg:col-span-2 space-y-5">';
  html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-id-card text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">기본 정보</span></div><div class="space-y-3">' + infoRow('이름', d.name) + infoRow('직위', d.position) + infoRow('진료과', d.department) + infoRow('전문분야', d.specialty) + infoRow('소속 병원', d.hospital_name) + infoRow('지역', d.hospital_region) + (d.profile_url ? '<div class="flex items-center justify-between py-1"><span class="text-[12px] text-slate-400">프로필 링크</span><a href="' + d.profile_url + '" target="_blank" rel="noopener" class="text-[12px] text-cyan-600 hover:underline truncate max-w-[160px]"><i class="fas fa-external-link-alt mr-1 text-[10px]"></i>바로가기</a></div>' : '') + '</div></div>';
  if (d.meetings?.length) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center justify-between mb-4"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-calendar-check text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">최근 미팅</span></div><span class="text-[11px] text-brand-500 font-semibold cursor-pointer" onclick="profileTab=\'meetings\';renderDocProfile()">전체 &rarr;</span></div>' + d.meetings.slice(0, 3).map(m => '<div class="py-2.5 border-b border-gray-50 last:border-0 flex items-center gap-3">' + mtBadge(m.meeting_type) + '<div class="flex-1 min-w-0"><div class="text-[13px] font-medium text-slate-700 truncate">' + (m.purpose || '미팅') + '</div><div class="text-[11px] text-slate-400">' + fmtShort(m.meeting_date) + '</div></div></div>').join('') + '</div>'; }
  html += '</div></div>';
  return html;
}
function renderProfileMeetings(d) {
  const meets = d.meetings || [];
  if (!meets.length) return '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-calendar-plus"></i></div><p class="font-medium text-slate-500 mb-1">미팅이 없습니다</p></div></div>';
  const types = {}; meets.forEach(m => { types[m.meeting_type] = (types[m.meeting_type] || 0) + 1 });
  let html = '<div class="grid grid-cols-2 lg:grid-cols-5 gap-3 lg:gap-4 mb-5">';
  html += '<div class="sc !p-3 lg:!p-4"><div class="text-[11px] text-slate-400 font-medium mb-1">전체</div><div class="text-[20px] font-extrabold text-slate-800">' + meets.length + '<span class="text-xs text-slate-400 ml-0.5">건</span></div></div>';
  Object.entries(types).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => { html += '<div class="sc !p-3 lg:!p-4"><div class="text-[11px] text-slate-400 font-medium mb-1">' + mtBadge(t) + '</div><div class="text-[20px] font-extrabold text-slate-800">' + c + '<span class="text-xs text-slate-400 ml-0.5">건</span></div></div>'; });
  html += '</div>';
  html += '<div class="card-flat p-4 lg:p-6">' + meets.map((m, i) =>
    '<div class="flex gap-3 lg:gap-4 ' + (i < meets.length - 1 ? 'mb-6' : '') + '">' +
    '<div class="flex flex-col items-center pt-1"><div class="tl-dot"></div>' + (i < meets.length - 1 ? '<div class="tl-line flex-1 mt-1"></div>' : '') + '</div>' +
    '<div class="flex-1">' +
    '<div class="flex items-center justify-between mb-2 flex-wrap gap-2">' +
    '<div class="flex items-center gap-2 flex-wrap">' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + '<span class="text-xs text-slate-400">' + (m.hospital_name || '') + '</span>' + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명 참석</span>' : '') + '</div>' +
    '<div class="flex items-center gap-2"><span class="text-xs font-medium text-slate-500">' + fmtDate(m.meeting_date) + '</span>' +
    '<button class="btn btn-ghost text-xs px-1.5 py-1" onclick="showMeetFormFromProfile(' + d.hospital_id + ',' + d.id + ',' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button>' +
    '<button class="btn btn-ghost text-xs px-1.5 py-1" onclick="delMeetFromProfile(' + m.id + ',' + d.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div></div>' +
    (m.doctors && m.doctors.length > 1 ? '<div class="flex flex-wrap gap-1 mb-2">' + m.doctors.filter(function(dr) { return (dr.doctor_id || dr.id) != d.id }).map(function(dr) { return '<span class="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md font-medium"><i class="fas fa-user-doctor mr-0.5 text-[8px]"></i>' + (dr.doctor_name || dr.name) + '</span>' }).join('') + '</div>' : '') +
    (m.purpose ? '<div class="text-[14px] font-semibold text-slate-700 mb-1.5">' + m.purpose + '</div>' : '') +
    (m.content ? '<div class="text-[13px] text-slate-500 leading-relaxed mb-2 bg-slate-50 rounded-lg p-3">' + m.content + '</div>' : '') +
    '<div class="flex flex-wrap gap-2">' +
    (m.result ? '<div class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-check-circle mr-1.5"></i><strong>결과:</strong> ' + m.result + '</div>' : '') +
    (m.next_action ? '<div class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-arrow-right mr-1.5"></i><strong>후속:</strong> ' + m.next_action + '</div>' : '') +
    '</div></div></div>'
  ).join('') + '</div>';
  return html;
}
// ===== MEETINGS PAGE =====
var _meetViewMode = localStorage.getItem('meetView') || 'calendar';
var _calRange = localStorage.getItem('calRange') || 'month'; // month | week | day | timeline
function setMeetView(mode) { _meetViewMode = mode; localStorage.setItem('meetView', mode); renderMeetPage(); }
function setCalRange(r) { _calRange = r; localStorage.setItem('calRange', r); renderMeetCalendar(); }

async function loadMeet() {
  document.getElementById('page-title').textContent = '미팅 관리';
  document.getElementById('header-actions').innerHTML = exportMenu('meetings','미팅') + '<button class="btn btn-success" onclick="showNewMeetGlobal()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">미팅 추가</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="card-flat p-0">' + skeleton(6) + '</div></div>';
  try {
    const [meetR, hospR] = await Promise.all([API.get('/meetings'), API.get('/hospitals')]);
    window._meetList = meetR.data.data;
    window._meetHosps = hospR.data.data;
    window._meetCalYear = new Date().getFullYear();
    window._meetCalMonth = new Date().getMonth();
    renderMeetPage();
  } catch (e) { toast('미팅 관리 데이터를 불러올 수 없습니다', 'err') }
}

function renderMeetPage() {
  var C = document.getElementById('content');
  var hospOpts = '<option value="">전체 병원</option>' + (window._meetHosps || []).map(function(h) { return '<option value="' + h.id + '">' + h.name + '</option>'; }).join('');
  var viewBtns = '<div class="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">' +
    '<button class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ' + (_meetViewMode === 'calendar' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') + '" onclick="setMeetView(\'calendar\')"><i class="fas fa-calendar-days mr-1"></i>캘린더</button>' +
    '<button class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ' + (_meetViewMode === 'upcoming' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') + '" onclick="setMeetView(\'upcoming\')"><i class="fas fa-clock mr-1"></i>예정</button>' +
    '<button class="px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ' + (_meetViewMode === 'list' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') + '" onclick="setMeetView(\'list\')"><i class="fas fa-list mr-1"></i>전체</button>' +
    '</div>';

  C.innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
    '<div class="filter-row">' + viewBtns +
    '<div class="relative flex-1 filter-search"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="m-search" oninput="filterM()" placeholder="의료진/병원/목적 검색" class="input pl-10"></div>' +
    '<select id="m-hospital" onchange="filterM()" class="input filter-select-lg hide-mobile">' + hospOpts + '</select>' +
    '<select id="m-type" onchange="filterM()" class="input filter-select hide-mobile"><option value="">전체 유형</option><option value="visit">방문</option><option value="phone">전화</option><option value="conference">학회</option><option value="email">이메일</option><option value="online">온라인</option></select>' +
    '<select id="m-sort" onchange="applyMeetSort()" class="input filter-select text-[11px] !w-auto !min-w-0"><option value="meeting_date-desc">날짜 최신순</option><option value="meeting_date-asc">날짜 오래된순</option><option value="hospital_name-asc">병원 이름순</option><option value="hospital_name-desc">병원 역순</option><option value="meeting_type-asc">유형순</option></select>' +
    '<span id="m-count" class="text-xs text-slate-300 font-medium"></span>' +
    '</div>' +
    '<div id="m-body"></div></div>';

  if (_meetViewMode === 'calendar') renderMeetCalendar();
  else if (_meetViewMode === 'upcoming') renderMeetUpcoming();
  else renderMeetList();
}

// --- Calendar View (inline, not modal) ---
function renderMeetCalendar() {
  // Route to appropriate sub-renderer based on range mode
  if (_calRange === 'week') return renderMeetCalendarWeek();
  if (_calRange === 'day') return renderMeetCalendarDay();
  if (_calRange === 'timeline') return renderMeetCalendarTimeline();
  return renderMeetCalendarMonth();
}

// Range toggle UI (월간/주간/일간)
function calRangeToggle() {
  var btn = function(value, label, icon) {
    var active = _calRange === value;
    return '<button class="px-2.5 py-1 rounded-md text-[11px] font-bold transition ' +
      (active ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') +
      '" onclick="setCalRange(\'' + value + '\')">' +
      '<i class="fas ' + icon + ' mr-1 text-[10px]"></i>' + label + '</button>';
  };
  return '<div class="flex items-center justify-between mb-3 flex-wrap gap-2">' +
    '<div class="flex bg-slate-100 rounded-lg p-0.5 gap-0.5 flex-wrap">' +
      btn('month', '월간', 'fa-calendar-days') +
      btn('week', '주간', 'fa-calendar-week') +
      btn('day', '일간', 'fa-calendar-day') +
      btn('timeline', '타임라인', 'fa-stream') +
    '</div>' +
    '<button class="btn btn-ghost btn-sm text-[11px]" onclick="goToToday()"><i class="fas fa-circle-dot mr-1 text-[9px]"></i>오늘</button>' +
  '</div>';
}

function goToToday() {
  var now = new Date();
  window._meetCalYear = now.getFullYear();
  window._meetCalMonth = now.getMonth();
  window._meetCalDay = now.getDate();
  renderMeetCalendar();
}

// Helpers
function getCurrentCalDate() {
  var y = window._meetCalYear, m = window._meetCalMonth, d = window._meetCalDay || new Date().getDate();
  // Clamp day to last day of month
  var last = new Date(y, m + 1, 0).getDate();
  if (d > last) d = last;
  return new Date(y, m, d);
}
function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function startOfWeek(d) {
  // Sunday-based week (matches month grid headers)
  var dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  dt.setDate(dt.getDate() - dt.getDay());
  return dt;
}

// Filter meetings by current user filter
function _filterMeetsByUser(meetsAll) {
  var uf = window._calUserFilter || 'all';
  if (uf === 'all') return meetsAll;
  var ufNum = Number(uf);
  return meetsAll.filter(function(m) {
    var ids = (m.user_ids || []).map(Number);
    if (ids.length === 0 && m.user_id) ids = [Number(m.user_id)];
    return ids.indexOf(ufNum) !== -1;
  });
}

// Build a date->meetings map (with next_meeting_date virtual entries)
function _buildMeetMap(meets) {
  var map = {};
  meets.forEach(function(mt) {
    if (!mt.meeting_date) return;
    var d = mt.meeting_date.substring(0, 10);
    if (!map[d]) map[d] = [];
    map[d].push(mt);
    if (mt.next_meeting_date) {
      var nd = mt.next_meeting_date.substring(0, 10);
      if (!map[nd]) map[nd] = [];
      var existing = map[nd].some(function(e) { return e.id === mt.id && e._isNextMeeting; });
      if (!existing) map[nd].push(Object.assign({}, mt, { _isNextMeeting: true, _originalDate: mt.meeting_date, meeting_date: nd }));
    }
  });
  // Sort by visit_time
  var visitTimeOrder = { am: 0, pm: 1, full: 2, '': 3 };
  Object.keys(map).forEach(function(d) {
    map[d].sort(function(a, b) {
      var oa = visitTimeOrder[a.visit_time || ''] !== undefined ? visitTimeOrder[a.visit_time || ''] : 3;
      var ob = visitTimeOrder[b.visit_time || ''] !== undefined ? visitTimeOrder[b.visit_time || ''] : 3;
      if (oa !== ob) return oa - ob;
      return (a.id || 0) - (b.id || 0);
    });
  });
  return map;
}

// Compact meeting card used in week/day views
function _meetCardHTML(mt) {
  var tc = { visit:'blue', phone:'emerald', conference:'violet', email:'amber', online:'indigo' };
  var c = tc[mt.meeting_type] || 'slate';
  var icon = { visit:'fa-hospital', phone:'fa-phone', conference:'fa-chalkboard-user', email:'fa-envelope', online:'fa-video' };
  var isNext = mt._isNextMeeting;
  var primaryUid = (mt.user_ids && mt.user_ids[0]) || (mt.users && mt.users[0] && mt.users[0].user_id) || mt.user_id;
  var uc = userColor(primaryUid);
  var vt = mt.visit_time;
  var vtBg = vt === 'am' ? '#fed7aa' : vt === 'pm' ? '#bfdbfe' : vt === 'full' ? '#e9d5ff' : '#f1f5f9';
  var vtFg = vt === 'am' ? '#9a3412' : vt === 'pm' ? '#1e40af' : vt === 'full' ? '#6b21a8' : '#475569';
  var vtLabel = vt === 'am' ? '오전' : vt === 'pm' ? '오후' : vt === 'full' ? '종일' : '미지정';
  var bg = isNext ? 'bg-amber-50 border-dashed border-amber-300 text-amber-700' :
    'bg-' + c + '-50 border-' + c + '-200 text-' + c + '-700';
  var which = isNext ? 'next' : 'main';
  return '<div class="rounded-lg p-2 border ' + bg + ' cursor-pointer hover:shadow-sm transition meet-drag" ' +
    'draggable="true" data-meet-id="' + mt.id + '" data-which="' + which + '" ' +
    'ondragstart="onMeetDragStart(event)" ondragend="onMeetDragEnd(event)" ' +
    'style="border-left:3px solid ' + uc.dot + '" onclick="viewMeetDoctors(' + mt.id + ',[])">' +
    '<div class="flex items-center gap-1.5 mb-1">' +
      '<span class="text-[9px] font-extrabold rounded px-1" style="background:' + vtBg + ';color:' + vtFg + '">' + vtLabel + '</span>' +
      '<i class="fas ' + (isNext ? 'fa-clock' : (icon[mt.meeting_type] || 'fa-calendar')) + ' text-[10px]"></i>' +
      '<span class="text-[10px] font-semibold truncate flex-1">' + (isNext ? '예정: ' : '') + meetDoctorNames(mt) + '</span>' +
      '<i class="fas fa-grip-vertical text-[9px] text-slate-300 cursor-move" title="드래그해서 이동"></i>' +
    '</div>' +
    '<div class="text-[9px] opacity-80 truncate">' + (mt.hospital_name || '') + '</div>' +
    (mt.user_names ? '<div class="text-[9px] opacity-60 truncate"><i class="fas fa-user-tie mr-0.5"></i>' + mt.user_names + '</div>' : '') +
  '</div>';
}

// ===== Drag & Drop Handlers =====
function onMeetDragStart(e) {
  var el = e.currentTarget;
  var id = el.getAttribute('data-meet-id');
  var which = el.getAttribute('data-which') || 'main';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', JSON.stringify({ id: Number(id), which: which }));
  el.classList.add('opacity-40');
  // Highlight drop targets
  document.querySelectorAll('[data-drop-target="1"]').forEach(function(c) {
    c.classList.add('ring-1', 'ring-dashed', 'ring-brand-300');
  });
}
function onMeetDragEnd(e) {
  e.currentTarget.classList.remove('opacity-40');
  document.querySelectorAll('[data-drop-target="1"]').forEach(function(c) {
    c.classList.remove('ring-1', 'ring-dashed', 'ring-brand-300', 'bg-brand-50/60');
  });
}
function onMeetDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var t = e.currentTarget;
  if (t) t.classList.add('bg-brand-50/60');
}
function onMeetDragLeave(e) {
  var t = e.currentTarget;
  if (t) t.classList.remove('bg-brand-50/60');
}
async function onMeetDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  var t = e.currentTarget;
  if (t) t.classList.remove('bg-brand-50/60');
  var raw = e.dataTransfer.getData('text/plain');
  if (!raw) return;
  var payload;
  try { payload = JSON.parse(raw); } catch(_) { return; }
  var newDate = t.getAttribute('data-date');
  var newSlot = t.getAttribute('data-slot');
  if (!payload.id || !newDate) return;
  // Find original meeting
  var orig = (window._meetList || []).find(function(m) { return m.id === payload.id; });
  if (!orig) return;
  var origDate = (payload.which === 'next' ? orig.next_meeting_date : orig.meeting_date) || '';
  origDate = origDate.substring(0, 10);
  var origSlot = orig.visit_time || '';
  // No change?
  if (newDate === origDate && (payload.which === 'next' || newSlot === origSlot)) return;
  // Build patch body
  var body = { which: payload.which, meeting_date: newDate };
  if (payload.which !== 'next') body.visit_time = newSlot;
  try {
    await API.patch('/meetings/' + payload.id, body);
    // Update local cache so re-render reflects change
    if (payload.which === 'next') {
      orig.next_meeting_date = newDate;
    } else {
      orig.meeting_date = newDate;
      orig.visit_time = newSlot || null;
    }
    toast('일정이 이동되었습니다');
    renderMeetCalendar();
  } catch (err) {
    toast('이동 실패', 'err');
  }
}

// Team filter chips (shared by all calendar ranges)
function _teamFilterChips(meetsAll) {
  var userSet = {};
  meetsAll.forEach(function(mt) {
    (mt.users || []).forEach(function(u) { if (u && u.user_id != null) userSet[u.user_id] = u.user_name || ('#' + u.user_id); });
  });
  var userList = Object.keys(userSet).map(function(id) { return { id: Number(id), name: userSet[id] }; });
  userList.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
  if (!userList.length) return '';
  var uf = window._calUserFilter || 'all';
  var html = '<div class="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="팀원 필터">';
  var allCls = uf === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200';
  html += '<button class="text-[11px] font-bold px-2.5 py-1 rounded-full transition flex-shrink-0 ' + allCls + '" onclick="window._calUserFilter=\'all\';renderMeetCalendar()"><i class="fas fa-users text-[9px] mr-1"></i>전체 (' + meetsAll.length + ')</button>';
  userList.forEach(function(u) {
    var c = userColor(u.id);
    var sel = String(uf) === String(u.id);
    var cls = sel ? '' : 'opacity-60 hover:opacity-100';
    var cnt = meetsAll.filter(function(mm) {
      var ids = (mm.user_ids || []).map(Number); if (ids.length === 0 && mm.user_id) ids = [Number(mm.user_id)];
      return ids.indexOf(u.id) !== -1;
    }).length;
    html += '<button class="text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 transition flex-shrink-0 ' + cls + '" style="background:' + c.bg + ';color:' + c.fg + ';' + (sel ? 'box-shadow:0 0 0 2px ' + c.dot + '40' : '') + '" onclick="window._calUserFilter=' + u.id + ';renderMeetCalendar()">' +
      '<span class="inline-block w-2 h-2 rounded-full" style="background:' + c.dot + '"></span>' + u.name + ' (' + cnt + ')</button>';
  });
  html += '</div>';
  return html;
}

// ===== Weekly View =====
function renderMeetCalendarWeek() {
  var meetsAll = window._meetList || [];
  var meets = _filterMeetsByUser(meetsAll);
  var meetMap = _buildMeetMap(meets);

  var current = getCurrentCalDate();
  var weekStart = startOfWeek(current);
  var todayStr = dateStr(new Date());

  var dayLabels = ['일','월','화','수','목','금','토'];
  var slots = [
    { key: 'am', label: '오전', icon: 'fa-sun', bg: '#fff7ed' },
    { key: 'pm', label: '오후', icon: 'fa-cloud-sun', bg: '#eff6ff' },
    { key: 'full', label: '종일', icon: 'fa-clock', bg: '#faf5ff' },
    { key: '',    label: '미지정', icon: 'fa-circle-question', bg: '#f8fafc' },
  ];

  var weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  var rangeLabel = (weekStart.getMonth() + 1) + '/' + weekStart.getDate() + ' – ' + (weekEnd.getMonth() + 1) + '/' + weekEnd.getDate() + ', ' + weekStart.getFullYear();

  var dates = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    dates.push(d);
  }

  var html = '<div class="card-flat p-4 lg:p-6 mb-4">' + calRangeToggle();

  // Navigation
  html += '<div class="flex items-center justify-between mb-3">' +
    '<button class="btn btn-ghost btn-sm" onclick="shiftCalDays(-7)" aria-label="이전 주"><i class="fas fa-chevron-left"></i></button>' +
    '<div class="text-center"><span class="font-bold text-lg text-slate-800">' + rangeLabel + '</span><div class="text-[11px] text-slate-400">주간 보기</div></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="shiftCalDays(7)" aria-label="다음 주"><i class="fas fa-chevron-right"></i></button>' +
  '</div>';

  // Team filter chips
  html += _teamFilterChips(meetsAll);

  // Day headers
  html += '<div class="grid gap-1 mb-2" style="grid-template-columns:60px repeat(7,minmax(0,1fr))">';
  html += '<div></div>';
  dates.forEach(function(d) {
    var ds = dateStr(d);
    var isToday = ds === todayStr;
    var dow = d.getDay();
    var color = isToday ? 'text-brand-600 font-extrabold' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-slate-500';
    html += '<div class="text-center py-1 ' + (isToday ? 'bg-brand-50 rounded-lg' : '') + '">' +
      '<div class="text-[10px] font-semibold ' + color + '">' + dayLabels[dow] + '</div>' +
      '<div class="text-sm font-bold ' + color + '">' + d.getDate() + '</div>' +
    '</div>';
  });
  html += '</div>';

  // Time slot rows
  html += '<div class="space-y-1">';
  slots.forEach(function(slot) {
    html += '<div class="grid gap-1" style="grid-template-columns:60px repeat(7,minmax(0,1fr))">';
    html += '<div class="text-[11px] font-bold text-slate-500 flex flex-col items-center justify-center py-2 rounded-lg" style="background:' + slot.bg + '"><i class="fas ' + slot.icon + ' text-[12px] mb-0.5"></i>' + slot.label + '</div>';
    dates.forEach(function(d) {
      var ds = dateStr(d);
      var isToday = ds === todayStr;
      var dayMeets = (meetMap[ds] || []).filter(function(mt) { return (mt.visit_time || '') === slot.key; });
      var cellBg = isToday ? 'bg-brand-50/30' : 'bg-white';
      html += '<div class="border border-slate-100 rounded-lg p-1 min-h-[64px] ' + cellBg + ' transition" data-date="' + ds + '" data-slot="' + slot.key + '" data-drop-target="1" ondragover="onMeetDragOver(event)" ondragleave="onMeetDragLeave(event)" ondrop="onMeetDrop(event)">';
      if (dayMeets.length === 0) {
        html += '<div class="h-full w-full flex items-center justify-center text-[10px] text-slate-300 cursor-pointer hover:text-slate-400" onclick="showDayMeetsInline(\'' + ds + '\')">+</div>';
      } else {
        dayMeets.slice(0, 3).forEach(function(mt) { html += _meetCardHTML(mt) + '<div class="h-1"></div>'; });
        if (dayMeets.length > 3) html += '<div class="text-[9px] text-center text-slate-400 cursor-pointer hover:text-slate-600" onclick="showDayMeetsInline(\'' + ds + '\')">+' + (dayMeets.length - 3) + '건 더</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  });
  html += '</div>';

  // Summary
  var weekMeetCount = 0;
  dates.forEach(function(d) { var ds = dateStr(d); weekMeetCount += (meetMap[ds] || []).length; });
  html += '<div class="text-[11px] text-slate-400 mt-3"><i class="fas fa-info-circle mr-1"></i>이번 주 총 <strong class="text-slate-700">' + weekMeetCount + '</strong>건 · 시간대별 그리드 (오전/오후/종일/미지정)</div>';
  html += '</div>';

  document.getElementById('m-body').innerHTML = html;
}

function shiftCalDays(days) {
  var current = getCurrentCalDate();
  current.setDate(current.getDate() + days);
  window._meetCalYear = current.getFullYear();
  window._meetCalMonth = current.getMonth();
  window._meetCalDay = current.getDate();
  renderMeetCalendar();
}

// ===== Timeline (time-axis) View =====
// 7-day × 30-minute time grid. Meetings with start_time/end_time are absolutely
// positioned within their day column. Meetings without start_time appear in an
// "all-day / unscheduled" strip above the grid. Drag-and-drop moves a meeting
// to a new (day, time-slot) by writing start_time/end_time via PATCH.
function _hhmmToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  var parts = hhmm.split(':');
  if (parts.length < 2) return null;
  var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}
function _minutesToHHMM(mins) {
  if (mins == null) return '';
  mins = Math.max(0, Math.min(24 * 60 - 1, mins));
  var h = Math.floor(mins / 60), m = mins % 60;
  return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
}

function renderMeetCalendarTimeline() {
  var meetsAll = window._meetList || [];
  var meets = _filterMeetsByUser(meetsAll);

  var current = getCurrentCalDate();
  var weekStart = startOfWeek(current);
  var todayStr = dateStr(new Date());
  var dayLabels = ['일','월','화','수','목','금','토'];

  // Build 7-day date list
  var dates = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    dates.push(d);
  }

  // Group meetings by date string
  var byDate = {};
  meets.forEach(function(mt) {
    if (!mt.meeting_date) return;
    var ds = mt.meeting_date.substring(0, 10);
    if (!byDate[ds]) byDate[ds] = [];
    byDate[ds].push(mt);
    // virtual next-meeting entry
    if (mt.next_meeting_date) {
      var nd = mt.next_meeting_date.substring(0, 10);
      if (!byDate[nd]) byDate[nd] = [];
      byDate[nd].push(Object.assign({}, mt, { _isNextMeeting: true, _originalDate: mt.meeting_date, meeting_date: nd }));
    }
  });

  // Time-axis configuration
  var startHour = 8;     // 08:00
  var endHour = 20;      // 20:00 (12 hour window, scrollable)
  var slotMinutes = 30;
  var slotsPerHour = 60 / slotMinutes;
  var totalSlots = (endHour - startHour) * slotsPerHour; // 24 slots
  var slotHeightPx = 28; // each 30-min slot is 28px tall
  var totalHeight = totalSlots * slotHeightPx;

  var weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  var rangeLabel = (weekStart.getMonth() + 1) + '/' + weekStart.getDate() + ' – ' + (weekEnd.getMonth() + 1) + '/' + weekEnd.getDate() + ', ' + weekStart.getFullYear();

  var html = '<div class="card-flat p-4 lg:p-6 mb-4">' + calRangeToggle();

  // Navigation
  html += '<div class="flex items-center justify-between mb-3">' +
    '<button class="btn btn-ghost btn-sm" onclick="shiftCalDays(-7)" aria-label="이전 주"><i class="fas fa-chevron-left"></i></button>' +
    '<div class="text-center"><span class="font-bold text-lg text-slate-800">' + rangeLabel + '</span><div class="text-[11px] text-slate-400">타임라인 (30분 단위 · ' + startHour + ':00 ~ ' + endHour + ':00)</div></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="shiftCalDays(7)" aria-label="다음 주"><i class="fas fa-chevron-right"></i></button>' +
  '</div>';

  // Team filter
  html += _teamFilterChips(meetsAll);

  // ===== Unscheduled / all-day strip =====
  html += '<div class="grid gap-1 mb-2" style="grid-template-columns:60px repeat(7,minmax(0,1fr))">';
  html += '<div class="text-[10px] font-bold text-slate-400 flex items-center justify-center bg-slate-50 rounded-md py-1"><i class="fas fa-circle-question text-[10px] mr-1"></i>미지정</div>';
  dates.forEach(function(d) {
    var ds = dateStr(d);
    var dayMeets = (byDate[ds] || []).filter(function(mt) { return !_hhmmToMinutes(mt.start_time); });
    var bg = ds === todayStr ? 'bg-brand-50/30' : 'bg-white';
    html += '<div class="border border-slate-100 rounded-md p-1 min-h-[40px] ' + bg + ' transition" data-date="' + ds + '" data-slot="" data-tl-unscheduled="1" data-drop-target="1" ondragover="onMeetDragOver(event)" ondragleave="onMeetDragLeave(event)" ondrop="onTimelineDrop(event)">';
    if (dayMeets.length === 0) {
      html += '<div class="text-[9px] text-slate-300 text-center py-1">·</div>';
    } else {
      dayMeets.slice(0, 2).forEach(function(mt) { html += _timelineMiniCardHTML(mt); });
      if (dayMeets.length > 2) html += '<div class="text-[9px] text-center text-slate-400">+' + (dayMeets.length - 2) + '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  // ===== Day headers =====
  html += '<div class="grid gap-1 mb-1" style="grid-template-columns:60px repeat(7,minmax(0,1fr))">';
  html += '<div></div>';
  dates.forEach(function(d) {
    var ds = dateStr(d);
    var isToday = ds === todayStr;
    var dow = d.getDay();
    var color = isToday ? 'text-brand-600 font-extrabold' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : 'text-slate-500';
    html += '<div class="text-center py-1 ' + (isToday ? 'bg-brand-50 rounded-md' : '') + '">' +
      '<div class="text-[10px] font-semibold ' + color + '">' + dayLabels[dow] + '</div>' +
      '<div class="text-sm font-bold ' + color + '">' + d.getDate() + '</div>' +
    '</div>';
  });
  html += '</div>';

  // ===== Time-axis grid (scrollable) =====
  html += '<div class="overflow-y-auto border border-slate-200 rounded-lg" style="max-height:560px">';
  html += '<div class="grid gap-0 relative" style="grid-template-columns:60px repeat(7,minmax(0,1fr))">';

  // Time-label column (left)
  html += '<div class="bg-slate-50/60 border-r border-slate-100" style="position:relative;height:' + totalHeight + 'px">';
  for (var s = 0; s < totalSlots; s++) {
    var hh = startHour + Math.floor(s / slotsPerHour);
    var isHourMark = (s % slotsPerHour) === 0;
    var top = s * slotHeightPx;
    if (isHourMark) {
      html += '<div class="absolute left-0 right-0 text-[10px] font-bold text-slate-500 text-center" style="top:' + top + 'px">' +
        (hh < 10 ? '0' + hh : hh) + ':00</div>';
    }
  }
  html += '</div>';

  // Day columns
  dates.forEach(function(d) {
    var ds = dateStr(d);
    var isToday = ds === todayStr;
    var bgCol = isToday ? 'bg-brand-50/15' : 'bg-white';
    html += '<div class="border-r border-slate-100 ' + bgCol + '" style="position:relative;height:' + totalHeight + 'px">';

    // Slot cells (drop targets, half-hour each)
    for (var s2 = 0; s2 < totalSlots; s2++) {
      var topPx = s2 * slotHeightPx;
      var isHourLine = (s2 % slotsPerHour) === 0;
      var borderCls = isHourLine ? 'border-t border-slate-200' : 'border-t border-slate-100 border-dashed';
      var slotMins = (startHour * 60) + s2 * slotMinutes;
      var slotTime = _minutesToHHMM(slotMins);
      html += '<div class="absolute left-0 right-0 ' + borderCls + ' transition" style="top:' + topPx + 'px;height:' + slotHeightPx + 'px" ' +
        'data-date="' + ds + '" data-time="' + slotTime + '" data-drop-target="1" ' +
        'ondragover="onMeetDragOver(event)" ondragleave="onMeetDragLeave(event)" ondrop="onTimelineDrop(event)" ' +
        'onclick="quickAddAtSlot(\'' + ds + '\',\'' + slotTime + '\')"></div>';
    }

    // "Now" indicator on today's column
    if (isToday) {
      var now = new Date();
      var nowMins = now.getHours() * 60 + now.getMinutes();
      var startMins = startHour * 60;
      var endMins = endHour * 60;
      if (nowMins >= startMins && nowMins <= endMins) {
        var nowTop = ((nowMins - startMins) / slotMinutes) * slotHeightPx;
        html += '<div class="absolute left-0 right-0 pointer-events-none z-20" style="top:' + nowTop + 'px;height:2px;background:#ef4444">' +
          '<div class="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500"></div></div>';
      }
    }

    // Meeting blocks (absolute-positioned within day column)
    var dayMeets = (byDate[ds] || []).filter(function(mt) { return _hhmmToMinutes(mt.start_time) != null; });
    dayMeets.forEach(function(mt) {
      var startM = _hhmmToMinutes(mt.start_time);
      var endM = _hhmmToMinutes(mt.end_time) != null ? _hhmmToMinutes(mt.end_time) : startM + 30;
      if (endM <= startM) endM = startM + 30;
      var startMinsRange = startHour * 60;
      var endMinsRange = endHour * 60;
      // Clip to visible window
      var visibleStart = Math.max(startM, startMinsRange);
      var visibleEnd = Math.min(endM, endMinsRange);
      if (visibleEnd <= visibleStart) return;
      var topPx2 = ((visibleStart - startMinsRange) / slotMinutes) * slotHeightPx;
      var heightPx = Math.max(slotHeightPx - 2, ((visibleEnd - visibleStart) / slotMinutes) * slotHeightPx);
      html += _timelineBlockHTML(mt, topPx2, heightPx);
    });

    html += '</div>';
  });

  html += '</div>'; // grid
  html += '</div>'; // scroll container

  // Summary
  var weekMeetCount = 0;
  dates.forEach(function(d) { var ds = dateStr(d); weekMeetCount += (byDate[ds] || []).length; });
  html += '<div class="text-[11px] text-slate-400 mt-3"><i class="fas fa-info-circle mr-1"></i>이번 주 총 <strong class="text-slate-700">' + weekMeetCount + '</strong>건 · 빈 슬롯 클릭으로 빠른 등록 · 미팅을 드래그해서 시각 이동</div>';
  html += '</div>';

  document.getElementById('m-body').innerHTML = html;

  // Auto-scroll to a sensible default (current hour or 9:00)
  setTimeout(function() {
    var scroller = document.querySelector('#m-body .overflow-y-auto');
    if (!scroller) return;
    var now = new Date();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var startMins = startHour * 60;
    var targetMins = (nowMins >= startMins && nowMins <= endHour * 60) ? nowMins - 60 : 9 * 60;
    var targetTop = Math.max(0, ((targetMins - startMins) / slotMinutes) * slotHeightPx);
    scroller.scrollTop = targetTop;
  }, 30);
}

// Compact card for meeting blocks placed inside the time-axis grid
function _timelineBlockHTML(mt, topPx, heightPx) {
  var tc = { visit:'blue', phone:'emerald', conference:'violet', email:'amber', online:'indigo' };
  var c = tc[mt.meeting_type] || 'slate';
  var icon = { visit:'fa-hospital', phone:'fa-phone', conference:'fa-chalkboard-user', email:'fa-envelope', online:'fa-video' };
  var isNext = mt._isNextMeeting;
  var primaryUid = (mt.user_ids && mt.user_ids[0]) || (mt.users && mt.users[0] && mt.users[0].user_id) || mt.user_id;
  var uc = userColor(primaryUid);
  var bg = isNext ? 'background:#fffbeb;border:1px dashed #fcd34d;color:#92400e' :
    'background:var(--color-' + c + '-50,#eff6ff);border:1px solid var(--color-' + c + '-200,#bfdbfe);color:var(--color-' + c + '-700,#1d4ed8)';
  var which = isNext ? 'next' : 'main';
  var timeLabel = (mt.start_time || '') + (mt.end_time ? '~' + mt.end_time : '');
  // Compact text for short blocks
  var compact = heightPx < 44;
  var inner = compact
    ? '<div class="flex items-center gap-1 truncate"><i class="fas ' + (icon[mt.meeting_type] || 'fa-calendar') + ' text-[8px]"></i><span class="text-[9px] font-bold truncate">' + meetDoctorNames(mt) + '</span></div>'
    : '<div class="text-[9px] font-bold opacity-80 mb-0.5">' + timeLabel + '</div>' +
      '<div class="flex items-center gap-1 mb-0.5"><i class="fas ' + (icon[mt.meeting_type] || 'fa-calendar') + ' text-[9px]"></i><span class="text-[10px] font-bold truncate">' + meetDoctorNames(mt) + '</span></div>' +
      '<div class="text-[9px] opacity-70 truncate">' + (mt.hospital_name || '') + '</div>';
  return '<div class="absolute rounded-md p-1 cursor-pointer overflow-hidden meet-drag z-10 hover:shadow transition" ' +
    'draggable="true" data-meet-id="' + mt.id + '" data-which="' + which + '" ' +
    'ondragstart="onMeetDragStart(event)" ondragend="onMeetDragEnd(event)" ' +
    'style="top:' + topPx + 'px;height:' + heightPx + 'px;left:2px;right:2px;' + bg + ';border-left:3px solid ' + uc.dot + '" ' +
    'onclick="event.stopPropagation();viewMeetDoctors(' + mt.id + ',[])" title="' + timeLabel + ' · ' + meetDoctorNames(mt) + '">' + inner + '</div>';
}

// Tiny card for the "unscheduled" strip above the timeline grid
function _timelineMiniCardHTML(mt) {
  var tc = { visit:'blue', phone:'emerald', conference:'violet', email:'amber', online:'indigo' };
  var c = tc[mt.meeting_type] || 'slate';
  var primaryUid = (mt.user_ids && mt.user_ids[0]) || (mt.users && mt.users[0] && mt.users[0].user_id) || mt.user_id;
  var uc = userColor(primaryUid);
  var isNext = mt._isNextMeeting;
  var which = isNext ? 'next' : 'main';
  var bg = isNext ? 'background:#fffbeb;color:#92400e' : 'background:var(--color-' + c + '-50,#eff6ff);color:var(--color-' + c + '-700,#1d4ed8)';
  return '<div class="rounded px-1 py-0.5 text-[9px] font-bold truncate cursor-pointer meet-drag mb-0.5" ' +
    'draggable="true" data-meet-id="' + mt.id + '" data-which="' + which + '" ' +
    'ondragstart="onMeetDragStart(event)" ondragend="onMeetDragEnd(event)" ' +
    'style="' + bg + ';border-left:2px solid ' + uc.dot + '" ' +
    'onclick="event.stopPropagation();viewMeetDoctors(' + mt.id + ',[])">' + meetDoctorNames(mt) + '</div>';
}

// Drop handler specifically for timeline grid (handles start_time/end_time)
async function onTimelineDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  var t = e.currentTarget;
  if (t) t.classList.remove('bg-brand-50/60');
  var raw = e.dataTransfer.getData('text/plain');
  if (!raw) return;
  var payload;
  try { payload = JSON.parse(raw); } catch(_) { return; }
  if (!payload.id) return;
  var newDate = t.getAttribute('data-date');
  var newTime = t.getAttribute('data-time') || '';
  var unscheduled = t.getAttribute('data-tl-unscheduled') === '1';
  var orig = (window._meetList || []).find(function(m) { return m.id === payload.id; });
  if (!orig || !newDate) return;

  // Build PATCH body
  var body = { which: payload.which, meeting_date: newDate };
  if (payload.which !== 'next') {
    if (unscheduled) {
      // Move to unscheduled strip → clear start/end times
      body.start_time = '';
      body.end_time = '';
    } else if (newTime) {
      // Preserve duration if both start/end were set
      var origStart = _hhmmToMinutes(orig.start_time);
      var origEnd = _hhmmToMinutes(orig.end_time);
      var duration = (origStart != null && origEnd != null && origEnd > origStart) ? (origEnd - origStart) : 30;
      var newStartMins = _hhmmToMinutes(newTime);
      var newEndMins = newStartMins + duration;
      body.start_time = newTime;
      body.end_time = _minutesToHHMM(newEndMins);
      // Also auto-tag visit_time slot for backward compat
      var hh = Math.floor(newStartMins / 60);
      body.visit_time = hh < 12 ? 'am' : 'pm';
    }
  }
  try {
    await API.patch('/meetings/' + payload.id, body);
    // Update local cache
    if (payload.which === 'next') {
      orig.next_meeting_date = newDate;
    } else {
      orig.meeting_date = newDate;
      if (unscheduled) {
        orig.start_time = null;
        orig.end_time = null;
      } else if (newTime) {
        orig.start_time = body.start_time;
        orig.end_time = body.end_time;
        orig.visit_time = body.visit_time || orig.visit_time;
      }
    }
    toast('일정이 이동되었습니다');
    renderMeetCalendar();
  } catch (err) {
    toast('이동 실패', 'err');
  }
}

// Click an empty slot → open new-meeting form pre-filled with date + time
function quickAddAtSlot(date, time) {
  // Stash the slot info; new-meeting form will pick this up
  window._timelinePrefill = { date: date, time: time };
  showNewMeetGlobal();
  // After form renders, populate date/start/end fields
  setTimeout(function() {
    var dInp = document.querySelector('#fm input[name="meeting_date"]');
    var sInp = document.querySelector('#fm input[name="start_time"]');
    var eInp = document.querySelector('#fm input[name="end_time"]');
    var vInp = document.querySelector('#fm select[name="visit_time"]');
    if (dInp) dInp.value = date;
    if (sInp) sInp.value = time;
    if (eInp) {
      var mins = _hhmmToMinutes(time) + 30;
      eInp.value = _minutesToHHMM(mins);
    }
    if (vInp) {
      var hhx = parseInt((time || '12:00').split(':')[0], 10);
      vInp.value = hhx < 12 ? 'am' : 'pm';
    }
  }, 200);
}

// ===== Daily View =====
function renderMeetCalendarDay() {
  var meetsAll = window._meetList || [];
  var meets = _filterMeetsByUser(meetsAll);
  var meetMap = _buildMeetMap(meets);

  var current = getCurrentCalDate();
  var ds = dateStr(current);
  var todayStr = dateStr(new Date());
  var isToday = ds === todayStr;
  var dayLabels = ['일','월','화','수','목','금','토'];
  var dowLabel = dayLabels[current.getDay()];

  var dayMeets = meetMap[ds] || [];
  var slots = [
    { key: 'am', label: '오전 (AM)', icon: 'fa-sun', color: '#f59e0b' },
    { key: 'pm', label: '오후 (PM)', icon: 'fa-cloud-sun', color: '#3b82f6' },
    { key: 'full', label: '종일', icon: 'fa-clock', color: '#8b5cf6' },
    { key: '',    label: '시간 미지정', icon: 'fa-circle-question', color: '#94a3b8' },
  ];

  var titleLabel = current.getFullYear() + '년 ' + (current.getMonth() + 1) + '월 ' + current.getDate() + '일 (' + dowLabel + ')';

  var html = '<div class="card-flat p-4 lg:p-6 mb-4">' + calRangeToggle();

  // Navigation
  html += '<div class="flex items-center justify-between mb-3">' +
    '<button class="btn btn-ghost btn-sm" onclick="shiftCalDays(-1)" aria-label="이전 날"><i class="fas fa-chevron-left"></i></button>' +
    '<div class="text-center"><span class="font-bold text-lg ' + (isToday ? 'text-brand-600' : 'text-slate-800') + '">' + titleLabel + (isToday ? ' · 오늘' : '') + '</span><div class="text-[11px] text-slate-400">일간 보기</div></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="shiftCalDays(1)" aria-label="다음 날"><i class="fas fa-chevron-right"></i></button>' +
  '</div>';

  // Team filter chips
  html += _teamFilterChips(meetsAll);

  if (!dayMeets.length) {
    html += '<div class="text-center py-12 text-slate-300 border border-dashed border-slate-200 rounded-xl transition" data-date="' + ds + '" data-slot="" data-drop-target="1" ondragover="onMeetDragOver(event)" ondragleave="onMeetDragLeave(event)" ondrop="onMeetDrop(event)"><i class="fas fa-calendar-xmark text-3xl mb-3 block"></i><div class="text-sm">이 날에는 등록된 미팅이 없습니다</div><div class="text-[11px] mt-1">다른 일정을 여기로 드래그하면 이 날짜로 이동합니다</div><button class="btn btn-success btn-sm mt-4" onclick="showNewMeetGlobal()"><i class="fas fa-plus text-xs mr-1"></i>미팅 추가</button></div>';
    html += '</div>';
    document.getElementById('m-body').innerHTML = html;
    return;
  }

  // Group by visit_time slot (all slots are drop targets, even when empty)
  html += '<div class="space-y-4">';
  slots.forEach(function(slot) {
    var slotMeets = dayMeets.filter(function(mt) { return (mt.visit_time || '') === slot.key; });
    var emptyHint = slotMeets.length === 0
      ? '<div class="col-span-full text-center text-[11px] text-slate-300 py-3 border border-dashed border-slate-200 rounded-lg">여기에 드래그하여 ' + slot.label + ' 시간대로 이동</div>'
      : '';
    html += '<div>' +
      '<div class="flex items-center gap-2 mb-2"><div class="w-7 h-7 rounded-lg flex items-center justify-center" style="background:' + slot.color + '20;color:' + slot.color + '"><i class="fas ' + slot.icon + ' text-xs"></i></div>' +
      '<span class="font-bold text-sm text-slate-700">' + slot.label + '</span>' +
      '<span class="text-[11px] text-slate-400">' + slotMeets.length + '건</span></div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-lg p-1 transition" data-date="' + ds + '" data-slot="' + slot.key + '" data-drop-target="1" ondragover="onMeetDragOver(event)" ondragleave="onMeetDragLeave(event)" ondrop="onMeetDrop(event)">' +
        slotMeets.map(function(mt) { return _meetCardHTML(mt); }).join('') + emptyHint +
      '</div>' +
    '</div>';
  });
  html += '</div>';

  // Day summary
  html += '<div class="text-[11px] text-slate-400 mt-4"><i class="fas fa-info-circle mr-1"></i>총 <strong class="text-slate-700">' + dayMeets.length + '</strong>건의 미팅</div>';
  html += '</div>';

  document.getElementById('m-body').innerHTML = html;
}

function renderMeetCalendarMonth() {
  var meetsAll = window._meetList || [];
  // Apply user filter (team calendar)
  var uf = window._calUserFilter || 'all';
  var meets = meetsAll;
  if (uf !== 'all') {
    var ufNum = Number(uf);
    meets = meetsAll.filter(function(m) {
      var ids = (m.user_ids || []).map(Number);
      if (ids.length === 0 && m.user_id) ids = [Number(m.user_id)];
      return ids.indexOf(ufNum) !== -1;
    });
  }
  var y = window._meetCalYear, m = window._meetCalMonth;
  var firstDay = new Date(y, m, 1).getDay();
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  var dayLabels = ['일','월','화','수','목','금','토'];
  var todayStr = new Date().toISOString().split('T')[0];
  // Build distinct user list from data
  var userSet = {};
  meetsAll.forEach(function(mt) {
    (mt.users || []).forEach(function(u) { if (u && u.user_id != null) userSet[u.user_id] = u.user_name || ('#' + u.user_id); });
  });
  var userList = Object.keys(userSet).map(function(id) { return { id: Number(id), name: userSet[id] }; });
  userList.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
  // Group meetings by date (including next_meeting_date as scheduled)
  var meetMap = {};
  meets.forEach(function(mt) {
    if (!mt.meeting_date) return;
    var d = mt.meeting_date.substring(0, 10);
    if (!meetMap[d]) meetMap[d] = [];
    meetMap[d].push(mt);
    // Also show next_meeting_date as upcoming scheduled meeting
    if (mt.next_meeting_date) {
      var nd = mt.next_meeting_date.substring(0, 10);
      if (!meetMap[nd]) meetMap[nd] = [];
      // Create a virtual entry for the next scheduled meeting
      var existing = meetMap[nd].some(function(e) { return e.id === mt.id && e._isNextMeeting; });
      if (!existing) {
        meetMap[nd].push(Object.assign({}, mt, { _isNextMeeting: true, _originalDate: mt.meeting_date, meeting_date: nd }));
      }
    }
  });
  // Sort meetings within each day: am → pm → full → unset
  var visitTimeOrder = { am: 0, pm: 1, full: 2, '': 3 };
  Object.keys(meetMap).forEach(function(d) {
    meetMap[d].sort(function(a, b) {
      var oa = visitTimeOrder[a.visit_time || ''] !== undefined ? visitTimeOrder[a.visit_time || ''] : 3;
      var ob = visitTimeOrder[b.visit_time || ''] !== undefined ? visitTimeOrder[b.visit_time || ''] : 3;
      if (oa !== ob) return oa - ob;
      return (a.id || 0) - (b.id || 0);
    });
  });
  // Stats for this month
  var monthPrefix = y + '-' + String(m + 1).padStart(2, '0');
  var allMonthEntries = [];
  Object.keys(meetMap).forEach(function(d) { if (d.startsWith(monthPrefix)) meetMap[d].forEach(function(mt) { allMonthEntries.push({ date: d, mt: mt }); }); });
  var pastCount = 0, futureCount = 0;
  allMonthEntries.forEach(function(e) { if (e.date <= todayStr) pastCount++; else futureCount++; });

  var html = '<div class="card-flat p-4 lg:p-6 mb-4">' +
    calRangeToggle() +
    '<div class="flex items-center justify-between mb-3">' +
    '<button class="btn btn-ghost btn-sm" onclick="window._meetCalMonth--;if(window._meetCalMonth<0){window._meetCalYear--;window._meetCalMonth=11;}renderMeetCalendar()" aria-label="이전 달"><i class="fas fa-chevron-left"></i></button>' +
    '<div class="text-center"><span class="font-bold text-lg text-slate-800">' + y + '년 ' + monthNames[m] + '</span>' +
    '<div class="flex items-center justify-center gap-3 mt-1 text-[11px]">' +
    '<span class="text-slate-400"><i class="fas fa-calendar-check text-emerald-400 mr-1"></i>완료 <strong class="text-emerald-600">' + pastCount + '</strong></span>' +
    '<span class="text-slate-400"><i class="fas fa-clock text-blue-400 mr-1"></i>예정 <strong class="text-blue-600">' + futureCount + '</strong></span>' +
    '<span class="text-slate-400">총 <strong class="text-slate-700">' + allMonthEntries.length + '</strong>건</span></div></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="window._meetCalMonth++;if(window._meetCalMonth>11){window._meetCalYear++;window._meetCalMonth=0;}renderMeetCalendar()" aria-label="다음 달"><i class="fas fa-chevron-right"></i></button></div>';
  // ===== Team filter chips =====
  if (userList.length > 0) {
    html += '<div class="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="팀원 필터">';
    var allCls = uf === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200';
    html += '<button class="text-[11px] font-bold px-2.5 py-1 rounded-full transition flex-shrink-0 ' + allCls + '" onclick="window._calUserFilter=\'all\';renderMeetCalendar()" role="tab" aria-selected="' + (uf==='all') + '"><i class="fas fa-users text-[9px] mr-1"></i>전체 (' + meetsAll.length + ')</button>';
    userList.forEach(function(u) {
      var c = userColor(u.id);
      var sel = String(uf) === String(u.id);
      var cls = sel ? '' : 'opacity-60 hover:opacity-100';
      var cnt = meetsAll.filter(function(mm) {
        var ids = (mm.user_ids || []).map(Number); if (ids.length === 0 && mm.user_id) ids = [Number(mm.user_id)];
        return ids.indexOf(u.id) !== -1;
      }).length;
      html += '<button class="text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5 transition flex-shrink-0 ' + cls + '" style="background:' + c.bg + ';color:' + c.fg + ';' + (sel ? 'box-shadow:0 0 0 2px ' + c.dot + '40' : '') + '" onclick="window._calUserFilter=' + u.id + ';renderMeetCalendar()" role="tab" aria-selected="' + sel + '">' +
        '<span class="inline-block w-2 h-2 rounded-full" style="background:' + c.dot + '"></span>' + u.name + ' (' + cnt + ')</button>';
    });
    html += '</div>';
  }
  // Day headers
  html += '<div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold mb-2">' +
    dayLabels.map(function(dl, i) { return '<div class="py-1 ' + (i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400') + '">' + dl + '</div>'; }).join('') + '</div>';
  // Calendar grid
  html += '<div class="grid grid-cols-7 gap-1">';
  for (var i = 0; i < firstDay; i++) html += '<div class="h-14 lg:h-[88px]"></div>';
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var dayMeets = meetMap[dateStr] || [];
    var isToday = dateStr === todayStr;
    var isPast = dateStr < todayStr;
    var isFuture = dateStr > todayStr;
    var dow = new Date(y, m, d).getDay();
    var isSun = dow === 0, isSat = dow === 6;
    var cellBg = isToday ? 'bg-brand-50 border-brand-300 ring-1 ring-brand-200' :
      dayMeets.length > 0 ? (isFuture ? 'bg-blue-50/40 border-blue-200' : 'bg-white border-slate-200') :
      isSun ? 'bg-red-50/20 border-slate-100' : isSat ? 'bg-blue-50/20 border-slate-100' : 'bg-white border-slate-100 hover:border-slate-200';
    html += '<div class="h-14 lg:h-[88px] border rounded-lg p-1 ' + cellBg + ' overflow-hidden cursor-pointer transition-all hover:shadow-sm" data-date="' + dateStr + '" data-slot="" data-drop-target="1" ondragover="onMeetDragOver(event)" ondragleave="onMeetDragLeave(event)" ondrop="onMeetDrop(event)" onclick="showDayMeetsInline(\'' + dateStr + '\')">' +
      '<div class="flex items-center justify-between">' +
      '<span class="text-[11px] font-bold ' + (isToday ? 'bg-brand-500 text-white w-5 h-5 rounded-full flex items-center justify-center' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-600') + '">' + d + '</span>' +
      (dayMeets.length > 0 ? '<span class="text-[8px] font-bold px-1 py-0 rounded-full ' + (isFuture ? 'bg-blue-500 text-white' : 'bg-emerald-500 text-white') + '">' + dayMeets.length + '</span>' : '') + '</div>';
    // Show meeting items (sorted: am → pm → full → unset)
    dayMeets.slice(0, 2).forEach(function(mt) {
      var tc = { visit:'blue', phone:'emerald', conference:'violet', email:'amber', online:'indigo' };
      var c = tc[mt.meeting_type] || 'slate';
      var icon = { visit:'fa-hospital', phone:'fa-phone', conference:'fa-chalkboard-user', email:'fa-envelope', online:'fa-video' };
      var isNext = mt._isNextMeeting;
      var vtPrefix = '';
      if (mt.visit_time === 'am') vtPrefix = '<span class="inline-flex items-center justify-center text-[7px] lg:text-[8px] font-extrabold rounded px-0.5 mr-0.5" style="background:#fed7aa;color:#9a3412">오전</span>';
      else if (mt.visit_time === 'pm') vtPrefix = '<span class="inline-flex items-center justify-center text-[7px] lg:text-[8px] font-extrabold rounded px-0.5 mr-0.5" style="background:#bfdbfe;color:#1e40af">오후</span>';
      else if (mt.visit_time === 'full') vtPrefix = '<span class="inline-flex items-center justify-center text-[7px] lg:text-[8px] font-extrabold rounded px-0.5 mr-0.5" style="background:#e9d5ff;color:#6b21a8">종일</span>';
      // User color marker (left border) — uses primary user
      var primaryUid = (mt.user_ids && mt.user_ids[0]) || (mt.users && mt.users[0] && mt.users[0].user_id) || mt.user_id;
      var uc = userColor(primaryUid);
      var multiUser = (mt.users && mt.users.length > 1) ? '<span class="ml-auto inline-flex items-center justify-center text-[6px] font-bold rounded-full" style="width:9px;height:9px;background:' + uc.dot + ';color:#fff" title="' + (mt.users.length) + '명 담당">' + mt.users.length + '</span>' : '';
      html += '<div class="text-[7px] lg:text-[9px] truncate rounded px-1 py-0.5 mt-0.5 flex items-center gap-0.5 ' +
        (isNext ? 'bg-amber-100 text-amber-700 font-semibold border border-dashed border-amber-300' :
         isFuture ? 'bg-' + c + '-100 text-' + c + '-700 font-semibold' : 'bg-' + c + '-50 text-' + c + '-500') + '" style="border-left:3px solid ' + uc.dot + '" title="담당: ' + (mt.user_names || '') + '">' +
        '<i class="fas ' + (isNext ? 'fa-clock' : (icon[mt.meeting_type] || 'fa-calendar')) + ' text-[6px] lg:text-[7px]"></i>' +
        vtPrefix +
        (isNext ? '예정: ' : '') + meetDoctorNames(mt) + multiUser + '</div>';
    });
    if (dayMeets.length > 2) html += '<div class="text-[7px] lg:text-[8px] text-slate-400 mt-0.5 text-center">+' + (dayMeets.length - 2) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  // Legend
  html += '<div class="flex flex-wrap items-center gap-4 mt-4 text-[10px] text-slate-400">' +
    '<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-500"></span>예정 미팅</span>' +
    '<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>완료 미팅</span>' +
    '<span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-brand-500"></span>오늘</span>' +
    '<span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-blue-100 border border-blue-200"></span>방문</span>' +
    '<span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-emerald-100 border border-emerald-200"></span>전화</span>' +
    '<span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-violet-100 border border-violet-200"></span>학회</span>' +
    '<span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded bg-amber-100 border border-dashed border-amber-300"></span>다음 미팅 예정</span>' +
    '<span class="flex items-center gap-1"><span class="text-[8px] font-extrabold rounded px-0.5" style="background:#fed7aa;color:#9a3412">오전</span><span class="text-[8px] font-extrabold rounded px-0.5" style="background:#bfdbfe;color:#1e40af">오후</span><span class="text-slate-400">방문 시간대</span></span>' +
    '<span class="flex items-center gap-1"><span class="inline-block w-1 h-3 rounded-sm" style="background:#3b82f6"></span><span class="inline-block w-1 h-3 rounded-sm" style="background:#ec4899"></span><span class="inline-block w-1 h-3 rounded-sm" style="background:#22c55e"></span><span class="text-slate-400">담당자별 색상 (좌측 띠)</span></span>' +
    '</div></div>';

  // Upcoming section below calendar - include next_meeting_date as scheduled
  var upcomingList = [];
  meets.forEach(function(mt) {
    if (mt.meeting_date >= todayStr) upcomingList.push(mt);
    if (mt.next_meeting_date && mt.next_meeting_date >= todayStr) {
      upcomingList.push(Object.assign({}, mt, { _isNextMeeting: true, _originalDate: mt.meeting_date, meeting_date: mt.next_meeting_date }));
    }
  });
  upcomingList.sort(function(a, b) { return a.meeting_date.localeCompare(b.meeting_date); });
  var upcoming = upcomingList.slice(0, 5);
  var recent = meets.filter(function(mt) { return mt.meeting_date < todayStr; }).sort(function(a, b) { return b.meeting_date.localeCompare(a.meeting_date); }).slice(0, 5);

  html += '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">';
  // Upcoming meetings
  html += '<div class="card-flat p-4"><div class="flex items-center gap-2 mb-3"><div class="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-clock text-blue-500 text-[10px]"></i></div><span class="font-bold text-sm text-slate-800">예정된 미팅</span><span class="text-[10px] text-blue-500 font-medium">' + upcomingList.length + '건</span></div>';
  if (upcoming.length) {
    html += '<div class="space-y-2">' + upcoming.map(function(mt) {
      var daysLeft = Math.ceil((new Date(mt.meeting_date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
      var urgency = daysLeft === 0 ? 'bg-red-50 border-red-200 text-red-600' : daysLeft <= 3 ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-blue-50 border-blue-200 text-blue-600';
      var isNext = mt._isNextMeeting;
      if (isNext) urgency = 'bg-amber-50 border-amber-200 border-dashed text-amber-700';
      return '<div class="flex items-center gap-3 p-2.5 rounded-lg border ' + urgency + ' cursor-pointer hover:shadow-sm transition-all" onclick="showDayMeetsInline(\'' + mt.meeting_date + '\')">' +
        '<div class="text-center flex-shrink-0 w-10"><div class="text-[10px] font-bold">' + (daysLeft === 0 ? 'D-DAY' : 'D-' + daysLeft) + '</div><div class="text-[9px] opacity-70">' + fmtShort(mt.meeting_date) + '</div></div>' +
        '<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5">' + (isNext ? '<span class="text-[8px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-bold">다음 미팅</span>' : mtBadge(mt.meeting_type)) + '<span class="font-semibold text-xs truncate">' + meetDoctorNames(mt) + '</span></div>' +
        '<div class="text-[10px] opacity-70 truncate">' + (mt.hospital_name || '') + (mt.purpose ? ' · ' + mt.purpose : '') + '</div></div></div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="text-center py-6 text-slate-300"><i class="fas fa-calendar-check text-2xl mb-2 block"></i><span class="text-xs">예정된 미팅이 없습니다</span></div>';
  }
  html += '</div>';
  // Recent meetings
  html += '<div class="card-flat p-4"><div class="flex items-center gap-2 mb-3"><div class="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-check-circle text-emerald-500 text-[10px]"></i></div><span class="font-bold text-sm text-slate-800">최근 미팅</span></div>';
  if (recent.length) {
    html += '<div class="space-y-2">' + recent.map(function(mt) {
      var daysAgoN = Math.ceil((new Date(todayStr + 'T00:00:00') - new Date(mt.meeting_date + 'T00:00:00')) / 86400000);
      return '<div class="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100 cursor-pointer hover:shadow-sm transition-all" onclick="showDayMeetsInline(\'' + mt.meeting_date + '\')">' +
        '<div class="text-center flex-shrink-0 w-10"><div class="text-[10px] font-medium text-slate-400">' + (daysAgoN === 0 ? '오늘' : daysAgoN + '일 전') + '</div><div class="text-[9px] text-slate-300">' + fmtShort(mt.meeting_date) + '</div></div>' +
        '<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5">' + mtBadge(mt.meeting_type) + '<span class="font-semibold text-xs text-slate-700 truncate">' + meetDoctorNames(mt) + '</span></div>' +
        '<div class="text-[10px] text-slate-400 truncate">' + (mt.hospital_name || '') + (mt.result ? ' · ' + mt.result : '') + '</div></div></div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="text-center py-6 text-slate-300"><i class="fas fa-calendar-xmark text-2xl mb-2 block"></i><span class="text-xs">최근 미팅이 없습니다</span></div>';
  }
  html += '</div></div>';

  document.getElementById('m-body').innerHTML = html;
  document.getElementById('m-count').textContent = meets.length + '건';
}

// Inline day detail (replaces modal version for this page)
window.showDayMeetsInline = function(dateStr) {
  var dayMeets = (window._meetList || []).filter(function(m) { return m.meeting_date === dateStr; });
  // Also include meetings where next_meeting_date matches this date
  var nextMeets = (window._meetList || []).filter(function(m) { return m.next_meeting_date === dateStr && m.meeting_date !== dateStr; });
  nextMeets.forEach(function(m) { dayMeets.push(Object.assign({}, m, { _isNextMeeting: true, _originalDate: m.meeting_date, meeting_date: dateStr })); });
  // Sort: am → pm → full → unset
  var _vto = { am: 0, pm: 1, full: 2, '': 3 };
  dayMeets.sort(function(a, b) {
    var oa = _vto[a.visit_time || ''] !== undefined ? _vto[a.visit_time || ''] : 3;
    var ob = _vto[b.visit_time || ''] !== undefined ? _vto[b.visit_time || ''] : 3;
    if (oa !== ob) return oa - ob;
    return (a.id || 0) - (b.id || 0);
  });
  var meetDay = new Date(dateStr + 'T00:00:00');
  var dayIdx = (meetDay.getDay() + 6) % 7;
  var dayKr = dayIdx < 6 ? DAYS_KR[dayIdx] : '일';
  var dayKey = dayIdx >= 0 && dayIdx < 6 ? DAYS_KEY[dayIdx] : '';
  var todayStr = new Date().toISOString().split('T')[0];
  var isFuture = dateStr > todayStr;
  var isToday = dateStr === todayStr;

  var html = '<div class="flex items-center gap-2 mb-3"><span class="text-[11px] px-2 py-0.5 rounded-full font-bold ' +
    (isToday ? 'bg-brand-500 text-white' : isFuture ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700') + '">' +
    (isToday ? '오늘' : isFuture ? '예정' : '완료') + '</span></div>';

  if (dayMeets.length) {
    html += '<div class="space-y-2">' + dayMeets.map(function(m) {
      var schedInfo = '';
      if (dayKey && m.doctors && m.doctors.length) {
        var hints = [];
        m.doctors.forEach(function(md) {
          if (!md.clinic_hours) return;
          var ch = parseClinicHours(md.clinic_hours);
          if (ch.mon && !ch.mon_am && typeof ch.mon === 'string') { var m2={}; DAYS_KEY.forEach(function(k){if(ch[k])m2[k+'_am']=ch[k];}); m2.notes=ch.notes||''; ch=m2; }
          var am = ch[dayKey + '_am'] || '', pm = ch[dayKey + '_pm'] || '';
          if (am || pm) {
            var isOff = am === '휴진' && (!pm || pm === '휴진');
            hints.push('<span class="text-[9px] px-1.5 py-0.5 rounded-full ' + (isOff ? 'bg-red-50 text-red-400' : 'bg-cyan-50 text-cyan-600') + '">' +
              md.name + ': ' + (am ? '오전 ' + am : '') + (am && pm ? ' / ' : '') + (pm ? '오후 ' + pm : '') + '</span>');
          }
        });
        if (hints.length) schedInfo = '<div class="flex flex-wrap gap-1 mt-1">' + hints.join('') + '</div>';
      }
      var isNextMeet = m._isNextMeeting;
      return '<div class="card-flat !p-3 cursor-pointer hover:shadow-md ' + (isNextMeet ? 'border-amber-200 border-dashed bg-amber-50/30' : '') + '" onclick="' + (isNextMeet ? 'closeModal();convertNextMeeting(' + m.id + ',' + m.hospital_id + ',' + JSON.stringify((m.doctors||[]).map(function(d){return d.doctor_id||d.id})).replace(/"/g, '&quot;') + ')' : 'closeModal();showMeetDetail(' + JSON.stringify(m).replace(/"/g, '&quot;') + ')') + '">' +
        (isNextMeet ? '<div class="text-[9px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-bold inline-block mb-1"><i class="fas fa-clock mr-1"></i>다음 미팅 예정 · 클릭하여 미팅 작성</div>' : '') +
        '<div class="flex items-center gap-2 mb-1 flex-wrap">' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + '<span class="font-semibold text-xs text-slate-800">' + meetDoctorNames(m) + '</span></div>' +
        '<div class="text-[11px] text-slate-400">' + (m.hospital_name || '') + (m.purpose ? ' · ' + m.purpose : '') + '</div>' +
        (m.result ? '<div class="text-[10px] text-emerald-600 mt-1"><i class="fas fa-check mr-0.5"></i>' + m.result + '</div>' : '') +
        (m.next_action ? '<div class="text-[10px] text-amber-600 mt-0.5"><i class="fas fa-arrow-right mr-0.5"></i>' + m.next_action + '</div>' : '') +
        schedInfo + '</div>';
    }).join('') + '</div>';
  } else {
    html += '<div class="text-center py-4 text-sm text-slate-400"><i class="fas fa-calendar-xmark text-xl text-slate-200 mb-2 block"></i>이 날 미팅이 없습니다</div>';
  }
  html += '<div class="mt-3 text-center"><button class="btn btn-success btn-sm" onclick="closeModal();showNewMeetGlobal()"><i class="fas fa-plus text-xs mr-1"></i>미팅 추가</button></div>';
  openModal(fmtDate(dateStr) + ' (' + dayKr + ') 일정', html);
};

// Convert a "next meeting" placeholder into a real meeting
async function convertNextMeeting(originalMeetId, hospitalId, doctorIds) {
  // Find the original meeting to get its next_meeting_date
  var meets = window._meetList || [];
  var orig = meets.find(function(m) { return m.id === originalMeetId; });
  var meetDate = orig ? orig.next_meeting_date : new Date().toISOString().split('T')[0];
  // Open a new meeting form pre-filled with this date and doctors
  showMeetFormForConvert(originalMeetId, hospitalId, doctorIds, meetDate);
}

async function showMeetFormForConvert(originalMeetId, hid, doctorIds, meetDate) {
  if (!Array.isArray(doctorIds)) doctorIds = [doctorIds];
  let docs = []; try { docs = (await API.get('/hospitals/' + hid + '/doctors')).data.data } catch (e) { }
  let usersList = []; try { usersList = (await API.get('/users')).data.data || [] } catch(e) {}
  var userCheckboxes = usersList.length ? '<div class="col-span-full"><label class="input-label"><i class="fas fa-user-tie mr-1 text-slate-400"></i>영업사원</label><div class="border border-gray-200 rounded-xl max-h-[140px] overflow-y-auto p-2 space-y-1">' + usersList.map(function(u) { var ck = (currentUser && currentUser.id === u.id) ? ' checked' : ''; return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-blue-50 cursor-pointer transition"><input type="checkbox" name="user_ids" value="' + u.id + '" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"' + ck + '><span class="text-[13px] font-medium text-slate-700">' + u.name + '</span></label>'; }).join('') + '</div></div>' : '';
  var doctorCheckboxes = docs.length ?
    '<div class="col-span-full"><label class="input-label">참석 의료진 *</label><div class="border border-gray-200 rounded-xl max-h-[180px] overflow-y-auto p-2 space-y-1">' +
    docs.map(function(d) {
      var checked = doctorIds.map(Number).includes(d.id) ? ' checked' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition"><input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"' + checked + '><div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' + (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') + '</div></label>';
    }).join('') + '</div></div>' :
    '<div class="col-span-full"><label class="input-label">의료진</label><div class="text-sm text-slate-400 p-3 bg-gray-50 rounded-lg text-center">소속 의료진이 없습니다.</div></div>';

  openModal('<i class="fas fa-exchange-alt text-brand-500 mr-2"></i>미팅 전환 (예정 → 실제 미팅)',
    '<div class="text-xs text-amber-600 bg-amber-50 rounded-lg p-3 mb-4"><i class="fas fa-info-circle mr-1"></i>예정된 미팅을 실제 미팅으로 전환합니다. 원래 미팅의 "다음 미팅 예정" 날짜가 클리어됩니다.</div>' +
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes + userCheckboxes +
    field('미팅일자 *', 'meeting_date', 'date', meetDate) +
    field('유형', 'meeting_type', 'select', 'visit', [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) +
    field('방문 시간대', 'visit_time', 'select', '', [{ v: '', l: '미지정' }, { v: 'am', l: '오전' }, { v: 'pm', l: '오후' }, { v: 'full', l: '종일' }]) +
    field('목적', 'purpose', 'text', '') +
    field('미팅 내용', 'content', 'textarea', '') + field('결과', 'result', 'textarea', '') + field('후속 액션', 'next_action', 'textarea', '') +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" class="input"></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success"><i class="fas fa-exchange-alt mr-1"></i>미팅 전환</button></div></form>', true);
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const selectedIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!selectedIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    if (!f.meeting_date) { toast('미팅일자를 입력하세요', 'warn'); return }
    const selUserIds = Array.from(document.querySelectorAll('#fm input[name="user_ids"]:checked')).map(cb => Number(cb.value));
    const payload = { ...f, doctor_ids: selectedIds, user_ids: selUserIds };
    try {
      // 1. Create new meeting
      await API.post('/meetings', payload);
      // 2. Clear original meeting's next_meeting_date
      await API.patch('/meetings/' + originalMeetId, { next_meeting_date: '' });
      toast('미팅 전환 완료');
      closeModal();
      if (curPage === 'meetings') loadMeet();
      else if (curPage === 'dashboard') loadDash();
    } catch (e) { toast('전환 실패', 'err') }
  };
}
function renderMeetUpcoming() {
  var meets = window._meetList || [];
  var todayStr = new Date().toISOString().split('T')[0];
  // Include next_meeting_date entries in upcoming
  var upcomingRaw = meets.filter(function(mt) { return mt.meeting_date >= todayStr; });
  meets.forEach(function(mt) {
    if (mt.next_meeting_date && mt.next_meeting_date >= todayStr) {
      upcomingRaw.push(Object.assign({}, mt, { _isNextMeeting: true, _originalDate: mt.meeting_date, meeting_date: mt.next_meeting_date }));
    }
  });
  var upcoming = upcomingRaw.sort(function(a, b) { return a.meeting_date.localeCompare(b.meeting_date); });
  var past = meets.filter(function(mt) { return mt.meeting_date < todayStr; }).sort(function(a, b) { return b.meeting_date.localeCompare(a.meeting_date); });
  var q = (document.getElementById('m-search')?.value || '').toLowerCase();
  var t = document.getElementById('m-type')?.value || '';
  var hid = document.getElementById('m-hospital')?.value || '';
  var filterFn = function(m) {
    if (q && !(meetDoctorNames(m)||'').toLowerCase().includes(q) && !(m.hospital_name||'').toLowerCase().includes(q) && !(m.purpose||'').toLowerCase().includes(q)) return false;
    if (t && m.meeting_type !== t) return false;
    if (hid && String(m.hospital_id) !== hid) return false;
    return true;
  };
  upcoming = upcoming.filter(filterFn);
  past = past.filter(filterFn);

  var html = '';
  // Upcoming section
  html += '<div class="card-flat p-4 lg:p-6 mb-4"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-clock text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">예정된 미팅</span><span class="ml-auto text-xs text-blue-500 font-bold">' + upcoming.length + '건</span></div>';
  if (upcoming.length) {
    // Group by date
    var grouped = {};
    upcoming.forEach(function(mt) { var d = mt.meeting_date; if (!grouped[d]) grouped[d] = []; grouped[d].push(mt); });
    Object.keys(grouped).sort().forEach(function(date) {
      var daysLeft = Math.ceil((new Date(date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
      var dayLabel = daysLeft === 0 ? '오늘' : daysLeft === 1 ? '내일' : daysLeft + '일 후';
      html += '<div class="mb-3"><div class="flex items-center gap-2 mb-2"><span class="text-xs font-bold ' + (daysLeft === 0 ? 'text-red-500' : daysLeft <= 3 ? 'text-amber-500' : 'text-blue-500') + '">' + dayLabel + '</span><span class="text-[10px] text-slate-400">' + fmtDate(date) + '</span><div class="flex-1 h-px bg-slate-100"></div></div>';
      html += '<div class="space-y-2 pl-2">' + grouped[date].map(function(mt) {
        return renderMeetCard(mt, true);
      }).join('') + '</div></div>';
    });
  } else {
    html += '<div class="text-center py-8 text-slate-300"><i class="fas fa-calendar-check text-3xl mb-2 block"></i><span class="text-sm">예정된 미팅이 없습니다</span></div>';
  }
  html += '</div>';

  // Past section
  html += '<div class="card-flat p-4 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-check-circle text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">지난 미팅</span><span class="ml-auto text-xs text-slate-400 font-medium">' + past.length + '건</span></div>';
  if (past.length) {
    html += '<div class="space-y-2">' + past.slice(0, 20).map(function(mt) { return renderMeetCard(mt, false); }).join('') + '</div>';
    if (past.length > 20) html += '<div class="text-center mt-3"><button class="btn btn-outline btn-sm" onclick="setMeetView(\'list\')">전체 보기 (' + past.length + '건)</button></div>';
  } else {
    html += '<div class="text-center py-6 text-slate-300"><i class="fas fa-calendar-xmark text-2xl mb-2 block"></i><span class="text-xs">지난 미팅이 없습니다</span></div>';
  }
  html += '</div>';

  document.getElementById('m-body').innerHTML = html;
  document.getElementById('m-count').textContent = (upcoming.length + past.length) + '건';
}

function renderMeetCard(m, isFuture) {
  var isNext = m._isNextMeeting;
  var cardClass = isNext ? 'border-amber-200 border-dashed bg-amber-50/30' : (isFuture ? 'border-blue-100 bg-blue-50/30' : 'border-slate-100 bg-white');
  var clickAction = isNext ? 'convertNextMeeting(' + m.id + ',' + m.hospital_id + ',' + JSON.stringify((m.doctors||[]).map(function(d){return d.doctor_id||d.id})).replace(/"/g, '&quot;') + ')' : 'showDayMeetsInline(\'' + m.meeting_date + '\')';
  return '<div class="flex items-center gap-3 p-3 rounded-xl border ' + cardClass + ' cursor-pointer hover:shadow-md transition-all" onclick="' + clickAction + '">' +
    '<div class="hidden sm:block flex-shrink-0">' + meetDoctorAvatars(m, 'width:36px;height:36px;border-radius:10px;font-size:13px') + '</div>' +
    '<div class="flex-1 min-w-0">' +
    '<div class="flex items-center gap-1.5 mb-0.5">' + (isNext ? '<span class="text-[8px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-bold">예정 → 전환</span>' : mtBadge(m.meeting_type)) + '<span class="font-semibold text-[13px] text-slate-800 truncate">' + meetDoctorNames(m) + '</span>' +
    (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div>' +
    '<div class="text-[11px] text-slate-400 truncate">' + (m.hospital_name || '') + (m.purpose ? ' · ' + m.purpose : '') + ' · <i class="fas fa-user-tie text-[9px]"></i> ' + (m.user_names || m.user_name || (currentUser ? currentUser.name : '')) + '</div>' +
    (m.result ? '<div class="text-[10px] text-emerald-600 mt-0.5"><i class="fas fa-check mr-0.5"></i>' + m.result + '</div>' : '') +
    (m.next_action ? '<div class="text-[10px] text-amber-600 mt-0.5"><i class="fas fa-arrow-right mr-0.5"></i>' + m.next_action + '</div>' : '') +
    '</div>' +
    '<div class="text-right flex-shrink-0"><div class="text-xs font-medium text-slate-500">' + fmtShort(m.meeting_date) + '</div><div class="text-[10px] ' + daysClass(m.meeting_date) + '">' + daysAgo(m.meeting_date) + '</div></div>' +
    (isNext ? '<div class="flex-shrink-0"><span class="text-[10px] text-amber-600 font-bold"><i class="fas fa-exchange-alt"></i></span></div>' :
    '<div class="flex flex-col gap-0.5 flex-shrink-0">' +
    '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || [m.doctor_id]).replace(/"/g, '&quot;') + ',' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button>' +
    '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();delMeetGlobal(' + m.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div>') + '</div>';
}

// --- List View ---
function renderMeetList() { renderML(window._meetList || []); }
function renderML(list) {
  var q = (document.getElementById('m-search')?.value || '').toLowerCase();
  var t = document.getElementById('m-type')?.value || '';
  var hid = document.getElementById('m-hospital')?.value || '';
  var filtered = list.filter(function(m) {
    if (q && !(meetDoctorNames(m)||'').toLowerCase().includes(q) && !(m.hospital_name||'').toLowerCase().includes(q) && !(m.purpose||'').toLowerCase().includes(q)) return false;
    if (t && m.meeting_type !== t) return false;
    if (hid && String(m.hospital_id) !== hid) return false;
    return true;
  });
  var sorted = sortList(filtered, _meetSort.key, _meetSort.dir);
  document.getElementById('m-count').textContent = sorted.length + '건';
  document.getElementById('m-body').innerHTML = '<div class="card-flat p-0 overflow-hidden">' + (sorted.length ? sorted.map(function(m) {
    return '<div class="px-4 lg:px-6 py-4 tr flex gap-3 lg:gap-4 border-b border-gray-50 last:border-0">' +
    '<div class="hidden sm:block">' + meetDoctorAvatars(m, 'width:36px;height:36px;border-radius:10px;font-size:13px') + '</div>' +
    '<div class="flex-1 min-w-0 cursor-pointer" onclick="viewMeetDoctors(' + m.id + ',' + JSON.stringify((m.doctors||[]).map(function(d){return d.doctor_id||d.id})).replace(/"/g, '&quot;') + ')">' +
    '<div class="flex items-center gap-2 mb-0.5 flex-wrap"><span class="font-semibold text-[13px] text-slate-800">' + meetDoctorNames(m) + '</span><span class="text-xs text-slate-300">' + (m.hospital_name || '') + '</span>' + mtBadge(m.meeting_type) + vtBadge(m.visit_time) + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div>' +
    (m.purpose ? '<div class="text-[13px] text-slate-600 mb-1">' + m.purpose + '</div>' : '') +
    '<div class="flex flex-wrap gap-2 mt-1">' + (m.result ? '<span class="text-[11px] text-emerald-600 bg-emerald-50 rounded-md px-2 py-0.5"><i class="fas fa-check mr-0.5"></i>' + m.result + '</span>' : '') + (m.next_action ? '<span class="text-[11px] text-amber-600 bg-amber-50 rounded-md px-2 py-0.5"><i class="fas fa-arrow-right mr-0.5"></i>' + m.next_action + '</span>' : '') + '</div></div>' +
    '<div class="flex items-center gap-2 flex-shrink-0">' +
    '<div class="text-right"><div class="text-xs font-medium text-slate-500">' + fmtShort(m.meeting_date) + '</div><div class="text-[10px] ' + daysClass(m.meeting_date) + '">' + daysAgo(m.meeting_date) + '</div></div>' +
    '<div class="flex flex-col gap-0.5">' +
    '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || [m.doctor_id]).replace(/"/g, '&quot;') + ',' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button>' +
    '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();delMeetGlobal(' + m.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div></div></div>';
  }).join('') : '<div class="empty"><div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div><p class="font-medium text-slate-500 mb-1">미팅이 없습니다</p></div>') + '</div>';
}
function filterM() {
  if (_meetViewMode === 'calendar') renderMeetCalendar();
  else if (_meetViewMode === 'upcoming') renderMeetUpcoming();
  else renderMeetList();
}
function applyMeetSort() {
  var v = (document.getElementById('m-sort')?.value || 'meeting_date-desc').split('-');
  _meetSort.key = v[0]; _meetSort.dir = v[1] || 'desc';
  filterM();
}

// ===== ACTIVITY LOG =====
async function loadActivity() {
  document.getElementById('page-title').textContent = '활동 로그';
  document.getElementById('header-actions').innerHTML = '';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="card-flat p-0">' + skeleton(8) + '</div></div>';
  try {
    const { data } = await API.get('/activity?limit=50');
    const logs = data.data;
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="card-flat p-0 overflow-hidden">' +
      (logs.length ? logs.map(l => {
        const icons = { create: 'fa-plus', update: 'fa-pen', delete: 'fa-trash' };
        const cls = { create: 'al-create', update: 'al-update', delete: 'al-delete' };
        const labels = { create: '생성', update: '수정', delete: '삭제' };
        const eLabels = { hospital: '병원', doctor: '의료진', meeting: '미팅', paper: '논문', clinic: '의원', clinic_contact: '의원관계자', clinic_visit: '의원방문' };
        return '<div class="px-4 lg:px-6 py-3.5 tr flex items-center gap-3 border-b border-gray-50 last:border-0">' +
          '<div class="al-icon ' + (cls[l.action] || 'al-update') + '"><i class="fas ' + (icons[l.action] || 'fa-circle') + '"></i></div>' +
          '<div class="flex-1 min-w-0"><div class="text-[13px] text-slate-700"><span class="font-semibold">' + (eLabels[l.entity_type] || l.entity_type) + '</span> ' + (labels[l.action] || l.action) + (l.entity_name ? ': <span class="font-medium text-slate-800">' + l.entity_name + '</span>' : '') + '</div>' +
          (l.details ? '<div class="text-[11px] text-slate-400 mt-0.5">' + l.details + '</div>' : '') + '</div>' +
          '<div class="text-xs text-slate-400 flex-shrink-0">' + new Date(l.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '</div></div>';
      }).join('') : '<div class="empty"><div class="empty-icon"><i class="fas fa-clock-rotate-left"></i></div><p class="font-medium text-slate-500 mb-1">활동 기록이 없습니다</p></div>') +
      '</div></div>';
  } catch (e) { toast('활동 로그를 불러올 수 없습니다', 'err') }
}

// ===== PHOTO =====
function triggerPhoto(did, hid) { document.getElementById('pi-' + did)?.click() }
function triggerProfilePhoto(did) { document.getElementById('pi-profile')?.click() }
async function uploadPhoto(did, hid, inp) {
  const f = inp.files?.[0]; if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast('2MB 이하 이미지만 가능합니다', 'warn'); return }
  const r = new FileReader(); r.onload = async function (e) {
    const img = new Image(); img.onload = async function () {
      const c = document.createElement('canvas'); c.width = c.height = 200;
      const ctx = c.getContext('2d'), mn = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - mn) / 2, (img.height - mn) / 2, mn, mn, 0, 0, 200, 200);
      try { await API.post('/doctors/' + did + '/photo', { photo: c.toDataURL('image/jpeg', .8) }); toast('사진 업로드 완료'); viewHosp(hid) } catch (e) { toast('업로드 실패', 'err') }
    }; img.src = e.target.result;
  }; r.readAsDataURL(f);
}
async function uploadProfilePhoto(did, inp) {
  const f = inp.files?.[0]; if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast('2MB 이하 이미지만 가능합니다', 'warn'); return }
  const r = new FileReader(); r.onload = async function (e) {
    const img = new Image(); img.onload = async function () {
      const c = document.createElement('canvas'); c.width = c.height = 200;
      const ctx = c.getContext('2d'), mn = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - mn) / 2, (img.height - mn) / 2, mn, mn, 0, 0, 200, 200);
      try { await API.post('/doctors/' + did + '/photo', { photo: c.toDataURL('image/jpeg', .8) }); toast('사진 업로드 완료'); viewDocProfile(did) } catch (e) { toast('업로드 실패', 'err') }
    }; img.src = e.target.result;
  }; r.readAsDataURL(f);
}
async function delProfilePhoto(did) {
  showConfirm('사진 삭제', '프로필 사진을 삭제하시겠습니까?', async () => {
    try { await API.delete('/doctors/' + did + '/photo'); toast('사진이 삭제되었습니다'); viewDocProfile(did) } catch (e) { toast('삭제 실패', 'err') }
  });
}

// ===== Known Korean Hospitals (instant autocomplete) =====
var KNOWN_HOSPITALS = [
  { name: '서울대학교병원', region: '서울', address: '서울 종로구 대학로 101' },
  { name: '분당서울대학교병원', region: '경기', address: '경기 성남시 분당구 구미로 173번길 82' },
  { name: '삼성서울병원', region: '서울', address: '서울 강남구 일원로 81' },
  { name: '서울아산병원', region: '서울', address: '서울 송파구 올림픽로43길 88' },
  { name: '세브란스병원', region: '서울', address: '서울 서대문구 연세로 50-1' },
  { name: '강남세브란스병원', region: '서울', address: '서울 강남구 언주로 211' },
  { name: '서울성모병원', region: '서울', address: '서울 서초구 반포대로 222' },
  { name: '여의도성모병원', region: '서울', address: '서울 영등포구 63로 10' },
  { name: '은평성모병원', region: '서울', address: '서울 은평구 통일로 1021' },
  { name: '의정부성모병원', region: '경기', address: '경기 의정부시 천보로 271' },
  { name: '인천성모병원', region: '인천', address: '인천 부평구 동수로 56' },
  { name: '부천성모병원', region: '경기', address: '경기 부천시 원미구 소사로 327' },
  { name: '고려대학교안암병원', region: '서울', address: '서울 성북구 고려대로 73' },
  { name: '고려대구로병원', region: '서울', address: '서울 구로구 구로동로 148' },
  { name: '한양대학교병원', region: '서울', address: '서울 성동구 왕십리로 222-1' },
  { name: '한양대학교구리병원', region: '경기', address: '경기 구리시 경춘로 153' },
  { name: '중앙대학교병원', region: '서울', address: '서울 동작구 흑석로 102' },
  { name: '건국대학교병원', region: '서울', address: '서울 광진구 능동로 120-1' },
  { name: '경희대학교병원', region: '서울', address: '서울 동대문구 경희대로 23' },
  { name: '순천향대학교서울병원', region: '서울', address: '서울 용산구 대사관로 59' },
  { name: '순천향대학교부천병원', region: '경기', address: '경기 부천시 원미구 조마루로 170' },
  { name: '아주대학교병원', region: '경기', address: '경기 수원시 영통구 월드컵로 164' },
  { name: '인하대학교병원', region: '인천', address: '인천 중구 인항로 27' },
  { name: '부산대학교병원', region: '부산', address: '부산 서구 구덕로 179' },
  { name: '양산부산대학교병원', region: '경남', address: '경남 양산시 물금읍 금오로 20' },
  { name: '경북대학교병원', region: '대구', address: '대구 중구 동덕로 130' },
  { name: '칠곡경북대학교병원', region: '대구', address: '대구 북구 호국로 807' },
  { name: '전남대학교병원', region: '광주', address: '광주 동구 제봉로 42' },
  { name: '충남대학교병원', region: '대전', address: '대전 중구 문화로 282' },
  { name: '세종충남대학교병원', region: '세종', address: '세종특별자치시 보듬7로 20' },
  { name: '충북대학교병원', region: '충북', address: '충북 청주시 서원구 1순환로 776' },
  { name: '전북대학교병원', region: '전북', address: '전북 전주시 덕진구 건지로 20' },
  { name: '동아대학교병원', region: '부산', address: '부산 서구 대신공원로 26' },
  { name: '원광대학교병원', region: '전북', address: '전북 익산시 무왕로 895' },
  { name: '단국대학교병원', region: '충남', address: '충남 천안시 동남구 망향로 201' },
  { name: '이화여자대학교목동병원', region: '서울', address: '서울 양천구 안양천로 1071' },
  { name: '이화여자대학교서울병원', region: '서울', address: '서울 강서구 공항대로 260' },
  { name: '국민건강보험일산병원', region: '경기', address: '경기 고양시 일산동구 일산로 100' },
  { name: '서울특별시보라매병원', region: '서울', address: '서울 동작구 보라매로5길 20' },
  { name: '분당차병원', region: '경기', address: '경기 성남시 분당구 야탑로 59' },
  { name: '강동경희대학교병원', region: '서울', address: '서울 강동구 동남로 892' },
  { name: '제주대학교병원', region: '제주', address: '제주 제주시 아란13길 15' },
  // 의원 (clinics merged into hospitals)
  { name: '소리의원 면목점', region: '서울', address: '서울 중랑구 면목로 340', type: 'clinic' },
  { name: '소리의원 강남점', region: '서울', address: '서울 강남구 강남대로', type: 'clinic' },
  { name: '소리의원 부산점', region: '부산', address: '부산 해운대구', type: 'clinic' },
  { name: '소리의원 대구점', region: '대구', address: '대구 중구', type: 'clinic' },
  { name: '바른이비인후과', region: '서울', address: '서울 송파구', type: 'clinic' },
  { name: '참이비인후과', region: '서울', address: '서울 강서구', type: 'clinic' },
  { name: '맑은소리이비인후과', region: '경기', address: '경기 성남시', type: 'clinic' },
  { name: '히어링플러스 보청기', region: '서울', address: '서울 종로구', type: 'clinic' },
  { name: '스타키보청기 강남센터', region: '서울', address: '서울 강남구', type: 'clinic' },
  { name: '포낙보청기 서울센터', region: '서울', address: '서울 서초구', type: 'clinic' },
];

// ===== FORMS =====
function priorityStars(p) {
  const n = parseInt(p) || 3;
  let s = '';
  for (let i = 1; i <= 5; i++) s += '<i class="fas fa-star text-[10px] ' + (i <= n ? 'text-amber-400' : 'text-gray-200') + '"></i>';
  return '<span class="inline-flex gap-0.5">' + s + '</span>';
}
function todocBadge(t) {
  if (t === 'O') return '<span class="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">O 접점</span>';
  if (t === '△' || t === 'triangle') return '<span class="text-[11px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">△ 일부</span>';
  return '<span class="text-[11px] font-bold text-slate-400 bg-gray-50 px-2 py-0.5 rounded-full">X 미접점</span>';
}
function clinicMetric(icon, label, val, color) {
  return '<div class="flex-1 bg-slate-50 rounded-xl p-2.5 text-center"><p class="text-[10px] text-slate-400 mb-0.5"><i class="fas ' + icon + ' mr-0.5"></i>' + label + '</p><p class="text-sm font-bold ' + (color || 'text-slate-600') + '">' + (val || 0) + '</p></div>';
}
function pipelineStageButtons(h) {
  var stages = [
    { key: 'contact', label: '접촉', icon: 'fa-handshake-angle', color: 'slate' },
    { key: 'meeting', label: '미팅', icon: 'fa-calendar-check', color: 'blue' },
    { key: 'demo', label: '데모', icon: 'fa-laptop', color: 'violet' },
    { key: 'proposal', label: '제안', icon: 'fa-file-contract', color: 'amber' },
    { key: 'contract', label: '계약', icon: 'fa-file-signature', color: 'emerald' },
    { key: 'active_customer', label: '거래처', icon: 'fa-building-circle-check', color: 'brand' }
  ];
  var current = h.pipeline_stage || 'contact';
  return stages.map(function(s) {
    var isActive = s.key === current;
    return '<button class="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition ' +
      (isActive ? 'bg-' + s.color + '-100 text-' + s.color + '-700 ring-1 ring-' + s.color + '-300' : 'text-slate-400 hover:bg-gray-100') + '" ' +
      'onclick="event.stopPropagation();updatePipelineStage(' + h.id + ',\'' + s.key + '\')">' +
      '<i class="fas ' + s.icon + '"></i>' + s.label + '</button>';
  }).join('<i class="fas fa-chevron-right text-[8px] text-slate-200 flex-shrink-0"></i>');
}
async function updatePipelineStage(hid, stage) {
  try {
    await API.put('/pipeline/' + hid, { pipeline_stage: stage });
    toast('파이프라인 단계 변경됨');
    viewHosp(hid);
  } catch(e) { toast('변경 실패', 'err'); }
}

async function showHospForm(id) {
  let h = { name: '', region: '', address: '', phone: '', notes: '', status: 'active', type: 'hospital', priority: '3', todoc_contact: 'X', patient_count: 0, hearing_aid_sales: 0, ci_referrals: 0, pipeline_stage: 'contact' };
  if (id) { try { h = (await API.get('/hospitals/' + id)).data.data } catch (e) { } }
  openModal(id ? '기관 정보 수정' : '새 기관 추가',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
    field('유형', 'type', 'select', h.type || 'hospital', [{ v: 'hospital', l: '병원' }, { v: 'clinic', l: '의원' }]) +
    '<div class="relative col-span-full sm:col-span-1"><label class="input-label">이름 *</label><input type="text" name="name" value="' + (h.name || '') + '" class="input" placeholder="기관명을 입력하세요" autocomplete="off"><div id="hosp-suggest" class="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 hidden max-h-60 overflow-y-auto"></div></div>' +
    field('지역', 'region', 'select', h.region || '', [
      { v: '', l: '선택하세요' },
      { v: '서울', l: '서울특별시' },
      { v: '부산', l: '부산광역시' },
      { v: '대구', l: '대구광역시' },
      { v: '인천', l: '인천광역시' },
      { v: '광주', l: '광주광역시' },
      { v: '대전', l: '대전광역시' },
      { v: '울산', l: '울산광역시' },
      { v: '세종', l: '세종특별자치시' },
      { v: '경기', l: '경기도' },
      { v: '강원', l: '강원특별자치도' },
      { v: '충북', l: '충청북도' },
      { v: '충남', l: '충청남도' },
      { v: '전북', l: '전북특별자치도' },
      { v: '전남', l: '전라남도' },
      { v: '경북', l: '경상북도' },
      { v: '경남', l: '경상남도' },
      { v: '제주', l: '제주특별자치도' }
    ]) + field('주소', 'address', 'text', h.address) + field('전화번호', 'phone', 'tel', h.phone) +

    field('병원코드', 'status', 'select', h.status, [{ v: 'active', l: '등록완료' }, { v: 'inactive', l: '미등록' }]) +

    field('토닥접점', 'todoc_contact', 'select', h.todoc_contact || 'X', [{ v: 'O', l: 'O (접점)' }, { v: '△', l: '△ (일부)' }, { v: 'X', l: 'X (미접점)' }]) +
    field('파이프라인', 'pipeline_stage', 'select', h.pipeline_stage || 'contact', [{ v: 'contact', l: '첫 접촉' }, { v: 'meeting', l: '미팅 진행' }, { v: 'demo', l: '데모/시연' }, { v: 'proposal', l: '제안/협의' }, { v: 'contract', l: '계약' }, { v: 'active_customer', l: '활성 거래처' }]) +
    '<div><label class="input-label">난청 환자수</label><input type="number" name="patient_count" value="' + (h.patient_count || 0) + '" class="input" min="0"></div>' +
    '<div><label class="input-label">보청기 판매량</label><input type="number" name="hearing_aid_sales" value="' + (h.hearing_aid_sales || 0) + '" class="input" min="0"></div>' +
    '<div><label class="input-label">CI 의뢰 실적</label><input type="number" name="ci_referrals" value="' + (h.ci_referrals || 0) + '" class="input" min="0"></div>' +
    field('메모', 'notes', 'textarea', h.notes) +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">' + (id ? '저장' : '추가') + '</button></div></form>');
  // Hospital name autocomplete — instant local + async AI supplement
  var hospSuggestTimer = null;
  var nameInput = document.querySelector('#fm input[name="name"]');
  if (nameInput && !id) {
    nameInput.addEventListener('input', function() {
      clearTimeout(hospSuggestTimer);
      var q = this.value.trim();
      var dd = document.getElementById('hosp-suggest');
      if (q.length < 1) { dd.classList.add('hidden'); return; }

      // Step 1: Instantly show matches from local known list
      var ql = q.toLowerCase();
      var localMatches = KNOWN_HOSPITALS.filter(function(h) {
        return h.name.toLowerCase().includes(ql) || h.region.toLowerCase().includes(ql);
      }).slice(0, 8);

      function renderSuggestList(list, isAI) {
        if (!list.length) { dd.classList.add('hidden'); return; }
        dd.innerHTML = list.map(function(h) {
          return '<div class="px-4 py-2.5 hover:bg-brand-50 cursor-pointer flex items-center gap-3 text-sm transition" data-name="' + h.name + '" data-region="' + h.region + '" data-address="' + (h.address || '') + '" data-type="' + (h.type || 'hospital') + '">' +
            '<i class="fas fa-hospital text-brand-400 text-xs"></i>' +
            '<div class="flex-1 min-w-0"><div class="font-medium text-slate-700 truncate">' + h.name + '</div>' +
            (h.region ? '<div class="text-[11px] text-slate-400">' + h.region + (h.address ? ' · ' + h.address : '') + '</div>' : '') +
            '</div></div>';
        }).join('') + (isAI ? '' : '<div class="px-4 py-2 text-[10px] text-slate-300 border-t border-gray-50"><i class="fas fa-spinner fa-spin mr-1"></i>AI에서 추가 병원 검색 중...</div>');
        dd.classList.remove('hidden');
        dd.querySelectorAll('[data-name]').forEach(function(el) {
          el.onclick = function() {
            document.querySelector('#fm input[name="name"]').value = this.dataset.name;
            var regionInput = document.querySelector('#fm select[name="region"]') || document.querySelector('#fm input[name="region"]');
            var addrInput = document.querySelector('#fm input[name="address"]');
            if (regionInput && this.dataset.region) {
              // Map known region label to select option value (광역시/도 → 단축명)
              var rg = this.dataset.region;
              var regionMap = {
                '서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천',
                '광주광역시':'광주','대전광역시':'대전','울산광역시':'울산','세종특별자치시':'세종',
                '경기도':'경기','강원특별자치도':'강원','강원도':'강원','충청북도':'충북','충청남도':'충남',
                '전북특별자치도':'전북','전라북도':'전북','전라남도':'전남','경상북도':'경북',
                '경상남도':'경남','제주특별자치도':'제주','제주도':'제주'
              };
              regionInput.value = regionMap[rg] || rg;
            }
            if (addrInput && this.dataset.address) addrInput.value = this.dataset.address;
            // Auto-set type and toggle clinic fields
            var typeSelect = document.querySelector('#fm select[name="type"]');
            if (typeSelect && this.dataset.type) {
              typeSelect.value = this.dataset.type;
              typeSelect.dispatchEvent(new Event('change'));
            }
            dd.classList.add('hidden');
          };
        });
      }

      if (localMatches.length) {
        renderSuggestList(localMatches, true);
      } else {
        dd.classList.add('hidden');
      }
    });
    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('hosp-suggest');
      if (dd && !dd.contains(e.target) && e.target !== nameInput) dd.classList.add('hidden');
    });
  }
  document.getElementById('fm').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.name) { toast('이름을 입력하세요', 'warn'); return } try { if (id) { await API.put('/hospitals/' + id, f); toast('정보 수정됨') } else { await API.post('/hospitals', f); toast('새 항목 추가됨') } closeModal(); if (id) viewHosp(id); else loadHosp() } catch (e) { toast('저장 실패', 'err') } };
  setTimeout(() => document.querySelector('#fm input[name="name"]')?.focus(), 100);
}
async function editRoomInfo(hospId) {
  let h = {};
  try { h = (await API.get('/hospitals/' + hospId)).data.data || {} } catch(e) {}
  var aud = h.audiology_room ? (typeof h.audiology_room === 'string' ? (function(){ try { return JSON.parse(h.audiology_room) } catch(e) { return {} } })() : h.audiology_room) : {};
  var mp = h.mapping_room ? (typeof h.mapping_room === 'string' ? (function(){ try { return JSON.parse(h.mapping_room) } catch(e) { return {} } })() : h.mapping_room) : {};
  if (!aud) aud = {};
  if (!mp) mp = {};
  openModal('청각실 / 매핑실 정보 편집',
    '<form id="fm" class="space-y-6">' +
    '<div class="bg-cyan-50/50 rounded-xl p-4 border border-cyan-100">' +
    '<div class="flex items-center gap-2 mb-3"><i class="fas fa-headphones text-cyan-500"></i><span class="font-bold text-[14px] text-slate-700">청각실 (청력검사실)</span></div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
    '<div><label class="input-label">유무</label><select name="aud_exists" class="input"><option value="true"' + (aud.exists ? ' selected' : '') + '>있음</option><option value="false"' + (!aud.exists ? ' selected' : '') + '>없음</option></select></div>' +
    '<div><label class="input-label">위치</label><input type="text" name="aud_location" value="' + (aud.location || '') + '" class="input" placeholder="예: 본관 3층"></div>' +
    '<div><label class="input-label">인원 수</label><input type="number" name="aud_staff_count" value="' + (aud.staff_count || '') + '" class="input" min="0" placeholder="예: 2"></div>' +
    '<div><label class="input-label">미팅 유형</label><input type="text" name="aud_meeting_type" value="' + (aud.meeting_type || '') + '" class="input" placeholder="예: 장비설명회, 데모"></div>' +
    '<div class="col-span-full"><label class="input-label">메모</label><textarea name="aud_notes" class="input" rows="2" placeholder="청각실 관련 메모">' + (aud.notes || '') + '</textarea></div>' +
    '</div></div>' +
    '<div class="bg-violet-50/50 rounded-xl p-4 border border-violet-100">' +
    '<div class="flex items-center gap-2 mb-3"><i class="fas fa-microchip text-violet-500"></i><span class="font-bold text-[14px] text-slate-700">매핑실</span></div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
    '<div><label class="input-label">유무</label><select name="mp_exists" class="input"><option value="true"' + (mp.exists ? ' selected' : '') + '>있음</option><option value="false"' + (!mp.exists ? ' selected' : '') + '>없음</option></select></div>' +
    '<div><label class="input-label">위치</label><input type="text" name="mp_location" value="' + (mp.location || '') + '" class="input" placeholder="예: 별관 2층"></div>' +
    '<div><label class="input-label">인원 수</label><input type="number" name="mp_staff_count" value="' + (mp.staff_count || '') + '" class="input" min="0" placeholder="예: 1"></div>' +
    '<div><label class="input-label">미팅 유형</label><input type="text" name="mp_meeting_type" value="' + (mp.meeting_type || '') + '" class="input" placeholder="예: CI 매핑교육, 프로그래밍"></div>' +
    '<div class="col-span-full"><label class="input-label">메모</label><textarea name="mp_notes" class="input" rows="2" placeholder="매핑실 관련 메모">' + (mp.notes || '') + '</textarea></div>' +
    '</div></div>' +
    '<div class="flex justify-end gap-2 pt-3 border-t border-gray-50"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">저장</button></div></form>', true);
  document.getElementById('fm').onsubmit = async function(e) {
    e.preventDefault();
    var f = new FormData(e.target);
    var audData = JSON.stringify({ exists: f.get('aud_exists') === 'true', location: f.get('aud_location') || '', staff_count: parseInt(f.get('aud_staff_count')) || 0, meeting_type: f.get('aud_meeting_type') || '', notes: f.get('aud_notes') || '' });
    var mpData = JSON.stringify({ exists: f.get('mp_exists') === 'true', location: f.get('mp_location') || '', staff_count: parseInt(f.get('mp_staff_count')) || 0, meeting_type: f.get('mp_meeting_type') || '', notes: f.get('mp_notes') || '' });
    try {
      await API.put('/hospitals/' + hospId, Object.assign({}, h, { audiology_room: audData, mapping_room: mpData }));
      toast('청각실/매핑실 정보가 저장되었습니다');
      closeModal();
      viewHosp(hospId);
    } catch(err) { toast('저장 실패', 'err'); }
  };
}
async function showDocForm(hid, did) {
  let d = { name: '', department: '이비인후과', position: '', phone: '', email: '', specialty: '', influence_level: 'medium', notes: '', hospital_id: hid, bio: '', education: '', career: '', clinic_hours: '', profile_url: '' };
  let hospName = '';
  if (did) { try { const dr = (await API.get('/doctors/' + did)).data.data; if (dr) { d = dr; hospName = dr.hospital_name || '' } } catch (e) { } }
  if (!hospName) { try { const hr = (await API.get('/hospitals/' + hid)).data.data; hospName = hr.name || '' } catch(e) {} }
  openModal(did ? '의료진 수정' : '새 의료진 추가',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' + field('이름 *', 'name', 'text', d.name) + field('진료과', 'department', 'text', d.department) + field('직위', 'position', 'text', d.position) + field('전화번호', 'phone', 'tel', d.phone) + field('이메일', 'email', 'email', d.email) + field('전문분야', 'specialty', 'text', d.specialty) +
    '<div class="col-span-full"><label class="input-label"><i class="fas fa-link text-slate-300 mr-1"></i>병원 프로필 URL <span class="text-[10px] text-slate-400 font-normal">(병원 홈페이지 의료진 소개 등)</span></label><div class="relative"><i class="fas fa-globe absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input type="text" name="profile_url" value="' + (d.profile_url || '') + '" class="input pl-9 w-full" placeholder="https://hospital.or.kr/doctor/..."></div></div>' +
    '<div class="col-span-full"><label class="input-label"><i class="fas fa-clock text-slate-300 mr-1"></i>외래 시간 <span class="text-[10px] text-slate-400 font-normal">(방문 일정 참고)</span></label>' + clinicHoursEditor(d.clinic_hours) + '</div>' +
    field('소개', 'bio', 'textarea', d.bio || '') + field('학력', 'education', 'textarea', (d.education || '').replace(/\\n/g, '\n')) + field('경력', 'career', 'textarea', (d.career || '').replace(/\\n/g, '\n')) + field('영업 메모', 'notes', 'textarea', d.notes) +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">' + (did ? '저장' : '추가') + '</button></div></form>', true);
  window._docFormHospName = hospName;
  document.getElementById('fm').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.name) { toast('이름을 입력하세요', 'warn'); return } f.clinic_hours = collectClinicHours(); try { if (did) { await API.put('/doctors/' + did, f); toast('의료진 정보 수정됨') } else { await API.post('/doctors', f); toast('새 의료진 추가됨') } closeModal(); if (window._docProfile && window._docProfile.id === did) viewDocProfile(did); else viewHosp(hid) } catch (e) { toast('저장 실패', 'err') } };
  setTimeout(() => document.querySelector('#fm input[name="name"]')?.focus(), 100);
}

async function showMeetForm(hid, did, mid) {
  let m = { meeting_date: new Date().toISOString().split('T')[0], meeting_type: 'visit', visit_time: '', purpose: '', content: '', result: '', next_action: '', next_meeting_date: '', doctor_ids: did ? [did] : [], hospital_id: hid };
  if (mid) { try { const ms = (await API.get('/meetings?hospital_id=' + hid)).data; const found = ms.data.find(x => x.id === mid); if (found) { m = found; m.doctor_ids = (found.doctors || []).map(function(d) { return d.id || d.doctor_id }) || [found.doctor_id]; } } catch (e) { } }
  let docs = []; try { docs = (await API.get('/hospitals/' + hid + '/doctors')).data.data } catch (e) { }
  window._meetFormDocs = docs; // Store for schedule preview
  
  // Build multi-select checkbox list with clinic hours info
  var doctorCheckboxes = docs.length ? 
    '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
    '<div class="border border-gray-200 rounded-xl max-h-[200px] overflow-y-auto p-2 space-y-1">' +
    docs.map(function(d) {
      var checked = (m.doctor_ids || []).map(Number).includes(d.id) ? ' checked' : '';
      var hasHours = d.clinic_hours ? ' data-hours="' + d.clinic_hours.replace(/"/g, '&quot;') + '"' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition">' +
        '<input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer meet-doc-cb"' + checked + hasHours + ' onchange="updateMeetSchedulePreview()">' +
        '<div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' +
        (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') +
        (d.clinic_hours ? '<span class="text-[9px] text-cyan-500 ml-1"><i class="fas fa-calendar-days"></i></span>' : '') +
        '</div></label>';
    }).join('') + '</div></div>' :
    '<div class="col-span-full"><label class="input-label">의료진</label><div class="text-sm text-slate-400 p-3 bg-gray-50 rounded-lg text-center">소속 의료진이 없습니다. 먼저 의료진을 추가하세요.</div></div>';
  
  openModal(mid ? '미팅 수정' : '새 미팅',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    // Schedule preview panel
    '<div class="col-span-full" id="meet-sched-preview"></div>' +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date) +
    field('유형', 'meeting_type', 'select', m.meeting_type, [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) +
    field('방문 시간대', 'visit_time', 'select', m.visit_time || '', [{ v: '', l: '미지정' }, { v: 'am', l: '오전' }, { v: 'pm', l: '오후' }, { v: 'full', l: '종일' }]) +
    '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>시작 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="start_time" class="input" step="1800" value="' + (m.start_time || '') + '"></div>' +
    '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>종료 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="end_time" class="input" step="1800" value="' + (m.end_time || '') + '"></div>' +
    field('목적', 'purpose', 'text', m.purpose) +
    field('미팅 내용', 'content', 'textarea', m.content) + field('결과', 'result', 'textarea', m.result) + field('후속 액션', 'next_action', 'textarea', m.next_action) +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    // 동반 반출 제품 선택 (Q4 자동 연계)
    '<div class="col-span-full" id="meet-products-panel"><label class="input-label"><i class="fas fa-box-archive mr-1 text-slate-400"></i>동반 반출 제품 <span class="text-[10px] text-slate-400 font-normal">(선택 사항 — 미팅 시 사용한 데모기 자동 기록)</span></label><div id="meet-products-list" class="border border-gray-200 rounded-xl p-2 text-xs text-slate-400 text-center">로딩 중...</div></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">' + (mid ? '저장' : '추가') + '</button></div></form>');
  // Bind date change to update schedule preview
  var dateInput = document.querySelector('#fm input[name="meeting_date"]');
  if (dateInput) dateInput.addEventListener('change', updateMeetSchedulePreview);
  // Load available product units for selection
  loadMeetProductPicker(mid);
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const doctorIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const payload = { ...f, doctor_ids: doctorIds, hospital_id: hid };
    delete payload.doctor_ids_single;
    // Collect selected product units + sets for auto-link
    var prodPicks = collectMeetProductPicks('#fm');
    delete payload.meet_product_action;
    delete payload.meet_product_is_loan;
    try {
      let savedMid;
      if (mid) { await API.put('/meetings/' + mid, payload); savedMid = mid; toast('미팅 수정됨') }
      else { const res = await API.post('/meetings', payload); savedMid = res.data && res.data.data && res.data.data.id; toast('미팅 등록됨') }
      // Auto-link selected product units + sets to meeting
      if (savedMid) { await linkMeetProductPicks(savedMid, prodPicks); }
      closeModal(); viewHosp(hid);
    } catch (e) { toast('저장 실패', 'err') }
  };
  // Insert template selector for new meetings
  if (!mid) { setTimeout(function() { var fm = document.getElementById('fm'); if (fm) insertTemplateSelector(fm); }, 100); }
  // Initial schedule preview
  setTimeout(updateMeetSchedulePreview, 50);
}
// Real-time schedule preview for meeting form
function updateMeetSchedulePreview() {
  var previewEl = document.getElementById('meet-sched-preview');
  if (!previewEl) return;
  var dateInput = document.querySelector('#fm input[name="meeting_date"]');
  var dateVal = dateInput ? dateInput.value : '';
  var checkedBoxes = document.querySelectorAll('#fm input.meet-doc-cb:checked');
  var docs = window._meetFormDocs || [];
  if (!dateVal || !checkedBoxes.length) { previewEl.innerHTML = ''; return; }
  var meetDay = new Date(dateVal + 'T00:00:00');
  var dayIdx = (meetDay.getDay() + 6) % 7; // 0=Mon...5=Sat
  var dayKr = DAYS_KR[dayIdx] || '';
  var dayKey = dayIdx >= 0 && dayIdx < 6 ? DAYS_KEY[dayIdx] : '';
  if (!dayKey) { previewEl.innerHTML = ''; return; }
  var items = [];
  checkedBoxes.forEach(function(cb) {
    var doc = docs.find(function(d) { return d.id === Number(cb.value); });
    if (!doc || !doc.clinic_hours) return;
    var ch = parseClinicHours(doc.clinic_hours);
    if (ch.mon && !ch.mon_am && typeof ch.mon === 'string') {
      var mig = {}; DAYS_KEY.forEach(function(k) { if (ch[k]) mig[k + '_am'] = ch[k]; }); mig.notes = ch.notes || ''; ch = mig;
    }
    var am = ch[dayKey + '_am'] || '', pm = ch[dayKey + '_pm'] || '';
    if (!am && !pm) return;
    var isAllOff = (am === '휴진' && pm === '휴진') || (am === '휴진' && !pm) || (!am && pm === '휴진');
    items.push({ name: doc.name, position: doc.position || '', am: am, pm: pm, isOff: isAllOff, notes: ch.notes || '' });
  });
  if (!items.length) { previewEl.innerHTML = ''; return; }
  var slotStyle = function(v) {
    if (!v) return 'bg-gray-50 text-gray-300';
    if (v === '진료') return 'bg-cyan-500 text-white';
    if (v === '수술') return 'bg-rose-500 text-white';
    if (v === '휴진') return 'bg-gray-200 text-gray-400 line-through';
    if (v === '순환진료') return 'bg-amber-400 text-white';
    return 'bg-blue-400 text-white';
  };
  var hasWarning = items.some(function(it) { return it.isOff; });
  var html = '<div class="border rounded-xl overflow-hidden ' + (hasWarning ? 'border-amber-300 bg-amber-50/30' : 'border-cyan-200 bg-cyan-50/30') + '">' +
    '<div class="flex items-center gap-2 px-3 py-2 ' + (hasWarning ? 'bg-amber-50' : 'bg-cyan-50') + ' border-b ' + (hasWarning ? 'border-amber-200' : 'border-cyan-100') + '">' +
    '<i class="fas fa-calendar-clock text-xs ' + (hasWarning ? 'text-amber-500' : 'text-cyan-500') + '"></i>' +
    '<span class="text-[11px] font-bold ' + (hasWarning ? 'text-amber-700' : 'text-cyan-700') + '">' + fmtDate(dateVal) + ' (' + dayKr + ') 의료진 외래 스케줄</span>' +
    (hasWarning ? '<span class="text-[10px] text-amber-600 font-medium ml-auto"><i class="fas fa-exclamation-triangle mr-0.5"></i>휴진 의료진 있음</span>' : '<span class="text-[10px] text-cyan-500 ml-auto">방문 시간 참고</span>') +
    '</div>' +
    '<div class="p-2 space-y-1">' +
    items.map(function(it) {
      return '<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg ' + (it.isOff ? 'bg-red-50/70' : 'bg-white') + '">' +
        '<span class="text-[12px] font-bold ' + (it.isOff ? 'text-red-400' : 'text-slate-700') + ' w-16 flex-shrink-0 truncate">' + it.name + '</span>' +
        '<span class="text-[10px] text-slate-400 w-10 flex-shrink-0 truncate">' + it.position + '</span>' +
        '<div class="flex gap-1 flex-1">' +
        '<div class="flex-1 text-center rounded py-1 text-[10px] font-bold ' + slotStyle(it.am) + '">' + (it.am ? (it.am === '진료' ? '<i class="fas fa-stethoscope text-[8px] mr-0.5"></i>' : '') + '오전 ' + it.am : '<span class="opacity-40">오전 -</span>') + '</div>' +
        '<div class="flex-1 text-center rounded py-1 text-[10px] font-bold ' + slotStyle(it.pm) + '">' + (it.pm ? (it.pm === '수술' ? '<i class="fas fa-scissors text-[8px] mr-0.5"></i>' : '') + '오후 ' + it.pm : '<span class="opacity-40">오후 -</span>') + '</div>' +
        '</div>' +
        (it.isOff ? '<i class="fas fa-ban text-red-400 text-xs flex-shrink-0"></i>' : it.am === '진료' || it.pm === '진료' ? '<i class="fas fa-check-circle text-emerald-500 text-xs flex-shrink-0"></i>' : '<i class="fas fa-circle text-[8px] text-slate-300 flex-shrink-0"></i>') +
        '</div>';
    }).join('') +
    '</div>' +
    // Best time recommendation
    (function() {
      var amDocs = items.filter(function(it) { return it.am === '진료' && !it.isOff; });
      var pmDocs = items.filter(function(it) { return it.pm === '진료' && !it.isOff; });
      if (!amDocs.length && !pmDocs.length) return '';
      var rec = '';
      if (amDocs.length >= pmDocs.length && amDocs.length > 0) rec = '<i class="fas fa-lightbulb text-amber-400 mr-1"></i><strong>추천:</strong> 오전 방문 — ' + amDocs.map(function(d){return d.name;}).join(', ') + ' 진료 중';
      else if (pmDocs.length > 0) rec = '<i class="fas fa-lightbulb text-amber-400 mr-1"></i><strong>추천:</strong> 오후 방문 — ' + pmDocs.map(function(d){return d.name;}).join(', ') + ' 진료 중';
      return rec ? '<div class="px-3 py-2 text-[11px] text-slate-600 bg-gradient-to-r from-amber-50 to-transparent border-t ' + (hasWarning ? 'border-amber-200' : 'border-cyan-100') + '">' + rec + '</div>' : '';
    })() +
    '</div>';
  previewEl.innerHTML = html;
}
async function showMeetFormFromProfile(hid, did, mid) {
  let m = { meeting_date: new Date().toISOString().split('T')[0], meeting_type: 'visit', visit_time: '', purpose: '', content: '', result: '', next_action: '', next_meeting_date: '', doctor_ids: [did], hospital_id: hid };
  if (mid) { try { const ms = (await API.get('/meetings?doctor_id=' + did)).data; const found = ms.data.find(x => x.id === mid); if (found) { m = found; m.doctor_ids = (found.doctors || []).map(function(d) { return d.id || d.doctor_id }) || [found.doctor_id]; } } catch (e) { } }
  let docs = []; try { docs = (await API.get('/hospitals/' + hid + '/doctors')).data.data } catch (e) { }
  window._meetFormDocs = docs;
  
  var doctorCheckboxes = docs.length ?
    '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
    '<div class="border border-gray-200 rounded-xl max-h-[200px] overflow-y-auto p-2 space-y-1">' +
    docs.map(function(d) {
      var checked = (m.doctor_ids || []).map(Number).includes(d.id) ? ' checked' : '';
      var hasHours = d.clinic_hours ? ' data-hours="' + d.clinic_hours.replace(/"/g, '&quot;') + '"' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition">' +
        '<input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer meet-doc-cb"' + checked + hasHours + ' onchange="updateMeetSchedulePreview()">' +
        '<div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' +
        (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') +
        (d.clinic_hours ? '<span class="text-[9px] text-cyan-500 ml-1"><i class="fas fa-calendar-days"></i></span>' : '') +
        '</div></label>';
    }).join('') + '</div></div>' :
    '<div class="col-span-full"><label class="input-label">의료진</label><div class="text-sm text-slate-400 p-3 bg-gray-50 rounded-lg text-center">소속 의료진이 없습니다.</div></div>';
  
  openModal(mid ? '미팅 수정' : '새 미팅',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    '<div class="col-span-full" id="meet-sched-preview"></div>' +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date) +
    field('유형', 'meeting_type', 'select', m.meeting_type, [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) +
    field('방문 시간대', 'visit_time', 'select', m.visit_time || '', [{ v: '', l: '미지정' }, { v: 'am', l: '오전' }, { v: 'pm', l: '오후' }, { v: 'full', l: '종일' }]) +
    '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>시작 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="start_time" class="input" step="1800" value="' + (m.start_time || '') + '"></div>' +
    '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>종료 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="end_time" class="input" step="1800" value="' + (m.end_time || '') + '"></div>' +
    field('목적', 'purpose', 'text', m.purpose) +
    field('미팅 내용', 'content', 'textarea', m.content) + field('결과', 'result', 'textarea', m.result) + field('후속 액션', 'next_action', 'textarea', m.next_action) +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    // 동행 제품 선택 패널 (의료진 프로필 미팅 폼)
    '<div class="col-span-full" id="meet-products-panel"><label class="input-label"><i class="fas fa-box-archive mr-1 text-slate-400"></i>동행 반출 제품 <span class="text-[10px] text-slate-400 font-normal">(선택 사항 — 내부기/외부기/휴대보관함 단일 또는 복수)</span></label><div id="meet-products-list" class="border border-gray-200 rounded-xl p-2 text-xs text-slate-400 text-center">로딩 중...</div></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">' + (mid ? '저장' : '추가') + '</button></div></form>');
  var dateInput = document.querySelector('#fm input[name="meeting_date"]');
  if (dateInput) dateInput.addEventListener('change', updateMeetSchedulePreview);
  // 동행 제품 picker 로드
  loadMeetProductPicker(mid);
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const doctorIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    // 동행 제품 수집 (개별 유닛 + 세트)
    var prodPicks = collectMeetProductPicks('#fm');
    const payload = { ...f, doctor_ids: doctorIds, hospital_id: hid };
    delete payload.meet_product_action;
    delete payload.meet_product_is_loan;
    try {
      let savedMid;
      if (mid) { await API.put('/meetings/' + mid, payload); savedMid = mid; toast('미팅 수정됨') }
      else { const res = await API.post('/meetings', payload); savedMid = res.data && res.data.data && res.data.data.id; toast('미팅 등록됨') }
      if (savedMid) { await linkMeetProductPicks(savedMid, prodPicks); }
      closeModal(); viewDocProfile(did);
    } catch (e) { toast('저장 실패', 'err') }
  };
  setTimeout(updateMeetSchedulePreview, 50);
}
async function showMeetFormGlobal(hid, doctorIds, mid) {
  // doctorIds can be an array or single value
  if (!Array.isArray(doctorIds)) doctorIds = [doctorIds];
  let m = {}; if (mid) { try { const ms = (await API.get('/meetings?hospital_id=' + hid)).data; const found = ms.data.find(x => x.id === mid); if (found) { m = found; doctorIds = (found.doctors || []).map(function(d) { return d.id || d.doctor_id }) || doctorIds; } } catch (e) { } }
  let docs = []; try { docs = (await API.get('/hospitals/' + hid + '/doctors')).data.data } catch (e) { }
  let usersList = []; try { usersList = (await API.get('/users')).data.data || [] } catch(e) {}
  var existingUserIds = (m.user_ids || (m.user_id ? [m.user_id] : [])).map(Number);
  var userCheckboxes = usersList.length ? '<div class="col-span-full"><label class="input-label"><i class="fas fa-user-tie mr-1 text-slate-400"></i>영업사원 <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label><div class="border border-gray-200 rounded-xl max-h-[140px] overflow-y-auto p-2 space-y-1">' + usersList.map(function(u) { var ck = existingUserIds.includes(u.id) ? ' checked' : ''; return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-blue-50 cursor-pointer transition"><input type="checkbox" name="user_ids" value="' + u.id + '" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"' + ck + '><span class="text-[13px] font-medium text-slate-700">' + u.name + '</span></label>'; }).join('') + '</div></div>' : '';
  
  var doctorCheckboxes = docs.length ?
    '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
    '<div class="border border-gray-200 rounded-xl max-h-[180px] overflow-y-auto p-2 space-y-1">' +
    docs.map(function(d) {
      var checked = doctorIds.map(Number).includes(d.id) ? ' checked' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition">' +
        '<input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"' + checked + '>' +
        '<div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' +
        (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') +
        '</div></label>';
    }).join('') + '</div></div>' :
    '<div class="col-span-full"><label class="input-label">의료진</label><div class="text-sm text-slate-400 p-3 bg-gray-50 rounded-lg text-center">소속 의료진이 없습니다.</div></div>';
  
  openModal('미팅 수정',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    userCheckboxes +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date || '') +
    field('유형', 'meeting_type', 'select', m.meeting_type || 'visit', [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) +
    field('방문 시간대', 'visit_time', 'select', m.visit_time || '', [{ v: '', l: '미지정' }, { v: 'am', l: '오전' }, { v: 'pm', l: '오후' }, { v: 'full', l: '종일' }]) +
    '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>시작 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="start_time" class="input" step="1800" value="' + (m.start_time || '') + '"></div>' +
    '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>종료 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="end_time" class="input" step="1800" value="' + (m.end_time || '') + '"></div>' +
    field('목적', 'purpose', 'text', m.purpose || '') +
    field('미팅 내용', 'content', 'textarea', m.content || '') + field('결과', 'result', 'textarea', m.result || '') + field('후속 액션', 'next_action', 'textarea', m.next_action || '') +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    // 동행 제품 선택 패널 (수정 모드 — 기존 연계 표시 + 추가 선택)
    '<div class="col-span-full" id="meet-products-panel"><label class="input-label"><i class="fas fa-box-archive mr-1 text-slate-400"></i>동행 반출 제품 <span class="text-[10px] text-slate-400 font-normal">(이미 연계된 제품은 체크 잠금 — 추가 제품 선택 가능)</span></label><div id="meet-products-list" class="border border-gray-200 rounded-xl p-2 text-xs text-slate-400 text-center">로딩 중...</div></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">저장</button></div></form>');
  // 동행 제품 picker 로드 (기존 연계 포함)
  loadMeetProductPicker(mid);
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const selectedIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!selectedIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const selectedUserIds = Array.from(document.querySelectorAll('#fm input[name="user_ids"]:checked')).map(cb => Number(cb.value));
    // 동행 제품 수집 (개별 유닛 + 세트, disabled 항목은 자동 제외)
    var prodPicks = collectMeetProductPicks('#fm');
    const payload = { ...f, doctor_ids: selectedIds, user_ids: selectedUserIds, hospital_id: hid };
    delete payload.meet_product_action;
    delete payload.meet_product_is_loan;
    try {
      await API.put('/meetings/' + mid, payload);
      toast('미팅 수정됨');
      await linkMeetProductPicks(mid, prodPicks);
      closeModal(); loadMeet();
    } catch (e) { toast('저장 실패', 'err') }
  };
}

// ===== NEW MEETING (GLOBAL - select hospital first) =====
async function showNewMeetGlobal() {
  openModal('새 미팅', '<div class="text-center py-6 text-slate-400"><i class="fas fa-spinner fa-spin text-xl"></i></div>', true);
  try {
    const { data } = await API.get('/meetings/form-data');
    const hosps = data.data.hospitals || [];
    const allDocs = data.data.doctors || [];
    const usersList = data.data.users || [];
    const hospOpts = hosps.map(h => '<option value="' + h.id + '">' + h.name + (h.region ? ' (' + h.region + ')' : '') + '</option>').join('');
    var newMeetUserCbs = '<div class="col-span-full"><label class="input-label"><i class="fas fa-user-tie mr-1 text-slate-400"></i>영업사원 <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label><div class="border border-gray-200 rounded-xl max-h-[140px] overflow-y-auto p-2 space-y-1">' + usersList.map(function(u) { var ck = (currentUser && currentUser.id === u.id) ? ' checked' : ''; return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-blue-50 cursor-pointer transition"><input type="checkbox" name="user_ids" value="' + u.id + '" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"' + ck + '><span class="text-[13px] font-medium text-slate-700">' + u.name + '</span></label>'; }).join('') + '</div></div>';
    document.getElementById('modal-body').innerHTML = 
      '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<div><label class="input-label">기관 *</label><select name="hospital_id" id="nm-hosp" class="input" onchange="updateNewMeetDocs()"><option value="">-- 기관 선택 --</option>' + hospOpts + '</select></div>' +
      newMeetUserCbs +
      '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label><div id="nm-doc-list" class="border border-gray-200 rounded-xl max-h-[180px] overflow-y-auto p-2"><div class="text-sm text-slate-400 text-center py-3">먼저 기관을 선택하세요</div></div></div>' +
      field('미팅일자 *', 'meeting_date', 'date', (window._calPrefill && window._calPrefill.meeting_date) || new Date().toISOString().split('T')[0]) +
      field('유형', 'meeting_type', 'select', 'visit', [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) +
      field('방문 시간대', 'visit_time', 'select', '', [{ v: '', l: '미지정' }, { v: 'am', l: '오전' }, { v: 'pm', l: '오후' }, { v: 'full', l: '종일' }]) +
      '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>시작 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="start_time" class="input" step="1800" value="' + ((window._calPrefill && window._calPrefill.start_time) || '') + '"></div>' +
      '<div><label class="input-label"><i class="fas fa-clock mr-1 text-slate-400"></i>종료 시각 <span class="text-[10px] text-slate-400 font-normal">(선택)</span></label><input type="time" name="end_time" class="input" step="1800" value="' + ((window._calPrefill && window._calPrefill.end_time) || '') + '"></div>' +
      field('목적', 'purpose', 'text', '') +
      field('미팅 내용', 'content', 'textarea', '') + field('결과', 'result', 'textarea', '') + field('후속 액션', 'next_action', 'textarea', '') +
      '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" class="input"></div>' +
      // 동행 제품 선택 패널 (내부기/외부기/휴대보관함 단일 또는 복수)
      '<div class="col-span-full" id="meet-products-panel"><label class="input-label"><i class="fas fa-box-archive mr-1 text-slate-400"></i>동행 반출 제품 <span class="text-[10px] text-slate-400 font-normal">(선택 사항 — 내부기/외부기/휴대보관함 단일 또는 복수 선택)</span></label><div id="meet-products-list" class="border border-gray-200 rounded-xl p-2 text-xs text-slate-400 text-center">로딩 중...</div></div>' +
      '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">추가</button></div></form>';
    window._newMeetDocs = allDocs;
    // 동행 제품 picker 로드
    loadMeetProductPicker(null);
    document.getElementById('fm').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.hospital_id) { toast('기관을 선택하세요', 'warn'); return }
      const doctorIds = Array.from(document.querySelectorAll('#nm-doc-list input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
      if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
      if (!f.meeting_date) { toast('미팅일자를 입력하세요', 'warn'); return }
      const selUserIds = Array.from(document.querySelectorAll('#fm input[name="user_ids"]:checked')).map(cb => Number(cb.value));
      // 동행 제품 수집 (개별 유닛 + 세트)
      var prodPicks = collectMeetProductPicks('#fm');
      const payload = { ...f, doctor_ids: doctorIds, user_ids: selUserIds };
      delete payload.meet_product_action;
      delete payload.meet_product_is_loan;
      try {
        const res = await API.post('/meetings', payload);
        const savedMid = res.data && res.data.data && res.data.data.id;
        toast('미팅 등록됨');
        if (savedMid) { await linkMeetProductPicks(savedMid, prodPicks); }
        closeModal(); window._calPrefill = null;
        if (curPage === 'meetings') loadMeet(); else if (curPage === 'dashboard') loadDash(); else if (curPage === 'calendar') renderCalendar();
      } catch (e) { toast('저장 실패', 'err') }
    };
  } catch (e) { toast('데이터를 불러올 수 없습니다', 'err'); closeModal(); }
}
function updateNewMeetDocs() {
  const hid = document.getElementById('nm-hosp')?.value;
  const container = document.getElementById('nm-doc-list');
  if (!hid || !container) { container.innerHTML = '<div class="text-sm text-slate-400 text-center py-3">먼저 기관을 선택하세요</div>'; return }
  const docs = (window._newMeetDocs || []).filter(d => String(d.hospital_id) === String(hid));
  if (!docs.length) { container.innerHTML = '<div class="text-sm text-slate-400 text-center py-3">소속 의료진이 없습니다</div>'; return }
  container.innerHTML = '<div class="space-y-1">' + docs.map(function(d) {
    return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition">' +
      '<input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer">' +
      '<div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' +
      (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') +
      '</div></label>';
  }).join('') + '</div>';
}

// ===== DELETE =====
async function delHosp(id) { showConfirm('기관 삭제', '이 기관과 소속 인원, 미팅이 모두 삭제됩니다.', async () => { try { await API.delete('/hospitals/' + id); toast('기관 삭제됨'); nav('hospitals') } catch (e) { toast('삭제 실패', 'err') } }) }
async function delDoc(id, hid) { showConfirm('의료진 삭제', '이 의료진과 관련 기록이 모두 삭제됩니다.', async () => { try { await API.delete('/doctors/' + id); toast('의료진 삭제됨'); viewHosp(hid) } catch (e) { toast('삭제 실패', 'err') } }) }
async function delMeet(id, hid) { showConfirm('미팅 삭제', '이 미팅을 삭제하시겠습니까?', async () => { try { await API.delete('/meetings/' + id); toast('미팅 삭제됨'); viewHosp(hid) } catch (e) { toast('삭제 실패', 'err') } }) }
async function delMeetFromProfile(mid, did) { showConfirm('미팅 삭제', '이 미팅을 삭제하시겠습니까?', async () => { try { await API.delete('/meetings/' + mid); toast('미팅 삭제됨'); viewDocProfile(did) } catch (e) { toast('삭제 실패', 'err') } }) }
async function delMeetGlobal(mid) { showConfirm('미팅 삭제', '이 미팅을 삭제하시겠습니까?', async () => { try { await API.delete('/meetings/' + mid); toast('미팅 삭제됨'); loadMeet() } catch (e) { toast('삭제 실패', 'err') } }) }
function viewMeetDoctors(mid, doctorIds) {
  // Show meeting detail modal instead of navigating to doctor profile
  var meet = (window._meetList || []).find(function(m) { return m.id === mid; });
  if (!meet) { 
    // Fallback to doctor profile if meeting not found
    if (doctorIds && doctorIds.length > 0) { viewDocProfile(doctorIds[0]); }
    return; 
  }
  showMeetDetail(meet);
}
function showMeetDetail(m) {
  var typeLabels = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' };
  var typeColors = { visit: 'emerald', phone: 'blue', conference: 'purple', email: 'amber', online: 'sky' };
  var tc = typeColors[m.meeting_type] || 'slate';
  var visitTimeLabels = { am: '오전', pm: '오후', full: '종일' };
  
  var doctorCards = '';
  if (m.doctors && m.doctors.length) {
    doctorCards = '<div class="mb-5"><div class="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">참석 의료진</div>' +
      '<div class="flex flex-wrap gap-2">' + m.doctors.map(function(d) {
        return '<div class="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 cursor-pointer hover:bg-brand-50 transition" onclick="closeModal();viewDocProfile(' + (d.doctor_id || d.id) + ')">' +
          avatar(d.doctor_photo || d.photo, d.doctor_name || d.name, 'width:28px;height:28px;border-radius:8px;font-size:11px') +
          '<div><div class="text-xs font-semibold text-slate-700">' + (d.doctor_name || d.name) + '</div>' +
          '<div class="text-[10px] text-slate-400">' + (d.position || '') + '</div></div></div>';
      }).join('') + '</div></div>';
  }
  
  var sections = '';
  if (m.purpose) {
    sections += '<div class="mb-4"><div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">미팅 목적</div>' +
      '<div class="text-sm text-slate-700 leading-relaxed bg-gray-50 rounded-xl p-3.5">' + m.purpose + '</div></div>';
  }
  if (m.content) {
    sections += '<div class="mb-4"><div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">상세 내용</div>' +
      '<div class="text-sm text-slate-700 leading-relaxed bg-gray-50 rounded-xl p-3.5 whitespace-pre-wrap">' + m.content + '</div></div>';
  }
  if (m.result) {
    sections += '<div class="mb-4"><div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">결과</div>' +
      '<div class="text-sm text-emerald-700 leading-relaxed bg-emerald-50 rounded-xl p-3.5"><i class="fas fa-check-circle mr-1.5 text-emerald-500"></i>' + m.result + '</div></div>';
  }
  if (m.next_action) {
    sections += '<div class="mb-4"><div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">후속 액션</div>' +
      '<div class="text-sm text-amber-700 leading-relaxed bg-amber-50 rounded-xl p-3.5"><i class="fas fa-arrow-right mr-1.5 text-amber-500"></i>' + m.next_action + '</div></div>';
  }
  if (m.next_meeting_date) {
    var nextDu = daysUntil(m.next_meeting_date);
    var nextLabel = nextDu < 0 ? '미팅 예정일 지남 (' + fmtShort(m.next_meeting_date) + ')' : fmtShort(m.next_meeting_date) + (nextDu === 0 ? ' (오늘)' : nextDu === 1 ? ' (내일)' : ' (' + nextDu + '일 후)');
    var nextColor = nextDu < 0 ? 'text-red-600 bg-red-50' : 'text-blue-700 bg-blue-50';
    var nextIcon = nextDu < 0 ? 'fa-exclamation-circle text-red-500' : 'fa-calendar-day text-blue-500';
    sections += '<div class="mb-4"><div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">다음 미팅 예정</div>' +
      '<div class="text-sm leading-relaxed rounded-xl p-3.5 ' + nextColor + '"><i class="fas ' + nextIcon + ' mr-1.5"></i>' + nextLabel + '</div></div>';
  }
  
  if (!sections && !m.purpose) {
    sections = '<div class="text-sm text-slate-400 text-center py-4"><i class="fas fa-file-lines text-slate-300 text-lg mb-2 block"></i>상세 기록이 없습니다</div>';
  }

  var commentsSection = '<div class="mt-5 pt-4 border-t border-gray-100">' +
    '<div class="flex items-center justify-between mb-3">' +
      '<div class="text-xs font-semibold text-slate-400 uppercase tracking-wider"><i class="fas fa-comments mr-1.5"></i>댓글 <span id="mc-count" class="text-slate-300">·</span></div>' +
    '</div>' +
    '<div id="mc-list" class="space-y-2 mb-3"><div class="text-xs text-slate-300 text-center py-3"><i class="fas fa-spinner fa-spin"></i></div></div>' +
    '<div class="relative">' +
      '<textarea id="mc-input" class="input" rows="2" placeholder="댓글 입력 (@로 멘션, Ctrl+Enter로 등록)" oninput="onMcInput(event)" onkeydown="onMcKey(event,' + m.id + ')"></textarea>' +
      '<div id="mc-mention-pop" class="hidden absolute z-50 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto" style="left:8px;bottom:100%;min-width:180px"></div>' +
      '<div class="flex justify-end mt-2"><button class="btn btn-primary btn-sm" onclick="postComment(' + m.id + ')"><i class="fas fa-paper-plane mr-1.5 text-xs"></i>등록</button></div>' +
    '</div>' +
  '</div>';

  var body = '<div>' +
    '<div class="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">' +
      '<div class="w-10 h-10 rounded-xl bg-' + tc + '-50 flex items-center justify-center"><i class="fas fa-calendar-check text-' + tc + '-500"></i></div>' +
      '<div class="flex-1"><div class="flex items-center gap-2 flex-wrap"><span class="font-bold text-slate-800">' + (m.hospital_name || '') + '</span>' +
        '<span class="text-[10px] px-2 py-0.5 rounded-full bg-' + tc + '-50 text-' + tc + '-600 font-semibold">' + (typeLabels[m.meeting_type] || m.meeting_type || '') + '</span>' +
        (m.visit_time ? vtBadge(m.visit_time) : '') + '</div>' +
        '<div class="text-xs text-slate-400 mt-0.5"><i class="fas fa-clock mr-1"></i>' + fmtShort(m.meeting_date) + (m.visit_time ? ' <span class="font-semibold text-slate-500">' + (visitTimeLabels[m.visit_time] || '') + '</span>' : '') + ' · ' + daysAgo(m.meeting_date) + ' · <i class="fas fa-user-tie mr-0.5"></i>' + (m.user_names || m.user_name || (currentUser ? currentUser.name : '')) + '</div></div></div>' +
    doctorCards + sections +
    // 동행 반출 제품 영역 (비동기 로드)
    '<div id="meet-detail-products" class="mb-4"></div>' +
    '<div class="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">' +
      '<button class="btn btn-outline btn-sm" onclick="printMeetDetail(' + m.id + ')"><i class="fas fa-file-pdf mr-1.5 text-xs"></i>PDF</button>' +
      '<button class="btn btn-outline btn-sm" onclick="closeModal();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || [m.doctor_id]).replace(/"/g, '&quot;') + ',' + m.id + ')"><i class="fas fa-pen mr-1.5 text-xs"></i>수정</button>' +
      '<button class="btn btn-outline btn-sm !border-red-200 !text-red-500 hover:!bg-red-50" onclick="closeModal();delMeetGlobal(' + m.id + ')"><i class="fas fa-trash mr-1.5 text-xs"></i>삭제</button>' +
    '</div>' + commentsSection + '</div>';

  openModal('미팅 상세', body);
  window._meetDetailCache = m;
  loadComments(m.id);
  loadMeetDetailProducts(m.id);
}

// 미팅 상세에서 동행 반출 제품 로드 및 렌더
async function loadMeetDetailProducts(meetingId) {
  var el = document.getElementById('meet-detail-products');
  if (!el) return;
  try {
    var r = (await API.get('/products/by-meeting/' + meetingId)).data.data || [];
    if (!r.length) { el.innerHTML = ''; return; }
    var catLabel = { internal: '내부기', external: '외부기', carry_case: '휴대보관함' };
    var catColor = { internal: 'bg-blue-50 text-blue-700', external: 'bg-emerald-50 text-emerald-700', carry_case: 'bg-amber-50 text-amber-700' };
    var actLabel = { demo: '시연', checkout: '반출(대여)', deliver: '납품', return: '회수' };
    var actColor = { demo: 'bg-sky-50 text-sky-600', checkout: 'bg-orange-50 text-orange-600', deliver: 'bg-purple-50 text-purple-600', return: 'bg-slate-50 text-slate-600' };
    el.innerHTML = '<div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider"><i class="fas fa-box-archive mr-1.5"></i>동행 반출 제품 <span class="text-slate-300">·</span> <span class="text-slate-400">' + r.length + '개</span></div>' +
      '<div class="bg-gray-50 rounded-xl p-3 space-y-1.5">' +
      r.map(function(p) {
        var label = p.asset_code || p.serial_no || ('#' + p.product_unit_id);
        return '<div class="flex items-center gap-2 text-xs">' +
          '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold ' + (catColor[p.category] || 'bg-gray-100 text-gray-600') + '">' + (catLabel[p.category] || p.category) + '</span>' +
          '<span class="font-medium text-slate-700">' + (p.product_name || p.model) + '</span>' +
          '<span class="text-slate-400">·</span>' +
          '<span class="font-mono text-slate-600">' + label + '</span>' +
          '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ' + (actColor[p.action] || 'bg-gray-100 text-gray-600') + '">' + (actLabel[p.action] || p.action) + '</span>' +
          (p.notes ? '<span class="text-slate-400 text-[11px] truncate">· ' + p.notes + '</span>' : '') +
        '</div>';
      }).join('') + '</div>';
  } catch (e) { el.innerHTML = ''; }
}

// ===== Print / PDF: Doctor profile =====
function printDocProfile(doctorId) {
  try {
    var d = window._docProfile;
    if (!d || d.id !== doctorId) {
      toast('의료진 정보를 먼저 불러와야 합니다', 'err');
      return;
    }
    var content = document.getElementById('content');
    if (!content) return;
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    var userName = (window._me && window._me.name) ? window._me.name : '';

    var header = '<div class="print-header">' +
      '<div class="print-title">' + (d.name || '') + ' ' + (d.position || '') + '</div>' +
      '<div class="print-meta">' +
        (d.hospital_name ? '소속: ' + d.hospital_name : '') +
        (d.department ? ' · ' + d.department : '') +
        (d.specialty ? ' · ' + d.specialty : '') +
        ' · 미팅 ' + (d.meeting_count || 0) + '회' +
        ' · 출력일 ' + dateStr + (userName ? ' · ' + userName : '') +
      '</div>' +
    '</div>';

    var infoRows = [
      ['이름', d.name || '-'],
      ['직위', d.position || '-'],
      ['진료과', d.department || '-'],
      ['전문분야', d.specialty || '-'],
      ['소속 병원', d.hospital_name || '-'],
      ['지역', d.hospital_region || '-'],
      ['전화', d.phone || '-'],
      ['이메일', d.email || '-']
    ];
    var infoTable = '<h2 style="margin:6mm 0 2mm 0;font-size:13pt;">기본 정보</h2>' +
      '<table><tbody>' +
      infoRows.map(function(r){ return '<tr><th style="width:25%;text-align:left;background:#f3f4f6">' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('') +
      '</tbody></table>';

    var sections = '';
    if (d.bio) sections += '<h2 style="margin:6mm 0 2mm 0;font-size:13pt;">소개</h2><div style="white-space:pre-wrap;font-size:10.5pt">' + d.bio + '</div>';
    if (d.education) sections += '<h2 style="margin:6mm 0 2mm 0;font-size:13pt;">학력</h2><div style="white-space:pre-wrap;font-size:10.5pt">' + d.education + '</div>';
    if (d.career) sections += '<h2 style="margin:6mm 0 2mm 0;font-size:13pt;">경력</h2><div style="white-space:pre-wrap;font-size:10.5pt">' + d.career + '</div>';
    if (d.notes) sections += '<h2 style="margin:6mm 0 2mm 0;font-size:13pt;">영업 메모</h2><div style="white-space:pre-wrap;font-size:10.5pt">' + d.notes + '</div>';

    // Meetings table
    var meets = (d.meetings || []).slice().sort(function(a,b){ return (b.meeting_date || '').localeCompare(a.meeting_date || ''); });
    var typeLabel = function(t){ return ({visit:'방문', phone:'전화', conference:'학회', email:'이메일', online:'온라인'})[t] || t || '-'; };
    var vtLabel = function(v){ return ({am:'오전', pm:'오후', full:'종일'})[v] || '미지정'; };
    var meetsRows = meets.map(function(m){
      var range = (m.start_time && m.end_time) ? (m.start_time + '~' + m.end_time) : vtLabel(m.visit_time);
      return '<tr>' +
        '<td>' + (m.meeting_date || '') + '</td>' +
        '<td>' + range + '</td>' +
        '<td>' + typeLabel(m.meeting_type || m.type) + '</td>' +
        '<td>' + (m.purpose || '-') + '</td>' +
        '<td>' + ((m.result || '') + (m.next_action ? ' / 후속: ' + m.next_action : '')) + '</td>' +
      '</tr>';
    }).join('');
    var meetsTable = '<h2 style="margin:8mm 0 2mm 0;font-size:13pt;" class="print-page-break">미팅 이력 (' + meets.length + ')</h2>' +
      (meets.length === 0 ? '<div style="color:#6b7280">등록된 미팅이 없습니다.</div>' :
        '<table><thead><tr><th>날짜</th><th>시간</th><th>유형</th><th>목적</th><th>결과/후속</th></tr></thead><tbody>' + meetsRows + '</tbody></table>');

    var footer = '<div class="print-footer">TODOC CRM · ' + (d.name || '') + ' · ' + dateStr + '</div>';

    var wrap = document.createElement('div');
    wrap.className = 'print-target';
    wrap.id = 'print-target-temp';
    wrap.innerHTML = header + infoTable + sections + meetsTable + footer;

    document.body.classList.add('print-mode');
    var origClasses = content.className;
    content.classList.add('not-print-target');
    document.body.appendChild(wrap);

    var cleanup = function(){
      document.body.classList.remove('print-mode');
      content.className = origClasses;
      var t = document.getElementById('print-target-temp');
      if (t && t.parentNode) t.parentNode.removeChild(t);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(function(){ window.print(); }, 50);
    setTimeout(function(){ if (document.getElementById('print-target-temp')) cleanup(); }, 10000);
  } catch (e) {
    toast('PDF 저장 준비 중 오류가 발생했습니다', 'err');
  }
}

// ===== Print / PDF: Meeting detail =====
function printMeetDetail(meetingId) {
  try {
    var m = window._meetDetailCache;
    if (!m || m.id !== meetingId) {
      toast('미팅 정보를 먼저 불러와야 합니다', 'err');
      return;
    }
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + ' ' + String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
    var userName = (window._me && window._me.name) ? window._me.name : '';
    var typeLabel = ({visit:'방문', phone:'전화', conference:'학회', email:'이메일', online:'온라인'})[m.meeting_type] || m.meeting_type || '-';
    var vtLabel = ({am:'오전', pm:'오후', full:'종일'})[m.visit_time] || '미지정';
    var range = (m.start_time && m.end_time) ? (m.start_time + '~' + m.end_time) : vtLabel;
    var doctors = (m.doctors && m.doctors.length) ? m.doctors.map(function(d){ return (d.doctor_name || d.name) + (d.position ? ' (' + d.position + ')' : ''); }).join(', ') : '-';

    var header = '<div class="print-header">' +
      '<div class="print-title">미팅 기록 — ' + (m.hospital_name || '') + '</div>' +
      '<div class="print-meta">' +
        (m.meeting_date || '') + ' · ' + range + ' · ' + typeLabel +
        ' · 작성자 ' + (m.user_names || m.user_name || userName || '-') +
        ' · 출력일 ' + dateStr +
      '</div>' +
    '</div>';

    var rows = [
      ['기관', m.hospital_name || '-'],
      ['일시', (m.meeting_date || '') + ' / ' + range],
      ['유형', typeLabel],
      ['참석 의료진', doctors],
      ['미팅 목적', m.purpose || '-'],
      ['상세 내용', m.content || '-'],
      ['결과', m.result || '-'],
      ['후속 액션', m.next_action || '-'],
      ['다음 미팅', m.next_meeting_date || '-']
    ];
    var infoTable = '<table><tbody>' +
      rows.map(function(r){ return '<tr><th style="width:25%;text-align:left;background:#f3f4f6;vertical-align:top">' + r[0] + '</th><td style="white-space:pre-wrap">' + r[1] + '</td></tr>'; }).join('') +
      '</tbody></table>';

    var footer = '<div class="print-footer">TODOC CRM · ' + (m.hospital_name || '') + ' · ' + (m.meeting_date || '') + ' · ' + dateStr + '</div>';

    var wrap = document.createElement('div');
    wrap.className = 'print-target';
    wrap.id = 'print-target-temp';
    wrap.innerHTML = header + infoTable + footer;

    // Hide modal during print
    var modal = document.querySelector('.modal') || document.querySelector('.modal-bg');
    var modalDisplay = null;
    if (modal) { modalDisplay = modal.style.display; modal.style.display = 'none'; }
    var content = document.getElementById('content');
    var origClasses = content ? content.className : '';
    if (content) content.classList.add('not-print-target');
    document.body.classList.add('print-mode');
    document.body.appendChild(wrap);

    var cleanup = function(){
      document.body.classList.remove('print-mode');
      if (content) content.className = origClasses;
      if (modal && modalDisplay !== null) modal.style.display = modalDisplay;
      var t = document.getElementById('print-target-temp');
      if (t && t.parentNode) t.parentNode.removeChild(t);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(function(){ window.print(); }, 50);
    setTimeout(function(){ if (document.getElementById('print-target-temp')) cleanup(); }, 10000);
  } catch (e) {
    toast('PDF 저장 준비 중 오류가 발생했습니다', 'err');
  }
}

// ===== Comments / Mentions =====
async function loadComments(meetingId) {
  var listEl = document.getElementById('mc-list');
  if (!listEl) return;
  try {
    var r = await API.get('/comments/meeting/' + meetingId);
    var list = (r.data && r.data.data) || [];
    var cnt = document.getElementById('mc-count');
    if (cnt) cnt.textContent = '· ' + list.length;
    if (!list.length) {
      listEl.innerHTML = '<div class="text-xs text-slate-300 text-center py-3">아직 댓글이 없습니다</div>';
      return;
    }
    listEl.innerHTML = list.map(function(c) {
      var mine = currentUser && c.user_id === currentUser.id;
      var content = renderCommentContent(c.content);
      return '<div class="bg-gray-50 rounded-xl p-3">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<div class="flex items-center gap-2">' +
            avatar(null, c.user_name || '?', 'width:22px;height:22px;border-radius:6px;font-size:10px') +
            '<span class="text-xs font-semibold text-slate-700">' + (c.user_name || '익명') + '</span>' +
            '<span class="text-[10px] text-slate-400">' + fmtShort(c.created_at) + '</span>' +
          '</div>' +
          (mine ? '<button class="text-[11px] text-red-400 hover:text-red-600" onclick="delComment(' + c.id + ',' + meetingId + ')"><i class="fas fa-trash"></i></button>' : '') +
        '</div>' +
        '<div class="text-sm text-slate-700 whitespace-pre-wrap break-words">' + content + '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="text-xs text-red-400 text-center py-3">댓글을 불러올 수 없습니다</div>';
  }
}

function renderCommentContent(s) {
  if (!s) return '';
  var esc = String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Replace @[name](id) tokens with highlighted span
  esc = esc.replace(/@\[([^\]]+)\]\((\d+)\)/g, function(_, nm, id) {
    return '<span class="text-blue-600 font-semibold bg-blue-50 px-1 rounded">@' + nm + '</span>';
  });
  return esc;
}

function onMcKey(e, meetingId) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    postComment(meetingId);
  } else if (e.key === 'Escape') {
    var pop = document.getElementById('mc-mention-pop');
    if (pop) pop.classList.add('hidden');
  }
}

function onMcInput(e) {
  var ta = e.target;
  var val = ta.value;
  var pos = ta.selectionStart;
  var before = val.substring(0, pos);
  var m = before.match(/@([^\s@\[]*)$/);
  var pop = document.getElementById('mc-mention-pop');
  if (!pop) return;
  if (!m) { pop.classList.add('hidden'); return; }
  var q = (m[1] || '').toLowerCase();
  var users = (window._allUsers || []).filter(function(u) {
    return !q || (u.name && u.name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q));
  }).slice(0, 6);
  if (!users.length) { pop.classList.add('hidden'); return; }
  pop.innerHTML = users.map(function(u) {
    return '<div class="px-3 py-2 hover:bg-brand-50 cursor-pointer flex items-center gap-2 text-xs" onclick="insertMention(' + u.id + ',\'' + (u.name || '').replace(/'/g, "\\'") + '\')">' +
      avatar(null, u.name || '?', 'width:20px;height:20px;border-radius:5px;font-size:9px') +
      '<span class="font-semibold text-slate-700">' + (u.name || '') + '</span>' +
      '<span class="text-slate-400">' + (u.email || '') + '</span>' +
    '</div>';
  }).join('');
  pop.classList.remove('hidden');
}

function insertMention(id, name) {
  var ta = document.getElementById('mc-input');
  if (!ta) return;
  var val = ta.value;
  var pos = ta.selectionStart;
  var before = val.substring(0, pos);
  var after = val.substring(pos);
  var newBefore = before.replace(/@([^\s@\[]*)$/, '@[' + name + '](' + id + ') ');
  ta.value = newBefore + after;
  ta.focus();
  var newPos = newBefore.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  var pop = document.getElementById('mc-mention-pop');
  if (pop) pop.classList.add('hidden');
}

async function postComment(meetingId) {
  var ta = document.getElementById('mc-input');
  if (!ta) return;
  var content = (ta.value || '').trim();
  if (!content) { toast('내용을 입력하세요', 'err'); return; }
  try {
    await API.post('/comments/meeting/' + meetingId, { content: content });
    ta.value = '';
    loadComments(meetingId);
    toast('댓글 등록됨');
  } catch (e) { toast('등록 실패', 'err'); }
}

async function delComment(id, meetingId) {
  showConfirm('댓글 삭제', '이 댓글을 삭제하시겠습니까?', async () => {
    try {
      await API.delete('/comments/' + id);
      loadComments(meetingId);
      toast('삭제됨');
    } catch (e) { toast('삭제 실패', 'err'); }
  });
}

// Preload user list for mention auto-complete
async function preloadUsers() {
  try {
    var r = await API.get('/users');
    window._allUsers = (r.data && r.data.data) || [];
  } catch (e) { window._allUsers = []; }
}

// ===== Mention Notifications (header bell) =====
var _mentionPollTimer = null;
var _mentionCache = [];

function startMentionPolling() {
  if (_mentionPollTimer) clearInterval(_mentionPollTimer);
  refreshMentions();
  // Poll every 60 seconds
  _mentionPollTimer = setInterval(refreshMentions, 60000);
}

function stopMentionPolling() {
  if (_mentionPollTimer) { clearInterval(_mentionPollTimer); _mentionPollTimer = null; }
  var badge = document.getElementById('mention-badge');
  if (badge) badge.classList.add('hidden');
}

async function refreshMentions() {
  if (!currentUser) return;
  try {
    var r = await API.get('/comments/mentions');
    _mentionCache = (r.data && r.data.data) || [];
    var unread = (r.data && r.data.unread) || 0;
    var badge = document.getElementById('mention-badge');
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    // If panel is open, re-render
    var panel = document.getElementById('mention-panel');
    if (panel && !panel.classList.contains('hidden')) {
      renderMentionPanel();
    }
  } catch (e) { /* ignore */ }
}

function toggleMentionPanel(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  var panel = document.getElementById('mention-panel');
  var bell = document.getElementById('mention-bell');
  if (!panel) return;
  var isHidden = panel.classList.contains('hidden');
  if (isHidden) {
    renderMentionPanel();
    panel.classList.remove('hidden');
    if (bell) bell.setAttribute('aria-expanded', 'true');
    // Close on outside click
    setTimeout(function() {
      document.addEventListener('click', _mentionOutsideClick);
    }, 0);
  } else {
    panel.classList.add('hidden');
    if (bell) bell.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', _mentionOutsideClick);
  }
}

function _mentionOutsideClick(e) {
  var panel = document.getElementById('mention-panel');
  var bell = document.getElementById('mention-bell');
  if (!panel) return;
  if (panel.contains(e.target) || (bell && bell.contains(e.target))) return;
  panel.classList.add('hidden');
  if (bell) bell.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', _mentionOutsideClick);
}

function renderMentionPanel() {
  var panel = document.getElementById('mention-panel');
  if (!panel) return;
  var list = _mentionCache || [];
  var unreadCount = list.filter(function(x) { return !x.read_at; }).length;

  var header = '<div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-100 sticky top-0 bg-white z-10">' +
    '<div class="flex items-center gap-2"><i class="fas fa-at text-brand-500 text-sm"></i><span class="text-sm font-bold text-slate-700">멘션 알림</span>' +
      (unreadCount > 0 ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-bold">' + unreadCount + '개 안읽음</span>' : '') +
    '</div>' +
    (unreadCount > 0 ? '<button class="text-[11px] text-brand-500 hover:text-brand-600 font-semibold" onclick="markAllMentionsRead()">모두 읽음</button>' : '') +
  '</div>';

  var body;
  if (!list.length) {
    body = '<div class="px-3 py-10 text-center text-xs text-slate-400"><i class="fas fa-bell-slash text-2xl text-slate-200 block mb-2"></i>받은 멘션이 없습니다</div>';
  } else {
    body = '<div>' + list.map(function(n) {
      var isUnread = !n.read_at;
      var preview = String(n.content || '').replace(/@\[([^\]]+)\]\(\d+\)/g, '@$1');
      if (preview.length > 80) preview = preview.slice(0, 80) + '…';
      preview = preview.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      var bg = isUnread ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-gray-50';
      return '<div class="px-3 py-2.5 border-b border-gray-50 cursor-pointer ' + bg + '" onclick="openMentionItem(' + n.notif_id + ',' + n.meeting_id + ')">' +
        '<div class="flex items-start gap-2">' +
          (isUnread ? '<span class="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0"></span>' : '<span class="w-1.5 h-1.5 mt-1.5 flex-shrink-0"></span>') +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-1.5 flex-wrap">' +
              '<span class="text-xs font-bold text-slate-700">' + (n.author_name || '익명') + '</span>' +
              '<span class="text-[10px] text-slate-400">님이 회원님을 언급함</span>' +
            '</div>' +
            '<div class="text-[11px] text-slate-500 mt-0.5"><i class="fas fa-hospital text-[9px] mr-0.5"></i>' + (n.hospital_name || '-') + ' · ' + (n.meeting_date || '') + '</div>' +
            '<div class="text-xs text-slate-700 mt-1 line-clamp-2">' + preview + '</div>' +
            '<div class="text-[10px] text-slate-400 mt-1"><i class="fas fa-clock text-[9px] mr-0.5"></i>' + fmtShort(n.notif_created_at) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }
  panel.innerHTML = header + body;
}

async function openMentionItem(notifId, meetingId) {
  // Mark this mention as read
  try { await API.post('/comments/mentions/' + notifId + '/read', {}); } catch (e) { /* ignore */ }
  // Close panel
  var panel = document.getElementById('mention-panel');
  if (panel) panel.classList.add('hidden');
  var bell = document.getElementById('mention-bell');
  if (bell) bell.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', _mentionOutsideClick);
  // Fetch meeting detail and open it
  try {
    var r = await API.get('/meetings/' + meetingId);
    var meet = (r.data && r.data.data) || null;
    if (meet) {
      showMeetDetail(meet);
    } else {
      toast('미팅을 찾을 수 없습니다', 'err');
    }
  } catch (e) {
    toast('미팅 정보를 불러올 수 없습니다', 'err');
  }
  // Refresh after a moment
  setTimeout(refreshMentions, 500);
}

async function markAllMentionsRead() {
  try {
    await API.post('/comments/mentions/read-all', {});
    toast('모든 멘션을 읽음으로 표시했습니다');
    refreshMentions();
  } catch (e) { toast('처리 실패', 'err'); }
}

// ===== CI STATS =====
let ciCharts = [];
function destroyCICharts() { ciCharts.forEach(c => { try { c.destroy() } catch (e) { } }); ciCharts = [] }

async function loadCIStats() {
  destroyCICharts();
  document.getElementById('page-title').textContent = '인공와우 이식술 통계';
  document.getElementById('page-subtitle').innerHTML = '<span class="text-[11px] text-slate-400">S5800 | HIRA 실제 데이터</span>';
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-outline btn-sm hide-mobile" onclick="downloadCSV(\'cistats\')"><i class="fas fa-download text-xs"></i>CSV</button><button class="btn btn-outline btn-sm" onclick="showCompare()"><i class="fas fa-code-compare text-xs"></i><span class="hidden sm:inline">기간 비교</span></button><button class="btn btn-outline btn-sm hide-mobile" onclick="showCrossAnalysis()"><i class="fas fa-chart-column text-xs"></i>교차분석</button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 space-y-6"><div class="grid grid-cols-2 lg:grid-cols-3 gap-4">' + Array(6).fill('<div class="sc"><div class="space-y-2"><div class="skeleton rounded h-4 w-24"></div><div class="skeleton rounded h-7 w-16"></div></div></div>').join('') + '</div></div>';
  try {
    const { data: d } = await API.get('/ci-stats'); const s = d.data;
    window._ciData = s;
    renderCITab('overview');
  } catch (e) { document.getElementById('content').innerHTML = '<div class="p-7"><div class="card-flat p-8 text-center text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>통계를 불러올 수 없습니다</div></div>' }
}

function renderCITab(tab) {
  destroyCICharts();
  const s = window._ciData;
  const tabs = ['overview', 'age', 'region', 'institution', 'amount'];
  const tabLabels = { overview: '종합', age: '연령별', region: '지역별', institution: '기관 종별', amount: '진료금액' };
  const tabIcons = { overview: 'fa-chart-pie', age: 'fa-cake-candles', region: 'fa-map-location-dot', institution: 'fa-hospital', amount: 'fa-won-sign' };
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in space-y-6">' +
    '<div class="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl p-4 lg:p-5 flex flex-wrap items-center gap-4 border border-indigo-100">' +
    '<div class="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0"><i class="fas fa-database text-indigo-500 text-lg"></i></div>' +
    '<div class="flex-1 min-w-0"><div class="font-bold text-indigo-900 text-sm mb-0.5">HIRA 보건의료빅데이터</div><div class="text-xs text-indigo-400">' + s.code + ' | ' + s.period + '</div></div>' +
    '<span class="text-[11px] text-emerald-600 font-semibold bg-emerald-50 px-3 py-1.5 rounded-full"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block mr-1"></span>실제 데이터</span></div>' +
    '<div class="flex border-b border-gray-100 px-1 overflow-x-auto">' + tabs.map(t => '<div class="tab ' + (tab === t ? 'active' : '') + '" onclick="renderCITab(\'' + t + '\')"><i class="fas ' + tabIcons[t] + ' text-xs"></i>' + tabLabels[t] + '</div>').join('') + '</div>' +
    renderCIContent(tab, s) +
    '<div class="text-[10px] text-slate-300 text-center pb-4">본 통계는 건강보험심사평가원에서 공공누리 제1유형으로 개방한 데이터를 이용하였습니다.</div></div>';
  setTimeout(() => renderCIChartsForTab(tab, s), 100);
}

function renderCIContent(tab, s) {
  const y = s.yearly;
  if (tab === 'overview') {
    return '<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 lg:gap-4">' + s.insights.map(i => '<div class="sc !p-3 lg:!p-4"><div class="flex items-center gap-2 mb-2"><div class="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center"><i class="fas ' + i.icon + ' text-brand-500 text-xs"></i></div></div><div class="text-[18px] lg:text-[20px] font-extrabold text-slate-800 mb-0.5">' + i.value + '</div><div class="text-[11px] font-semibold text-slate-500 mb-1">' + i.title + '</div><div class="text-[10px] text-slate-400">' + i.desc + '</div></div>').join('') + '</div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-5 gap-6"><div class="lg:col-span-3 card-flat p-4 lg:p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-chart-line text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">연도별 추이</span></div><div style="height:300px"><canvas id="chart-yearly"></canvas></div></div>' +
      '<div class="lg:col-span-2 card-flat p-4 lg:p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center"><i class="fas fa-venus-mars text-purple-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">성별 추이</span></div><div style="height:300px"><canvas id="chart-gender"></canvas></div></div></div>' +
      '<div class="card-flat overflow-hidden"><div class="px-4 lg:px-6 py-4"><span class="font-bold text-sm text-slate-800">연도별 상세</span></div>' +
      '<div class="table-wrap"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100"><th class="px-4 py-3 text-left">연도</th><th class="px-4 py-3 text-right">환자수</th><th class="px-4 py-3 text-right">사용량</th><th class="px-4 py-3 text-right">진료금액</th><th class="px-4 py-3 text-right">남</th><th class="px-4 py-3 text-right">여</th><th class="px-4 py-3 text-right">증감</th></tr></thead>' +
      '<tbody class="divide-y divide-gray-50">' + y.map((r, i) => { const g = i > 0 ? ((r.patients - y[i - 1].patients) / y[i - 1].patients * 100).toFixed(1) : '—'; const gc = i > 0 ? (r.patients > y[i - 1].patients ? 'text-emerald-600' : 'text-red-500') : 'text-slate-400'; return '<tr class="tr"><td class="px-4 py-3 font-bold text-sm text-slate-800">' + r.year + '</td><td class="px-4 py-3 text-right font-semibold text-sm text-brand-600">' + fmtNum(r.patients) + '</td><td class="px-4 py-3 text-right text-sm text-slate-600">' + fmtNum(r.usage) + '</td><td class="px-4 py-3 text-right text-sm text-slate-600">' + fmtAmount(r.amount) + '</td><td class="px-4 py-3 text-right text-sm text-blue-600">' + fmtNum(r.male_patients) + '</td><td class="px-4 py-3 text-right text-sm text-pink-600">' + fmtNum(r.female_patients) + '</td><td class="px-4 py-3 text-right text-sm font-semibold ' + gc + '">' + (i > 0 ? (g > 0 ? '+' : '') + g + '%' : '—') + '</td></tr>' }).join('') + '</tbody></table></div></div>' +
      '<div class="card-flat p-4 lg:p-6"><div class="flex items-center gap-2 mb-5"><div class="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><i class="fas fa-landmark text-violet-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">정책 변천</span></div>' +
      '<div class="flex items-start gap-0 overflow-x-auto pb-2 policy-timeline">' + s.policyChanges.map((p, i) => '<div class="flex flex-col items-center min-w-[100px] lg:min-w-[140px] flex-1 relative"><div class="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white font-bold text-xs shadow-lg z-10">' + p.year + '</div>' + (i < s.policyChanges.length - 1 ? '<div class="absolute top-5 left-[calc(50%+20px)] right-0 h-0.5 bg-brand-200"></div>' : '') + '<div class="text-[11px] text-slate-500 text-center mt-3 px-2">' + p.event + '</div></div>').join('') + '</div></div>';
  }
  if (tab === 'age') {
    const years = s.years, latestY = years[years.length - 1];
    const ageGroups10 = ['0_9세', '10_19세', '20_29세', '30_39세', '40_49세', '50_59세', '60_69세', '70_79세', '80세이상'];
    const ageLabels10 = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+'];
    const maleAge = s.age10.filter(r => r.year === latestY && r.gender === '남');
    const femaleAge = s.age10.filter(r => r.year === latestY && r.gender === '여');
    return '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
      '<div class="card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">10세 구간별 추이</div><div style="height:320px"><canvas id="chart-age10-trend"></canvas></div></div>' +
      '<div class="card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">' + latestY + '년 연령분포</div><div style="height:320px"><canvas id="chart-age10-pie"></canvas></div></div></div>' +
      '<div class="card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">연령대별 성장률 (' + years[0] + '→' + latestY + ')</div><div style="height:280px"><canvas id="chart-age-growth"></canvas></div></div>' +
      '<div class="card-flat overflow-hidden"><div class="px-4 lg:px-6 py-4"><span class="font-bold text-sm text-slate-800">' + latestY + '년 연령대별 남/여</span></div>' +
      '<div class="table-wrap"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100"><th class="px-4 py-3 text-left">연령</th><th class="px-3 py-3 text-right">남</th><th class="px-3 py-3 text-right">여</th><th class="px-3 py-3 text-right">합계</th></tr></thead>' +
      '<tbody class="divide-y divide-gray-50">' + ageGroups10.map((ag, i) => { const m = maleAge.find(r => r.age_group === ag) || { patients: 0 }; const f = femaleAge.find(r => r.age_group === ag) || { patients: 0 }; return '<tr class="tr"><td class="px-4 py-2.5 font-semibold text-sm">' + ageLabels10[i] + '</td><td class="px-3 py-2.5 text-right text-sm text-blue-600">' + fmtNum(m.patients) + '</td><td class="px-3 py-2.5 text-right text-sm text-pink-600">' + fmtNum(f.patients) + '</td><td class="px-3 py-2.5 text-right font-bold text-sm">' + fmtNum(m.patients + f.patients) + '</td></tr>' }).join('') + '</tbody></table></div></div>';
  }
  if (tab === 'region') {
    const years = s.years, latestY = years[years.length - 1];
    return '<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">' +
      '<div class="lg:col-span-3 card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">' + latestY + '년 지역별</div><div style="height:320px"><canvas id="chart-region-bar"></canvas></div></div>' +
      '<div class="lg:col-span-2 card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">점유율</div><div style="height:320px"><canvas id="chart-region-pie"></canvas></div></div></div>' +
      '<div class="card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">주요 지역 추이</div><div style="height:300px"><canvas id="chart-region-trend"></canvas></div></div>';
  }
  if (tab === 'institution') {
    const years = s.years, latestY = years[years.length - 1];
    return '<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">' +
      '<div class="lg:col-span-3 card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">기관 종별 추이</div><div style="height:320px"><canvas id="chart-inst-trend"></canvas></div></div>' +
      '<div class="lg:col-span-2 card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">' + latestY + '년 비율</div><div style="height:320px"><canvas id="chart-inst-pie"></canvas></div></div></div>';
  }
  if (tab === 'amount') {
    const totalAmount = y.reduce((a, b) => a + b.amount, 0);
    return '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">' +
      '<div class="sc !p-4"><div class="text-[11px] text-slate-400 mb-1">6년간 총 진료금액</div><div class="text-[22px] font-extrabold text-slate-800">' + fmtAmount(totalAmount) + '</div></div>' +
      '<div class="sc !p-4"><div class="text-[11px] text-slate-400 mb-1">' + y[y.length - 1].year + '년</div><div class="text-[22px] font-extrabold text-brand-600">' + fmtAmount(y[y.length - 1].amount) + '</div></div>' +
      '<div class="sc !p-4"><div class="text-[11px] text-slate-400 mb-1">1인당 평균</div><div class="text-[22px] font-extrabold text-emerald-600">' + fmtAmount(y[y.length - 1].amount / y[y.length - 1].patients) + '</div></div></div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
      '<div class="card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">진료금액 추이</div><div style="height:300px"><canvas id="chart-amount-trend"></canvas></div></div>' +
      '<div class="card-flat p-4 lg:p-6"><div class="font-bold text-sm text-slate-800 mb-5">성별 금액 비교</div><div style="height:300px"><canvas id="chart-amount-gender"></canvas></div></div></div>';
  }
  return '';
}

function renderCIChartsForTab(tab, s) {
  Chart.defaults.font.family = 'Pretendard,sans-serif'; Chart.defaults.font.size = 11;
  const defs = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
  const years = s.years, y = s.yearly;
  const c10 = ['#818cf8', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#fb923c', '#ef4444'];
  const rc = ['#2563eb', '#059669', '#d97706', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#64748b', '#0ea5e9', '#a855f7', '#14b8a6', '#f43f5e', '#eab308', '#6366f1', '#10b981'];

  if (tab === 'overview') {
    ciCharts.push(new Chart(document.getElementById('chart-yearly'), { type: 'bar', data: { labels: y.map(d => d.year + '년'), datasets: [{ label: '사용량', data: y.map(d => d.usage), backgroundColor: 'rgba(51,102,255,0.7)', borderRadius: 8, barPercentage: 0.4, order: 2 }, { label: '환자수', data: y.map(d => d.patients), type: 'line', borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: '#10b981', fill: true, tension: 0.4, order: 1 }] }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 15 } } }, scales: { y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } } }));
    ciCharts.push(new Chart(document.getElementById('chart-gender'), { type: 'bar', data: { labels: y.map(d => d.year + '년'), datasets: [{ label: '남성', data: y.map(d => d.male_patients), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6, barPercentage: 0.6 }, { label: '여성', data: y.map(d => d.female_patients), backgroundColor: 'rgba(244,114,182,0.7)', borderRadius: 6, barPercentage: 0.6 }] }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 15 } } }, scales: { y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } } }));
  }
  if (tab === 'age') {
    const ag10 = ['0_9세', '10_19세', '20_29세', '30_39세', '40_49세', '50_59세', '60_69세', '70_79세', '80세이상'];
    const al10 = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80+'];
    const ds = ag10.map((ag, i) => ({ label: al10[i], data: years.map(yr => { const m = s.age10.find(r => r.year === yr && r.gender === '남' && r.age_group === ag); const f = s.age10.find(r => r.year === yr && r.gender === '여' && r.age_group === ag); return (m?.patients || 0) + (f?.patients || 0) }), backgroundColor: c10[i], borderRadius: 2, barPercentage: 0.7 }));
    ciCharts.push(new Chart(document.getElementById('chart-age10-trend'), { type: 'bar', data: { labels: years.map(y => y + '년'), datasets: ds }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 8, padding: 6, font: { size: 9 } } } }, scales: { y: { stacked: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { stacked: true, grid: { display: false } } } } }));
    const latestY = years[years.length - 1];
    const pieD = ag10.map(ag => { const m = s.age10.find(r => r.year === latestY && r.gender === '남' && r.age_group === ag); const f = s.age10.find(r => r.year === latestY && r.gender === '여' && r.age_group === ag); return (m?.patients || 0) + (f?.patients || 0) });
    ciCharts.push(new Chart(document.getElementById('chart-age10-pie'), { type: 'doughnut', data: { labels: al10, datasets: [{ data: pieD, backgroundColor: c10, borderWidth: 2, borderColor: '#fff' }] }, options: { ...defs, cutout: '50%', plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } } } } }));
    const firstY = years[0], span = latestY - firstY;
    const gd = ag10.map((ag, i) => { const fi = (s.age10.find(r => r.year === firstY && r.gender === '남' && r.age_group === ag)?.patients || 0) + (s.age10.find(r => r.year === firstY && r.gender === '여' && r.age_group === ag)?.patients || 0); const la = (s.age10.find(r => r.year === latestY && r.gender === '남' && r.age_group === ag)?.patients || 0) + (s.age10.find(r => r.year === latestY && r.gender === '여' && r.age_group === ag)?.patients || 0); return { label: al10[i], rate: fi === 0 ? (la > 0 ? 100 : 0) : (Math.pow(la / fi, 1 / span) - 1) * 100 } });
    ciCharts.push(new Chart(document.getElementById('chart-age-growth'), { type: 'bar', data: { labels: gd.map(d => d.label), datasets: [{ data: gd.map(d => +d.rate.toFixed(1)), backgroundColor: gd.map(d => d.rate >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'), borderRadius: 6, barPercentage: 0.6 }] }, options: { ...defs, indexAxis: 'y', scales: { x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: v => v + '%' } }, y: { grid: { display: false } } } } }));
  }
  if (tab === 'region') {
    const latestY = years[years.length - 1];
    const regL = s.region.filter(r => r.year === latestY && r.patients > 0).sort((a, b) => b.patients - a.patients);
    ciCharts.push(new Chart(document.getElementById('chart-region-bar'), { type: 'bar', data: { labels: regL.map(r => r.region), datasets: [{ data: regL.map(r => r.patients), backgroundColor: rc.slice(0, regL.length), borderRadius: 8, barPercentage: 0.6 }] }, options: { ...defs, scales: { y: { grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } } } }));
    ciCharts.push(new Chart(document.getElementById('chart-region-pie'), { type: 'doughnut', data: { labels: regL.map(r => r.region), datasets: [{ data: regL.map(r => r.patients), backgroundColor: rc.slice(0, regL.length), borderWidth: 2, borderColor: '#fff' }] }, options: { ...defs, cutout: '45%', plugins: { legend: { display: true, position: 'right', labels: { boxWidth: 8, padding: 6, font: { size: 9 } } } } } }));
    const top5 = regL.slice(0, 5).map(r => r.region);
    ciCharts.push(new Chart(document.getElementById('chart-region-trend'), { type: 'line', data: { labels: years.map(y => y + '년'), datasets: top5.map((reg, i) => ({ label: reg, data: years.map(yr => { const r = s.region.find(x => x.year === yr && x.region === reg); return r?.patients || 0 }), borderColor: rc[i], borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: rc[i], tension: 0.4, fill: false })) }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 15 } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } } }));
  }
  if (tab === 'institution') {
    const latestY = years[years.length - 1];
    const it = ['상급종합병원', '종합병원', '병원급', '의원급', '보건기관등'];
    const ic = ['#2563eb', '#059669', '#d97706', '#8b5cf6', '#94a3b8'];
    ciCharts.push(new Chart(document.getElementById('chart-inst-trend'), { type: 'line', data: { labels: years.map(y => y + '년'), datasets: it.filter(t => years.some(yr => s.institution.find(x => x.year === yr && x.institution_type === t && x.patients > 0))).map((t, i) => ({ label: t, data: years.map(yr => { const r = s.institution.find(x => x.year === yr && x.institution_type === t); return r?.patients || 0 }), borderColor: ic[i], borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: ic[i], tension: 0.4, fill: false })) }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } } }));
    const instL = s.institution.filter(r => r.year === latestY && r.patients > 0);
    ciCharts.push(new Chart(document.getElementById('chart-inst-pie'), { type: 'doughnut', data: { labels: instL.map(r => r.institution_type), datasets: [{ data: instL.map(r => r.patients), backgroundColor: ic.slice(0, instL.length), borderWidth: 2, borderColor: '#fff' }] }, options: { ...defs, cutout: '50%', plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12 } } } } }));
  }
  if (tab === 'amount') {
    ciCharts.push(new Chart(document.getElementById('chart-amount-trend'), { type: 'line', data: { labels: y.map(d => d.year + '년'), datasets: [{ label: '총 진료금액', data: y.map(d => d.amount), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#2563eb', fill: true, tension: 0.4 }] }, options: { ...defs, scales: { y: { beginAtZero: false, grid: { color: '#eef0f5' }, ticks: { callback: v => fmtAmount(v) } }, x: { grid: { display: false } } } } }));
    ciCharts.push(new Chart(document.getElementById('chart-amount-gender'), { type: 'bar', data: { labels: y.map(d => d.year + '년'), datasets: [{ label: '남성', data: y.map(d => d.male_amount), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 6, barPercentage: 0.6 }, { label: '여성', data: y.map(d => d.female_amount), backgroundColor: 'rgba(244,114,182,0.7)', borderRadius: 6, barPercentage: 0.6 }] }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10, padding: 15 } } }, scales: { y: { stacked: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: v => fmtAmount(v) } }, x: { stacked: true, grid: { display: false } } } } }));
  }
}

// ===== Year Comparison Modal =====
async function showCompare() {
  const s = window._ciData; if (!s) return;
  const years = s.years;
  openModal('기간 비교', '<div class="space-y-4"><div class="grid grid-cols-2 gap-4"><div><label class="input-label">비교 연도 1</label><select id="cmp-y1" class="input">' + years.map(y => '<option value="' + y + '"' + (y === years[0] ? ' selected' : '') + '>' + y + '년</option>').join('') + '</select></div><div><label class="input-label">비교 연도 2</label><select id="cmp-y2" class="input">' + years.map(y => '<option value="' + y + '"' + (y === years[years.length - 1] ? ' selected' : '') + '>' + y + '년</option>').join('') + '</select></div></div><button class="btn btn-primary w-full" onclick="runCompare()"><i class="fas fa-chart-column mr-1"></i>비교 분석</button><div id="cmp-result"></div></div>', true);
}
async function runCompare() {
  const y1 = document.getElementById('cmp-y1').value, y2 = document.getElementById('cmp-y2').value;
  try {
    const { data } = await API.get('/ci-stats/compare?year1=' + y1 + '&year2=' + y2); const d = data.data;
    const s1 = d.year1.summary, s2 = d.year2.summary;
    const pChange = s1 && s2 ? ((s2.patients - s1.patients) / s1.patients * 100).toFixed(1) : '—';
    const aChange = s1 && s2 ? ((s2.amount - s1.amount) / s1.amount * 100).toFixed(1) : '—';
    document.getElementById('cmp-result').innerHTML = '<div class="mt-4 space-y-3">' +
      '<div class="grid grid-cols-3 gap-3 text-center"><div class="sc !p-3"><div class="text-[10px] text-slate-400">항목</div></div><div class="sc !p-3"><div class="text-[10px] text-slate-400">' + y1 + '년</div></div><div class="sc !p-3"><div class="text-[10px] text-slate-400">' + y2 + '년</div></div></div>' +
      '<div class="grid grid-cols-3 gap-3 text-center"><div class="text-sm font-semibold text-slate-600 py-2">환자수</div><div class="text-sm font-bold text-slate-800 py-2">' + fmtNum(s1?.patients || 0) + '</div><div class="text-sm font-bold text-brand-600 py-2">' + fmtNum(s2?.patients || 0) + ' <span class="text-[10px] ' + (pChange > 0 ? 'text-emerald-500' : 'text-red-500') + '">' + (pChange > 0 ? '+' : '') + pChange + '%</span></div></div>' +
      '<div class="grid grid-cols-3 gap-3 text-center"><div class="text-sm font-semibold text-slate-600 py-2">진료금액</div><div class="text-sm font-bold text-slate-800 py-2">' + fmtAmount(s1?.amount || 0) + '</div><div class="text-sm font-bold text-brand-600 py-2">' + fmtAmount(s2?.amount || 0) + ' <span class="text-[10px] ' + (aChange > 0 ? 'text-emerald-500' : 'text-red-500') + '">' + (aChange > 0 ? '+' : '') + aChange + '%</span></div></div>' +
      '</div>';
  } catch (e) { toast('비교 데이터를 불러올 수 없습니다', 'err') }
}

// ===== Cross Analysis Modal =====
async function showCrossAnalysis() {
  openModal('CI 통계 × CRM 교차 분석', '<div id="cross-loading" class="text-center py-8 text-slate-400"><i class="fas fa-spinner fa-spin text-2xl mb-2 block"></i>분석 중...</div>', true);
  try {
    const { data } = await API.get('/ci-stats/cross-analysis'); const d = data.data;
    document.getElementById('modal-body').innerHTML = '<div class="space-y-4">' +
      '<div class="bg-brand-50 rounded-xl p-4"><div class="text-sm font-bold text-brand-800 mb-1">CRM 커버리지: ' + d.crmCoverage + '%</div><div class="text-xs text-brand-600">' + d.year + '년 기준 | 전체 CI 환자 ' + fmtNum(d.totalCIPatients) + '명 중 관리 병원 소재 지역</div></div>' +
      (d.uncovered.length ? '<div class="bg-red-50 rounded-xl p-4"><div class="text-sm font-bold text-red-800 mb-2"><i class="fas fa-exclamation-triangle mr-1"></i>미커버 성장 지역</div>' + d.uncovered.map(u => '<div class="flex items-center justify-between py-1.5 border-b border-red-100 last:border-0"><span class="text-sm font-semibold text-red-700">' + u.region + '</span><span class="text-sm text-red-600">' + fmtNum(u.ciPatients) + '명 (' + u.ciShare.toFixed(1) + '%)</span></div>').join('') + '</div>' : '') +
      '<div class="card-flat overflow-hidden"><div class="table-wrap"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100"><th class="px-4 py-2 text-left">지역</th><th class="px-3 py-2 text-right">CI 환자</th><th class="px-3 py-2 text-right">점유율</th><th class="px-3 py-2 text-right">관리 병원</th><th class="px-3 py-2 text-center">상태</th></tr></thead>' +
      '<tbody class="divide-y divide-gray-50">' + d.regions.map(r => '<tr class="tr"><td class="px-4 py-2 font-semibold text-sm">' + r.region + '</td><td class="px-3 py-2 text-right text-sm">' + fmtNum(r.ciPatients) + '</td><td class="px-3 py-2 text-right text-sm">' + r.ciShare.toFixed(1) + '%</td><td class="px-3 py-2 text-right text-sm font-bold ' + (r.crmHospitals > 0 ? 'text-brand-600' : 'text-slate-300') + '">' + r.crmHospitals + '</td><td class="px-3 py-2 text-center">' + (r.crmHospitals > 0 ? '<span class="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">커버</span>' : (r.ciPatients > 0 ? '<span class="text-[10px] text-red-600 bg-red-50 px-2 py-0.5 rounded-full font-bold">미커버</span>' : '-')) + '</td></tr>').join('') +
      '</tbody></table></div></div></div>';
  } catch (e) { document.getElementById('modal-body').innerHTML = '<div class="text-center py-8 text-red-400">분석 데이터를 불러올 수 없습니다</div>' }
}

// Known clinics merged into KNOWN_HOSPITALS (type: 'clinic')
// See KNOWN_HOSPITALS array above — clinic entries have type: 'clinic'

// ===== Calendar View =====
function showCalendarView() {
  var meets = window._meetList || [];
  var now = new Date();
  var year = now.getFullYear(), month = now.getMonth();
  
  function renderCal(y, m) {
    var firstDay = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    var dayLabels = ['일', '월', '화', '수', '목', '금', '토'];
    
    // Group meetings by date
    var meetMap = {};
    meets.forEach(function(mt) {
      if (!mt.meeting_date) return;
      var d = mt.meeting_date.substring(0, 10);
      if (!meetMap[d]) meetMap[d] = [];
      meetMap[d].push(mt);
    });
    
    var html = '<div class="flex items-center justify-between mb-4">' +
      '<button class="btn btn-ghost btn-sm" onclick="navigateCal(' + y + ',' + (m-1) + ')"><i class="fas fa-chevron-left"></i></button>' +
      '<span class="font-bold text-slate-800">' + y + '년 ' + monthNames[m] + '</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="navigateCal(' + y + ',' + (m+1) + ')"><i class="fas fa-chevron-right"></i></button></div>';
    html += '<div class="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold mb-2">' +
      dayLabels.map(function(dl, i) { return '<div class="' + (i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-slate-400') + '">' + dl + '</div>'; }).join('') + '</div>';
    html += '<div class="grid grid-cols-7 gap-0.5">';
    for (var i = 0; i < firstDay; i++) html += '<div class="h-16 lg:h-24"></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dayMeets = meetMap[dateStr] || [];
      var isToday = dateStr === new Date().toISOString().split('T')[0];
      var dow = new Date(y, m, d).getDay();
      var isSun = dow === 0, isSat = dow === 6;
      html += '<div class="h-16 lg:h-24 border border-gray-50 rounded-lg p-1 ' + 
        (isToday ? 'bg-brand-50 border-brand-200' : isSun ? 'bg-red-50/30' : isSat ? 'bg-blue-50/30' : 'hover:bg-gray-50') + 
        ' overflow-hidden cursor-pointer" onclick="showDayMeets(\'' + dateStr + '\')">' +
        '<div class="text-[11px] font-semibold ' + (isToday ? 'text-brand-600' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-slate-600') + '">' + d + '</div>';
      dayMeets.slice(0, 3).forEach(function(mt) {
        var tc = { visit: 'blue', phone: 'emerald', conference: 'violet', email: 'amber', online: 'indigo' };
        html += '<div class="text-[8px] lg:text-[9px] truncate rounded px-1 py-0.5 bg-' + (tc[mt.meeting_type] || 'slate') + '-50 text-' + (tc[mt.meeting_type] || 'slate') + '-600 font-medium mt-0.5">' + meetDoctorNames(mt) + '</div>';
      });
      if (dayMeets.length > 3) html += '<div class="text-[8px] text-slate-400 mt-0.5">+' + (dayMeets.length - 3) + '건</div>';
      html += '</div>';
    }
    html += '</div>';
    // Stats summary
    var totalThisMonth = Object.values(meetMap).reduce(function(s, arr) { return s + arr.length; }, 0);
    html += '<div class="flex items-center justify-between mt-4 text-[11px] text-slate-400">' +
      '<span><i class="fas fa-calendar-check mr-1"></i>이번 달 미팅: <strong class="text-slate-700">' + totalThisMonth + '건</strong></span>' +
      '<span class="flex items-center gap-3">' +
      '<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-blue-400"></span>방문</span>' +
      '<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-emerald-400"></span>전화</span>' +
      '<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-violet-400"></span>학회</span>' +
      '</span></div>';
    document.getElementById('cal-body').innerHTML = html;
  }
  
  window.navigateCal = function(y, m) {
    if (m < 0) { y--; m = 11; }
    if (m > 11) { y++; m = 0; }
    year = y; month = m;
    renderCal(y, m);
  };
  
  window.showDayMeets = function(dateStr) {
    var dayMeets = (window._meetList || []).filter(function(m) { return m.meeting_date === dateStr; });
    var meetDay = new Date(dateStr + 'T00:00:00');
    var dayIdx = (meetDay.getDay() + 6) % 7; // 0=Mon...5=Sat
    var dayKr = dayIdx < 6 ? DAYS_KR[dayIdx] : '일';
    var dayKey = dayIdx >= 0 && dayIdx < 6 ? DAYS_KEY[dayIdx] : '';
    
    var html = '';
    // Show meetings
    if (dayMeets.length) {
      html += '<div class="space-y-2 mb-4">' + dayMeets.map(function(m) {
        // Get doctor schedule for this day
        var schedInfo = '';
        if (dayKey && m.doctors && m.doctors.length) {
          var hints = [];
          m.doctors.forEach(function(md) {
            if (!md.clinic_hours) return;
            var ch = parseClinicHours(md.clinic_hours);
            if (ch.mon && !ch.mon_am && typeof ch.mon === 'string') { var m2={}; DAYS_KEY.forEach(function(k){if(ch[k])m2[k+'_am']=ch[k];}); m2.notes=ch.notes||''; ch=m2; }
            var am = ch[dayKey + '_am'] || '', pm = ch[dayKey + '_pm'] || '';
            if (am || pm) {
              var isOff = am === '휴진' && (!pm || pm === '휴진');
              hints.push('<span class="text-[9px] px-1.5 py-0.5 rounded-full ' + (isOff ? 'bg-red-50 text-red-400' : 'bg-cyan-50 text-cyan-600') + '">' +
                md.name + ': ' + (am ? '오전 ' + am : '') + (am && pm ? ' / ' : '') + (pm ? '오후 ' + pm : '') + '</span>');
            }
          });
          if (hints.length) schedInfo = '<div class="flex flex-wrap gap-1 mt-1">' + hints.join('') + '</div>';
        }
        return '<div class="card-flat !p-3 cursor-pointer hover:shadow-md" onclick="closeModal();showMeetDetail(' + JSON.stringify(m).replace(/"/g, '&quot;') + ')">' +
          '<div class="flex items-center gap-2 mb-1">' + mtBadge(m.meeting_type) + '<span class="font-semibold text-xs text-slate-800">' + meetDoctorNames(m) + '</span></div>' +
          '<div class="text-[11px] text-slate-400">' + (m.hospital_name || '') + (m.purpose ? ' · ' + m.purpose : '') + '</div>' +
          schedInfo + '</div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="text-center py-4 text-sm text-slate-400"><i class="fas fa-calendar-xmark text-xl text-slate-200 mb-2 block"></i>이 날 미팅이 없습니다</div>';
    }
    openModal(fmtDate(dateStr) + ' (' + dayKr + ') 일정', html);
  };
  
  openModal('미팅 캘린더', '<div id="cal-body"></div>', 'wide');
  renderCal(year, month);
}

// ===== Meeting Templates =====
async function loadMeetTemplates(selectCallback) {
  try {
    var r = await API.get('/templates');
    return r.data.data || [];
  } catch(e) { return []; }
}

function insertTemplateSelector(formEl) {
  loadMeetTemplates().then(function(templates) {
    if (!templates.length) return;
    var templateHtml = '<div class="col-span-full"><label class="input-label">미팅 템플릿</label><select id="meet-template" class="input" onchange="applyMeetTemplate(this.value)"><option value="">-- 템플릿 선택 --</option>' +
      templates.map(function(t) { return '<option value="' + t.id + '" data-type="' + t.meeting_type + '" data-purpose="' + (t.purpose || '').replace(/"/g, '&quot;') + '" data-content="' + (t.content || '').replace(/"/g, '&quot;') + '">' + t.name + '</option>'; }).join('') +
      '</select></div>';
    var firstChild = formEl.querySelector('.col-span-full') || formEl.firstChild;
    var div = document.createElement('div');
    div.innerHTML = templateHtml;
    formEl.insertBefore(div.firstElementChild, firstChild);
    window._meetTemplates = templates;
  });
}
function applyMeetTemplate(tid) {
  var templates = window._meetTemplates || [];
  var t = templates.find(function(x) { return String(x.id) === String(tid); });
  if (!t) return;
  var typeEl = document.querySelector('#fm select[name="meeting_type"]');
  var purposeEl = document.querySelector('#fm input[name="purpose"]');
  var contentEl = document.querySelector('#fm textarea[name="content"]');
  if (typeEl && t.meeting_type) typeEl.value = t.meeting_type;
  if (purposeEl && t.purpose) purposeEl.value = t.purpose;
  if (contentEl && t.content) contentEl.value = t.content;
  toast('템플릿이 적용되었습니다');
}

// ===== Meeting Statistics Card =====
async function showMeetingStats(type, id) {
  openModal('미팅 통계', '<div class="text-center py-6"><i class="fas fa-spinner fa-spin text-xl text-slate-300"></i></div>');
  try {
    var params = type === 'doctor' ? 'doctor_id=' + id : 'hospital_id=' + id;
    var r = await API.get('/pipeline/meeting-stats?' + params);
    var d = r.data.data;
    var typeLabels = { visit: '방문', phone: '전화', conference: '학회', email: '이메일', online: '온라인' };
    var html = '<div class="space-y-5">';
    html += '<div class="grid grid-cols-2 gap-3"><div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">총 미팅</div><div class="text-xl font-extrabold text-slate-800">' + d.total + '<span class="text-xs text-slate-400 ml-0.5">건</span></div></div>';
    if (d.avgIntervalDays) html += '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">평균 주기</div><div class="text-xl font-extrabold text-brand-600">' + d.avgIntervalDays + '<span class="text-xs text-slate-400 ml-0.5">일</span></div></div>';
    else html += '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">유형별</div><div class="text-xl font-extrabold text-slate-800">' + (d.byType || []).length + '<span class="text-xs text-slate-400 ml-0.5">종</span></div></div>';
    html += '</div>';
    // Type breakdown
    if (d.byType && d.byType.length) {
      html += '<div><div class="text-xs font-bold text-slate-600 mb-2">유형별 분포</div><div class="space-y-2">';
      var maxCount = Math.max(...d.byType.map(function(t) { return t.count; }));
      d.byType.forEach(function(t) {
        var pct = maxCount > 0 ? (t.count / maxCount * 100) : 0;
        html += '<div class="flex items-center gap-3"><span class="text-xs text-slate-500 w-12 text-right">' + (typeLabels[t.meeting_type] || t.meeting_type) + '</span><div class="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden"><div class="bg-brand-400 h-full rounded-full flex items-center px-2 transition-all" style="width:' + Math.max(pct, 15) + '%"><span class="text-[10px] font-bold text-white">' + t.count + '</span></div></div></div>';
      });
      html += '</div></div>';
    }
    // Monthly heatmap
    if (d.byMonth && d.byMonth.length) {
      html += '<div><div class="text-xs font-bold text-slate-600 mb-2">월별 미팅 빈도 (최근 12개월)</div><div class="flex flex-wrap gap-1">';
      d.byMonth.forEach(function(m) {
        var intensity = Math.min(m.count / 5, 1);
        var bgColor = m.count === 0 ? '#f1f5f9' : 'rgba(51,102,255,' + (0.2 + intensity * 0.8) + ')';
        var textColor = m.count > 2 ? '#fff' : '#64748b';
        html += '<div class="w-12 h-12 rounded-lg flex flex-col items-center justify-center text-[10px] font-semibold" style="background:' + bgColor + ';color:' + textColor + '"><span>' + m.month.split('-')[1] + '월</span><span class="text-[9px]">' + m.count + '건</span></div>';
      });
      html += '</div></div>';
    }
    html += '</div>';
    document.getElementById('modal-body').innerHTML = html;
  } catch(e) { document.getElementById('modal-body').innerHTML = '<div class="text-center text-red-400 py-4">통계를 불러올 수 없습니다</div>'; }
}

// ===== Tags System =====
async function showTagManager(entityType, entityId) {
  try {
    var [allTags, entityTags] = await Promise.all([API.get('/tags'), API.get('/tags/' + entityType + '/' + entityId)]);
    var all = allTags.data.data || [];
    var current = new Set((entityTags.data.data || []).map(function(t) { return t.id; }));
    var html = '<div class="space-y-3"><div class="text-xs font-semibold text-slate-600 mb-2">태그 관리</div><div class="flex flex-wrap gap-2">';
    all.forEach(function(tag) {
      var isActive = current.has(tag.id);
      html += '<button class="tag-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition ' + 
        (isActive ? 'text-white shadow-sm' : 'bg-gray-100 text-slate-500 hover:bg-gray-200') + '" ' +
        'style="' + (isActive ? 'background:' + tag.color : '') + '" ' +
        'onclick="toggleTag(\'' + entityType + '\',' + entityId + ',' + tag.id + ',this,\'' + tag.color + '\')">' +
        '<i class="fas ' + (isActive ? 'fa-check' : 'fa-tag') + ' text-[9px]"></i>' + tag.name + '</button>';
    });
    html += '</div><div class="mt-3 pt-3 border-t border-gray-50"><button class="btn btn-ghost btn-sm text-xs w-full" onclick="showNewTagForm(\'' + entityType + '\',' + entityId + ')"><i class="fas fa-plus mr-1"></i>새 태그 만들기</button></div></div>';
    openModal('태그', html, 'narrow');
  } catch(e) { toast('태그 불러오기 실패', 'err'); }
}
async function toggleTag(entityType, entityId, tagId, btn, color) {
  try {
    var isActive = btn.style.background && btn.style.background !== '';
    if (isActive) {
      await API.delete('/tags/' + entityType + '/' + entityId + '/' + tagId);
      btn.style.background = '';
      btn.className = btn.className.replace('text-white shadow-sm', 'bg-gray-100 text-slate-500 hover:bg-gray-200');
      btn.querySelector('i').className = 'fas fa-tag text-[9px]';
    } else {
      await API.post('/tags/' + entityType + '/' + entityId, { tag_id: tagId });
      btn.style.background = color;
      btn.className = btn.className.replace('bg-gray-100 text-slate-500 hover:bg-gray-200', 'text-white shadow-sm');
      btn.querySelector('i').className = 'fas fa-check text-[9px]';
    }
  } catch(e) { toast('태그 처리 실패', 'err'); }
}
function showNewTagForm(entityType, entityId) {
  var colors = ['#7c3aed','#059669','#dc2626','#3b82f6','#d97706','#0891b2','#8b5cf6','#ec4899','#14b8a6','#64748b'];
  var html = '<form id="tag-fm" class="space-y-3"><div><label class="input-label">태그 이름</label><input name="name" class="input" placeholder="예: CI 관심" required></div>' +
    '<div><label class="input-label">색상</label><div class="flex flex-wrap gap-2">' + colors.map(function(c, i) {
      return '<label class="cursor-pointer"><input type="radio" name="color" value="' + c + '"' + (i === 0 ? ' checked' : '') + ' class="hidden peer"><div class="w-7 h-7 rounded-full border-2 border-transparent peer-checked:border-slate-800 peer-checked:ring-2 peer-checked:ring-offset-1 transition" style="background:' + c + '"></div></label>';
    }).join('') + '</div></div>' +
    '<div class="flex justify-end gap-2"><button type="button" onclick="showTagManager(\'' + entityType + '\',' + entityId + ')" class="btn btn-outline btn-sm">뒤로</button><button type="submit" class="btn btn-primary btn-sm">생성</button></div></form>';
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('tag-fm').onsubmit = async function(e) {
    e.preventDefault();
    var f = Object.fromEntries(new FormData(e.target));
    try {
      await API.post('/tags', f);
      toast('태그 생성됨');
      showTagManager(entityType, entityId);
    } catch(e) { toast('태그 생성 실패', 'err'); }
  };
}

// ===== Doctor Transfer =====
async function showTransferForm(doctorId) {
  var doc = window._docProfile;
  if (!doc) return;
  try {
    var hosps = (await API.get('/hospitals')).data.data || [];
    var hospOpts = hosps.filter(function(h) { return h.id !== doc.hospital_id && h.status === 'active'; })
      .map(function(h) { return '<option value="' + h.id + '">' + h.name + ' (' + (h.region || '') + ')</option>'; }).join('');
    openModal('의료진 이적', '<form id="fm" class="space-y-4">' +
      '<div class="bg-blue-50 rounded-xl p-3 text-sm text-blue-700"><i class="fas fa-info-circle mr-1"></i><strong>' + doc.name + '</strong>을(를) ' + (doc.hospital_name || '') + '에서 다른 기관으로 이적합니다.</div>' +
      '<div><label class="input-label">이적 대상 기관</label><select name="to_hospital_id" class="input" required><option value="">-- 기관 선택 --</option>' + hospOpts + '</select></div>' +
      '<div><label class="input-label">이적 메모</label><textarea name="notes" class="input" placeholder="이적 사유"></textarea></div>' +
      '<div class="flex justify-end gap-2 pt-3 border-t"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">이적 처리</button></div></form>');
    document.getElementById('fm').onsubmit = async function(e) {
      e.preventDefault();
      var f = Object.fromEntries(new FormData(e.target));
      if (!f.to_hospital_id) { toast('대상 기관을 선택하세요', 'warn'); return; }
      try {
        await API.post('/pipeline/transfer-doctor', { doctor_id: doctorId, to_hospital_id: f.to_hospital_id, notes: f.notes });
        toast('이적 처리 완료'); closeModal(); viewDocProfile(doctorId);
      } catch(e) { toast('이적 처리 실패', 'err'); }
    };
  } catch(e) { toast('데이터 불러오기 실패', 'err'); }
}

// ===== Search History in Search Box =====
function showSearchHistory() {
  if (!_searchHistory.length) return;
  var el = document.getElementById('search-results');
  var html = '<div class="search-cat"><i class="fas fa-clock mr-1"></i>최근 검색</div>';
  _searchHistory.forEach(function(q) {
    html += '<div class="search-item" onclick="document.getElementById(\'global-search\').value=\'' + q.replace(/'/g, "\\'") + '\';onGlobalSearch(\'' + q.replace(/'/g, "\\'") + '\')"><div class="si-icon bg-gray-50 text-gray-400"><i class="fas fa-clock"></i></div><div class="text-sm text-slate-500">' + q + '</div></div>';
  });
  el.innerHTML = html;
  el.classList.remove('hidden');
}

// ===== Clinic Hours (외래 시간) - Enhanced AM/PM Structure =====
var DAYS_KR = ['월', '화', '수', '목', '금', '토'];
var DAYS_KEY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var SLOT_OPTIONS = [
  { v: '', l: '-' },
  { v: '진료', l: '진료' },
  { v: '수술', l: '수술' },
  { v: '순환진료', l: '순환진료' },
  { v: '오전진료', l: '오전진료' },
  { v: '오후진료', l: '오후진료' },
  { v: '휴진', l: '휴진' },
  { v: '검사', l: '검사' },
  { v: '학회', l: '학회' },
  { v: 'custom', l: '직접입력' }
];
function parseClinicHours(str) {
  try { if (str) return JSON.parse(str); } catch(e) {}
  return {};
}
function clinicHoursEditor(val) {
  var h = parseClinicHours(val);
  // New structure: { mon_am: "진료", mon_pm: "수술", tue_am: "", ... , notes: "4월7일(화)휴진", specials: "" }
  // Backward compat: if old format (mon: "09-12"), migrate
  var isOldFormat = h.mon && !h.mon_am && typeof h.mon === 'string' && h.mon.includes('-');
  if (isOldFormat) {
    var migrated = {};
    DAYS_KEY.forEach(function(k) {
      if (h[k]) { migrated[k + '_am'] = '진료'; migrated[k + '_pm'] = ''; }
    });
    migrated.notes = h.notes || '';
    h = migrated;
  }
  var html = '<div class="border border-gray-200 rounded-xl overflow-hidden">';
  // Header
  html += '<div class="grid grid-cols-7 bg-slate-50 border-b border-gray-200">';
  html += '<div class="p-2 text-[10px] font-bold text-slate-400 text-center"></div>';
  DAYS_KR.forEach(function(d, i) {
    var isSat = i === 5;
    html += '<div class="p-2 text-[10px] font-bold text-center ' + (isSat ? 'text-blue-500' : 'text-slate-600') + '">' + d + '</div>';
  });
  html += '</div>';
  // AM row
  html += '<div class="grid grid-cols-7 border-b border-gray-100">';
  html += '<div class="p-2 text-[10px] font-bold text-amber-600 text-center bg-amber-50/50 flex items-center justify-center">오전</div>';
  DAYS_KEY.forEach(function(k) {
    var v = h[k + '_am'] || '';
    html += '<div class="p-1"><select id="ch-' + k + '-am" class="w-full text-[11px] py-1.5 px-1 border border-gray-100 rounded-lg text-center focus:border-cyan-400 focus:outline-none bg-white cursor-pointer" onchange="onChSelect(this,\'' + k + '_am\')">';
    SLOT_OPTIONS.forEach(function(o) { html += '<option value="' + o.v + '"' + (v === o.v ? ' selected' : '') + '>' + o.l + '</option>'; });
    if (v && !SLOT_OPTIONS.find(function(o) { return o.v === v; })) {
      html += '<option value="' + v + '" selected>' + v + '</option>';
    }
    html += '</select>';
    html += '<input type="text" id="chi-' + k + '-am" class="w-full text-[10px] py-1 px-1 border border-cyan-200 rounded mt-0.5 text-center hidden" placeholder="입력" value="' + (v && !SLOT_OPTIONS.find(function(o){ return o.v === v && o.v !== 'custom'; }) ? v : '') + '" onblur="onChCustom(this,\'' + k + '_am\')">';
    html += '</div>';
  });
  html += '</div>';
  // PM row
  html += '<div class="grid grid-cols-7 border-b border-gray-100">';
  html += '<div class="p-2 text-[10px] font-bold text-indigo-600 text-center bg-indigo-50/50 flex items-center justify-center">오후</div>';
  DAYS_KEY.forEach(function(k) {
    var v = h[k + '_pm'] || '';
    html += '<div class="p-1"><select id="ch-' + k + '-pm" class="w-full text-[11px] py-1.5 px-1 border border-gray-100 rounded-lg text-center focus:border-cyan-400 focus:outline-none bg-white cursor-pointer" onchange="onChSelect(this,\'' + k + '_pm\')">';
    SLOT_OPTIONS.forEach(function(o) { html += '<option value="' + o.v + '"' + (v === o.v ? ' selected' : '') + '>' + o.l + '</option>'; });
    if (v && !SLOT_OPTIONS.find(function(o) { return o.v === v; })) {
      html += '<option value="' + v + '" selected>' + v + '</option>';
    }
    html += '</select>';
    html += '<input type="text" id="chi-' + k + '-pm" class="w-full text-[10px] py-1 px-1 border border-cyan-200 rounded mt-0.5 text-center hidden" placeholder="입력" value="' + (v && !SLOT_OPTIONS.find(function(o){ return o.v === v && o.v !== 'custom'; }) ? v : '') + '" onblur="onChCustom(this,\'' + k + '_pm\')">';
    html += '</div>';
  });
  html += '</div>';
  // Notes row (special dates like 휴진 etc)
  html += '<div class="p-2 bg-gray-50"><input type="text" id="ch-notes" value="' + ((h.notes || '').replace(/"/g, '&quot;')) + '" class="input !text-[11px] !py-1.5 !bg-white" placeholder="특이사항 (예: 4월7일(화)휴진, 격주 토요일 오전만)"></div>';
  html += '</div>';
  return html;
}
function onChSelect(sel, key) {
  var customInput = document.getElementById('chi-' + key.replace('_', '-'));
  if (sel.value === 'custom') {
    if (customInput) { customInput.classList.remove('hidden'); customInput.focus(); }
  } else {
    if (customInput) customInput.classList.add('hidden');
  }
}
function onChCustom(inp, key) {
  var sel = document.getElementById('ch-' + key.replace('_', '-'));
  if (inp.value.trim()) {
    // Add as custom option and select it
    var exists = false;
    for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === inp.value.trim()) { exists = true; sel.selectedIndex = i; break; } }
    if (!exists) {
      var opt = document.createElement('option');
      opt.value = inp.value.trim();
      opt.text = inp.value.trim();
      sel.add(opt);
      sel.value = inp.value.trim();
    }
    inp.classList.add('hidden');
  } else {
    sel.value = '';
    inp.classList.add('hidden');
  }
}
function collectClinicHours() {
  var obj = {};
  var hasAny = false;
  DAYS_KEY.forEach(function(k) {
    ['am', 'pm'].forEach(function(period) {
      var sel = document.getElementById('ch-' + k + '-' + period);
      var customInp = document.getElementById('chi-' + k + '-' + period);
      var val = '';
      if (sel) {
        if (sel.value === 'custom' && customInp && customInp.value.trim()) {
          val = customInp.value.trim();
        } else if (sel.value && sel.value !== 'custom') {
          val = sel.value;
        }
      }
      if (val) { obj[k + '_' + period] = val; hasAny = true; }
    });
  });
  var notesEl = document.getElementById('ch-notes');
  if (notesEl && notesEl.value.trim()) { obj.notes = notesEl.value.trim(); hasAny = true; }
  return hasAny ? JSON.stringify(obj) : '';
}
function renderClinicHours(str) {
  var h = parseClinicHours(str);
  if (!h || Object.keys(h).length === 0) return '';
  // Backward compat for old format
  var isOldFormat = h.mon && !h.mon_am && typeof h.mon === 'string';
  if (isOldFormat) {
    var migrated = {};
    DAYS_KEY.forEach(function(k) {
      if (h[k]) { migrated[k + '_am'] = h[k]; migrated[k + '_pm'] = ''; }
    });
    migrated.notes = h.notes || '';
    h = migrated;
  }
  var hasAnyDay = DAYS_KEY.some(function(k) { return h[k + '_am'] || h[k + '_pm']; });
  if (!hasAnyDay && !h.notes) return '';
  
  var slotColor = function(v) {
    if (!v) return { bg: 'bg-gray-100', text: 'text-gray-400', border: 'border-gray-200', icon: '<i class="fas fa-ban text-[8px] mr-0.5"></i>' };
    if (v === '진료') return { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-100', icon: '<i class="fas fa-stethoscope text-[8px] mr-0.5"></i>' };
    if (v === '수술') return { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-100', icon: '<i class="fas fa-scissors text-[8px] mr-0.5"></i>' };
    if (v === '휴진') return { bg: 'bg-gray-100', text: 'text-gray-400', border: 'border-gray-200', icon: '<i class="fas fa-ban text-[8px] mr-0.5"></i>' };
    if (v === '순환진료') return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100', icon: '<i class="fas fa-rotate text-[8px] mr-0.5"></i>' };
    if (v.includes('검사')) return { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100', icon: '<i class="fas fa-microscope text-[8px] mr-0.5"></i>' };
    return { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', icon: '' };
  };
  // 빈 값은 휴진으로 정규화
  var normSlot = function(v) { return (v == null || String(v).trim() === '') ? '휴진' : String(v); };
  
  var html = '<div class="card-flat p-4 lg:p-5"><div class="flex items-center gap-2 mb-3"><div class="w-7 h-7 rounded-lg bg-cyan-50 flex items-center justify-center"><i class="fas fa-calendar-days text-cyan-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">외래 시간</span></div>';
  // Table layout
  html += '<div class="border border-gray-100 rounded-xl overflow-hidden">';
  // Header
  html += '<div class="grid grid-cols-7 bg-slate-50 border-b border-gray-100">';
  html += '<div class="p-1.5 text-[9px] font-bold text-slate-400 text-center"></div>';
  DAYS_KR.forEach(function(d, i) {
    html += '<div class="p-1.5 text-[10px] font-bold text-center ' + (i === 5 ? 'text-blue-500' : 'text-slate-600') + '">' + d + '</div>';
  });
  html += '</div>';
  // AM row
  html += '<div class="grid grid-cols-7 border-b border-gray-50">';
  html += '<div class="p-1.5 text-[9px] font-bold text-amber-500 text-center bg-amber-50/40 flex items-center justify-center">오전</div>';
  DAYS_KEY.forEach(function(k) {
    var v = normSlot(h[k + '_am']);
    var c = slotColor(v);
    html += '<div class="p-1"><div class="' + c.bg + ' ' + c.text + ' border ' + c.border + ' rounded-lg text-center py-1.5 text-[10px] font-semibold leading-none">' + c.icon + v + '</div></div>';
  });
  html += '</div>';
  // PM row
  html += '<div class="grid grid-cols-7">';
  html += '<div class="p-1.5 text-[9px] font-bold text-indigo-500 text-center bg-indigo-50/40 flex items-center justify-center">오후</div>';
  DAYS_KEY.forEach(function(k) {
    var v = normSlot(h[k + '_pm']);
    var c = slotColor(v);
    html += '<div class="p-1"><div class="' + c.bg + ' ' + c.text + ' border ' + c.border + ' rounded-lg text-center py-1.5 text-[10px] font-semibold leading-none">' + c.icon + v + '</div></div>';
  });
  html += '</div></div>';
  if (h.notes) html += '<div class="text-[11px] text-amber-700 mt-2.5 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100"><i class="fas fa-exclamation-circle text-amber-400 mr-1"></i>' + h.notes + '</div>';
  html += '</div>';
  return html;
}
// Compact inline version for meeting timeline
function renderClinicHoursCompact(str) {
  var h = parseClinicHours(str);
  if (!h || Object.keys(h).length === 0) return '';
  var isOldFormat = h.mon && !h.mon_am && typeof h.mon === 'string';
  if (isOldFormat) {
    var migrated = {};
    DAYS_KEY.forEach(function(k) { if (h[k]) { migrated[k + '_am'] = h[k]; } });
    migrated.notes = h.notes || '';
    h = migrated;
  }
  var parts = [];
  DAYS_KEY.forEach(function(k, i) {
    var am = h[k + '_am'] || '', pm = h[k + '_pm'] || '';
    if (am || pm) {
      var label = DAYS_KR[i];
      var detail = [];
      if (am && am !== '휴진') detail.push('오전' + (am !== '진료' ? '(' + am + ')' : ''));
      if (pm && pm !== '휴진') detail.push('오후' + (pm !== '진료' ? '(' + pm + ')' : ''));
      if (am === '휴진' && pm === '휴진') detail.push('휴진');
      else if (am === '휴진') detail.push('오후만');
      else if (pm === '휴진') detail.push('오전만');
      parts.push(label + ':' + detail.join('/'));
    }
  });
  if (!parts.length) return '';
  return '<div class="text-[10px] text-cyan-600 bg-cyan-50 rounded-lg px-2.5 py-1.5 border border-cyan-100 mt-1.5">' +
    '<i class="fas fa-calendar-days text-cyan-400 mr-1"></i>' + parts.join(' · ') +
    (h.notes ? ' <span class="text-amber-600">(' + h.notes + ')</span>' : '') + '</div>';
}

// ===== Init =====
initAuth();

// ===== Online/Offline Detection =====
window.addEventListener('online', () => { _offlineMode = false; toast('온라인 상태 복구', 'ok'); if (curPage) nav(curPage); });
window.addEventListener('offline', () => { _offlineMode = true; toast('오프라인 모드 — 캐시된 데이터로 표시', 'warn'); });

// ===== Pull-to-Refresh =====
(function initPTR() {
  var content = document.getElementById('content');
  if (!content) return;
  var startY = 0, pulling = false, threshold = 80;
  content.addEventListener('touchstart', function(e) {
    if (content.scrollTop <= 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });
  content.addEventListener('touchmove', function(e) {
    if (!pulling) return;
    var diff = e.touches[0].clientY - startY;
    if (diff > 20 && content.scrollTop <= 0) {
      var ptr = document.getElementById('ptr-indicator');
      if (ptr) { ptr.style.display = 'flex'; ptr.style.transform = 'translateY(' + Math.min(diff * 0.4, threshold) + 'px)'; }
    }
  }, { passive: true });
  content.addEventListener('touchend', function(e) {
    if (!pulling) return;
    pulling = false;
    var ptr = document.getElementById('ptr-indicator');
    if (ptr && ptr.style.display === 'flex') {
      var transformVal = ptr.style.transform;
      var match = transformVal.match(/translateY\(([0-9.]+)px\)/);
      if (match && parseFloat(match[1]) >= threshold * 0.6) {
        ptr.style.transform = 'translateY(48px)';
        // Refresh current page
        var refreshFn = { dashboard: loadDash, hospitals: loadHosp, doctors: loadDoc, meetings: loadMeet }[curPage];
        if (refreshFn) refreshFn().finally(function() {
          setTimeout(function() { ptr.style.transform = 'translateY(-100%)'; setTimeout(function() { ptr.style.display = 'none'; }, 200); }, 500);
        });
        else { ptr.style.transform = 'translateY(-100%)'; setTimeout(function() { ptr.style.display = 'none'; }, 200); }
      } else {
        ptr.style.transform = 'translateY(-100%)';
        setTimeout(function() { ptr.style.display = 'none'; }, 200);
      }
    }
  }, { passive: true });
})();

// ===== Reminder Badge =====
function updateReminderBadge(count) {
  _reminderCount = count || 0;
  var badge = document.getElementById('bn-reminder-badge');
  if (badge) {
    if (_reminderCount > 0) { badge.textContent = _reminderCount; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }
}

// ===== Recent Search History =====
function addSearchHistory(q) {
  if (!q || q.length < 2) return;
  _searchHistory = _searchHistory.filter(function(s) { return s !== q; });
  _searchHistory.unshift(q);
  _searchHistory = _searchHistory.slice(0, 5);
  localStorage.setItem('todoc_search_history', JSON.stringify(_searchHistory));
}

// ===== Favorites =====
async function loadFavorites() {
  try { var r = await API.get('/favorites'); _favorites = new Set((r.data.data || []).map(function(f) { return f.entity_type + ':' + f.entity_id; })); } catch(e) {}
}
function isFavorited(type, id) { return _favorites.has(type + ':' + id); }
async function toggleFavorite(type, id) {
  try {
    var r = await API.post('/favorites/toggle', { entity_type: type, entity_id: id });
    var key = type + ':' + id;
    if (r.data.data.favorited) { _favorites.add(key); toast('즐겨찾기 추가'); } 
    else { _favorites.delete(key); toast('즐겨찾기 해제'); }
  } catch(e) { toast('즐겨찾기 처리 실패', 'err'); }
}
function favStar(type, id) {
  var isFav = isFavorited(type, id);
  return '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();toggleFavAndRefresh(\'' + type + '\',' + id + ')" title="' + (isFav ? '즐겨찾기 해제' : '즐겨찾기') + '">' +
    '<i class="fas fa-star ' + (isFav ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300') + '"></i></button>';
}
async function toggleFavAndRefresh(type, id) {
  await toggleFavorite(type, id);
  if (curPage === 'hospitals') filterH();
  else if (curPage === 'doctors') filterD();
}

// ===== Schedule Planner =====
var _scheduleRegions = [];
var _scheduleSuggestions = [];
var _scheduleTimeOrdered = [];
var _scheduleSelected = new Set();
var _scheduleVisitTimes = {}; // hospital_id -> 'am'|'pm'|'full'|''
var _scheduleSelectedDoctors = {}; // hospital_id -> Set of doctor_ids
var _schViewMode = 'time'; // 'time' or 'score'
var _schDayLabel = '';
var _schSelectedRegions = new Set();

// ===== Calendar (week / day / month) =====
var _calView = (localStorage.getItem('todoc_cal_view') || 'week'); // 'day' | 'week' | 'month'
var _calAnchor = new Date(); // anchor date in current view
var _calStartHour = 8;  // 08:00
var _calEndHour = 20;   // 20:00 (exclusive end at 20:00 displayed)
var _calSlotMin = 30;   // 30-minute slots
var _calMeetings = [];  // currently loaded meetings for the visible range

function _calFmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function _calParseDate(s) {
  if (!s) return null;
  var parts = String(s).split('-');
  if (parts.length < 3) return null;
  return new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
}
function _calStartOfWeek(d) {
  // Week starts on Monday
  var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var dow = x.getDay(); // 0=Sun..6=Sat
  var diff = (dow === 0 ? -6 : 1 - dow);
  x.setDate(x.getDate() + diff);
  return x;
}
function _calRangeForView() {
  var from, to;
  if (_calView === 'day') {
    from = new Date(_calAnchor.getFullYear(), _calAnchor.getMonth(), _calAnchor.getDate());
    to = new Date(from); to.setDate(to.getDate());
  } else if (_calView === 'week') {
    from = _calStartOfWeek(_calAnchor);
    to = new Date(from); to.setDate(to.getDate() + 6);
  } else { // month
    from = new Date(_calAnchor.getFullYear(), _calAnchor.getMonth(), 1);
    to = new Date(_calAnchor.getFullYear(), _calAnchor.getMonth()+1, 0);
  }
  return { from: from, to: to };
}
function _calMinFromTime(t) {
  if (!t) return null;
  var parts = String(t).split(':');
  if (parts.length < 2) return null;
  return Number(parts[0]) * 60 + Number(parts[1]);
}
function _calTimeFromMin(min) {
  var h = Math.floor(min / 60);
  var m = min % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
function _calVtRangeMinutes(vt) {
  // Default visit_time → minute range
  if (vt === 'am') return [9*60, 10*60];
  if (vt === 'pm') return [14*60, 15*60];
  if (vt === 'full') return [9*60, 18*60];
  return null;
}
function _calTypeColor(t) {
  return ({ visit:'#10b981', phone:'#3b82f6', conference:'#8b5cf6', email:'#f59e0b', online:'#6366f1' })[t] || '#64748b';
}
function _calTypeLabel(t) {
  return ({ visit:'방문', phone:'전화', conference:'학회', email:'이메일', online:'온라인' })[t] || (t || '미팅');
}

async function loadCalendar() {
  destroyCharts && destroyCharts();
  var c = document.getElementById('content');
  document.getElementById('page-title').textContent = '캘린더';
  document.getElementById('page-subtitle').textContent = '주간 · 일간 · 월간 일정 그리드';
  document.getElementById('header-actions').innerHTML =
    '<button class="btn btn-success btn-sm" onclick="showNewMeetGlobal()" aria-label="미팅 추가"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">미팅</span></button>';

  c.innerHTML =
    '<div class="p-3 lg:p-6 max-w-[1400px] mx-auto">' +
      '<div id="cal-toolbar" class="flex flex-wrap items-center gap-2 mb-3"></div>' +
      '<div id="cal-canvas" class="card-flat p-0 overflow-hidden"></div>' +
      '<div class="text-[10px] text-slate-400 mt-2 px-1"><i class="fas fa-circle-info mr-1"></i>이벤트를 다른 시간대로 끌어다 놓으면 미팅 일정이 자동으로 업데이트됩니다.</div>' +
    '</div>';

  await renderCalendar();
}

async function renderCalendar() {
  renderCalToolbar();
  var box = document.getElementById('cal-canvas');
  if (!box) return;
  box.innerHTML = '<div class="text-center py-12 text-slate-400"><i class="fas fa-spinner fa-spin text-xl"></i></div>';

  var range = _calRangeForView();
  try {
    var r = await API.get('/meetings?date_from=' + _calFmtDate(range.from) + '&date_to=' + _calFmtDate(range.to) + '&limit=500');
    _calMeetings = (r.data && r.data.data) || [];
  } catch (e) {
    _calMeetings = [];
  }

  if (_calView === 'day') renderCalDay();
  else if (_calView === 'week') renderCalWeek();
  else renderCalMonth();
}

function renderCalToolbar() {
  var bar = document.getElementById('cal-toolbar');
  if (!bar) return;
  var range = _calRangeForView();
  var rangeLabel;
  if (_calView === 'day') {
    var dn = ['일','월','화','수','목','금','토'][_calAnchor.getDay()];
    rangeLabel = _calAnchor.getFullYear() + '. ' + (_calAnchor.getMonth()+1) + '. ' + _calAnchor.getDate() + ' (' + dn + ')';
  } else if (_calView === 'week') {
    rangeLabel = (range.from.getMonth()+1) + '/' + range.from.getDate() + ' ~ ' + (range.to.getMonth()+1) + '/' + range.to.getDate() + ', ' + range.to.getFullYear();
  } else {
    rangeLabel = _calAnchor.getFullYear() + '년 ' + (_calAnchor.getMonth()+1) + '월';
  }

  bar.innerHTML =
    '<div class="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 dark:bg-[var(--surface-tertiary)]" role="tablist" aria-label="캘린더 뷰">' +
      ['day','week','month'].map(function(v){
        var lbl = ({day:'일간', week:'주간', month:'월간'})[v];
        var active = (_calView === v);
        return '<button role="tab" aria-selected="' + active + '" class="px-3 py-1.5 text-[12px] font-bold rounded-md transition ' + (active ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700') + '" onclick="setCalView(\'' + v + '\')">' + lbl + '</button>';
      }).join('') +
    '</div>' +
    '<div class="flex items-center gap-1 ml-1">' +
      '<button class="btn btn-outline btn-sm !px-2" onclick="calNav(-1)" aria-label="이전"><i class="fas fa-chevron-left text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" onclick="calToday()" aria-label="오늘로 이동"><i class="fas fa-calendar-day text-xs mr-1"></i>오늘</button>' +
      '<button class="btn btn-outline btn-sm !px-2" onclick="calNav(1)" aria-label="다음"><i class="fas fa-chevron-right text-xs"></i></button>' +
    '</div>' +
    '<div class="ml-2 font-bold text-sm text-slate-700 dark:text-[var(--gray-800)]">' + rangeLabel + '</div>' +
    '<div class="ml-auto text-[11px] text-slate-400">' + _calMeetings.length + '건</div>';
}

function setCalView(v) {
  _calView = v;
  localStorage.setItem('todoc_cal_view', v);
  renderCalendar();
}
function calNav(delta) {
  var d = new Date(_calAnchor);
  if (_calView === 'day') d.setDate(d.getDate() + delta);
  else if (_calView === 'week') d.setDate(d.getDate() + 7 * delta);
  else d.setMonth(d.getMonth() + delta);
  _calAnchor = d;
  renderCalendar();
}
function calToday() { _calAnchor = new Date(); renderCalendar(); }

function _calMeetingsForDate(dateStr) {
  return _calMeetings.filter(function(m) { return m.meeting_date === dateStr; });
}
function _calMeetingTimeRange(m) {
  var start = _calMinFromTime(m.start_time);
  var end = _calMinFromTime(m.end_time);
  if (start != null && end != null && end > start) return [start, end];
  if (start != null) return [start, start + 60];
  var vtRange = _calVtRangeMinutes(m.visit_time);
  if (vtRange) return vtRange;
  return [9*60, 10*60];
}

// ===== Week View =====
function renderCalWeek() {
  var box = document.getElementById('cal-canvas');
  if (!box) return;
  var range = _calRangeForView();
  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(range.from); d.setDate(d.getDate() + i);
    days.push(d);
  }
  var todayStr = _calFmtDate(new Date());
  var slotCount = ((_calEndHour - _calStartHour) * 60) / _calSlotMin;
  var slotPx = 28; // each 30-min slot = 28px tall

  // Header row
  var headHtml = '<div class="cal-grid-head" style="display:grid;grid-template-columns:60px repeat(7,1fr);border-bottom:1px solid var(--border-light);background:var(--surface-elevated);position:sticky;top:0;z-index:5">';
  headHtml += '<div class="cal-time-corner" style="border-right:1px solid var(--border-light)"></div>';
  days.forEach(function(d) {
    var dn = ['일','월','화','수','목','금','토'][d.getDay()];
    var ds = _calFmtDate(d);
    var isToday = (ds === todayStr);
    var isWeekend = (d.getDay() === 0 || d.getDay() === 6);
    var color = isToday ? 'var(--brand-500)' : (isWeekend ? '#f87171' : 'var(--gray-700)');
    headHtml += '<div class="cal-day-head" style="padding:10px 6px;text-align:center;border-right:1px solid var(--border-light);' + (isToday ? 'background:rgba(37,99,235,.05);' : '') + '">' +
      '<div class="text-[10px] font-bold" style="color:' + color + '">' + dn + '</div>' +
      '<div class="text-[16px] font-bold mt-0.5" style="color:' + color + '">' + d.getDate() + '</div>' +
      '<div class="text-[9px] text-slate-400 mt-0.5">' + _calMeetingsForDate(ds).length + '건</div>' +
    '</div>';
  });
  headHtml += '</div>';

  // Time grid body
  var gridStyle = 'display:grid;grid-template-columns:60px repeat(7,1fr);position:relative;background:var(--surface-primary)';
  var bodyHtml = '<div class="cal-grid-body" style="' + gridStyle + ';height:' + (slotCount * slotPx) + 'px">';

  // Time labels column
  bodyHtml += '<div class="cal-time-col" style="border-right:1px solid var(--border-light);position:relative">';
  for (var s = 0; s < slotCount; s++) {
    var min = _calStartHour * 60 + s * _calSlotMin;
    var label = (s % 2 === 0) ? _calTimeFromMin(min) : '';
    bodyHtml += '<div style="height:' + slotPx + 'px;border-bottom:1px dashed var(--border-light);text-align:right;padding-right:6px;font-size:10px;color:var(--gray-400);line-height:' + slotPx + 'px">' + label + '</div>';
  }
  bodyHtml += '</div>';

  // Day columns
  days.forEach(function(d, dayIdx) {
    var ds = _calFmtDate(d);
    var isWeekend = (d.getDay() === 0 || d.getDay() === 6);
    bodyHtml += '<div class="cal-day-col" data-date="' + ds + '" style="border-right:1px solid var(--border-light);position:relative;' + (isWeekend ? 'background:rgba(241,245,249,.4);' : '') + '">';
    // Slots (drop targets)
    for (var s2 = 0; s2 < slotCount; s2++) {
      var slotMin = _calStartHour * 60 + s2 * _calSlotMin;
      var topPx = s2 * slotPx;
      bodyHtml += '<div class="cal-slot" data-date="' + ds + '" data-min="' + slotMin + '"' +
        ' style="position:absolute;top:' + topPx + 'px;left:0;right:0;height:' + slotPx + 'px;border-bottom:1px dashed var(--border-light);cursor:pointer"' +
        ' ondragover="event.preventDefault();this.style.background=\'rgba(37,99,235,.08)\'"' +
        ' ondragleave="this.style.background=\'\'"' +
        ' ondrop="onCalDrop(event,\'' + ds + '\',' + slotMin + ')"' +
        ' onclick="onCalSlotClick(\'' + ds + '\',' + slotMin + ')"></div>';
    }
    // Meeting cards positioned absolutely
    var meets = _calMeetingsForDate(ds);
    meets.forEach(function(m) {
      var range = _calMeetingTimeRange(m);
      var startMin = Math.max(_calStartHour * 60, range[0]);
      var endMin = Math.min(_calEndHour * 60, range[1]);
      if (endMin <= startMin) return;
      var top = ((startMin - _calStartHour * 60) / _calSlotMin) * slotPx;
      var height = ((endMin - startMin) / _calSlotMin) * slotPx;
      var color = _calTypeColor(m.meeting_type);
      var label = _calTypeLabel(m.meeting_type);
      var hospName = (m.hospital_name || '').replace(/'/g, "&#39;").replace(/"/g, '&quot;');
      var purpose = (m.purpose || '').replace(/'/g, "&#39;").replace(/"/g, '&quot;');
      bodyHtml += '<div class="cal-event" draggable="true"' +
        ' data-meeting-id="' + m.id + '"' +
        ' style="position:absolute;left:3px;right:3px;top:' + top + 'px;height:' + Math.max(20, height - 2) + 'px;background:' + color + ';color:#fff;border-radius:6px;padding:3px 6px;font-size:10px;line-height:1.25;overflow:hidden;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,.15);z-index:2"' +
        ' ondragstart="onCalDragStart(event,' + m.id + ')"' +
        ' ondragend="onCalDragEnd(event)"' +
        ' onclick="event.stopPropagation();openCalMeeting(' + m.id + ')"' +
        ' title="' + hospName + ' - ' + purpose + '">' +
        '<div class="font-bold truncate">' + _calTimeFromMin(startMin) + ' ' + hospName + '</div>' +
        (height > 28 ? '<div class="truncate opacity-90">' + label + ' · ' + purpose + '</div>' : '') +
      '</div>';
    });
    bodyHtml += '</div>';
  });
  bodyHtml += '</div>';

  box.innerHTML = '<div style="max-height:calc(100vh - 220px);overflow:auto">' + headHtml + bodyHtml + '</div>';
}

// ===== Day View =====
function renderCalDay() {
  var box = document.getElementById('cal-canvas');
  if (!box) return;
  var ds = _calFmtDate(_calAnchor);
  var dn = ['일','월','화','수','목','금','토'][_calAnchor.getDay()];
  var todayStr = _calFmtDate(new Date());
  var isToday = (ds === todayStr);
  var slotCount = ((_calEndHour - _calStartHour) * 60) / _calSlotMin;
  var slotPx = 36;

  var headHtml = '<div style="display:grid;grid-template-columns:80px 1fr;border-bottom:1px solid var(--border-light);background:var(--surface-elevated);position:sticky;top:0;z-index:5">' +
    '<div style="border-right:1px solid var(--border-light)"></div>' +
    '<div style="padding:12px 14px;' + (isToday ? 'background:rgba(37,99,235,.05);' : '') + '">' +
      '<div class="text-[12px] font-bold" style="color:' + (isToday ? 'var(--brand-500)' : 'var(--gray-700)') + '">' + (_calAnchor.getMonth()+1) + '월 ' + _calAnchor.getDate() + '일 (' + dn + ')</div>' +
      '<div class="text-[10px] text-slate-400 mt-0.5">' + _calMeetingsForDate(ds).length + '건의 일정</div>' +
    '</div>' +
  '</div>';

  var bodyHtml = '<div style="display:grid;grid-template-columns:80px 1fr;height:' + (slotCount * slotPx) + 'px">';
  // Time column
  bodyHtml += '<div style="border-right:1px solid var(--border-light)">';
  for (var s = 0; s < slotCount; s++) {
    var min = _calStartHour * 60 + s * _calSlotMin;
    var label = _calTimeFromMin(min);
    bodyHtml += '<div style="height:' + slotPx + 'px;border-bottom:1px dashed var(--border-light);text-align:right;padding-right:8px;font-size:11px;color:var(--gray-400);line-height:' + slotPx + 'px">' + label + '</div>';
  }
  bodyHtml += '</div>';

  // Day column
  bodyHtml += '<div data-date="' + ds + '" style="position:relative;background:var(--surface-primary)">';
  for (var s2 = 0; s2 < slotCount; s2++) {
    var slotMin = _calStartHour * 60 + s2 * _calSlotMin;
    var topPx = s2 * slotPx;
    bodyHtml += '<div class="cal-slot" data-date="' + ds + '" data-min="' + slotMin + '"' +
      ' style="position:absolute;top:' + topPx + 'px;left:0;right:0;height:' + slotPx + 'px;border-bottom:1px dashed var(--border-light);cursor:pointer"' +
      ' ondragover="event.preventDefault();this.style.background=\'rgba(37,99,235,.08)\'"' +
      ' ondragleave="this.style.background=\'\'"' +
      ' ondrop="onCalDrop(event,\'' + ds + '\',' + slotMin + ')"' +
      ' onclick="onCalSlotClick(\'' + ds + '\',' + slotMin + ')"></div>';
  }
  var meets = _calMeetingsForDate(ds);
  meets.forEach(function(m) {
    var range = _calMeetingTimeRange(m);
    var startMin = Math.max(_calStartHour * 60, range[0]);
    var endMin = Math.min(_calEndHour * 60, range[1]);
    if (endMin <= startMin) return;
    var top = ((startMin - _calStartHour * 60) / _calSlotMin) * slotPx;
    var height = ((endMin - startMin) / _calSlotMin) * slotPx;
    var color = _calTypeColor(m.meeting_type);
    var label = _calTypeLabel(m.meeting_type);
    var hospName = (m.hospital_name || '').replace(/'/g, "&#39;").replace(/"/g, '&quot;');
    var purpose = (m.purpose || '').replace(/'/g, "&#39;").replace(/"/g, '&quot;');
    var docNames = (m.doctor_name || '').replace(/'/g, "&#39;").replace(/"/g, '&quot;');
    bodyHtml += '<div class="cal-event" draggable="true"' +
      ' data-meeting-id="' + m.id + '"' +
      ' style="position:absolute;left:8px;right:8px;top:' + top + 'px;height:' + Math.max(28, height - 2) + 'px;background:' + color + ';color:#fff;border-radius:8px;padding:6px 10px;font-size:11px;line-height:1.3;overflow:hidden;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,.18);z-index:2"' +
      ' ondragstart="onCalDragStart(event,' + m.id + ')"' +
      ' ondragend="onCalDragEnd(event)"' +
      ' onclick="event.stopPropagation();openCalMeeting(' + m.id + ')">' +
      '<div class="font-bold">' + _calTimeFromMin(startMin) + ' ~ ' + _calTimeFromMin(endMin) + ' · ' + hospName + '</div>' +
      (height > 38 ? '<div class="opacity-95 mt-0.5">' + label + (docNames ? ' · ' + docNames : '') + '</div>' : '') +
      (height > 60 ? '<div class="opacity-90 mt-0.5 truncate">' + purpose + '</div>' : '') +
    '</div>';
  });
  bodyHtml += '</div>';
  bodyHtml += '</div>';

  box.innerHTML = '<div style="max-height:calc(100vh - 220px);overflow:auto">' + headHtml + bodyHtml + '</div>';
}

// ===== Month View =====
function renderCalMonth() {
  var box = document.getElementById('cal-canvas');
  if (!box) return;
  var year = _calAnchor.getFullYear(), month = _calAnchor.getMonth();
  var firstOfMonth = new Date(year, month, 1);
  var gridStart = _calStartOfWeek(firstOfMonth);
  var todayStr = _calFmtDate(new Date());

  var headHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);background:var(--surface-elevated);border-bottom:1px solid var(--border-light)">';
  ['월','화','수','목','금','토','일'].forEach(function(dn, i) {
    var color = (i === 5) ? '#3b82f6' : (i === 6 ? '#f87171' : 'var(--gray-700)');
    headHtml += '<div class="text-[10px] font-bold" style="padding:10px 8px;text-align:center;color:' + color + ';border-right:1px solid var(--border-light)">' + dn + '</div>';
  });
  headHtml += '</div>';

  var bodyHtml = '<div style="display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:minmax(96px,auto)">';
  for (var i = 0; i < 42; i++) {
    var cellDate = new Date(gridStart); cellDate.setDate(cellDate.getDate() + i);
    var ds = _calFmtDate(cellDate);
    var inMonth = (cellDate.getMonth() === month);
    var isToday = (ds === todayStr);
    var dow = cellDate.getDay();
    var dayColor = isToday ? 'var(--brand-500)' : (dow === 0 ? '#f87171' : (dow === 6 ? '#3b82f6' : 'var(--gray-700)'));
    var meets = _calMeetingsForDate(ds);
    var bg = isToday ? 'rgba(37,99,235,.05)' : (inMonth ? 'var(--surface-primary)' : 'var(--surface-tertiary)');
    bodyHtml += '<div class="cal-month-cell" data-date="' + ds + '"' +
      ' style="border-right:1px solid var(--border-light);border-bottom:1px solid var(--border-light);padding:6px;background:' + bg + ';position:relative;min-height:96px;cursor:pointer"' +
      ' ondragover="event.preventDefault();this.style.background=\'rgba(37,99,235,.1)\'"' +
      ' ondragleave="this.style.background=\'' + bg + '\'"' +
      ' ondrop="onCalDrop(event,\'' + ds + '\',null)"' +
      ' onclick="_calAnchor=new Date(' + cellDate.getFullYear() + ',' + cellDate.getMonth() + ',' + cellDate.getDate() + ');setCalView(\'day\')">' +
      '<div class="flex items-center justify-between mb-1">' +
        '<span class="text-[12px] font-bold" style="color:' + dayColor + ';opacity:' + (inMonth ? '1' : '.4') + '">' + cellDate.getDate() + '</span>' +
        (meets.length > 0 ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style="background:var(--brand-50);color:var(--brand-600)">' + meets.length + '</span>' : '') +
      '</div>';
    var max = 3;
    bodyHtml += meets.slice(0, max).map(function(m) {
      var color = _calTypeColor(m.meeting_type);
      var range = _calMeetingTimeRange(m);
      var startTime = _calTimeFromMin(range[0]);
      var hospName = (m.hospital_name || '').replace(/'/g, "&#39;").replace(/"/g, '&quot;');
      return '<div class="cal-event truncate" draggable="true"' +
        ' data-meeting-id="' + m.id + '"' +
        ' style="font-size:10px;padding:2px 5px;border-radius:4px;background:' + color + '15;color:' + color + ';border-left:2px solid ' + color + ';margin-bottom:2px;cursor:grab"' +
        ' ondragstart="event.stopPropagation();onCalDragStart(event,' + m.id + ')"' +
        ' ondragend="onCalDragEnd(event)"' +
        ' onclick="event.stopPropagation();openCalMeeting(' + m.id + ')">' +
        '<span class="font-bold">' + startTime + '</span> ' + hospName +
      '</div>';
    }).join('');
    if (meets.length > max) {
      bodyHtml += '<div class="text-[9px] text-slate-400 px-1">+' + (meets.length - max) + ' more</div>';
    }
    bodyHtml += '</div>';
  }
  bodyHtml += '</div>';

  box.innerHTML = headHtml + bodyHtml;
}

// ===== Drag & Drop handlers =====
var _calDragMeetingId = null;
function onCalDragStart(e, meetingId) {
  _calDragMeetingId = meetingId;
  try {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(meetingId));
  } catch (_) {}
  if (e.currentTarget && e.currentTarget.style) e.currentTarget.style.opacity = '0.4';
}
function onCalDragEnd(e) {
  if (e.currentTarget && e.currentTarget.style) e.currentTarget.style.opacity = '';
  // Clear all slot highlights
  document.querySelectorAll('.cal-slot, .cal-month-cell').forEach(function(el){ el.style.background = ''; });
}
async function onCalDrop(e, dateStr, slotMin) {
  e.preventDefault();
  e.stopPropagation();
  var mid = _calDragMeetingId;
  _calDragMeetingId = null;
  document.querySelectorAll('.cal-slot, .cal-month-cell').forEach(function(el){ el.style.background = ''; });
  if (!mid) return;
  var meeting = _calMeetings.find(function(x){ return x.id === mid; });
  if (!meeting) return;

  // Build patch payload
  var patch = { meeting_date: dateStr };
  if (slotMin != null) {
    var origRange = _calMeetingTimeRange(meeting);
    var dur = Math.max(_calSlotMin, origRange[1] - origRange[0]);
    var newStart = slotMin;
    var newEnd = Math.min(_calEndHour * 60, slotMin + dur);
    patch.start_time = _calTimeFromMin(newStart);
    patch.end_time = _calTimeFromMin(newEnd);
    // Adjust visit_time to align with am/pm
    if (newStart < 12 * 60) patch.visit_time = 'am';
    else if (newStart >= 17 * 60 - 1 && newEnd > 17 * 60) patch.visit_time = 'full';
    else patch.visit_time = 'pm';
  }

  try {
    await API.patch('/meetings/' + mid, patch);
    toast('일정이 이동되었습니다');
    await renderCalendar();
  } catch (e2) {
    toast('일정 이동에 실패했습니다', 'err');
  }
}

function onCalSlotClick(dateStr, slotMin) {
  // Pre-fill new meeting form with date + start_time
  if (typeof showNewMeetGlobal === 'function') {
    var startTime = _calTimeFromMin(slotMin);
    var endTime = _calTimeFromMin(Math.min(_calEndHour * 60, slotMin + 60));
    window._calPrefill = { meeting_date: dateStr, start_time: startTime, end_time: endTime };
    showNewMeetGlobal();
  }
}

async function openCalMeeting(meetingId) {
  try {
    var r = await API.get('/meetings/' + meetingId);
    var meet = (r.data && r.data.data) || null;
    if (meet) showMeetDetail(meet);
  } catch (e) { toast('미팅 정보를 불러올 수 없습니다', 'err'); }
}

async function loadSchedule() {
  var c = document.getElementById('content');
  document.getElementById('page-title').textContent = '일정 플래너';
  document.getElementById('page-subtitle').textContent = '외래 일정 기반 방문 루트 추천';
  
  var tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  var defaultDate = tomorrow.toISOString().split('T')[0];

  c.innerHTML = '<div class="p-4 lg:p-6 max-w-5xl mx-auto">' +
    '<div class="card p-5 lg:p-6 mb-5">' +
      '<div class="flex items-center gap-3 mb-5">' +
        '<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#2563eb,#1d4ed8)">' +
          '<i class="fas fa-route text-white"></i>' +
        '</div>' +
        '<div>' +
          '<h3 class="font-bold text-slate-800 text-[15px]">영업 방문 플래너</h3>' +
          '<p class="text-xs text-slate-400">교수 외래 일정에 맞춰 진료 끝나는 시간에 방문할 루트를 추천합니다</p>' +
        '</div>' +
      '</div>' +
      '<div class="flex flex-col sm:flex-row gap-3 mb-4">' +
        '<div class="flex-1">' +
          '<label class="text-xs font-semibold text-slate-500 mb-1.5 block">방문 지역 <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
          '<div id="sch-region-chips" class="flex flex-wrap gap-2 min-h-[42px] items-center border border-gray-200 rounded-xl px-3 py-2 bg-white cursor-pointer" onclick="toggleSchRegionDropdown()">' +
            '<span class="text-xs text-slate-300" id="sch-region-placeholder">지역을 선택하세요</span>' +
          '</div>' +
          '<div id="sch-region-dropdown" class="hidden mt-1 border border-gray-200 rounded-xl bg-white shadow-lg max-h-[200px] overflow-y-auto z-20 relative">' +
          '</div>' +
        '</div>' +
        '<div class="flex-1">' +
          '<label class="text-xs font-semibold text-slate-500 mb-1.5 block">방문 날짜</label>' +
          '<input type="date" id="sch-date" class="input w-full" value="' + defaultDate + '" onchange="updateSchDayPreview()">' +
        '</div>' +
        '<div class="flex items-end">' +
          '<button onclick="fetchScheduleSuggestions()" class="btn btn-primary whitespace-nowrap h-[42px]">' +
            '<i class="fas fa-magic mr-1.5"></i>추천받기' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div id="sch-day-preview" class="text-xs text-slate-400 mb-2"></div>' +
      '<div id="sch-region-stats" class="hidden"></div>' +
    '</div>' +
    '<div id="sch-results"></div>' +
  '</div>';

  updateSchDayPreview();

  try {
    var res = await API.get('/schedule/regions');
    _scheduleRegions = res.data.data || [];
    _schSelectedRegions = new Set();
    renderSchRegionDropdown();
  } catch(e) { console.error('Failed to load schedule regions', e); }
}

function renderSchRegionDropdown() {
  var dd = document.getElementById('sch-region-dropdown');
  if (!dd) return;
  var html = '';
  _scheduleRegions.forEach(function(r) {
    var checked = _schSelectedRegions.has(r.region);
    html += '<label class="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 cursor-pointer transition border-b border-gray-50 last:border-0" onclick="event.stopPropagation()">' +
      '<input type="checkbox" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" ' + (checked ? 'checked' : '') + ' onchange="toggleSchRegion(\'' + r.region + '\')">' +
      '<div class="flex-1">' +
        '<span class="text-sm font-medium text-slate-700">' + r.region + '</span>' +
        '<span class="text-[10px] text-slate-400 ml-1.5">' + r.total + '개 기관</span>' +
      '</div>' +
      (r.needs_visit > 0 ? '<span class="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">' + r.needs_visit + '곳 필요</span>' : '') +
    '</label>';
  });
  dd.innerHTML = html;
}

function toggleSchRegionDropdown() {
  var dd = document.getElementById('sch-region-dropdown');
  if (!dd) return;
  dd.classList.toggle('hidden');
}

function toggleSchRegion(region) {
  if (_schSelectedRegions.has(region)) _schSelectedRegions.delete(region);
  else _schSelectedRegions.add(region);
  updateSchRegionChips();
}

function updateSchRegionChips() {
  var chips = document.getElementById('sch-region-chips');
  var placeholder = document.getElementById('sch-region-placeholder');
  if (!chips) return;
  // 기존 칩 제거 (placeholder 제외)
  var existingChips = chips.querySelectorAll('.sch-chip');
  existingChips.forEach(function(c) { c.remove(); });
  
  if (_schSelectedRegions.size === 0) {
    if (placeholder) placeholder.style.display = '';
  } else {
    if (placeholder) placeholder.style.display = 'none';
    _schSelectedRegions.forEach(function(region) {
      var chip = document.createElement('span');
      chip.className = 'sch-chip inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-100';
      chip.innerHTML = '<i class="fas fa-map-marker-alt text-[9px] text-blue-400"></i>' + region +
        '<button class="ml-0.5 text-blue-300 hover:text-blue-600" onclick="event.stopPropagation();toggleSchRegion(\'' + region + '\');updateSchRegionChips();renderSchRegionDropdown()"><i class="fas fa-xmark text-[9px]"></i></button>';
      chips.insertBefore(chip, placeholder);
    });
  }
  onSchRegionChange();
}

function updateSchDayPreview() {
  var dateInput = document.getElementById('sch-date');
  var preview = document.getElementById('sch-day-preview');
  if (!dateInput || !preview) return;
  var d = new Date(dateInput.value + 'T00:00:00');
  var dayNames = ['일','월','화','수','목','금','토'];
  preview.innerHTML = '<i class="fas fa-calendar-day mr-1"></i>' + d.getFullYear() + '년 ' + (d.getMonth()+1) + '월 ' + d.getDate() + '일 <strong>' + dayNames[d.getDay()] + '요일</strong> — 해당 요일 외래 일정에 맞춰 추천합니다';
}

function onSchRegionChange() {
  var statsDiv = document.getElementById('sch-region-stats');
  if (_schSelectedRegions.size === 0) { statsDiv.classList.add('hidden'); return; }
  
  var total = 0, active = 0, neverVisited = 0, needsVisit = 0;
  _schSelectedRegions.forEach(function(region) {
    var info = _scheduleRegions.find(function(r) { return r.region === region; });
    if (info) { total += info.total; active += info.active_count; neverVisited += info.never_visited; needsVisit += info.needs_visit; }
  });
  
  statsDiv.classList.remove('hidden');
  statsDiv.innerHTML = '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">' +
    schStatCard('전체 기관', total, 'fas fa-hospital', '#2563eb') +
    schStatCard('활성 기관', active, 'fas fa-check-circle', '#059669') +
    schStatCard('미방문', neverVisited, 'fas fa-exclamation-triangle', '#f59e0b') +
    schStatCard('방문 필요', needsVisit, 'fas fa-clock', '#ef4444') +
  '</div>';
}

function schStatCard(label, value, icon, color) {
  return '<div class="flex items-center gap-3 p-3 rounded-xl" style="background:' + color + '08;border:1px solid ' + color + '18">' +
    '<div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:' + color + '15"><i class="' + icon + ' text-sm" style="color:' + color + '"></i></div>' +
    '<div><div class="text-[18px] font-bold" style="color:' + color + '">' + value + '</div><div class="text-[10px] text-slate-400 font-medium">' + label + '</div></div>' +
  '</div>';
}

async function fetchScheduleSuggestions() {
  var regions = Array.from(_schSelectedRegions);
  var date = document.getElementById('sch-date').value;
  if (regions.length === 0) { toast('지역을 선택해주세요', 'warn'); return; }
  if (!date) { toast('날짜를 선택해주세요', 'warn'); return; }
  
  // 드롭다운 닫기
  var dd = document.getElementById('sch-region-dropdown');
  if (dd) dd.classList.add('hidden');
  
  var resultsDiv = document.getElementById('sch-results');
  resultsDiv.innerHTML = '<div class="flex items-center justify-center py-12"><div class="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div><span class="ml-3 text-sm text-slate-400">외래 일정 분석 중...</span></div>';
  
  try {
    var regionParam = regions.map(function(r) { return encodeURIComponent(r); }).join(',');
    var res = await API.get('/schedule/suggest?region=' + regionParam + '&date=' + date + '&max=20');
    _scheduleSuggestions = res.data.data || [];
    _scheduleTimeOrdered = res.data.time_ordered || [];
    _scheduleSelected = new Set();
    _scheduleVisitTimes = {};
    _scheduleSelectedDoctors = {};
    _schDayLabel = res.data.dayLabel || '';
    var stats = res.data.stats || {};
    
    if (_scheduleSuggestions.length === 0) {
      resultsDiv.innerHTML = '<div class="card p-8 text-center"><i class="fas fa-map-marker-alt text-3xl text-slate-200 mb-3"></i><p class="text-sm text-slate-400">해당 지역에 등록된 기관이 없습니다</p></div>';
      return;
    }
    
    renderScheduleResults(regions.join(', '), date, stats);
    
  } catch(e) {
    console.error('Schedule suggestion error', e);
    resultsDiv.innerHTML = '<div class="card p-8 text-center"><i class="fas fa-exclamation-triangle text-3xl text-red-200 mb-3"></i><p class="text-sm text-red-400">추천 생성 중 오류가 발생했습니다</p></div>';
  }
}

function renderScheduleResults(region, date, stats) {
  window._lastScheduleStats = stats;
  var resultsDiv = document.getElementById('sch-results');
  var dateObj = new Date(date + 'T00:00:00');
  var dayNames = ['일','월','화','수','목','금','토'];
  var dateStr = dateObj.getFullYear() + '년 ' + (dateObj.getMonth()+1) + '월 ' + dateObj.getDate() + '일 (' + dayNames[dateObj.getDay()] + ')';
  var list = _schViewMode === 'time' ? _scheduleTimeOrdered : _scheduleSuggestions;
  
  var html = '';
  
  // 헤더 (모바일 최적화: 정보 영역과 액션 영역을 분리)
  html += '<div class="mb-4">' +
    // 제목 + 메타 정보
    '<div class="min-w-0 mb-3">' +
      '<h3 class="font-bold text-slate-800 text-[15px] flex items-center flex-wrap gap-1"><i class="fas fa-map-pin text-blue-500 mr-1"></i>' + region.split(', ').map(function(r) { return '<span class="inline-flex items-center">' + r + '</span>'; }).join('<i class="fas fa-arrow-right text-[10px] text-slate-300 mx-1"></i>') + '<span class="ml-1">방문 추천</span></h3>' +
      '<p class="text-xs text-slate-400 mt-0.5">' + dateStr + ' · 추천 ' + list.length + '곳' +
        (stats.clinic_today_count > 0 ? ' · <span class="text-cyan-600 font-medium">' + dayNames[dateObj.getDay()] + '요일 외래 ' + stats.clinic_today_count + '곳</span>' : '') +
        (stats.excluded_off_hospitals > 0 ? ' · <span class="text-gray-400">휴진 제외 ' + stats.excluded_off_hospitals + '곳</span>' : '') +
      '</p>' +
    '</div>' +
    // 액션 영역: 모바일에서는 가로 스크롤, 데스크탑에서는 wrap
    '<div class="flex gap-2 items-center overflow-x-auto sch-actions-bar pb-1 sm:flex-wrap sm:overflow-visible">' +
      '<div class="flex rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">' +
        '<button onclick="setSchView(\'time\')" class="text-[12px] sm:text-[11px] px-3 py-2 sm:py-1.5 font-medium transition min-h-[40px] sm:min-h-[36px] ' + (_schViewMode === 'time' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50') + '"><i class="fas fa-clock mr-1"></i>시간순</button>' +
        '<button onclick="setSchView(\'score\')" class="text-[12px] sm:text-[11px] px-3 py-2 sm:py-1.5 font-medium transition min-h-[40px] sm:min-h-[36px] ' + (_schViewMode === 'score' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50') + '"><i class="fas fa-ranking-star mr-1"></i>추천순</button>' +
      '</div>' +
      '<button onclick="selectAllSchedule()" class="btn btn-outline btn-sm text-xs flex-shrink-0 min-h-[40px] sm:min-h-[36px]"><i class="fas fa-check-double mr-1"></i>전체</button>' +
      '<button onclick="optimizeScheduleRoute()" id="sch-route-btn" class="btn btn-outline btn-sm text-xs hidden flex-shrink-0 min-h-[40px] sm:min-h-[36px]" title="선택한 기관들의 최적 동선을 계산합니다"><i class="fas fa-route mr-1"></i>동선</button>' +
      '<button onclick="createSchedulePlan()" id="sch-create-btn" class="btn btn-primary btn-sm text-xs hidden flex-shrink-0 min-h-[40px] sm:min-h-[36px]"><i class="fas fa-calendar-plus mr-1"></i>생성 <span id="sch-sel-count">0</span></button>' +
    '</div>' +
  '</div>';
  
  // 외래 일정 안내 배너
  if (!stats.has_clinic_data) {
    html += '<div class="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4 text-[12px] text-amber-700">' +
      '<i class="fas fa-info-circle text-amber-400 mr-1.5"></i>' +
      '의료진 외래 일정이 아직 등록되지 않았습니다. <strong>의료진 관리</strong>에서 각 교수의 외래 시간을 입력하면 진료 끝나는 시간에 맞춰 방문 루트를 추천합니다.' +
    '</div>';
  }
  
  // 시간순 보기일 때 타임라인 형태로
  if (_schViewMode === 'time' && stats.has_clinic_data) {
    html += renderTimelineView(list, dateObj);
  } else {
    html += renderScoreView(list);
  }
  
  resultsDiv.innerHTML = html;
}

function renderTimelineView(list, dateObj) {
  var dayNames = ['일','월','화','수','목','금','토'];
  var dayName = dayNames[dateObj.getDay()];
  var html = '';
  
  // 지역 목록 추출
  var regionSet = {};
  list.forEach(function(s) { regionSet[s.region] = true; });
  var uniqueRegions = Object.keys(regionSet);
  var isMultiRegion = uniqueRegions.length > 1;
  
  html += '<div class="relative">';
  html += '<div class="absolute left-[23px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-cyan-200 via-blue-200 to-indigo-200 hidden sm:block"></div>';
  
  if (isMultiRegion) {
    // 복수 지역: 지역별 → 시간순 그룹핑
    var regionColors = ['#2563eb','#7c3aed','#059669','#f59e0b','#ef4444','#ec4899','#06b6d4','#84cc16'];
    uniqueRegions.forEach(function(region, rIdx) {
      var regionItems = list.filter(function(s) { return s.region === region; });
      var rColor = regionColors[rIdx % regionColors.length];
      
      // 지역 헤더
      html += '<div class="flex items-center gap-3 mb-3 mt-6 first:mt-0 sm:pl-[14px]">' +
        '<div class="w-[18px] h-[18px] rounded-full flex items-center justify-center z-10 hidden sm:flex" style="background:' + rColor + ';box-shadow:0 0 0 4px white">' +
          '<i class="fas fa-map-marker-alt text-[9px] text-white"></i>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-[14px] font-bold" style="color:' + rColor + '"><i class="fas fa-location-dot mr-1"></i>' + region + '</span>' +
          '<span class="text-[10px] px-2 py-0.5 rounded-full font-medium" style="background:' + rColor + '12;color:' + rColor + '">' + regionItems.length + '곳</span>' +
        '</div>' +
      '</div>';
      
      // 지역 내 시간대별 그룹핑
      var amEndGroup = regionItems.filter(function(s) { return s.visit_slot === 'am_end'; });
      var pmEndGroup = regionItems.filter(function(s) { return s.visit_slot === 'pm_end'; });
      var noTimeGroup = regionItems.filter(function(s) { return !s.visit_time; });
      
      if (amEndGroup.length > 0) {
        html += schTimeSlotHeader('11:30~', '오전 외래 후', 'fas fa-sun', '#f59e0b', 'bg-amber-50', dayName);
        amEndGroup.forEach(function(s) { html += schTimeCard(s, list); });
      }
      if (pmEndGroup.length > 0) {
        html += schTimeSlotHeader('16:30~', '오후 외래 후', 'fas fa-cloud-sun', '#6366f1', 'bg-indigo-50', dayName);
        pmEndGroup.forEach(function(s) { html += schTimeCard(s, list); });
      }
      if (noTimeGroup.length > 0) {
        html += schTimeSlotHeader('', '외래 시간 미등록', 'fas fa-question-circle', '#94a3b8', 'bg-slate-50', dayName);
        noTimeGroup.forEach(function(s) { html += schTimeCard(s, list); });
      }
    });
  } else {
    // 단일 지역: 기존 시간순 그룹핑
    var amEndGroup = list.filter(function(s) { return s.visit_slot === 'am_end'; });
    var pmEndGroup = list.filter(function(s) { return s.visit_slot === 'pm_end'; });
    var noTimeGroup = list.filter(function(s) { return !s.visit_time; });
    
    if (amEndGroup.length > 0) {
      html += schTimeSlotHeader('11:30~', '오전 외래 후', 'fas fa-sun', '#f59e0b', 'bg-amber-50', dayName);
      amEndGroup.forEach(function(s) { html += schTimeCard(s, list); });
    }
    if (pmEndGroup.length > 0) {
      html += schTimeSlotHeader('16:30~', '오후 외래 후', 'fas fa-cloud-sun', '#6366f1', 'bg-indigo-50', dayName);
      pmEndGroup.forEach(function(s) { html += schTimeCard(s, list); });
    }
    if (noTimeGroup.length > 0) {
      html += schTimeSlotHeader('', '외래 시간 미등록', 'fas fa-question-circle', '#94a3b8', 'bg-slate-50', dayName);
      noTimeGroup.forEach(function(s) { html += schTimeCard(s, list); });
    }
  }
  
  html += '</div>';
  return html;
}

function schTimeSlotHeader(time, label, icon, color, bgClass, dayName) {
  return '<div class="flex items-center gap-3 mb-3 mt-5 first:mt-0 sm:pl-[14px]">' +
    '<div class="w-[18px] h-[18px] rounded-full flex items-center justify-center z-10 hidden sm:flex" style="background:' + color + ';box-shadow:0 0 0 4px white">' +
      '<div class="w-2 h-2 bg-white rounded-full"></div>' +
    '</div>' +
    '<div class="flex items-center gap-2">' +
      (time ? '<span class="text-sm font-bold" style="color:' + color + '">' + time + '</span>' : '') +
      '<span class="text-[12px] font-semibold text-slate-600">' + label + '</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded-full font-medium" style="background:' + color + '12;color:' + color + '"><i class="' + icon + ' mr-0.5"></i>' + dayName + '</span>' +
    '</div>' +
  '</div>';
}

function schTimeCard(s, list) {
  var isSelected = _scheduleSelected.has(s.hospital_id);
  var stageLabels = { contact: '컨택', meeting: '미팅', demo: '데모', proposal: '제안', contract: '계약', active_customer: '기존고객' };
  var stageColors = { contact: '#94a3b8', meeting: '#2563eb', demo: '#8b5cf6', proposal: '#f59e0b', contract: '#ef4444', active_customer: '#059669' };
  var idx = list.indexOf(s);
  
  var html = '<div id="sch-card-' + s.hospital_id + '" class="card list-card mb-3 sm:ml-[48px] transition-all duration-200 cursor-pointer hover:shadow-md ' + (isSelected ? 'ring-2 ring-blue-500' : '') + '" onclick="toggleScheduleSelect(' + s.hospital_id + ')" style="' + (isSelected ? 'border-color:#2563eb40;background:linear-gradient(135deg,#eff6ff,#f8fafc)' : '') + '">' +
    '<div class="p-4 sm:p-4">' +
      '<div class="flex items-start gap-2.5 sm:gap-3">' +
        '<div class="flex flex-col items-center gap-1 flex-shrink-0">' +
          '<div class="w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-sm sm:text-xs font-bold ' + (isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400') + '" id="sch-rank-' + s.hospital_id + '">' +
            (isSelected ? '<i class="fas fa-check"></i>' : (idx + 1)) +
          '</div>' +
          '<div class="text-[10px] font-bold text-slate-400">' + s.score + '점</div>' +
        '</div>' +
        '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-1.5 flex-wrap">' +
            '<h4 class="font-bold text-slate-800 text-[14px] sm:text-sm break-keep">' + s.name + '</h4>' +
            '<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500"><i class="fas fa-map-marker-alt text-[8px] mr-0.5"></i>' + s.region + '</span>' +
            '<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style="background:' + (stageColors[s.pipeline_stage] || '#94a3b8') + '12;color:' + (stageColors[s.pipeline_stage] || '#94a3b8') + '">' + (stageLabels[s.pipeline_stage] || s.pipeline_stage) + '</span>' +
            (s.visit_time ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100"><i class="fas fa-clock mr-0.5"></i>' + s.visit_label + '</span>' : '') +
          '</div>' +
          // 방문 시간대 선택 (오전/오후/종일)
          (function() {
            // 추천 슬롯 기반 기본값 자동 설정 (사용자가 변경 안 했을 때)
            if (_scheduleVisitTimes[s.hospital_id] === undefined) {
              if (s.visit_slot === 'am_end') _scheduleVisitTimes[s.hospital_id] = 'am';
              else if (s.visit_slot === 'pm_end') _scheduleVisitTimes[s.hospital_id] = 'pm';
              else _scheduleVisitTimes[s.hospital_id] = '';
            }
            var current = _scheduleVisitTimes[s.hospital_id] || '';
            var btn = function(val, label, bg, fg, bd) {
              var active = current === val;
              var style = active
                ? 'background:' + bg + ';color:' + fg + ';border-color:' + bd + ';font-weight:700'
                : 'background:#fff;color:#94a3b8;border-color:#e5e7eb';
              return '<button type="button" onclick="event.stopPropagation();setScheduleVisitTime(' + s.hospital_id + ',\'' + val + '\')" class="text-[10px] px-2 py-1 rounded-md border transition-all" style="' + style + '">' + label + '</button>';
            };
            return '<div class="flex items-center gap-1.5 mt-2 flex-wrap" onclick="event.stopPropagation()">' +
              '<span class="text-[10px] text-slate-400 font-semibold mr-0.5"><i class="fas fa-clock-rotate-left mr-0.5"></i>방문 시간대:</span>' +
              btn('am',   '오전', '#fff7ed', '#c2410c', '#fed7aa') +
              btn('pm',   '오후', '#eff6ff', '#1d4ed8', '#bfdbfe') +
              btn('full', '종일', '#f3e8ff', '#7e22ce', '#e9d5ff') +
              btn('',     '미지정', '#f1f5f9', '#475569', '#cbd5e1') +
            '</div>';
          })();
  
  // 의료진 선택 UI (체크박스 스타일)
  if (s.doctors && s.doctors.length > 0) {
    // clinic_analysis 매핑 (의사별)
    var clinicMap = {};
    if (s.clinic_analysis) {
      s.clinic_analysis.forEach(function(a) { clinicMap[a.doctor_id] = a; });
    }
    // 기본값: 외래있는 의사 자동 선택, 없으면 모든 의사 선택
    if (_scheduleSelectedDoctors[s.hospital_id] === undefined) {
      var defaultSet = new Set();
      var hasAnyClinic = s.doctors.some(function(d) { var a = clinicMap[d.id]; return a && a.hasClinic; });
      s.doctors.forEach(function(d) {
        var a = clinicMap[d.id];
        if (hasAnyClinic) { if (a && a.hasClinic) defaultSet.add(d.id); }
        else { defaultSet.add(d.id); }
      });
      _scheduleSelectedDoctors[s.hospital_id] = defaultSet;
    }
    var selDocs = _scheduleSelectedDoctors[s.hospital_id];
    html += '<div class="mt-2.5 pt-2 border-t border-slate-100" onclick="event.stopPropagation()">' +
      '<div class="flex items-center justify-between mb-1.5">' +
        '<span class="text-[10px] text-slate-400 font-semibold"><i class="fas fa-user-doctor mr-0.5"></i>만날 의료진 <span class="text-blue-600">' + selDocs.size + '</span>/<span>' + s.doctors.length + '</span></span>' +
        '<button type="button" onclick="event.stopPropagation();toggleAllScheduleDoctors(' + s.hospital_id + ')" class="text-[10px] text-blue-600 hover:underline font-medium">' + (selDocs.size === s.doctors.length ? '전체 해제' : '전체 선택') + '</button>' +
      '</div>' +
      '<div class="flex flex-wrap gap-1.5">';
    s.doctors.forEach(function(d) {
      var a = clinicMap[d.id];
      var amBadge = a && a.am ? schSlotBadge(a.am, 'AM') : '';
      var pmBadge = a && a.pm ? schSlotBadge(a.pm, 'PM') : '';
      var isSel = selDocs.has(d.id);
      var bg = isSel ? '#eff6ff' : '#f8fafc';
      var bd = isSel ? '#bfdbfe' : '#e2e8f0';
      var fg = isSel ? '#1d4ed8' : '#64748b';
      html += '<button type="button" onclick="event.stopPropagation();toggleScheduleDoctor(' + s.hospital_id + ',' + d.id + ')" class="flex items-center gap-1 text-[10px] rounded-lg px-2 py-1 border transition-all" style="background:' + bg + ';border-color:' + bd + ';color:' + fg + '">' +
        '<i class="fas fa-' + (isSel ? 'check-square' : 'square') + ' text-[10px]"></i>' +
        '<span class="font-semibold">' + d.name + '</span>' +
        (d.position ? '<span class="opacity-70">' + d.position + '</span>' : '') +
        amBadge + pmBadge +
        (a && a.hasClinic ? '<span class="text-cyan-500"><i class="fas fa-stethoscope text-[8px]"></i></span>' : '') +
      '</button>';
    });
    html += '</div></div>';
  }
  
  html += (s.address ? '<p class="text-[11px] text-slate-400 mt-1.5 truncate"><i class="fas fa-map-marker-alt mr-1 text-slate-300"></i>' + s.address + '</p>' : '');
  
  // 추천 이유 (최대 3개만)
  var topReasons = s.reasons.slice(0, 3);
  html += '<div class="flex flex-wrap gap-1 mt-2">' +
    topReasons.map(function(r) { return '<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">' + r + '</span>'; }).join('') +
  '</div>';
  
  // 미팅 정보
  html += '<div class="flex items-center gap-3 mt-2 text-[11px] text-slate-400 flex-wrap">' +
    '<span><i class="fas fa-calendar-check mr-1"></i>' + s.total_meetings + '회</span>' +
    (s.last_meeting_date ? '<span><i class="fas fa-clock mr-1"></i>' + fmtDateShort(s.last_meeting_date) + '</span>' : '<span class="text-amber-500 font-medium">미방문</span>') +
    (s.doctor_count > 0 ? '<span><i class="fas fa-user-doctor mr-1"></i>' + s.doctor_count + '명</span>' : '') +
  '</div>';
  
  // 후속 과제
  if (s.pending_next_action) {
    html += '<div class="mt-2 text-[11px] text-orange-600 bg-orange-50 px-2.5 py-1.5 rounded-lg"><i class="fas fa-flag mr-1"></i>' + s.pending_next_action + '</div>';
  }
  
  html += '</div></div></div></div>';
  return html;
}

function schSlotBadge(val, period) {
  if (!val) return '';
  var colors = {
    '진료': 'bg-cyan-100 text-cyan-700',
    '수술': 'bg-rose-100 text-rose-600',
    '휴진': 'bg-gray-100 text-gray-400',
    '순환진료': 'bg-amber-100 text-amber-600'
  };
  var cls = colors[val] || 'bg-blue-100 text-blue-600';
  return '<span class="text-[9px] px-1 py-0.5 rounded ' + cls + ' font-medium">' + period + ':' + val + '</span>';
}

function renderScoreView(list) {
  var html = '';
  list.forEach(function(s, idx) { html += schTimeCard(s, list); });
  return html;
}

function setSchView(mode) {
  _schViewMode = mode;
  var regions = Array.from(_schSelectedRegions).join(', ');
  var date = document.getElementById('sch-date').value;
  // 기존 stats에서 가져오기 어려우므로 단순 re-render
  var stats = {
    total_in_region: _scheduleSuggestions.length,
    suggested: _scheduleSuggestions.length,
    has_clinic_data: _scheduleSuggestions.some(function(s) { return s.has_clinic_today; }),
    clinic_today_count: _scheduleSuggestions.filter(function(s) { return s.has_clinic_today; }).length
  };
  renderScheduleResults(regions, date, stats);
  updateScheduleSelection();
}

function fmtDateShort(d) {
  if (!d) return '-';
  var p = d.split('-');
  return (parseInt(p[1])) + '/' + (parseInt(p[2]));
}

function toggleScheduleSelect(hospId) {
  if (_scheduleSelected.has(hospId)) _scheduleSelected.delete(hospId);
  else _scheduleSelected.add(hospId);
  updateScheduleSelection();
}

function toggleScheduleDoctor(hospId, docId) {
  if (!_scheduleSelectedDoctors[hospId]) _scheduleSelectedDoctors[hospId] = new Set();
  var set = _scheduleSelectedDoctors[hospId];
  if (set.has(docId)) set.delete(docId);
  else set.add(docId);
  // 의료진을 선택하면 기관도 자동 선택
  if (set.size > 0 && !_scheduleSelected.has(hospId)) _scheduleSelected.add(hospId);
  // 재렌더링
  var regions = Array.from(_schSelectedRegions).join(', ');
  var date = document.getElementById('sch-date').value;
  var stats = {
    total_in_region: _scheduleSuggestions.length,
    suggested: _scheduleSuggestions.length,
    has_clinic_data: _scheduleSuggestions.some(function(s) { return s.has_clinic_today; }),
    clinic_today_count: _scheduleSuggestions.filter(function(s) { return s.has_clinic_today; }).length
  };
  renderScheduleResults(regions, date, stats);
  updateScheduleSelection();
}

function toggleAllScheduleDoctors(hospId) {
  var s = _scheduleSuggestions.find(function(x) { return x.hospital_id === hospId; }) ||
          _scheduleTimeOrdered.find(function(x) { return x.hospital_id === hospId; });
  if (!s || !s.doctors) return;
  if (!_scheduleSelectedDoctors[hospId]) _scheduleSelectedDoctors[hospId] = new Set();
  var set = _scheduleSelectedDoctors[hospId];
  if (set.size === s.doctors.length) set.clear();
  else s.doctors.forEach(function(d) { set.add(d.id); });
  if (set.size > 0 && !_scheduleSelected.has(hospId)) _scheduleSelected.add(hospId);
  var regions = Array.from(_schSelectedRegions).join(', ');
  var date = document.getElementById('sch-date').value;
  var stats = {
    total_in_region: _scheduleSuggestions.length,
    suggested: _scheduleSuggestions.length,
    has_clinic_data: _scheduleSuggestions.some(function(s) { return s.has_clinic_today; }),
    clinic_today_count: _scheduleSuggestions.filter(function(s) { return s.has_clinic_today; }).length
  };
  renderScheduleResults(regions, date, stats);
  updateScheduleSelection();
}

function setScheduleVisitTime(hospId, val) {
  _scheduleVisitTimes[hospId] = val;
  // 선택되지 않았다면 자동으로 선택
  if (!_scheduleSelected.has(hospId)) _scheduleSelected.add(hospId);
  // 화면 재렌더링
  var regions = Array.from(_schSelectedRegions).join(', ');
  var date = document.getElementById('sch-date').value;
  var stats = {
    total_in_region: _scheduleSuggestions.length,
    suggested: _scheduleSuggestions.length,
    has_clinic_data: _scheduleSuggestions.some(function(s) { return s.has_clinic_today; }),
    clinic_today_count: _scheduleSuggestions.filter(function(s) { return s.has_clinic_today; }).length
  };
  renderScheduleResults(regions, date, stats);
  updateScheduleSelection();
}

function selectAllSchedule() {
  var list = _schViewMode === 'time' ? _scheduleTimeOrdered : _scheduleSuggestions;
  if (_scheduleSelected.size === list.length) _scheduleSelected.clear();
  else list.forEach(function(s) { _scheduleSelected.add(s.hospital_id); });
  updateScheduleSelection();
}

function updateScheduleSelection() {
  var btn = document.getElementById('sch-create-btn');
  var routeBtn = document.getElementById('sch-route-btn');
  var countSpan = document.getElementById('sch-sel-count');
  if (!btn) return;
  if (_scheduleSelected.size > 0) {
    btn.classList.remove('hidden');
    countSpan.textContent = _scheduleSelected.size;
    if (routeBtn && _scheduleSelected.size >= 2) routeBtn.classList.remove('hidden');
    else if (routeBtn) routeBtn.classList.add('hidden');
  } else {
    btn.classList.add('hidden');
    if (routeBtn) routeBtn.classList.add('hidden');
  }

  // 모바일 sticky bottom action bar 업데이트
  updateSchStickyBar();
  
  var list = _schViewMode === 'time' ? _scheduleTimeOrdered : _scheduleSuggestions;
  list.forEach(function(s, idx) {
    var card = document.getElementById('sch-card-' + s.hospital_id);
    var rank = document.getElementById('sch-rank-' + s.hospital_id);
    if (!card || !rank) return;
    var isSel = _scheduleSelected.has(s.hospital_id);
    if (isSel) {
      card.classList.add('ring-2', 'ring-blue-500');
      card.style.borderColor = '#2563eb40'; card.style.background = 'linear-gradient(135deg,#eff6ff,#f8fafc)';
      rank.className = 'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold bg-blue-600 text-white';
      rank.innerHTML = '<i class="fas fa-check"></i>';
    } else {
      card.classList.remove('ring-2', 'ring-blue-500');
      card.style.borderColor = ''; card.style.background = '';
      rank.className = 'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold bg-slate-100 text-slate-400';
      rank.textContent = (idx + 1);
    }
  });
}

// 모바일 sticky bottom action bar (선택된 기관이 있을 때만 표시)
function updateSchStickyBar() {
  var existing = document.getElementById('sch-sticky-bar');
  var isMobile = window.matchMedia('(max-width: 1023px)').matches;
  var count = _scheduleSelected.size;

  // 일정 페이지가 아니거나, 모바일이 아니거나, 선택이 없으면 제거
  var resultsDiv = document.getElementById('sch-results');
  if (!resultsDiv || !isMobile || count === 0) {
    if (existing) existing.remove();
    return;
  }

  // 선택된 기관 정보 요약
  var selList = (_schViewMode === 'time' ? _scheduleTimeOrdered : _scheduleSuggestions)
    .filter(function(s) { return _scheduleSelected.has(s.hospital_id); });
  var regionSet = {};
  selList.forEach(function(s) { regionSet[s.region] = true; });
  var regions = Object.keys(regionSet);
  var regionLabel = regions.length === 1 ? regions[0]
    : (regions.length > 1 ? regions[0] + ' 외 ' + (regions.length - 1) + '개 지역' : '');

  var canRoute = count >= 2;
  var html =
    '<div class="sch-sticky-info">' +
      '<b><i class="fas fa-check-circle text-blue-500 mr-1"></i>' + count + '곳 선택</b>' +
      (regionLabel ? '<span><i class="fas fa-location-dot mr-0.5"></i>' + regionLabel + '</span>' : '') +
    '</div>' +
    (canRoute
      ? '<button onclick="optimizeScheduleRoute()" class="btn btn-outline" title="최적 동선 계산"><i class="fas fa-route"></i></button>'
      : '') +
    '<button onclick="createSchedulePlan()" class="btn btn-primary"><i class="fas fa-calendar-plus mr-1"></i>일정 생성</button>';

  if (existing) {
    existing.innerHTML = html;
  } else {
    var bar = document.createElement('div');
    bar.id = 'sch-sticky-bar';
    bar.className = 'sch-sticky-bar';
    bar.innerHTML = html;
    document.body.appendChild(bar);
  }
}

// 화면 전환/리사이즈 시 sticky bar 정리
window.addEventListener('resize', function() {
  if (typeof updateSchStickyBar === 'function') updateSchStickyBar();
});

// ===== 동선 최적화 (이동 경로 최적화) =====
async function optimizeScheduleRoute() {
  if (_scheduleSelected.size < 2) { toast('동선 최적화는 2곳 이상 선택해야 합니다', 'warn'); return; }
  var stops = [];
  _scheduleSuggestions.forEach(function(s) {
    if (_scheduleSelected.has(s.hospital_id)) {
      stops.push({
        hospital_id: s.hospital_id,
        name: s.name,
        region: s.region,
        address: s.address || '',
        phone: s.phone || '',
        visit_slot: s.visit_slot,
        visit_time: s.visit_time,
        visit_label: s.visit_label,
        score: s.score
      });
    }
  });
  if (stops.length < 2) { toast('선택한 방문지를 찾을 수 없습니다', 'err'); return; }

  toast('최적 동선을 계산하는 중...', 'info');
  try {
    var res = await API.post('/schedule/optimize-route', { stops: stops });
    var d = res.data.data;
    showOptimizedRouteModal(d);
  } catch (e) {
    toast('동선 최적화 중 오류가 발생했습니다', 'err');
  }
}

function showOptimizedRouteModal(d) {
  var ordered = d.ordered || [];
  var legs = d.legs || [];
  var summary = d.summary || {};
  var slotLabel = { am_start: '오전 시작', am_end: '오전 외래 후', pm_end: '오후 외래 후', none: '시간 미정' };
  var slotColor = { am_start: '#0891b2', am_end: '#c2410c', pm_end: '#1d4ed8', none: '#64748b' };

  var totalH = Math.floor((summary.total_estimated_minutes || 0) / 60);
  var totalM = (summary.total_estimated_minutes || 0) % 60;
  var totalLabel = (totalH > 0 ? totalH + '시간 ' : '') + totalM + '분';

  var html = '<div class="text-left">';
  // 요약
  html += '<div class="grid grid-cols-3 gap-2 mb-4">' +
    '<div class="bg-blue-50 rounded-xl p-3 border border-blue-100"><div class="text-[10px] text-blue-500 font-semibold">방문지</div><div class="text-xl font-bold text-blue-700">' + (summary.total_stops || 0) + '곳</div></div>' +
    '<div class="bg-amber-50 rounded-xl p-3 border border-amber-100"><div class="text-[10px] text-amber-500 font-semibold">예상 이동</div><div class="text-xl font-bold text-amber-700">' + totalLabel + '</div></div>' +
    '<div class="bg-emerald-50 rounded-xl p-3 border border-emerald-100"><div class="text-[10px] text-emerald-500 font-semibold">지역수</div><div class="text-xl font-bold text-emerald-700">' + (summary.unique_regions || 0) + '개</div></div>' +
  '</div>';

  // 타임라인
  html += '<div class="text-[11px] text-slate-500 mb-2"><i class="fas fa-info-circle mr-1"></i>지역·주소 유사도와 외래 시간을 고려한 추천 동선입니다.</div>';
  html += '<div class="relative pl-1 max-h-[400px] overflow-y-auto pr-1">';
  ordered.forEach(function(stop, idx) {
    var sc = slotColor[stop.visit_slot] || '#64748b';
    var sl = slotLabel[stop.visit_slot] || '시간 미정';
    html += '<div class="flex gap-3 items-stretch mb-1">';
    // 좌측 번호 + 라인
    html += '<div class="flex flex-col items-center" style="min-width:28px">' +
      '<div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style="background:' + sc + '">' + (idx + 1) + '</div>' +
      (idx < ordered.length - 1 ? '<div class="flex-1 w-0.5 my-1" style="background:linear-gradient(to bottom,' + sc + '60,#cbd5e160)"></div>' : '') +
    '</div>';
    // 본문
    html += '<div class="flex-1 pb-2">';
    html += '<div class="bg-white border border-gray-200 rounded-xl p-3 hover:shadow-sm transition">';
    html += '<div class="flex items-start justify-between gap-2">';
    html += '<div class="flex-1 min-w-0">' +
      '<div class="font-semibold text-[13px] text-slate-800 truncate">' + (stop.name || '-') + '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5"><i class="fas fa-map-marker-alt mr-1 text-slate-400"></i>' + (stop.region || '') + (stop.address ? ' · ' + stop.address : '') + '</div>' +
    '</div>';
    html += '<span class="text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap" style="background:' + sc + '15;color:' + sc + '">' +
      (stop.visit_time ? '<i class="fas fa-clock mr-0.5"></i>' + stop.visit_time + ' ' : '') + sl + '</span>';
    html += '</div></div>';
    // 이동 정보 (다음 leg)
    if (idx < legs.length) {
      var leg = legs[idx];
      var em = leg.estimated_minutes || 0;
      var mIcon = leg.region_match ? 'fa-walking text-emerald-500' : 'fa-car text-amber-500';
      html += '<div class="flex items-center gap-2 text-[10px] text-slate-400 mt-1 ml-1">' +
        '<i class="fas ' + mIcon + '"></i>' +
        '<span>다음 방문지까지 약 ' + em + '분' + (leg.region_match ? ' · 같은 지역' : '') + '</span>' +
      '</div>';
    }
    html += '</div></div>';
  });
  html += '</div>';

  html += '<div class="mt-4 text-[11px] text-slate-500 bg-slate-50 rounded-lg p-2"><i class="fas fa-lightbulb text-amber-400 mr-1"></i>"이 순서로 적용" 버튼을 누르면 추천 결과 카드 순서가 이 동선대로 정렬되며, 미팅 생성 시 그대로 반영됩니다.</div>';
  html += '</div>';

  showConfirm(
    '<i class="fas fa-route text-blue-500 mr-1"></i>최적 동선 결과',
    html,
    function() { applyOptimizedRoute(ordered); },
    { type: 'info', yesLabel: '<i class="fas fa-check mr-1"></i>이 순서로 적용', noLabel: '닫기' }
  );
}

function applyOptimizedRoute(ordered) {
  if (!Array.isArray(ordered) || ordered.length === 0) return;
  var orderMap = {};
  ordered.forEach(function(stop, idx) { orderMap[stop.hospital_id] = idx; });
  // 시간순 / 추천순 두 리스트 모두 재정렬 (선택된 것만 위로)
  function sortFn(a, b) {
    var aIn = orderMap.hasOwnProperty(a.hospital_id);
    var bIn = orderMap.hasOwnProperty(b.hospital_id);
    if (aIn && bIn) return orderMap[a.hospital_id] - orderMap[b.hospital_id];
    if (aIn) return -1;
    if (bIn) return 1;
    return 0;
  }
  _scheduleTimeOrdered = _scheduleTimeOrdered.slice().sort(sortFn);
  _scheduleSuggestions = _scheduleSuggestions.slice().sort(sortFn);

  var date = document.getElementById('sch-date').value;
  var regions = (document.getElementById('sch-region') || {}).value || '';
  var stats = window._lastScheduleStats || { has_clinic_data: true, clinic_today_count: 0, excluded_off_hospitals: 0 };
  renderScheduleResults(regions, date, stats);
  toast('최적 동선 순서로 정렬되었습니다', 'success');
}

async function createSchedulePlan() {
  if (_scheduleSelected.size === 0) { toast('방문할 기관을 선택해주세요', 'warn'); return; }
  var date = document.getElementById('sch-date').value;
  if (!date) { toast('날짜를 선택해주세요', 'warn'); return; }
  
  var visits = [];
  var skippedNoDoc = [];
  _scheduleSuggestions.forEach(function(s) {
    if (_scheduleSelected.has(s.hospital_id)) {
      // 방문 시간대 결정 (사용자 선택 우선, 없으면 추천 슬롯 기반)
      var vt = _scheduleVisitTimes[s.hospital_id];
      if (vt === undefined) {
        if (s.visit_slot === 'am_end') vt = 'am';
        else if (s.visit_slot === 'pm_end') vt = 'pm';
        else vt = '';
      }
      // 선택된 의료진만 미팅에 포함
      var selDocSet = _scheduleSelectedDoctors[s.hospital_id];
      var selDocIds = (selDocSet && selDocSet.size > 0)
        ? Array.from(selDocSet)
        : s.doctors.map(function(d) { return d.id; });
      if (selDocIds.length === 0) { skippedNoDoc.push(s.name); return; }
      visits.push({
        hospital_id: s.hospital_id,
        doctor_ids: selDocIds,
        purpose: '영업 방문 (일정 플래너)',
        meeting_type: 'visit',
        visit_time: vt
      });
    }
  });
  if (visits.length === 0) {
    toast(skippedNoDoc.length > 0 ? '선택된 기관의 의료진을 선택해주세요' : '방문할 기관을 선택해주세요', 'warn');
    return;
  }
  
  // 영업사원 목록 가져오기 (복수 선택 체크박스)
  var usersHtml = '<div class="text-left mt-2"><label class="text-xs font-semibold text-slate-500 mb-1 block"><i class="fas fa-user-tie mr-1"></i>방문 영업사원 <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
    '<div id="confirm-users-list" class="border border-gray-200 rounded-xl max-h-[140px] overflow-y-auto p-2 space-y-1"><div class="text-xs text-slate-400 text-center py-2">로딩 중...</div></div></div>';

  try {
    var usersRes = await API.get('/users');
    var usersList = usersRes.data.data || [];
    var userCbs = usersList.map(function(u) {
      var ck = (currentUser && currentUser.id === u.id) ? ' checked' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-blue-50 cursor-pointer transition"><input type="checkbox" name="confirm_user_ids" value="' + u.id + '" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"' + ck + '><span class="text-[12px] font-medium text-slate-700">' + u.name + '</span><span class="text-[10px] text-slate-400">' + u.email + '</span></label>';
    }).join('');
    usersHtml = '<div class="text-left mt-2"><label class="text-xs font-semibold text-slate-500 mb-1 block"><i class="fas fa-user-tie mr-1"></i>방문 영업사원 <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
      '<div class="border border-gray-200 rounded-xl max-h-[140px] overflow-y-auto p-2 space-y-1">' + userCbs + '</div></div>';
  } catch(e) {}
  
  // 방문 시간대 요약
  var amCount = visits.filter(function(v) { return v.visit_time === 'am'; }).length;
  var pmCount = visits.filter(function(v) { return v.visit_time === 'pm'; }).length;
  var fullCount = visits.filter(function(v) { return v.visit_time === 'full'; }).length;
  var noneCount = visits.filter(function(v) { return !v.visit_time; }).length;
  var slotSummary = '<div class="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">' +
    (amCount   ? '<span class="px-2 py-0.5 rounded-md font-bold" style="background:#fff7ed;color:#c2410c;border:1px solid #fed7aa"><i class="fas fa-sun mr-0.5"></i>오전 ' + amCount + '</span>' : '') +
    (pmCount   ? '<span class="px-2 py-0.5 rounded-md font-bold" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe"><i class="fas fa-cloud-sun mr-0.5"></i>오후 ' + pmCount + '</span>' : '') +
    (fullCount ? '<span class="px-2 py-0.5 rounded-md font-bold" style="background:#f3e8ff;color:#7e22ce;border:1px solid #e9d5ff"><i class="fas fa-clock mr-0.5"></i>종일 ' + fullCount + '</span>' : '') +
    (noneCount ? '<span class="px-2 py-0.5 rounded-md font-bold" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1">미지정 ' + noneCount + '</span>' : '') +
  '</div>';

  showConfirm(
    '미팅 일괄 생성',
    date + '에 <strong>' + visits.length + '건</strong>의 방문 미팅을 생성합니다.' + slotSummary,
    async function() {
      var selUserIds = Array.from(document.querySelectorAll('input[name="confirm_user_ids"]:checked')).map(function(cb) { return Number(cb.value); });
      try {
        var res = await API.post('/schedule/plan', { date: date, visits: visits, user_ids: selUserIds.length > 0 ? selUserIds : null });
        toast(res.data.data.count + '건의 미팅이 생성되었습니다');
        _scheduleSelected.clear();
        _scheduleVisitTimes = {};
        fetchScheduleSuggestions();
      } catch(e) { toast('미팅 생성 중 오류가 발생했습니다', 'err'); }
    },
    { type: 'create', yesLabel: '미팅 생성', extraHtml: usersHtml }
  );
}

// ============================================================
// ===== 제품(데모기) 관리 =====
// ============================================================
window._prodTab = 'all';        // all|internal|external|carry_case
window._prodSubTab = 'units';   // units|history
window._prodFilter = { status: '', model: '', search: '' };
window._prodFormData = null;    // hospitals/users cache for movement modal

var PROD_STATUS_LABELS = {
  in_stock: '재고',
  with_user: '재고',            // 레거시 호환: 담당자 보유 → 재고로 표시
  at_hospital: '기관 반출중',
  out: '외부',
  delivered: '납품완료',
  lost: '분실',
  repair: '수리중',
  retired: '폐기'
};
var PROD_STATUS_COLORS = {
  in_stock:    { bg: '#dcfce7', fg: '#166534', bd: '#bbf7d0' },
  with_user:   { bg: '#dcfce7', fg: '#166534', bd: '#bbf7d0' },  // in_stock과 동일
  at_hospital: { bg: '#fef3c7', fg: '#92400e', bd: '#fde68a' },
  out:         { bg: '#fef3c7', fg: '#92400e', bd: '#fde68a' },
  delivered:   { bg: '#e9d5ff', fg: '#6b21a8', bd: '#d8b4fe' },
  lost:        { bg: '#fee2e2', fg: '#991b1b', bd: '#fecaca' },
  repair:      { bg: '#fee2e2', fg: '#991b1b', bd: '#fecaca' },
  retired:     { bg: '#f1f5f9', fg: '#475569', bd: '#cbd5e1' }
};
// 유닛의 현재 위치를 사람이 읽을 수 있는 형태로 변환 (재고 상태이면 "회사")
function prodLocationLabel(u) {
  if (!u) return '-';
  if (u.status === 'in_stock' || u.status === 'with_user') return '회사';
  if (u.current_hospital_name) return u.current_hospital_name;
  if (u.status === 'delivered') return '납품완료';
  if (u.status === 'at_hospital') return '기관 반출중';
  if (u.status === 'out') return '외부';
  if (u.status === 'lost') return '분실';
  if (u.status === 'repair') return '수리중';
  if (u.status === 'retired') return '폐기';
  return '-';
}
var PROD_CAT_LABELS = { internal: '내부기', external: '외부기', carry_case: '휴대보관함' };
var PROD_CAT_THEMES = {
  internal:   { name: '내부기',     bg: '#eff6ff', border: '#3b82f6', chip: '#dbeafe', chipFg: '#1e40af', icon: 'fa-building' },
  external:   { name: '외부기',     bg: '#ecfdf5', border: '#10b981', chip: '#d1fae5', chipFg: '#065f46', icon: 'fa-truck-fast' },
  carry_case: { name: '휴대보관함', bg: '#fffbeb', border: '#f59e0b', chip: '#fef3c7', chipFg: '#92400e', icon: 'fa-suitcase' }
};
var PROD_STATUS_STYLES = PROD_STATUS_COLORS;
var PROD_MOV_LABELS = {
  inbound: '입고', checkout: '대여반출', demo: '시연(복귀)', deliver: '영구납품',
  return: '회수', transfer: '담당자이전', assign: '보유자추가', release: '보유자해제',
  lost: '분실', repair: '수리', retire: '폐기'
};
var PROD_MOV_ICONS = {
  inbound: 'fa-arrow-down', checkout: 'fa-arrow-up-from-bracket', demo: 'fa-eye',
  deliver: 'fa-gift', return: 'fa-arrow-down-to-bracket', transfer: 'fa-arrow-right-arrow-left',
  assign: 'fa-user-plus', release: 'fa-user-minus',
  lost: 'fa-triangle-exclamation', repair: 'fa-wrench', retire: 'fa-trash'
};

async function loadProducts() {
  document.getElementById('page-title').textContent = '제품 관리';
  document.getElementById('page-subtitle').textContent = '데모 제품 재고 및 입출고 관리';
  document.getElementById('header-actions').innerHTML =
    productExportMenu() +
    '<button class="btn btn-outline btn-sm" onclick="showProductCatalog()" title="카테고리/모델 비고 관리"><i class="fas fa-tags text-xs"></i><span class="hidden sm:inline ml-1">카테고리</span></button>' +
    '<button class="btn btn-primary btn-sm" onclick="showProductUnitForm()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline ml-1">유닛 입고</span></button>';

  document.getElementById('content').innerHTML =
    '<div class="p-4 lg:p-7 space-y-5 fade-in">' +
      '<div id="prod-kpi" class="grid grid-cols-2 lg:grid-cols-4 gap-3"></div>' +
      '<div id="prod-overdue" class="hidden"></div>' +
      '<div class="card-flat p-0 overflow-hidden">' +
        '<div class="flex items-center gap-2 p-3 border-b border-gray-100 overflow-x-auto scroll-chips">' +
          '<button class="prod-tab-btn" data-tab="all" onclick="setProdTab(\'all\')"><i class="fas fa-layer-group mr-1"></i>전체</button>' +
          '<button class="prod-tab-btn" data-tab="internal" onclick="setProdTab(\'internal\')"><i class="fas fa-building mr-1"></i>내부기</button>' +
          '<button class="prod-tab-btn" data-tab="external" onclick="setProdTab(\'external\')"><i class="fas fa-truck-fast mr-1"></i>외부기</button>' +
          '<button class="prod-tab-btn" data-tab="carry_case" onclick="setProdTab(\'carry_case\')"><i class="fas fa-suitcase mr-1"></i>휴대보관함</button>' +
          '<div class="flex-1"></div>' +
          '<button class="prod-sub-btn" data-sub="units" onclick="setProdSubTab(\'units\')"><i class="fas fa-box mr-1"></i>유닛</button>' +
          '<button class="prod-sub-btn" data-sub="sets" onclick="setProdSubTab(\'sets\')"><i class="fas fa-cubes mr-1"></i>세트</button>' +
          '<button class="prod-sub-btn" data-sub="history" onclick="setProdSubTab(\'history\')"><i class="fas fa-clock-rotate-left mr-1"></i>이력</button>' +
        '</div>' +
        '<div id="prod-filter-bar" class="p-3 border-b border-gray-100 bg-slate-50/50"></div>' +
        '<div id="prod-body" class="p-3"></div>' +
      '</div>' +
    '</div>';

  // Inject minimal styles once
  if (!document.getElementById('prod-styles')) {
    var st = document.createElement('style');
    st.id = 'prod-styles';
    st.textContent = '.prod-tab-btn{padding:8px 14px;font-size:12px;font-weight:600;color:#64748b;border-radius:8px;white-space:nowrap;transition:all .15s}' +
      '.prod-tab-btn.active{background:#2563eb;color:#fff}.prod-tab-btn:not(.active):hover{background:#f1f5f9;color:#0f172a}' +
      '.prod-sub-btn{padding:6px 12px;font-size:11px;font-weight:600;color:#64748b;border:1px solid #e2e8f0;border-radius:8px;white-space:nowrap;background:#fff}' +
      '.prod-sub-btn.active{background:#0f172a;color:#fff;border-color:#0f172a}' +
      '.prod-kpi-card{padding:14px;border-radius:14px;border:1px solid #e2e8f0;background:#fff;display:flex;flex-direction:column;gap:6px}' +
      'html[data-theme="dark"] .prod-kpi-card{background:#0f1218;border-color:#1f242e}' +
      '.prod-status-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;border:1px solid}' +
      /* 제품 관리 액션 버튼 — 데스크탑에서는 라벨 표시, 모바일에서는 아이콘만 */
      '.prod-act-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 11px;font-size:12px;font-weight:600;border-radius:8px;border:1px solid transparent;cursor:pointer;line-height:1;white-space:nowrap;transition:all .15s ease;min-height:34px}' +
      '.prod-act-btn i{font-size:12px}' +
      '.prod-act-btn-ghost{background:#f8fafc;color:#475569;border-color:#e2e8f0}' +
      '.prod-act-btn-ghost:hover{background:#f1f5f9;color:#0f172a}' +
      '.prod-act-btn-outline{background:#fff;color:#2563eb;border-color:#bfdbfe}' +
      '.prod-act-btn-outline:hover{background:#eff6ff;border-color:#3b82f6}' +
      '.prod-act-btn-primary{background:#2563eb;color:#fff;border-color:#2563eb}' +
      '.prod-act-btn-primary:hover{background:#1d4ed8}' +
      'html[data-theme="dark"] .prod-act-btn-ghost{background:#1a1f29;color:#cbd5e1;border-color:#2a313d}' +
      'html[data-theme="dark"] .prod-act-btn-outline{background:#0f1218;color:#60a5fa;border-color:#1e3a8a}' +
      '@media (max-width: 640px){.prod-act-btn{padding:8px 10px;min-width:36px;justify-content:center}.prod-act-btn-label{display:none}.prod-act-btn i{font-size:13px}}' +
      /* 모바일 모달 z-index 강화 + 가독성 */
      '.modal-overlay{z-index:9990 !important}' +
      '.modal-container{z-index:9991 !important}' +
      '@media (max-width: 640px){.modal-container{width:96vw !important;max-width:96vw !important;max-height:92vh !important;margin:0 auto}.modal-container .input,.modal-container .select{font-size:14px;padding:9px 11px}.modal-container .input-label{font-size:12px}.modal-container .btn{min-height:40px;padding:9px 14px;font-size:13px}}';
    document.head.appendChild(st);
  }

  await refreshProductPage();
}

async function refreshProductPage() {
  // KPI dashboard
  try {
    var r = await API.get('/products/dashboard');
    var d = r.data.data;
    var t = d.totals || {};
    var kpi = '';
    kpi += prodKpiCard('총 유닛', t.total || 0, 'fa-box-archive', '#0f172a');
    kpi += prodKpiCard('재고', t.in_stock || 0, 'fa-warehouse', '#059669');
    kpi += prodKpiCard('외부 반출', t.out || 0, 'fa-arrow-up-from-bracket', '#d97706');
    kpi += prodKpiCard('회수 지연', (d.overdue || []).length, 'fa-triangle-exclamation', '#dc2626');
    document.getElementById('prod-kpi').innerHTML = kpi;

    // 회수 지연 알림
    var ov = document.getElementById('prod-overdue');
    if (d.overdue && d.overdue.length > 0) {
      ov.classList.remove('hidden');
      ov.innerHTML = '<div class="card-flat p-3" style="border-left:4px solid #dc2626;background:#fef2f2">' +
        '<div class="flex items-center gap-2 mb-2"><i class="fas fa-triangle-exclamation text-red-600"></i><strong class="text-sm text-red-700">회수 지연 ' + d.overdue.length + '건</strong></div>' +
        '<div class="space-y-1 text-xs">' + d.overdue.slice(0, 5).map(function(o) {
          return '<div class="flex items-center gap-2 text-slate-700"><span class="font-semibold">' + (o.product_name || '') + '</span>' +
            '<span class="text-slate-400">' + (o.serial_no || o.asset_code || '#' + o.product_unit_id) + '</span>' +
            (o.hospital_name ? '<span class="text-slate-500">@ ' + o.hospital_name + '</span>' : '') +
            '<span class="ml-auto font-bold text-red-600">' + o.days_overdue + '일 지연</span>' +
            '<button class="btn btn-outline btn-sm text-[10px]" onclick="quickReturnProductUnit(' + o.product_unit_id + ')"><i class="fas fa-arrow-down-to-bracket"></i> 회수</button>' +
          '</div>';
        }).join('') + '</div></div>';
    } else {
      ov.classList.add('hidden');
      ov.innerHTML = '';
    }
  } catch (e) {
    document.getElementById('prod-kpi').innerHTML = '<div class="text-xs text-red-400 col-span-full">대시보드 로드 실패</div>';
  }

  // Active tab styling
  document.querySelectorAll('.prod-tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === window._prodTab);
  });
  document.querySelectorAll('.prod-sub-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.sub === window._prodSubTab);
  });

  if (window._prodSubTab === 'units') {
    await renderProductUnits();
  } else if (window._prodSubTab === 'sets') {
    await renderProductSets();
  } else {
    await renderProductHistory();
  }
}

function prodKpiCard(label, value, icon, color) {
  return '<div class="prod-kpi-card">' +
    '<div class="flex items-center gap-2"><i class="fas ' + icon + ' text-xs" style="color:' + color + '"></i><span class="text-[11px] font-semibold text-slate-500">' + label + '</span></div>' +
    '<div class="text-[22px] font-extrabold" style="color:' + color + '">' + value + '</div>' +
  '</div>';
}

function setProdTab(t) { window._prodTab = t; refreshProductPage(); }
function setProdSubTab(s) { window._prodSubTab = s; refreshProductPage(); }

async function renderProductUnits() {
  // Filter bar
  var fb = document.getElementById('prod-filter-bar');
  fb.innerHTML = '<div class="flex flex-wrap items-center gap-2">' +
    '<input id="prod-search" type="text" placeholder="S/N · 모델명 · 비고 검색" value="' + (window._prodFilter.search || '') + '" class="input !py-1.5 !text-xs flex-1 min-w-[160px]" style="max-width:280px" oninput="window._prodFilter.search=this.value;clearTimeout(window._prodSearchT);window._prodSearchT=setTimeout(renderProductUnits,300)">' +
    '<select id="prod-status" class="input !py-1.5 !text-xs !w-auto" style="border-radius:8px" onchange="window._prodFilter.status=this.value;renderProductUnits()">' +
      '<option value="">모든 상태</option>' +
      Object.keys(PROD_STATUS_LABELS).map(function(k) {
        return '<option value="' + k + '"' + (window._prodFilter.status === k ? ' selected' : '') + '>' + PROD_STATUS_LABELS[k] + '</option>';
      }).join('') +
    '</select>' +
    (window._prodTab === 'external' || window._prodTab === 'carry_case' ?
      '<select id="prod-model" class="input !py-1.5 !text-xs !w-auto" style="border-radius:8px" onchange="window._prodFilter.model=this.value;renderProductUnits()">' +
        '<option value="">모든 모델</option>' +
        '<option value="sullivan"' + (window._prodFilter.model === 'sullivan' ? ' selected' : '') + '>Sullivan</option>' +
        '<option value="sound1"' + (window._prodFilter.model === 'sound1' ? ' selected' : '') + '>Sound1</option>' +
      '</select>' : '') +
    '<button class="btn btn-ghost btn-sm text-xs" onclick="window._prodFilter={status:\'\',model:\'\',search:\'\'};renderProductUnits()" title="필터 초기화"><i class="fas fa-rotate-left"></i></button>' +
  '</div>';

  var body = document.getElementById('prod-body');
  body.innerHTML = skeleton(3);
  try {
    var qs = [];
    if (window._prodTab !== 'all') qs.push('category=' + window._prodTab);
    if (window._prodFilter.status) qs.push('status=' + window._prodFilter.status);
    if (window._prodFilter.model) qs.push('model=' + window._prodFilter.model);
    if (window._prodFilter.search) qs.push('search=' + encodeURIComponent(window._prodFilter.search));
    var r = await API.get('/products/units' + (qs.length ? '?' + qs.join('&') : ''));
    var list = r.data.data || [];
    if (list.length === 0) {
      body.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fas fa-box-open"></i></div><p class="font-medium text-slate-500 mb-1">등록된 유닛이 없습니다</p><p class="text-xs text-slate-400 mb-4">"유닛 입고" 버튼으로 새 제품을 등록하세요</p><button class="btn btn-primary btn-sm" onclick="showProductUnitForm()"><i class="fas fa-plus mr-1"></i>유닛 입고</button></div>';
      return;
    }
    // 카테고리별 색상 정의
    var catTheme = {
      internal:   { name: '내부기',     bg: '#eff6ff', border: '#3b82f6', chip: '#dbeafe', chipFg: '#1e40af', icon: 'fa-building' },
      external:   { name: '외부기',     bg: '#ecfdf5', border: '#10b981', chip: '#d1fae5', chipFg: '#065f46', icon: 'fa-truck-fast' },
      carry_case: { name: '휴대보관함', bg: '#fffbeb', border: '#f59e0b', chip: '#fef3c7', chipFg: '#92400e', icon: 'fa-suitcase' }
    };

    // 전체 탭이면 카테고리별로 그룹화, 아니면 그대로 표시
    if (window._prodTab === 'all') {
      var grouped = { internal: [], external: [], carry_case: [] };
      list.forEach(function(u) {
        if (grouped[u.category]) grouped[u.category].push(u);
      });
      var sectionsHtml = '';
      ['internal', 'external', 'carry_case'].forEach(function(cat) {
        if (!grouped[cat].length) return;
        var t = catTheme[cat];
        sectionsHtml +=
          '<div class="mb-4 last:mb-0">' +
            '<div class="flex items-center gap-2 mb-2 pl-1" style="border-left:4px solid ' + t.border + ';padding-left:10px">' +
              '<i class="fas ' + t.icon + '" style="color:' + t.border + '"></i>' +
              '<span class="text-sm font-bold text-slate-800">' + t.name + '</span>' +
              '<span class="text-[11px] text-slate-400">(' + grouped[cat].length + '개)</span>' +
            '</div>' +
            renderProdUnitList(grouped[cat], catTheme) +
          '</div>';
      });
      body.innerHTML = sectionsHtml || '<div class="text-sm text-slate-400 p-4 text-center">표시할 유닛이 없습니다</div>';
    } else {
      body.innerHTML = renderProdUnitList(list, catTheme);
    }
  } catch (e) {
    body.innerHTML = '<div class="text-sm text-red-400 p-4">유닛 목록을 불러올 수 없습니다</div>';
  }
}

// 유닛 리스트 (테이블형) 렌더링
function renderProdUnitList(units, catTheme) {
  if (!units.length) return '<div class="text-xs text-slate-400 p-3 text-center">표시할 유닛이 없습니다</div>';
  // 테이블 헤더
  var html = '<div class="overflow-x-auto border border-gray-100 rounded-xl">' +
    '<table class="w-full text-xs">' +
      '<thead class="bg-slate-50 text-slate-500">' +
        '<tr>' +
          '<th class="px-2 py-2 text-left font-semibold w-[88px]">카테고리</th>' +
          '<th class="px-2 py-2 text-left font-semibold">시리얼번호 / 제품명</th>' +
          '<th class="px-2 py-2 text-left font-semibold hidden md:table-cell">모델명</th>' +
          '<th class="px-2 py-2 text-left font-semibold w-[100px]">상태</th>' +
          '<th class="px-2 py-2 text-left font-semibold hidden lg:table-cell">보유자</th>' +
          '<th class="px-2 py-2 text-left font-semibold hidden lg:table-cell">현재 위치</th>' +
          '<th class="px-2 py-2 text-right font-semibold w-[200px]">동작</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>';
  units.forEach(function(u) {
    html += prodUnitRow(u, catTheme);
  });
  html += '</tbody></table></div>';
  return html;
}

function prodUnitRow(u, catTheme) {
  var t = catTheme[u.category] || { name: u.category, bg: '#f8fafc', border: '#94a3b8', chip: '#f1f5f9', chipFg: '#475569', icon: 'fa-box' };
  var st = PROD_STATUS_COLORS[u.status] || PROD_STATUS_COLORS.in_stock;
  var stLbl = PROD_STATUS_LABELS[u.status] || u.status;
  var canLoan = (u.status === 'in_stock' || u.status === 'with_user');
  var canReturn = (u.status === 'at_hospital' || u.status === 'out');
  // 시리얼번호 우선, 없으면 모델명, 둘 다 없으면 #id
  var primary = u.serial_no || u.asset_code || ('#' + u.id);
  var locLabel = (u.status === 'in_stock' || u.status === 'with_user')
    ? '<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><i class="fas fa-building text-emerald-500 text-[10px]"></i>회사</span>'
    : (u.hospital_name
        ? '<div class="text-[11px] text-slate-700 truncate" title="' + u.hospital_name + '"><i class="fas fa-hospital text-slate-400 text-[9px] mr-1"></i>' + u.hospital_name + '</div>'
        : '<span class="text-slate-300 text-[11px]">—</span>');
  return '<tr class="border-t border-gray-100 hover:bg-slate-50/70 cursor-pointer transition" style="border-left:4px solid ' + t.border + '" onclick="showProductUnitDetail(' + u.id + ')">' +
    '<td class="px-2 py-2.5">' +
      '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:' + t.chip + ';color:' + t.chipFg + '">' +
        '<i class="fas ' + t.icon + ' text-[9px]"></i>' + t.name +
      '</span>' +
      (u.model && u.model !== 'default' ? '<div class="text-[10px] text-slate-500 mt-0.5">' + u.model + '</div>' : '') +
    '</td>' +
    '<td class="px-2 py-2.5">' +
      '<div class="font-mono font-bold text-[13px] text-slate-800 truncate">' + primary + '</div>' +
      '<div class="text-[11px] text-slate-500 truncate">' + (u.product_name || '') + '</div>' +
    '</td>' +
    '<td class="px-2 py-2.5 hidden md:table-cell">' +
      (u.asset_code && u.asset_code !== primary ? '<span class="font-mono text-[11px] text-slate-600">' + u.asset_code + '</span>' : '<span class="text-slate-300 text-[11px]">—</span>') +
    '</td>' +
    '<td class="px-2 py-2.5">' +
      '<span class="prod-status-chip" style="background:' + st.bg + ';color:' + st.fg + ';border-color:' + st.bd + '">' + stLbl + '</span>' +
    '</td>' +
    '<td class="px-2 py-2.5 hidden lg:table-cell">' +
      (u.holders ? '<div class="text-[11px] text-slate-700 truncate" title="' + u.holders + '"><i class="fas fa-user text-slate-400 text-[9px] mr-1"></i>' + u.holders + '</div>' : '<span class="text-slate-300 text-[11px]">—</span>') +
    '</td>' +
    '<td class="px-2 py-2.5 hidden lg:table-cell">' + locLabel + '</td>' +
    '<td class="px-2 py-2.5 text-right" onclick="event.stopPropagation()">' +
      '<div class="inline-flex items-center gap-1 sm:gap-1.5 flex-wrap justify-end">' +
        '<button class="prod-act-btn prod-act-btn-ghost" onclick="showProductHolderEdit(' + u.id + ')" title="보유자 수정"><i class="fas fa-user-pen"></i><span class="prod-act-btn-label">보유자</span></button>' +
        (canLoan ? '<button class="prod-act-btn prod-act-btn-outline" onclick="showProductMoveForm(' + u.id + ',\'checkout\')" title="반출"><i class="fas fa-arrow-up-from-bracket"></i><span class="prod-act-btn-label">반출</span></button>' : '') +
        (u.status === 'in_stock' || u.status === 'with_user' ? '<button class="prod-act-btn prod-act-btn-outline" onclick="showProductMoveForm(' + u.id + ',\'deliver\')" title="납품"><i class="fas fa-gift"></i><span class="prod-act-btn-label">납품</span></button>' : '') +
        (canReturn ? '<button class="prod-act-btn prod-act-btn-primary" onclick="quickReturnProductUnit(' + u.id + ')" title="회수"><i class="fas fa-arrow-down-to-bracket"></i><span class="prod-act-btn-label">회수</span></button>' : '') +
        '<button class="prod-act-btn prod-act-btn-ghost" onclick="showProductMoreActions(' + u.id + ')" title="더보기"><i class="fas fa-ellipsis-h"></i><span class="prod-act-btn-label">더보기</span></button>' +
      '</div>' +
    '</td>' +
  '</tr>';
}

// 제품 유닛 - "더보기" 액션 시트 (모바일 친화적, 큰 터치 영역)
function showProductMoreActions(unitId) {
  // 유닛 정보를 가볍게 가져와 가능한 액션만 표시
  API.get('/products/units/' + unitId).then(function(r) {
    var u = (r.data && r.data.data) || {};
    var canLoan = (u.status === 'in_stock' || u.status === 'with_user');
    var canReturn = (u.status === 'at_hospital' || u.status === 'out');
    var primary = u.serial_no || u.asset_code || ('#' + u.id);
    var stLbl = (PROD_STATUS_LABELS[u.status] || u.status);

    var actions = [];
    actions.push({ icon: 'fa-user-pen', label: '보유자 수정', fn: 'showProductHolderEdit(' + unitId + ')' });
    if (canLoan) actions.push({ icon: 'fa-arrow-up-from-bracket', label: '대여 반출', fn: 'showProductMoveForm(' + unitId + ",'checkout')" });
    if (u.status === 'in_stock' || u.status === 'with_user') actions.push({ icon: 'fa-gift', label: '영구 납품', fn: 'showProductMoveForm(' + unitId + ",'deliver')" });
    if (u.status === 'in_stock' || u.status === 'with_user') actions.push({ icon: 'fa-eye', label: '시연 (복귀)', fn: 'showProductMoveForm(' + unitId + ",'demo')" });
    if (canReturn) actions.push({ icon: 'fa-arrow-down-to-bracket', label: '회수', fn: 'quickReturnProductUnit(' + unitId + ')', cls: 'primary' });
    actions.push({ icon: 'fa-arrow-right-arrow-left', label: '담당자 이전', fn: 'showProductMoveForm(' + unitId + ",'transfer')" });
    actions.push({ icon: 'fa-pen', label: '유닛 정보 수정', fn: 'showProductUnitForm(' + unitId + ')' });
    actions.push({ icon: 'fa-wrench', label: '수리 처리', fn: 'showProductMoveForm(' + unitId + ",'repair')" });
    actions.push({ icon: 'fa-triangle-exclamation', label: '분실 처리', fn: 'showProductMoveForm(' + unitId + ",'lost')", cls: 'danger' });
    actions.push({ icon: 'fa-trash', label: '폐기 처리', fn: 'showProductMoveForm(' + unitId + ",'retire')", cls: 'danger' });

    var html = '<div class="card-flat p-3 bg-slate-50 mb-3">' +
      '<div class="text-[11px] text-slate-500 mb-1">대상 유닛</div>' +
      '<div class="text-sm font-bold text-slate-800">' + (u.product_name || '') + '</div>' +
      '<div class="text-[11px] text-slate-500 font-mono mt-0.5">' + primary + ' · 상태: ' + stLbl + '</div>' +
    '</div>' +
    '<div class="prod-mobile-action-sheet">' +
      actions.map(function(a) {
        return '<button class="' + (a.cls || '') + '" onclick="closeModal();' + a.fn + '"><i class="fas ' + a.icon + '"></i><span>' + a.label + '</span></button>';
      }).join('') +
    '</div>';
    openModal('<i class="fas fa-ellipsis-h text-slate-400 mr-2"></i>더보기', html, 'narrow');
  }).catch(function() { toast('유닛 정보 로드 실패', 'err'); });
}
window.showProductMoreActions = showProductMoreActions;

// 보유자 단독 수정 모달
async function showProductHolderEdit(unitId) {
  try {
    var [unitR, usersR] = await Promise.all([
      API.get('/products/units/' + unitId),
      API.get('/users')
    ]);
    var u = unitR.data.data;
    var users = usersR.data.data || [];
    var currentIds = (u.holders || [])
      .filter(function(h) { return !h.released_at; })
      .map(function(h) { return Number(h.user_id); });

    var html = '<form id="prod-holder-form" class="space-y-3">' +
      '<div class="card-flat p-3 bg-slate-50">' +
        '<div class="text-[11px] text-slate-500 mb-1">대상 유닛</div>' +
        '<div class="text-sm font-bold text-slate-800">' + (u.product_name || '') + '</div>' +
        '<div class="text-[11px] text-slate-500 font-mono mt-0.5">' +
          (u.serial_no ? 'S/N: ' + u.serial_no : '') +
          (u.asset_code ? (u.serial_no ? ' · ' : '') + '모델명: ' + u.asset_code : '') +
          (!u.serial_no && !u.asset_code ? '#' + u.id : '') +
        '</div>' +
      '</div>' +
      '<div>' +
        '<label class="input-label">현재 보유자 <span class="text-[10px] text-slate-400 font-normal">(체크박스로 추가/해제 — 다중 보유 가능)</span></label>' +
        '<div class="grid grid-cols-2 gap-1.5 p-2 border border-gray-200 rounded-lg max-h-56 overflow-y-auto">' +
          users.map(function(usr) {
            var checked = currentIds.indexOf(Number(usr.id)) >= 0;
            return '<label class="flex items-center gap-1.5 text-xs cursor-pointer p-1 rounded hover:bg-brand-50' + (checked ? ' bg-emerald-50' : '') + '">' +
              '<input type="checkbox" name="holder" value="' + usr.id + '" class="rounded"' + (checked ? ' checked' : '') + '>' +
              '<span>' + usr.name + '</span>' +
            '</label>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div><label class="input-label">사유 / 메모 <span class="text-[10px] text-slate-400 font-normal">(이력에 기록됨)</span></label>' +
        '<input type="text" name="reason" class="input" placeholder="예: 담당자 변경, 보유자 인계 등">' +
      '</div>' +
      '<div class="text-[11px] text-slate-500 bg-amber-50 rounded-lg p-2"><i class="fas fa-info-circle text-amber-500 mr-1"></i>저장 시 추가/해제 내역이 자동으로 이동 이력에 기록됩니다. 재고 상태에서는 기본적으로 김규태·도재민이 보유자로 자동 설정되며, 필요 시 추가 보유자를 더할 수 있습니다.</div>' +
      '<div class="flex justify-end gap-2 pt-3 border-t border-gray-100">' +
        '<button type="button" class="btn btn-outline" onclick="closeModal()">취소</button>' +
        '<button type="submit" class="btn btn-primary"><i class="fas fa-check mr-1"></i>저장</button>' +
      '</div>' +
    '</form>';
    openModal('보유자 수정', html);
    document.getElementById('prod-holder-form').onsubmit = async function(ev) {
      ev.preventDefault();
      var checks = ev.target.querySelectorAll('input[name="holder"]:checked');
      var userIds = Array.from(checks).map(function(c) { return Number(c.value); });
      var reason = ev.target.querySelector('input[name="reason"]').value || null;
      try {
        var res = await API.put('/products/units/' + unitId + '/holders', { user_ids: userIds, reason: reason });
        var d = res.data && res.data.data || {};
        var msg = '보유자 수정됨';
        if ((d.added || []).length || (d.removed || []).length) {
          msg += ' (추가 ' + (d.added || []).length + ' / 해제 ' + (d.removed || []).length + ')';
        }
        toast(msg);
        closeModal();
        refreshProductPage();
      } catch (e) { toast('수정 실패', 'err'); }
    };
  } catch (e) { toast('데이터 로드 실패', 'err'); }
}

// ============================================================
// 제품 세트 관리 UI
// ============================================================
async function renderProductSets() {
  var fb = document.getElementById('prod-filter-bar');
  fb.innerHTML = '<div class="flex flex-wrap items-center gap-2">' +
    '<button class="btn btn-primary btn-sm" onclick="showProductSetForm()"><i class="fas fa-plus mr-1"></i>새 세트 만들기</button>' +
    '<span class="text-[11px] text-slate-500 ml-2">내부기 + 외부기 + 휴대보관함 등을 묶어 한번에 반출/회수할 수 있습니다</span>' +
  '</div>';

  var body = document.getElementById('prod-body');
  body.innerHTML = skeleton(3);
  try {
    var r = await API.get('/products/sets');
    var sets = r.data.data || [];
    if (!sets.length) {
      body.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fas fa-cubes"></i></div>' +
        '<p class="font-medium text-slate-500 mb-1">등록된 세트가 없습니다</p>' +
        '<p class="text-xs text-slate-400 mb-4">"새 세트 만들기"로 유닛들을 묶어 세트를 구성하세요</p>' +
        '<button class="btn btn-primary btn-sm" onclick="showProductSetForm()"><i class="fas fa-plus mr-1"></i>새 세트 만들기</button></div>';
      return;
    }
    body.innerHTML = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">' + sets.map(prodSetCard).join('') + '</div>';
  } catch (e) {
    body.innerHTML = '<div class="text-sm text-red-400 p-4">세트 목록을 불러올 수 없습니다</div>';
  }
}

function prodSetCard(s) {
  var st = PROD_STATUS_STYLES[s.status] || { bg:'#f1f5f9', fg:'#475569', bd:'#e2e8f0' };
  var stLbl = (s.status === 'mixed' ? '혼합' : (PROD_STATUS_LABELS[s.status] || s.status));
  var comp = (s.composition || '').split(',').filter(Boolean);
  var compChips = comp.map(function(c) {
    var parts = c.split(':');
    var cat = parts[0], model = parts[1] || '';
    var t = PROD_CAT_THEMES[cat] || { chip:'#f1f5f9', chipFg:'#475569', icon:'fa-box' };
    var nm = (PROD_CAT_LABELS[cat] || cat) + (model && model !== 'default' && model !== 'sullivan_implant' ? ' · ' + model : '');
    return '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:' + t.chip + ';color:' + t.chipFg + '"><i class="fas ' + t.icon + ' text-[9px]"></i>' + nm + '</span>';
  }).join(' ');

  var canCheckout = (s.status === 'in_stock' || s.status === 'with_user');
  var canReturn = (s.status === 'at_hospital' || s.status === 'out');

  return '<div class="card-flat p-4">' +
    '<div class="flex items-start justify-between gap-3 mb-2">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<span class="font-bold text-slate-800 text-[14px]">' + (s.name || '') + '</span>' +
          '<span class="prod-status-chip" style="background:' + st.bg + ';color:' + st.fg + ';border-color:' + st.bd + '">' + stLbl + '</span>' +
          '<span class="text-[10px] text-slate-500"><i class="fas fa-cube mr-0.5"></i>유닛 ' + (s.unit_count || 0) + '개</span>' +
        '</div>' +
        (s.description ? '<div class="text-[11px] text-slate-500 mt-1">' + s.description + '</div>' : '') +
        (s.hospital_name ? '<div class="text-[11px] text-slate-600 mt-1"><i class="fas fa-hospital text-slate-400 text-[9px] mr-1"></i>' + s.hospital_name + '</div>' : '') +
      '</div>' +
    '</div>' +
    (compChips ? '<div class="flex flex-wrap gap-1 mb-3">' + compChips + '</div>' : '') +
    '<div class="flex flex-wrap gap-1.5 pt-3 border-t border-gray-100">' +
      '<button class="prod-act-btn prod-act-btn-outline" onclick="showProductSetDetail(' + s.id + ')"><i class="fas fa-list"></i><span class="prod-act-btn-label">상세</span></button>' +
      (canCheckout ? '<button class="prod-act-btn prod-act-btn-outline" onclick="showProductSetMoveForm(' + s.id + ',\'checkout\')"><i class="fas fa-arrow-up-from-bracket"></i><span class="prod-act-btn-label">세트 반출</span></button>' : '') +
      (canReturn ? '<button class="prod-act-btn prod-act-btn-primary" onclick="quickReturnProductSet(' + s.id + ')"><i class="fas fa-arrow-down-to-bracket"></i><span class="prod-act-btn-label">세트 회수</span></button>' : '') +
      '<button class="prod-act-btn prod-act-btn-outline" onclick="showProductSetForm(' + s.id + ')"><i class="fas fa-pen"></i><span class="prod-act-btn-label">수정</span></button>' +
      '<button class="prod-act-btn prod-act-btn-ghost !text-red-500" onclick="deleteProductSet(' + s.id + ')" title="삭제"><i class="fas fa-trash"></i></button>' +
    '</div>' +
  '</div>';
}

async function showProductSetForm(setId) {
  // 가용 유닛 + 세트 정보 로드
  try {
    var unitsR = await API.get('/products/units');
    var allUnits = unitsR.data.data || [];
    var setData = null;
    if (setId) {
      var sr = await API.get('/products/sets/' + setId);
      setData = sr.data.data;
    }
    var currentUnitIds = setData && setData.items ? setData.items.map(function(it) { return it.id; }) : [];
    var currentSet = new Set(currentUnitIds);

    // 정렬: 카테고리 → 모델 → S/N
    allUnits.sort(function(a, b) {
      var co = { internal:1, external:2, carry_case:3 };
      var ac = co[a.category] || 9, bc = co[b.category] || 9;
      if (ac !== bc) return ac - bc;
      return String(a.serial_no || a.asset_code || a.id).localeCompare(String(b.serial_no || b.asset_code || b.id));
    });

    var unitOpts = allUnits.map(function(u) {
      var disabled = (u.in_other_set && !currentSet.has(u.id));
      var checked = currentSet.has(u.id);
      var label = (PROD_CAT_LABELS[u.category] || u.category) +
        (u.model && u.model !== 'default' && u.model !== 'sullivan_implant' ? ' · ' + u.model : '') +
        ' · ' + (u.serial_no || u.asset_code || '#' + u.id) +
        ' [' + (PROD_STATUS_LABELS[u.status] || u.status) + ']';
      return '<label class="flex items-center gap-2 text-xs cursor-pointer py-1 px-2 hover:bg-slate-50 rounded ' + (disabled ? 'opacity-40' : '') + '">' +
        '<input type="checkbox" name="unit_id" value="' + u.id + '" class="rounded"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
        '<span class="truncate">' + label + '</span>' +
      '</label>';
    }).join('');

    var html = '<form id="prod-set-form" class="space-y-3">' +
      '<div><label class="input-label">세트 이름 *</label>' +
        '<input type="text" name="name" class="input" required value="' + (setData ? (setData.name || '').replace(/"/g, '&quot;') : '') + '" placeholder="예: Sullivan 풀세트 #1">' +
      '</div>' +
      '<div><label class="input-label">설명</label>' +
        '<input type="text" name="description" class="input" value="' + (setData ? (setData.description || '').replace(/"/g, '&quot;') : '') + '" placeholder="세트 용도/특징">' +
      '</div>' +
      '<div>' +
        '<label class="input-label">구성 유닛 * <span class="text-[10px] text-slate-400 font-normal">(다른 세트에 속한 유닛은 선택 불가)</span></label>' +
        '<div class="border border-gray-200 rounded-lg max-h-72 overflow-y-auto">' + (unitOpts || '<div class="text-xs text-slate-400 p-3">유닛이 없습니다</div>') + '</div>' +
      '</div>' +
      '<div><label class="input-label">비고</label><textarea name="notes" class="input" rows="2">' + (setData ? (setData.notes || '') : '') + '</textarea></div>' +
      '<div class="flex justify-end gap-2 pt-3 border-t border-gray-100">' +
        '<button type="button" class="btn btn-outline" onclick="closeModal()">취소</button>' +
        '<button type="submit" class="btn btn-primary"><i class="fas fa-check mr-1"></i>' + (setId ? '수정' : '세트 만들기') + '</button>' +
      '</div>' +
    '</form>';

    openModal(setId ? '세트 수정' : '새 세트 만들기', html);
    document.getElementById('prod-set-form').onsubmit = async function(ev) {
      ev.preventDefault();
      var f = new FormData(ev.target);
      var checks = ev.target.querySelectorAll('input[name="unit_id"]:checked');
      var unitIds = Array.from(checks).map(function(c) { return Number(c.value); });
      if (!unitIds.length) { toast('유닛을 1개 이상 선택하세요', 'warn'); return; }
      var payload = {
        name: f.get('name'),
        description: f.get('description') || null,
        notes: f.get('notes') || null,
        unit_ids: unitIds,
      };
      try {
        if (setId) {
          await API.put('/products/sets/' + setId, payload);
          toast('세트 수정 완료');
        } else {
          await API.post('/products/sets', payload);
          toast('세트 생성 완료');
        }
        closeModal();
        refreshProductPage();
      } catch (e) {
        var msg = (e.response && e.response.data && e.response.data.error) || '저장 실패';
        toast(msg, 'err');
      }
    };
  } catch (e) { toast('폼 로드 실패', 'err'); }
}

async function showProductSetDetail(setId) {
  try {
    var r = await API.get('/products/sets/' + setId);
    var s = r.data.data;
    var st = PROD_STATUS_STYLES[s.status] || { bg:'#f1f5f9', fg:'#475569', bd:'#e2e8f0' };
    var stLbl = (s.status === 'mixed' ? '혼합' : (PROD_STATUS_LABELS[s.status] || s.status));

    var itemsHtml = (s.items || []).map(function(it) {
      var t = PROD_CAT_THEMES[it.category] || { chip:'#f1f5f9', chipFg:'#475569', icon:'fa-box' };
      var its = PROD_STATUS_STYLES[it.status] || { bg:'#f1f5f9', fg:'#475569', bd:'#e2e8f0' };
      return '<div class="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0">' +
        '<span class="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:' + t.chip + ';color:' + t.chipFg + '"><i class="fas ' + t.icon + ' text-[9px]"></i>' + (PROD_CAT_LABELS[it.category] || it.category) + '</span>' +
        '<span class="font-mono text-[12px] font-bold">' + (it.serial_no || it.asset_code || '#' + it.id) + '</span>' +
        '<span class="text-[11px] text-slate-500 truncate flex-1">' + (it.product_name || '') + '</span>' +
        '<span class="prod-status-chip" style="background:' + its.bg + ';color:' + its.fg + ';border-color:' + its.bd + '">' + (PROD_STATUS_LABELS[it.status] || it.status) + '</span>' +
        (it.holders ? '<span class="text-[10px] text-slate-500 hidden sm:inline"><i class="fas fa-user text-[9px] mr-0.5"></i>' + it.holders + '</span>' : '') +
      '</div>';
    }).join('');

    var canCheckout = (s.status === 'in_stock' || s.status === 'with_user');
    var canReturn = (s.status === 'at_hospital' || s.status === 'out');

    var html = '<div class="space-y-4">' +
      '<div class="card-flat p-4">' +
        '<div class="flex items-center gap-2 flex-wrap mb-2">' +
          '<span class="font-bold text-base text-slate-800">' + (s.name || '') + '</span>' +
          '<span class="prod-status-chip" style="background:' + st.bg + ';color:' + st.fg + ';border-color:' + st.bd + '">' + stLbl + '</span>' +
        '</div>' +
        (s.description ? '<div class="text-[12px] text-slate-600 mb-1">' + s.description + '</div>' : '') +
        (s.hospital_name ? '<div class="text-[11px] text-slate-600"><i class="fas fa-hospital text-slate-400 text-[9px] mr-1"></i>' + s.hospital_name + '</div>' : '') +
        '<div class="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100">' +
          (canCheckout ? '<button class="prod-act-btn prod-act-btn-outline" onclick="closeModal();showProductSetMoveForm(' + s.id + ',\'checkout\')"><i class="fas fa-arrow-up-from-bracket"></i><span class="prod-act-btn-label">세트 반출</span></button>' : '') +
          (canReturn ? '<button class="prod-act-btn prod-act-btn-primary" onclick="closeModal();quickReturnProductSet(' + s.id + ')"><i class="fas fa-arrow-down-to-bracket"></i><span class="prod-act-btn-label">세트 회수</span></button>' : '') +
          '<button class="prod-act-btn prod-act-btn-outline" onclick="closeModal();showProductSetForm(' + s.id + ')"><i class="fas fa-pen"></i><span class="prod-act-btn-label">수정</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="card-flat p-4">' +
        '<div class="text-xs font-bold text-slate-700 mb-2"><i class="fas fa-cube mr-1"></i>구성 유닛 (' + (s.items || []).length + ')</div>' +
        (itemsHtml || '<div class="text-xs text-slate-400">구성 유닛 없음</div>') +
      '</div>' +
    '</div>';
    openModal('세트 #' + s.id, html);
  } catch (e) { toast('세트 정보 로드 실패', 'err'); }
}

async function showProductSetMoveForm(setId, defaultType) {
  if (!window._prodFormData) {
    try { var fd0 = await API.get('/meetings/form-data'); window._prodFormData = fd0.data.data; }
    catch (e) { window._prodFormData = { hospitals: [], doctors: [], users: [] }; }
  }
  var fd = window._prodFormData;
  var hospOpts = '<option value="">선택 안함</option>' + fd.hospitals.map(function(h) { return '<option value="' + h.id + '">' + h.name + '</option>'; }).join('');
  var userOpts = '<option value="">선택 안함</option>' + fd.users.map(function(u) { return '<option value="' + u.id + '">' + u.name + '</option>'; }).join('');

  var html = '<form id="prod-set-move-form" class="space-y-3">' +
    '<div class="text-[11px] text-slate-500 bg-amber-50 border border-amber-200 rounded p-2">' +
      '<i class="fas fa-circle-info mr-1 text-amber-600"></i>세트의 모든 구성 유닛에 동일하게 적용됩니다' +
    '</div>' +
    '<div><label class="input-label">유형</label>' +
      '<select name="movement_type" class="input">' +
        '<option value="checkout"' + (defaultType === 'checkout' ? ' selected' : '') + '>반출 (대여)</option>' +
        '<option value="deliver"' + (defaultType === 'deliver' ? ' selected' : '') + '>영구 납품</option>' +
        '<option value="demo"' + (defaultType === 'demo' ? ' selected' : '') + '>시연 (회수)</option>' +
      '</select>' +
    '</div>' +
    '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_loan" value="1" checked class="rounded"><span>대여 (반납 예정)</span></label>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
      '<div><label class="input-label">대상 기관</label><select name="hospital_id" class="input">' + hospOpts + '</select></div>' +
      '<div><label class="input-label">담당자 (To)</label><select name="to_user_id" class="input">' + userOpts + '</select></div>' +
    '</div>' +
    '<div><label class="input-label">예상 회수일</label><input type="date" name="expected_return_date" class="input"></div>' +
    '<div><label class="input-label">사유 / 비고</label><textarea name="reason" class="input" rows="2"></textarea></div>' +
    '<div class="flex justify-end gap-2 pt-3 border-t border-gray-100">' +
      '<button type="button" class="btn btn-outline" onclick="closeModal()">취소</button>' +
      '<button type="submit" class="btn btn-primary"><i class="fas fa-check mr-1"></i>세트 반출 처리</button>' +
    '</div>' +
  '</form>';
  openModal('세트 이동 처리', html);
  document.getElementById('prod-set-move-form').onsubmit = async function(ev) {
    ev.preventDefault();
    var f = new FormData(ev.target);
    var payload = {
      movement_type: f.get('movement_type'),
      is_loan: f.get('is_loan') ? 1 : 0,
      hospital_id: f.get('hospital_id') ? Number(f.get('hospital_id')) : null,
      to_user_id: f.get('to_user_id') ? Number(f.get('to_user_id')) : null,
      expected_return_date: f.get('expected_return_date') || null,
      reason: f.get('reason') || null,
    };
    try {
      var res = await API.post('/products/sets/' + setId + '/movements', payload);
      toast('세트 처리 완료 (' + (res.data.data.affected_units || 0) + '개 유닛 적용)');
      closeModal();
      refreshProductPage();
    } catch (e) { toast('처리 실패', 'err'); }
  };
}

async function quickReturnProductSet(setId) {
  if (!confirm('이 세트를 회수 처리하시겠습니까?\n구성된 모든 유닛이 한 번에 회수됩니다.')) return;
  try {
    var sr = await API.get('/products/sets/' + setId);
    var s = sr.data.data;
    var payload = {
      movement_type: 'return',
      hospital_id: s.current_hospital_id || null,
      reason: '세트 회수' + (s.hospital_name ? ' (' + s.hospital_name + ')' : ''),
    };
    var res = await API.post('/products/sets/' + setId + '/movements', payload);
    toast('세트 회수 완료 (' + (res.data.data.affected_units || 0) + '개 유닛)');
    refreshProductPage();
  } catch (e) { toast('회수 실패', 'err'); }
}

async function deleteProductSet(setId) {
  if (!confirm('이 세트를 삭제하시겠습니까?\n(구성 유닛은 유지되며, 세트 묶음만 해제됩니다)')) return;
  try {
    await API.delete('/products/sets/' + setId);
    toast('세트 삭제 완료');
    refreshProductPage();
  } catch (e) { toast('삭제 실패', 'err'); }
}

async function renderProductHistory() {
  var fb = document.getElementById('prod-filter-bar');
  fb.innerHTML = '<div class="flex flex-wrap items-center gap-2">' +
    '<select id="prod-mov-type" class="input !py-1.5 !text-xs !w-auto" style="border-radius:8px" onchange="renderProductHistory()">' +
      '<option value="">모든 유형</option>' +
      Object.keys(PROD_MOV_LABELS).map(function(k) { return '<option value="' + k + '">' + PROD_MOV_LABELS[k] + '</option>'; }).join('') +
    '</select>' +
    '<input id="prod-mov-from" type="date" class="input !py-1.5 !text-xs !w-auto" style="border-radius:8px" onchange="renderProductHistory()">' +
    '<input id="prod-mov-to" type="date" class="input !py-1.5 !text-xs !w-auto" style="border-radius:8px" onchange="renderProductHistory()">' +
  '</div>';

  var body = document.getElementById('prod-body');
  body.innerHTML = skeleton(4);
  try {
    var qs = [];
    var t = document.getElementById('prod-mov-type')?.value;
    var fr = document.getElementById('prod-mov-from')?.value;
    var to = document.getElementById('prod-mov-to')?.value;
    if (t) qs.push('type=' + t);
    if (fr) qs.push('from=' + fr);
    if (to) qs.push('to=' + to);
    var r = await API.get('/products/movements' + (qs.length ? '?' + qs.join('&') : ''));
    var list = r.data.data || [];
    if (list.length === 0) {
      body.innerHTML = '<div class="empty"><div class="empty-icon"><i class="fas fa-clock-rotate-left"></i></div><p class="text-slate-500">이력이 없습니다</p></div>';
      return;
    }
    body.innerHTML = '<div class="divide-y divide-gray-100">' + list.map(prodMovRow).join('') + '</div>';
  } catch (e) {
    body.innerHTML = '<div class="text-sm text-red-400 p-4">이력을 불러올 수 없습니다</div>';
  }
}

function prodMovRow(m) {
  var lbl = PROD_MOV_LABELS[m.movement_type] || m.movement_type;
  var icon = PROD_MOV_ICONS[m.movement_type] || 'fa-circle';
  var when = (m.performed_at || '').slice(0, 16).replace('T', ' ');
  return '<div class="flex items-start gap-3 py-3 px-1 hover:bg-slate-50 cursor-pointer" onclick="showProductUnitDetail(' + m.product_unit_id + ')">' +
    '<div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><i class="fas ' + icon + ' text-slate-500 text-xs"></i></div>' +
    '<div class="flex-1 min-w-0">' +
      '<div class="flex items-center gap-2 flex-wrap">' +
        '<span class="text-[12px] font-bold text-slate-800">' + lbl + '</span>' +
        (m.is_loan ? '<span class="text-[10px] px-1.5 py-0.5 rounded font-bold" style="background:#fef3c7;color:#92400e">대여</span>' : '') +
        '<span class="text-[11px] text-slate-500 font-mono">' + (m.product_name || '') + (m.asset_code ? ' · ' + m.asset_code : '') + '</span>' +
      '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">' +
        (m.from_user_name ? '<span>' + m.from_user_name + ' →</span>' : '') +
        (m.to_user_name ? ' <span class="font-medium text-slate-700">' + m.to_user_name + '</span>' : '') +
        (m.hospital_name ? ' <span class="ml-1"><i class="fas fa-hospital text-slate-300 text-[9px]"></i> ' + m.hospital_name + '</span>' : '') +
        (m.expected_return_date && !m.actual_return_date ? ' <span class="ml-1 text-amber-600">예상회수 ' + m.expected_return_date + '</span>' : '') +
        (m.actual_return_date ? ' <span class="ml-1 text-emerald-600">회수 ' + m.actual_return_date + '</span>' : '') +
      '</div>' +
      (m.reason ? '<div class="text-[11px] text-slate-400 mt-0.5">' + m.reason + '</div>' : '') +
    '</div>' +
    '<div class="text-[10px] text-slate-400 flex-shrink-0">' + when + '<div class="text-right mt-0.5">' + (m.performed_by_name || '') + '</div></div>' +
  '</div>';
}

// ===== 카테고리/모델 관리 모달 (모델명 등록 포함) =====
async function showProductCatalog() {
  try {
    var r = await API.get('/products');
    var products = r.data.data || [];
    var html = '<div class="space-y-2">' +
      '<div class="text-[11px] text-slate-500 bg-blue-50 border border-blue-200 rounded p-2 mb-2">' +
        '<i class="fas fa-circle-info mr-1 text-blue-600"></i>제품별 <strong>모델명</strong>을 등록해두면, 유닛 입고 시 자동으로 적용됩니다 (개별 입력 불필요)' +
      '</div>' +
      products.map(function(p) {
      return '<div class="card-flat p-3" data-pid="' + p.id + '">' +
        '<div class="flex items-center gap-2 mb-2">' +
          '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#e0e7ff;color:#3730a3">' + (PROD_CAT_LABELS[p.category] || p.category) + '</span>' +
          '<input type="text" class="input !py-1.5 !text-xs flex-1" data-field="name" value="' + (p.name || '').replace(/"/g, '&quot;') + '" placeholder="제품 표시명">' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">' +
          '<div>' +
            '<label class="text-[10px] font-semibold text-slate-600 block mb-0.5">모델명 <span class="text-slate-400 font-normal">(유닛 입고 시 자동 적용)</span></label>' +
            '<input type="text" class="input !py-1.5 !text-xs w-full font-mono" data-field="model_code" value="' + (p.model_code || '').replace(/"/g, '&quot;') + '" placeholder="예: TD-IMP-S1">' +
          '</div>' +
          '<div>' +
            '<label class="text-[10px] font-semibold text-slate-600 block mb-0.5">재고 현황</label>' +
            '<div class="text-[11px] text-slate-500 py-1.5">재고 ' + (p.in_stock_count || 0) + ' · 외부 ' + (p.out_count || 0) + ' · 납품 ' + (p.delivered_count || 0) + ' · 총 ' + (p.total_count || 0) + '개</div>' +
          '</div>' +
        '</div>' +
        '<textarea class="input !py-2 !text-xs w-full" data-field="description" rows="2" placeholder="비고 / 메모">' + (p.description || '') + '</textarea>' +
        '<div class="flex justify-end mt-2"><button class="prod-act-btn prod-act-btn-primary" onclick="saveProductCatalog(' + p.id + ',this)"><i class="fas fa-save"></i><span class="prod-act-btn-label">저장</span></button></div>' +
      '</div>';
    }).join('') + '</div>';
    openModal('카테고리·모델 관리', html);
  } catch (e) { toast('카테고리 정보를 불러올 수 없습니다', 'err'); }
}

async function saveProductCatalog(id, btn) {
  var card = btn.closest('[data-pid]');
  var name = card.querySelector('[data-field="name"]').value;
  var desc = card.querySelector('[data-field="description"]').value;
  var modelCode = card.querySelector('[data-field="model_code"]').value;
  try {
    await API.put('/products/' + id, { name: name, description: desc, model_code: modelCode });
    toast('저장됨');
  } catch (e) { toast('저장 실패', 'err'); }
}

// ===== 유닛 입고/수정 모달 =====
async function showProductUnitForm(id) {
  var products = [], users = [];
  try {
    var [pr, ur] = await Promise.all([ API.get('/products'), API.get('/users') ]);
    products = pr.data.data || [];
    users = ur.data.data || [];
  } catch (e) { toast('데이터 로드 실패', 'err'); return; }

  var unit = { product_id: '', serial_no: '', asset_code: '', acquired_at: new Date().toISOString().slice(0, 10), notes: '', holder_user_ids: [] };
  if (id) {
    try { var rr = await API.get('/products/units/' + id); unit = rr.data.data; } catch (e) {}
  }

  // 수정 모드는 기존 단일 폼 그대로
  if (id) {
    var htmlEdit = '<form id="prod-unit-form" class="space-y-3">' +
      '<div><label class="input-label">제품 *</label>' +
        '<select name="product_id" class="input" required>' +
          '<option value="">선택하세요</option>' +
          products.map(function(p) {
            return '<option value="' + p.id + '"' + (p.id == unit.product_id ? ' selected' : '') + '>' + p.name + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="grid grid-cols-2 gap-3">' +
        '<div><label class="input-label">모델명 <span class="text-[10px] text-slate-400 font-normal">(미입력 시 제품 기본값 적용)</span></label><input type="text" name="asset_code" value="' + (unit.asset_code || '') + '" class="input font-mono" placeholder="예: TD-IMP-S1"></div>' +
        '<div><label class="input-label">S/N (일련번호)</label><input type="text" name="serial_no" value="' + (unit.serial_no || '') + '" class="input font-mono" placeholder="시리얼 번호"></div>' +
      '</div>' +
      '<div><label class="input-label">입고일</label><input type="date" name="acquired_at" value="' + (unit.acquired_at || '') + '" class="input"></div>' +
      '<div><label class="input-label">비고</label><textarea name="notes" class="input" rows="2" placeholder="유닛 비고">' + (unit.notes || '') + '</textarea></div>' +
      '<div class="flex justify-end gap-2 pt-3 border-t border-gray-100">' +
        '<button type="button" class="btn btn-outline" onclick="closeModal()">취소</button>' +
        '<button type="submit" class="btn btn-primary">저장</button>' +
      '</div>' +
    '</form>';
    openModal('유닛 정보 수정', htmlEdit);
    document.getElementById('prod-unit-form').onsubmit = async function(ev) {
      ev.preventDefault();
      var fd = new FormData(ev.target);
      var payload = {
        product_id: Number(fd.get('product_id')),
        asset_code: fd.get('asset_code') || null,
        serial_no: fd.get('serial_no') || null,
        acquired_at: fd.get('acquired_at') || null,
        notes: fd.get('notes') || null,
      };
      try {
        await API.put('/products/units/' + id, payload);
        toast('저장됨');
        closeModal();
        refreshProductPage();
      } catch (e) { toast('저장 실패', 'err'); }
    };
    return;
  }

  // 신규 입고 — 단일/다량 토글 방식 (초기 보유자: 기본 전체 선택)
  var holderCb = users.map(function(u) {
    return '<label class="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" name="holder" value="' + u.id + '" class="rounded" checked><span>' + u.name + '</span></label>';
  }).join('');

  var html = '<form id="prod-unit-form" class="space-y-3">' +
    // 모드 토글
    '<div class="inline-flex rounded-lg bg-slate-100 p-1 mb-1" role="tablist">' +
      '<button type="button" id="punit-mode-single" class="px-3 py-1.5 text-xs font-semibold rounded-md transition bg-white shadow text-slate-800" onclick="setProdUnitMode(\'single\')"><i class="fas fa-box mr-1"></i>단일 입고</button>' +
      '<button type="button" id="punit-mode-bulk" class="px-3 py-1.5 text-xs font-semibold rounded-md transition text-slate-500" onclick="setProdUnitMode(\'bulk\')"><i class="fas fa-boxes-stacked mr-1"></i>다량 입고</button>' +
    '</div>' +
    '<div><label class="input-label">제품 *</label>' +
      '<select name="product_id" class="input" required>' +
        '<option value="">선택하세요</option>' +
        products.map(function(p) {
          return '<option value="' + p.id + '">' + p.name + '</option>';
        }).join('') +
      '</select>' +
    '</div>' +
    // 안내: 모델명은 카테고리 마스터에서 자동 적용
    '<div class="text-[11px] text-slate-500 bg-blue-50 border border-blue-200 rounded p-2">' +
      '<i class="fas fa-circle-info mr-1 text-blue-600"></i>모델명은 선택한 제품의 기본값이 자동 적용됩니다 ' +
      '<button type="button" class="text-blue-700 underline ml-1" onclick="closeModal();showProductCatalog()">카테고리 관리에서 등록</button>' +
    '</div>' +
    // 단일 모드 영역
    '<div id="punit-single-fields" class="space-y-3">' +
      '<div><label class="input-label">S/N (일련번호)</label><input type="text" name="serial_no" class="input font-mono" placeholder="시리얼 번호"></div>' +
      '<details class="mt-1">' +
        '<summary class="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700"><i class="fas fa-chevron-right text-[9px] mr-1"></i>모델명을 개별 지정 (선택)</summary>' +
        '<input type="text" name="asset_code" class="input font-mono text-xs mt-2" placeholder="개별 모델명 (미입력 시 제품 기본값 적용)">' +
      '</details>' +
    '</div>' +
    // 다량 모드 영역
    '<div id="punit-bulk-fields" class="space-y-2 hidden">' +
      '<label class="input-label">시리얼번호 목록 * <span class="text-[10px] text-slate-400 font-normal">(한 줄에 하나씩 또는 쉼표로 구분)</span></label>' +
      '<textarea name="bulk_serials" class="input font-mono text-xs" rows="6" placeholder="SN-001&#10;SN-002&#10;SN-003&#10;...&#10;&#10;또는 쉼표 구분: SN-001, SN-002, SN-003"></textarea>' +
      '<div class="flex items-center justify-between text-[11px]">' +
        '<span class="text-slate-500" id="punit-bulk-count">0개</span>' +
        '<span class="text-slate-400">중복 시리얼번호는 자동 스킵됩니다</span>' +
      '</div>' +
      '<details class="mt-2">' +
        '<summary class="text-[11px] text-slate-500 cursor-pointer hover:text-slate-700"><i class="fas fa-chevron-right text-[9px] mr-1"></i>모델명을 개별 지정 (선택)</summary>' +
        '<textarea name="bulk_asset_codes" class="input font-mono text-xs mt-2" rows="4" placeholder="시리얼번호와 같은 순서로 한 줄씩 입력&#10;빈 줄은 제품 기본 모델명이 적용됩니다"></textarea>' +
      '</details>' +
    '</div>' +
    '<div><label class="input-label">입고일</label><input type="date" name="acquired_at" value="' + new Date().toISOString().slice(0, 10) + '" class="input"></div>' +
    '<div><label class="input-label">초기 보유자 <span class="text-[10px] text-slate-400 font-normal">(다중 선택 가능, 다량 입고 시 전체 유닛에 동일 적용)</span></label>' +
      '<div class="grid grid-cols-2 gap-1.5 p-2 border border-gray-200 rounded-lg max-h-40 overflow-y-auto">' + holderCb + '</div>' +
      '<div class="text-[10px] text-slate-400 mt-1">선택하지 않으면 재고 상태로만 입고됩니다</div>' +
    '</div>' +
    '<div><label class="input-label">비고</label><textarea name="notes" class="input" rows="2" placeholder="유닛 비고"></textarea></div>' +
    '<div class="flex justify-end gap-2 pt-3 border-t border-gray-100">' +
      '<button type="button" class="btn btn-outline" onclick="closeModal()">취소</button>' +
      '<button type="submit" class="btn btn-primary" id="punit-submit"><i class="fas fa-check mr-1"></i>입고 등록</button>' +
    '</div>' +
  '</form>';

  openModal('신규 유닛 입고', html);
  window._prodUnitMode = 'single';
  // 다량 시리얼 카운트 실시간 업데이트
  setTimeout(function() {
    var ta = document.querySelector('textarea[name="bulk_serials"]');
    var cn = document.getElementById('punit-bulk-count');
    if (ta && cn) {
      ta.addEventListener('input', function() {
        var lines = parseBulkSerials(ta.value);
        cn.textContent = lines.length + '개';
        cn.style.color = lines.length > 0 ? '#0f172a' : '#94a3b8';
      });
    }
  }, 50);

  document.getElementById('prod-unit-form').onsubmit = async function(ev) {
    ev.preventDefault();
    var fd = new FormData(ev.target);
    var productId = Number(fd.get('product_id'));
    if (!productId) { toast('제품을 선택하세요', 'warn'); return; }
    var checks = ev.target.querySelectorAll('input[name="holder"]:checked');
    var holderIds = Array.from(checks).map(function(c) { return Number(c.value); });

    if (window._prodUnitMode === 'bulk') {
      var serials = parseBulkSerials(fd.get('bulk_serials') || '');
      var assetCodes = parseBulkSerials(fd.get('bulk_asset_codes') || '', true);
      if (!serials.length) { toast('시리얼번호를 1개 이상 입력하세요', 'warn'); return; }
      var payload = {
        product_id: productId,
        serial_nos: serials,
        asset_codes: assetCodes,
        acquired_at: fd.get('acquired_at') || null,
        notes: fd.get('notes') || null,
        holder_user_ids: holderIds,
      };
      try {
        var res = await API.post('/products/units/bulk', payload);
        var d = res.data && res.data.data || {};
        var msg = '다량 입고 완료: ' + (d.created_count || 0) + '건';
        if (d.skipped && d.skipped.length) msg += ' (중복 스킵: ' + d.skipped.length + '건)';
        toast(msg);
        closeModal();
        refreshProductPage();
      } catch (e) { toast('다량 입고 실패', 'err'); }
    } else {
      var payload2 = {
        product_id: productId,
        asset_code: fd.get('asset_code') || null,
        serial_no: fd.get('serial_no') || null,
        acquired_at: fd.get('acquired_at') || null,
        notes: fd.get('notes') || null,
        holder_user_ids: holderIds,
      };
      try {
        await API.post('/products/units', payload2);
        toast('입고 등록 완료');
        closeModal();
        refreshProductPage();
      } catch (e) { toast('입고 실패', 'err'); }
    }
  };
}

function setProdUnitMode(mode) {
  window._prodUnitMode = mode;
  var bSingle = document.getElementById('punit-mode-single');
  var bBulk = document.getElementById('punit-mode-bulk');
  var sf = document.getElementById('punit-single-fields');
  var bf = document.getElementById('punit-bulk-fields');
  var sb = document.getElementById('punit-submit');
  if (mode === 'bulk') {
    bBulk.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition bg-white shadow text-slate-800';
    bSingle.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition text-slate-500';
    sf.classList.add('hidden');
    bf.classList.remove('hidden');
    if (sb) sb.innerHTML = '<i class="fas fa-boxes-stacked mr-1"></i>다량 입고 등록';
  } else {
    bSingle.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition bg-white shadow text-slate-800';
    bBulk.className = 'px-3 py-1.5 text-xs font-semibold rounded-md transition text-slate-500';
    sf.classList.remove('hidden');
    bf.classList.add('hidden');
    if (sb) sb.innerHTML = '<i class="fas fa-check mr-1"></i>입고 등록';
  }
}

// 다량 시리얼 입력 파싱 — 줄바꿈/쉼표/탭/세미콜론 모두 구분자로 처리
// preserveEmpty=true 시 빈 줄도 유지 (asset_codes 인덱스 정렬용)
function parseBulkSerials(text, preserveEmpty) {
  if (!text) return [];
  // 쉼표/세미콜론/탭은 줄바꿈으로 변환
  var normalized = String(text).replace(/[,;\t]/g, '\n');
  var arr = normalized.split('\n').map(function(s) { return s.trim(); });
  if (!preserveEmpty) arr = arr.filter(function(s) { return s.length > 0; });
  return arr;
}

// ===== 회수 빠른 처리 (직전 반출 이력 기반 자동) =====
async function quickReturnProductUnit(unitId) {
  if (!confirm('이 유닛을 회수 처리하시겠습니까?\n(직전 반출 이력의 기관/담당자가 자동 적용됩니다)')) return;
  try {
    // 직전 미회수 반출 이력 조회 (선택사항: 정보 표시용)
    var detail;
    try {
      var dr = await API.get('/products/units/' + unitId);
      detail = dr.data.data;
    } catch (e) {}

    var lastLoan = null;
    if (detail && Array.isArray(detail.movements)) {
      lastLoan = detail.movements.find(function(m) {
        return (m.movement_type === 'checkout' || m.movement_type === 'demo') && m.is_loan && !m.actual_return_date;
      });
    }

    var payload = {
      product_unit_id: unitId,
      movement_type: 'return',
      hospital_id: (lastLoan && lastLoan.hospital_id) || null,
      from_user_id: (lastLoan && lastLoan.to_user_id) || null,
      reason: lastLoan ? '회수 (' + (lastLoan.hospital_name || '') + ')' : '회수',
    };
    await API.post('/products/movements', payload);
    toast('회수 완료');
    refreshProductPage();
  } catch (e) {
    toast('회수 실패', 'err');
  }
}

// ===== 이동(반출/회수/납품) 모달 =====
async function showProductMoveForm(unitId, defaultType) {
  if (!window._prodFormData) {
    try {
      var fd = await API.get('/meetings/form-data');
      window._prodFormData = fd.data.data;
    } catch (e) { window._prodFormData = { hospitals: [], doctors: [], users: [] }; }
  }
  var fd = window._prodFormData;
  var hospOpts = '<option value="">선택 안함</option>' + fd.hospitals.map(function(h) { return '<option value="' + h.id + '">' + h.name + '</option>'; }).join('');
  var userOpts = '<option value="">선택 안함</option>' + fd.users.map(function(u) { return '<option value="' + u.id + '">' + u.name + '</option>'; }).join('');

  var typeOpts = Object.keys(PROD_MOV_LABELS).filter(function(k) {
    return k !== 'inbound' && k !== 'assign' && k !== 'release';
  }).map(function(k) {
    return '<option value="' + k + '"' + (k === defaultType ? ' selected' : '') + '>' + PROD_MOV_LABELS[k] + '</option>';
  }).join('');

  var html = '<form id="prod-move-form" class="space-y-3">' +
    '<div><label class="input-label">이동 유형 *</label><select name="movement_type" class="input" required onchange="onProdMoveTypeChange(this.value)">' + typeOpts + '</select></div>' +
    '<div id="prod-move-loan" class="hidden">' +
      '<label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_loan" value="1" class="rounded"><span>대여 (반납 예정)</span></label>' +
    '</div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
      '<div><label class="input-label">대상 기관</label><select name="hospital_id" class="input">' + hospOpts + '</select></div>' +
      '<div><label class="input-label">담당자 (To)</label><select name="to_user_id" class="input">' + userOpts + '</select></div>' +
    '</div>' +
    '<div id="prod-move-from-wrap" class="hidden"><label class="input-label">이전 담당자 (From)</label><select name="from_user_id" class="input">' + userOpts + '</select></div>' +
    '<div id="prod-move-ret" class="hidden">' +
      '<label class="input-label">예상 회수일</label><input type="date" name="expected_return_date" class="input">' +
    '</div>' +
    '<div><label class="input-label">사유 / 비고</label><textarea name="reason" class="input" rows="2" placeholder="이동 사유"></textarea></div>' +
    '<div class="flex justify-end gap-2 pt-3 border-t border-gray-100">' +
      '<button type="button" class="btn btn-outline" onclick="closeModal()">취소</button>' +
      '<button type="submit" class="btn btn-primary"><i class="fas fa-check mr-1"></i>처리</button>' +
    '</div>' +
  '</form>';
  openModal('제품 이동 처리', html);
  onProdMoveTypeChange(defaultType || 'checkout');
  document.getElementById('prod-move-form').onsubmit = async function(ev) {
    ev.preventDefault();
    var f = new FormData(ev.target);
    var payload = {
      product_unit_id: unitId,
      movement_type: f.get('movement_type'),
      is_loan: f.get('is_loan') ? 1 : 0,
      hospital_id: f.get('hospital_id') ? Number(f.get('hospital_id')) : null,
      to_user_id: f.get('to_user_id') ? Number(f.get('to_user_id')) : null,
      from_user_id: f.get('from_user_id') ? Number(f.get('from_user_id')) : null,
      expected_return_date: f.get('expected_return_date') || null,
      reason: f.get('reason') || null,
    };
    try {
      await API.post('/products/movements', payload);
      toast('처리되었습니다');
      closeModal();
      refreshProductPage();
    } catch (e) { toast('처리 실패', 'err'); }
  };
}

function onProdMoveTypeChange(t) {
  var ret = document.getElementById('prod-move-ret');
  var loan = document.getElementById('prod-move-loan');
  var fromWrap = document.getElementById('prod-move-from-wrap');
  if (!ret) return;
  if (t === 'checkout') { ret.classList.remove('hidden'); loan.classList.remove('hidden'); fromWrap.classList.add('hidden'); }
  else if (t === 'transfer') { ret.classList.add('hidden'); loan.classList.add('hidden'); fromWrap.classList.remove('hidden'); }
  else if (t === 'return' || t === 'release') { ret.classList.add('hidden'); loan.classList.add('hidden'); fromWrap.classList.remove('hidden'); }
  else { ret.classList.add('hidden'); loan.classList.add('hidden'); fromWrap.classList.add('hidden'); }
}

// ===== 유닛 상세 (이동 이력 타임라인) =====
async function showProductUnitDetail(id) {
  try {
    var r = await API.get('/products/units/' + id);
    var u = r.data.data;
    var st = PROD_STATUS_COLORS[u.status] || PROD_STATUS_COLORS.in_stock;
    var stLbl = PROD_STATUS_LABELS[u.status] || u.status;

    var holdersHtml = (u.holders || []).filter(function(h) { return !h.released_at; }).map(function(h) {
      return '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium" style="background:#dbeafe;color:#1e40af"><i class="fas fa-user text-[9px]"></i>' + h.user_name + '</span>';
    }).join(' ');
    if (!holdersHtml) holdersHtml = '<span class="text-[11px] text-slate-400">보유자 없음</span>';

    var html = '<div class="space-y-4">' +
      '<div class="card-flat p-4">' +
        '<div class="flex items-center gap-2 mb-2 flex-wrap">' +
          '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#e0e7ff;color:#3730a3">' + (PROD_CAT_LABELS[u.category] || u.category) + '</span>' +
          (u.model && u.model !== 'default' && u.model !== 'sullivan_implant' ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:#f1f5f9;color:#475569">' + u.model + '</span>' : '') +
          '<span class="prod-status-chip" style="background:' + st.bg + ';color:' + st.fg + ';border-color:' + st.bd + '">' + stLbl + '</span>' +
        '</div>' +
        '<div class="font-bold text-base text-slate-800 mb-1">' + (u.product_name || '') + '</div>' +
        '<div class="text-[11px] text-slate-500 space-y-0.5">' +
          (u.asset_code ? '<div>모델명: <strong class="font-mono">' + u.asset_code + '</strong></div>' : '') +
          (u.serial_no ? '<div>S/N: <strong class="font-mono">' + u.serial_no + '</strong></div>' : '') +
          (u.acquired_at ? '<div>입고일: ' + u.acquired_at + '</div>' : '') +
          ((u.status === 'in_stock' || u.status === 'with_user')
            ? '<div>현재 위치: <strong class="text-emerald-700"><i class="fas fa-building text-emerald-500 text-[10px] mr-0.5"></i>회사</strong></div>'
            : (u.hospital_name ? '<div>현재 위치: ' + u.hospital_name + '</div>' : '')) +
          (u.notes ? '<div class="mt-1 pt-1 border-t border-gray-100">비고: ' + u.notes + '</div>' : '') +
          (u.product_description ? '<div class="text-slate-400 italic">카테고리 설명: ' + u.product_description + '</div>' : '') +
        '</div>' +
        '<div class="mt-3 pt-3 border-t border-gray-100">' +
          '<div class="flex items-center justify-between mb-1">' +
            '<div class="text-[11px] text-slate-500">현재 보유자</div>' +
            '<button class="text-[10px] text-brand-600 hover:underline" onclick="closeModal();showProductHolderEdit(' + u.id + ')"><i class="fas fa-user-pen mr-0.5"></i>보유자 수정</button>' +
          '</div>' +
          '<div class="flex flex-wrap gap-1.5">' + holdersHtml + '</div>' +
        '</div>' +
        '<div class="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-100">' +
          '<button class="prod-act-btn prod-act-btn-outline" onclick="closeModal();showProductMoveForm(' + u.id + ',\'checkout\')"><i class="fas fa-arrow-up-from-bracket"></i><span class="prod-act-btn-label">반출</span></button>' +
          '<button class="prod-act-btn prod-act-btn-primary" onclick="closeModal();quickReturnProductUnit(' + u.id + ')"><i class="fas fa-arrow-down-to-bracket"></i><span class="prod-act-btn-label">회수</span></button>' +
          '<button class="prod-act-btn prod-act-btn-outline" onclick="closeModal();showProductMoveForm(' + u.id + ',\'deliver\')"><i class="fas fa-gift"></i><span class="prod-act-btn-label">납품</span></button>' +
          '<button class="prod-act-btn prod-act-btn-outline" onclick="closeModal();showProductMoveForm(' + u.id + ',\'transfer\')"><i class="fas fa-arrow-right-arrow-left"></i><span class="prod-act-btn-label">이전</span></button>' +
          '<button class="prod-act-btn prod-act-btn-ghost" onclick="closeModal();showProductUnitForm(' + u.id + ')"><i class="fas fa-pen"></i><span class="prod-act-btn-label">수정</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="card-flat p-4">' +
        '<div class="text-xs font-bold text-slate-700 mb-2"><i class="fas fa-clock-rotate-left mr-1"></i>이동 이력 (' + (u.movements || []).length + ')</div>' +
        ((u.movements || []).length === 0 ? '<div class="text-xs text-slate-400">이력 없음</div>' :
          '<div class="divide-y divide-gray-100">' + u.movements.map(prodMovTimelineRow).join('') + '</div>') +
      '</div>' +
    '</div>';
    openModal('유닛 상세 #' + u.id, html);
  } catch (e) { toast('상세 정보 로드 실패', 'err'); }
}

function prodMovTimelineRow(m) {
  var lbl = PROD_MOV_LABELS[m.movement_type] || m.movement_type;
  var icon = PROD_MOV_ICONS[m.movement_type] || 'fa-circle';
  var when = (m.performed_at || '').slice(0, 16).replace('T', ' ');
  return '<div class="flex items-start gap-2 py-2">' +
    '<div class="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><i class="fas ' + icon + ' text-slate-500 text-[10px]"></i></div>' +
    '<div class="flex-1 min-w-0">' +
      '<div class="flex items-center gap-2 flex-wrap">' +
        '<span class="text-[11px] font-bold text-slate-800">' + lbl + '</span>' +
        (m.is_loan ? '<span class="text-[9px] px-1 py-0.5 rounded font-bold" style="background:#fef3c7;color:#92400e">대여</span>' : '') +
        '<span class="text-[10px] text-slate-400">' + when + '</span>' +
      '</div>' +
      '<div class="text-[11px] text-slate-500 mt-0.5">' +
        (m.from_user_name ? m.from_user_name + ' → ' : '') +
        (m.to_user_name || '') +
        (m.hospital_name ? ' · ' + m.hospital_name : '') +
        (m.meeting_date ? ' · 미팅 ' + m.meeting_date : '') +
      '</div>' +
      (m.reason ? '<div class="text-[11px] text-slate-400 mt-0.5">' + m.reason + '</div>' : '') +
    '</div>' +
    '<div class="text-[10px] text-slate-400">' + (m.performed_by_name || '') + '</div>' +
  '</div>';
}

// ============================================================
// 미팅 폼 — 동반 반출 제품 선택 picker (Q4 자동 연계)
// ============================================================

// 미팅 폼의 동행 제품 picker 에서 선택된 값들을 한번에 수집
// (개별 유닛 + 세트 + 처리 유형 + 대여 여부)
// scope: 폼 컨테이너 셀렉터 (기본 '#fm')
function collectMeetProductPicks(scope) {
  scope = scope || '#fm';
  return {
    unit_ids: Array.from(document.querySelectorAll(scope + ' input[name="meet_product_unit"]:checked:not(:disabled)')).map(function(cb){ return Number(cb.value); }),
    set_ids: Array.from(document.querySelectorAll(scope + ' input[name="meet_product_set"]:checked:not(:disabled)')).map(function(cb){ return Number(cb.value); }),
    action: (document.querySelector(scope + ' select[name="meet_product_action"]') || {}).value || 'demo',
    is_loan: !!(document.querySelector(scope + ' input[name="meet_product_is_loan"]') || {}).checked
  };
}

// 수집된 picks 를 미팅에 연계 (개별 유닛 + 세트). 에러는 toast 로 안내하고 throw 하지 않음
async function linkMeetProductPicks(meetingId, picks) {
  if (!meetingId) return { unit_linked: 0, set_linked: 0 };
  var unitLinked = 0, setLinked = 0;
  try {
    if (picks.unit_ids && picks.unit_ids.length) {
      await API.post('/products/link-to-meeting', {
        meeting_id: meetingId,
        product_unit_ids: picks.unit_ids,
        action: picks.action,
        is_loan: picks.is_loan ? 1 : 0
      });
      unitLinked = picks.unit_ids.length;
    }
    if (picks.set_ids && picks.set_ids.length) {
      var r = await API.post('/products/link-sets-to-meeting', {
        meeting_id: meetingId,
        set_ids: picks.set_ids,
        action: picks.action,
        is_loan: picks.is_loan ? 1 : 0
      });
      setLinked = picks.set_ids.length;
      // 세트 동행 시 총 동행된 유닛 수도 알려주기
      try {
        var totalUnits = (r && r.data && r.data.data && r.data.data.total_linked_units) || 0;
        if (setLinked && totalUnits) {
          toast('세트 ' + setLinked + '개 (유닛 ' + totalUnits + '개) 동행 연계됨');
        }
      } catch (e) {}
    }
    if (unitLinked) toast('제품 ' + unitLinked + '개 연계됨');
  } catch (e) {
    toast('제품 연계 실패: ' + ((e && e.response && e.response.data && e.response.data.error) || e.message || '오류'));
  }
  return { unit_linked: unitLinked, set_linked: setLinked };
}

async function loadMeetProductPicker(existingMeetingId) {
  var listEl = document.getElementById('meet-products-list');
  if (!listEl) return;
  try {
    // 가용 유닛 + 가용 세트 병렬 로드
    var avail = [];
    var sets = [];
    try { avail = (await API.get('/products/available-for-meeting')).data.data || []; } catch (e) { avail = []; }
    try { sets = (await API.get('/products/available-sets-for-meeting')).data.data || []; } catch (e) { sets = []; }
    // 기존 연계 (수정 모드)
    var linkedIds = {};
    if (existingMeetingId) {
      try {
        var lr = (await API.get('/products/by-meeting/' + existingMeetingId)).data.data || [];
        lr.forEach(function(x) { linkedIds[x.product_unit_id] = x; });
      } catch (e) {}
    }
    if (!avail.length && !sets.length && !Object.keys(linkedIds).length) {
      listEl.innerHTML = '<div class="text-xs text-slate-400 text-center py-2">등록된 제품 유닛이 없습니다. <a href="javascript:closeModal();nav(\'products\')" class="text-brand-500 underline">제품 관리</a>에서 먼저 입고하세요.</div>';
      return;
    }
    // 카테고리별 그룹화 (유닛)
    var grouped = {};
    avail.forEach(function(u) {
      var key = u.category + '|' + u.model;
      if (!grouped[key]) grouped[key] = { category: u.category, model: u.model, product_name: u.product_name, units: [] };
      grouped[key].units.push(u);
    });
    var catLabel = { internal: '내부기', external: '외부기', carry_case: '휴대보관함' };
    var catColor = { internal: '#dbeafe;color:#1e40af', external: '#dcfce7;color:#166534', carry_case: '#fef3c7;color:#92400e' };
    var setStatusLabel = { in_stock: '재고', at_hospital: '기관 보관', out: '반출', mixed: '혼합' };
    var setStatusColor = { in_stock: '#dcfce7;color:#166534', at_hospital: '#fee2e2;color:#991b1b', out: '#fef3c7;color:#92400e', mixed: '#e0e7ff;color:#3730a3' };
    var html = '';
    // 액션 + 대여여부 선택 (세트/유닛 공통)
    html += '<div class="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-gray-100">' +
      '<label class="text-[11px] text-slate-500">처리 유형:</label>' +
      '<select name="meet_product_action" class="input !py-1 !text-xs !w-auto">' +
        '<option value="demo">시연 (회수)</option>' +
        '<option value="checkout">반출 (대여)</option>' +
        '<option value="deliver">납품 (영구 전달)</option>' +
      '</select>' +
      '<label class="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer ml-2">' +
        '<input type="checkbox" name="meet_product_is_loan" class="w-3.5 h-3.5"> 대여 여부 표시' +
      '</label>' +
      '</div>';

    // ===== 세트 섹션 =====
    if (sets.length) {
      html += '<div class="mb-2.5 pb-2 border-b border-gray-100">' +
        '<div class="flex items-center gap-1.5 mb-1.5">' +
          '<i class="fas fa-layer-group text-[11px] text-indigo-500"></i>' +
          '<span class="text-[11px] font-bold text-slate-700">세트 단위 동행</span>' +
          '<span class="text-[10px] text-slate-400">(선택 시 구성 유닛 전체가 함께 동행)</span>' +
        '</div>' +
        '<div class="space-y-1">';
      sets.forEach(function(s) {
        var unitCount = Number(s.unit_count || 0);
        if (!unitCount) return; // 빈 세트 제외
        var cats = String(s.categories || '').split(',').filter(Boolean);
        var catBadges = cats.map(function(cc){
          return '<span class="text-[9px] font-bold px-1 py-0.5 rounded" style="background:' + (catColor[cc] || '#e5e7eb;color:#374151') + '">' + (catLabel[cc] || cc) + '</span>';
        }).join(' ');
        var isMine = Number(s.my_holder_count || 0) > 0;
        var bgCls = isMine ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200';
        var stColor = setStatusColor[s.status] || '#e5e7eb;color:#374151';
        var stLabel = setStatusLabel[s.status] || s.status;
        var compTitle = s.composition ? ' title="구성: ' + String(s.composition).replace(/"/g,'&quot;') + '"' : '';
        html += '<label class="flex items-start gap-2 p-2 rounded-lg border ' + bgCls + ' cursor-pointer hover:bg-indigo-50 transition"' + compTitle + '>' +
          '<input type="checkbox" name="meet_product_set" value="' + s.id + '" class="w-3.5 h-3.5 mt-0.5">' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-1.5 flex-wrap">' +
              '<span class="text-[12px] font-semibold text-slate-800">' + escapeHtml(s.name || ('세트 #' + s.id)) + '</span>' +
              '<span class="text-[9px] font-bold px-1 py-0.5 rounded" style="background:' + stColor + '">' + stLabel + '</span>' +
              catBadges +
              '<span class="text-[10px] text-slate-400">' + unitCount + '개 유닛</span>' +
              (isMine ? '<i class="fas fa-user text-[8px] text-emerald-500" title="내가 보유한 유닛 포함"></i>' : '') +
            '</div>' +
            (s.description ? '<div class="text-[10px] text-slate-400 mt-0.5 truncate">' + escapeHtml(s.description) + '</div>' : '') +
          '</div>' +
        '</label>';
      });
      html += '</div></div>';
    }

    // ===== 개별 유닛 섹션 =====
    if (Object.keys(grouped).length) {
      html += '<div class="flex items-center gap-1.5 mb-1.5">' +
        '<i class="fas fa-cube text-[11px] text-slate-500"></i>' +
        '<span class="text-[11px] font-bold text-slate-700">개별 유닛</span>' +
      '</div>';
    }
    // 그룹별 유닛 체크박스
    Object.keys(grouped).sort().forEach(function(k) {
      var g = grouped[k];
      html += '<div class="mb-1.5">' +
        '<div class="flex items-center gap-1.5 mb-1">' +
          '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="background:' + (catColor[g.category] || '#e5e7eb;color:#374151') + '">' + (catLabel[g.category] || g.category) + '</span>' +
          '<span class="text-[11px] font-medium text-slate-600">' + (g.product_name || g.model) + '</span>' +
          '<span class="text-[10px] text-slate-400">(' + g.units.length + ')</span>' +
        '</div>' +
        '<div class="flex flex-wrap gap-1 pl-1">';
      g.units.forEach(function(u) {
        var label = u.asset_code || u.serial_no || ('#' + u.id);
        var isMine = u.is_mine ? ' bg-emerald-50 border-emerald-300' : ' bg-white border-gray-200';
        var holderHint = u.holders ? ' title="보유: ' + u.holders + '"' : '';
        var alreadyLinked = !!linkedIds[u.id];
        html += '<label class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] cursor-pointer hover:bg-brand-50 transition' + isMine + '"' + holderHint + '>' +
          '<input type="checkbox" name="meet_product_unit" value="' + u.id + '" class="w-3 h-3"' + (alreadyLinked ? ' checked disabled' : '') + '>' +
          '<span>' + label + '</span>' +
          (u.is_mine ? '<i class="fas fa-user text-[8px] text-emerald-500" title="내 보유"></i>' : '') +
          (alreadyLinked ? '<i class="fas fa-link text-[8px] text-blue-500" title="이미 연계"></i>' : '') +
          '</label>';
      });
      html += '</div></div>';
    });
    if (Object.keys(linkedIds).length && !avail.length) {
      html += '<div class="text-[11px] text-slate-400 mt-1">이미 연계된 유닛: ' + Object.values(linkedIds).map(function(x){return x.asset_code || x.serial_no || ('#'+x.product_unit_id);}).join(', ') + '</div>';
    }
    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = '<div class="text-xs text-red-400 text-center py-2">제품 목록 로딩 실패</div>';
  }
}
