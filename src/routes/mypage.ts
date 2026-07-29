import { Hono } from 'hono'
import { logActivity, apiError, ErrorCodes } from '../helpers'

type Bindings = { DB: D1Database }
const mypage = new Hono<{ Bindings: Bindings }>()

// ─────────────────────────────────────────────────────────────
// 세션에서 user_id 추출 (auth 미들웨어 대신 인라인 처리)
// ─────────────────────────────────────────────────────────────
async function requireUser(c: any): Promise<{ userId: number } | Response> {
  const sessionId = c.req.header('X-Session-Id') || ''
  if (!sessionId) return c.json({ error: 'Unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id=? AND expires_at > datetime("now")'
  ).bind(sessionId).first() as any
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  return { userId: session.user_id, sessionId } as any
}

// ─────────────────────────────────────────────────────────────
// GET /api/mypage — 내 프로필 + 활동 요약 통합 조회
//   반환: { profile: {...}, summary: {...}, sessions: [...] }
// ─────────────────────────────────────────────────────────────
mypage.get('/', async (c) => {
  const auth = await requireUser(c)
  if (auth instanceof Response) return auth
  const { userId, sessionId } = auth as any

  // 1) 프로필
  const profile = await c.env.DB.prepare(`
    SELECT id, name, email, phone, department, position, job_role, avatar_url, bio, created_at, updated_at
    FROM users WHERE id=?
  `).bind(userId).first()
  if (!profile) return apiError(c, 404, '사용자를 찾을 수 없습니다', ErrorCodes.NOT_FOUND)

  // 2) 활동 요약 (병렬 실행)
  // ─ 이번 달 미팅 수 (meeting_users JOIN meetings)
  // ─ 담당 고객 수 (customers.created_by = userId)
  // ─ 처리한 CS 문의 수 (cs_inquiries.assignee_id = userId AND status='resolved')
  // ─ 열린 CS 문의 수 (cs_inquiries.assignee_id = userId AND status IN ('open','in_progress'))
  // ─ 등록한 기관 수 (hospitals에는 created_by가 없어 생략 — 대신 최근 30일 미팅 카운트)
  // ─ 최근 7일 활동 (미팅 + 문의 생성)
  const [monthMeet, myCust, resolvedInq, openInq, week7Meet, week7Inq] = await Promise.all([
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT m.id) AS n
      FROM meeting_users mu JOIN meetings m ON m.id = mu.meeting_id
      WHERE mu.user_id = ? AND m.meeting_date >= date('now', 'start of month')
        AND m.meeting_date < date('now', 'start of month', '+1 month')
    `).bind(userId).first() as Promise<any>,
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM customers WHERE created_by = ?`).bind(userId).first() as Promise<any>,
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM cs_inquiries WHERE assignee_id = ? AND status = 'resolved'`).bind(userId).first() as Promise<any>,
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM cs_inquiries WHERE assignee_id = ? AND status IN ('open','in_progress')`).bind(userId).first() as Promise<any>,
    c.env.DB.prepare(`
      SELECT COUNT(DISTINCT m.id) AS n
      FROM meeting_users mu JOIN meetings m ON m.id = mu.meeting_id
      WHERE mu.user_id = ? AND m.meeting_date >= date('now', '-7 days')
    `).bind(userId).first() as Promise<any>,
    c.env.DB.prepare(`
      SELECT COUNT(*) AS n FROM cs_inquiries
      WHERE (assignee_id = ? OR created_by = ?) AND created_at >= datetime('now', '-7 days')
    `).bind(userId, userId).first() as Promise<any>,
  ])

  // 3) 활성 세션 목록 (다른 기기 로그인 확인용)
  const sessRes = await c.env.DB.prepare(`
    SELECT id, expires_at, created_at
    FROM sessions
    WHERE user_id = ? AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 20
  `).bind(userId).all()
  const sessions = ((sessRes.results as any[]) || []).map(s => ({
    id_masked: (s.id || '').slice(0, 8) + '...',
    is_current: s.id === sessionId,
    created_at: s.created_at,
    expires_at: s.expires_at,
  }))

  // 4) 최근 내 활동 (최대 20개) — 내가 만든 미팅 + 담당/등록한 문의
  const recentRes = await c.env.DB.prepare(`
    SELECT 'meeting' AS kind, m.id AS entity_id, h.name AS title,
      m.meeting_date AS date, m.purpose AS desc
    FROM meeting_users mu
    JOIN meetings m ON m.id = mu.meeting_id
    LEFT JOIN hospitals h ON h.id = m.hospital_id
    WHERE mu.user_id = ?
    UNION ALL
    SELECT 'inquiry' AS kind, i.id AS entity_id, COALESCE(i.subject, '문의') AS title,
      DATE(i.created_at) AS date, i.status AS desc
    FROM cs_inquiries i
    WHERE i.assignee_id = ? OR i.created_by = ?
    ORDER BY date DESC
    LIMIT 20
  `).bind(userId, userId, userId).all()

  return c.json({
    data: {
      profile,
      summary: {
        month_meetings: monthMeet?.n || 0,
        my_customers: myCust?.n || 0,
        resolved_inquiries: resolvedInq?.n || 0,
        open_inquiries: openInq?.n || 0,
        week7_meetings: week7Meet?.n || 0,
        week7_inquiries: week7Inq?.n || 0,
      },
      sessions,
      recent: recentRes.results || [],
    }
  })
})

