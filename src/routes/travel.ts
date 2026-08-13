// ============================================================================
// 출장 거리 정산 (유류비 / 톨게이트비 증빙)
//
// 재무팀 요구사항: "거리 증빙 + 톨게이트 사용 내역"
//   - 거리   : 미팅 기록(방문 병원) → 카카오모빌리티 길찾기 실제 도로 주행거리
//   - 통행료 : 카카오 추정치를 참고값으로 제공. 실제 증빙은 하이패스 내역이 우선이므로
//              travel_logs.toll_amount 에 실제 금액을 직접 입력할 수 있게 했습니다.
//
// ⚠️ 직선거리(하버사인)는 쓰지 않습니다. 재무 증빙 자료로 인정되지 않습니다.
// ============================================================================

import { Hono } from 'hono'
import { safeInt, logActivity } from '../helpers'
import { findRoute, samePoint, toKm, toMin, type NaviPoint } from '../kakao_navi'

type Bindings = { DB: D1Database; KAKAO_REST_API_KEY?: string }
type Variables = { userId: number; user?: { id: number; name: string; email: string } }

const travel = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ── 설정 키 목록 (허용된 키만 저장) ─────────────────────────────────────────
const SETTING_KEYS = [
  'travel_origin_name',
  'travel_origin_address',
  'travel_origin_lat',
  'travel_origin_lng',
  'travel_rate_per_km',
  'travel_settlement_mode',
  'travel_fuel_efficiency',
  'travel_fuel_price',
  'travel_include_return',
] as const

const SETTING_DEFAULTS: Record<string, string> = {
  travel_origin_name: '',
  travel_origin_address: '',
  travel_origin_lat: '',
  travel_origin_lng: '',
  travel_rate_per_km: '0',
  travel_settlement_mode: 'none',
  travel_fuel_efficiency: '12',
  travel_fuel_price: '1700',
  travel_include_return: '1',
}

export type TravelSettings = {
  origin_name: string
  origin_address: string
  origin_lat: number | null
  origin_lng: number | null
  rate_per_km: number
  settlement_mode: 'none' | 'mileage' | 'fuel'
  fuel_efficiency: number
  fuel_price: number
  include_return: boolean
}

export async function loadSettings(db: D1Database): Promise<TravelSettings> {
  let map: Record<string, string> = { ...SETTING_DEFAULTS }
  try {
    const r = await db.prepare('SELECT key, value FROM app_settings').all()
    for (const row of (r.results || []) as any[]) {
      if (row?.key) map[row.key] = row.value ?? ''
    }
  } catch {
    // app_settings 테이블이 아직 없는 환경 → 기본값 사용
  }
  const num = (v: string) => {
    const n = Number(v)
    return isFinite(n) ? n : 0
  }
  const lat = String(map.travel_origin_lat || '').trim()
  const lng = String(map.travel_origin_lng || '').trim()
  const mode = map.travel_settlement_mode
  return {
    origin_name: map.travel_origin_name || '',
    origin_address: map.travel_origin_address || '',
    origin_lat: lat === '' ? null : num(lat),
    origin_lng: lng === '' ? null : num(lng),
    rate_per_km: num(map.travel_rate_per_km),
    settlement_mode: (mode === 'mileage' || mode === 'fuel') ? mode : 'none',
    fuel_efficiency: num(map.travel_fuel_efficiency) || 12,
    fuel_price: num(map.travel_fuel_price) || 0,
    include_return: String(map.travel_include_return) === '1',
  }
}

// ── GET /api/travel/settings ────────────────────────────────────────────────
travel.get('/settings', async (c) => {
  const s = await loadSettings(c.env.DB)
  return c.json({ data: s, kakao_configured: !!c.env.KAKAO_REST_API_KEY })
})

