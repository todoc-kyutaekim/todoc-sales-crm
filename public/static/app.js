// ===== TODOC CRM - Frontend Application =====
const API = axios.create({ baseURL: '/api' });
let curPage = '', hospList = [], docList = [], confirmCb = null, searchTimer = null;
let currentUser = null;
let _reminderCount = 0;
let _dashPeriod = 'month';
let _searchHistory = JSON.parse(localStorage.getItem('todoc_search_history') || '[]');
let _favorites = new Set();
let _offlineMode = !navigator.onLine;

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
  renderLoginForm();
}
function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-main').classList.remove('hidden');
  var bn = document.getElementById('bottom-nav');
  if (bn) bn.classList.add('show');
  updateUserUI();
  loadFavorites();
  nav('dashboard');
}
function updateUserUI() {
  const el = document.getElementById('user-menu');
  if (el && currentUser) {
    el.innerHTML = '<div class="flex items-center gap-2 cursor-pointer group" onclick="toggleUserDropdown()">' +
      '<div class="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 font-bold text-sm">' + (currentUser.name || '?').charAt(0) + '</div>' +
      '<span class="text-[12px] font-semibold text-slate-600 hidden lg:inline group-hover:text-brand-600 transition">' + currentUser.name + '</span>' +
      '<i class="fas fa-chevron-down text-[9px] text-slate-300 hidden lg:inline"></i></div>' +
      '<div id="user-dropdown" class="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-100 z-50 hidden py-1">' +
      '<div class="px-4 py-3 border-b border-gray-50"><div class="text-[13px] font-bold text-slate-800">' + currentUser.name + '</div><div class="text-[11px] text-slate-400">' + currentUser.email + '</div></div>' +
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
    '<div class="w-16 h-16 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-brand-500/30">' +
    '<svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm-2 13H8V9h2v7zm4 0h-2V9h2v7z" fill="#fff"/></svg></div>' +
    '<h1 class="text-2xl font-extrabold text-slate-800 tracking-tight">TODOC CRM</h1>' +
    '<p class="text-sm text-slate-400 mt-1">병원 영업 관리 시스템</p></div>' +
    '<form id="auth-form" class="space-y-4">' +
    '<div><label class="input-label">이메일</label><div class="relative"><i class="fas fa-envelope absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="email" type="email" class="input pl-10 w-full" placeholder="name@to-doc.com" autocomplete="email"></div></div>' +
    '<div><label class="input-label">비밀번호</label><div class="relative"><i class="fas fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input name="password" type="password" class="input pl-10 w-full" placeholder="비밀번호" autocomplete="current-password"></div></div>' +
    '<div class="flex items-center justify-between"><label class="flex items-center gap-2 cursor-pointer select-none"><input name="rememberMe" type="checkbox" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer" checked><span class="text-[13px] text-slate-500">자동 로그인</span></label></div>' +
    '<button type="submit" class="btn btn-primary w-full !py-3 text-sm font-bold">로그인</button></form>' +
    '<div class="mt-6 text-center"><span class="text-sm text-slate-400">계정이 없으신가요? </span><button onclick="renderRegisterForm()" class="text-sm text-brand-600 font-bold hover:text-brand-700 transition">회원가입</button></div>';
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
function showConfirm(title, msg, cb) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  confirmCb = cb; document.getElementById('confirm-dialog').classList.remove('hidden');
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
  document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
  document.getElementById('n-' + p)?.classList.add('active');
  // Update bottom nav
  document.querySelectorAll('.btm-nav-item').forEach(e => e.classList.remove('active'));
  var bnItem = document.getElementById('bn-' + p);
  if (bnItem) bnItem.classList.add('active');
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
  ({ dashboard: loadDash, hospitals: loadHosp, doctors: loadDoc, meetings: loadMeet, cistats: loadCIStats, activity: loadActivity })[p]?.();
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

function openModal(t, h, wide) {
  document.getElementById('modal-title').textContent = t;
  document.getElementById('modal-body').innerHTML = h;
  const mc = document.getElementById('modal-content');
  mc.className = 'modal-box bg-white rounded-t-2xl lg:rounded-2xl shadow-2xl w-full overflow-y-auto ' + (wide === true || wide === 'wide' ? 'max-w-2xl' : wide === 'narrow' ? 'max-w-md' : 'max-w-lg');
  var mdl = document.getElementById('modal');
  mdl.classList.remove('hidden');
  mdl.style.display = 'flex';
}
function closeModal() { var mdl = document.getElementById('modal'); mdl.classList.add('hidden'); mdl.style.display = ''; }
function tryCloseModal() {
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

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    var modalEl = document.getElementById('modal');
    if (modalEl && !modalEl.classList.contains('hidden')) { tryCloseModal(); }
    confirmNo(); hideSearchResults();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); toggleMobileSearch(true); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    if (curPage === 'hospitals') showHospForm();
    else if (curPage === 'meetings') showNewMeetGlobal();
  }
});

// ===== Mobile Search Toggle =====
function toggleMobileSearch(forceOpen) {
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
  const total = (d.hospitals?.length || 0) + (d.doctors?.length || 0) + (d.meetings?.length || 0) + (d.papers?.length || 0);
  if (total === 0) { el.innerHTML = '<div class="p-6 text-center text-sm text-slate-400">검색 결과가 없습니다</div>'; el.classList.remove('hidden'); return; }

  if (d.hospitals?.length) {
    html += '<div class="search-cat"><i class="fas fa-hospital mr-1"></i>기관</div>';
    d.hospitals.forEach(h => { html += '<div class="search-item" onclick="hideSearchResults();viewHosp(' + h.id + ')"><div class="si-icon bg-blue-50 text-blue-500"><i class="fas fa-hospital"></i></div><div><div class="font-semibold text-slate-700">' + h.name + '</div><div class="text-[11px] text-slate-400">' + (h.region || '') + ' · ' + (h.grade || '-') + '급</div></div></div>'; });
  }
  if (d.doctors?.length) {
    html += '<div class="search-cat"><i class="fas fa-user-doctor mr-1"></i>의료진</div>';
    d.doctors.forEach(dc => { html += '<div class="search-item" onclick="hideSearchResults();viewDocProfile(' + dc.id + ')"><div class="si-icon bg-purple-50 text-purple-500"><i class="fas fa-user-doctor"></i></div><div><div class="font-semibold text-slate-700">' + dc.name + ' <span class="text-slate-400 font-normal text-xs">' + (dc.position || '') + '</span></div><div class="text-[11px] text-slate-400">' + (dc.hospital_name || '') + ' · ' + (dc.department || '') + '</div></div></div>'; });
  }
  if (d.meetings?.length) {
    html += '<div class="search-cat"><i class="fas fa-calendar-check mr-1"></i>미팅</div>';
    d.meetings.forEach(m => { html += '<div class="search-item" onclick="hideSearchResults();viewHosp(' + m.hospital_id + ')"><div class="si-icon bg-emerald-50 text-emerald-500"><i class="fas fa-calendar-check"></i></div><div><div class="font-semibold text-slate-700">' + (m.purpose || '미팅') + '</div><div class="text-[11px] text-slate-400">' + (m.doctor_name || '') + ' · ' + fmtShort(m.meeting_date) + '</div></div></div>'; });
  }
  if (d.papers?.length) {
    html += '<div class="search-cat"><i class="fas fa-file-lines mr-1"></i>논문</div>';
    d.papers.forEach(p => { html += '<div class="search-item" onclick="hideSearchResults();viewDocProfile(' + p.doctor_id + ')"><div class="si-icon bg-amber-50 text-amber-500"><i class="fas fa-file-lines"></i></div><div><div class="font-semibold text-slate-700 line-clamp-1">' + p.title + '</div><div class="text-[11px] text-slate-400">' + (p.doctor_name || '') + (p.year ? ' · ' + p.year : '') + '</div></div></div>'; });
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
}
function showSearchResults() { if (document.getElementById('global-search')?.value) onGlobalSearch(document.getElementById('global-search').value); else showSearchHistory(); }
function hideSearchResults() { document.getElementById('search-results')?.classList.add('hidden'); }
document.addEventListener('click', e => { if (!document.getElementById('search-wrap')?.contains(e.target) && !document.getElementById('mobile-search-btn')?.contains(e.target)) { hideSearchResults(); } });

// ===== Helpers =====
function fmtDate(d) { if (!d) return '-'; return new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) }
function fmtShort(d) { if (!d) return '-'; return new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) }
function fmtMonthLabel(m) { if (!m) return ''; const [y, mo] = m.split('-'); return parseInt(mo) + '월' }
function daysAgo(d) { if (!d) return ''; const diff = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000); if (diff === 0) return '오늘'; if (diff < 0) return Math.abs(diff) + '일 후'; return diff + '일 전' }
function daysUntil(d) { if (!d) return Infinity; return Math.floor((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000) }
function daysClass(d) { if (!d) return ''; const diff = Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000); if (diff > 30) return 'text-red-500'; if (diff > 14) return 'text-amber-500'; return 'text-slate-400' }
function gradeBadge(g) { return '<span class="badge grade-' + g + '">' + g + '급</span>' }
function statusDot(s) { return s === 'active' ? '<span class="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>활성</span>' : '<span class="inline-flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold"><span class="w-2 h-2 rounded-full bg-slate-300"></span>비활성</span>' }
function infBadge(l) { return { high: '<span class="inf-high"><i class="fas fa-fire text-[9px]"></i> 핵심</span>', medium: '<span class="inf-medium"><i class="fas fa-star text-[9px]"></i> 주요</span>', low: '<span class="inf-low">일반</span>' }[l] || l }
function mtBadge(t) { const m = { visit: ['방문', 'mt-visit', 'fa-building'], phone: ['전화', 'mt-phone', 'fa-phone'], conference: ['학회', 'mt-conference', 'fa-users'], email: ['이메일', 'mt-email', 'fa-envelope'], online: ['온라인', 'mt-online', 'fa-video'] }; const v = m[t] || ['기타', 'mt-visit', 'fa-circle']; return '<span class="mt ' + v[1] + '"><i class="fas ' + v[2] + ' text-[9px]"></i>' + v[0] + '</span>' }
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
function downloadCSV(type) { window.open('/api/export/' + type, '_blank'); }
function downloadXLSX(type) { window.open('/api/export/xlsx/' + type, '_blank'); }

// ===== DASHBOARD =====
let dashCharts = [];
function destroyDashCharts() { dashCharts.forEach(c => { try { c.destroy() } catch(e) {} }); dashCharts = []; }

