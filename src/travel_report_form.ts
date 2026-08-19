// ============================================================================
// 재무팀 제출용 「월 교통비 정산내역」 양식 생성
//
// 사내에서 실제로 쓰는 엑셀 양식(7월_영업팀 외근교통비 정산내역.xlsx)과 동일한
// 레이아웃·수식·서식으로 만듭니다. 재무팀이 열어서 바로 검산할 수 있도록
// 유류비/합계/청구액은 값이 아니라 **수식**으로 넣습니다.
//
// 양식 구조 (담당자 1명 = 시트 1장)
//   1행    : 부서 · 월 · 제목
//   3~4행  : 2단 병합 헤더
//   5행~   : 편도 구간 1건 = 1행  (하루에 여러 행)
//   합계행 : SUM
//   청구행 : 월 감가상각비 + 월 청구액(유류비+톨비+감가상각비)
//   Q~S열  : 차량정보 블록(내연기관/전기차 각 1개) + 기준유가 산정방법 안내
// ============================================================================

import { colName, type XlsxCell, type XlsxSheet, type XlsxStyle } from './xlsx'

/** 월 감가상각비 — 사내 고정비 (사용자 확인: 40만원 고정) */
export const MONTHLY_DEPRECIATION = 400000

// ── 스타일 인덱스 ────────────────────────────────────────────────────────────
// buildXlsx 의 styles 배열 순서와 반드시 일치해야 합니다 (셀의 s = 인덱스+1).
export const S = {
  TITLE: 1,        // 1행 제목 (bold 14pt)
  DEPT: 2,         // 부서/월 (bold 14pt, 우측)
  HEADER: 3,       // 2단 헤더 (bold, 회색배경, 중앙, 줄바꿈)
  DATE: 4,         // yyyy/mm/dd(요일)
  TEXT: 5,         // 일반 문자
  NUM: 6,          // 회계 숫자
  NUM_CALC: 7,     // 회계 숫자 + 계산셀 배경(FFD6DCE4)
  TOTAL: 8,        // 합계행 숫자 (bold + 회계)
  TOTAL_LBL: 9,    // 합계행 라벨 (bold 중앙)
  CLAIM: 10,       // 최종 청구액 (bold + 초록배경 FFE2EFD9)
  BLK_TITLE: 11,   // ■차량정보
  BLK_LBL: 12,     // 차량정보 항목명
  BLK_IN: 13,      // 차량정보 입력값 (파란 글씨 FF0070C0)
  BLK_NUM: 14,     // 차량정보 숫자 입력값 (파란 글씨 + 숫자서식)
  GUIDE: 15,       // 지급기준 설명 / 안내문
  GUIDE_T: 16,     // 안내문 제목 (bold)
  NOTE: 17,        // 비고 (줄바꿈)
  DIST: 18,        // 주행거리 (소수 1자리 회계)
  DIST_TOT: 19,    // 주행거리 합계 (bold)
} as const

/** 회계 형식 — 업로드 양식과 동일한 서식 코드 */
const ACCT = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@'
const ACCT2 = '_-* #,##0.0_-;\\-* #,##0.0_-;_-* "-"_-;_-@'