// ── PUT /api/travel/settings ────────────────────────────────────────────────
travel.put('/settings', async (c) => {
  const b = await c.req.json().catch(() => ({} as any))

  // 좌표 검증 — 기관 폼과 동일한 한국 범위 체크
  const hasLat = b.travel_origin_lat !== undefined && String(b.travel_origin_lat).trim() !== ''
  const hasLng = b.travel_origin_lng !== undefined && String(b.travel_origin_lng).trim() !== ''
  if (hasLat !== hasLng) {
    return c.json({ error: '출발지 위도와 경도는 둘 다 입력하거나 둘 다 비워둬야 합니다.', message: '출발지 위도와 경도는 둘 다 입력하거나 둘 다 비워둬야 합니다.' }, 400)
  }
  if (hasLat && hasLng) {
    const lat = Number(b.travel_origin_lat), lng = Number(b.travel_origin_lng)
    if (!isFinite(lat) || !isFinite(lng)) {
      return c.json({ error: '출발지 위도/경도는 숫자로 입력해주세요.', message: '출발지 위도/경도는 숫자로 입력해주세요.' }, 400)
    }
    const inKorea = lat >= 33.0 && lat <= 38.7 && lng >= 124.5 && lng <= 131.9
    if (!inKorea) {
      const swapped = lng >= 33.0 && lng <= 38.7 && lat >= 124.5 && lat <= 131.9
      return c.json({
        error: swapped ? '위도와 경도가 반대로 입력된 것 같습니다.' : '한국 범위를 벗어난 좌표입니다.',
        message: swapped ? '위도와 경도가 반대로 입력된 것 같습니다. (위도 약 33~38.7, 경도 약 124.5~131.9)' : '한국 범위를 벗어난 좌표입니다. (위도 약 33~38.7, 경도 약 124.5~131.9)',
      }, 400)
    }
  }

  const stmts: D1PreparedStatement[] = []
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) continue
    const value = b[key] === null || b[key] === undefined ? '' : String(b[key]).trim()
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`
      ).bind(key, value)
    )
  }
  if (stmts.length > 0) await c.env.DB.batch(stmts)
  await logActivity(c.env.DB, 'update', 'settings', null, '출장 정산 설정', `${stmts.length}개 항목`)
  const s = await loadSettings(c.env.DB)
  return c.json({ data: s })
})

// ── 방문 순서 정렬 키 ───────────────────────────────────────────────────────
// 같은 날 여러 곳을 방문한 경우 오전 → 종일 → 오후 순으로 경로를 만듭니다.
// start_time 이 있으면 그것을 우선 사용합니다.
function visitOrder(m: any): [number, string, number] {
  const vt = String(m.visit_time || '')
  const slot = vt === 'am' ? 0 : (vt === 'full' ? 1 : (vt === 'pm' ? 2 : 1))
  const st = String(m.start_time || '')
  return [slot, st || '99:99', Number(m.id) || 0]
}

function cmpVisit(a: any, b: any): number {
  const [as, at, ai] = visitOrder(a)
  const [bs, bt, bi] = visitOrder(b)
  if (as !== bs) return as - bs
  if (at !== bt) return at < bt ? -1 : 1
  return ai - bi
}

export type DailyStop = {
  hospital_id: number | null
  name: string
  region: string
  address: string
  lat: number | null
  lng: number | null
  /** 출발지(사무실)인지 */
  is_origin?: boolean
  /** 복귀 지점인지 */
  is_return?: boolean
  visit_time?: string
  purpose?: string
  doctors?: string
}

export type DailyRoute = {
  date: string
  user_id: number | null
  user_name: string
  stops: DailyStop[]
  /** 좌표가 없어 경로에서 빠진 기관 이름 */
  missing_coords: string[]
  distance_km: number
  duration_min: number
  toll: number
  legs: { from: string; to: string; distance_km: number; duration_min: number }[]
  /** 계산 실패 시 이유 */
  error?: string
  /** 캐시 사용 여부 */
  cached?: boolean
  /** 사용자 입력 운행기록 */
  log?: any
}

function routeKeyOf(points: NaviPoint[]): string {
  return points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|')
}

/**
 * 기간 내 미팅을 (날짜 × 담당자) 로 묶어 일자별 이동 경로와 실제 주행거리를 계산합니다.
 * 카카오 호출은 travel_route_cache 로 캐시합니다.
 */
export async function buildDailyRoutes(
  db: D1Database,
  apiKey: string | undefined,
  opts: { from?: string; to?: string; userId?: number; noCache?: boolean }
): Promise<{ days: DailyRoute[]; settings: TravelSettings }> {
  const settings = await loadSettings(db)

  const where: string[] = ["m.meeting_type = '방문'"]
  const params: any[] = []
  if (opts.from) { where.push('m.meeting_date >= ?'); params.push(opts.from) }
  if (opts.to) { where.push('m.meeting_date <= ?'); params.push(opts.to) }
  if (opts.userId) { where.push('m.user_id = ?'); params.push(opts.userId) }
  const whereSql = 'WHERE ' + where.join(' AND ')

  const sql = `SELECT m.id, m.meeting_date, m.visit_time, m.start_time, m.end_time, m.purpose,
      m.hospital_id, m.user_id,
      h.name as hospital_name, h.region as hospital_region, h.address as hospital_address,
      h.lat as lat, h.lng as lng,
      u.name as user_name,
      (SELECT GROUP_CONCAT(d.name, ', ') FROM meeting_doctors md
        LEFT JOIN doctors d ON md.doctor_id=d.id WHERE md.meeting_id=m.id) as doctor_names
    FROM meetings m
    LEFT JOIN hospitals h ON m.hospital_id = h.id
    LEFT JOIN users u ON m.user_id = u.id
    ${whereSql}
    ORDER BY m.meeting_date ASC, m.id ASC`
  const r = await db.prepare(sql).bind(...params).all()
  const meetings = (r.results || []) as any[]

  // (날짜, 담당자) 그룹핑
  const groups = new Map<string, any[]>()
  for (const m of meetings) {
    const key = `${m.meeting_date}|${m.user_id ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  // 사용자 입력 운행기록 조회
  let logs: any[] = []
  try {
    const lw: string[] = []
    const lp: any[] = []
    if (opts.from) { lw.push('log_date >= ?'); lp.push(opts.from) }
    if (opts.to) { lw.push('log_date <= ?'); lp.push(opts.to) }
    if (opts.userId) { lw.push('user_id = ?'); lp.push(opts.userId) }
    const lr = await db.prepare(
      `SELECT * FROM travel_logs ${lw.length ? 'WHERE ' + lw.join(' AND ') : ''}`
    ).bind(...lp).all()
    logs = (lr.results || []) as any[]
  } catch { /* 테이블 없음 */ }
  const logMap = new Map<string, any>()
  for (const l of logs) logMap.set(`${l.log_date}|${l.user_id ?? ''}`, l)

  const days: DailyRoute[] = []
  const sortedKeys = Array.from(groups.keys()).sort()

  for (const key of sortedKeys) {
    const list = groups.get(key)!.slice().sort(cmpVisit)
    const first = list[0]
    const date = String(first.meeting_date)

    const missing: string[] = []
    const stops: DailyStop[] = []

    // 출발지(사무실) 설정이 있으면 맨 앞에 붙입니다.
    const hasOrigin = settings.origin_lat !== null && settings.origin_lng !== null
    if (hasOrigin) {
      stops.push({
        hospital_id: null,
        name: settings.origin_name || '출발지',
        region: '',
        address: settings.origin_address,
        lat: settings.origin_lat,
        lng: settings.origin_lng,
        is_origin: true,
      })
    }

    // 같은 날 같은 병원을 연속 방문한 기록은 경로상 한 지점으로 합칩니다.
    for (const m of list) {
      const hasCoord = m.lat !== null && m.lat !== undefined && m.lng !== null && m.lng !== undefined
      if (!hasCoord) {
        if (m.hospital_name && !missing.includes(m.hospital_name)) missing.push(m.hospital_name)
        continue
      }
      const prev = stops[stops.length - 1]
      if (prev && prev.hospital_id === m.hospital_id) {
        // 동일 기관 재방문 → 목적만 합침
        if (m.purpose && prev.purpose !== m.purpose) {
          prev.purpose = [prev.purpose, m.purpose].filter(Boolean).join(' / ')
        }
        continue
      }
      stops.push({
        hospital_id: m.hospital_id,
        name: m.hospital_name || '(기관 미지정)',
        region: m.hospital_region || '',
        address: m.hospital_address || '',
        lat: Number(m.lat),
        lng: Number(m.lng),
        visit_time: m.visit_time || '',
        purpose: m.purpose || '',
        doctors: m.doctor_names || '',
      })
    }

    // 복귀 구간
    if (hasOrigin && settings.include_return && stops.length > 1) {
      stops.push({
        hospital_id: null,
        name: settings.origin_name || '출발지',
        region: '',
        address: settings.origin_address,
        lat: settings.origin_lat,
        lng: settings.origin_lng,
        is_return: true,
      })
    }

    const day: DailyRoute = {
      date,
      user_id: first.user_id ?? null,
      user_name: first.user_name || '',
      stops,
      missing_coords: missing,
      distance_km: 0,
      duration_min: 0,
      toll: 0,
      legs: [],
      log: logMap.get(key) || null,
    }

    // 좌표가 있는 지점이 2곳 미만이면 이동거리 계산 불가
    const points: NaviPoint[] = stops
      .filter(s => s.lat !== null && s.lng !== null)
      .map(s => ({ lat: s.lat as number, lng: s.lng as number, name: s.name }))

    // 인접 중복 좌표 제거 (카카오 result_code 104 방지)
    const dedup: NaviPoint[] = []
    for (const p of points) {
      const last = dedup[dedup.length - 1]
      if (last && samePoint(last, p)) continue
      dedup.push(p)
    }

    if (dedup.length < 2) {
      day.error = missing.length > 0
        ? `좌표가 등록되지 않은 기관이 있어 거리를 계산할 수 없습니다: ${missing.join(', ')}`
        : '이동 구간이 없습니다. (방문 1곳 + 출발지 미설정)'
      days.push(day)
      continue
    }

    const rkey = routeKeyOf(dedup)

    // 캐시 조회
    let cached: any = null
    if (!opts.noCache) {
      try {
        cached = await db.prepare('SELECT * FROM travel_route_cache WHERE route_key = ?').bind(rkey).first()
      } catch { /* 테이블 없음 */ }
    }

    if (cached) {
      day.distance_km = toKm(Number(cached.distance_m))
      day.duration_min = toMin(Number(cached.duration_s))
      day.toll = Number(cached.toll) || 0
      day.cached = true
      try {
        const legs = JSON.parse(String(cached.legs_json || '[]'))
        day.legs = legs.map((l: any) => ({
          from: l.from, to: l.to,
          distance_km: toKm(Number(l.distance) || 0),
          duration_min: toMin(Number(l.duration) || 0),
        }))
      } catch { /* legs 파싱 실패 무시 */ }
      days.push(day)
      continue
    }

    const res = await findRoute(dedup, apiKey || '')
    if (!res.ok) {
      day.error = res.message
      days.push(day)
      continue
    }

    day.distance_km = toKm(res.distance)
    day.duration_min = toMin(res.duration)
    day.toll = res.toll
    day.legs = res.legs.map(l => ({
      from: l.from, to: l.to,
      distance_km: toKm(l.distance),
      duration_min: toMin(l.duration),
    }))

    try {
      await db.prepare(
        `INSERT INTO travel_route_cache (route_key, distance_m, duration_s, toll, legs_json)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(route_key) DO UPDATE SET
           distance_m=excluded.distance_m, duration_s=excluded.duration_s,
           toll=excluded.toll, legs_json=excluded.legs_json`
      ).bind(rkey, res.distance, res.duration, res.toll, JSON.stringify(res.legs)).run()
    } catch { /* 캐시 실패는 무시 */ }

    days.push(day)
  }

  return { days, settings }
}

/** 정산 금액 계산 */
export function settleAmount(distanceKm: number, s: TravelSettings): number {
  if (s.settlement_mode === 'mileage') {
    return Math.round(distanceKm * s.rate_per_km)
  }
  if (s.settlement_mode === 'fuel') {
    const eff = s.fuel_efficiency > 0 ? s.fuel_efficiency : 12
    return Math.round((distanceKm / eff) * s.fuel_price)
  }
  return 0
}

// ── GET /api/travel/daily ───────────────────────────────────────────────────
// 일자별 이동 경로 + 실제 주행거리 (화면 미리보기용)
travel.get('/daily', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const userId = safeInt(c.req.query('user_id'), 0)
  const noCache = c.req.query('refresh') === '1'

  if (!c.env.KAKAO_REST_API_KEY) {
    return c.json({
      error: '카카오 REST API 키가 서버에 설정되지 않았습니다.',
      message: '카카오 REST API 키가 서버에 설정되지 않았습니다. 관리자에게 문의해주세요.',
    }, 503)
  }

  const { days, settings } = await buildDailyRoutes(c.env.DB, c.env.KAKAO_REST_API_KEY, {
    from, to, userId: userId || undefined, noCache,
  })

  const totalKm = Math.round(days.reduce((a, d) => a + d.distance_km, 0) * 10) / 10
  const totalToll = days.reduce((a, d) => a + d.toll, 0)
  const totalAmount = days.reduce((a, d) => a + settleAmount(d.distance_km, settings), 0)

  return c.json({
    data: days.map(d => ({ ...d, amount: settleAmount(d.distance_km, settings) })),
    settings,
    summary: {
      days: days.length,
      total_km: totalKm,
      total_toll: totalToll,
      total_amount: totalAmount,
      failed: days.filter(d => d.error).length,
      missing_coords: Array.from(new Set(days.flatMap(d => d.missing_coords))),
    },
  })
})

