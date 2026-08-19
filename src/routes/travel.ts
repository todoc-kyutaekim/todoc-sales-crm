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
import {
  findRoute, samePoint, toKm, toMin, normalizeFuel, normalizePriority, isElectric,
  CAR_FUEL_LABEL, ROUTE_PRIORITY_LABEL, ROUTE_PRIORITIES, CAR_FUELS,
  type NaviPoint, type CarFuel, type RoutePriority,
} from '../kakao_navi'

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

// ============================================================================
// 사용자별 차량 정보 (마이페이지에서 입력)
//
// 차량 형태·km당 단가는 사람마다 다를 수 있어 users 테이블에 개인값을 두고,
// 비어 있으면 전역 설정(app_settings)을 기본값으로 씁니다.
// ============================================================================

export type VehicleType = '' | 'corporate' | 'private_allowance' | 'private_actual'

export const VEHICLE_TYPE_LABEL: Record<string, string> = {
  '': '미설정',
  corporate: '법인차량',
  private_allowance: '개인차량 + 자가운전보조금(월 20만원)',
  private_actual: '개인차량 + 실비 정산',
}

export type UserVehicle = {
  /** 소속 부서 — 재무팀 제출 양식 머리글에 표기합니다. */
  department?: string
  vehicle_type: VehicleType
  vehicle_model: string
  vehicle_plate: string
  rate_per_km: number | null
  fuel_efficiency: number | null
  fuel_price: number | null
  /**
   * 연료 종류 — 통행료 산출(카카오 car_fuel)에 사용합니다.
   * 전기차는 고속도로 통행료 감면이 적용되어 기름차보다 통행료가 낮습니다.
   * 또한 전기차는 fuel_efficiency 를 km/kWh(전비), fuel_price 를 원/kWh 로 해석합니다.
   */
  fuel: CarFuel
}

const EMPTY_VEHICLE: UserVehicle = {
  vehicle_type: '', vehicle_model: '', vehicle_plate: '',
  rate_per_km: null, fuel_efficiency: null, fuel_price: null,
  fuel: 'GASOLINE',
}

/** users 테이블에서 차량 정보를 읽습니다. 컬럼이 없는 환경에서도 죽지 않습니다. */
export async function loadVehicles(db: D1Database, userIds: number[]): Promise<Map<number, UserVehicle>> {
  const map = new Map<number, UserVehicle>()
  const ids = userIds.filter(x => Number.isFinite(x) && x > 0)
  if (ids.length === 0) return map
  // 담당자 수는 조직 인원 수준이라 IN 절 변수 상한(100)에 안전하지만,
  // 만약을 위해 90개씩 나눠 조회합니다.
  const num = (v: any) => (v === null || v === undefined || v === '' ? null : (isFinite(Number(v)) ? Number(v) : null))
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90)
    const ph = part.map(() => '?').join(',')
    try {
      const r = await db.prepare(
        `SELECT id, department, vehicle_type, vehicle_model, vehicle_plate,
                travel_rate_per_km, vehicle_fuel_efficiency, vehicle_fuel_price,
                vehicle_fuel
         FROM users WHERE id IN (${ph})`
      ).bind(...part).all()
      for (const row of (r.results || []) as any[]) {
        map.set(Number(row.id), {
          department: row.department || '',
          vehicle_type: (row.vehicle_type || '') as VehicleType,
          vehicle_model: row.vehicle_model || '',
          vehicle_plate: row.vehicle_plate || '',
          rate_per_km: num(row.travel_rate_per_km),
          fuel_efficiency: num(row.vehicle_fuel_efficiency),
          fuel_price: num(row.vehicle_fuel_price),
          fuel: normalizeFuel(row.vehicle_fuel),
        })
      }
    } catch {
      // 마이그레이션 0045/0047 미적용 환경 → 전역 설정만 사용
    }
  }
  return map
}

/**
 * 차량 형태에 따라 실제 적용할 정산 규칙을 결정합니다.
 *
 * ⚠️ 세무 주의 (private_allowance):
 *    자가운전보조금 월 20만원은 비과세지만, 여기에 유류비·통행료를 실비로 **함께**
 *    지급하면 그 20만원이 과세 대상으로 전환됩니다.
 *    그래서 이 형태는 금액을 산출하지 않고 '거리 증빙만' 으로 고정하고 경고를 남깁니다.
 *    (실비를 따로 받기로 회사가 정했다면 형태를 private_actual 로 바꿔야 합니다.)
 */
export function resolveSettlement(v: UserVehicle, g: TravelSettings): {
  mode: 'none' | 'mileage' | 'fuel'
  rate_per_km: number
  fuel_efficiency: number
  fuel_price: number
  label: string
  warning: string
} {
  const rate = v.rate_per_km !== null ? v.rate_per_km : g.rate_per_km
  const eff = v.fuel_efficiency !== null ? v.fuel_efficiency : g.fuel_efficiency
  const price = v.fuel_price !== null ? v.fuel_price : g.fuel_price

  if (v.vehicle_type === 'corporate') {
    return {
      mode: 'none', rate_per_km: rate, fuel_efficiency: eff, fuel_price: price,
      label: '법인차량 — 거리 증빙만 (업무용승용차 운행기록부)',
      warning: '',
    }
  }
  if (v.vehicle_type === 'private_allowance') {
    return {
      mode: 'none', rate_per_km: rate, fuel_efficiency: eff, fuel_price: price,
      label: '개인차량 + 자가운전보조금 — 거리 증빙만 (금액 미산출)',
      warning: '자가운전보조금(월 20만원 비과세)을 받는 경우 유류비·통행료를 실비로 함께 지급하면 20만원이 과세 대상으로 전환됩니다. 실비를 별도 지급받는 규정이라면 차량 형태를 "개인차량 + 실비 정산"으로 변경해주세요.',
    }
  }
  // 전기차는 같은 숫자를 리터가 아닌 kWh 로 해석합니다.
  // (전비 km/kWh · 전기요금 원/kWh) — 계산식은 동일하고 표기 단위만 달라집니다.
  const ev = isElectric(v.fuel)
  const effUnit = ev ? 'km/kWh' : 'km/L'
  const priceUnit = ev ? '원/kWh' : '원/L'
  const effName = ev ? '전비' : '연비'
  const costName = ev ? '충전요금' : '유류비'

  if (v.vehicle_type === 'private_actual') {
    // 단가가 정해져 있으면 km 단가 정산, 없으면 연비 기준 유류비
    if (rate > 0) {
      return {
        mode: 'mileage', rate_per_km: rate, fuel_efficiency: eff, fuel_price: price,
        label: `개인차량 실비 — km 단가 정산 (${rate.toLocaleString()}원/km)`,
        warning: '',
      }
    }
    return {
      mode: 'fuel', rate_per_km: rate, fuel_efficiency: eff, fuel_price: price,
      label: `개인차량 실비 — ${effName} 기준 ${costName} (${effName} ${eff}${effUnit}, ${price.toLocaleString()}${priceUnit})`,
      warning: '',
    }
  }

  // 미설정 → 전역 설정을 그대로 따릅니다.
  const gLabel = g.settlement_mode === 'mileage'
    ? `km 단가 정산 (${rate.toLocaleString()}원/km)`
    : (g.settlement_mode === 'fuel'
      ? `실비 정산 (${effName} ${eff}${effUnit}, ${price.toLocaleString()}${priceUnit})`
      : '거리 증빙만 (금액 미산출)')
  return {
    mode: g.settlement_mode, rate_per_km: rate, fuel_efficiency: eff, fuel_price: price,
    label: gLabel,
    warning: '차량 형태가 설정되지 않았습니다. 마이페이지에서 차량 정보를 입력하면 정산 방식이 자동으로 적용됩니다.',
  }
}