async function loadDash() {
  destroyDashCharts();
  document.getElementById('page-title').textContent = '대시보드';
  document.getElementById('page-subtitle').textContent = '';
  document.getElementById('header-actions').innerHTML = 
    '<select id="dash-period" class="input !py-1.5 !text-xs !w-auto !pr-7 !rounded-lg" onchange="_dashPeriod=this.value;loadDash()" style="max-width:110px"><option value="month"' + (_dashPeriod==='month'?' selected':'') + '>이번 달</option><option value="quarter"' + (_dashPeriod==='quarter'?' selected':'') + '>이번 분기</option><option value="year"' + (_dashPeriod==='year'?' selected':'') + '>올해</option></select>' +
    '<button class="btn btn-outline btn-sm" onclick="showPipelineView()"><i class="fas fa-columns text-xs"></i><span class="hidden sm:inline">파이프라인</span></button>' +
    '<button class="btn btn-success btn-sm" onclick="showNewMeetGlobal()"><i class="fas fa-calendar-plus text-xs"></i><span class="hidden sm:inline">빠른 미팅</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 space-y-6"><div class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">' + Array(4).fill('<div class="sc"><div class="flex gap-4"><div class="skeleton rounded-xl" style="width:44px;height:44px"></div><div class="flex-1 space-y-2"><div class="skeleton rounded h-3 w-16"></div><div class="skeleton rounded h-6 w-20"></div></div></div></div>').join('') + '</div></div>';
  try {
    const { data: d } = await API.get('/dashboard?period=' + _dashPeriod); const s = d.data;
    // Update reminder badge
    updateReminderBadge(s.reminderCount || s.reminders?.length || 0);
    const C = document.getElementById('content');
    // Month comparison
    const monthDiff = s.stats.lastMonthMeetings > 0 ? ((s.stats.monthMeetings - s.stats.lastMonthMeetings) / s.stats.lastMonthMeetings * 100).toFixed(0) : (s.stats.monthMeetings > 0 ? '+100' : '0');
    const monthDiffText = monthDiff > 0 ? '<span class="text-emerald-500 text-[10px] font-bold">+' + monthDiff + '% ↑</span>' : (monthDiff < 0 ? '<span class="text-red-500 text-[10px] font-bold">' + monthDiff + '% ↓</span>' : '<span class="text-slate-400 text-[10px]">변동없음</span>');
    
    C.innerHTML = '<div class="p-4 lg:p-7 fade-in space-y-6">' +
      // Reminder banner
      (s.reminders?.length ? '<div class="reminder-banner"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0"><i class="fas fa-bell text-white text-lg animate-bounce-gentle"></i></div><div class="flex-1"><div class="font-bold text-white text-sm mb-0.5">미팅 리마인더</div><div class="text-white/80 text-xs">앞으로 7일 이내 예정된 미팅이 <strong>' + s.reminders.length + '건</strong> 있습니다</div></div></div>' +
        '<div class="mt-3 space-y-2">' + s.reminders.map(r => {
          const du = daysUntil(r.next_meeting_date);
          const urgency = du <= 1 ? 'bg-red-500/30 border-red-400/50' : du <= 3 ? 'bg-amber-500/20 border-amber-400/40' : 'bg-white/10 border-white/20';
          return '<div class="flex items-center gap-3 px-3 py-2 rounded-lg border ' + urgency + ' cursor-pointer" onclick="viewHosp(' + r.hospital_id + ')">' +
            '<div class="text-white/90 text-sm flex-1"><span class="font-semibold">' + meetDoctorNames(r) + '</span>' + (r.doctors && r.doctors.length > 1 ? '<span class="text-[10px] text-white/50 ml-1">(' + r.doctors.length + '명)</span>' : '') + ' <span class="text-white/60">· ' + (r.hospital_name || '') + '</span></div>' +
            '<div class="text-right"><div class="text-white font-bold text-sm">' + fmtShort(r.next_meeting_date) + '</div><div class="text-white/70 text-[10px]">' + (du === 0 ? '오늘!' : du === 1 ? '내일' : du + '일 후') + '</div></div></div>'
        }).join('') + '</div></div>' : '') +
      // Stats cards
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">' +
      sc('관리 기관', s.stats.hospitals, '개', 'fa-hospital', '#3366ff', '#eef4ff', 'hospitals') +
      sc('등록 의료진', s.stats.doctors, '명', 'fa-user-doctor', '#7c3aed', '#f5f3ff', 'doctors') +
      sc('총 미팅', s.stats.meetings, '건', 'fa-handshake', '#059669', '#ecfdf5', 'meetings') +
      sc('이번 달', s.stats.monthMeetings, '건', 'fa-calendar-day', '#d97706', '#fffbeb', 'meetings') +
      '</div>' +
      // KPI gauge (if target set)
      (s.kpiTarget && s.kpiTarget.target_meetings > 0 ? '<div class="card-flat p-4 lg:p-5"><div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center"><i class="fas fa-bullseye text-brand-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">KPI 달성률</span></div><button class="btn btn-ghost btn-sm text-xs" onclick="showKPISettings()"><i class="fas fa-cog text-xs"></i> 설정</button></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-4">' + kpiGaugeCard('미팅', s.stats.monthMeetings, s.kpiTarget.target_meetings, 'fa-handshake', '#3366ff') + '</div></div>' :
        '<div class="card-flat p-4 flex items-center justify-between"><div class="flex items-center gap-2 text-sm text-slate-400"><i class="fas fa-bullseye text-slate-300"></i>KPI 목표가 설정되지 않았습니다</div><button class="btn btn-outline btn-sm" onclick="showKPISettings()"><i class="fas fa-plus text-xs mr-1"></i>설정</button></div>') +
      // CI KPI banner
      (s.ciKpi ? '<div class="card-flat p-5 flex flex-wrap items-center gap-4 lg:gap-8"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><i class="fas fa-chart-line text-indigo-500"></i></div><div><div class="text-[11px] text-slate-400 font-medium">인공와우 시장 현황 (' + s.ciKpi.year + '년)</div><div class="text-sm font-bold text-slate-800">환자 ' + fmtNum(s.ciKpi.patients) + '명</div></div></div><div class="flex gap-6 text-center"><div><div class="text-[10px] text-slate-400">시술건수</div><div class="text-sm font-bold text-brand-600">' + fmtNum(s.ciKpi.usage) + '</div></div><div><div class="text-[10px] text-slate-400">진료금액</div><div class="text-sm font-bold text-emerald-600">' + fmtAmount(s.ciKpi.amount) + '</div></div><div><div class="text-[10px] text-slate-400">환자 증가율</div><div class="text-sm font-bold ' + (parseFloat(s.ciKpi.growth_patients) > 0 ? 'text-emerald-600' : 'text-red-500') + '">' + (parseFloat(s.ciKpi.growth_patients) > 0 ? '+' : '') + s.ciKpi.growth_patients + '%</div></div></div><button class="btn btn-outline btn-sm ml-auto" onclick="nav(\'cistats\')">통계 상세 <i class="fas fa-arrow-right text-[10px]"></i></button></div>' : '') +
      // Monthly trend chart + right column
      '<div class="grid grid-cols-1 lg:grid-cols-5 gap-6">' +
      '<div class="lg:col-span-3 space-y-6">' +
      // Monthly trend chart
      (s.monthlyTrend?.length ? '<div class="card-flat p-4 lg:p-6"><div class="flex items-center justify-between mb-5"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center"><i class="fas fa-chart-bar text-indigo-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">월별 미팅 추이</span></div><span class="text-[11px] text-slate-300">최근 6개월</span></div><div style="height:200px"><canvas id="chart-monthly"></canvas></div></div>' : '') +
      // Recent meetings
      '<div class="card-flat p-0 overflow-hidden">' +
      '<div class="px-4 lg:px-6 py-4 flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-clock text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">최근 미팅</span></div><span class="text-[11px] text-slate-300 font-medium">최근 8건</span></div>' +
      '<div class="border-t border-gray-50">' + (s.recentMeetings.length ? s.recentMeetings.map(m =>
        '<div class="px-4 lg:px-6 py-3.5 tr flex items-center gap-3 lg:gap-4 cursor-pointer border-b border-gray-50 last:border-0" onclick="viewHosp(' + m.hospital_id + ')">' +
        '<div class="hidden sm:block">' + meetDoctorAvatars(m, 'width:36px;height:36px;border-radius:10px;font-size:14px') + '</div>' +
        '<div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-0.5"><span class="font-semibold text-[13px] text-slate-800">' + meetDoctorNames(m) + '</span>' + mtBadge(m.meeting_type) + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div><div class="text-xs text-slate-400 truncate">' + m.hospital_name + (m.purpose ? ' &middot; ' + m.purpose : '') + '</div></div>' +
        '<div class="text-right flex-shrink-0"><div class="text-xs font-medium text-slate-500">' + fmtShort(m.meeting_date) + '</div><div class="text-[10px] ' + daysClass(m.meeting_date) + '">' + daysAgo(m.meeting_date) + '</div></div></div>'
      ).join('') : '<div class="empty"><div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div><p class="text-sm">아직 미팅 기록이 없습니다</p></div>') + '</div></div>' +
      '</div>' +
      '<div class="lg:col-span-2 space-y-6">' +
      // Upcoming actions
      '<div class="card-flat p-0 overflow-hidden">' +
      '<div class="px-4 lg:px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><i class="fas fa-list-check text-amber-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">후속 액션</span></div>' +
      '<div class="border-t border-gray-50">' + (s.upcomingActions.length ? s.upcomingActions.map(m =>
        '<div class="px-4 lg:px-6 py-3 tr border-b border-gray-50 last:border-0"><div class="flex items-center justify-between mb-1"><span class="text-[13px] font-semibold text-slate-700">' + m.doctor_name + '</span>' + (m.next_meeting_date ? '<span class="text-[10px] font-bold ' + daysClass(m.next_meeting_date) + ' bg-gray-50 px-2.5 py-1 rounded-full">' + fmtShort(m.next_meeting_date) + '</span>' : '') + '</div><p class="text-xs text-slate-400 leading-relaxed"><i class="fas fa-arrow-right text-amber-300 mr-1.5"></i>' + m.next_action + '</p></div>'
      ).join('') : '<div class="empty py-10"><div class="empty-icon"><i class="fas fa-check-circle"></i></div><p class="text-sm">완료할 액션이 없습니다</p></div>') + '</div></div>' +
      // Region stats
      '<div class="card-flat p-0 overflow-hidden">' +
      '<div class="px-4 lg:px-6 py-4 flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-map-location-dot text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">지역별 현황</span></div>' +
      '<div class="border-t border-gray-50 p-4 lg:p-5 space-y-3">' + (s.regionStats.length ? s.regionStats.map(r => { const mx = Math.max(...s.regionStats.map(x => x.count)); return '<div class="flex items-center gap-3"><span class="text-xs font-semibold text-slate-500 w-10 text-right">' + r.region + '</span><div class="flex-1 bg-gray-100 rounded-full h-[22px] overflow-hidden"><div class="bg-gradient-to-r from-brand-400 to-brand-500 h-full rounded-full flex items-center px-3 transition-all duration-500" style="width:' + Math.max(r.count / mx * 100, 20) + '%"><span class="text-[10px] font-bold text-white">' + r.count + '개</span></div></div></div>' }).join('') : '<div class="text-center text-sm text-slate-300 py-4">데이터 없음</div>') + '</div></div>' +
      '</div></div></div>';
    
    // Render monthly trend chart
    if (s.monthlyTrend?.length) {
      setTimeout(() => {
        const el = document.getElementById('chart-monthly');
        if (!el) return;
        Chart.defaults.font.family = 'Pretendard,sans-serif'; Chart.defaults.font.size = 11;
        dashCharts.push(new Chart(el, {
          type: 'bar',
          data: {
            labels: s.monthlyTrend.map(m => fmtMonthLabel(m.month)),
            datasets: [
              { label: '방문', data: s.monthlyTrend.map(m => m.visit_count || 0), backgroundColor: 'rgba(51,102,255,0.7)', borderRadius: 4, barPercentage: 0.5 },
              { label: '전화', data: s.monthlyTrend.map(m => m.phone_count || 0), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, barPercentage: 0.5 },
              { label: '학회', data: s.monthlyTrend.map(m => m.conf_count || 0), backgroundColor: 'rgba(124,58,237,0.7)', borderRadius: 4, barPercentage: 0.5 },
              { label: '이메일', data: s.monthlyTrend.map(m => m.email_count || 0), backgroundColor: 'rgba(217,119,6,0.7)', borderRadius: 4, barPercentage: 0.5 },
              { label: '온라인', data: s.monthlyTrend.map(m => m.online_count || 0), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 4, barPercentage: 0.5 },
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 8, padding: 10, font: { size: 10 } } } },
            scales: { y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { stepSize: 1 } }, x: { stacked: true, grid: { display: false } } }
          }
        }));
      }, 150);
    }
  } catch (e) { document.getElementById('content').innerHTML = '<div class="p-7"><div class="card-flat p-8 text-center text-red-400"><i class="fas fa-exclamation-triangle text-2xl mb-2 block"></i>데이터를 불러올 수 없습니다</div></div>' }
}
function sc(label, val, unit, icon, color, bg, link) {
  return '<div class="sc cursor-pointer" onclick="' + (link ? "nav('" + link + "')" : '') + '"><div class="flex items-center gap-4"><div class="sc-icon" style="background:' + bg + '"><i class="fas ' + icon + '" style="color:' + color + '"></i></div><div><p class="text-[11px] text-slate-400 font-medium mb-0.5">' + label + '</p><div class="flex items-baseline gap-1"><span class="text-[22px] font-extrabold text-slate-800 tracking-tight">' + val + '</span><span class="text-xs text-slate-300 font-medium">' + unit + '</span></div></div></div></div>';
}

// ===== KPI Gauge =====
function kpiGaugeCard(label, actual, target, icon, color) {
  var pct = target > 0 ? Math.min(Math.round(actual / target * 100), 100) : 0;
  var barColor = pct >= 100 ? '#059669' : pct >= 70 ? '#3366ff' : pct >= 40 ? '#d97706' : '#ef4444';
  return '<div class="flex items-center gap-3"><div class="flex-1"><div class="flex items-center justify-between mb-1"><span class="text-xs font-semibold text-slate-600"><i class="fas ' + icon + ' mr-1" style="color:' + color + '"></i>' + label + '</span><span class="text-xs font-bold" style="color:' + barColor + '">' + pct + '%</span></div><div class="w-full bg-gray-100 rounded-full h-2.5"><div class="h-2.5 rounded-full transition-all duration-500" style="width:' + pct + '%;background:' + barColor + '"></div></div><div class="text-[10px] text-slate-400 mt-0.5">' + actual + ' / ' + target + ' ' + (label === '미팅' ? '건' : '개') + '</div></div></div>';
}

// ===== KPI Settings Modal =====
async function showKPISettings() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  openModal('KPI 목표 설정',
    '<form id="fm" class="space-y-4">' +
    '<div class="grid grid-cols-2 gap-4"><div><label class="input-label">연도</label><input type="number" name="year" value="' + y + '" class="input"></div><div><label class="input-label">월</label><input type="number" name="month" value="' + m + '" class="input" min="1" max="12"></div></div>' +
    '<div><label class="input-label">월간 미팅 목표 (건)</label><input type="number" name="target_meetings" value="0" class="input" min="0"></div>' +
    '<div class="flex justify-end gap-2 pt-3 border-t border-gray-50"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">저장</button></div></form>');
  // Load existing target
  try {
    var r = await API.get('/pipeline/kpi-targets?year=' + y + '&month=' + m);
    var t = r.data.data.target;
    if (t) { document.querySelector('#fm input[name="target_meetings"]').value = t.target_meetings || 0; }
  } catch(e) {}
  document.getElementById('fm').onsubmit = async function(e) {
    e.preventDefault();
    var f = Object.fromEntries(new FormData(e.target));
    try {
      await API.post('/pipeline/kpi-targets', f);
      toast('KPI 목표가 저장되었습니다'); closeModal(); loadDash();
    } catch(e) { toast('저장 실패', 'err'); }
  };
}

// ===== Pipeline View =====
async function showPipelineView() {
  openModal('영업 파이프라인', '<div class="text-center py-6"><i class="fas fa-spinner fa-spin text-xl text-slate-300"></i></div>', 'wide');
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
          '<div class="flex items-center gap-2 mb-1">' + gradeBadge(h.grade) + '<span class="text-[12px] font-bold text-slate-700 truncate">' + h.name + '</span></div>' +
          '<div class="flex items-center justify-between text-[10px] text-slate-400"><span>' + (h.region || '') + '</span><span>' + (h.meeting_count || 0) + '회</span></div></div>';
      });
      if (!s.hospitals.length) html += '<div class="text-center py-6 text-[11px] text-slate-300 border border-dashed border-gray-200 rounded-xl">비어 있음</div>';
      html += '</div></div>';
    });
    html += '</div></div>';
    html += '<div class="text-[10px] text-slate-400 mt-2"><i class="fas fa-info-circle mr-1"></i>기관 상세에서 파이프라인 단계를 변경할 수 있습니다</div>';
    document.getElementById('modal-body').innerHTML = html;
  } catch(e) { document.getElementById('modal-body').innerHTML = '<div class="text-center text-red-400 py-4">파이프라인 데이터를 불러올 수 없습니다</div>'; }
}