export const FORM_STYLES: XlsxStyle[] = [
  /* 1  TITLE     */ { bold: true, size: 14, valign: 'center' },
  /* 2  DEPT      */ { bold: true, size: 14, align: 'right', valign: 'center' },
  /* 3  HEADER    */ { bold: true, size: 10, align: 'center', valign: 'center', wrap: true, fill: 'FFF2F2F2', border: true },
  /* 4  DATE      */ { numFmt: 'yyyy/mm/dd\\(aaa\\)', size: 10, align: 'center', valign: 'center', border: true },
  /* 5  TEXT      */ { size: 10, align: 'center', valign: 'center', border: true },
  /* 6  NUM       */ { numFmt: ACCT, size: 10, valign: 'center', border: true },
  /* 7  NUM_CALC  */ { numFmt: ACCT, size: 10, valign: 'center', border: true, fill: 'FFD6DCE4' },
  /* 8  TOTAL     */ { numFmt: ACCT, size: 10, bold: true, valign: 'center', border: true, fill: 'FFF2F2F2' },
  /* 9  TOTAL_LBL */ { bold: true, size: 10, align: 'center', valign: 'center', border: true, fill: 'FFF2F2F2' },
  /* 10 CLAIM     */ { numFmt: ACCT, size: 10, bold: true, valign: 'center', border: true, fill: 'FFE2EFD9' },
  /* 11 BLK_TITLE */ { bold: true, size: 11, valign: 'center' },
  /* 12 BLK_LBL   */ { size: 10, align: 'center', valign: 'center', border: true, fill: 'FFF2F2F2' },
  /* 13 BLK_IN    */ { size: 10, color: 'FF0070C0', align: 'center', valign: 'center', border: true },
  /* 14 BLK_NUM   */ { numFmt: '#,##0.##', size: 10, color: 'FF0070C0', align: 'center', valign: 'center', border: true },
  /* 15 GUIDE     */ { size: 9, valign: 'center', wrap: true },
  /* 16 GUIDE_T   */ { bold: true, size: 9, valign: 'center' },
  /* 17 NOTE      */ { size: 9, valign: 'center', wrap: true, border: true },
  /* 18 DIST      */ { numFmt: ACCT2, size: 10, valign: 'center', border: true },
  /* 19 DIST_TOT  */ { numFmt: ACCT2, size: 10, bold: true, valign: 'center', border: true, fill: 'FFF2F2F2' },
]

// ── 주소 → 지역(시/군/구) ────────────────────────────────────────────────────

const SIDO_MAP: Record<string, string> = {
  '서울특별시': '서울시', '서울': '서울시',
  '부산광역시': '부산시', '부산': '부산시',
  '대구광역시': '대구시', '대구': '대구시',
  '인천광역시': '인천시', '인천': '인천시',
  '광주광역시': '광주광역시', '광주': '광주광역시',
  '대전광역시': '대전시', '대전': '대전시',
  '울산광역시': '울산시', '울산': '울산시',
  '세종특별자치시': '세종시', '세종': '세종시',
  '경기도': '경기도', '경기': '경기도',
  '강원특별자치도': '강원도', '강원도': '강원도', '강원': '강원도',
  '충청북도': '충북', '충북': '충북',
  '충청남도': '충남', '충남': '충남',
  '전북특별자치도': '전북', '전라북도': '전북', '전북': '전북',
  '전라남도': '전남', '전남': '전남',
  '경상북도': '경북', '경북': '경북',
  '경상남도': '경남', '경남': '경남',
  '제주특별자치도': '제주도', '제주도': '제주도', '제주': '제주도',
}

/**
 * 전체 주소에서 양식의 `지역(시/군/구)` 표기를 뽑습니다.
 *
 * 우리 DB 의 address 표기가 섞여 있어(`서울특별시 강남구` / `서울 중랑구` /
 * `경기도 성남시 분당구`) 시도명을 정규화한 뒤 그 다음 행정구역 1개를 붙입니다.
 * 광역시의 '구'는 시도+구, 도(道)는 시도+시/군 까지만 씁니다 (양식 샘플과 동일).
 *
 * @param address 전체 주소. 없으면 region 을 폴백으로 씁니다.
 * @param region  시도 단위 값 (hospitals.region)
 */
export function regionLabel(address?: string | null, region?: string | null): string {
  const addr = String(address || '').trim()
  if (addr) {
    const parts = addr.split(/\s+/)
    const sido = SIDO_MAP[parts[0]]
    if (sido) {
      // 두 번째 토막이 시/군/구 로 끝나면 함께 표기합니다.
      const second = parts[1] || ''
      if (/(시|군|구)$/.test(second)) return `${sido} ${second}`
      return sido
    }
    // 시도명이 생략된 주소(예: '전주시 덕진구 ...') 는 첫 토막만 씁니다.
    if (/(시|군|구)$/.test(parts[0])) return parts[0]
  }
  const r = String(region || '').trim()
  return r ? (SIDO_MAP[r] || r) : ''
}

// ── 연료 → 양식 차종 ─────────────────────────────────────────────────────────

/**
 * 양식 H열(차종). J열 수식이 "전기차" / "내연기관" 두 값으로만 분기하므로
 * 우리 4종(휘발유/경유/LPG/전기)을 두 값으로 매핑합니다.
 */
export function formVehicleKind(fuel?: string | null): '전기차' | '내연기관' {
  return String(fuel || '').toUpperCase() === 'ELECTRIC' ? '전기차' : '내연기관'
}