// ── GET /api/travel/settings ────────────────────────────────────────────────
travel.get('/settings', async (c) => {
  const s = await loadSettings(c.env.DB)
  const userId = c.get('userId')
  const vmap = await loadVehicles(c.env.DB, [Number(userId)])
  const vehicle = vmap.get(Number(userId)) || { ...EMPTY_VEHICLE }
  const resolved = resolveSettlement(vehicle, s)
  const places = await loadPlaces(c.env.DB, [Number(userId)])
  return c.json({
    data: s,
    vehicle,
    resolved,
    places,
    place_type_labels: PLACE_TYPE_LABEL,
    my_user_id: Number(userId),
    vehicle_type_labels: VEHICLE_TYPE_LABEL,
    car_fuel_labels: CAR_FUEL_LABEL,
    kakao_configured: !!c.env.KAKAO_REST_API_KEY,
  })
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
  /** 출발지(집/사무실)인지 */
  is_origin?: boolean
  /** 복귀 지점인지 */
  is_return?: boolean
  /** 출발지/복귀지로 쓰인 travel_places.id (전역 설정 사용 시 null) */
  place_id?: number | null
  /** home | office | other */
  place_type?: string
  /**
   * 그 날만 쓴 임시 장소(숙소 등)인지.
   *
   * 장소 목록에 등록하지 않고 그 날 기록에만 주소·좌표를 남긴 경우 true 입니다.
   * 재무팀이 자택 출발(출퇴근)과 숙소 출발(출장)을 구분할 수 있게 보고서에 표시합니다.
   */
  is_temp?: boolean
  visit_time?: string
  purpose?: string
  doctors?: string
}

// ============================================================================
// 자주 쓰는 장소 (집 / 사무실 / 기타)
//
// 출발지가 집인 날도 사무실인 날도 있고, 복귀지도 매번 달라집니다.
// 그래서 장소를 미리 등록해두고 일자별로 골라 쓰는 구조로 만들었습니다.
//   - travel_places            : 장소 목록 (담당자별, user_id NULL = 전사 공용)
//   - travel_logs.origin_place_id / return_place_id : 그 날 실제로 쓴 장소
// ============================================================================

export const PLACE_TYPE_LABEL: Record<string, string> = {
  home: '집',
  office: '사무실',
  other: '기타',
}

export type TravelPlace = {
  id: number
  user_id: number | null
  name: string
  place_type: string
  address: string
  lat: number | null
  lng: number | null
  is_default_origin: boolean
  is_default_return: boolean
  sort_order: number
}

function rowToPlace(r: any): TravelPlace {
  return {
    id: Number(r.id),
    user_id: r.user_id === null || r.user_id === undefined ? null : Number(r.user_id),
    name: String(r.name || ''),
    place_type: String(r.place_type || 'other'),
    address: String(r.address || ''),
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    lng: r.lng === null || r.lng === undefined ? null : Number(r.lng),
    is_default_origin: Number(r.is_default_origin) === 1,
    is_default_return: Number(r.is_default_return) === 1,
    sort_order: Number(r.sort_order) || 0,
  }
}

/**
 * 장소 목록을 읽습니다.
 * 담당자 본인 장소 + 전사 공용(user_id IS NULL) 장소를 함께 돌려줍니다.
 * 테이블이 없는 환경(마이그레이션 미적용)에서도 죽지 않습니다.
 */
export async function loadPlaces(db: D1Database, userIds: number[]): Promise<TravelPlace[]> {
  const ids = Array.from(new Set(userIds.filter(x => x > 0)))
  try {
    // 담당자 수는 조직 규모상 소수라 변수 상한(100)에 안전하지만 방어적으로 잘라둡니다.
    const capped = ids.slice(0, 80)
    const ph = capped.map(() => '?').join(',')
    const cond = capped.length ? `user_id IS NULL OR user_id IN (${ph})` : 'user_id IS NULL'
    const r = await db.prepare(
      `SELECT * FROM travel_places WHERE ${cond} ORDER BY sort_order ASC, id ASC`
    ).bind(...capped).all()
    return ((r.results || []) as any[]).map(rowToPlace)
  } catch {
    return []
  }
}

/**
 * 그 날 기록에 직접 적어 넣은 임시 장소(숙소 등)를 꺼냅니다.
 *
 * 좌표가 없으면 경로를 계산할 수 없으므로 없는 것으로 봅니다
 * (그 경우 아래 우선순위 1) 이하가 적용됩니다).
 */
function tempStop(log: any, kind: 'origin' | 'return'): DailyStop | null {
  if (!log) return null
  const lat = Number(log[`${kind}_temp_lat`])
  const lng = Number(log[`${kind}_temp_lng`])
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (log[`${kind}_temp_lat`] === null || log[`${kind}_temp_lng`] === null) return null
  const address = String(log[`${kind}_temp_address`] || '')
  return {
    hospital_id: null,
    name: String(log[`${kind}_temp_name`] || '') || (kind === 'origin' ? '출발지(임시)' : '복귀지(임시)'),
    region: '',
    address,
    lat,
    lng,
    place_id: null,
    place_type: 'other',
    is_temp: true,
    ...(kind === 'origin' ? { is_origin: true } : { is_return: true }),
  }
}

/**
 * 그 날 담당자가 쓸 출발지/복귀지를 결정합니다.
 *
 * 우선순위
 *   0) 그 날 기록에 직접 적은 임시 장소 (숙소 등 — 좌표가 있을 때만)
 *   1) travel_logs 에 그 날 명시적으로 지정한 장소 (0 = "없음"을 고른 것도 존중)
 *   2) 담당자 본인 장소 중 기본값 플래그
 *   3) 전사 공용 장소 중 기본값 플래그
 *   4) 전역 설정(travel_origin_*) — 기존 동작 유지
 */
export function resolveEndpoints(
  places: TravelPlace[],
  userId: number | null,
  log: any,
  settings: TravelSettings
): { origin: DailyStop | null; ret: DailyStop | null } {
  const byId = new Map<number, TravelPlace>()
  for (const p of places) byId.set(p.id, p)

  const mine = places.filter(p => p.user_id !== null && Number(p.user_id) === Number(userId))
  const shared = places.filter(p => p.user_id === null)

  const toStop = (p: TravelPlace, kind: 'origin' | 'return'): DailyStop => ({
    hospital_id: null,
    name: p.name || (kind === 'origin' ? '출발지' : '복귀지'),
    region: '',
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    place_id: p.id,
    place_type: p.place_type,
    ...(kind === 'origin' ? { is_origin: true } : { is_return: true }),
  })

  const globalStop = (kind: 'origin' | 'return'): DailyStop | null => {
    if (settings.origin_lat === null || settings.origin_lng === null) return null
    return {
      hospital_id: null,
      name: settings.origin_name || (kind === 'origin' ? '출발지' : '복귀지'),
      region: '',
      address: settings.origin_address,
      lat: settings.origin_lat,
      lng: settings.origin_lng,
      place_id: null,
      place_type: 'office',
      ...(kind === 'origin' ? { is_origin: true } : { is_return: true }),
    }
  }

  const pick = (
    explicit: any,
    defaultFlag: (p: TravelPlace) => boolean,
    kind: 'origin' | 'return'
  ): DailyStop | null => {
    // 1) 그 날 명시 지정
    if (explicit !== null && explicit !== undefined && String(explicit) !== '') {
      const n = Number(explicit)
      if (n === 0) return null            // "없음"을 명시적으로 선택
      const p = byId.get(n)
      if (p && p.lat !== null && p.lng !== null) return toStop(p, kind)
      // 좌표 없는 장소를 지정한 경우는 경로에 넣을 수 없어 기본값으로 폴백합니다.
    }
    // 2) 본인 기본값 → 3) 공용 기본값
    const mineDefault = mine.find(p => defaultFlag(p) && p.lat !== null && p.lng !== null)
    if (mineDefault) return toStop(mineDefault, kind)
    const sharedDefault = shared.find(p => defaultFlag(p) && p.lat !== null && p.lng !== null)
    if (sharedDefault) return toStop(sharedDefault, kind)
    // 4) 전역 설정
    return globalStop(kind)
  }

  // 0) 그 날만 쓴 임시 장소(숙소 등)가 있으면 무엇보다 먼저 씁니다.
  const tempOrigin = tempStop(log, 'origin')
  const tempReturn = tempStop(log, 'return')

  const origin = tempOrigin || pick(log?.origin_place_id, p => p.is_default_origin, 'origin')

  // 복귀지: 그 날 지정값이 없으면 기본 복귀지 → (없으면) include_return 설정에 따라 출발지로 복귀
  let ret: DailyStop | null = null
  const hasExplicitReturn = log?.return_place_id !== null && log?.return_place_id !== undefined
    && String(log?.return_place_id) !== ''
  if (tempReturn) {
    ret = tempReturn
  } else if (hasExplicitReturn) {
    ret = pick(log.return_place_id, p => p.is_default_return, 'return')
  } else {
    const mineDefault = mine.find(p => p.is_default_return && p.lat !== null && p.lng !== null)
    const sharedDefault = shared.find(p => p.is_default_return && p.lat !== null && p.lng !== null)
    if (mineDefault) ret = toStop(mineDefault, 'return')
    else if (sharedDefault) ret = toStop(sharedDefault, 'return')
    else if (settings.include_return && origin) {
      // 기존 동작: 출발지로 되돌아옴
      ret = { ...origin, is_origin: false, is_return: true }
    }
  }
  return { origin, ret }
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
  /** 이 담당자에게 적용된 정산 규칙 (차량 형태 기반) */
  rule?: ReturnType<typeof resolveSettlement>
  /** 담당자 차량 정보 */
  vehicle?: UserVehicle

  // ── 산출 조건 (화면·보고서에 "어떤 기준으로 나온 수치인가" 를 밝힐 때 사용) ──────
  /** 통행료 산출에 사용한 연료 종류 */
  fuel?: CarFuel
  fuel_label?: string
  /** 적용된 경로 방식 */
  route_priority?: RoutePriority
  route_priority_label?: string
  /** 사용자가 지도에서 찍은 보정 경유지 */
  route_waypoints?: { lat: number; lng: number; name?: string }[]
  /** 지도 표시용 경로 형상 [[lat,lng], ...] — 거리 계산에 사용 금지(간소화됨) */
  polyline?: [number, number][]
  /** 경로가 지나간 주요 도로명 */
  road_names?: string[]
}

/** travel_logs.route_waypoints_json 파싱 — 오염된 값은 조용하게 무시합니다. */
export function parseWaypoints(raw: any): { lat: number; lng: number; name?: string }[] {
  if (!raw) return []
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return []
    const out: { lat: number; lng: number; name?: string }[] = []
    for (const w of arr) {
      const lat = Number(w?.lat)
      const lng = Number(w?.lng)
      // 대한민국 서비스 범위 밖 좌표는 카카오가 code 107 로 거부하므로 여기서 걸러냅니다.
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (lat < 33 || lat > 39 || lng < 124 || lng > 132) continue
      out.push({ lat, lng, name: String(w?.name || '경유지').slice(0, 40) })
      if (out.length >= 25) break // 카카오 경유지 30개 제한 — 방문지 분량을 남김
    }
    return out
  } catch {
    return []
  }
}

