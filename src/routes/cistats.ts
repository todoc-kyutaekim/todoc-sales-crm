import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const cistats = new Hono<{ Bindings: Bindings }>()

cistats.get('/', async (c) => {
  const [ioAll, age10All, age5All, regionAll, instAll] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient ORDER BY year ASC, gender ASC").all(),
    c.env.DB.prepare("SELECT * FROM ci_age10_stats WHERE gender != '계' AND age_group NOT IN ('계','소계') ORDER BY year ASC, gender ASC, id ASC").all(),
    c.env.DB.prepare("SELECT * FROM ci_age5_stats WHERE gender != '계' AND age_group NOT IN ('계','소계') ORDER BY year ASC, gender ASC, id ASC").all(),
    c.env.DB.prepare("SELECT * FROM ci_region_stats WHERE region != '계' ORDER BY year ASC, patients DESC").all(),
    c.env.DB.prepare("SELECT * FROM ci_institution_stats WHERE institution_type != '계' ORDER BY year ASC, patients DESC").all(),
  ])

  const ioTotals = (ioAll.results as any[]).filter(r => r.gender === '계' && r.visit_type === '계')
  const ioMale = (ioAll.results as any[]).filter(r => r.gender === '남' && r.visit_type === '소계')
  const ioFemale = (ioAll.results as any[]).filter(r => r.gender === '여' && r.visit_type === '소계')

  const yearlyData = ioTotals.map(t => {
    const m = ioMale.find(x => x.year === t.year)
    const f = ioFemale.find(x => x.year === t.year)
    return {
      year: t.year, patients: t.patients, usage: t.usage, amount: t.amount,
      male_patients: m?.patients || 0, male_usage: m?.usage || 0, male_amount: m?.amount || 0,
      female_patients: f?.patients || 0, female_usage: f?.usage || 0, female_amount: f?.amount || 0
    }
  })

  const regionData = regionAll.results as any[]
  const years = [...new Set(regionData.map((r: any) => r.year))].sort()
  const instData = instAll.results as any[]

  // Insights
  const insights: any[] = []
  if (yearlyData.length >= 2) {
    const first = yearlyData[0], last = yearlyData[yearlyData.length - 1]
    const cagrP = (Math.pow(last.patients / first.patients, 1 / (last.year - first.year)) - 1) * 100
    const cagrU = (Math.pow(last.usage / first.usage, 1 / (last.year - first.year)) - 1) * 100
    insights.push({ icon: 'fa-chart-line', title: '환자수 연평균 성장률', value: cagrP.toFixed(1) + '%', desc: first.year + '년 ' + first.patients + '명 → ' + last.year + '년 ' + last.patients + '명' })
    insights.push({ icon: 'fa-arrow-trend-up', title: '수술건수 연평균 성장률', value: cagrU.toFixed(1) + '%', desc: first.year + '년 ' + first.usage + '건 → ' + last.year + '년 ' + last.usage + '건' })
    const totalM = yearlyData.reduce((a, b) => a + b.male_patients, 0)
    const totalF = yearlyData.reduce((a, b) => a + b.female_patients, 0)
    const total = totalM + totalF
    if (total > 0) insights.push({ icon: 'fa-venus-mars', title: '성비 (남:여)', value: (totalM / total * 100).toFixed(1) + ':' + (totalF / total * 100).toFixed(1), desc: '전체 기간 누적 성비' })
    const totalAmount = yearlyData.reduce((a, b) => a + b.amount, 0)
    const totalAmountWon = totalAmount * 1000 // convert from 천원 to 원
    const amountBillions = (totalAmountWon / 100000000).toFixed(1) // 억원
    // ⚠️ 연도를 하드코딩하지 않습니다 — 데이터가 있는 실제 기간에서 계산합니다.
    //    (2025년 데이터가 추가되면 자동으로 '7년간 / 2019-2025 누적' 으로 바뀝니다)
    const spanYears = last.year - first.year + 1
    insights.push({ icon: 'fa-won-sign', title: spanYears + '년간 총 진료금액', value: amountBillions + '억원', desc: first.year + '-' + last.year + ' 누적' })
  }

  const latestYear = years[years.length - 1] as number
  const latestRegion = regionData.filter((r: any) => r.year === latestYear)
  const totalRegPat = latestRegion.reduce((a: number, b: any) => a + b.patients, 0)
  const seoulGyeonggi = latestRegion.filter((r: any) => r.region === '서울' || r.region === '경기').reduce((a: number, b: any) => a + b.patients, 0)
  if (totalRegPat > 0) insights.push({ icon: 'fa-city', title: '수도권 집중도', value: (seoulGyeonggi / totalRegPat * 100).toFixed(1) + '%', desc: latestYear + '년 서울+경기 환자 비율' })

  // ─────────────────────────────────────────────────────────────────
  // 심층 분석 (analytics) — 16개년 데이터에서 계산합니다.
  // ⚠️ 모든 값은 HIRA 실측치에서만 산출하며, 추정·예측치를 섞지 않습니다.
  // ─────────────────────────────────────────────────────────────────
  const a10rows = (age10All.results as any[])   // 이미 gender!='계', age_group not in ('계','소계') 로 필터됨
  const ageSum = (y: number, groups: string[]) =>
    a10rows.filter(r => r.year === y && groups.includes(r.age_group))
           .reduce((a, b) => a + b.patients, 0)
  const ageTotal = (y: number) =>
    a10rows.filter(r => r.year === y).reduce((a, b) => a + b.patients, 0)

  const PED = ['0_9세', '10_19세']
  const SENIOR = ['60_69세', '70_79세', '80세이상']

  // 연령 코호트 추이 (소아 vs 성인 vs 60세+)
  const cohortTrend = years.map((y: any) => {
    const t = ageTotal(y), ped = ageSum(y, PED), sen = ageSum(y, SENIOR)
    return {
      year: y, total: t, pediatric: ped, adult: t - ped, senior: sen,
      pediatricShare: t ? +(ped / t * 100).toFixed(1) : 0,
      adultShare: t ? +((t - ped) / t * 100).toFixed(1) : 0,
      seniorShare: t ? +(sen / t * 100).toFixed(1) : 0
    }
  })

  // 지역 집중도 (HHI · 수도권 비중) 추이
  const concentration = years.map((y: any) => {
    const rs = regionData.filter((r: any) => r.year === y)
    const t = rs.reduce((a: number, b: any) => a + b.patients, 0)
    if (!t) return { year: y, seoulShare: 0, capitalShare: 0, top3Share: 0, hhi: 0 }
    const get = (n: string) => (rs.find((r: any) => r.region === n)?.patients || 0)
    const sorted = rs.map((r: any) => r.patients).sort((a: number, b: number) => b - a)
    return {
      year: y,
      seoulShare: +(get('서울') / t * 100).toFixed(1),
      capitalShare: +((get('서울') + get('경기') + get('인천')) / t * 100).toFixed(1),
      top3Share: +(sorted.slice(0, 3).reduce((a: number, b: number) => a + b, 0) / t * 100).toFixed(1),
      hhi: Math.round(rs.reduce((a: number, b: any) => a + Math.pow(b.patients / t * 100, 2), 0))
    }
  })

  // 금액 증가를 물량(건수) 기여 / 단가(건당) 기여로 분해
  const amountDecomp = yearlyData.slice(1).map((cur, i) => {
    const prv = yearlyData[i]
    const unitPrev = prv.amount / prv.usage, unitCur = cur.amount / cur.usage
    return {
      year: cur.year,
      amountGrowth: +((cur.amount / prv.amount - 1) * 100).toFixed(1),
      volumeContrib: +((cur.usage / prv.usage - 1) * 100).toFixed(1),
      priceContrib: +((unitCur / unitPrev - 1) * 100).toFixed(1),
      unitCost: Math.round(cur.amount * 1000 / cur.usage)   // 원
    }
  })

  // 지역별 16개년 성장 (CAGR)
  const fy = years[0] as number, ly2 = years[years.length - 1] as number
  const regionGrowth = [...new Set(regionData.map((r: any) => r.region))].map((reg: any) => {
    const a = regionData.find((r: any) => r.year === fy && r.region === reg)?.patients || 0
    const b = regionData.find((r: any) => r.year === ly2 && r.region === reg)?.patients || 0
    const cum = regionData.filter((r: any) => r.region === reg).reduce((s: number, r: any) => s + r.patients, 0)
    return {
      region: reg, first: a, last: b, cumulative: cum,
      // ⚠️ 시작 또는 종료 연도가 0명이면 CAGR 이 정의되지 않으므로 null 로 둡니다 (Infinity 방지)
      cagr: (a > 0 && b > 0) ? +((Math.pow(b / a, 1 / (ly2 - fy)) - 1) * 100).toFixed(2) : null
    }
  }).sort((x: any, y3: any) => (y3.cagr ?? -999) - (x.cagr ?? -999))

  // ─────────────────────────────────────────────────────────────────
  // [확장 1] 환자당 수술건수 — 양측이식·재수술 대리지표
  // ⚠️ HIRA 공개통계에는 양측/재수술 플래그가 없습니다.
  //    "환자 1명당 청구된 수술 건수"는 양측이식 또는 재수술이 늘면 함께 오르므로
  //    직접 지표가 아닌 '대리지표(proxy)'로만 해석해야 합니다.
  const procPerPatient = yearlyData.map(d => ({
    year: d.year, patients: d.patients, usage: d.usage,
    ratio: d.patients ? +(d.usage / d.patients).toFixed(4) : 0,
    excess: d.usage - d.patients            // 환자수를 초과하는 건수 (양측/재수술 추정 하한)
  }))

  // [확장 2] 연령 코호트별 성장 기여도 분해 (5세 구간 재집계)
  //    최신연도 증가분(Δ) 중 각 연령대가 차지한 몫 = 어느 연령층이 성장을 만들었는지
  const a5rows = (age5All.results as any[])
  const A5 = {
    '0-19': ['5세미만', '5_9세', '10_14세', '15_19세'],
    '20-39': ['20_24세', '25_29세', '30_34세', '35_39세'],
    '40-59': ['40_44세', '45_49세', '50_54세', '55_59세'],
    '60-74': ['60_64세', '65_69세', '70_74세'],
    '75+': ['75_79세', '80세이상']
  } as Record<string, string[]>
  const a5Sum = (y: number, gs: string[]) =>
    a5rows.filter(r => r.year === y && gs.includes(r.age_group)).reduce((a, b) => a + b.patients, 0)
  // 기여도 기준연도: 아래 [확장 5]에서 탐지한 구조 변화 시점(breakYear)을 그대로 씁니다.
  //   ⚠️ breakYear 는 아래에서 계산되므로, 여기서는 계산을 미루고 함수로 감싸 둡니다.
  //      (선언 순서 문제를 피하려고 ageContribution 은 breakYear 확정 후에 만듭니다)
  // [확장 3] 기관 종별 집중도 (HHI + 상급종합 금액비중)
  const instConcentration = years.map((y: any) => {
    const rs = instData.filter((r: any) => r.year === y)
    const tp = rs.reduce((a: number, b: any) => a + b.patients, 0)
    const ta = rs.reduce((a: number, b: any) => a + b.amount, 0)
    const tert = rs.find((r: any) => r.institution_type === '상급종합병원')
    return {
      year: y,
      hhi: tp ? Math.round(rs.reduce((a: number, b: any) => a + Math.pow(b.patients / tp * 100, 2), 0)) : 0,
      tertiaryPatientShare: tp && tert ? +(tert.patients / tp * 100).toFixed(1) : 0,
      tertiaryAmountShare: ta && tert ? +(tert.amount / ta * 100).toFixed(1) : 0
    }
  })

  // [확장 4] 성별 추이 (여성 비중)
  const genderTrend = yearlyData.map(d => {
    const t = d.male_patients + d.female_patients
    return {
      year: d.year, male: d.male_patients, female: d.female_patients,
      femaleShare: t ? +(d.female_patients / t * 100).toFixed(1) : 0
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // [확장 5] 구조 변화 탐지 (structural break)
  // 시작연도를 뒤로 옮기며 선형 적합도(R²)를 재계산해, 추세가 안정화된 시점을 찾습니다.
  // 16개년 전체 회귀는 R²가 낮은데(초기 등락) 특정 연도 이후부터 급격히 높아지면
  //    그 지점을 '성장 국면 전환점'으로 보고 예측 기준구간으로 채택합니다.
  // ─────────────────────────────────────────────────────────────────
  const linreg = (xs: number[], ys: number[]) => {
    const n = xs.length
    if (n < 3) return null
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
    const sxx = xs.reduce((a, x) => a + Math.pow(x - mx, 2), 0)
    if (!sxx) return null
    const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0)
    const slope = sxy / sxx, intercept = my - slope * mx
    const sst = ys.reduce((a, y) => a + Math.pow(y - my, 2), 0)
    const sse = ys.reduce((a, y, i) => a + Math.pow(y - (intercept + slope * xs[i]), 2), 0)
    return {
      slope, intercept,
      r2: sst ? 1 - sse / sst : 0,
      se: n > 2 ? Math.sqrt(sse / (n - 2)) : 0     // 잔차 표준오차 → 예측 밴드 폭
    }
  }

  const patSeries = yearlyData.map(d => d.patients)
  const breakScan = years.slice(0, Math.max(1, years.length - 4)).map((cut: any) => {
    const idx = yearlyData.map((d, i) => ({ d, i })).filter(o => o.d.year >= cut)
    const lr = linreg(idx.map(o => o.d.year), idx.map(o => o.d.patients))
    return { fromYear: cut, n: idx.length, r2: lr ? +lr.r2.toFixed(4) : null, slope: lr ? +lr.slope.toFixed(1) : null }
  })
  // 전환점 선정 규칙 — ⚠️ "R²가 가장 높은 구간"을 그냥 고르면 안 됩니다.
  //   표본이 적을수록 R²는 자동으로 높아지므로(과적합), 그렇게 뽑으면 항상 최근 4~5년만
  //   남아 예측이 과격해집니다. 따라서 «적합도 임계치를 만족하는 가장 이른 연도»를 택해
  //   표본 수를 최대한 확보합니다. (설명력 확보 + 표본 확보의 균형)
  const R2_THRESHOLD = 0.95
  const MIN_N = 6
  const breakCand = breakScan.filter(b => b.n >= MIN_N && b.r2 !== null)
  const qualified = breakCand.filter(b => (b.r2 as number) >= R2_THRESHOLD)
  const breakYear = qualified.length
    // 임계치를 넘는 구간 중 가장 이른(=표본이 가장 많은) 시작연도
    ? qualified.reduce((best, cur) => (cur.fromYear < best.fromYear ? cur : best)).fromYear
    // 임계치를 넘는 구간이 없으면 차선책으로 적합도 최대 구간
    : (breakCand.length
        ? breakCand.reduce((best, cur) => ((cur.r2 as number) > (best.r2 as number) ? cur : best)).fromYear
        : years[0])
  const breakRule = 'R² ≥ ' + R2_THRESHOLD + ' 을 만족하는 구간 중 표본이 가장 많은(가장 이른) 시작연도를 채택 — 표본이 적을수록 R²가 자동 상승하는 과적합을 피하기 위함'

  // [확장 2 계속] 연령 기여도 — 기준연도를 breakYear 로 맞춰 구조 변화 이후의 성장 주체를 봅니다.
  const contribBase = breakYear as number
  const contribLast = latestYear
  const cbTotal = Object.values(A5).reduce((a, gs) => a + a5Sum(contribBase, gs), 0)
  const clTotal = Object.values(A5).reduce((a, gs) => a + a5Sum(contribLast, gs), 0)
  const totalDelta = clTotal - cbTotal
  const ageContribution = Object.keys(A5).map(k => {
    const b = a5Sum(contribBase, A5[k]), l = a5Sum(contribLast, A5[k])
    return {
      band: k, base: b, last: l, delta: l - b,
      // ⚠️ 총 증가분이 0이면 기여율이 정의되지 않으므로 null
      contribution: totalDelta !== 0 ? +((l - b) / totalDelta * 100).toFixed(1) : null,
      baseShare: cbTotal ? +(b / cbTotal * 100).toFixed(1) : 0,
      lastShare: clTotal ? +(l / clTotal * 100).toFixed(1) : 0
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // [확장 6] 2026~2030 전망 (forecast)
  // 🔴 아래 값은 실측치가 아닌 «추정치»입니다. 3가지 방법을 병렬로 계산하고
  //    회귀 잔차 표준오차(±1.96se)로 신뢰구간 밴드를 함께 제공합니다.
  //    방법이 서로 다른 값을 내는 것 자체가 불확실성의 크기이므로 하나로 합치지 않습니다.
  // ─────────────────────────────────────────────────────────────────
  const HORIZON = 5
  const buildForecast = (key: 'patients' | 'usage' | 'amount') => {
    const base = yearlyData.filter(d => d.year >= breakYear)
    const xs = base.map(d => d.year), ys = base.map(d => (d as any)[key] as number)
    if (ys.length < 3 || ys.some(v => v <= 0)) return null
    const lin = linreg(xs, ys)
    const log = linreg(xs, ys.map(v => Math.log(v)))
    if (!lin || !log) return null
    const growth = Math.exp(log.slope) - 1                       // 로그선형 = 복리 성장률
    const spanCagr = Math.pow(ys[ys.length - 1] / ys[0], 1 / (xs[xs.length - 1] - xs[0])) - 1
    const lastY = xs[xs.length - 1], lastV = ys[ys.length - 1]
    const points = [] as any[]
    for (let i = 1; i <= HORIZON; i++) {
      const fy = lastY + i
      const linear = lin.intercept + lin.slope * fy
      const loglinear = Math.exp(log.intercept + log.slope * fy)
      const cagr = lastV * Math.pow(1 + spanCagr, i)
      const cands = [linear, loglinear, cagr]
      // 밴드: 선형회귀 예측구간(±1.96·se)과 3방법의 최소/최대를 함께 감싸 보수적으로 잡습니다.
      const band = 1.96 * lin.se * Math.sqrt(1 + i / ys.length)
      points.push({
        year: fy,
        linear: Math.round(linear),
        loglinear: Math.round(loglinear),
        cagr: Math.round(cagr),
        mid: Math.round((linear + loglinear + cagr) / 3),
        low: Math.round(Math.max(0, Math.min(...cands) - band)),
        high: Math.round(Math.max(...cands) + band)
      })
    }
    return {
      metric: key, baseFrom: breakYear, baseTo: lastY, baseN: ys.length,
      linearSlope: +lin.slope.toFixed(1), linearR2: +lin.r2.toFixed(4),
      loglinearGrowth: +(growth * 100).toFixed(2), loglinearR2: +log.r2.toFixed(4),
      baseCagr: +(spanCagr * 100).toFixed(2),
      se: +lin.se.toFixed(1),
      lastYear: lastY, lastValue: lastV,
      points
    }
  }

  const forecast = {
    // ⚠️ 이 객체 전체가 추정치입니다. UI에서 반드시 «추정» 배지와 함께 노출하세요.
    isEstimate: true,
    method: '① 선형회귀(OLS) ② 로그선형(복리성장) ③ 기준구간 CAGR — 3방법 병렬 산출',
    baseFrom: breakYear,
    horizon: HORIZON,
    caveat: 'HIRA 실측 추세의 외삽(extrapolation)이며, 급여기준 변경·신규 진입·수가 조정 등 정책 이벤트는 반영되지 않았습니다. 실적이 아닌 참고용 추정치입니다.',
    patients: buildForecast('patients'),
    usage: buildForecast('usage'),
    amount: buildForecast('amount')
  }

  // ─────────────────────────────────────────────────────────────────
  // [확장 7] 기기 시장규모 추정 (가정 명시형)
  // 🔴 HIRA 진료금액은 «요양급여비용» 이며 기기(디바이스) 매출액이 아닙니다.
  //    아래는 "수술건수 × 세트단가" 라는 단순 가정으로 환산한 참고 추정치이며,
  //    단가는 공개 보도 범위(약 2,000만원 내외)를 시나리오로 나눠 제시합니다.
  //    실제 납품가·판매가는 확인되지 않았으므로 단일 값으로 확정하지 마세요.
  // ─────────────────────────────────────────────────────────────────
  const SET_PRICE_SCENARIOS = [
    { label: '보수적', unitPriceWon: 15000000 },
    { label: '기준', unitPriceWon: 20000000 },
    { label: '적극적', unitPriceWon: 25000000 }
  ]
  const deviceMarket = {
    isEstimate: true,
    basis: '수술건수(HIRA 실측) × 세트단가(공개 보도 기준 가정)',
    caveat: 'HIRA 진료금액(요양급여비용)과는 산식이 다른 별개 추정입니다. 세트단가는 확인된 실거래가가 아니며, 외부장치 단독 교체·부속품 매출은 제외되어 과소 추정될 수 있습니다.',
    priceNote: '인공와우 1 set 비용 약 2,000만원 수준으로 보도된 값을 «기준» 시나리오로 두고 ±25% 범위를 함께 제시합니다.',
    scenarios: SET_PRICE_SCENARIOS.map(sc => ({
      label: sc.label,
      unitPriceWon: sc.unitPriceWon,
      // 최신 실측 수술건수 기준
      latestYear: latestYear,
      latestUsage: yearlyData.length ? yearlyData[yearlyData.length - 1].usage : 0,
      latestMarketWon: yearlyData.length ? yearlyData[yearlyData.length - 1].usage * sc.unitPriceWon : 0,
      // 전망 수술건수(추정) 기준 — 추정 × 가정이므로 불확실성이 이중으로 누적됩니다.
      projected: (forecast.usage?.points || []).map((p: any) => ({
        year: p.year, usageMid: p.mid, marketWon: p.mid * sc.unitPriceWon
      }))
    }))
  }

  // 코호트 요약 인사이트 — 이 시장의 가장 큰 구조 변화
  if (cohortTrend.length >= 2) {
    const c0 = cohortTrend[0], c1 = cohortTrend[cohortTrend.length - 1]
    insights.push({
      icon: 'fa-person-cane', title: '60세 이상 비중', value: c1.seniorShare + '%',
      desc: c0.year + '년 ' + c0.seniorShare + '% → ' + c1.year + '년 ' + c1.seniorShare + '% (' +
            (c1.seniorShare - c0.seniorShare > 0 ? '+' : '') + (c1.seniorShare - c0.seniorShare).toFixed(1) + '%p)'
    })
    insights.push({
      icon: 'fa-child-reaching', title: '소아(0-19세) 비중', value: c1.pediatricShare + '%',
      desc: c0.year + '년 ' + c0.pediatricShare + '% → ' + c1.year + '년 ' + c1.pediatricShare + '% (' +
            (c1.pediatricShare - c0.pediatricShare).toFixed(1) + '%p)'
    })
    if (c0.senior > 0) {
      insights.push({
        icon: 'fa-arrow-up-right-dots', title: '60세 이상 환자 증가',
        value: (c1.senior / c0.senior).toFixed(1) + '배',
        desc: c0.year + '년 ' + c0.senior + '명 → ' + c1.year + '년 ' + c1.senior + '명'
      })
    }
  }
  if (yearlyData.length >= 2) {
    const f2 = yearlyData[0], l2 = yearlyData[yearlyData.length - 1]
    const u0 = f2.amount * 1000 / f2.usage, u1 = l2.amount * 1000 / l2.usage
    insights.push({
      icon: 'fa-tags', title: '건당 진료금액', value: (u1 / 10000).toFixed(0) + '만원',
      desc: f2.year + '년 ' + (u0 / 10000).toFixed(0) + '만원 → ' + ((u1 / u0 - 1) * 100).toFixed(0) + '% 상승'
    })
  }

  // ═════════════════════════════════════════════════════════════════
  // [영업 전략] HIRA 시장 실측 × CRM 영업 실적 교차 분석
  //
  // 🔴 전제 — HIRA 공개통계에는 «요양기관(병원)별» 데이터가 존재하지 않습니다.
  //    (지역·기관종별까지만 공개) 따라서 "어느 병원을 공략할지"는 HIRA 단독으로
  //    도출할 수 없고, 반드시 CRM에 등록된 실제 병원 목록과 교차해야 합니다.
  //    아래 지역 단위 지표(환자수·성장률)는 HIRA 실측이고,
  //    병원 단위 지표(단계·미팅·키맨)는 CRM 실측입니다. 추정치는 쓰지 않습니다.
  //
  // ⚠️ 사용하지 않은 필드 — hospitals.patient_count / ci_referrals / hearing_aid_sales
  //    세 컬럼은 전 행이 0(미입력)이어서 근거로 쓸 수 없습니다. 대신 실제로 기록이
  //    남아 있는 «미팅 횟수 / 파이프라인 단계 / 키맨(영향력 high) 수»만 사용합니다.
  // ═════════════════════════════════════════════════════════════════
  const STAGES = ['contact', 'meeting', 'demo', 'proposal', 'contract', 'active_customer']
  const STAGE_LABELS: Record<string, string> = {
    contact: '첫 접촉', meeting: '미팅 진행', demo: '데모', proposal: '제안',
    contract: '계약', active_customer: '활성 거래처'
  }
  const WON = ['contract', 'active_customer']   // '확보'의 정의 (dashboard.ts 와 동일)

  const hospRows = (await c.env.DB.prepare(`
    SELECT h.id, h.name, h.region, h.grade, h.type,
           COALESCE(h.pipeline_stage,'contact') AS stage,
           (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id) AS docCnt,
           (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id AND d.influence_level='high') AS keyDoc,
           (SELECT COUNT(*) FROM meetings m WHERE m.hospital_id = h.id) AS mtgCnt,
           (SELECT MAX(m.meeting_date) FROM meetings m WHERE m.hospital_id = h.id) AS lastMtg
    FROM hospitals h
  `).all()).results as any[]

  // ── 지역 시장 (HIRA 실측). 성장률 기준연도는 위에서 탐지한 구조 전환점(breakYear)과 통일합니다.
  //    ⚠️ 2010년 기준으로 계산하면 2017년 급여 확대 이전의 등락이 섞여 성장률이 왜곡됩니다.
  const regBase = breakYear as number
  const regPatLast: Record<string, number> = {}
  const regPatBase: Record<string, number> = {}
  regionData.forEach((r: any) => {
    if (r.year === latestYear) regPatLast[r.region] = r.patients
    if (r.year === regBase) regPatBase[r.region] = r.patients
  })
  const mktTotal = Object.values(regPatLast).reduce((a, b) => a + b, 0)

  // ── 지역 노력(미팅 수) · 확보(계약 이상) 집계 (CRM 실측)
  const regMtg: Record<string, number> = {}
  const regWon: Record<string, number> = {}
  const regHosp: Record<string, number> = {}
  hospRows.forEach(h => {
    const r = h.region || '미지정'
    regMtg[r] = (regMtg[r] || 0) + (h.mtgCnt || 0)
    regHosp[r] = (regHosp[r] || 0) + 1
    if (WON.includes(h.stage)) regWon[r] = (regWon[r] || 0) + 1
  })
  const mtgTotal = Object.values(regMtg).reduce((a, b) => a + b, 0)

  // ── [핵심 1] 노력 배분 vs 시장 배분 갭
  //    미팅 점유율 − 환자 점유율. 양수면 시장 규모보다 많이 방문한 지역(과잉),
  //    음수면 시장이 큰데 덜 방문한 지역(과소). 배율 = 미팅% ÷ 시장%.
  const allRegions = [...new Set([...Object.keys(regPatLast), ...Object.keys(regMtg)])]
  const effortGap = allRegions.map(r => {
    const pat = regPatLast[r] || 0
    const base = regPatBase[r] || 0
    const mtg = regMtg[r] || 0
    const mktShare = mktTotal ? pat / mktTotal * 100 : 0
    const mtgShare = mtgTotal ? mtg / mtgTotal * 100 : 0
    return {
      region: r, patients: pat, hospitals: regHosp[r] || 0, meetings: mtg, won: regWon[r] || 0,
      mktShare: +mktShare.toFixed(1), mtgShare: +mtgShare.toFixed(1),
      gap: +(mtgShare - mktShare).toFixed(1),
      // ⚠️ 시장이 0인 지역은 배율이 무한대가 되므로 null 로 둡니다.
      ratio: mktShare > 0 ? +(mtgShare / mktShare).toFixed(2) : null,
      cagr: (base > 0 && pat > 0) ? +((Math.pow(pat / base, 1 / (latestYear - regBase)) - 1) * 100).toFixed(1) : null
    }
  }).sort((a, b) => b.patients - a.patients)

  // ── [핵심 2] 퍼널 단계 분포 + 단계간 전환율
  const stageCount: Record<string, number> = {}
  hospRows.forEach(h => { stageCount[h.stage] = (stageCount[h.stage] || 0) + 1 })
  const funnel = STAGES.map((s, i) => {
    const n = stageCount[s] || 0
    const prev = i > 0 ? (stageCount[STAGES[i - 1]] || 0) : 0
    return {
      stage: s, label: STAGE_LABELS[s], count: n,
      convFromPrev: i > 0 && prev > 0 ? +(n / prev * 100).toFixed(0) : null
    }
  })
  const earlyCount = (stageCount['contact'] || 0) + (stageCount['meeting'] || 0)
  const midCount = (stageCount['demo'] || 0) + (stageCount['proposal'] || 0)
  const wonCount = (stageCount['contract'] || 0) + (stageCount['active_customer'] || 0)

  // ── [핵심 3] 정체(stall) 탐지
  //    마지막 미팅 이후 STALL_DAYS 일 이상 경과 & 아직 계약 전인 곳.
  //    ⚠️ 미팅 기록이 아예 없는 곳은 '경과일'을 계산할 수 없어 별도로 분류합니다.
  //    ⚠️ 향후 일정이 등록된 곳은 경과일이 음수가 되므로 정체가 아닙니다.
  const STALL_DAYS = 60
  const todayMs = Date.now()
  const daysSince = (d: string | null) =>
    d ? Math.floor((todayMs - new Date(d + 'T00:00:00Z').getTime()) / 86400000) : null

  const openRows = hospRows.filter(h => !WON.includes(h.stage))
  const stalled = openRows
    .map(h => ({ ...h, days: daysSince(h.lastMtg) }))
    .filter(h => h.days !== null && (h.days as number) >= STALL_DAYS)
    .sort((a, b) => (b.days as number) - (a.days as number))
    .map(h => ({ id: h.id, name: h.name, region: h.region, stage: h.stage, label: STAGE_LABELS[h.stage], days: h.days, keyDoc: h.keyDoc, mtgCnt: h.mtgCnt }))
  const neverMet = openRows
    .filter(h => !h.lastMtg)
    .map(h => ({ id: h.id, name: h.name, region: h.region, stage: h.stage, label: STAGE_LABELS[h.stage], docCnt: h.docCnt }))

  // ── [핵심 4] 공략 우선순위 점수 (0~100)
  // 5개 축을 더해 산출합니다. 각 축의 만점과 근거:
  //   ① 시장 규모   18점 — 지역 환자 점유율. √(비중) 으로 압축합니다.
  //        ⚠️ 비중을 그대로 쓰면 서울(56.5%)이 점수를 지배해 상위권이 전부 서울로 채워지고,
  //           정작 성장 중인 지역이 밀려납니다. 제곱근으로 격차를 줄였습니다.
  //   ② 성장성     12점 — 기준연도 이후 지역 CAGR (20% 이상이면 만점)
  //   ③ 전략 공백   15점 — 그 지역에 «계약 병원이 0곳»이면 부여 (거점 없는 시장)
  //   ④ 과소 투자   10점 — 배율 1 미만(시장 대비 덜 방문)일 때 부족한 만큼 부여
  //   ⑤ 진행 단계   25점 — 제안 25 / 데모 22 / 미팅 15 / 접촉 8
  //   ⑥ 관계 자산   20점 — 미팅 횟수(최대 10) + 키맨 수(1명당 5, 최대 10)
  // ⚠️ 이미 계약·활성 거래처인 곳은 '신규 공략' 대상이 아니므로 목록에서 제외합니다.
  const maxShare = Math.max(...effortGap.map(e => e.mktShare), 1)
  const gapByRegion: Record<string, any> = {}
  effortGap.forEach(e => { gapByRegion[e.region] = e })

  const STAGE_SCORE: Record<string, number> = { contact: 8, meeting: 15, demo: 22, proposal: 25 }
  const targets = openRows.map(h => {
    const g = gapByRegion[h.region] || { mktShare: 0, cagr: null, ratio: null, won: 0 }
    const sSize = 18 * Math.sqrt(Math.min(1, g.mktShare / maxShare))
    const sGrow = 12 * Math.max(0, Math.min(1, (g.cagr || 0) / 20))
    const sVoid = (g.won || 0) > 0 ? 0 : 15 * Math.min(1, g.mktShare / 10)
    const sUnder = (g.ratio === null || g.ratio >= 1) ? 0 : 10 * (1 - g.ratio)
    const sStage = STAGE_SCORE[h.stage] || 0
    const sRel = Math.min(10, (h.mtgCnt || 0) * 2) + Math.min(10, (h.keyDoc || 0) * 5)
    const days = daysSince(h.lastMtg)
    return {
      id: h.id, name: h.name, region: h.region, grade: h.grade, type: h.type,
      stage: h.stage, label: STAGE_LABELS[h.stage],
      mtgCnt: h.mtgCnt, docCnt: h.docCnt, keyDoc: h.keyDoc, lastMtg: h.lastMtg, days,
      mktShare: g.mktShare, cagr: g.cagr, regionWon: g.won || 0,
      score: +(sSize + sGrow + sVoid + sUnder + sStage + sRel).toFixed(1),
      parts: {
        size: +sSize.toFixed(1), grow: +sGrow.toFixed(1), void: +sVoid.toFixed(1),
        under: +sUnder.toFixed(1), stage: sStage, rel: sRel
      }
    }
  }).sort((a, b) => b.score - a.score)

  // ── 커버리지 (참고용) — '미개척 지역 발굴'이 이미 무의미함을 보여주는 지표
  const coveredPat = allRegions
    .filter(r => (regHosp[r] || 0) > 0)
    .reduce((a, r) => a + (regPatLast[r] || 0), 0)
  const wonPat = allRegions
    .filter(r => (regWon[r] || 0) > 0)
    .reduce((a, r) => a + (regPatLast[r] || 0), 0)
  const uncoveredRegions = effortGap
    .filter(e => e.patients > 0 && e.hospitals === 0)
    .map(e => ({ region: e.region, patients: e.patients }))

  const salesStrategy = {
    baseYear: regBase, latestYear, marketTotal: mktTotal,
    hospitalTotal: hospRows.length, meetingTotal: mtgTotal,
    effortGap, funnel, stalled, neverMet, targets,
    stallDays: STALL_DAYS,
    summary: {
      earlyCount, midCount, wonCount,
      earlyShare: hospRows.length ? +(earlyCount / hospRows.length * 100).toFixed(0) : 0,
      // 미팅 → 데모 전환율: 퍼널 '허리'가 막혔는지 보는 단일 지표
      meetingToDemo: (stageCount['meeting'] || 0) > 0
        ? +((stageCount['demo'] || 0) / (stageCount['meeting'] || 1) * 100).toFixed(0) : null,
      coverageShare: mktTotal ? +(coveredPat / mktTotal * 100).toFixed(1) : 0,
      wonCoverageShare: mktTotal ? +(wonPat / mktTotal * 100).toFixed(1) : 0,
      uncoveredRegions,
      stalledCount: stalled.length, neverMetCount: neverMet.length
    }
  }

  const latestInst = instData.filter((i: any) => i.year === latestYear)
  const totalInstPat = latestInst.reduce((a: number, b: any) => a + b.patients, 0)
  const topInst = latestInst[0] as any
  if (topInst && totalInstPat > 0) insights.push({ icon: 'fa-hospital', title: topInst.institution_type + ' 비율', value: (topInst.patients / totalInstPat * 100).toFixed(1) + '%', desc: latestYear + '년 기준 환자수 비율' })

  return c.json({
    data: {
      source: '건강보험심사평가원 보건의료빅데이터개방시스템',
      // ⚠️ 원본 데이터를 직접 확인·갱신할 수 있는 공식 페이지입니다.
      //    (국민관심질병/행위통계 > 인공와우이식술 S5800, 매년 7월 갱신)
      //    화면 상단·하단 출처 표기에서 이 링크를 새 탭으로 엽니다.
      sourceUrl: 'https://opendata.hira.or.kr/op/opc/olapDiagBhvInfoTab1.do',
      sourceHome: 'https://opendata.hira.or.kr/',
      sourceLicense: '공공누리 제1유형 (출처표시)',
      sourceUpdateCycle: '매년 7월 최신 데이터 갱신',
      code: 'S5800 (인공와우이식술)',
      period: yearlyData.length ? yearlyData[0].year + '-' + yearlyData[yearlyData.length - 1].year : '-',
      years, yearly: yearlyData, age10: age10All.results, age5: age5All.results, region: regionData, institution: instData, insights,
      // 심층 분석 결과 (전부 HIRA 실측 기반 계산값 — 추정 없음)
      analytics: {
        cohortTrend, concentration, amountDecomp, regionGrowth,
        // 확장 지표
        procPerPatient, ageContribution, instConcentration, genderTrend,
        // 구조 변화 탐지 결과 (예측 기준구간 선정 근거)
        breakScan, breakYear, breakRule,
        contribBase, contribLast
      },
      // 영업 전략 (HIRA 지역 실측 × CRM 병원 실측 교차 — 추정 없음)
      salesStrategy,
      // 🔴 아래 두 블록은 «추정치»입니다. 실측(analytics)과 반드시 구분해 표기하세요.
      forecast,
      deviceMarket,
      policyChanges: [
        { year: 2005, event: '인공와우 이식술 요양급여 대상 최초 지정' },
        { year: 2009, event: '2세 미만 소아 양측 인공와우 건강보험 급여 인정' },
        { year: 2015, event: '건강보험 인정 기준 대폭 확대 (보장성 강화)' },
        { year: 2017, event: '건강보험 적용 연령 15세 → 19세 미만 확대' },
        { year: 2018, event: '모든 어린이 건강보험 비용 전액 지원 시작' }
        // ⚠️ 2025년 항목은 제거했습니다.
        //    기존에 '급여 기준 지속 확대 논의 중' 이라는 잠정 문구가 들어가 있었으나
        //    2025년에 실제로 고시된 급여 기준 변경을 확인할 수 없었습니다.
        //    확인되지 않은 내용을 정책 연혁에 남겨두면 영업 자료로 오용될 수 있어 삭제합니다.
        //    실제 개정 사실이 확인되면 이 자리에 { year: 2025, event: '...' } 로 추가하세요.
      ]
    }
  })
})

// Year comparison endpoint
cistats.get('/compare', async (c) => {
  const { year1, year2 } = c.req.query()
  if (!year1 || !year2) return c.json({ error: 'year1 and year2 required' }, 400)
  const y1 = parseInt(year1), y2 = parseInt(year2)

  const [io1, io2, reg1, reg2, inst1, inst2] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient WHERE year=? AND gender='계' AND visit_type='계'").bind(y1).first(),
    c.env.DB.prepare("SELECT * FROM ci_inpatient_outpatient WHERE year=? AND gender='계' AND visit_type='계'").bind(y2).first(),
    c.env.DB.prepare("SELECT * FROM ci_region_stats WHERE year=? AND region!='계' ORDER BY patients DESC").bind(y1).all(),
    c.env.DB.prepare("SELECT * FROM ci_region_stats WHERE year=? AND region!='계' ORDER BY patients DESC").bind(y2).all(),
    c.env.DB.prepare("SELECT * FROM ci_institution_stats WHERE year=? AND institution_type!='계' ORDER BY patients DESC").bind(y1).all(),
    c.env.DB.prepare("SELECT * FROM ci_institution_stats WHERE year=? AND institution_type!='계' ORDER BY patients DESC").bind(y2).all(),
  ])

  return c.json({
    data: {
      year1: { year: y1, summary: io1, regions: reg1.results, institutions: inst1.results },
      year2: { year: y2, summary: io2, regions: reg2.results, institutions: inst2.results },
    }
  })
})

// CRM cross-analysis: our hospital coverage vs HIRA regions
cistats.get('/cross-analysis', async (c) => {
  const [hospRegions, ciRegions] = await Promise.all([
    c.env.DB.prepare("SELECT region, COUNT(*) as count FROM hospitals WHERE status='active' AND region!='' GROUP BY region ORDER BY count DESC").all(),
    c.env.DB.prepare("SELECT * FROM ci_region_stats WHERE region!='계' ORDER BY year DESC").all(),
  ])

  // Latest year from CI data
  const ciData = ciRegions.results as any[]
  const latestYear = ciData.length ? ciData[0].year : null
  const latestCI = latestYear ? ciData.filter((r: any) => r.year === latestYear) : []
  const totalCIPatients = latestCI.reduce((a: number, b: any) => a + b.patients, 0)

  // Map: region -> {ciPatients, crmHospitals}
  const regionMap: any = {}
  latestCI.forEach((r: any) => {
    regionMap[r.region] = { ciPatients: r.patients, ciShare: totalCIPatients > 0 ? (r.patients / totalCIPatients * 100) : 0, crmHospitals: 0 }
  })
  ;(hospRegions.results as any[]).forEach((h: any) => {
    if (regionMap[h.region]) regionMap[h.region].crmHospitals = h.count
    else regionMap[h.region] = { ciPatients: 0, ciShare: 0, crmHospitals: h.count }
  })

  // Find uncovered regions (has CI patients but no CRM hospitals)
  const uncovered = Object.entries(regionMap)
    .filter(([_, v]: any) => v.ciPatients > 0 && v.crmHospitals === 0)
    .sort((a: any, b: any) => b[1].ciPatients - a[1].ciPatients)
    .map(([region, v]: any) => ({ region, ...v }))

  return c.json({
    data: {
      year: latestYear,
      totalCIPatients,
      regions: Object.entries(regionMap).map(([region, v]: any) => ({ region, ...v })).sort((a, b) => b.ciPatients - a.ciPatients),
      uncovered,
      crmCoverage: totalCIPatients > 0 ? (Object.entries(regionMap).filter(([_, v]: any) => v.crmHospitals > 0).reduce((a, [_, v]: any) => a + v.ciPatients, 0) / totalCIPatients * 100).toFixed(1) : '0'
    }
  })
})

export default cistats