/** 차량정보 블록의 `차량구분` 표기 (원래 연료명을 그대로 남깁니다) */
export function fuelKindLabel(fuel?: string | null): string {
  const f = String(fuel || '').toUpperCase()
  if (f === 'ELECTRIC') return '전기차'
  if (f === 'DIESEL') return '경유'
  if (f === 'LPG') return 'LPG'
  return '휘발유'
}

// ── 셀 헬퍼 ──────────────────────────────────────────────────────────────────

export const c = (v: string | number | null | undefined, s?: number): XlsxCell => ({ v, s })
/**
 * 수식 셀. `cv` 에 서버에서 계산한 값을 함께 넣습니다.
 *
 * 수식만 넣으면 엑셀은 열 때 재계산하지만 구글시트·파일 미리보기·다른 도구에서는
 * 빈칸으로 보입니다. 재무팀이 어디서 열어도 숫자가 보이도록 값을 같이 저장합니다.
 */
export const cf = (f: string, s?: number, cv?: number | null): XlsxCell =>
  ({ f, s, cv: (typeof cv === 'number' && isFinite(cv)) ? cv : undefined })
export const cd = (v: string, s?: number): XlsxCell => ({ v, s, date: true })
export const blank = (s?: number): XlsxCell => ({ s })

/** 양식 한 행 = 편도 구간 1건 */
export type FormLeg = {
  /** 'YYYY-MM-DD' */
  date: string
  from_name: string
  from_region: string
  to_name: string
  to_region: string
  /** 주행거리 (km) */
  distance_km: number
  /** 톨비 (원). 그 날 실제 입력값을 마지막 구간에 몰아 넣습니다. */
  toll: number
  /** 그 날 쓴 차량의 연료 종류 (GASOLINE/DIESEL/LPG/ELECTRIC) — H열 차종 분기용 */
  fuel: string
  /** 주차비 (원) — 법인카드 */
  parking: number
  /** 기타 (원) — 법인카드 */
  etc: number
  note?: string
}

export type FormVehicle = {
  /** 차종 (예: 'BMW 220i') */
  model: string
  /** 연료 종류 원본값 (GASOLINE/DIESEL/LPG/ELECTRIC) */
  fuel: string
  /** 연비 (km/L) 또는 전비 (km/kWh) */
  efficiency: number
  /** 기준유가 (원/L) 또는 충전요금 (원/kWh) */
  price: number
}

export type FormSheetInput = {
  /** 시트명 = 담당자 이름 */
  userName: string
  department: string
  /** 정산 월 (1~12). 기간이 여러 달에 걸치면 null */
  month: number | null
  legs: FormLeg[]
  /** 내연기관 차량정보 블록 */
  ice: FormVehicle | null
  /** 전기차 차량정보 블록 */
  ev: FormVehicle | null
  /** 데이터 행 최소 개수 (양식처럼 빈 행도 수식을 유지) */
  minRows?: number
}

const HEAD_ROW = 3           // 2단 헤더 시작 행
const DATA_ROW = 5           // 데이터 시작 행

/** 기준유가 산정방법 안내문 — 업로드 양식 Q11~Q15 원문 그대로 */
const PRICE_GUIDE = [
  '기준유가 산정방법',
  '  [휘발유/경유] 한국석유공사 OPINET(https://www.opinet.co.kr)',
  "     >국내유가통계>주유소>평균판매가격>월간/서울/보통휘발유or자동차용경유 기준 유가",
  '  [전기차] 무공해차 통합누리집(https://ev.or.kr/nportal/main.do)',
  "     >전기차 소개>전기차 충전정보>전기차 충전요금>'기후에너지환경부'/'급속(100kw이상)'/'비회원가' 기준 충전요금",
]

/**
 * 차량정보 블록을 씁니다 (Q~S 열).
 *
 * @param rows      시트 행 배열 (직접 수정)
 * @param startRow  블록 시작 행 (1-based). ■차량정보 가 이 행에 들어갑니다.
 * @returns 이 블록의 연비 행·기준유가 행·감가상각비 행 번호 (수식 참조용)
 */