/** 단순 하버사인 거리 (m) — 경유지 삽입 지점을 고를 때만 사용합니다.
 *  ⚠️ 증빙 거리는 여전히 카카오 실주행거리만 사용합니다. */
function roughMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const mLat = (a.lat + b.lat) / 2 * Math.PI / 180
  const x = dLng * Math.cos(mLat)
  return Math.sqrt(dLat * dLat + x * x) * R
}

/**
 * 보정 경유지를 방문 경로에 끼워 넣습니다.
 *
 * 사용자가 지도에서 찍은 지점은 "방문지"가 아니라 "지나간 지점"이므로,
 * 어떤 구간 사이에 넣을지 정해줘야 합니다. 그냥 맨 뒤에 붙이면
 * "기관A → 복귀 → 경유지" 가 되어 거리가 크게 부풀려집니다.
 *
 * 전략: 경유지마다 "이 지점을 사이에 넣었을 때 우회 거리가 가장 적게 늘는 구간"
 *       을 고릅니다(하버사인 기준). 증빙 거리가 아니라 삽입 위치 선정에만 쓰므로
 *       직선거리 근사로 충분합니다. 동일 구간에 여러 개가 들어가도 사용자가
 *       찍은 순서(배열 순서)를 그대로 지킵니다.
 */
export function insertWaypoints(
  points: NaviPoint[],
  waypoints: { lat: number; lng: number; name?: string }[],
): NaviPoint[] {
  if (!waypoints || waypoints.length === 0) return points
  if (points.length < 2) return points
  const out: NaviPoint[] = points.slice()
  for (const w of waypoints) {
    const wp: NaviPoint = { lat: w.lat, lng: w.lng, name: w.name || '경유지' }
    let bestAt = out.length - 1 // 기본: 마지막 구간
    let bestCost = Infinity
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i]
      const b = out[i + 1]
      // a→w→b 로 돌렸을 때 추가로 늘어나는 거리
      const detour = roughMeters(a, wp) + roughMeters(wp, b) - roughMeters(a, b)
      if (detour < bestCost) { bestCost = detour; bestAt = i + 1 }
    }
    out.splice(bestAt, 0, wp)
  }
  return out
}

/**
 * 경로 캐시 키.
 *
 * 🔴 옵션을 반드시 키에 포함시켜야 합니다.
 *    예전엔 좌표만으로 키를 만들어서, 연료 종류나 경로 방식을 바꿔도 낡은 캐시가
 *    그대로 반환되어 통행료·거리가 전혀 갱신되지 않았습니다.
 *    (전기차 감면은 거리가 같아도 금액이 달라지므로 특히 중요합니다.)
 *    기존 키로 생성된 행은 새 키와 맞지 않으므로 자연스럽게 폐기·재조회됩니다.
 */
function routeKeyOf(points: NaviPoint[], fuel: CarFuel, priority: RoutePriority): string {
  const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join('|')
  return `${coords}#${fuel}#${priority}`
}

/**
 * 기간 내 미팅을 (날짜 × 담당자) 로 묶어 일자별 이동 경로와 실제 주행거리를 계산합니다.
 * 카카오 호출은 travel_route_cache 로 캐시합니다.
 */
