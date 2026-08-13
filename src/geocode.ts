// ============================================================================
// 주소 → 좌표(지오코딩) 공통 모듈
// ============================================================================
// ⚠️ 왜 이 파일이 따로 있는가 (2026-08-13)
//   거리 증빙(유류비/톨게이트 정산)은 좌표가 틀리면 계산 전체가 무의미해집니다.
//   기존 hospitals.ts 의 지오코딩은 Nominatim 단일 질의였고, 실패하면 그대로 포기했습니다.
//   실패 건을 "병원 이름"으로 재검색해보니 동명 병원 때문에 엉뚱한 도시가 잡혔습니다.
//     예) "하나이비인후과병원" (서울 강남) → 울산 남구 하나이비인후과병원 (35.53, 129.32)
//   → 그래서 이 모듈은 (1) 카카오 주소검색을 우선 사용하고
//                    (2) 어떤 경로로 얻은 좌표든 주소의 시/도 범위 안에 있는지 반드시 검증합니다.
//   검증에 실패한 좌표는 "없음"으로 취급합니다. 틀린 좌표보다 빈 좌표가 안전합니다.
// ============================================================================

export type GeocodeResult = {
  lat: number
  lng: number
  source: 'kakao_address' | 'kakao_keyword' | 'nominatim_address' | 'nominatim_simplified' | 'nominatim_name'
  matched: string
}

// 시/도별 대략 경계 (lat_min, lat_max, lng_min, lng_max)
// 정밀 행정경계가 아니라 "다른 시/도로 잘못 잡힌 좌표"를 걸러내기 위한 넉넉한 사각형입니다.
const SIDO_BOX: Record<string, [number, number, number, number]> = {
  서울: [37.41, 37.72, 126.76, 127.19],
  경기: [36.89, 38.30, 126.26, 127.87],
  인천: [36.98, 37.98, 124.60, 126.80],
  부산: [34.88, 35.39, 128.74, 129.32],
  대구: [35.60, 36.02, 128.35, 128.77],
  광주: [35.03, 35.26, 126.64, 127.02],
  대전: [36.18, 36.50, 127.25, 127.56],
  울산: [35.30, 35.72, 128.95, 129.47],
  세종: [36.42, 36.72, 127.15, 127.42],
  강원: [37.04, 38.62, 127.05, 129.37],
  충북: [36.00, 37.26, 127.25, 128.66],
  충남: [35.97, 37.05, 125.98, 127.63],
  전북: [35.31, 36.20, 126.30, 127.87],
  전남: [33.90, 35.50, 125.06, 127.90],
  경북: [35.55, 37.14, 127.79, 129.60],
  경남: [34.55, 35.92, 127.51, 129.29],
  제주: [33.10, 33.60, 126.10, 126.99]
}

// 주소 앞부분에서 시/도를 뽑아냅니다. ('전라남도' → '전남' 같은 축약 처리 포함)
export function sidoOf(address: string): string | null {
  const a = (address || '').trim()
  if (!a) return null
  const alias: Record<string, string> = {
    전라남: '전남', 전라북: '전북', 충청남: '충남', 충청북: '충북',
    경상남: '경남', 경상북: '경북', 강원특별: '강원', 제주특별: '제주'
  }
  for (const k of Object.keys(alias)) if (a.startsWith(k)) return alias[k]
  for (const k of Object.keys(SIDO_BOX)) if (a.startsWith(k)) return k
  return null
}

// 좌표가 주소의 시/도 범위 안에 있는지 검증
export function coordMatchesAddress(address: string, lat: number, lng: number): boolean {
  if (!isFinite(lat) || !isFinite(lng)) return false
  // 한반도 남부 전체 범위를 벗어나면 무조건 거부
  if (lat < 33.0 || lat > 38.7 || lng < 124.5 || lng > 131.9) return false
  const s = sidoOf(address)
  if (!s) return true // 시/도 판별 불가 → 전국 범위 검증만 통과시킴
  const [y0, y1, x0, x1] = SIDO_BOX[s]
  return lat >= y0 && lat <= y1 && lng >= x0 && lng <= x1
}

// "서울특별시 송파구 중대로 126, 드림캐슬 5층" → "서울특별시 송파구 중대로 126"
// 콤마/괄호 뒤 상세주소(층·호·건물명)는 지오코더가 오히려 헷갈리므로 잘라냅니다.
export function simplifyAddress(address: string): string {
  let a = (address || '').trim()
  a = a.split(',')[0]
  a = a.replace(/\([^)]*\)/g, ' ')
  // 도로명 + 번지까지만 남기기: "... 역삼로 245 하나이비인후과병원" → "... 역삼로 245"
  const m = a.match(/^(.*?(?:로|길|대로|번길|번길\s*)\s*\d+(?:-\d+)?)\b/)
  if (m) a = m[1]
  return a.replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// 카카오 로컬 API (주소검색 / 키워드검색)