// ── GET /api/travel/logs ────────────────────────────────────────────────────
travel.get('/logs', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const where: string[] = []
  const params: any[] = []
  if (from) { where.push('t.log_date >= ?'); params.push(from) }
  if (to) { where.push('t.log_date <= ?'); params.push(to) }
  const r = await c.env.DB.prepare(
    `SELECT t.*, u.name as user_name FROM travel_logs t LEFT JOIN users u ON t.user_id=u.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.log_date DESC`
  ).bind(...params).all()
  return c.json({ data: r.results || [] })
})

// ── PUT /api/travel/logs ────────────────────────────────────────────────────
// 계기판 누적거리·실제 통행료·주유금액 등 API 로 알 수 없는 값 입력 (upsert)
travel.put('/logs', async (c) => {
  const b = await c.req.json().catch(() => ({} as any))
  const logDate = String(b.log_date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    return c.json({ error: '사용일자를 YYYY-MM-DD 형식으로 입력해주세요.', message: '사용일자를 YYYY-MM-DD 형식으로 입력해주세요.' }, 400)
  }
  const userId = b.user_id ? Number(b.user_id) : (c.get('userId') || null)

  const intOrNull = (v: any) => {
    if (v === undefined || v === null || String(v).trim() === '') return null
    const n = Number(v)
    return isFinite(n) ? Math.round(n) : null
  }
  const odoStart = intOrNull(b.odo_start)
  const odoEnd = intOrNull(b.odo_end)
  if (odoStart !== null && odoEnd !== null && odoEnd < odoStart) {
    return c.json({ error: '주행 후 계기판 값이 주행 전보다 작습니다.', message: '주행 후 계기판 값이 주행 전보다 작습니다.' }, 400)
  }

  await c.env.DB.prepare(
    `INSERT INTO travel_logs (log_date, user_id, vehicle_model, vehicle_plate, odo_start, odo_end, toll_amount, fuel_amount, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(log_date, user_id) DO UPDATE SET
       vehicle_model=excluded.vehicle_model, vehicle_plate=excluded.vehicle_plate,
       odo_start=excluded.odo_start, odo_end=excluded.odo_end,
       toll_amount=excluded.toll_amount, fuel_amount=excluded.fuel_amount,
       note=excluded.note, updated_at=CURRENT_TIMESTAMP`
  ).bind(
    logDate, userId,
    b.vehicle_model || '', b.vehicle_plate || '',
    odoStart, odoEnd,
    intOrNull(b.toll_amount), intOrNull(b.fuel_amount),
    b.note || ''
  ).run()

  const row = await c.env.DB.prepare(
    'SELECT * FROM travel_logs WHERE log_date=? AND user_id IS ?'
  ).bind(logDate, userId).first()
  return c.json({ data: row })
})