export async function buildDailyRoutes(
  db: D1Database,
  apiKey: string | undefined,
  opts: {
    from?: string; to?: string; userId?: number; noCache?: boolean
    /** 지도 표시용 경로 형상을 함께 반환할지 (지도 모달에서만 true) */
    withPolyline?: boolean
    /**
     * 저장하지 않고 미리 계산해 볼 때 쓰는 임시 조건.
     * 키는 `날짜|담당자ID` (담당자 미지정은 빈 문자열).
     * 지도 모달에서 경유지를 찍는 중에는 아직 저장 전이므로,
     * travel_logs 의 값 대신 이 값을 써서 거리·통행료를 계산합니다.
     */
    overrides?: Map<string, { route_priority?: any; route_waypoints?: any }>
  }
): Promise<{ days: DailyRoute[]; settings: TravelSettings }> {
  const settings = await loadSettings(db)

  // 미팅 유형 '방문'만 집계합니다.
  // DB 에는 영문 코드('visit')로 저장되며, 과거 한글로 입력된 레코드도 함께 허용합니다.
  const where: string[] = ["m.meeting_type IN ('visit', '방문')"]
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

  // 담당자별 차량 정보 (마이페이지 입력값) — 정산 방식·단가가 사람마다 다를 수 있음
  const userIds = Array.from(new Set(meetings.map(m => Number(m.user_id)).filter(x => x > 0)))
  const vehicleMap = await loadVehicles(db, userIds)

  // 출발지/복귀지 후보 장소 (담당자별 집·사무실 + 전사 공용)
  const places = await loadPlaces(db, userIds)

  const days: DailyRoute[] = []
  const sortedKeys = Array.from(groups.keys()).sort()

  for (const key of sortedKeys) {
    const list = groups.get(key)!.slice().sort(cmpVisit)
    const first = list[0]
    const date = String(first.meeting_date)

    const missing: string[] = []
    const stops: DailyStop[] = []

    // 출발지 / 복귀지는 날마다 다릅니다 (집 → 병원 → 사무실 등).
    // 그 날 지정값 → 담당자 기본값 → 공용 기본값 → 전역 설정 순으로 결정합니다.
    const dayLog = logMap.get(key) || null
    const { origin, ret } = resolveEndpoints(places, first.user_id ?? null, dayLog, settings)
    if (origin) stops.push({ ...origin })

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

    // 복귀 구간 — 출발지와 다른 곳일 수 있습니다 (집에서 출발 → 사무실 복귀 등).
    // 방문지가 하나도 없으면 출발↔복귀만 남아 의미가 없으므로 붙이지 않습니다.
    const hasVisit = stops.some(s => !s.is_origin && !s.is_return)
    if (ret && hasVisit) stops.push({ ...ret })

    const vehicle = vehicleMap.get(Number(first.user_id)) || { ...EMPTY_VEHICLE }
    const log = logMap.get(key) || null

    // 산출 조건 — 연료는 담당자 차량에서, 경로 방식·보정 경유지는 그 날 운행기록에서 가져옵니다.
    // 미리보기 요청이면 저장값 대신 넘겨받은 임시 조건을 씁니다.
    const ov = opts.overrides?.get(key)
    const fuel = normalizeFuel(vehicle.fuel)
    const priority = normalizePriority(
      ov && ov.route_priority !== undefined ? ov.route_priority : (log as any)?.route_priority
    )
    const extraWaypoints = ov && ov.route_waypoints !== undefined
      ? parseWaypoints(ov.route_waypoints)
      : parseWaypoints((log as any)?.route_waypoints_json)

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
      log,
      vehicle,
      rule: resolveSettlement(vehicle, settings),
      fuel,
      fuel_label: CAR_FUEL_LABEL[fuel],
      route_priority: priority,
      route_priority_label: ROUTE_PRIORITY_LABEL[priority],
      route_waypoints: extraWaypoints,
    }

    // 좌표가 있는 지점이 2곳 미만이면 이동거리 계산 불가
    const points: NaviPoint[] = stops
      .filter(s => s.lat !== null && s.lng !== null)
      .map(s => ({ lat: s.lat as number, lng: s.lng as number, name: s.name }))

    // 보정 경유지 삽입 — 추천도 최단거리도 아닌 실제 동선(정체 때문에 탄 국도 등)을 재현합니다.
    const withWaypoints = insertWaypoints(points, extraWaypoints)

    // 인접 중복 좌표 제거 (카카오 result_code 104 방지)
    const dedup: NaviPoint[] = []
    for (const p of withWaypoints) {
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

    // 키에 연료·경로 방식을 포함시킵니다. 보정 경유지는 dedup 좌표열에 이미 녹아 있습니다.
    const rkey = routeKeyOf(dedup, fuel, priority)

    // 캐시 조회
    let cached: any = null
    if (!opts.noCache) {
      try {
        cached = await db.prepare('SELECT * FROM travel_route_cache WHERE route_key = ?').bind(rkey).first()
      } catch { /* 테이블 없음 */ }
    }

    // 지도 형상이 필요한데 캐시에 없으면(0047 이전에 생성된 행) 캐시를 무시하고 재조회합니다.
    if (cached && opts.withPolyline && !cached.polyline_json) cached = null

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
      if (opts.withPolyline) {
        try {
          const p = JSON.parse(String(cached.polyline_json || 'null'))
          if (p && Array.isArray(p.line)) {
            day.polyline = p.line
            day.road_names = Array.isArray(p.roads) ? p.roads : []
          }
        } catch { /* 폴리라인 파싱 실패 무시 */ }
      }
      days.push(day)
      continue
    }

    const res = await findRoute(dedup, apiKey || '', {
      fuel,
      priority,
      withPolyline: !!opts.withPolyline,
    })
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
    if (opts.withPolyline) {
      day.polyline = res.polyline || []
      day.road_names = res.roadNames || []
    }

    try {
      // 폴리라인은 지도를 여는 상황에서만 확보되므로, 없을 때 기존 값을 지우지 않도록
      // COALESCE 로 보존합니다 (한 번 지도를 보면 그 뒤로 재호출 없이 재사용).
      const polyJson = opts.withPolyline
        ? JSON.stringify({ line: res.polyline || [], roads: res.roadNames || [] })
        : null
      await db.prepare(
        `INSERT INTO travel_route_cache (route_key, distance_m, duration_s, toll, legs_json, polyline_json)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(route_key) DO UPDATE SET
           distance_m=excluded.distance_m, duration_s=excluded.duration_s,
           toll=excluded.toll, legs_json=excluded.legs_json,
           polyline_json=COALESCE(excluded.polyline_json, travel_route_cache.polyline_json)`
      ).bind(rkey, res.distance, res.duration, res.toll, JSON.stringify(res.legs), polyJson).run()
    } catch { /* 캐시 실패는 무시 */ }

    days.push(day)
  }

  return { days, settings }
}

/**
 * 정산 금액 계산.
 * rule 은 resolveSettlement() 결과(사용자 차량 형태 반영)를 넘기고,
 * 없으면 전역 설정만으로 계산합니다.
 */
export function settleAmount(
  distanceKm: number,
  s: TravelSettings,
  rule?: { mode: 'none' | 'mileage' | 'fuel'; rate_per_km: number; fuel_efficiency: number; fuel_price: number }
): number {
  const mode = rule ? rule.mode : s.settlement_mode
  const rate = rule ? rule.rate_per_km : s.rate_per_km
  const eff = (rule ? rule.fuel_efficiency : s.fuel_efficiency) || 12
  const price = rule ? rule.fuel_price : s.fuel_price
  if (mode === 'mileage') return Math.round(distanceKm * rate)
  if (mode === 'fuel') return Math.round((distanceKm / (eff > 0 ? eff : 12)) * price)
  return 0
}

