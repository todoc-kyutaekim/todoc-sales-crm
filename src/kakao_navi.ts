// ============================================================================
// 카카오모빌리티 길찾기 (자동차) 클라이언트
//
// 유류비·통행료 증빙에 쓰는 "실제 도로 주행거리"를 구합니다.
// 직선거리(하버사인)는 재무팀 증빙 자료로 쓸 수 없어 실측 경로 API 를 사용합니다.
//
// ⚠️ 좌표 순서 주의: 카카오 API 는 x = 경도(lng), y = 위도(lat) 입니다.
//    lat/lng 순서로 넘기면 엉뚱한 곳(중국 등)이 나오므로 이 모듈 밖에서
//    직접 x/y 를 만들지 말고 항상 아래 타입/함수를 경유하세요.
//
// 무료 한도: 자동차 길찾기 10,000건/일, 다중 경유지 5,000건/일
// ============================================================================

export type NaviPoint = {
  lat: number
  lng: number
  name?: string
}

/**
 * 차량 연료 종류. 카카오 `car_fuel` 에 그대로 전달합니다.
 *
 * 전기차는 고속도로 통행료 감면(친환경차 할인)이 적용되므로 통행료가 실제로 달라집니다.
 *   실측(서울역→부산역): GASOLINE/DIESEL/LPG 20,200원 · ELECTRIC 14,410원 (−28.7%)
 * 참고: 카카오는 EV / HYBRID 를 받지 않습니다(HTTP 400). 하이브리드는 감면 대상이
 *      아니므로 GASOLINE 으로 취급합니다.
 */
export type CarFuel = 'GASOLINE' | 'DIESEL' | 'LPG' | 'ELECTRIC'

export const CAR_FUELS: CarFuel[] = ['GASOLINE', 'DIESEL', 'LPG', 'ELECTRIC']

/** 연료 종류 한글 라벨 */
export const CAR_FUEL_LABEL: Record<CarFuel, string> = {
  GASOLINE: '휘발유',
  DIESEL: '경유',
  LPG: 'LPG',
  ELECTRIC: '전기',
}

/** 알 수 없는 값·NULL 은 기존 동작(휘발유)으로 정규화 */
export function normalizeFuel(v: any): CarFuel {
  const s = String(v || '').toUpperCase()
  return (CAR_FUELS as string[]).includes(s) ? (s as CarFuel) : 'GASOLINE'
}

/** 전기차는 연비/유가를 리터가 아닌 kWh 단위로 해석합니다. */
export function isElectric(v: any): boolean {
  return normalizeFuel(v) === 'ELECTRIC'
}

/**
 * 경로 산출 방식.
 *   RECOMMEND  : 카카오 추천 (기본)
 *   DISTANCE   : 최단거리 — 고속도로를 피해 지방도로 도는 경향, 통행료가 낮음
 *   AVOID_TOLL : 유료도로 회피 — 카카오 priority 값이 아니라 RECOMMEND + avoid:['toll'] 조합
 *
 * 실측(수원→천안): RECOMMEND 64.9km/3,500원 · DISTANCE 57.2km/0원 · AVOID_TOLL 59.1km/0원
 */
export type RoutePriority = 'RECOMMEND' | 'DISTANCE' | 'AVOID_TOLL'

export const ROUTE_PRIORITIES: RoutePriority[] = ['RECOMMEND', 'DISTANCE', 'AVOID_TOLL']

export const ROUTE_PRIORITY_LABEL: Record<RoutePriority, string> = {
  RECOMMEND: '추천',
  DISTANCE: '최단거리',
  AVOID_TOLL: '무료도로',
}

export function normalizePriority(v: any): RoutePriority {
  const s = String(v || '').toUpperCase()
  return (ROUTE_PRIORITIES as string[]).includes(s) ? (s as RoutePriority) : 'RECOMMEND'
}