function writeVehicleBlock(
  rows: XlsxCell[][],
  startRow: number,
  v: FormVehicle | null,
  isEv: boolean,
): { effRow: number; priceRow: number; depRow: number } {
  const put = (r: number, colIdx: number, cell: XlsxCell) => {
    while (rows.length < r) rows.push([])
    const row = rows[r - 1]
    while (row.length <= colIdx) row.push(null as any)
    row[colIdx] = cell
  }
  // 0-based 열 인덱스
  const COL_Q = 16, COL_R = 17, COL_S = 18

  const modelRow = startRow + 2
  const kindRow = startRow + 3
  const effRow = startRow + 4
  const priceRow = startRow + 5
  const depRow = startRow + 6

  put(startRow, COL_Q, c(isEv ? '■차량정보 (전기차)' : '■차량정보 (내연기관)', S.BLK_TITLE))

  put(modelRow, COL_Q, c('차종', S.BLK_LBL))
  put(modelRow, COL_R, c(v?.model || (v ? '' : '해당 기간 운행 없음'), S.BLK_IN))

  put(kindRow, COL_Q, c('차량구분', S.BLK_LBL))
  put(kindRow, COL_R, c(v ? fuelKindLabel(v.fuel) : (isEv ? '전기차' : '휘발유'), S.BLK_IN))
  put(kindRow, COL_S, c('휘발유/경유/LPG/전기차 중 택일', S.GUIDE))

  // 이 칸은 J열 유류비 수식이 나눗셈으로 참조합니다.
  // 문자열('직접 입력')을 넣으면 수식이 오류가 되고 IFERROR 가 그걸 0 으로 삼켜
  // 「유류비 0원」이 조용히 맞는 값처럼 보입니다. 그래서 비었으면 셀을 비워 두고
  // 안내는 옆 칸(S열)에만 둡니다. J열 수식은 별도로 미입력을 감지해 경고를 냅니다.
  put(effRow, COL_Q, c(isEv ? '전비 (km/kWh)' : '연비 (km/L)', S.BLK_LBL))
  put(effRow, COL_R, v && v.efficiency > 0 ? c(v.efficiency, S.BLK_NUM) : blank(S.BLK_IN))
  put(effRow, COL_S, c(
    (v && v.efficiency > 0)
      ? (isEv ? '자동차등록증에 표기된 전비' : '자동차등록증에 표기된 연비')
      : (isEv ? '⚠️ 전비를 입력하세요 (자동차등록증 표기값)'
              : '⚠️ 연비를 입력하세요 (자동차등록증 표기값)'),
    S.GUIDE))

  put(priceRow, COL_Q, c(isEv ? '충전요금 (원/kWh)' : '기준유가 (원/L)', S.BLK_LBL))
  put(priceRow, COL_R, v && v.price > 0 ? c(v.price, S.BLK_NUM) : blank(S.BLK_IN))
  put(priceRow, COL_S, c(
    (v && v.price > 0)
      ? "(하단 '기준유가 산정방법' 참조)"
      : "⚠️ 값을 입력하세요 (하단 '기준유가 산정방법' 참조)",
    S.GUIDE))

  put(depRow, COL_Q, c('월 감가상각비', S.BLK_LBL))
  put(depRow, COL_R, c(MONTHLY_DEPRECIATION, S.BLK_NUM))
  put(depRow, COL_S, c('고정비', S.GUIDE))

  return { effRow, priceRow, depRow }
}

/**
 * 담당자 1명분의 「월 교통비 정산내역」 시트를 만듭니다.
 * 유류비(J)·합계(N)·총계·청구액은 모두 수식으로 넣어 재무팀이 검산할 수 있게 합니다.
 */