// ── GET /api/travel/daily ───────────────────────────────────────────────────
// 일자별 이동 경로 + 실제 주행거리 (화면 미리보기용)
travel.get('/daily', async (c) => {
  const from = c.req.query('from') || ''
  const to = c.req.query('to') || ''
  const userId = safeInt(c.req.query('user_id'), 0)
  const noCache = c.req.query('refresh') === '1'
  // 지도 형상은 용량이 있어 지도를 여는 요청에서만 받습니다 (목록 조회는 기존과 동일).
  const withPolyline = c.req.query('polyline') === '1'

  if (!c.env.KAKAO_REST_API_KEY) {
    return c.json({
      error: '카카오 REST API 키가 서버에 설정되지 않았습니다.',
      message: '카카오 REST API 키가 서버에 설정되지 않았습니다. 관리자에게 문의해주세요.',
    }, 503)
  }

  const { days, settings } = await buildDailyRoutes(c.env.DB, c.env.KAKAO_REST_API_KEY, {
    from, to, userId: userId || undefined, noCache, withPolyline,
  })

  const totalKm = Math.round(days.reduce((a, d) => a + d.distance_km, 0) * 10) / 10
  const totalToll = days.reduce((a, d) => a + d.toll, 0)
  const totalAmount = days.reduce((a, d) => a + settleAmount(d.distance_km, settings, d.rule), 0)

  // 차량 형태 미설정·세무 주의 등 담당자별 경고를 모아서 화면에 띄웁니다.
  const warnings = Array.from(new Set(
    days.map(d => (d.rule?.warning ? `${d.user_name || '담당자 미지정'}: ${d.rule.warning}` : ''))
      .filter(Boolean)
  ))

  // 화면에서 출발지/복귀지 셀렉트를 그리려면 장소 목록이 필요합니다.
  const placeUserIds = Array.from(new Set(days.map(d => Number(d.user_id)).filter(x => x > 0)))
  const places = await loadPlaces(c.env.DB, placeUserIds.length ? placeUserIds : [Number(c.get('userId')) || 0])

  return c.json({
    data: days.map(d => ({ ...d, amount: settleAmount(d.distance_km, settings, d.rule) })),
    settings,
    places,
    place_type_labels: PLACE_TYPE_LABEL,
    // 화면에서 경로 방식 셀렉트·연료 배지를 그릴 때 쓰는 선택지 목록
    route_priorities: ROUTE_PRIORITIES.map(v => ({ value: v, label: ROUTE_PRIORITY_LABEL[v] })),
    car_fuels: CAR_FUELS.map(v => ({ value: v, label: CAR_FUEL_LABEL[v] })),
    summary: {
      days: days.length,
      total_km: totalKm,
      total_toll: totalToll,
      total_amount: totalAmount,
      failed: days.filter(d => d.error).length,
      missing_coords: Array.from(new Set(days.flatMap(d => d.missing_coords))),
      warnings,
    },
  })
})