export type RouteOptions = {
  /** 차량 연료 종류 — 통행료 감면 반영 */
  fuel?: CarFuel
  /** 경로 산출 방식 */
  priority?: RoutePriority
  /** 지도 표시용 경로 형상 좌표를 함께 반환할지 (기본 false) */
  withPolyline?: boolean
}

export type NaviLeg = {
  /** 구간 출발지 이름 */
  from: string
  /** 구간 도착지 이름 */
  to: string
  /** 구간 거리 (m) */
  distance: number
  /** 구간 소요시간 (초) */
  duration: number
}

export type NaviResult = {
  ok: true
  /** 총 거리 (m) */
  distance: number
  /** 총 소요시간 (초) */
  duration: number
  /** 통행료 (원) — 카카오 추정치. 실제 증빙은 하이패스 내역이 우선 */
  toll: number
  /** 유료도로 외 택시요금 등은 사용하지 않음 */
  legs: NaviLeg[]
  /**
   * 지도 표시용 경로 형상 [[lat,lng], ...]. withPolyline 일 때만 채워집니다.
   * ⚠️ Douglas-Peucker 로 간소화된 값이므로 거리 계산에 쓰지 마세요.
   *    거리·통행료는 위 distance/toll(카카오 원본)을 씁니다.
   */
  polyline?: [number, number][]
  /** 경로가 지나간 주요 도로명 (증빙 비고용, 연속 중복 제거) */
  roadNames?: string[]
}

export type NaviError = {
  ok: false
  /** 카카오 result_code (0=성공, 104=출발지와 도착지가 5m 이내, 그 외 오류) */
  code: number | null
  message: string
}

const SINGLE_URL = 'https://apis-navi.kakaomobility.com/v1/directions'
const WAYPOINTS_URL = 'https://apis-navi.kakaomobility.com/v1/waypoints/directions'

/** 카카오 result_code → 사람이 읽을 수 있는 메시지 */
function resultCodeMessage(code: number, msg?: string): string {
  switch (code) {
    case 0: return '성공'
    case 1: return '길찾기 결과를 찾을 수 없습니다.'
    case 101: return '경로 탐색 결과가 없습니다.'
    case 102: return '출발지가 도로 근처가 아닙니다. 좌표를 확인해주세요.'
    case 103: return '도착지가 도로 근처가 아닙니다. 좌표를 확인해주세요.'
    case 104: return '출발지와 도착지가 5m 이내로 너무 가깝습니다.'
    case 105: return '출발지가 서비스 지역(대한민국)을 벗어났습니다.'
    case 106: return '도착지가 서비스 지역(대한민국)을 벗어났습니다.'
    case 107: return '경유지가 서비스 지역을 벗어났습니다.'
    default: return msg || `길찾기 실패 (code ${code})`
  }
}

/**
 * HTTP 오류를 사람이 읽을 수 있는 메시지로 변환.
 *
 * ⚠️ 카카오 원문(예: `appKey(xxx) does not exist`)을 그대로 노출하지 않습니다.
 *    이 메시지는 재무팀에 제출하는 보고서의 "비고" 칸에 그대로 찍히므로,
 *    ① API 키 문자열이 문서에 새어나가면 안 되고
 *    ② 담당자가 무엇을 해야 하는지 알 수 있어야 합니다.
 */
function httpError(status: number, body: string): NaviError {
  if (status === 401 || status === 403) {
    return {
      ok: false, code: null,
      message: '카카오 길찾기 API 인증이 거부되었습니다. API 키가 만료·정지되었을 수 있습니다. (관리자 확인 필요)',
    }
  }
  if (status === 429) {
    return {
      ok: false, code: null,
      message: '카카오 길찾기 API 일일 무료 한도를 초과했습니다. 다음 날 다시 시도해주세요.',
    }
  }
  if (status >= 500) {
    return { ok: false, code: null, message: `카카오 길찾기 서버 오류 (HTTP ${status}). 잠시 후 다시 시도해주세요.` }
  }
  // 그 외는 진단을 위해 응답 앞부분만 (키가 실릴 수 있는 401/403 은 위에서 걸러짐)
  return { ok: false, code: null, message: `카카오 길찾기 요청 실패 (HTTP ${status}): ${body.slice(0, 120)}` }
}