export function buildFormSheet(input: FormSheetInput): XlsxSheet {
  const rows: XlsxCell[][] = []
  const merges: string[] = []

  const put = (r: number, colIdx: number, cell: XlsxCell) => {
    while (rows.length < r) rows.push([])
    const row = rows[r - 1]
    while (row.length <= colIdx) row.push(null as any)
    row[colIdx] = cell
  }

  // ── 1행: 부서 · 월 · 제목 ──────────────────────────────────────────────────
  put(1, 1, c(input.department || '', S.DEPT))                    // B
  put(1, 2, c(input.month ?? '', S.DEPT))                        // C
  put(1, 3, c('월 교통비 정산내역', S.TITLE))                     // D

  // ── 3~4행: 2단 병합 헤더 ───────────────────────────────────────────────────
  const h = (colIdx: number, top: string, bottom?: string) => {
    put(HEAD_ROW, colIdx, c(top, S.HEADER))
    put(HEAD_ROW + 1, colIdx, c(bottom ?? '', S.HEADER))
  }
  h(1, '일자')                    // B3:B4
  h(2, '출발지', '업체명')         // C
  h(3, '', '지역(시/군/구)')       // D
  h(4, '도착지', '업체명')         // E
  h(5, '', '지역(시/군/구)')       // F
  h(6, '거리구분')                // G
  h(7, '차종')                    // H
  h(8, '주행거리\n(Km)')          // I
  h(9, '개인카드', '유류비')       // J
  h(10, '', '톨비')               // K
  h(11, '법인카드', '주차비')      // L
  h(12, '', '기타')               // M
  h(13, '', '합계')               // N
  h(14, '비고')                   // O

  merges.push(
    'B3:B4', 'C3:D3', 'E3:F3', 'G3:G4', 'H3:H4', 'I3:I4',
    'J3:K3', 'L3:N3', 'O3:O4',
  )

  // ── 차량정보 블록 2개 ──────────────────────────────────────────────────────
  // 내연기관 블록이 위(3행~), 전기차 블록이 아래(17행~) — 업로드 양식과 동일.
  const iceRef = writeVehicleBlock(rows, 3, input.ice, false)
  const evRef = writeVehicleBlock(rows, 17, input.ev, true)

  // 기준유가 산정방법 안내문 (내연기관 블록 아래)
  for (let i = 0; i < PRICE_GUIDE.length; i++) {
    put(11 + i, 16, c(PRICE_GUIDE[i], i === 0 ? S.GUIDE_T : S.GUIDE))
  }

  // ── 데이터 행 ──────────────────────────────────────────────────────────────
  const legs = input.legs
  const minRows = Math.max(input.minRows || 0, legs.length)
  const lastData = DATA_ROW + Math.max(minRows, 1) - 1

  // 수식과 같은 계산을 서버에서도 해 값을 함께 저장합니다 (엑셀 밖에서도 보이도록).
  // 연비·기준유가가 비어 있으면 계산할 수 없으므로 값 없이 수식만 남깁니다.
  const unitCost = (fuel?: string): number | null => {
    const isEv = formVehicleKind(fuel) === '전기차'
    const v = isEv ? input.ev : input.ice
    if (!v || !(v.efficiency > 0) || !(v.price > 0)) return null
    return v.price / v.efficiency
  }

  // 합계 검산용 누적값 — 하나라도 계산 불가면 null 로 두어 합계도 비웁니다.
  let sumDist = 0
  let sumFuel: number | null = 0
  let sumToll = 0, sumPark = 0, sumEtc = 0

  for (let i = 0; i < Math.max(minRows, 1); i++) {
    const r = DATA_ROW + i
    const l = legs[i]

    put(r, 1, l ? cd(l.date, S.DATE) : blank(S.DATE))
    put(r, 2, c(l?.from_name ?? '', S.TEXT))
    put(r, 3, c(l?.from_region ?? '', S.TEXT))
    put(r, 4, c(l?.to_name ?? '', S.TEXT))
    put(r, 5, c(l?.to_region ?? '', S.TEXT))
    put(r, 6, c(l ? '편도' : '', S.TEXT))
    put(r, 7, c(l ? formVehicleKind(l.fuel) : '', S.TEXT))
    put(r, 8, l ? c(round1(l.distance_km), S.DIST) : blank(S.DIST))

    // J열 유류비 = 기준유가 ÷ 연비 × 주행거리. 차종 문자열로 블록을 골라 참조합니다.
    const dist = l ? round1(l.distance_km) : 0
    const unit = l ? unitCost(l.fuel) : 0
    const fuelAmt = (l && unit !== null) ? unit * dist : (l ? null : 0)
    if (fuelAmt === null) sumFuel = null
    else if (sumFuel !== null) sumFuel += fuelAmt

    // 연비·기준유가가 비어 있으면 0 원이 아니라 '연비/유가 입력' 이라고 알려 줍니다.
    // 원본은 IFERROR 로 0 을 냈지만, 그러면 미입력과 실제 0 원을 구분할 수 없습니다.
    const evOk = `AND(ISNUMBER($R$${evRef.priceRow}),ISNUMBER($R$${evRef.effRow}))`
    const iceOk = `AND(ISNUMBER($R$${iceRef.priceRow}),ISNUMBER($R$${iceRef.effRow}))`
    put(r, 9, cf(
      `IF(N(I${r})=0,0,` +
      `IF(TRIM(H${r})="전기차",` +
        `IF(${evOk},$R$${evRef.priceRow}/$R$${evRef.effRow}*I${r},"연비/유가 입력"),` +
      `IF(TRIM(H${r})="내연기관",` +
        `IF(${iceOk},$R$${iceRef.priceRow}/$R$${iceRef.effRow}*I${r},"연비/유가 입력"),` +
      `0)))`,
      S.NUM_CALC, fuelAmt
    ))
    const toll = (l && l.toll) ? l.toll : 0
    const park = (l && l.parking) ? l.parking : 0
    const etc = (l && l.etc) ? l.etc : 0
    sumDist += dist; sumToll += toll; sumPark += park; sumEtc += etc

    put(r, 10, toll ? c(toll, S.NUM) : blank(S.NUM))
    put(r, 11, park ? c(park, S.NUM) : blank(S.NUM))
    put(r, 12, etc ? c(etc, S.NUM) : blank(S.NUM))
    put(r, 13, cf(`SUM(L${r}:M${r})`, S.NUM, park + etc))
    put(r, 14, c(l?.note ?? '', S.NOTE))
  }

  // ── 합계 행 ────────────────────────────────────────────────────────────────
  const sumRow = lastData + 1
  // 원본과 동일하게 B~G(거리구분)까지만 병합합니다. H(차종)은 병합하지 않습니다.
  put(sumRow, 1, c('합계', S.TOTAL_LBL))
  for (let ci = 2; ci <= 6; ci++) put(sumRow, ci, blank(S.TOTAL_LBL))
  put(sumRow, 7, blank(S.TOTAL_LBL))
  merges.push(`B${sumRow}:G${sumRow}`)
  put(sumRow, 8, cf(`SUM(I${DATA_ROW}:I${lastData})`, S.DIST_TOT, round1(sumDist)))
  const sumVals: Record<number, number | null> = {
    9: sumFuel, 10: sumToll, 11: sumPark, 12: sumEtc, 13: sumPark + sumEtc,
  }
  for (const ci of [9, 10, 11, 12, 13]) {
    const col = colName(ci)
    const range = `${col}${DATA_ROW}:${col}${lastData}`
    // 유류비 열은 미입력 시 '연비/유가 입력' 문자열이 섞입니다. SUM 은 문자열을
    // 그냥 무시하므로 합계가 조용히 작아집니다 — 그런 칸이 있으면 합계도 경고를 냅니다.
    const f = ci === 9
      ? `IF(COUNTIF(${range},"연비/유가 입력")>0,"연비/유가 입력 필요",SUM(${range}))`
      : `SUM(${range})`
    put(sumRow, ci, cf(f, S.TOTAL, sumVals[ci]))
  }
  put(sumRow, 14, blank(S.TOTAL_LBL))

  // ── 청구 행 ────────────────────────────────────────────────────────────────
  // 감가상각비는 차량정보 블록(내연기관)의 값을 참조합니다 — 한 곳만 고치면 되도록.
  const claimRow = sumRow + 1
  put(claimRow, 4, c('월 감가상각비', S.TOTAL_LBL))
  put(claimRow, 5, cf(`$R$${iceRef.depRow}`, S.TOTAL, MONTHLY_DEPRECIATION))
  put(claimRow, 8, c('월 청구액', S.TOTAL_LBL))
  // J 합계가 경고 문자열이면 더하기가 #VALUE! 로 깨집니다 — 같은 경고로 넘깁니다.
  put(claimRow, 9, cf(
    `IF(ISNUMBER(J${sumRow}),J${sumRow}+K${sumRow}+F${claimRow},"연비/유가 입력 필요")`,
    S.CLAIM,
    sumFuel === null ? null : sumFuel + sumToll + MONTHLY_DEPRECIATION))
  for (let ci = 10; ci <= 13; ci++) put(claimRow, ci, blank(S.CLAIM))
  merges.push(`K${claimRow}:N${claimRow}`)

  return {
    name: input.userName || '정산내역',
    cols: FORM_COLS,
    rows,
    merges,
    freeze: `A${DATA_ROW}`,
    rowHeights: { 1: 22, [HEAD_ROW]: 18, [HEAD_ROW + 1]: 30 },
  }
}

