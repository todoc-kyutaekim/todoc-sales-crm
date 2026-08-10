// Activity log helper
export async function logActivity(db: D1Database, action: string, entityType: string, entityId: number | null, entityName: string, details: string = '') {
  try {
    await db.prepare('INSERT INTO activity_log (action, entity_type, entity_id, entity_name, details) VALUES (?,?,?,?,?)')
      .bind(action, entityType, entityId, entityName, details).run()
  } catch (e) { /* ignore logging errors */ }
}

// Sanitize integer param
export function safeInt(v: string | undefined | null, fallback: number = 0): number {
  if (!v) return fallback
  const n = parseInt(v, 10)
  return isNaN(n) ? fallback : n
}

// Sanitize limit
export function safeLimit(v: string | undefined | null, max: number = 100): number {
  const n = safeInt(v, max)
  return Math.min(Math.max(n, 1), max)
}

// Strip dangerous characters for LIKE queries
export function safeLike(v: string): string {
  return v.replace(/[%_]/g, '')
}

// Standardized API error response
export function apiError(c: any, statusCode: number, message: string, code: string) {
  return c.json({ error: message, code }, statusCode)
}

// ============================================================
// ⚠️⚠️ D1 SQL 변수 개수 상한 — `IN (?,?,?...)` 을 직접 만들지 마세요
//
// Cloudflare D1(SQLite)은 한 문장에 바인딩할 수 있는 변수 개수가 제한됩니다.
// 실측 결과 **ID 100개까지는 성공, 101개부터 실패**했습니다:
//   D1_ERROR: too many SQL variables at offset 425: SQLITE_ERROR
//
// 실제 사고: 미팅이 101건이 되는 순간 GET /api/meetings 가 500 으로 죽었습니다.
//   `WHERE mu.meeting_id IN (${meetingIds.map(()=>'?').join(',')})`
// 처럼 행 수만큼 placeholder 를 만드는 코드는 **데이터가 늘면 반드시 터지는 시한폭탄**입니다.
// 개발 초기에는 데이터가 적어 정상 동작하므로 테스트로 잡히지 않습니다.
//
// 그래서 ID 목록으로 조회할 때는 아래 두 헬퍼만 사용하세요.
//   - chunk(ids, 90)      : 목록을 안전한 크기로 분할
//   - queryByIds(...)     : 분할 + 병렬 질의 + 결과 병합까지 처리
//
// 주의: 다른 바인딩 파라미터(예: set_id != ?)가 함께 있으면 그만큼 여유가 줄어듭니다.
//       CHUNK 기본값 90 은 그런 여유분을 감안한 값입니다.
// ============================================================

/** IN 절에 한 번에 넣을 최대 ID 개수 (실측 상한 100 보다 낮게 잡은 안전값) */
export const SQL_VARS_CHUNK = 90

/** 배열을 size 개씩 잘라 2차원 배열로 반환 */
export function chunk<T>(arr: T[], size: number = SQL_VARS_CHUNK): T[][] {
  if (size < 1) size = 1
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * ID 목록으로 안전하게 조회합니다. ID 개수에 상관없이 동작합니다.
 *
 * @param db      D1 Database
 * @param sqlFor  placeholder 문자열을 받아 SQL 을 만드는 함수
 *                예: ph => `SELECT * FROM t WHERE id IN (${ph})`
 * @param ids     조회할 ID 목록 (빈 배열이면 질의하지 않고 [] 반환)
 * @param extra   IN 절 뒤에 오는 추가 바인딩 값들 (SQL 의 ? 순서와 일치해야 함)
 * @param size    청크 크기 (기본 SQL_VARS_CHUNK)
 */
export async function queryByIds<T = any>(
  db: D1Database,
  sqlFor: (placeholders: string) => string,
  ids: (number | string)[],
  extra: any[] = [],
  size: number = SQL_VARS_CHUNK
): Promise<T[]> {
  if (!ids || ids.length === 0) return []
  const groups = chunk(ids, size)
  const results = await Promise.all(
    groups.map(g => {
      const ph = g.map(() => '?').join(',')
      return db.prepare(sqlFor(ph)).bind(...g, ...extra).all()
    })
  )
  const out: T[] = []
  for (const r of results) for (const row of (r.results as any[]) || []) out.push(row as T)
  return out
}

// Common error codes
export const ErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL_ERROR',
  AI_ERROR: 'AI_ERROR',
  EXTERNAL_API: 'EXTERNAL_API_ERROR',
} as const