/** 두 지점이 동일 좌표인지 (소수 5자리 ≈ 1m) */
export function samePoint(a: NaviPoint, b: NaviPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5
}

// ── 경로 형상 간소화 ────────────────────────────────────────────────────────
// 카카오는 도로 형상을 정점 단위로 돌려주는데(서울 38km 동선에서 649개, 13.5KB)
// 지도에 그릴 때는 그만큼 촘촘할 필요가 없습니다. Douglas-Peucker 로 약 10m
// 오차까지 줄이면 123개 / 2.6KB 가 되어 D1 저장·전송 부담이 사라집니다.
const SIMPLIFY_EPS = 0.0001 // 위경도 도(度) 단위 ≈ 10m

/** 점 p 와 선분 ab 사이의 수직거리 (위경도를 평면으로 근사 — 도심 규모에서 충분) */
function perpDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dy = b[0] - a[0]
  const dx = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dy + (p[1] - a[1]) * dx) / (dy * dy + dx * dx)))
  return Math.hypot(p[0] - (a[0] + t * dy), p[1] - (a[1] + t * dx))
}

/**
 * Douglas-Peucker 간소화 (반복 구현).
 * 재귀는 정점이 수천 개일 때 스택을 넘길 수 있어 명시적 스택을 씁니다.
 */
function simplify(points: [number, number][], eps = SIMPLIFY_EPS): [number, number][] {
  const n = points.length
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let far = -1
    let maxD = 0
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], points[lo], points[hi])
      if (d > maxD) { maxD = d; far = i }
    }
    if (far > 0 && maxD > eps) {
      keep[far] = 1
      stack.push([lo, far], [far, hi])
    }
  }
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

/** 카카오 응답에서 경로 형상 좌표열을 뽑아 간소화 */
function extractPolyline(sections: any[]): [number, number][] {
  const pts: [number, number][] = []
  for (const sec of sections) {
    const roads: any[] = Array.isArray(sec?.roads) ? sec.roads : []
    for (const road of roads) {
      const v: number[] = Array.isArray(road?.vertexes) ? road.vertexes : []
      // vertexes 는 [lng, lat, lng, lat, ...] 로 평탄화되어 있습니다.
      for (let i = 0; i + 1 < v.length; i += 2) {
        const lat = Number(v[i + 1])
        const lng = Number(v[i])
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const last = pts[pts.length - 1]
        if (last && last[0] === lat && last[1] === lng) continue // 구간 경계 중복점
        pts.push([lat, lng])
      }
    }
  }
  const simplified = simplify(pts)
  // 소수 5자리(≈1m)로 잘라 전송량을 더 줄입니다.
  return simplified.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5])
}

/** 경로가 지나간 주요 도로명 (연속 중복 제거, 최대 40개) */
function extractRoadNames(sections: any[]): string[] {
  const out: string[] = []
  for (const sec of sections) {
    const roads: any[] = Array.isArray(sec?.roads) ? sec.roads : []
    for (const road of roads) {
      const name = String(road?.name || '').trim()
      if (!name) continue
      if (out[out.length - 1] === name) continue
      out.push(name)
      if (out.length >= 40) return out
    }
  }
  return out
}

function parseRoute(json: any, points: NaviPoint[], withPolyline?: boolean): NaviResult | NaviError {
  const route = json?.routes?.[0]
  if (!route) return { ok: false, code: null, message: '길찾기 응답이 비어 있습니다.' }
  const code = Number(route.result_code)
  if (code !== 0) {
    return { ok: false, code, message: resultCodeMessage(code, route.result_msg) }
  }
  const summary = route.summary || {}
  const sections: any[] = Array.isArray(route.sections) ? route.sections : []
  const legs: NaviLeg[] = sections.map((s, i) => ({
    from: points[i]?.name || `지점${i + 1}`,
    to: points[i + 1]?.name || `지점${i + 2}`,
    distance: Number(s.distance) || 0,
    duration: Number(s.duration) || 0,
  }))
  const result: NaviResult = {
    ok: true,
    distance: Number(summary.distance) || 0,
    duration: Number(summary.duration) || 0,
    toll: Number(summary?.fare?.toll) || 0,
    legs,
  }
  if (withPolyline) {
    result.polyline = extractPolyline(sections)
    result.roadNames = extractRoadNames(sections)
  }
  return result
}