function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10
}

/**
 * 「○○○ 증빙」 시트 — 영수증 이미지를 붙여넣는 자리.
 * 이미지는 시스템이 만들 수 없으므로 안내문만 넣어 자리를 만들어 둡니다.
 */
export function buildEvidenceSheet(userName: string): XlsxSheet {
  const rows: XlsxCell[][] = []
  const put = (r: number, colIdx: number, cell: XlsxCell) => {
    while (rows.length < r) rows.push([])
    const row = rows[r - 1]
    while (row.length <= colIdx) row.push(null as any)
    row[colIdx] = cell
  }
  put(2, 1, c('■ 증빙 자료 첨부란', S.BLK_TITLE))
  put(4, 1, c('아래에 주차비·기타 비용 영수증 이미지를 붙여넣어 주세요.', S.GUIDE))
  put(5, 1, c('(정산내역 시트의 법인카드 주차비·기타 항목과 건별로 대응되도록 순서를 맞춰 주세요.)', S.GUIDE))
  put(7, 1, c('※ 영수증 이미지는 시스템에서 자동 생성할 수 없어 담당자가 직접 첨부해야 합니다.', S.GUIDE))
  return {
    name: `${userName} 증빙`.substring(0, 31),
    cols: [3.4, 60, 40, 40],
    rows,
  }
}