// ===== HOSPITALS =====
var _hospViewMode = localStorage.getItem('todoc_hosp_view') || 'card';
async function loadHosp(typeFilter) {
  document.getElementById('page-title').textContent = '기관 관리';
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-outline btn-sm hide-mobile" onclick="downloadXLSX(\'hospitals\')"><i class="fas fa-file-excel text-xs"></i>Excel</button><button class="btn btn-outline btn-sm hide-mobile" onclick="downloadCSV(\'hospitals\')"><i class="fas fa-download text-xs"></i>CSV</button><button class="btn btn-primary" onclick="showHospForm()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">추가</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">' + Array(6).fill('<div class="card p-5"><div class="space-y-3"><div class="skeleton rounded h-5 w-32"></div><div class="skeleton rounded h-3 w-48"></div></div></div>').join('') + '</div></div>';
  try {
    const [hR, rR] = await Promise.all([API.get('/hospitals'), API.get('/regions')]);
    hospList = hR.data.data; const regions = rR.data.data;
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' +
      '<div class="relative flex-1 filter-search"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="h-search" oninput="filterH()" placeholder="기관명 검색" class="input pl-10"></div>' +
      '<select id="h-type" onchange="filterH()" class="input filter-select"><option value="">전체 유형</option><option value="hospital">병원</option><option value="clinic">의원</option></select>' +
      '<select id="h-region" onchange="filterH()" class="input filter-select"><option value="">전체 지역</option>' + regions.map(r => '<option>' + r + '</option>').join('') + '</select>' +
      '<select id="h-grade" onchange="filterH()" class="input filter-select"><option value="">전체 등급</option><option value="S">S급</option><option value="A">A급</option><option value="B">B급</option><option value="C">C급</option></select>' +
      '<label class="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0"><input type="checkbox" id="h-fav-only" onchange="filterH()" class="w-3.5 h-3.5 rounded border-gray-300 text-amber-500"><span class="text-[11px] text-slate-500"><i class="fas fa-star text-amber-400"></i></span></label>' +
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
    return '<div class="card accent-' + h.grade + ' p-5 cursor-pointer" onclick="viewHosp(' + h.id + ')">' +
      '<div class="flex items-center gap-2 mb-3">' +
      gradeBadge(h.grade) + priorityStars(h.priority) + todocBadge(h.todoc_contact) +
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
      '<div class="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-extrabold flex-shrink-0 ' +
        (h.grade === 'S' ? 'bg-amber-100 text-amber-700' : h.grade === 'A' ? 'bg-blue-100 text-blue-700' : h.grade === 'B' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500') + '">' + (h.grade || '-') + '</div>' +
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
    '<th class="px-3 py-2.5 text-[10px] font-bold text-slate-500">등급</th>' +
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
        '<td class="px-3 py-2.5">' + gradeBadge(h.grade) + '</td>' +
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
    if (!regionGrades[r]) regionGrades[r] = { S: 0, A: 0, B: 0, C: 0, total: 0, ci: 0, meetings: 0, names: [] };
    regionGrades[r][h.grade || 'C']++;
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
      (rg.S ? '<span class="text-amber-600 font-bold">S:' + rg.S + '</span>' : '') +
      (rg.A ? '<span class="text-blue-600 font-bold">A:' + rg.A + '</span>' : '') +
      (rg.B ? '<span class="text-emerald-600">B:' + rg.B + '</span>' : '') +
      (rg.C ? '<span class="text-gray-400">C:' + rg.C + '</span>' : '') +
      '<span class="ml-auto"><i class="fas fa-handshake mr-0.5"></i>' + rg.meetings + '</span>' +
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
  const s = (document.getElementById('h-search')?.value || '').toLowerCase(), r = document.getElementById('h-region')?.value || '', g = document.getElementById('h-grade')?.value || '', t = document.getElementById('h-type')?.value || '';
  const favOnly = document.getElementById('h-fav-only')?.checked || false;
  renderH(hospList.filter(h => (!s || h.name.toLowerCase().includes(s)) && (!r || h.region === r) && (!g || h.grade === g) && (!t || h.type === t) && (!favOnly || isFavorited('hospital', h.id))));
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
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">우선순위</div><div class="mt-1">' + priorityStars(h.priority) + '</div></div>' +
    '<div class="sc !p-3"><div class="text-[10px] text-slate-400 mb-0.5">토닥접점</div><div class="mt-1">' + todocBadge(h.todoc_contact) + '</div></div>' +
    '</div>' +
    // Info card
    '<div class="card-flat p-4 lg:p-6">' +
    '<div class="flex flex-wrap items-center gap-2 mb-4">' + gradeBadge(h.grade) + statusDot(h.status) + '<div class="ml-auto flex items-center gap-4 text-xs text-slate-400">' + (h.phone ? '<span><i class="fas fa-phone mr-1"></i>' + h.phone + '</span>' : '') + '</div></div>' +
    '<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">' +
    '<div><span class="text-slate-400 text-xs font-medium">지역</span><p class="font-semibold text-slate-700 mt-0.5">' + (h.region || '-') + '</p></div>' +
    '<div><span class="text-slate-400 text-xs font-medium">주소</span><p class="font-semibold text-slate-700 mt-0.5">' + (h.address || '-') + '</p></div>' +
    '</div>' +
    (h.notes ? '<div class="mt-5 bg-amber-50/70 rounded-xl p-4 text-[13px] text-amber-800 leading-relaxed"><i class="fas fa-lightbulb text-amber-400 mr-1.5"></i>' + h.notes + '</div>' : '') +
    '</div>' +
    '<div class="flex border-b border-gray-100 px-1 overflow-x-auto">' +
    '<div class="tab ' + (detailTab === 'doctors' ? 'active' : '') + '" onclick="detailTab=\'doctors\';renderDetail()"><i class="fas fa-user-doctor text-xs"></i>인원 (' + docs.length + ')</div>' +
    '<div class="tab ' + (detailTab === 'meetings' ? 'active' : '') + '" onclick="detailTab=\'meetings\';renderDetail()"><i class="fas fa-calendar-check text-xs"></i>미팅 (' + meets.length + ')</div>' +
    '</div>' +
    (detailTab === 'doctors' ? renderDoctorsTab(h, docs) : renderMeetingsTab(h, meets)) +
    '</div>';
}
function renderDoctorsTab(h, docs) {
  var noProfileDocs = docs.filter(function(d) { return !d.bio && !d.education && !d.career; });
  var aiBtn = '<div class="mb-4 flex flex-wrap justify-end gap-2">' +
    (noProfileDocs.length > 0 ? '<button class="btn btn-outline btn-sm !border-blue-200 !text-blue-600 hover:!bg-blue-50" onclick="refreshAllProfiles(' + h.id + ')"><i class="fas fa-rotate mr-1.5 text-xs"></i>AI 프로필 일괄 조회 (' + noProfileDocs.length + '명)</button>' : '') +
    '<button class="btn btn-outline btn-sm !border-violet-200 !text-violet-600 hover:!bg-violet-50" onclick="fetchAIDoctors(' + h.id + ')"><i class="fas fa-wand-magic-sparkles mr-1.5 text-xs"></i>AI 의료진 자동 조회</button></div>';
  if (!docs.length) return '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-user-plus"></i></div><p class="font-medium text-slate-500 mb-1">소속 의료진이 없습니다</p><p class="text-xs text-slate-400 mb-4">관련 의료진을 AI로 자동 추가해보세요</p><button class="btn btn-outline btn-sm !border-violet-200 !text-violet-600 hover:!bg-violet-50" onclick="fetchAIDoctors(' + h.id + ')"><i class="fas fa-wand-magic-sparkles mr-1.5 text-xs"></i>AI 의료진 자동 조회</button><div id="ai-doc-status" class="mt-3"></div></div></div>';
  return '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">' + docs.map(d =>
    '<div class="card-flat p-4 lg:p-5 flex gap-3 lg:gap-4 cursor-pointer" onclick="viewDocProfile(' + d.id + ')">' +
    '<div class="photo-up" onclick="event.stopPropagation();triggerPhoto(' + d.id + ',' + h.id + ')">' +
    avatar(d.photo, d.name, 'width:52px;height:52px;border-radius:14px;font-size:18px') +
    '<div class="photo-ov" style="border-radius:14px"><i class="fas fa-camera"></i></div></div>' +
    '<input type="file" id="pi-' + d.id + '" accept="image/*" style="display:none" onchange="uploadPhoto(' + d.id + ',' + h.id + ',this)">' +
    '<div class="flex-1 min-w-0">' +
    '<div class="flex items-center gap-2 mb-1"><span class="font-bold text-[14px] text-slate-800">' + d.name + '</span><span class="text-xs text-slate-400">' + (d.position || '') + '</span>' + infBadge(d.influence_level) + '</div>' +
    '<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mb-2">' + (d.department ? '<span><i class="fas fa-stethoscope mr-1 text-slate-300"></i>' + d.department + '</span>' : '') + (d.specialty ? '<span class="hidden sm:inline"><i class="fas fa-microscope mr-1 text-slate-300"></i>' + d.specialty + '</span>' : '') + '</div>' +
    '<div class="flex items-center gap-3 text-[11px]"><span class="text-slate-400"><i class="fas fa-handshake mr-1"></i>' + (d.meeting_count || 0) + '회</span>' + (d.last_meeting ? '<span class="' + daysClass(d.last_meeting) + '"><i class="fas fa-clock mr-1"></i>' + daysAgo(d.last_meeting) + '</span>' : '') + (d.clinic_hours ? '<span class="text-cyan-500"><i class="fas fa-calendar-days mr-1"></i>외래</span>' : '') + '</div></div>' +
    '<div class="flex flex-col gap-1 flex-shrink-0">' +
    '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();showMeetForm(' + h.id + ',' + d.id + ')" title="미팅 추가"><i class="fas fa-calendar-plus text-emerald-500"></i></button>' +
    '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();showDocForm(' + h.id + ',' + d.id + ')" title="수정"><i class="fas fa-pen text-slate-400"></i></button>' +
    '<button class="btn btn-ghost text-xs px-2 py-1.5" onclick="event.stopPropagation();delDoc(' + d.id + ',' + h.id + ')" title="삭제"><i class="fas fa-trash text-red-300"></i></button>' +
    '</div></div>'
  ).join('') + '</div>' + aiBtn + '<div id="ai-doc-status"></div>';
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
  if (!meets.length) return '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-calendar-plus"></i></div><p class="font-medium text-slate-500 mb-1">미팅 기록이 없습니다</p></div></div>';
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
        return '<div class="bg-gray-50 rounded-xl p-3">' +
          '<div class="flex items-center gap-2 mb-2"><span class="text-[12px] font-bold text-slate-700">' + d.name + '</span>' +
          '<span class="text-[10px] text-slate-400">' + (d.position || '') + '</span>' +
          (d.specialty ? '<span class="text-[9px] text-cyan-500">' + d.specialty.split(',')[0] + '</span>' : '') + '</div>' +
          '<div class="grid grid-cols-7 gap-1">' +
          '<div></div>' + DAYS_KR.map(function(dk, i) { return '<div class="text-[9px] font-bold text-center ' + (i===5?'text-blue-500':'text-slate-500') + '">' + dk + '</div>'; }).join('') +
          '<div class="text-[8px] text-amber-500 font-bold text-center flex items-center justify-center">AM</div>' +
          DAYS_KEY.map(function(k) { var v = ch[k+'_am']||''; return '<div class="text-center"><div class="rounded text-[9px] font-bold py-0.5 px-0.5 ' + (v ? slotBg(v) : 'text-slate-200') + '">' + (v||'-') + '</div></div>'; }).join('') +
          '<div class="text-[8px] text-indigo-500 font-bold text-center flex items-center justify-center">PM</div>' +
          DAYS_KEY.map(function(k) { var v = ch[k+'_pm']||''; return '<div class="text-center"><div class="rounded text-[9px] font-bold py-0.5 px-0.5 ' + (v ? slotBg(v) : 'text-slate-200') + '">' + (v||'-') + '</div></div>'; }).join('') +
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
      '<div class="flex items-center gap-2">' + mtBadge(m.meeting_type) + '<span class="font-semibold text-[13px] text-slate-800">' + meetDoctorNames(m) + '</span>' + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div>' +
      '<div class="flex items-center gap-2"><span class="text-xs text-slate-400">' + fmtDate(m.meeting_date) + ' <span class="text-[10px] text-slate-300">(' + DAYS_KR[dayIdx >= 0 && dayIdx < 6 ? dayIdx : 0] + ')</span></span><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="showMeetForm(' + h.id + ',null,' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="delMeet(' + m.id + ',' + h.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div></div>' +
      schedHtml +
      (m.purpose ? '<div class="text-[13px] font-medium text-slate-700 mb-1.5 mt-1">' + m.purpose + '</div>' : '') +
      (m.content ? '<div class="text-xs text-slate-500 leading-relaxed mb-2 bg-slate-50 rounded-lg p-3">' + m.content + '</div>' : '') +
      '<div class="flex flex-wrap gap-2">' +
      (m.result ? '<div class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-check-circle mr-1.5"></i><strong>결과:</strong> ' + m.result + '</div>' : '') +
      (m.next_action ? '<div class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-arrow-right mr-1.5"></i><strong>후속:</strong> ' + m.next_action + (m.next_meeting_date ? ' <span class="font-bold">(' + fmtShort(m.next_meeting_date) + ')</span>' : '') + '</div>' : '') +
      '</div></div></div>';
  }).join('') + '</div>';
}

// ===== AI Doctors Auto-Fetch =====
async function fetchAIDoctors(hid) {
  var h = window._hospDetail?.h;
  if (!h) return;
  var statusEl = document.getElementById('ai-doc-status');
  if (!statusEl) return;
  statusEl.innerHTML = '<div class="card-flat p-5 text-center"><i class="fas fa-spinner fa-spin text-violet-500 text-lg mb-2"></i><p class="text-sm font-medium text-slate-600">AI가 ' + h.name + ' 관련 의료진을 조회 중입니다...</p><p class="text-xs text-slate-400 mt-1">웹사이트 크롤링 + 뉴스 검색으로 정확한 데이터를 수집합니다</p><div class="mt-3 w-full bg-gray-100 rounded-full h-1.5"><div id="ai-progress-bar" class="bg-violet-500 h-1.5 rounded-full transition-all duration-1000" style="width:10%"></div></div><p class="text-[10px] text-slate-400 mt-2" id="ai-progress-text">병원 웹사이트 크롤링 중...</p></div>';
  // Animate progress bar
  var progressSteps = [
    { pct: 20, text: '병원 웹사이트 데이터 수집 중...', delay: 3000 },
    { pct: 35, text: '검색 엔진에서 보충 데이터 확인 중...', delay: 8000 },
    { pct: 50, text: 'AI 분석 시작...', delay: 15000 },
    { pct: 65, text: '의료진별 전문분야 확인 중...', delay: 25000 },
    { pct: 78, text: '난청/인공와우 관련 의료진 분류 중...', delay: 40000 },
    { pct: 88, text: '결과 정리 중... 거의 완료!', delay: 55000 },
  ];
  var progressTimers = progressSteps.map(function(s) {
    return setTimeout(function() {
      var bar = document.getElementById('ai-progress-bar');
      var txt = document.getElementById('ai-progress-text');
      if (bar) bar.style.width = s.pct + '%';
      if (txt) txt.textContent = s.text;
    }, s.delay);
  });
  try {
    var res = await API.post('/ai/hospital-doctors', { hospitalName: h.name, region: h.region, type: h.type || '' }, { timeout: 120000 });
    progressTimers.forEach(function(t) { clearTimeout(t); });
    var doctors = res.data.data || [];
    var source = res.data.source || '';
    var crawled = res.data.crawled || false;
    if (!doctors.length) {
      statusEl.innerHTML = '<div class="card-flat p-5 text-center"><i class="fas fa-info-circle text-slate-400 text-lg mb-2"></i><p class="text-sm text-slate-500">해당 기관의 관련 의료진 정보를 찾지 못했습니다.</p><p class="text-xs text-slate-400 mt-1">수동으로 의료진을 추가해주세요.</p>' +
        (res.data.message ? '<p class="text-xs text-slate-300 mt-2">' + res.data.message + '</p>' : '') + '</div>';
      return;
    }
    // Show preview list with checkboxes + source info
    var existingNames = (window._hospDetail?.docs || []).map(function(d) { return d.name; });
    var isAIFallback = source && source.includes('AI 학습 데이터');
    var sourceHtml = source ?
      '<div class="mb-3 px-3 py-2 rounded-lg ' + 
        (isAIFallback ? 'bg-amber-50 border border-amber-200' : 
         crawled ? 'bg-emerald-50 border border-emerald-100' : 'bg-blue-50 border border-blue-100') + '">' +
      '<div class="flex items-center gap-2 text-xs ' + 
        (isAIFallback ? 'text-amber-700' : crawled ? 'text-emerald-700' : 'text-blue-700') + '">' +
      '<i class="fas ' + (isAIFallback ? 'fa-robot' : crawled ? 'fa-globe' : 'fa-search') + '"></i>' +
      '<span class="font-semibold">' + 
        (isAIFallback ? 'AI 학습 데이터 기반 (확인 필요)' : 
         crawled ? '병원 웹사이트에서 직접 수집' : '웹 검색 기반 조회') + '</span></div>' +
      (isAIFallback ? '<div class="text-[10px] text-amber-500 mt-0.5"><i class="fas fa-exclamation-triangle mr-1"></i>병원 웹사이트 크롤링 실패로 AI 추론 결과입니다. 반드시 사실 확인이 필요합니다.</div>' :
       source ? '<div class="text-[10px] text-slate-400 mt-0.5 truncate"><i class="fas fa-link mr-1"></i>' + source + '</div>' : '') +
      '</div>' : '';

    statusEl.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-2 mb-3"><i class="fas fa-wand-magic-sparkles text-violet-500"></i><span class="font-bold text-sm text-slate-700">AI 조회 결과 (' + doctors.length + '명)</span></div>' +
      sourceHtml +
      '<div class="space-y-2 mb-4">' + doctors.map(function(d, i) {
        var exists = existingNames.includes(d.name);
        return '<label class="flex items-center gap-3 p-3 rounded-xl border ' + (exists ? 'border-gray-100 bg-gray-50 opacity-50' : 'border-gray-200 hover:border-violet-200 hover:bg-violet-50/30 cursor-pointer') + ' transition">' +
          '<input type="checkbox" class="ai-doc-chk w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500" data-idx="' + i + '"' + (exists ? ' disabled' : ' checked') + '>' +
          '<div class="flex-1 min-w-0">' +
          '<div class="flex items-center gap-2"><span class="font-semibold text-[13px] text-slate-800">' + d.name + '</span><span class="text-xs text-slate-400">' + (d.position || '') + '</span>' +
          infBadge(d.influence_level) +
          (exists ? '<span class="text-[10px] text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full font-medium">이미 등록됨</span>' : '') + '</div>' +
          '<div class="text-xs text-slate-400 mt-0.5"><i class="fas fa-microscope mr-1 text-slate-300"></i>' + (d.specialty || '전문분야 미상') + '</div>' +
          (d.notes ? '<div class="text-[10px] text-violet-500 mt-0.5 bg-violet-50 rounded px-1.5 py-0.5 inline-block"><i class="fas fa-newspaper mr-1"></i>' + d.notes + '</div>' : '') +
          '<div class="text-[10px] text-slate-300 mt-0.5">' + (d.department || '이비인후과') + '</div>' +
          '</div></label>';
      }).join('') + '</div>' +
      '<div class="flex items-center justify-between"><span class="text-[10px] text-slate-400"><i class="fas fa-info-circle mr-1"></i>실제 병원 데이터 기반이나, 반드시 확인 후 사용하세요</span>' +
      '<div class="flex gap-2"><button class="btn btn-outline btn-sm" onclick="document.getElementById(\'ai-doc-status\').innerHTML=\'\'">닫기</button>' +
      '<button class="btn btn-sm !bg-violet-600 !text-white hover:!bg-violet-700" onclick="addAIDoctors(' + hid + ')"><i class="fas fa-user-plus mr-1"></i>선택 의료진 추가</button></div></div></div>';
    window._aiDoctorsList = doctors;
  } catch(e) {
    progressTimers.forEach(function(t) { clearTimeout(t); });
    statusEl.innerHTML = '<div class="card-flat p-5 text-center"><i class="fas fa-exclamation-circle text-red-400 text-lg mb-2"></i><p class="text-sm text-red-500">AI 조회에 실패했습니다.</p><p class="text-xs text-slate-400 mt-1">잠시 후 다시 시도해주세요.</p></div>';
  }
}

async function addAIDoctors(hid) {
  var doctors = window._aiDoctorsList || [];
  var checkboxes = document.querySelectorAll('.ai-doc-chk:checked:not(:disabled)');
  if (!checkboxes.length) { toast('추가할 의료진을 선택해주세요', 'warn'); return; }
  var selected = Array.from(checkboxes).map(function(cb) { return doctors[parseInt(cb.dataset.idx)]; });
  var statusEl = document.getElementById('ai-doc-status');
  var added = 0;
  var addedDoctors = []; // track created doctor IDs and names for paper fetch
  for (var i = 0; i < selected.length; i++) {
    var d = selected[i];
    try {
      var res = await API.post('/doctors', { hospital_id: hid, name: d.name, department: d.department || '이비인후과', position: d.position || '', specialty: d.specialty || '', influence_level: d.influence_level || 'medium', notes: (d.notes ? 'AI: ' + d.notes : 'AI 자동 추가'), bio: '', education: '', career: '' });
      added++;
      if (res.data && res.data.data && res.data.data.id) {
        addedDoctors.push({ id: res.data.data.id, name: d.name, hospitalName: window._hospDetail?.h?.name || '' });
      }
    } catch(e) {}
  }
  toast(added + '명의 의료진이 추가되었습니다.');
  window._aiDoctorsList = null;

  // Auto-fetch profile + PubMed papers for each added doctor in background
  if (addedDoctors.length > 0 && statusEl) {
    statusEl.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-3"><i class="fas fa-spinner fa-spin text-violet-500"></i><div><div class="text-sm font-semibold text-slate-700">의료진 프로필 + 논문 자동 수집 중... (<span id="paper-progress">0</span>/' + addedDoctors.length + '명)</div><div class="text-xs text-slate-400 mt-0.5">각 의료진의 약력·학력·논문을 자동으로 가져옵니다</div></div></div><div id="paper-doctor-status" class="mt-3 space-y-1"></div></div>';
    var paperCount = 0;
    var profileCount = 0;
    var doctorsDone = 0;
    for (var j = 0; j < addedDoctors.length; j++) {
      var dr = addedDoctors[j];
      var dStatusEl = document.getElementById('paper-doctor-status');
      if (dStatusEl) dStatusEl.innerHTML += '<div id="paper-dr-' + dr.id + '" class="text-xs text-slate-400"><i class="fas fa-spinner fa-spin text-violet-400 mr-1"></i>' + dr.name + ' 프로필 조회 중...</div>';
      
      // Step 1: Fetch profile (bio, education, career)
      try {
        var profRes = await API.post('/ai/doctor-profile', { doctorName: dr.name, hospitalName: dr.hospitalName, department: '이비인후과' }, { timeout: 60000 });
        var prof = profRes.data && profRes.data.data;
        if (prof && (prof.bio || prof.education || prof.career)) {
          var profileUpdate = {};
          if (prof.bio) profileUpdate.bio = prof.bio;
          if (prof.education) profileUpdate.education = prof.education.replace(/\\n/g, '\n');
          if (prof.career) profileUpdate.career = prof.career.replace(/\\n/g, '\n');
          if (prof.position) profileUpdate.position = prof.position;
          if (prof.specialty) profileUpdate.specialty = prof.specialty;
          await API.patch('/doctors/' + dr.id + '/profile', profileUpdate);
          profileCount++;
          var drEl0 = document.getElementById('paper-dr-' + dr.id);
          if (drEl0) drEl0.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-400 mr-1"></i>' + dr.name + ' 프로필 완료, 논문 검색 중...';
        } else {
          var drEl0b = document.getElementById('paper-dr-' + dr.id);
          if (drEl0b) drEl0b.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-400 mr-1"></i>' + dr.name + ' 논문 검색 중...';
        }
      } catch(ep) {
        var drEl0c = document.getElementById('paper-dr-' + dr.id);
        if (drEl0c) drEl0c.innerHTML = '<i class="fas fa-spinner fa-spin text-blue-400 mr-1"></i>' + dr.name + ' 논문 검색 중...';
      }
      
      // Step 2: Fetch PubMed papers
      try {
        var papersRes = await API.post('/ai/doctor-papers', { doctorName: dr.name, hospitalName: dr.hospitalName, specialty: '' }, { timeout: 60000 });
        var papers = (papersRes.data && papersRes.data.data) || [];
        var addedPapers = 0;
        for (var k = 0; k < Math.min(papers.length, 10); k++) {
          var p = papers[k];
          try {
            await API.post('/doctors/' + dr.id + '/papers', {
              title: p.title, journal: p.journal || '', year: p.year || null,
              authors: p.authors || '', doi: p.doi || '', paper_type: 'journal',
              url: p.url || '', abstract: ''
            });
            addedPapers++;
          } catch(e2) {}
        }
        paperCount += addedPapers;
        var drEl = document.getElementById('paper-dr-' + dr.id);
        if (drEl) drEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500 mr-1"></i>' + dr.name + ' — 프로필 + ' + addedPapers + '편 논문';
      } catch(e3) {
        var drEl2 = document.getElementById('paper-dr-' + dr.id);
        if (drEl2) drEl2.innerHTML = '<i class="fas fa-minus-circle text-slate-300 mr-1"></i>' + dr.name + ' — 논문 검색 실패';
      }
      doctorsDone++;
      var progEl = document.getElementById('paper-progress');
      if (progEl) progEl.textContent = doctorsDone;
    }
    if (statusEl) statusEl.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-3"><i class="fas fa-check-circle text-emerald-500"></i><div><div class="text-sm font-semibold text-slate-700">' + added + '명 의료진 추가 완료</div><div class="text-xs text-slate-400 mt-0.5">' + profileCount + '명 프로필 수집 · ' + paperCount + '편 논문 등록</div></div></div></div>';
    setTimeout(function() { viewHosp(hid); }, 2000);
  } else {
    viewHosp(hid);
  }
}

// ===== AI PROFILE BATCH REFRESH =====
async function refreshAllProfiles(hid) {
  var statusEl = document.getElementById('ai-doc-status');
  if (!statusEl) return;
  try {
    var hospRes = await API.get('/hospitals/' + hid + '/doctors');
    var allDocs = (hospRes.data && hospRes.data.data) || [];
    var docs = allDocs.filter(function(d) { return !d.bio && !d.education && !d.career; });
    if (!docs.length) { toast('프로필이 없는 의료진이 없습니다', 'warn'); return; }
    var hospData = window._hospDetail?.h;
    var hospitalName = hospData ? hospData.name : '';
    statusEl.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-3"><i class="fas fa-spinner fa-spin text-blue-500"></i><div><div class="text-sm font-semibold text-slate-700">AI 프로필 일괄 조회 중... (<span id="profile-batch-progress">0</span>/' + docs.length + '명)</div><div class="text-xs text-slate-400 mt-0.5">각 의료진의 학력·경력·소개를 자동으로 가져옵니다</div></div></div><div id="profile-batch-status" class="mt-3 space-y-1"></div></div>';
    var profileCount = 0;
    for (var i = 0; i < docs.length; i++) {
      var dr = docs[i];
      var bStatusEl = document.getElementById('profile-batch-status');
      if (bStatusEl) bStatusEl.innerHTML += '<div id="pb-dr-' + dr.id + '" class="text-xs text-slate-400"><i class="fas fa-spinner fa-spin text-blue-400 mr-1"></i>' + dr.name + ' 프로필 조회 중...</div>';
      try {
        var profRes = await API.post('/ai/doctor-profile', { doctorName: dr.name, hospitalName: hospitalName, department: dr.department || '이비인후과' }, { timeout: 60000 });
        var prof = profRes.data && profRes.data.data;
        if (prof && (prof.bio || prof.education || prof.career)) {
          var profileUpdate = {};
          if (prof.bio) profileUpdate.bio = prof.bio;
          if (prof.education) profileUpdate.education = prof.education.replace(/\\n/g, '\n');
          if (prof.career) profileUpdate.career = prof.career.replace(/\\n/g, '\n');
          if (prof.position) profileUpdate.position = prof.position;
          if (prof.specialty) profileUpdate.specialty = prof.specialty;
          await API.patch('/doctors/' + dr.id + '/profile', profileUpdate);
          profileCount++;
          var drEl = document.getElementById('pb-dr-' + dr.id);
          if (drEl) { var filled = []; if (prof.bio) filled.push('소개'); if (prof.education) filled.push('학력'); if (prof.career) filled.push('경력'); drEl.innerHTML = '<i class="fas fa-check-circle text-emerald-500 mr-1"></i>' + dr.name + ' — ' + filled.join(', '); }
        } else {
          var drEl2 = document.getElementById('pb-dr-' + dr.id);
          if (drEl2) drEl2.innerHTML = '<i class="fas fa-minus-circle text-slate-300 mr-1"></i>' + dr.name + ' — 프로필 정보 없음';
        }
      } catch(e) {
        var drEl3 = document.getElementById('pb-dr-' + dr.id);
        if (drEl3) drEl3.innerHTML = '<i class="fas fa-exclamation-circle text-red-400 mr-1"></i>' + dr.name + ' — 조회 실패';
      }
      var progEl = document.getElementById('profile-batch-progress');
      if (progEl) progEl.textContent = (i + 1);
    }
    statusEl.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-3"><i class="fas fa-check-circle text-emerald-500"></i><div><div class="text-sm font-semibold text-slate-700">프로필 일괄 조회 완료</div><div class="text-xs text-slate-400 mt-0.5">' + profileCount + '/' + docs.length + '명 프로필 수집 성공</div></div></div></div>';
    setTimeout(function() { viewHosp(hid); }, 2000);
  } catch(e) { toast('프로필 일괄 조회 실패', 'err'); }
}

async function refreshDocProfile(docId) {
  var d = window._docProfile;
  if (!d) return;
  var btn = event.target.closest('button');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>조회 중...'; }
  try {
    var profRes = await API.post('/ai/doctor-profile', { doctorName: d.name, hospitalName: d.hospital_name || '', department: d.department || '이비인후과' }, { timeout: 60000 });
    var prof = profRes.data && profRes.data.data;
    if (prof && (prof.bio || prof.education || prof.career)) {
      var profileUpdate = {};
      if (prof.bio) profileUpdate.bio = prof.bio;
      if (prof.education) profileUpdate.education = prof.education.replace(/\\n/g, '\n');
      if (prof.career) profileUpdate.career = prof.career.replace(/\\n/g, '\n');
      if (prof.position) profileUpdate.position = prof.position;
      if (prof.specialty) profileUpdate.specialty = prof.specialty;
      await API.patch('/doctors/' + docId + '/profile', profileUpdate);
      toast('프로필이 업데이트되었습니다');
      viewDocProfile(docId);
    } else {
      toast('프로필 정보를 찾을 수 없습니다', 'warn');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-1.5"></i>AI 프로필 조회'; }
    }
  } catch(e) {
    toast('프로필 조회 실패', 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-1.5"></i>AI 프로필 조회'; }
  }
}

// ===== DOCTORS PAGE =====
async function loadDoc() {
  document.getElementById('page-title').textContent = '의료진 관리';
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-outline btn-sm hide-mobile" onclick="downloadXLSX(\'doctors\')"><i class="fas fa-file-excel text-xs"></i>Excel</button><button class="btn btn-outline btn-sm hide-mobile" onclick="downloadCSV(\'doctors\')"><i class="fas fa-download text-xs"></i>CSV</button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="card-flat overflow-hidden">' + skeleton(6) + '</div></div>';
  try {
    const [dr, deptR] = await Promise.all([API.get('/doctors'), API.get('/doctors/departments')]);
    docList = dr.data.data;
    const depts = deptR.data.data || [];
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' +
      '<div class="relative flex-1 filter-search"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="d-search" oninput="filterD()" placeholder="의료진명/병원명" class="input pl-10"></div>' +
      '<select id="d-inf" onchange="filterD()" class="input filter-select"><option value="">전체</option><option value="high">핵심</option><option value="medium">주요</option><option value="low">일반</option></select>' +
      '<select id="d-dept" onchange="filterD()" class="input filter-select"><option value="">전체 진료과</option>' + depts.map(dp => '<option>' + dp + '</option>').join('') + '</select>' +
      '<select id="d-visit" onchange="filterD()" class="input filter-select"><option value="">전체 방문</option><option value="30">30일+ 미방문</option><option value="60">60일+ 미방문</option><option value="90">90일+ 미방문</option></select>' +
      '<label class="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0"><input type="checkbox" id="d-fav-only" onchange="filterD()" class="w-3.5 h-3.5 rounded border-gray-300 text-amber-500"><span class="text-[11px] text-slate-500"><i class="fas fa-star text-amber-400"></i></span></label>' +
      '<span id="d-count" class="text-xs text-slate-300 font-medium"></span></div>' +
      '<div class="card-flat overflow-hidden"><div class="table-wrap"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold uppercase tracking-wider border-b border-gray-100">' +
      '<th class="px-4 lg:px-6 py-3.5 text-left">의료진</th><th class="px-4 py-3.5 text-left">소속 병원</th><th class="px-4 py-3.5 text-left hide-mobile">진료과</th><th class="px-4 py-3.5 text-left hide-mobile">전문분야</th><th class="px-4 py-3.5 text-center">영향력</th><th class="px-4 py-3.5 text-center">미팅</th><th class="px-4 py-3.5 text-left">최근</th></tr></thead>' +
      '<tbody id="d-tbody" class="divide-y divide-gray-50"></tbody></table></div></div></div>';
    renderDR(docList);
  } catch (e) { toast('의료진 목록을 불러올 수 없습니다', 'err') }
}
function renderDR(list) {
  document.getElementById('d-count').textContent = list.length + '명';
  document.getElementById('d-tbody').innerHTML = list.map(d =>
    '<tr class="tr cursor-pointer" onclick="viewDocProfile(' + d.id + ')">' +
    '<td class="px-4 lg:px-6 py-3.5"><div class="flex items-center gap-3">' + avatar(d.photo, d.name) + '<div><div class="font-semibold text-[13px] text-slate-800">' + d.name + '</div><div class="text-[11px] text-slate-400">' + (d.position || '') + '</div></div></div></td>' +
    '<td class="px-4 py-3.5 text-[13px] text-slate-600">' + (d.hospital_name || '-') + '</td>' +
    '<td class="px-4 py-3.5 text-[13px] text-slate-500 hide-mobile">' + (d.department || '-') + '</td>' +
    '<td class="px-4 py-3.5 text-[13px] text-slate-500 hide-mobile">' + (d.specialty || '-') + '</td>' +
    '<td class="px-4 py-3.5 text-center">' + infBadge(d.influence_level) + '</td>' +
    '<td class="px-4 py-3.5 text-center text-[13px] font-bold text-slate-700">' + (d.meeting_count || 0) + '</td>' +
    '<td class="px-4 py-3.5"><div class="text-[13px] text-slate-600">' + (d.last_meeting ? fmtShort(d.last_meeting) : '-') + '</div>' + (d.last_meeting ? '<div class="text-[10px] ' + daysClass(d.last_meeting) + '">' + daysAgo(d.last_meeting) + '</div>' : '') + '</td></tr>'
  ).join('');
}
function filterD() {
  const q = (document.getElementById('d-search')?.value || '').toLowerCase();
  const inf = document.getElementById('d-inf')?.value || '';
  const dept = document.getElementById('d-dept')?.value || '';
  const vis = document.getElementById('d-visit')?.value || '';
  const favOnly = document.getElementById('d-fav-only')?.checked || false;
  renderDR(docList.filter(d => {
    if (q && !d.name.toLowerCase().includes(q) && !(d.hospital_name || '').toLowerCase().includes(q)) return false;
    if (inf && d.influence_level !== inf) return false;
    if (dept && d.department !== dept) return false;
    if (favOnly && !isFavorited('doctor', d.id)) return false;
    if (vis) {
      const days = parseInt(vis);
      if (d.last_meeting) { const diff = Math.floor((Date.now() - new Date(d.last_meeting + 'T00:00:00').getTime()) / 86400000); if (diff < days) return false; }
    }
    return true;
  }));
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
      ((!d.bio && !d.education && !d.career) ? '<button class="btn btn-sm !bg-violet-600 !text-white hover:!bg-violet-700" onclick="refreshDocProfile(' + d.id + ')"><i class="fas fa-wand-magic-sparkles text-xs mr-1"></i><span class="hidden sm:inline">AI 프로필</span></button>' : '') +
      '<button class="btn btn-outline btn-sm" onclick="showTagManager(\'doctor\',' + d.id + ')"><i class="fas fa-tags text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showMeetingStats(\'doctor\',' + d.id + ')"><i class="fas fa-chart-bar text-xs"></i></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showTransferForm(' + d.id + ')"><i class="fas fa-right-left text-xs"></i></button>' +
      '<button class="btn btn-success btn-sm" onclick="showMeetForm(' + d.hospital_id + ',' + d.id + ')"><i class="fas fa-calendar-plus text-xs"></i><span class="hidden sm:inline">미팅</span></button>' +
      '<button class="btn btn-primary btn-sm" onclick="showPaperForm(' + d.id + ')"><i class="fas fa-file-medical text-xs"></i><span class="hidden sm:inline">논문</span></button>' +
      '<button class="btn btn-outline btn-sm" onclick="showDocForm(' + d.hospital_id + ',' + d.id + ')"><i class="fas fa-pen text-xs"></i></button>';
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
    '<div class="flex flex-wrap items-center gap-2 lg:gap-3 mb-1"><h2 class="text-xl lg:text-2xl font-extrabold text-slate-800">' + d.name + '</h2><span class="text-sm lg:text-base text-slate-400 font-medium">' + (d.position || '') + '</span>' + infBadge(d.influence_level) + '</div>' +
    '<div class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-slate-500">' +
    (d.hospital_name ? '<span class="flex items-center gap-1.5"><i class="fas fa-hospital text-brand-400"></i><span class="font-semibold cursor-pointer hover:text-brand-600" onclick="viewHosp(' + d.hospital_id + ')">' + d.hospital_name + '</span>' + (d.hospital_grade ? ' <span class="badge grade-' + d.hospital_grade + '" style="font-size:9px;padding:1px 6px">' + d.hospital_grade + '급</span>' : '') + '</span>' : '') +
    (d.department ? '<span class="flex items-center gap-1.5"><i class="fas fa-stethoscope text-emerald-400"></i>' + d.department + '</span>' : '') +
    (d.specialty ? '<span class="flex items-center gap-1.5"><i class="fas fa-microscope text-purple-400"></i>' + d.specialty + '</span>' : '') +
    '</div></div>' +
    '<div class="flex gap-2 lg:gap-3 pt-2 sm:pt-14 flex-wrap profile-header-stats">' +
    profileStatBox('미팅', d.meeting_count || 0, '회', 'fa-handshake', '#3366ff', '#eef4ff') +
    profileStatBox('논문', d.papers?.length || 0, '편', 'fa-file-lines', '#7c3aed', '#f5f3ff') +
    profileStatBox('최근', d.last_meeting ? daysAgo(d.last_meeting) : '없음', '', 'fa-clock', '#059669', '#ecfdf5') +
    '</div></div></div></div>' +
    '<div class="flex flex-wrap gap-3 lg:gap-4">' +
    (d.phone ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-phone text-blue-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">전화번호</div><div class="text-sm font-semibold text-slate-700 truncate">' + d.phone + '</div></div></div>' : '') +
    (d.email ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-envelope text-purple-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">이메일</div><div class="text-sm font-semibold text-slate-700 truncate">' + d.email + '</div></div></div>' : '') +
    (d.hospital_region ? '<div class="flex-1 contact-card card-flat px-4 lg:px-5 py-3 flex items-center gap-3"><div class="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0"><i class="fas fa-map-marker-alt text-emerald-500 text-sm"></i></div><div class="min-w-0"><div class="text-[10px] text-slate-400 font-medium">근무지</div><div class="text-sm font-semibold text-slate-700 truncate">' + (d.hospital_address || d.hospital_region) + '</div></div></div>' : '') +
    '</div>' +
    '<div class="flex border-b border-gray-100 px-1 overflow-x-auto">' +
    '<div class="tab ' + (profileTab === 'overview' ? 'active' : '') + '" onclick="profileTab=\'overview\';renderDocProfile()"><i class="fas fa-user text-xs"></i>소개</div>' +
    '<div class="tab ' + (profileTab === 'meetings' ? 'active' : '') + '" onclick="profileTab=\'meetings\';renderDocProfile()"><i class="fas fa-calendar-check text-xs"></i>미팅 (' + (d.meetings?.length || 0) + ')</div>' +
    '<div class="tab ' + (profileTab === 'papers' ? 'active' : '') + '" onclick="profileTab=\'papers\';renderDocProfile()"><i class="fas fa-file-lines text-xs"></i>논문 (' + (d.papers?.length || 0) + ')</div>' +
    '</div>' +
    renderProfileTab(d) + '</div>';
}
function profileStatBox(label, val, unit, icon, color, bg) {
  return '<div class="bg-white rounded-xl border border-gray-100 px-4 lg:px-5 py-3 text-center min-w-[80px]"><div class="w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5" style="background:' + bg + '"><i class="fas ' + icon + ' text-xs" style="color:' + color + '"></i></div><div class="text-[15px] font-extrabold text-slate-800">' + val + '<span class="text-[11px] text-slate-400 font-medium ml-0.5">' + unit + '</span></div><div class="text-[10px] text-slate-400 font-medium">' + label + '</div></div>';
}
function renderProfileTab(d) {
  if (profileTab === 'overview') return renderProfileOverview(d);
  if (profileTab === 'meetings') return renderProfileMeetings(d);
  if (profileTab === 'papers') return renderProfilePapers(d);
  return '';
}
function renderProfileOverview(d) {
  let html = '<div class="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6">';
  html += '<div class="lg:col-span-3 space-y-5">';
  if (!d.bio && !d.education && !d.career) { html += '<div class="card-flat p-5 lg:p-6"><div class="empty"><div class="empty-icon"><i class="fas fa-user-graduate"></i></div><p class="font-medium text-slate-500 mb-1">학력/경력/소개 정보가 없습니다</p><p class="text-xs text-slate-400 mb-4">AI로 자동 조회하여 프로필을 채워보세요</p><button class="btn btn-sm !bg-violet-600 !text-white hover:!bg-violet-700" onclick="refreshDocProfile(' + d.id + ')"><i class="fas fa-wand-magic-sparkles mr-1.5 text-xs"></i>AI 프로필 자동 조회</button></div></div>'; }
  if (d.bio) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center"><i class="fas fa-user-tie text-brand-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">소개</span></div><p class="text-sm text-slate-600 leading-relaxed">' + d.bio + '</p></div>'; }
  if (d.education) { const eduLines = d.education.split('\n').filter(e => e.trim()); html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center"><i class="fas fa-graduation-cap text-amber-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">학력</span></div><div class="space-y-2.5">' + eduLines.map(e => '<div class="flex items-start gap-3"><div class="w-2 h-2 rounded-full bg-amber-300 mt-1.5 flex-shrink-0"></div><span class="text-sm text-slate-600">' + e + '</span></div>').join('') + '</div></div>'; }
  if (d.career) { const cl = d.career.split('\n').filter(c => c.trim()); html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-briefcase text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">경력</span></div><div class="relative pl-5"><div class="absolute left-[3px] top-1 bottom-1 w-0.5 bg-emerald-100"></div><div class="space-y-3">' + cl.map(c => '<div class="flex items-start gap-3 relative"><div class="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white shadow-sm flex-shrink-0 mt-1 -ml-[7px]"></div><span class="text-sm text-slate-600">' + c + '</span></div>').join('') + '</div></div></div>'; }
  if (d.notes) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><i class="fas fa-sticky-note text-violet-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">영업 메모</span></div><div class="bg-amber-50/70 rounded-xl p-4 text-[13px] text-amber-800 leading-relaxed"><i class="fas fa-lightbulb text-amber-400 mr-1.5"></i>' + d.notes + '</div></div>'; }
  html += renderClinicHours(d.clinic_hours);
  html += '</div><div class="lg:col-span-2 space-y-5">';
  html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center gap-2 mb-4"><div class="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><i class="fas fa-id-card text-blue-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">기본 정보</span></div><div class="space-y-3">' + infoRow('이름', d.name) + infoRow('직위', d.position) + infoRow('진료과', d.department) + infoRow('전문분야', d.specialty) + infoRow('소속 병원', d.hospital_name) + infoRow('지역', d.hospital_region) + '<div class="flex items-center justify-between py-1"><span class="text-[12px] text-slate-400">영향력</span><span>' + infBadge(d.influence_level) + '</span></div></div></div>';
  if (d.papers?.length) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center justify-between mb-4"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center"><i class="fas fa-file-lines text-purple-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">최근 논문</span></div><span class="text-[11px] text-brand-500 font-semibold cursor-pointer" onclick="profileTab=\'papers\';renderDocProfile()">전체 &rarr;</span></div>' + d.papers.slice(0, 3).map(p => '<div class="py-2.5 border-b border-gray-50 last:border-0">' + (p.url ? '<a href="' + p.url + '" target="_blank" rel="noopener noreferrer" class="text-[13px] font-semibold text-brand-600 hover:text-brand-800 leading-snug mb-1 line-clamp-2 block transition-colors"><i class="fas fa-link text-[10px] mr-1 text-brand-400"></i>' + p.title + '</a>' : '<div class="text-[13px] font-semibold text-slate-700 leading-snug mb-1 line-clamp-2">' + p.title + '</div>') + '<div class="text-[11px] text-slate-400">' + p.journal + (p.year ? ' &middot; ' + p.year : '') + '</div></div>').join('') + '</div>'; }
  if (d.meetings?.length) { html += '<div class="card-flat p-5 lg:p-6"><div class="flex items-center justify-between mb-4"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center"><i class="fas fa-calendar-check text-emerald-500 text-xs"></i></div><span class="font-bold text-sm text-slate-800">최근 미팅</span></div><span class="text-[11px] text-brand-500 font-semibold cursor-pointer" onclick="profileTab=\'meetings\';renderDocProfile()">전체 &rarr;</span></div>' + d.meetings.slice(0, 3).map(m => '<div class="py-2.5 border-b border-gray-50 last:border-0 flex items-center gap-3">' + mtBadge(m.meeting_type) + '<div class="flex-1 min-w-0"><div class="text-[13px] font-medium text-slate-700 truncate">' + (m.purpose || '미팅') + '</div><div class="text-[11px] text-slate-400">' + fmtShort(m.meeting_date) + '</div></div></div>').join('') + '</div>'; }
  html += '</div></div>';
  return html;
}
function renderProfileMeetings(d) {
  const meets = d.meetings || [];
  if (!meets.length) return '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-calendar-plus"></i></div><p class="font-medium text-slate-500 mb-1">미팅 기록이 없습니다</p></div></div>';
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
    '<div class="flex items-center gap-2">' + mtBadge(m.meeting_type) + '<span class="text-xs text-slate-400">' + (m.hospital_name || '') + '</span>' + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명 참석</span>' : '') + '</div>' +
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
function renderProfilePapers(d) {
  const papers = d.papers || [];
  // PubMed search button always visible
  let html = '<div class="flex items-center justify-between mb-5"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center"><i class="fas fa-file-lines text-purple-500 text-sm"></i></div><span class="font-bold text-slate-800">논문 목록</span></div>' +
    '<div class="flex gap-2"><button class="btn btn-outline btn-sm" onclick="searchPubMed(' + d.id + ')"><i class="fas fa-search text-xs mr-1"></i>PubMed 검색</button>' +
    '<button class="btn btn-primary btn-sm" onclick="showPaperForm(' + d.id + ')"><i class="fas fa-plus text-xs mr-1"></i>직접 추가</button></div></div>';
  // PubMed results container (hidden initially)
  html += '<div id="pubmed-results" style="display:none" class="mb-5"></div>';
  if (!papers.length) return html + '<div class="card-flat"><div class="empty"><div class="empty-icon"><i class="fas fa-file-circle-plus"></i></div><p class="font-medium text-slate-500 mb-1">등록된 논문이 없습니다</p><p class="text-sm text-slate-400">PubMed 검색으로 논문을 가져오거나 직접 추가하세요</p></div></div>';
  const jc = papers.filter(p => p.paper_type === 'journal').length;
  const cc = papers.filter(p => p.paper_type === 'conference').length;
  html += '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-5">' +
    '<div class="sc !p-3 lg:!p-4"><div class="text-[11px] text-slate-400 mb-1">전체</div><div class="text-[20px] font-extrabold text-slate-800">' + papers.length + '</div></div>' +
    '<div class="sc !p-3 lg:!p-4"><div class="text-[11px] text-slate-400 mb-1">학술지</div><div class="text-[20px] font-extrabold text-brand-600">' + jc + '</div></div>' +
    '<div class="sc !p-3 lg:!p-4"><div class="text-[11px] text-slate-400 mb-1">학회 발표</div><div class="text-[20px] font-extrabold text-purple-600">' + cc + '</div></div>' +
    '<div class="sc !p-3 lg:!p-4"><div class="text-[11px] text-slate-400 mb-1">기간</div><div class="text-[14px] font-bold text-slate-600 mt-1">' + (papers.length ? Math.min(...papers.map(p => p.year || 9999)) + '~' + Math.max(...papers.map(p => p.year || 0)) : '') + '</div></div></div>';
  html += '<div class="space-y-3">' + papers.map(p => {
    const isJ = p.paper_type === 'journal';
    return '<div class="card-flat p-4 lg:p-5 hover:shadow-md transition-shadow"><div class="flex gap-3 lg:gap-4">' +
      '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ' + (isJ ? 'bg-blue-50' : 'bg-purple-50') + '"><i class="fas ' + (isJ ? 'fa-file-lines text-blue-500' : 'fa-users text-purple-500') + ' text-sm"></i></div>' +
      '<div class="flex-1 min-w-0">' +
      '<div class="flex items-center gap-2 mb-1"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full ' + (isJ ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600') + '">' + (isJ ? 'Journal' : 'Conference') + '</span>' + (p.year ? '<span class="text-[11px] text-slate-400">' + p.year + '</span>' : '') + '</div>' +
      (p.url ? '<a href="' + p.url + '" target="_blank" rel="noopener noreferrer" class="text-[14px] font-bold text-brand-600 hover:text-brand-800 leading-snug mb-1.5 block transition-colors"><i class="fas fa-link text-[10px] mr-1 text-brand-400"></i>' + p.title + '</a>' : '<h4 class="text-[14px] font-bold text-slate-800 leading-snug mb-1.5">' + p.title + '</h4>') +
      (p.journal ? '<div class="text-[12px] text-slate-500 italic mb-1"><i class="fas fa-book text-slate-300 mr-1"></i>' + p.journal + '</div>' : '') +
      (p.authors ? '<div class="text-[12px] text-slate-400 mb-2"><i class="fas fa-users text-slate-300 mr-1"></i>' + p.authors + '</div>' : '') +
      (p.abstract ? '<div class="text-[12px] text-slate-500 leading-relaxed bg-gray-50 rounded-lg p-3 mt-2 line-clamp-3">' + p.abstract + '</div>' : '') +
      '<div class="flex items-center gap-3 mt-2 flex-wrap">' +
      (p.url ? '<a href="' + p.url + '" target="_blank" rel="noopener noreferrer" class="text-[11px] text-brand-500 hover:text-brand-700 font-semibold bg-brand-50 px-2.5 py-1 rounded-full transition-colors hover:bg-brand-100"><i class="fas fa-link mr-1"></i>논문 링크</a>' : '') +
      (p.doi ? '<a href="https://doi.org/' + p.doi + '" target="_blank" class="text-[11px] text-brand-500 hover:text-brand-700 font-semibold bg-blue-50 px-2.5 py-1 rounded-full transition-colors hover:bg-blue-100"><i class="fas fa-external-link-alt mr-1"></i>DOI</a>' : '') +
      '<div class="ml-auto flex gap-1"><button class="btn btn-ghost text-xs px-2 py-1" onclick="showPaperForm(' + d.id + ',' + p.id + ')"><i class="fas fa-pen text-slate-400 text-[10px]"></i></button><button class="btn btn-ghost text-xs px-2 py-1" onclick="delPaper(' + p.id + ',' + d.id + ')"><i class="fas fa-trash text-red-300 text-[10px]"></i></button></div></div></div></div></div>'
  }).join('') + '</div>';
  return html;
}

// ===== MEETINGS PAGE =====
async function loadMeet() {
  document.getElementById('page-title').textContent = '미팅 기록';
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-outline btn-sm hide-mobile" onclick="downloadCSV(\'meetings\')"><i class="fas fa-download text-xs"></i>CSV</button><button class="btn btn-success" onclick="showNewMeetGlobal()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">미팅 추가</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="card-flat p-0">' + skeleton(6) + '</div></div>';
  try {
    const [meetR, hospR] = await Promise.all([API.get('/meetings'), API.get('/hospitals')]);
    window._meetList = meetR.data.data;
    window._meetHosps = hospR.data.data;
    const C = document.getElementById('content');
    // Build hospital filter options
    const hospOpts = '<option value="">전체 병원</option>' + (hospR.data.data || []).map(h => '<option value="' + h.id + '">' + h.name + '</option>').join('');
    C.innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' +
      '<div class="relative flex-1 filter-search"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="m-search" oninput="filterM()" placeholder="의료진/병원/목적 검색" class="input pl-10"></div>' +
      '<select id="m-hospital" onchange="filterM()" class="input filter-select-lg">' + hospOpts + '</select>' +
      '<select id="m-type" onchange="filterM()" class="input filter-select"><option value="">전체 유형</option><option value="visit">방문</option><option value="phone">전화</option><option value="conference">학회</option><option value="email">이메일</option><option value="online">온라인</option></select>' +
      '<input id="m-from" type="date" onchange="filterM()" class="input hide-mobile filter-date" placeholder="시작일">' +
      '<input id="m-to" type="date" onchange="filterM()" class="input hide-mobile filter-date" placeholder="종료일">' +
      '<button class="btn btn-outline btn-sm" onclick="showCalendarView()"><i class="fas fa-calendar text-xs"></i><span class="hidden sm:inline">캘린더</span></button>' +
      '<span id="m-count" class="text-xs text-slate-300 font-medium"></span>' +
      '</div>' +
      '<div id="m-list" class="card-flat p-0 overflow-hidden"></div></div>';
    renderML(window._meetList);
  } catch (e) { toast('미팅 기록을 불러올 수 없습니다', 'err') }
}
function renderML(list) {
  document.getElementById('m-count').textContent = list.length + '건';
  document.getElementById('m-list').innerHTML = list.length ? list.map(m =>
    '<div class="px-4 lg:px-6 py-4 tr flex gap-3 lg:gap-4 border-b border-gray-50 last:border-0">' +
    '<div class="hidden sm:block">' + meetDoctorAvatars(m, 'width:36px;height:36px;border-radius:10px;font-size:13px') + '</div>' +
    '<div class="flex-1 min-w-0 cursor-pointer" onclick="viewMeetDoctors(' + m.id + ',' + JSON.stringify((m.doctors||[]).map(function(d){return d.doctor_id||d.id})).replace(/"/g, '&quot;') + ')">' +
    '<div class="flex items-center gap-2 mb-0.5"><span class="font-semibold text-[13px] text-slate-800">' + meetDoctorNames(m) + '</span><span class="text-xs text-slate-300">' + (m.hospital_name || '') + '</span>' + mtBadge(m.meeting_type) + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div>' +
    (m.purpose ? '<div class="text-[13px] text-slate-600 mb-1">' + m.purpose + '</div>' : '') +
    '<div class="flex flex-wrap gap-2 mt-1">' + (m.result ? '<span class="text-[11px] text-emerald-600 bg-emerald-50 rounded-md px-2 py-0.5"><i class="fas fa-check mr-0.5"></i>' + m.result + '</span>' : '') + (m.next_action ? '<span class="text-[11px] text-amber-600 bg-amber-50 rounded-md px-2 py-0.5"><i class="fas fa-arrow-right mr-0.5"></i>' + m.next_action + '</span>' : '') + '</div></div>' +
    '<div class="flex items-center gap-2 flex-shrink-0">' +
    '<div class="text-right"><div class="text-xs font-medium text-slate-500">' + fmtShort(m.meeting_date) + '</div><div class="text-[10px] ' + daysClass(m.meeting_date) + '">' + daysAgo(m.meeting_date) + '</div></div>' +
    '<div class="flex flex-col gap-0.5">' +
    '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || [m.doctor_id]).replace(/"/g, '&quot;') + ',' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button>' +
    '<button class="btn btn-ghost text-xs px-1.5 py-0.5" onclick="event.stopPropagation();delMeetGlobal(' + m.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div></div></div>'
  ).join('') : '<div class="empty"><div class="empty-icon"><i class="fas fa-calendar-xmark"></i></div><p class="font-medium text-slate-500 mb-1">미팅 기록이 없습니다</p></div>';
}
function filterM() {
  const q = (document.getElementById('m-search')?.value || '').toLowerCase();
  const t = document.getElementById('m-type')?.value || '';
  const from = document.getElementById('m-from')?.value || '';
  const to = document.getElementById('m-to')?.value || '';
  const hid = document.getElementById('m-hospital')?.value || '';
  renderML(window._meetList.filter(m => {
    if (q && !(m.doctor_name || '').toLowerCase().includes(q) && !(m.hospital_name || '').toLowerCase().includes(q) && !(m.purpose || '').toLowerCase().includes(q)) return false;
    if (t && m.meeting_type !== t) return false;
    if (hid && String(m.hospital_id) !== hid) return false;
    if (from && m.meeting_date < from) return false;
    if (to && m.meeting_date > to) return false;
    return true;
  }));
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
  let h = { name: '', region: '', address: '', phone: '', grade: 'A', notes: '', status: 'active', type: 'hospital', priority: '3', todoc_contact: 'X', patient_count: 0, hearing_aid_sales: 0, ci_referrals: 0, pipeline_stage: 'contact' };
  if (id) { try { h = (await API.get('/hospitals/' + id)).data.data } catch (e) { } }
  openModal(id ? '기관 정보 수정' : '새 기관 추가',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
    field('유형', 'type', 'select', h.type || 'hospital', [{ v: 'hospital', l: '병원' }, { v: 'clinic', l: '의원' }]) +
    '<div class="relative col-span-full sm:col-span-1"><label class="input-label">이름 *</label><input type="text" name="name" value="' + (h.name || '') + '" class="input" placeholder="기관명을 입력하세요" autocomplete="off"><div id="hosp-suggest" class="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 hidden max-h-60 overflow-y-auto"></div></div>' +
    field('지역', 'region', 'text', h.region) + field('주소', 'address', 'text', h.address) + field('전화번호', 'phone', 'tel', h.phone) +
    field('등급', 'grade', 'select', h.grade, [{ v: 'S', l: 'S급' }, { v: 'A', l: 'A급' }, { v: 'B', l: 'B급' }, { v: 'C', l: 'C급' }]) +
    field('상태', 'status', 'select', h.status, [{ v: 'active', l: '활성' }, { v: 'inactive', l: '비활성' }]) +
    field('우선순위', 'priority', 'select', h.priority, [{ v: '5', l: '★★★★★' }, { v: '4', l: '★★★★' }, { v: '3', l: '★★★' }, { v: '2', l: '★★' }, { v: '1', l: '★' }]) +
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
            var regionInput = document.querySelector('#fm input[name="region"]');
            var addrInput = document.querySelector('#fm input[name="address"]');
            if (regionInput && this.dataset.region) regionInput.value = this.dataset.region;
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
        renderSuggestList(localMatches, false);
      } else {
        dd.classList.add('hidden');
      }

      // Step 2: After short delay, also query AI for hospitals not in local list
      if (q.length >= 2) {
        hospSuggestTimer = setTimeout(async function() {
          try {
            var res = await API.post('/ai/hospital-suggest', { query: q });
            var aiList = res.data.data || [];
            // Merge: local matches first, then AI results not already in local
            var localNames = new Set(localMatches.map(function(h) { return h.name; }));
            var merged = localMatches.slice();
            aiList.forEach(function(h) { if (!localNames.has(h.name)) { merged.push(h); localNames.add(h.name); } });
            if (merged.length) renderSuggestList(merged.slice(0, 10), true);
          } catch(e) {
            // Just keep showing local results
            if (localMatches.length) renderSuggestList(localMatches, true);
          }
        }, 300);
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
async function showDocForm(hid, did) {
  let d = { name: '', department: '이비인후과', position: '', phone: '', email: '', specialty: '', influence_level: 'medium', notes: '', hospital_id: hid, bio: '', education: '', career: '', clinic_hours: '' };
  let hospName = '';
  if (did) { try { const dr = (await API.get('/doctors/' + did)).data.data; if (dr) { d = dr; hospName = dr.hospital_name || '' } } catch (e) { } }
  if (!hospName) { try { const hr = (await API.get('/hospitals/' + hid)).data.data; hospName = hr.name || '' } catch(e) {} }
  openModal(did ? '의료진 수정' : '새 의료진 추가',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' + field('이름 *', 'name', 'text', d.name) + field('진료과', 'department', 'text', d.department) + field('직위', 'position', 'text', d.position) + field('전화번호', 'phone', 'tel', d.phone) + field('이메일', 'email', 'email', d.email) + field('전문분야', 'specialty', 'text', d.specialty) + field('영향력', 'influence_level', 'select', d.influence_level, [{ v: 'high', l: '핵심' }, { v: 'medium', l: '주요' }, { v: 'low', l: '일반' }]) +
    '<div class="col-span-full"><label class="input-label"><i class="fas fa-clock text-slate-300 mr-1"></i>외래 시간 <span class="text-[10px] text-slate-400 font-normal">(방문 일정 참고)</span></label>' + clinicHoursEditor(d.clinic_hours) + '</div>' +
    '<div class="col-span-full"><button type="button" id="btn-ai-profile" class="btn btn-outline btn-sm w-full !border-violet-200 !text-violet-600 hover:!bg-violet-50" onclick="fetchAIProfile(\'' + hid + '\')"><i class="fas fa-wand-magic-sparkles mr-1.5"></i>AI 프로필 자동 조회 (학력/경력/소개)</button><div id="ai-profile-status" class="text-xs text-center text-slate-400 mt-1 hidden"></div></div>' +
    field('소개', 'bio', 'textarea', d.bio || '') + field('학력', 'education', 'textarea', (d.education || '').replace(/\\n/g, '\n')) + field('경력', 'career', 'textarea', (d.career || '').replace(/\\n/g, '\n')) + field('영업 메모', 'notes', 'textarea', d.notes) +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">' + (did ? '저장' : '추가') + '</button></div></form>', true);
  window._docFormHospName = hospName;
  document.getElementById('fm').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.name) { toast('이름을 입력하세요', 'warn'); return } f.clinic_hours = collectClinicHours(); try { if (did) { await API.put('/doctors/' + did, f); toast('의료진 정보 수정됨') } else { await API.post('/doctors', f); toast('새 의료진 추가됨') } closeModal(); if (window._docProfile && window._docProfile.id === did) viewDocProfile(did); else viewHosp(hid) } catch (e) { toast('저장 실패', 'err') } };
  setTimeout(() => document.querySelector('#fm input[name="name"]')?.focus(), 100);
}

async function fetchAIProfile(hid) {
  var nameVal = document.querySelector('#fm input[name="name"]')?.value?.trim();
  if (!nameVal) { toast('이름을 먼저 입력하세요', 'warn'); return; }
  var hospName = window._docFormHospName || '';
  if (!hospName) { toast('병원 정보를 찾을 수 없습니다', 'warn'); return; }
  var btn = document.getElementById('btn-ai-profile');
  var status = document.getElementById('ai-profile-status');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>AI 조회 중... (최대 30초 소요)';
  status.textContent = hospName + ' ' + nameVal + ' 의료진 정보 조회 중...'; status.classList.remove('hidden');
  try {
    var dept = document.querySelector('#fm input[name="department"]')?.value || '이비인후과';
    var res = await API.post('/ai/doctor-profile', { doctorName: nameVal, hospitalName: hospName, department: dept });
    var p = res.data.data;
    var filled = [];
    if (p.bio) { document.querySelector('#fm textarea[name="bio"]').value = p.bio; filled.push('소개'); }
    if (p.education) { document.querySelector('#fm textarea[name="education"]').value = p.education.replace(/\\n/g, '\n'); filled.push('학력'); }
    if (p.career) { document.querySelector('#fm textarea[name="career"]').value = p.career.replace(/\\n/g, '\n'); filled.push('경력'); }
    if (p.specialty && !document.querySelector('#fm input[name="specialty"]').value) { document.querySelector('#fm input[name="specialty"]').value = p.specialty; filled.push('전문분야'); }
    if (p.position && !document.querySelector('#fm input[name="position"]').value) { document.querySelector('#fm input[name="position"]').value = p.position; filled.push('직위'); }
    var sourceUrl = p.source || '';
    if (filled.length) {
      toast(filled.join(', ') + ' 항목이 채워졌습니다. 확인 후 수정해주세요.');
      status.innerHTML = '<i class="fas fa-check-circle text-emerald-500 mr-1"></i>' + filled.join(', ') + ' 자동 입력됨' +
        (sourceUrl ? ' · <a href="' + sourceUrl + '" target="_blank" class="text-brand-500 hover:underline"><i class="fas fa-link mr-0.5"></i>출처</a>' : '') +
        ' · <span class="text-amber-500">반드시 확인 후 사용하세요</span>';
    } else {
      toast('조회된 정보가 없습니다', 'warn');
      status.innerHTML = '<i class="fas fa-info-circle text-slate-400 mr-1"></i>조회된 정보가 없습니다. 수동으로 입력해주세요.';
    }
  } catch(e) {
    toast('AI 조회 실패', 'err');
    status.innerHTML = '<i class="fas fa-exclamation-circle text-red-400 mr-1"></i>조회 실패. 수동으로 입력해주세요.';
  }
  btn.disabled = false; btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-1.5"></i>AI 프로필 자동 조회 (학력/경력/소개)';
}
async function showMeetForm(hid, did, mid) {
  let m = { meeting_date: new Date().toISOString().split('T')[0], meeting_type: 'visit', purpose: '', content: '', result: '', next_action: '', next_meeting_date: '', doctor_ids: did ? [did] : [], hospital_id: hid };
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
  
  openModal(mid ? '미팅 수정' : '새 미팅 기록',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    // Schedule preview panel
    '<div class="col-span-full" id="meet-sched-preview"></div>' +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date) +
    field('유형', 'meeting_type', 'select', m.meeting_type, [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) + field('목적', 'purpose', 'text', m.purpose) +
    field('미팅 내용', 'content', 'textarea', m.content) + field('결과', 'result', 'textarea', m.result) + field('후속 액션', 'next_action', 'textarea', m.next_action) +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">' + (mid ? '저장' : '추가') + '</button></div></form>');
  // Bind date change to update schedule preview
  var dateInput = document.querySelector('#fm input[name="meeting_date"]');
  if (dateInput) dateInput.addEventListener('change', updateMeetSchedulePreview);
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const doctorIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const payload = { ...f, doctor_ids: doctorIds, hospital_id: hid };
    delete payload.doctor_ids_single;
    try { if (mid) { await API.put('/meetings/' + mid, payload); toast('미팅 수정됨') } else { await API.post('/meetings', payload); toast('미팅 기록됨') } closeModal(); viewHosp(hid) } catch (e) { toast('저장 실패', 'err') }
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
  let m = { meeting_date: new Date().toISOString().split('T')[0], meeting_type: 'visit', purpose: '', content: '', result: '', next_action: '', next_meeting_date: '', doctor_ids: [did], hospital_id: hid };
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
  
  openModal(mid ? '미팅 수정' : '새 미팅 기록',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    '<div class="col-span-full" id="meet-sched-preview"></div>' +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date) +
    field('유형', 'meeting_type', 'select', m.meeting_type, [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) + field('목적', 'purpose', 'text', m.purpose) +
    field('미팅 내용', 'content', 'textarea', m.content) + field('결과', 'result', 'textarea', m.result) + field('후속 액션', 'next_action', 'textarea', m.next_action) +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">' + (mid ? '저장' : '추가') + '</button></div></form>');
  var dateInput = document.querySelector('#fm input[name="meeting_date"]');
  if (dateInput) dateInput.addEventListener('change', updateMeetSchedulePreview);
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const doctorIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const payload = { ...f, doctor_ids: doctorIds, hospital_id: hid };
    try { if (mid) { await API.put('/meetings/' + mid, payload); toast('미팅 수정됨') } else { await API.post('/meetings', payload); toast('미팅 기록됨') } closeModal(); viewDocProfile(did) } catch (e) { toast('저장 실패', 'err') }
  };
  setTimeout(updateMeetSchedulePreview, 50);
}
async function showMeetFormGlobal(hid, doctorIds, mid) {
  // doctorIds can be an array or single value
  if (!Array.isArray(doctorIds)) doctorIds = [doctorIds];
  let m = {}; if (mid) { try { const ms = (await API.get('/meetings?hospital_id=' + hid)).data; const found = ms.data.find(x => x.id === mid); if (found) { m = found; doctorIds = (found.doctors || []).map(function(d) { return d.id || d.doctor_id }) || doctorIds; } } catch (e) { } }
  let docs = []; try { docs = (await API.get('/hospitals/' + hid + '/doctors')).data.data } catch (e) { }
  
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
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date || '') +
    field('유형', 'meeting_type', 'select', m.meeting_type || 'visit', [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) + field('목적', 'purpose', 'text', m.purpose || '') +
    field('미팅 내용', 'content', 'textarea', m.content || '') + field('결과', 'result', 'textarea', m.result || '') + field('후속 액션', 'next_action', 'textarea', m.next_action || '') +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">저장</button></div></form>');
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const selectedIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!selectedIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const payload = { ...f, doctor_ids: selectedIds, hospital_id: hid };
    try { await API.put('/meetings/' + mid, payload); toast('미팅 수정됨'); closeModal(); loadMeet() } catch (e) { toast('저장 실패', 'err') }
  };
}

// ===== NEW MEETING (GLOBAL - select hospital first) =====
async function showNewMeetGlobal() {
  openModal('새 미팅 기록', '<div class="text-center py-6 text-slate-400"><i class="fas fa-spinner fa-spin text-xl"></i></div>', true);
  try {
    const { data } = await API.get('/meetings/form-data');
    const hosps = data.data.hospitals || [];
    const allDocs = data.data.doctors || [];
    const hospOpts = hosps.map(h => '<option value="' + h.id + '">' + h.name + (h.region ? ' (' + h.region + ')' : '') + '</option>').join('');
    document.getElementById('modal-body').innerHTML = 
      '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
      '<div><label class="input-label">병원 *</label><select name="hospital_id" id="nm-hosp" class="input" onchange="updateNewMeetDocs()"><option value="">-- 병원 선택 --</option>' + hospOpts + '</select></div>' +
      '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label><div id="nm-doc-list" class="border border-gray-200 rounded-xl max-h-[180px] overflow-y-auto p-2"><div class="text-sm text-slate-400 text-center py-3">먼저 병원을 선택하세요</div></div></div>' +
      field('미팅일자 *', 'meeting_date', 'date', new Date().toISOString().split('T')[0]) +
      field('유형', 'meeting_type', 'select', 'visit', [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) +
      field('목적', 'purpose', 'text', '') +
      field('미팅 내용', 'content', 'textarea', '') + field('결과', 'result', 'textarea', '') + field('후속 액션', 'next_action', 'textarea', '') +
      '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" class="input"></div>' +
      '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">추가</button></div></form>';
    window._newMeetDocs = allDocs;
    document.getElementById('fm').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!f.hospital_id) { toast('병원을 선택하세요', 'warn'); return }
      const doctorIds = Array.from(document.querySelectorAll('#nm-doc-list input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
      if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
      if (!f.meeting_date) { toast('미팅일자를 입력하세요', 'warn'); return }
      const payload = { ...f, doctor_ids: doctorIds };
      try { await API.post('/meetings', payload); toast('미팅 기록됨'); closeModal(); if (curPage === 'meetings') loadMeet(); else if (curPage === 'dashboard') loadDash(); } catch (e) { toast('저장 실패', 'err') }
    };
  } catch (e) { toast('데이터를 불러올 수 없습니다', 'err'); closeModal(); }
}
function updateNewMeetDocs() {
  const hid = document.getElementById('nm-hosp')?.value;
  const container = document.getElementById('nm-doc-list');
  if (!hid || !container) { container.innerHTML = '<div class="text-sm text-slate-400 text-center py-3">먼저 병원을 선택하세요</div>'; return }
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

async function showPaperForm(did, pid) {
  let p = { title: '', journal: '', year: new Date().getFullYear(), authors: '', doi: '', abstract: '', paper_type: 'journal', url: '' };
  if (pid) { const d = window._docProfile; if (d && d.papers) { const found = d.papers.find(x => x.id === pid); if (found) p = found } }
  openModal(pid ? '논문 수정' : '새 논문 추가',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><div class="col-span-full">' + field('논문 제목 *', 'title', 'text', p.title) + '</div>' + field('저널/학회명', 'journal', 'text', p.journal) + field('발행연도', 'year', 'number', p.year) + '<div class="col-span-full">' + field('저자', 'authors', 'text', p.authors) + '</div>' + field('DOI', 'doi', 'text', p.doi) + field('유형', 'paper_type', 'select', p.paper_type, [{ v: 'journal', l: '학술지' }, { v: 'conference', l: '학회 발표' }]) + '<div class="col-span-full"><label class="input-label">논문 링크 (URL)</label><div class="relative"><i class="fas fa-link absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input type="url" name="url" value="' + (p.url || '') + '" class="input pl-9" placeholder="https://example.com/paper"></div><div class="text-[10px] text-slate-400 mt-1"><i class="fas fa-info-circle mr-0.5"></i>PubMed, Google Scholar, 학회 사이트 등의 논문 URL</div></div>' + field('초록/요약', 'abstract', 'textarea', p.abstract) +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">' + (pid ? '저장' : '추가') + '</button></div></form>');
  document.getElementById('fm').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.title) { toast('제목을 입력하세요', 'warn'); return } try { if (pid) { await API.put('/papers/' + pid, f); toast('논문 수정됨') } else { await API.post('/doctors/' + did + '/papers', f); toast('논문 추가됨') } closeModal(); viewDocProfile(did) } catch (e) { toast('저장 실패', 'err') } };
  setTimeout(() => document.querySelector('#fm input[name="title"]')?.focus(), 100);
}

// ===== PubMed Paper Search =====
async function searchPubMed(doctorId) {
  const d = window._docProfile;
  if (!d) return;
  const container = document.getElementById('pubmed-results');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = '<div class="card-flat p-6"><div class="flex items-center gap-3"><div class="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center animate-pulse"><i class="fas fa-search text-brand-500 text-sm"></i></div><div><div class="font-semibold text-sm text-slate-700">PubMed에서 논문 검색 중...</div><div class="text-xs text-slate-400 mt-0.5">' + d.name + ' ' + (d.position || '의료진') + ' · ' + (d.hospital_name || '') + '</div></div></div></div>';
  try {
    const res = await API.post('/ai/doctor-papers', {
      doctorName: d.name,
      hospitalName: d.hospital_name || '',
      specialty: d.specialty || ''
    });
    const papers = res.data.data || [];
    const existingTitles = new Set((d.papers || []).map(p => p.title.toLowerCase().replace(/[.\s]+/g, '')));
    // Filter out already-registered papers
    const newPapers = papers.filter(p => !existingTitles.has(p.title.toLowerCase().replace(/[.\s]+/g, '')));
    if (!newPapers.length && !papers.length) {
      container.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-3"><i class="fas fa-info-circle text-amber-400"></i><div><div class="text-sm font-semibold text-slate-600">PubMed에서 논문을 찾지 못했습니다</div><div class="text-xs text-slate-400 mt-0.5">검색어: ' + (res.data.searchedNames || []).join(', ') + (res.data.hospital ? ' · ' + res.data.hospital : '') + '</div></div></div></div>';
      return;
    }
    let html = '<div class="card-flat overflow-hidden"><div class="bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-3 flex items-center justify-between"><div class="flex items-center gap-2"><i class="fas fa-database text-blue-500 text-sm"></i><span class="font-bold text-sm text-blue-800">PubMed 검색 결과</span><span class="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">' + papers.length + '편 발견</span>' +
      (newPapers.length < papers.length ? '<span class="text-xs text-blue-400">(' + (papers.length - newPapers.length) + '편 이미 등록)</span>' : '') +
      '</div><div class="flex gap-2">' +
      (newPapers.length ? '<button class="btn btn-primary btn-sm text-xs" onclick="addAllPubMed(' + doctorId + ')"><i class="fas fa-plus-circle mr-1"></i>전체 추가 (' + newPapers.length + ')</button>' : '') +
      '<button class="btn btn-ghost btn-sm text-xs" onclick="document.getElementById(\'pubmed-results\').style.display=\'none\'"><i class="fas fa-times"></i></button></div></div>';
    if (newPapers.length) {
      html += '<div class="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">';
      window._pubmedPapers = newPapers;
      newPapers.forEach((p, i) => {
        html += '<div class="px-5 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3">' +
          '<input type="checkbox" class="pubmed-cb mt-1 accent-brand-500" data-idx="' + i + '" checked>' +
          '<div class="flex-1 min-w-0">' +
          '<div class="text-[13px] font-semibold text-slate-700 leading-snug mb-1 line-clamp-2">' +
          (p.url ? '<a href="' + p.url + '" target="_blank" class="hover:text-brand-600 transition-colors">' + p.title + ' <i class="fas fa-external-link-alt text-[9px] text-slate-300"></i></a>' : p.title) + '</div>' +
          '<div class="flex items-center gap-2 flex-wrap text-[11px] text-slate-400">' +
          (p.journal ? '<span><i class="fas fa-book text-slate-300 mr-0.5"></i>' + p.journal + '</span>' : '') +
          (p.year ? '<span>' + p.year + '</span>' : '') +
          '</div>' +
          (p.authors ? '<div class="text-[11px] text-slate-300 mt-0.5 line-clamp-1">' + p.authors + '</div>' : '') +
          '</div></div>';
      });
      html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="card-flat p-5"><div class="flex items-center gap-3"><i class="fas fa-exclamation-circle text-red-400"></i><span class="text-sm text-red-600">PubMed 검색 실패</span></div></div>';
  }
}

async function addAllPubMed(doctorId) {
  const papers = window._pubmedPapers || [];
  const checkboxes = document.querySelectorAll('.pubmed-cb:checked');
  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.idx));
  const selected = indices.map(i => papers[i]).filter(Boolean);
  if (!selected.length) { toast('추가할 논문을 선택하세요', 'warn'); return; }
  let added = 0;
  for (const p of selected) {
    try {
      await API.post('/doctors/' + doctorId + '/papers', {
        title: p.title, journal: p.journal || '', year: p.year || null,
        authors: p.authors || '', doi: p.doi || '', paper_type: 'journal',
        url: p.url || '', abstract: ''
      });
      added++;
    } catch (e) { /* skip */ }
  }
  toast(added + '편의 논문이 추가되었습니다');
  viewDocProfile(doctorId);
}

// ===== DELETE =====
async function delHosp(id) { showConfirm('기관 삭제', '이 기관과 소속 인원, 미팅 기록이 모두 삭제됩니다.', async () => { try { await API.delete('/hospitals/' + id); toast('기관 삭제됨'); nav('hospitals') } catch (e) { toast('삭제 실패', 'err') } }) }
async function delDoc(id, hid) { showConfirm('의료진 삭제', '이 의료진과 관련 기록이 모두 삭제됩니다.', async () => { try { await API.delete('/doctors/' + id); toast('의료진 삭제됨'); viewHosp(hid) } catch (e) { toast('삭제 실패', 'err') } }) }
async function delMeet(id, hid) { showConfirm('미팅 삭제', '이 미팅 기록을 삭제하시겠습니까?', async () => { try { await API.delete('/meetings/' + id); toast('미팅 삭제됨'); viewHosp(hid) } catch (e) { toast('삭제 실패', 'err') } }) }
async function delMeetFromProfile(mid, did) { showConfirm('미팅 삭제', '이 미팅 기록을 삭제하시겠습니까?', async () => { try { await API.delete('/meetings/' + mid); toast('미팅 삭제됨'); viewDocProfile(did) } catch (e) { toast('삭제 실패', 'err') } }) }
async function delMeetGlobal(mid) { showConfirm('미팅 삭제', '이 미팅 기록을 삭제하시겠습니까?', async () => { try { await API.delete('/meetings/' + mid); toast('미팅 삭제됨'); loadMeet() } catch (e) { toast('삭제 실패', 'err') } }) }
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
    sections += '<div class="mb-4"><div class="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">다음 미팅 예정</div>' +
      '<div class="text-sm text-blue-700 leading-relaxed bg-blue-50 rounded-xl p-3.5"><i class="fas fa-calendar-day mr-1.5 text-blue-500"></i>' + fmtShort(m.next_meeting_date) + '</div></div>';
  }
  
  if (!sections && !m.purpose) {
    sections = '<div class="text-sm text-slate-400 text-center py-4"><i class="fas fa-file-lines text-slate-300 text-lg mb-2 block"></i>상세 기록이 없습니다</div>';
  }

  var body = '<div>' +
    '<div class="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">' +
      '<div class="w-10 h-10 rounded-xl bg-' + tc + '-50 flex items-center justify-center"><i class="fas fa-calendar-check text-' + tc + '-500"></i></div>' +
      '<div class="flex-1"><div class="flex items-center gap-2"><span class="font-bold text-slate-800">' + (m.hospital_name || '') + '</span>' +
        '<span class="text-[10px] px-2 py-0.5 rounded-full bg-' + tc + '-50 text-' + tc + '-600 font-semibold">' + (typeLabels[m.meeting_type] || m.meeting_type || '') + '</span></div>' +
        '<div class="text-xs text-slate-400 mt-0.5"><i class="fas fa-clock mr-1"></i>' + fmtShort(m.meeting_date) + ' · ' + daysAgo(m.meeting_date) + '</div></div></div>' +
    doctorCards + sections +
    '<div class="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">' +
      '<button class="btn btn-outline btn-sm" onclick="closeModal();showMeetFormGlobal(' + m.hospital_id + ',' + JSON.stringify(m.doctor_ids || [m.doctor_id]).replace(/"/g, '&quot;') + ',' + m.id + ')"><i class="fas fa-pen mr-1.5 text-xs"></i>수정</button>' +
      '<button class="btn btn-outline btn-sm !border-red-200 !text-red-500 hover:!bg-red-50" onclick="closeModal();delMeetGlobal(' + m.id + ')"><i class="fas fa-trash mr-1.5 text-xs"></i>삭제</button>' +
    '</div></div>';

  openModal('미팅 상세', body);
}
async function delPaper(pid, did) { showConfirm('논문 삭제', '이 논문을 삭제하시겠습니까?', async () => { try { await API.delete('/papers/' + pid); toast('논문 삭제됨'); viewDocProfile(did) } catch (e) { toast('삭제 실패', 'err') } }) }

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
  const rc = ['#3366ff', '#059669', '#d97706', '#8b5cf6', '#ef4444', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#64748b', '#0ea5e9', '#a855f7', '#14b8a6', '#f43f5e', '#eab308', '#6366f1', '#10b981'];

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
    const ic = ['#3366ff', '#059669', '#d97706', '#8b5cf6', '#94a3b8'];
    ciCharts.push(new Chart(document.getElementById('chart-inst-trend'), { type: 'line', data: { labels: years.map(y => y + '년'), datasets: it.filter(t => years.some(yr => s.institution.find(x => x.year === yr && x.institution_type === t && x.patients > 0))).map((t, i) => ({ label: t, data: years.map(yr => { const r = s.institution.find(x => x.year === yr && x.institution_type === t); return r?.patients || 0 }), borderColor: ic[i], borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: ic[i], tension: 0.4, fill: false })) }, options: { ...defs, plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 10 } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } } }));
    const instL = s.institution.filter(r => r.year === latestY && r.patients > 0);
    ciCharts.push(new Chart(document.getElementById('chart-inst-pie'), { type: 'doughnut', data: { labels: instL.map(r => r.institution_type), datasets: [{ data: instL.map(r => r.patients), backgroundColor: ic.slice(0, instL.length), borderWidth: 2, borderColor: '#fff' }] }, options: { ...defs, cutout: '50%', plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12 } } } } }));
  }
  if (tab === 'amount') {
    ciCharts.push(new Chart(document.getElementById('chart-amount-trend'), { type: 'line', data: { labels: y.map(d => d.year + '년'), datasets: [{ label: '총 진료금액', data: y.map(d => d.amount), borderColor: '#3366ff', backgroundColor: 'rgba(51,102,255,0.1)', borderWidth: 3, pointRadius: 5, pointBackgroundColor: '#3366ff', fill: true, tension: 0.4 }] }, options: { ...defs, scales: { y: { beginAtZero: false, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { callback: v => fmtAmount(v) } }, x: { grid: { display: false } } } } }));
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
    if (!v) return { bg: 'bg-gray-50', text: 'text-slate-300', border: 'border-gray-100', icon: '' };
    if (v === '진료') return { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-100', icon: '<i class="fas fa-stethoscope text-[8px] mr-0.5"></i>' };
    if (v === '수술') return { bg: 'bg-rose-50', text: 'text-rose-600', border: 'border-rose-100', icon: '<i class="fas fa-scissors text-[8px] mr-0.5"></i>' };
    if (v === '휴진') return { bg: 'bg-gray-100', text: 'text-gray-400', border: 'border-gray-200', icon: '<i class="fas fa-ban text-[8px] mr-0.5"></i>' };
    if (v === '순환진료') return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-100', icon: '<i class="fas fa-rotate text-[8px] mr-0.5"></i>' };
    if (v.includes('검사')) return { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-100', icon: '<i class="fas fa-microscope text-[8px] mr-0.5"></i>' };
    return { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', icon: '' };
  };
  
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
    var v = h[k + '_am'] || '';
    var c = slotColor(v);
    html += '<div class="p-1"><div class="' + c.bg + ' ' + c.text + ' border ' + c.border + ' rounded-lg text-center py-1.5 text-[10px] font-semibold leading-none">' + (v ? c.icon + v : '-') + '</div></div>';
  });
  html += '</div>';
  // PM row
  html += '<div class="grid grid-cols-7">';
  html += '<div class="p-1.5 text-[9px] font-bold text-indigo-500 text-center bg-indigo-50/40 flex items-center justify-center">오후</div>';
  DAYS_KEY.forEach(function(k) {
    var v = h[k + '_pm'] || '';
    var c = slotColor(v);
    html += '<div class="p-1"><div class="' + c.bg + ' ' + c.text + ' border ' + c.border + ' rounded-lg text-center py-1.5 text-[10px] font-semibold leading-none">' + (v ? c.icon + v : '-') + '</div></div>';
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