// ── POST /api/travel/route ──────────────────────────────────────────────────
// 임의의 기관 ID 목록으로 경로 거리 계산 (일정 플래너 등에서 사용)
travel.post('/route', async (c) => {
  if (!c.env.KAKAO_REST_API_KEY) {
    return c.json({ error: '카카오 REST API 키가 설정되지 않았습니다.', message: '카카오 REST API 키가 설정되지 않았습니다.' }, 503)
  }
  const b = await c.req.json().catch(() => ({} as any))
  const ids: number[] = Array.isArray(b.hospital_ids) ? b.hospital_ids.map((x: any) => Number(x)).filter((x: number) => x > 0) : []
  if (ids.length < 1) {
    return c.json({ error: '기관을 1곳 이상 선택해주세요.', message: '기관을 1곳 이상 선택해주세요.' }, 400)
  }
  // 카카오 경유지 상한 (출발지/복귀 포함 32지점)
  if (ids.length > 28) {
    return c.json({ error: '한 번에 계산할 수 있는 기관은 28곳까지입니다.', message: '한 번에 계산할 수 있는 기관은 28곳까지입니다.' }, 400)
  }

  const settings = await loadSettings(c.env.DB)
  // ids 개수가 28 이하로 제한되어 있어 IN 절 변수 상한(100)에 안전합니다.
  const ph = ids.map(() => '?').join(',')
  const r = await c.env.DB.prepare(
    `SELECT id, name, region, address, lat, lng FROM hospitals WHERE id IN (${ph})`
  ).bind(...ids).all()
  const byId = new Map<number, any>()
  for (const h of (r.results || []) as any[]) byId.set(Number(h.id), h)

  const missing: string[] = []
  const stops: DailyStop[] = []
  const hasOrigin = settings.origin_lat !== null && settings.origin_lng !== null
  if (hasOrigin) {
    stops.push({
      hospital_id: null, name: settings.origin_name || '출발지', region: '',
      address: settings.origin_address, lat: settings.origin_lat, lng: settings.origin_lng, is_origin: true,
    })
  }
  for (const id of ids) {
    const h = byId.get(id)
    if (!h) continue
    if (h.lat === null || h.lng === null) { missing.push(h.name); continue }
    stops.push({
      hospital_id: Number(h.id), name: h.name, region: h.region || '',
      address: h.address || '', lat: Number(h.lat), lng: Number(h.lng),
    })
  }
  if (hasOrigin && settings.include_return && stops.length > 1) {
    stops.push({
      hospital_id: null, name: settings.origin_name || '출발지', region: '',
      address: settings.origin_address, lat: settings.origin_lat, lng: settings.origin_lng, is_return: true,
    })
  }

  const points: NaviPoint[] = []
  for (const s of stops) {
    if (s.lat === null || s.lng === null) continue
    const p = { lat: s.lat, lng: s.lng, name: s.name }
    const last = points[points.length - 1]
    if (last && samePoint(last, p)) continue
    points.push(p)
  }
  if (points.length < 2) {
    return c.json({
      error: '경로를 계산할 지점이 부족합니다.',
      message: missing.length ? `좌표가 없는 기관: ${missing.join(', ')}` : '경로를 계산할 지점이 부족합니다.',
      missing_coords: missing,
    }, 400)
  }

  const res = await findRoute(points, c.env.KAKAO_REST_API_KEY)
  if (!res.ok) return c.json({ error: res.message, message: res.message, code: res.code }, 502)

  const distanceKm = toKm(res.distance)
  return c.json({
    data: {
      stops,
      missing_coords: missing,
      distance_km: distanceKm,
      duration_min: toMin(res.duration),
      toll: res.toll,
      amount: settleAmount(distanceKm, settings),
      legs: res.legs.map(l => ({
        from: l.from, to: l.to,
        distance_km: toKm(l.distance), duration_min: toMin(l.duration),
      })),
    },
    settings,
  })
})

export default travel