// ─────────────────────────────────────────────────────────────
// PUT /api/mypage — 프로필 수정
//   허용 필드: name, phone, department, position, job_role, avatar_url, bio
//   (email은 로그인 계정이라 별도 프로세스 필요 — 여기선 수정 불가)
// ─────────────────────────────────────────────────────────────
mypage.put('/', async (c) => {
  const auth = await requireUser(c)
  if (auth instanceof Response) return auth
  const { userId } = auth as any

  const body = await c.req.json().catch(() => ({}))
  const { name, phone, department, position, job_role, avatar_url, bio } = body || {}

  // 이름 검증
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return apiError(c, 400, '이름을 입력해주세요.', ErrorCodes.VALIDATION)
    }
  }
  // avatar_url — 간단한 http(s) 검증 (빈 문자열은 허용 = 삭제)
  if (avatar_url !== undefined && avatar_url !== null && avatar_url !== '') {
    if (typeof avatar_url !== 'string' || !/^https?:\/\//i.test(avatar_url)) {
      return apiError(c, 400, '프로필 사진은 http(s) URL이어야 합니다.', ErrorCodes.VALIDATION)
    }
    if (avatar_url.length > 500) {
      return apiError(c, 400, '프로필 사진 URL이 너무 깁니다.', ErrorCodes.VALIDATION)
    }
  }

  // 길이 검증 (간단)
  const strFields: [string, any][] = [
    ['phone', phone], ['department', department], ['position', position],
    ['job_role', job_role], ['bio', bio]
  ]
  for (const [k, v] of strFields) {
    if (v !== undefined && v !== null && typeof v !== 'string') {
      return apiError(c, 400, `${k} 형식이 올바르지 않습니다.`, ErrorCodes.VALIDATION)
    }
    if (typeof v === 'string' && v.length > (k === 'bio' ? 1000 : 200)) {
      return apiError(c, 400, `${k}가 너무 깁니다.`, ErrorCodes.VALIDATION)
    }
  }

  // 부분 업데이트 — 전달된 필드만 갱신
  const sets: string[] = []
  const params: any[] = []
  const push = (col: string, val: any) => {
    if (val === undefined) return
    sets.push(`${col} = ?`)
    params.push(val === '' ? null : (typeof val === 'string' ? val.trim() : val))
  }
  push('name', name)
  push('phone', phone)
  push('department', department)
  push('position', position)
  push('job_role', job_role)
  push('avatar_url', avatar_url)
  push('bio', bio)

  if (!sets.length) {
    return c.json({ data: { updated: false } })
  }
  sets.push('updated_at = CURRENT_TIMESTAMP')
  params.push(userId)

  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()

  // 활동 로그
  try {
    await logActivity(c.env.DB, 'update', 'user', userId, (name && String(name).trim()) || '내 프로필', '프로필 수정')
  } catch (_) {}

  const updated = await c.env.DB.prepare(`
    SELECT id, name, email, phone, department, position, job_role, avatar_url, bio, created_at, updated_at
    FROM users WHERE id=?
  `).bind(userId).first()
  return c.json({ data: updated })
})

// ─────────────────────────────────────────────────────────────
// POST /api/mypage/logout-others — 다른 기기의 모든 세션 로그아웃
// ─────────────────────────────────────────────────────────────
mypage.post('/logout-others', async (c) => {
  const auth = await requireUser(c)
  if (auth instanceof Response) return auth
  const { userId, sessionId } = auth as any

  const res = await c.env.DB.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND id != ?'
  ).bind(userId, sessionId).run()

  return c.json({ data: { deleted: res.meta?.changes || 0 } })
})

// ─────────────────────────────────────────────────────────────
// DELETE /api/mypage/sessions/:sid_prefix — 특정 세션 종료 (masked prefix 8자로 지정)
//   보안상 전체 세션 id는 클라이언트에 노출하지 않으므로 prefix로 매칭
// ─────────────────────────────────────────────────────────────
mypage.delete('/sessions/:prefix', async (c) => {
  const auth = await requireUser(c)
  if (auth instanceof Response) return auth
  const { userId, sessionId } = auth as any

  const prefix = c.req.param('prefix') || ''
  if (!/^[a-f0-9]{6,16}$/.test(prefix)) {
    return apiError(c, 400, '잘못된 세션 식별자입니다.', ErrorCodes.VALIDATION)
  }
  // 현재 세션은 스스로 종료 못 하게 (logout 엔드포인트 이용)
  if (sessionId.startsWith(prefix)) {
    return apiError(c, 400, '현재 세션은 로그아웃 메뉴에서 종료하세요.', ErrorCodes.VALIDATION)
  }

  const res = await c.env.DB.prepare(
    `DELETE FROM sessions WHERE user_id = ? AND id LIKE ? AND id != ?`
  ).bind(userId, prefix + '%', sessionId).run()

  return c.json({ data: { deleted: res.meta?.changes || 0 } })
})

export default mypage
