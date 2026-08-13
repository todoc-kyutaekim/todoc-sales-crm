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

/** 두 지점이 동일 좌표인지 (소수 5자리 ≈ 1m) */
export function samePoint(a: NaviPoint, b: NaviPoint): boolean {
  return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5
}

function parseRoute(json: any, points: NaviPoint[]): NaviResult | NaviError {
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
  return {
    ok: true,
    distance: Number(summary.distance) || 0,
    duration: Number(summary.duration) || 0,
    toll: Number(summary?.fare?.toll) || 0,
    legs,
  }
}

/**
 * 경로 탐색. points 는 [출발지, ...경유지, 도착지] 순서 (최소 2개).
 * 경유지가 없으면 단일 길찾기(GET), 있으면 다중 경유지(POST) 를 씁니다.
 */
export async function findRoute(points: NaviPoint[], apiKey: string): Promise<NaviResult | NaviError> {
  if (!apiKey) return { ok: false, code: null, message: '카카오 REST API 키가 설정되지 않았습니다.' }
  if (!points || points.length < 2) return { ok: false, code: null, message: '출발지와 도착지가 필요합니다.' }
  // 카카오 다중 경유지 제한: 경유지 최대 30개
  if (points.length > 32) return { ok: false, code: null, message: '경유지는 최대 30곳까지 지원합니다.' }

  const headers = {
    Authorization: `KakaoAK ${apiKey}`,
    'Content-Type': 'application/json',
  }

  try {
    if (points.length === 2) {
      const [o, d] = points
      // ⚠️ x=경도, y=위도
      const url = `${SINGLE_URL}?origin=${o.lng},${o.lat}&destination=${d.lng},${d.lat}&priority=RECOMMEND&car_fuel=GASOLINE&car_hipass=true`
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const body = await res.text()
        return { ok: false, code: null, message: `카카오 길찾기 HTTP ${res.status}: ${body.slice(0, 200)}` }
      }
      return parseRoute(await res.json(), points)
    }

    const origin = points[0]
    const destination = points[points.length - 1]
    const waypoints = points.slice(1, -1)
    const body = {
      origin: { x: origin.lng, y: origin.lat, name: origin.name },
      destination: { x: destination.lng, y: destination.lat, name: destination.name },
      waypoints: waypoints.map(w => ({ x: w.lng, y: w.lat, name: w.name })),
      priority: 'RECOMMEND',
      car_fuel: 'GASOLINE',
      car_hipass: true,
      // 경유지 순서를 그대로 지킴 (실제 방문 순서가 증빙 대상이므로 최적화하지 않음)
      summary: false,
    }
    const res = await fetch(WAYPOINTS_URL, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: null, message: `카카오 길찾기 HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
    return parseRoute(await res.json(), points)
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