/**
 * 경로 탐색. points 는 [출발지, ...경유지, 도착지] 순서 (최소 2개).
 * 경유지가 없으면 단일 길찾기(GET), 있으면 다중 경유지(POST) 를 씁니다.
 *
 * @param opts 연료 종류(통행료 감면) · 경로 방식 · 지도 형상 반환 여부.
 *             생략하면 휘발유 + 추천경로로 기존과 동일하게 동작합니다.
 */
export async function findRoute(
  points: NaviPoint[],
  apiKey: string,
  opts: RouteOptions = {},
): Promise<NaviResult | NaviError> {
  if (!apiKey) return { ok: false, code: null, message: '카카오 REST API 키가 설정되지 않았습니다.' }
  if (!points || points.length < 2) return { ok: false, code: null, message: '출발지와 도착지가 필요합니다.' }
  // 카카오 다중 경유지 제한: 경유지 최대 30개
  if (points.length > 32) return { ok: false, code: null, message: '경유지는 최대 30곳까지 지원합니다.' }

  const fuel = normalizeFuel(opts.fuel)
  const priority = normalizePriority(opts.priority)
  // AVOID_TOLL 은 카카오 priority 값이 아니므로 RECOMMEND + avoid 로 바꿔 보냅니다.
  const kakaoPriority = priority === 'AVOID_TOLL' ? 'RECOMMEND' : priority
  const avoidToll = priority === 'AVOID_TOLL'

  const headers = {
    Authorization: `KakaoAK ${apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    if (points.length === 2) {
      const [o, d] = points
      // ⚠️ x=경도, y=위도
      const qs = new URLSearchParams({
        origin: `${o.lng},${o.lat}`,
        destination: `${d.lng},${d.lat}`,
        priority: kakaoPriority,
        car_fuel: fuel,
        car_hipass: 'true',
      })
      // GET 은 avoid 를 쉼표 구분 문자열로 받습니다.
      if (avoidToll) qs.set('avoid', 'toll')
      const res = await fetch(`${SINGLE_URL}?${qs.toString()}`, { headers })
      if (!res.ok) return httpError(res.status, await res.text())
      return parseRoute(await res.json(), points, opts.withPolyline)
    }

    const origin = points[0]
    const destination = points[points.length - 1]
    const waypoints = points.slice(1, -1)
    const body: Record<string, any> = {
      origin: { x: origin.lng, y: origin.lat, name: origin.name },
      destination: { x: destination.lng, y: destination.lat, name: destination.name },
      waypoints: waypoints.map(w => ({ x: w.lng, y: w.lat, name: w.name })),
      priority: kakaoPriority,
      car_fuel: fuel,
      car_hipass: true,
      // 경유지 순서를 그대로 지킴 (실제 방문 순서가 증빙 대상이므로 최적화하지 않음)
      summary: false,
    }
    // ⚠️ POST 는 avoid 를 배열로만 받습니다. 문자열로 보내면 HTTP 500 이 납니다(실측).
    if (avoidToll) body.avoid = ['toll']
    const res = await fetch(WAYPOINTS_URL, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) return httpError(res.status, await res.text())
    return parseRoute(await res.json(), points, opts.withPolyline)
  } catch (e: any) {
    return { ok: false, code: null, message: `카카오 길찾기 호출 실패: ${e?.message || e}` }
  }
}

/** m → km (소수 1자리) */
export function toKm(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10
}

/** 초 → 분 (정수) */
export function toMin(seconds: number): number {
  return Math.round(seconds / 60)
}