// ── POST /api/travel/route-preview ──────────────────────────────────────────
// 지도 모달에서 경유지를 찍는 중에 쓰는 '저장 없는 재계산'.
//
// 왜 별도 엔드포인트인가:
//   경유지를 찍을 때마다 travel_logs 에 저장해 버리면 사용자가 취소해도
//   되돌릴 수 없습니다. 그래서 조건만 넘겨받아 계산하고 저장은 하지 않습니다.
//   (카카오 응답은 travel_route_cache 에 남으므로 '적용' 후에는 재호출이 없습니다.)
travel.post('/route-preview', async (c) => {
  const b = await c.req.json().catch(() => ({} as any))
  const logDate = String(b.log_date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
    return apiError(c, 400, '사용일자를 YYYY-MM-DD 형식으로 보내주세요.', ErrorCodes.VALIDATION)
  }
  const userId = b.user_id === null || b.user_id === undefined || b.user_id === ''
    ? null : safeInt(b.user_id, 0)

  if (!c.env.KAKAO_REST_API_KEY) {
    return apiError(c, 503, '카카오 REST API 키가 서버에 설정되지 않았습니다.', ErrorCodes.VALIDATION)
  }

  // 그 날 하루만 계산합니다 (기간 전체를 다시 돌리면 카카오 호출이 낭비됩니다).
  const key = `${logDate}|${userId ?? ''}`
  const overrides = new Map<string, { route_priority?: any; route_waypoints?: any }>()
  overrides.set(key, {
    route_priority: b.route_priority,
    route_waypoints: b.route_waypoints,
  })

  const { days, settings } = await buildDailyRoutes(c.env.DB, c.env.KAKAO_REST_API_KEY, {
    from: logDate, to: logDate,
    userId: userId || undefined,
    withPolyline: true,
    overrides,
  })

  const day = days.find(d => d.date === logDate && String(d.user_id ?? '') === String(userId ?? ''))
  if (!day) {
    return apiError(c, 404, '해당 일자의 방문 기록을 찾을 수 없습니다.', ErrorCodes.NOT_FOUND)
  }

  return c.json({
    data: { ...day, amount: settleAmount(day.distance_km, settings, day.rule) },
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

  // 출발지/복귀지: 0 = "없음"을 명시적으로 선택, NULL = 미지정(기본값 적용)
  const placeOrNull = (v: any) => {
    if (v === undefined || v === null || String(v).trim() === '') return null
    const n = Number(v)
    return isFinite(n) && n >= 0 ? Math.round(n) : null
  }
  // 요청에 키가 아예 없으면 "이 요청은 출발지/복귀지를 건드리지 않는다"는 뜻입니다.
  // (메모만 고치는 저장 요청이 그 날 지정해 둔 출발지를 지워버리면 안 됩니다.)
  // 빈 문자열은 "기본값 사용" 을 고른 것이므로 NULL 로 저장합니다 — 구분해야 합니다.
  const originPlaceId = b.origin_place_id === undefined ? undefined : placeOrNull(b.origin_place_id)
  const returnPlaceId = b.return_place_id === undefined ? undefined : placeOrNull(b.return_place_id)

  // ── 그 날만 쓰는 임시 장소(숙소 등) ──────────────────────────────────────
  // 숙소는 매번 바뀌어 장소 목록에 등록하면 목록이 늘어나고, 나중에 지우면
  // 지난 달 정산 기록의 출발지가 사라집니다. 그래서 그 날 기록에 직접 남깁니다.
  //
  // 좌표는 반드시 한국 범위 안이어야 합니다 — 위경도를 바꿔 넣거나 오타가 나면
  // 카카오 길찾기가 엉뚱한 거리를 돌려주고 그대로 재무팀 정산서에 올라갑니다.
  const inKoreaCoord = (lat: number, lng: number) =>
    isFinite(lat) && isFinite(lng) && lat >= 33 && lat <= 38.7 && lng >= 124.5 && lng <= 131.9

  type TempPlace = { name: string | null; address: string | null; lat: number | null; lng: number | null }
  const tempOrNull = (raw: any, kind: string): TempPlace | { error: string } | null => {
    // 키 자체가 없으면 "이 요청은 임시 장소를 건드리지 않는다"는 뜻 → null 로 구분
    if (raw === undefined) return null
    // 명시적으로 null/빈값을 보내면 지우기
    if (raw === null || (typeof raw === 'object' && !raw.lat && !raw.lng && !raw.address && !raw.name)) {
      return { name: null, address: null, lat: null, lng: null }
    }
    if (typeof raw !== 'object') return { error: `${kind} 임시 장소 형식이 올바르지 않습니다.` }
    const lat = Number(raw.lat)
    const lng = Number(raw.lng)
    if (!inKoreaCoord(lat, lng)) {
      return { error: `${kind} 좌표가 올바르지 않습니다. 지도에서 위치를 다시 지정해주세요.` }
    }
    const address = String(raw.address || '').trim().slice(0, 300)
    const name = String(raw.name || '').trim().slice(0, 50)
    if (!address && !name) {
      return { error: `${kind} 이름이나 주소를 입력해주세요.` }
    }
    return { name: name || null, address: address || null, lat, lng }
  }

  const originTemp = tempOrNull(b.origin_temp, '출발지')
  const returnTemp = tempOrNull(b.return_temp, '복귀지')
  for (const t of [originTemp, returnTemp]) {
    if (t && 'error' in t) return c.json({ error: t.error, message: t.error }, 400)
  }

  // 남의 장소를 지정하지 못하도록 소유권을 확인합니다 (본인 장소 또는 전사 공용만 허용).
  for (const pid of [originPlaceId, returnPlaceId]) {
    if (pid === null || pid === undefined || pid === 0) continue
    const own = await c.env.DB.prepare(
      'SELECT id FROM travel_places WHERE id=? AND (user_id IS NULL OR user_id=?)'
    ).bind(pid, userId).first().catch(() => null)
    if (!own) {
      return c.json({
        error: '선택한 장소를 찾을 수 없습니다.',
        message: '선택한 장소를 찾을 수 없습니다. 목록을 새로 불러온 뒤 다시 시도해주세요.',
      }, 400)
    }
  }

  // 경로 방식·보정 경유지는 요청에 실리지 않으면 기존 값을 그대로 지켜야 합니다.
  // (출발지 셀렉트만 바꾸는 저장 요청이 지도에서 찍어둔 경유지를 날려버리면 안 됩니다.)
  // upsert 안에서 이를 표현하기가 까다로워, 기존 행을 먼저 읽어 최종값을 확정합니다.
  const prev = await c.env.DB.prepare(
    `SELECT route_priority, route_waypoints_json, origin_place_id, return_place_id,
            origin_temp_name, origin_temp_address, origin_temp_lat, origin_temp_lng,
            return_temp_name, return_temp_address, return_temp_lat, return_temp_lng
       FROM travel_logs WHERE log_date=? AND user_id IS ?`
  ).bind(logDate, userId).first().catch(() => null) as any

  const routePriority = b.route_priority === undefined
    ? (prev?.route_priority ?? null)
    : normalizePriority(b.route_priority)

  let routeWaypointsJson: string | null
  if (b.route_waypoints === undefined) {
    routeWaypointsJson = prev?.route_waypoints_json ?? null
  } else {
    // 빈 배열을 보내면 "경유지 전부 지움" 의미이므로 NULL 로 초기화합니다.
    const wps = parseWaypoints(b.route_waypoints)
    routeWaypointsJson = wps.length ? JSON.stringify(wps) : null
  }

  // 임시 장소도 마찬가지로, 요청에 키가 없으면 기존 값을 그대로 지킵니다.
  const keepTemp = (t: any, kind: 'origin' | 'return'): TempPlace => {
    if (t && !('error' in t)) return t as TempPlace
    return {
      name: prev?.[`${kind}_temp_name`] ?? null,
      address: prev?.[`${kind}_temp_address`] ?? null,
      lat: prev?.[`${kind}_temp_lat`] ?? null,
      lng: prev?.[`${kind}_temp_lng`] ?? null,
    }
  }
  const oTmp = keepTemp(originTemp, 'origin')
  const rTmp = keepTemp(returnTemp, 'return')

  // 출발지/복귀지도 요청에 키가 없으면 기존 값을 그대로 지킵니다.
  const oPid = originPlaceId === undefined ? (prev?.origin_place_id ?? null) : originPlaceId
  const rPid = returnPlaceId === undefined ? (prev?.return_place_id ?? null) : returnPlaceId

  await c.env.DB.prepare(
    `INSERT INTO travel_logs (log_date, user_id, vehicle_model, vehicle_plate, odo_start, odo_end, toll_amount, fuel_amount, note, origin_place_id, return_place_id, route_priority, route_waypoints_json,
       origin_temp_name, origin_temp_address, origin_temp_lat, origin_temp_lng,
       return_temp_name, return_temp_address, return_temp_lat, return_temp_lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(log_date, user_id) DO UPDATE SET
       vehicle_model=excluded.vehicle_model, vehicle_plate=excluded.vehicle_plate,
       odo_start=excluded.odo_start, odo_end=excluded.odo_end,
       toll_amount=excluded.toll_amount, fuel_amount=excluded.fuel_amount,
       note=excluded.note,
       origin_place_id=excluded.origin_place_id, return_place_id=excluded.return_place_id,
       route_priority=excluded.route_priority,
       route_waypoints_json=excluded.route_waypoints_json,
       origin_temp_name=excluded.origin_temp_name, origin_temp_address=excluded.origin_temp_address,
       origin_temp_lat=excluded.origin_temp_lat, origin_temp_lng=excluded.origin_temp_lng,
       return_temp_name=excluded.return_temp_name, return_temp_address=excluded.return_temp_address,
       return_temp_lat=excluded.return_temp_lat, return_temp_lng=excluded.return_temp_lng,
       updated_at=CURRENT_TIMESTAMP`
  ).bind(
    logDate, userId,
    b.vehicle_model || '', b.vehicle_plate || '',
    odoStart, odoEnd,
    intOrNull(b.toll_amount), intOrNull(b.fuel_amount),
    b.note || '',
    oPid, rPid,
    routePriority, routeWaypointsJson,
    oTmp.name, oTmp.address, oTmp.lat, oTmp.lng,
    rTmp.name, rTmp.address, rTmp.lat, rTmp.lng
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
  // 일정 플래너용 즉석 계산 — 출발지/복귀지는 요청 본문으로 덮어쓸 수 있게 했습니다.
  const uidForPlaces = Number(c.get('userId')) || 0
  const placesForRoute = await loadPlaces(c.env.DB, [uidForPlaces])
  const { origin: routeOrigin, ret: routeReturn } = resolveEndpoints(
    placesForRoute,
    uidForPlaces,
    { origin_place_id: b.origin_place_id, return_place_id: b.return_place_id },
    settings
  )
  if (routeOrigin) stops.push({ ...routeOrigin })
  for (const id of ids) {
    const h = byId.get(id)
    if (!h) continue
    if (h.lat === null || h.lng === null) { missing.push(h.name); continue }
    stops.push({
      hospital_id: Number(h.id), name: h.name, region: h.region || '',
      address: h.address || '', lat: Number(h.lat), lng: Number(h.lng),
    })
  }
  if (routeReturn && stops.some(s => !s.is_origin && !s.is_return)) {
    stops.push({ ...routeReturn })
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

  const uid = Number(c.get('userId'))
  const vmap = await loadVehicles(c.env.DB, [uid])
  const rule = resolveSettlement(vmap.get(uid) || { ...EMPTY_VEHICLE }, settings)

  const distanceKm = toKm(res.distance)
  return c.json({
    data: {
      stops,
      missing_coords: missing,
      distance_km: distanceKm,
      duration_min: toMin(res.duration),
      toll: res.toll,
      amount: settleAmount(distanceKm, settings, rule),
      rule,
      legs: res.legs.map(l => ({
        from: l.from, to: l.to,
        distance_km: toKm(l.distance), duration_min: toMin(l.duration),
      })),
    },
    settings,
  })
})

// ============================================================================
// 자주 쓰는 장소 CRUD (집 / 사무실 / 기타)
//
// 출발지·복귀지가 날마다 달라지므로, 장소를 등록해두고 일자별로 고릅니다.
// 본인 장소만 수정/삭제할 수 있고, 전사 공용(user_id IS NULL)은 읽기만 합니다.
// ============================================================================

const PLACE_TYPES = ['home', 'office', 'other'] as const

/** 장소 입력값 검증 — 좌표는 기관 폼과 동일한 한국 범위 체크 */
function validatePlaceBody(b: any): { error: string } | null {
  const name = String(b.name || '').trim()
  if (!name) return { error: '장소 이름을 입력해주세요. (예: 집, 본사)' }
  if (name.length > 50) return { error: '장소 이름은 50자 이내로 입력해주세요.' }

  const type = String(b.place_type || 'other')
  if (!PLACE_TYPES.includes(type as any)) return { error: '장소 종류 값이 올바르지 않습니다.' }

  const hasLat = b.lat !== undefined && String(b.lat).trim() !== ''
  const hasLng = b.lng !== undefined && String(b.lng).trim() !== ''
  if (hasLat !== hasLng) return { error: '위도와 경도는 둘 다 입력하거나 둘 다 비워둬야 합니다.' }
  if (hasLat && hasLng) {
    const lat = Number(b.lat), lng = Number(b.lng)
    if (!isFinite(lat) || !isFinite(lng)) return { error: '위도/경도는 숫자로 입력해주세요.' }
    const inKorea = lat >= 33.0 && lat <= 38.7 && lng >= 124.5 && lng <= 131.9
    if (!inKorea) {
      const swapped = lng >= 33.0 && lng <= 38.7 && lat >= 124.5 && lat <= 131.9
      return {
        error: swapped
          ? '위도와 경도가 반대로 입력된 것 같습니다. (위도 약 33~38.7, 경도 약 124.5~131.9)'
          : '한국 범위를 벗어난 좌표입니다. (위도 약 33~38.7, 경도 약 124.5~131.9)',
      }
    }
  }
  return null
}

/** 기본값 플래그는 담당자별로 하나만 유지합니다. */
async function clearDefaultFlags(
  db: D1Database, userId: number, column: 'is_default_origin' | 'is_default_return', keepId?: number
) {
  await db.prepare(
    `UPDATE travel_places SET ${column}=0, updated_at=CURRENT_TIMESTAMP
     WHERE user_id=? AND ${column}=1 ${keepId ? 'AND id<>?' : ''}`
  ).bind(...(keepId ? [userId, keepId] : [userId])).run()
}

// ── GET /api/travel/geocode?q=… ─────────────────────────────────────────────
// 주소/장소명 → 좌표 후보 목록.
//
// 왜 서버 경유인가: 브라우저에서 직접 부르면 (1) 지오코딩 제공자가 요구하는
// User-Agent 를 설정할 수 없고 (2) CORS 정책 변경에 그대로 노출되며
// (3) 카카오 키가 살아났을 때 프론트를 고쳐야 합니다. 서버에서 흡수합니다.
//
// 제공자 우선순위:
//   1) 카카오 로컬 (키가 있고 OPEN_MAP_AND_LOCAL 이 열려 있을 때) — 국내 주소 정확도 최상
//   2) Nominatim (OpenStreetMap, 키 불필요) — 카카오가 403 이어도 동작하는 폴백
//
// ⚠️ Nominatim 이용약관: 초당 1건 이하 + 식별 가능한 User-Agent 필수.
//    사용자가 검색창에 직접 타이핑할 때만 호출되므로(프론트에서 디바운스) 위반 소지 없음.
travel.get('/geocode', async (c) => {
  const q = (c.req.query('q') || '').trim()
  if (q.length < 2) {
    return c.json({ error: '검색어를 2자 이상 입력해주세요.', message: '검색어를 2자 이상 입력해주세요.' }, 400)
  }
  if (q.length > 120) {
    return c.json({ error: '검색어가 너무 깁니다.', message: '검색어가 너무 깁니다.' }, 400)
  }

  type Cand = { name: string; address: string; lat: number; lng: number; source: string }
  const out: Cand[] = []
  const seen = new Set<string>()
  const push = (x: Cand) => {
    // 소수 5자리(약 1m)로 중복 제거 — 제공자별 미세한 좌표 차이를 같은 곳으로 취급
    const k = x.lat.toFixed(5) + ',' + x.lng.toFixed(5)
    if (seen.has(k)) return
    seen.add(k)
    out.push(x)
  }
  const inKorea = (lat: number, lng: number) =>
    isFinite(lat) && isFinite(lng) && lat >= 33 && lat <= 38.7 && lng >= 124.5 && lng <= 131.9

  const notes: string[] = []
  const key = c.env.KAKAO_REST_API_KEY

  // ── 1) 카카오 로컬 (주소검색 + 키워드검색) ────────────────────────────────
  if (key) {
    const kakao = async (path: string, label: string) => {
      try {
        const r = await fetch(
          `https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(q)}&size=5`,
          { headers: { Authorization: `KakaoAK ${key}` } }
        )
        if (!r.ok) {
          // 403 = OPEN_MAP_AND_LOCAL 비활성. 키 자체는 유효하므로 폴백만 쓰면 됩니다.
          if (r.status === 403) notes.push('kakao_local_disabled')
          else notes.push(`kakao_${label}_http_${r.status}`)
          return
        }
        const j: any = await r.json()
        for (const d of (j.documents || [])) {
          // 주소검색: x/y 가 문서 루트. 키워드검색도 동일 필드명.
          const lat = Number(d.y), lng = Number(d.x)
          if (!inKorea(lat, lng)) continue
          push({
            name: d.place_name || d.address_name || d.road_address_name || q,
            address: d.road_address_name || d.address_name ||
                     d.road_address?.address_name || d.address?.address_name || '',
            lat, lng, source: 'kakao',
          })
        }
      } catch (e) { notes.push(`kakao_${label}_error`) }
    }
    await kakao('address', 'address')
    // 주소검색이 비어 있으면 상호명일 가능성 → 키워드검색도 시도
    if (!out.length) await kakao('keyword', 'keyword')
  } else {
    notes.push('kakao_key_missing')
  }

  // ── 2) Nominatim 폴백 ─────────────────────────────────────────────────────
  if (!out.length) {
    try {
      const u = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
        q, format: 'json', limit: '5', countrycodes: 'kr', addressdetails: '1',
        'accept-language': 'ko',
      }).toString()
      const r = await fetch(u, {
        headers: {
          // 약관상 필수: 연락 가능한 식별자
          'User-Agent': 'todoc-crm/1.0 (+https://todoc-crm.pages.dev; todoc.tech@gmail.com)',
          'Accept-Language': 'ko',
        },
      })
      if (r.ok) {
        const arr: any[] = await r.json()
        for (const d of (arr || [])) {
          const lat = Number(d.lat), lng = Number(d.lon)
          if (!inKorea(lat, lng)) continue
          const a = d.address || {}
          // display_name 은 "…, 대한민국" 까지 다 붙어 길어서, 앞 3토막만 이름으로 씁니다.
          const parts = String(d.display_name || '').split(',').map((s: string) => s.trim())
          const road = [a.city || a.province || '', a.borough || a.county || '',
                        a.road || '', a.house_number || ''].filter(Boolean).join(' ')
          push({
            name: d.name || parts[0] || q,
            address: road || parts.slice(0, 4).join(' '),
            lat, lng, source: 'osm',
          })
        }
      } else notes.push(`osm_http_${r.status}`)
    } catch (e) { notes.push('osm_error') }
  }

  return c.json({
    data: out.slice(0, 6),
    query: q,
    // 프론트에서 "카카오가 막혀 OSM 결과입니다" 같은 안내를 띄우기 위한 힌트
    notes,
    provider: out.length ? out[0].source : null,
  })
})

// ── GET /api/travel/places ──────────────────────────────────────────────────
travel.get('/places', async (c) => {
  const uid = Number(c.get('userId')) || 0
  const places = await loadPlaces(c.env.DB, [uid])
  return c.json({
    data: places,
    place_type_labels: PLACE_TYPE_LABEL,
    my_user_id: uid,
  })
})

// ── POST /api/travel/places ─────────────────────────────────────────────────
travel.post('/places', async (c) => {
  const uid = Number(c.get('userId')) || 0
  const b = await c.req.json().catch(() => ({} as any))
  const bad = validatePlaceBody(b)
  if (bad) return c.json({ error: bad.error, message: bad.error }, 400)

  const hasCoord = b.lat !== undefined && String(b.lat).trim() !== ''
  const defOrigin = b.is_default_origin ? 1 : 0
  const defReturn = b.is_default_return ? 1 : 0

  if (defOrigin) await clearDefaultFlags(c.env.DB, uid, 'is_default_origin')
  if (defReturn) await clearDefaultFlags(c.env.DB, uid, 'is_default_return')

  const r = await c.env.DB.prepare(
    `INSERT INTO travel_places (user_id, name, place_type, address, lat, lng, is_default_origin, is_default_return, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid,
    String(b.name).trim(),
    String(b.place_type || 'other'),
    String(b.address || '').trim(),
    hasCoord ? Number(b.lat) : null,
    hasCoord ? Number(b.lng) : null,
    defOrigin, defReturn,
    safeInt(b.sort_order, 0)
  ).run()

  const row = await c.env.DB.prepare('SELECT * FROM travel_places WHERE id=?')
    .bind(r.meta.last_row_id).first()
  await logActivity(c.env.DB, 'create', 'travel_place', Number(r.meta.last_row_id), String(b.name).trim(), '출장 장소 등록')
  return c.json({ data: row ? rowToPlace(row) : null })
})

// ── PUT /api/travel/places/:id ──────────────────────────────────────────────
travel.put('/places/:id', async (c) => {
  const uid = Number(c.get('userId')) || 0
  const id = safeInt(c.req.param('id'), 0)
  if (id <= 0) return c.json({ error: '잘못된 요청입니다.', message: '잘못된 요청입니다.' }, 400)

  const cur = await c.env.DB.prepare('SELECT * FROM travel_places WHERE id=?').bind(id).first()
  if (!cur) return c.json({ error: '장소를 찾을 수 없습니다.', message: '장소를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404)
  // 전사 공용 장소는 화면에서 읽기만 하도록 하고, 남의 장소는 건드릴 수 없습니다.
  if (cur.user_id === null || Number(cur.user_id) !== uid) {
    return c.json({
      error: '이 장소는 수정할 수 없습니다.',
      message: '전사 공용 장소이거나 다른 담당자의 장소입니다. 본인이 등록한 장소만 수정할 수 있습니다.',
      code: 'FORBIDDEN',
    }, 403)
  }

  const b = await c.req.json().catch(() => ({} as any))
  const bad = validatePlaceBody(b)
  if (bad) return c.json({ error: bad.error, message: bad.error }, 400)

  const hasCoord = b.lat !== undefined && String(b.lat).trim() !== ''
  const defOrigin = b.is_default_origin ? 1 : 0
  const defReturn = b.is_default_return ? 1 : 0
  if (defOrigin) await clearDefaultFlags(c.env.DB, uid, 'is_default_origin', id)
  if (defReturn) await clearDefaultFlags(c.env.DB, uid, 'is_default_return', id)

  await c.env.DB.prepare(
    `UPDATE travel_places SET name=?, place_type=?, address=?, lat=?, lng=?,
       is_default_origin=?, is_default_return=?, sort_order=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND user_id=?`
  ).bind(
    String(b.name).trim(),
    String(b.place_type || 'other'),
    String(b.address || '').trim(),
    hasCoord ? Number(b.lat) : null,
    hasCoord ? Number(b.lng) : null,
    defOrigin, defReturn,
    safeInt(b.sort_order, 0),
    id, uid
  ).run()

  const row = await c.env.DB.prepare('SELECT * FROM travel_places WHERE id=?').bind(id).first()
  await logActivity(c.env.DB, 'update', 'travel_place', id, String(b.name).trim(), '출장 장소 수정')
  return c.json({ data: row ? rowToPlace(row) : null })
})

// ── DELETE /api/travel/places/:id ───────────────────────────────────────────
travel.delete('/places/:id', async (c) => {
  const uid = Number(c.get('userId')) || 0
  const id = safeInt(c.req.param('id'), 0)
  if (id <= 0) return c.json({ error: '잘못된 요청입니다.', message: '잘못된 요청입니다.' }, 400)

  const cur = await c.env.DB.prepare('SELECT * FROM travel_places WHERE id=?').bind(id).first()
  if (!cur) return c.json({ error: '장소를 찾을 수 없습니다.', message: '장소를 찾을 수 없습니다.', code: 'NOT_FOUND' }, 404)
  if (cur.user_id === null || Number(cur.user_id) !== uid) {
    return c.json({
      error: '이 장소는 삭제할 수 없습니다.',
      message: '전사 공용 장소이거나 다른 담당자의 장소입니다.',
      code: 'FORBIDDEN',
    }, 403)
  }

  // 이미 이 장소를 지정한 과거 운행기록이 있으면 경로가 조용히 바뀌므로 알려줍니다.
  const used = await c.env.DB.prepare(
    'SELECT COUNT(*) AS c FROM travel_logs WHERE origin_place_id=? OR return_place_id=?'
  ).bind(id, id).first().catch(() => null)
  const usedCount = used ? Number((used as any).c) || 0 : 0

  // 참조를 NULL 로 되돌려 기본값이 적용되게 합니다 (문장별 개별 실행).
  await c.env.DB.prepare('UPDATE travel_logs SET origin_place_id=NULL WHERE origin_place_id=?').bind(id).run()
  await c.env.DB.prepare('UPDATE travel_logs SET return_place_id=NULL WHERE return_place_id=?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM travel_places WHERE id=? AND user_id=?').bind(id, uid).run()

  await logActivity(c.env.DB, 'delete', 'travel_place', id, String((cur as any).name || ''), '출장 장소 삭제')
  return c.json({
    success: true,
    affected_logs: usedCount,
    message: usedCount > 0
      ? `장소를 삭제했습니다. 이 장소를 쓰던 운행기록 ${usedCount}일은 기본 출발지/복귀지로 되돌아갑니다.`
      : '장소를 삭제했습니다.',
  })
})

export default travel
