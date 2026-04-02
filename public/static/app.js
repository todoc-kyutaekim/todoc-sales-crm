// ===== TODOC CRM - Frontend Application =====
const API = axios.create({ baseURL: '/api' });
let curPage = '', hospList = [], docList = [], confirmCb = null, searchTimer = null;
let currentUser = null;

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
  if (bn) bn.classList.add('hidden');
  renderLoginForm();
}
function showAppScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-main').classList.remove('hidden');
  var bn = document.getElementById('bottom-nav');
  if (bn) bn.classList.remove('hidden');
  updateUserUI();
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
  mc.className = 'modal-box bg-white rounded-t-2xl lg:rounded-2xl shadow-2xl w-full max-h-[90vh] lg:max-h-[88vh] overflow-y-auto ' + (wide === true || wide === 'wide' ? 'max-w-2xl' : wide === 'narrow' ? 'max-w-md' : 'max-w-lg');
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden') }
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
  if (forceOpen || sw.classList.contains('hidden')) {
    sw.classList.remove('hidden');
    sw.classList.add('!block');
    sw.style.cssText = 'position:fixed;top:52px;left:0;right:0;z-index:55;padding:8px 12px;background:#fff;border-bottom:1px solid #f0f0f3;box-shadow:0 4px 12px rgba(0,0,0,0.08)';
    setTimeout(() => document.getElementById('global-search')?.focus(), 50);
  } else {
    sw.classList.add('hidden');
    sw.classList.remove('!block');
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
function showSearchResults() { if (document.getElementById('global-search')?.value) onGlobalSearch(document.getElementById('global-search').value); }
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
function fmtAmount(v) { if (v >= 1000000) return (v / 1000000).toFixed(1) + '조원'; if (v >= 1000) return (v / 1000).toFixed(0) + '억원'; return v + '천원' }
function fmtNum(n) { return n.toLocaleString('ko-KR') }
function infoRow(label, val) { return '<div class="flex items-center justify-between py-1"><span class="text-[12px] text-slate-400">' + label + '</span><span class="text-[13px] font-medium text-slate-700">' + (val || '-') + '</span></div>' }

// ===== CSV Download =====
function downloadCSV(type) { window.open('/api/export/' + type, '_blank'); }

// ===== DASHBOARD =====
let dashCharts = [];
function destroyDashCharts() { dashCharts.forEach(c => { try { c.destroy() } catch(e) {} }); dashCharts = []; }

async function loadDash() {
  destroyDashCharts();
  document.getElementById('page-title').textContent = '대시보드';
  document.getElementById('page-subtitle').textContent = '';
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-success btn-sm" onclick="showNewMeetGlobal()"><i class="fas fa-calendar-plus text-xs"></i><span class="hidden sm:inline">빠른 미팅 추가</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 space-y-6"><div class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">' + Array(4).fill('<div class="sc"><div class="flex gap-4"><div class="skeleton rounded-xl" style="width:44px;height:44px"></div><div class="flex-1 space-y-2"><div class="skeleton rounded h-3 w-16"></div><div class="skeleton rounded h-6 w-20"></div></div></div></div>').join('') + '</div></div>';
  try {
    const { data: d } = await API.get('/dashboard'); const s = d.data;
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
      '<div class="sc cursor-pointer" onclick="nav(\'meetings\')"><div class="flex items-center gap-4"><div class="sc-icon" style="background:#fffbeb"><i class="fas fa-calendar-day" style="color:#d97706"></i></div><div><p class="text-[11px] text-slate-400 font-medium mb-0.5">이번 달</p><div class="flex items-baseline gap-1"><span class="text-[22px] font-extrabold text-slate-800 tracking-tight">' + s.stats.monthMeetings + '</span><span class="text-xs text-slate-300 font-medium">건</span></div><div class="mt-0.5">' + monthDiffText + ' <span class="text-[10px] text-slate-300">vs 지난달</span></div></div></div></div>' +
      '</div>' +
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

// ===== HOSPITALS =====
async function loadHosp(typeFilter) {
  document.getElementById('page-title').textContent = '기관 관리';
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-outline btn-sm hide-mobile" onclick="downloadCSV(\'hospitals\')"><i class="fas fa-download text-xs"></i>CSV</button><button class="btn btn-primary" onclick="showHospForm()"><i class="fas fa-plus text-xs"></i><span class="hidden sm:inline">추가</span></button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">' + Array(6).fill('<div class="card p-5"><div class="space-y-3"><div class="skeleton rounded h-5 w-32"></div><div class="skeleton rounded h-3 w-48"></div></div></div>').join('') + '</div></div>';
  try {
    const [hR, rR] = await Promise.all([API.get('/hospitals'), API.get('/regions')]);
    hospList = hR.data.data; const regions = rR.data.data;
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' +
      '<div class="relative flex-1" style="min-width:140px"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="h-search" oninput="filterH()" placeholder="기관명 검색" class="input pl-10"></div>' +
      '<select id="h-type" onchange="filterH()" class="input" style="max-width:110px"><option value="">전체 유형</option><option value="hospital">병원</option><option value="clinic">의원</option></select>' +
      '<select id="h-region" onchange="filterH()" class="input" style="max-width:120px"><option value="">전체 지역</option>' + regions.map(r => '<option>' + r + '</option>').join('') + '</select>' +
      '<select id="h-grade" onchange="filterH()" class="input" style="max-width:110px"><option value="">전체 등급</option><option value="S">S급</option><option value="A">A급</option><option value="B">B급</option><option value="C">C급</option></select>' +
      '<span id="h-count" class="text-xs text-slate-300 font-medium"></span></div>' +
      '<div id="h-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5"></div></div>';
    if (typeFilter) { document.getElementById('h-type').value = typeFilter; }
    filterH();
  } catch (e) { toast('기관 목록을 불러올 수 없습니다', 'err') }
}
function renderH(list) {
  document.getElementById('h-count').textContent = list.length + '개 기관';
  document.getElementById('h-grid').innerHTML = list.length ? list.map(h => {
    const warn = h.last_meeting ? Math.floor((Date.now() - new Date(h.last_meeting + 'T00:00:00').getTime()) / 86400000) > 30 : '';
    return '<div class="card accent-' + h.grade + ' p-5 cursor-pointer" onclick="viewHosp(' + h.id + ')">' +
      '<div class="flex items-center gap-2 mb-3">' +
      gradeBadge(h.grade) + priorityStars(h.priority) + todocBadge(h.todoc_contact) +
      statusDot(h.status) + (warn ? '<span class="ml-auto text-[10px] text-red-400 bg-red-50 px-2 py-0.5 rounded-full font-semibold"><i class="fas fa-exclamation-triangle mr-0.5"></i>30일+</span>' : '') + '</div>' +
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
  }).join('') : '<div class="col-span-full empty"><div class="empty-icon"><i class="fas fa-hospital"></i></div><p class="font-medium text-slate-500 mb-1">등록된 기관이 없습니다</p><p class="text-sm text-slate-300">"추가" 버튼으로 시작하세요</p></div>';
}
function filterH() {
  const s = (document.getElementById('h-search')?.value || '').toLowerCase(), r = document.getElementById('h-region')?.value || '', g = document.getElementById('h-grade')?.value || '', t = document.getElementById('h-type')?.value || '';
  renderH(hospList.filter(h => (!s || h.name.toLowerCase().includes(s)) && (!r || h.region === r) && (!g || h.grade === g) && (!t || h.type === t)));
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
    '<div class="flex items-center gap-3 text-[11px]"><span class="text-slate-400"><i class="fas fa-handshake mr-1"></i>' + (d.meeting_count || 0) + '회</span>' + (d.last_meeting ? '<span class="' + daysClass(d.last_meeting) + '"><i class="fas fa-clock mr-1"></i>' + daysAgo(d.last_meeting) + '</span>' : '') + '</div></div>' +
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
  return '<div class="card-flat p-4 lg:p-6">' + meets.map((m, i) =>
    '<div class="flex gap-3 lg:gap-4 ' + (i < meets.length - 1 ? 'mb-6' : '') + '">' +
    '<div class="flex flex-col items-center pt-1"><div class="tl-dot"></div>' + (i < meets.length - 1 ? '<div class="tl-line flex-1 mt-1"></div>' : '') + '</div>' +
    '<div class="flex-1">' +
    '<div class="flex items-center justify-between mb-2 flex-wrap gap-2">' +
    '<div class="flex items-center gap-2">' + mtBadge(m.meeting_type) + '<span class="font-semibold text-[13px] text-slate-800">' + meetDoctorNames(m) + '</span>' + (m.doctors && m.doctors.length > 1 ? '<span class="text-[10px] bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded-full font-bold">' + m.doctors.length + '명</span>' : '') + '</div>' +
    '<div class="flex items-center gap-2"><span class="text-xs text-slate-400">' + fmtDate(m.meeting_date) + '</span><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="showMeetForm(' + h.id + ',null,' + m.id + ')"><i class="fas fa-pen text-[10px]"></i></button><button class="btn btn-ghost text-xs px-1.5 py-1" onclick="delMeet(' + m.id + ',' + h.id + ')"><i class="fas fa-trash text-[10px] text-red-300"></i></button></div></div>' +
    (m.purpose ? '<div class="text-[13px] font-medium text-slate-700 mb-1.5">' + m.purpose + '</div>' : '') +
    (m.content ? '<div class="text-xs text-slate-500 leading-relaxed mb-2 bg-slate-50 rounded-lg p-3">' + m.content + '</div>' : '') +
    '<div class="flex flex-wrap gap-2">' +
    (m.result ? '<div class="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-check-circle mr-1.5"></i><strong>결과:</strong> ' + m.result + '</div>' : '') +
    (m.next_action ? '<div class="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 flex-1 meet-result-card"><i class="fas fa-arrow-right mr-1.5"></i><strong>후속:</strong> ' + m.next_action + (m.next_meeting_date ? ' <span class="font-bold">(' + fmtShort(m.next_meeting_date) + ')</span>' : '') + '</div>' : '') +
    '</div></div></div>'
  ).join('') + '</div>';
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
    var res = await API.post('/ai/hospital-doctors', { hospitalName: h.name, region: h.region, type: h.type || '' }, { timeout: 90000 });
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
        var profRes = await API.post('/ai/doctor-profile', { doctorName: dr.name, hospitalName: dr.hospitalName, department: '이비인후과' }, { timeout: 30000 });
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
        var papersRes = await API.post('/ai/doctor-papers', { doctorName: dr.name, hospitalName: dr.hospitalName, specialty: '' }, { timeout: 30000 });
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
        var profRes = await API.post('/ai/doctor-profile', { doctorName: dr.name, hospitalName: hospitalName, department: dr.department || '이비인후과' }, { timeout: 30000 });
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
    var profRes = await API.post('/ai/doctor-profile', { doctorName: d.name, hospitalName: d.hospital_name || '', department: d.department || '이비인후과' }, { timeout: 30000 });
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
  document.getElementById('header-actions').innerHTML = '<button class="btn btn-outline btn-sm hide-mobile" onclick="downloadCSV(\'doctors\')"><i class="fas fa-download text-xs"></i>CSV</button>';
  document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7"><div class="card-flat overflow-hidden">' + skeleton(6) + '</div></div>';
  try {
    const [dr, deptR] = await Promise.all([API.get('/doctors'), API.get('/doctors/departments')]);
    docList = dr.data.data;
    const depts = deptR.data.data || [];
    document.getElementById('content').innerHTML = '<div class="p-4 lg:p-7 fade-in">' +
      '<div class="filter-row">' +
      '<div class="relative flex-1" style="min-width:140px"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="d-search" oninput="filterD()" placeholder="의료진명/병원명" class="input pl-10"></div>' +
      '<select id="d-inf" onchange="filterD()" class="input" style="max-width:100px"><option value="">전체</option><option value="high">핵심</option><option value="medium">주요</option><option value="low">일반</option></select>' +
      '<select id="d-dept" onchange="filterD()" class="input" style="max-width:130px"><option value="">전체 진료과</option>' + depts.map(dp => '<option>' + dp + '</option>').join('') + '</select>' +
      '<select id="d-visit" onchange="filterD()" class="input" style="max-width:140px"><option value="">전체 방문</option><option value="30">30일+ 미방문</option><option value="60">60일+ 미방문</option><option value="90">90일+ 미방문</option></select>' +
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
  renderDR(docList.filter(d => {
    if (q && !d.name.toLowerCase().includes(q) && !(d.hospital_name || '').toLowerCase().includes(q)) return false;
    if (inf && d.influence_level !== inf) return false;
    if (dept && d.department !== dept) return false;
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
      '<div class="relative flex-1" style="min-width:140px"><i class="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i><input id="m-search" oninput="filterM()" placeholder="의료진/병원/목적 검색" class="input pl-10"></div>' +
      '<select id="m-hospital" onchange="filterM()" class="input" style="max-width:160px">' + hospOpts + '</select>' +
      '<select id="m-type" onchange="filterM()" class="input" style="max-width:110px"><option value="">전체 유형</option><option value="visit">방문</option><option value="phone">전화</option><option value="conference">학회</option><option value="email">이메일</option><option value="online">온라인</option></select>' +
      '<input id="m-from" type="date" onchange="filterM()" class="input hide-mobile" style="max-width:150px" placeholder="시작일">' +
      '<input id="m-to" type="date" onchange="filterM()" class="input hide-mobile" style="max-width:150px" placeholder="종료일">' +
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

async function showHospForm(id) {
  let h = { name: '', region: '', address: '', phone: '', grade: 'A', notes: '', status: 'active', type: 'hospital', priority: '3', todoc_contact: 'X', patient_count: 0, hearing_aid_sales: 0, ci_referrals: 0 };
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
  let d = { name: '', department: '이비인후과', position: '', phone: '', email: '', specialty: '', influence_level: 'medium', notes: '', hospital_id: hid, bio: '', education: '', career: '' };
  let hospName = '';
  if (did) { try { const dr = (await API.get('/doctors/' + did)).data.data; if (dr) { d = dr; hospName = dr.hospital_name || '' } } catch (e) { } }
  if (!hospName) { try { const hr = (await API.get('/hospitals/' + hid)).data.data; hospName = hr.name || '' } catch(e) {} }
  openModal(did ? '의료진 수정' : '새 의료진 추가',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' + field('이름 *', 'name', 'text', d.name) + field('진료과', 'department', 'text', d.department) + field('직위', 'position', 'text', d.position) + field('전화번호', 'phone', 'tel', d.phone) + field('이메일', 'email', 'email', d.email) + field('전문분야', 'specialty', 'text', d.specialty) + field('영향력', 'influence_level', 'select', d.influence_level, [{ v: 'high', l: '핵심' }, { v: 'medium', l: '주요' }, { v: 'low', l: '일반' }]) +
    '<div class="col-span-full"><button type="button" id="btn-ai-profile" class="btn btn-outline btn-sm w-full !border-violet-200 !text-violet-600 hover:!bg-violet-50" onclick="fetchAIProfile(\'' + hid + '\')"><i class="fas fa-wand-magic-sparkles mr-1.5"></i>AI 프로필 자동 조회 (학력/경력/소개)</button><div id="ai-profile-status" class="text-xs text-center text-slate-400 mt-1 hidden"></div></div>' +
    field('소개', 'bio', 'textarea', d.bio || '') + field('학력', 'education', 'textarea', (d.education || '').replace(/\\n/g, '\n')) + field('경력', 'career', 'textarea', (d.career || '').replace(/\\n/g, '\n')) + field('영업 메모', 'notes', 'textarea', d.notes) +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-primary">' + (did ? '저장' : '추가') + '</button></div></form>', true);
  window._docFormHospName = hospName;
  document.getElementById('fm').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (!f.name) { toast('이름을 입력하세요', 'warn'); return } try { if (did) { await API.put('/doctors/' + did, f); toast('의료진 정보 수정됨') } else { await API.post('/doctors', f); toast('새 의료진 추가됨') } closeModal(); if (window._docProfile && window._docProfile.id === did) viewDocProfile(did); else viewHosp(hid) } catch (e) { toast('저장 실패', 'err') } };
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
  
  // Build multi-select checkbox list
  var doctorCheckboxes = docs.length ? 
    '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
    '<div class="border border-gray-200 rounded-xl max-h-[180px] overflow-y-auto p-2 space-y-1">' +
    docs.map(function(d) {
      var checked = (m.doctor_ids || []).map(Number).includes(d.id) ? ' checked' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition">' +
        '<input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"' + checked + '>' +
        '<div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' +
        (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') +
        '</div></label>';
    }).join('') + '</div></div>' :
    '<div class="col-span-full"><label class="input-label">의료진</label><div class="text-sm text-slate-400 p-3 bg-gray-50 rounded-lg text-center">소속 의료진이 없습니다. 먼저 의료진을 추가하세요.</div></div>';
  
  openModal(mid ? '미팅 수정' : '새 미팅 기록',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date) +
    field('유형', 'meeting_type', 'select', m.meeting_type, [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) + field('목적', 'purpose', 'text', m.purpose) +
    field('미팅 내용', 'content', 'textarea', m.content) + field('결과', 'result', 'textarea', m.result) + field('후속 액션', 'next_action', 'textarea', m.next_action) +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">' + (mid ? '저장' : '추가') + '</button></div></form>');
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    // Get all checked doctor_ids
    const doctorIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const payload = { ...f, doctor_ids: doctorIds, hospital_id: hid };
    delete payload.doctor_ids_single;
    try { if (mid) { await API.put('/meetings/' + mid, payload); toast('미팅 수정됨') } else { await API.post('/meetings', payload); toast('미팅 기록됨') } closeModal(); viewHosp(hid) } catch (e) { toast('저장 실패', 'err') }
  };
}
async function showMeetFormFromProfile(hid, did, mid) {
  let m = { meeting_date: new Date().toISOString().split('T')[0], meeting_type: 'visit', purpose: '', content: '', result: '', next_action: '', next_meeting_date: '', doctor_ids: [did], hospital_id: hid };
  if (mid) { try { const ms = (await API.get('/meetings?doctor_id=' + did)).data; const found = ms.data.find(x => x.id === mid); if (found) { m = found; m.doctor_ids = (found.doctors || []).map(function(d) { return d.id || d.doctor_id }) || [found.doctor_id]; } } catch (e) { } }
  let docs = []; try { docs = (await API.get('/hospitals/' + hid + '/doctors')).data.data } catch (e) { }
  
  var doctorCheckboxes = docs.length ?
    '<div class="col-span-full"><label class="input-label">참석 의료진 * <span class="text-[10px] text-slate-400 font-normal">(복수 선택 가능)</span></label>' +
    '<div class="border border-gray-200 rounded-xl max-h-[180px] overflow-y-auto p-2 space-y-1">' +
    docs.map(function(d) {
      var checked = (m.doctor_ids || []).map(Number).includes(d.id) ? ' checked' : '';
      return '<label class="flex items-center gap-2.5 p-2 rounded-lg hover:bg-brand-50 cursor-pointer transition">' +
        '<input type="checkbox" name="doctor_ids" value="' + d.id + '" class="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"' + checked + '>' +
        '<div class="flex-1 min-w-0"><span class="text-[13px] font-medium text-slate-700">' + d.name + '</span>' +
        (d.position ? '<span class="text-[11px] text-slate-400 ml-1">' + d.position + '</span>' : '') +
        '</div></label>';
    }).join('') + '</div></div>' :
    '<div class="col-span-full"><label class="input-label">의료진</label><div class="text-sm text-slate-400 p-3 bg-gray-50 rounded-lg text-center">소속 의료진이 없습니다.</div></div>';
  
  openModal(mid ? '미팅 수정' : '새 미팅 기록',
    '<form id="fm" class="grid grid-cols-1 sm:grid-cols-2 gap-4"><input type="hidden" name="hospital_id" value="' + hid + '">' +
    doctorCheckboxes +
    field('미팅일자 *', 'meeting_date', 'date', m.meeting_date) +
    field('유형', 'meeting_type', 'select', m.meeting_type, [{ v: 'visit', l: '방문' }, { v: 'phone', l: '전화' }, { v: 'conference', l: '학회' }, { v: 'email', l: '이메일' }, { v: 'online', l: '온라인' }]) + field('목적', 'purpose', 'text', m.purpose) +
    field('미팅 내용', 'content', 'textarea', m.content) + field('결과', 'result', 'textarea', m.result) + field('후속 액션', 'next_action', 'textarea', m.next_action) +
    '<div><label class="input-label">다음 미팅 예정</label><input type="date" name="next_meeting_date" value="' + (m.next_meeting_date || '') + '" class="input"></div>' +
    '<div class="col-span-full flex justify-end gap-2 pt-3 border-t border-gray-50 mt-2"><button type="button" onclick="closeModal()" class="btn btn-outline">취소</button><button type="submit" class="btn btn-success">' + (mid ? '저장' : '추가') + '</button></div></form>');
  document.getElementById('fm').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const doctorIds = Array.from(document.querySelectorAll('#fm input[name="doctor_ids"]:checked')).map(cb => Number(cb.value));
    if (!doctorIds.length) { toast('의료진을 선택하세요', 'warn'); return }
    const payload = { ...f, doctor_ids: doctorIds, hospital_id: hid };
    try { if (mid) { await API.put('/meetings/' + mid, payload); toast('미팅 수정됨') } else { await API.post('/meetings', payload); toast('미팅 기록됨') } closeModal(); viewDocProfile(did) } catch (e) { toast('저장 실패', 'err') }
  };
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
      '<div class="table-wrap"><table class="w-full"><thead><tr class="bg-gray-50/80 text-[11px] text-slate-400 font-semibold border-y border-gray-100"><th class="px-4 py-3 text-left">연도</th><th class="px-4 py-3 text-right">환자수</th><th class="px-4 py-3 text-right">사용량</th><th class="px-4 py-3 text-right">금액(천원)</th><th class="px-4 py-3 text-right">남</th><th class="px-4 py-3 text-right">여</th><th class="px-4 py-3 text-right">증감</th></tr></thead>' +
      '<tbody class="divide-y divide-gray-50">' + y.map((r, i) => { const g = i > 0 ? ((r.patients - y[i - 1].patients) / y[i - 1].patients * 100).toFixed(1) : '—'; const gc = i > 0 ? (r.patients > y[i - 1].patients ? 'text-emerald-600' : 'text-red-500') : 'text-slate-400'; return '<tr class="tr"><td class="px-4 py-3 font-bold text-sm text-slate-800">' + r.year + '</td><td class="px-4 py-3 text-right font-semibold text-sm text-brand-600">' + fmtNum(r.patients) + '</td><td class="px-4 py-3 text-right text-sm text-slate-600">' + fmtNum(r.usage) + '</td><td class="px-4 py-3 text-right text-sm text-slate-600">' + fmtNum(r.amount) + '</td><td class="px-4 py-3 text-right text-sm text-blue-600">' + fmtNum(r.male_patients) + '</td><td class="px-4 py-3 text-right text-sm text-pink-600">' + fmtNum(r.female_patients) + '</td><td class="px-4 py-3 text-right text-sm font-semibold ' + gc + '">' + (i > 0 ? (g > 0 ? '+' : '') + g + '%' : '—') + '</td></tr>' }).join('') + '</tbody></table></div></div>' +
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
      '<div class="sc !p-4"><div class="text-[11px] text-slate-400 mb-1">1인당 평균</div><div class="text-[22px] font-extrabold text-emerald-600">' + (y[y.length - 1].amount / y[y.length - 1].patients).toFixed(0) + '천원</div></div></div>' +
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

// ===== Init =====
initAuth();