/**
 * 「○○○ 증빙 톨게이트」 시트 — 하이패스 `기간별_사용내역` 을 붙여넣는 자리.
 * 원본과 같은 21열 헤더를 미리 만들어 두어 그대로 붙여넣을 수 있게 합니다.
 */
export function buildTollEvidenceSheet(userName: string, periodLabel: string): XlsxSheet {
  const rows: XlsxCell[][] = []
  const put = (r: number, colIdx: number, cell: XlsxCell) => {
    while (rows.length < r) rows.push([])
    const row = rows[r - 1]
    while (row.length <= colIdx) row.push(null as any)
    row[colIdx] = cell
  }

  const HEAD = [
    '번호', '입구일시', '출구일시', '거래일시', '구분', '카드번호', '카드별명', '차종',
    '입구', '출구', '수납', '이용차로', '구간사업자', '기준통행료', '납부할통행료',
    '선불환불차감금액', '청구금액', '거래후잔액', '부가세', '청구일자', '비고',
  ]

  put(1, 0, c('기간별_사용내역', S.TITLE))
  put(2, 0, c(`사용기간: ${periodLabel}`, S.GUIDE))
  put(3, 0, c('※ 한국도로공사 하이패스 이용내역을 이 시트에 그대로 붙여넣어 주세요.', S.GUIDE))
  put(4, 0, c("   (하이패스 홈페이지 > 이용내역 조회 > 기간별 사용내역 > 엑셀 내려받기)", S.GUIDE))
  for (let i = 0; i < HEAD.length; i++) put(5, i, c(HEAD[i], S.HEADER))

  return {
    name: `${userName} 증빙 톨게이트`.substring(0, 31),
    cols: [6, 17, 17, 17, 8, 20, 12, 8, 14, 14, 10, 10, 14, 12, 14, 16, 12, 12, 10, 12, 14],
    rows,
    merges: ['A1:U1'],
    freeze: 'A6',
    rowHeights: { 5: 28 },
  }
}

/** 열 너비 — 업로드 양식 실측값 (A..T) */
export const FORM_COLS = [
  3.4,   // A 여백
  12.7,  // B 일자
  12.6,  // C 출발지 업체명
  14.0,  // D 출발지 지역
  12.6,  // E 도착지 업체명
  14.0,  // F 도착지 지역
  8.0,   // G 거리구분
  11.6,  // H 차종
  10.6,  // I 주행거리
  12.6,  // J 유류비
  10.6,  // K 톨비
  10.3,  // L 주차비
  10.3,  // M 기타
  10.4,  // N 합계
  22.3,  // O 비고
  6.6,   // P 여백
  16.9,  // Q 항목명
  16.0,  // R 값
  28.0,  // S 지급기준
  9.0,   // T
]