// ⚠️ 카카오디벨로퍼스에서 [내 애플리케이션 → 제품 설정 → 카카오맵]을 활성화해야 동작합니다.
//    미활성 상태에서는 403 {"errorType":"NotAuthorizedError",
//                        "message":"App(...) disabled OPEN_MAP_AND_LOCAL service."} 이 반환됩니다.
//    이 경우 아래 Nominatim 경로로 자동 폴백합니다. (길찾기 API 는 활성화 없이 동작합니다)
// ---------------------------------------------------------------------------
async function kakaoAddress(query: string, key: string): Promise<{ lat: number; lng: number; matched: string } | null> {
  if (!key || !query) return null
  try {
    const url = 'https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(query)
    const resp = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key } })
    if (!resp.ok) return null
    const d = await resp.json() as any
    const doc = d?.documents?.[0]
    if (!doc) return null
    // 카카오는 x=경도(lng), y=위도(lat) 입니다. 순서를 헷갈리기 쉬운 지점입니다.
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x), matched: doc.address_name || query }
  } catch { return null }
}

async function kakaoKeyword(query: string, key: string): Promise<{ lat: number; lng: number; matched: string } | null> {
  if (!key || !query) return null
  try {
    const url = 'https://dapi.kakao.com/v2/local/search/keyword.json?size=1&query=' + encodeURIComponent(query)
    const resp = await fetch(url, { headers: { Authorization: 'KakaoAK ' + key } })
    if (!resp.ok) return null
    const d = await resp.json() as any
    const doc = d?.documents?.[0]
    if (!doc) return null
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x), matched: doc.road_address_name || doc.address_name || query }
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Nominatim (OpenStreetMap, 무료·키 없음) — 정책상 ~1 req/sec
// ---------------------------------------------------------------------------
async function nominatim(query: string): Promise<{ lat: number; lng: number; matched: string } | null> {
  if (!query) return null
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&q=' + encodeURIComponent(query)
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'todoc-crm/1.0 (hospital-map)', 'Accept-Language': 'ko,en' }
    })
    if (!resp.ok) return null
    const data = await resp.json() as any[]
    if (!Array.isArray(data) || data.length === 0) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (isNaN(lat) || isNaN(lng)) return null
    return { lat, lng, matched: String(data[0].display_name || '').slice(0, 120) }
  } catch { return null }
}

// ---------------------------------------------------------------------------
// 통합 지오코딩: 여러 경로를 순서대로 시도하고, 시/도 검증을 통과한 첫 결과를 반환
//   name 을 넘기면 "시도 + 이름" 키워드 검색까지 시도합니다.
//   ⚠️ 이름 검색은 동명 병원 위험이 있으므로 반드시 시/도 검증을 통과해야 채택됩니다.
// ---------------------------------------------------------------------------
export async function geocodePlace(
  address: string,
  name?: string,
  kakaoKey?: string
): Promise<GeocodeResult | null> {
  const addr = (address || '').trim()
  if (!addr) return null
  const simple = simplifyAddress(addr)
  const sido = sidoOf(addr)

  type Attempt = { fn: () => Promise<{ lat: number; lng: number; matched: string } | null>; source: GeocodeResult['source']; wait: number }
  const attempts: Attempt[] = []

  if (kakaoKey) {
    attempts.push({ fn: () => kakaoAddress(addr, kakaoKey), source: 'kakao_address', wait: 0 })
    if (simple !== addr) attempts.push({ fn: () => kakaoAddress(simple, kakaoKey), source: 'kakao_address', wait: 0 })
    attempts.push({ fn: () => kakaoKeyword(addr, kakaoKey), source: 'kakao_keyword', wait: 0 })
    if (name) attempts.push({ fn: () => kakaoKeyword(((sido ? sido + ' ' : '') + name).trim(), kakaoKey), source: 'kakao_keyword', wait: 0 })
  }
  attempts.push({ fn: () => nominatim(addr), source: 'nominatim_address', wait: 1100 })
  if (simple !== addr) attempts.push({ fn: () => nominatim(simple), source: 'nominatim_simplified', wait: 1100 })
  if (name) attempts.push({ fn: () => nominatim(((sido ? sido + ' ' : '') + name).trim()), source: 'nominatim_name', wait: 1100 })

  for (const a of attempts) {
    const r = await a.fn()
    if (a.wait) await new Promise(res => setTimeout(res, a.wait))
    if (!r) continue
    // 🔒 핵심 안전장치: 시/도 범위를 벗어난 좌표는 버립니다.
    if (!coordMatchesAddress(addr, r.lat, r.lng)) {
      console.warn('[geocode] rejected out-of-region result', { address: addr, source: a.source, ...r })
      continue
    }
    return { lat: r.lat, lng: r.lng, source: a.source, matched: r.matched }
  }
  return null
}
