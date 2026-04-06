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
    insights.push({ icon: 'fa-arrow-trend-up', title: '시술건수 연평균 성장률', value: cagrU.toFixed(1) + '%', desc: first.year + '년 ' + first.usage + '건 → ' + last.year + '년 ' + last.usage + '건' })
    const totalM = yearlyData.reduce((a, b) => a + b.male_patients, 0)
    const totalF = yearlyData.reduce((a, b) => a + b.female_patients, 0)
    const total = totalM + totalF
    if (total > 0) insights.push({ icon: 'fa-venus-mars', title: '성비 (남:여)', value: (totalM / total * 100).toFixed(1) + ':' + (totalF / total * 100).toFixed(1), desc: '전체 기간 누적 성비' })
    const totalAmount = yearlyData.reduce((a, b) => a + b.amount, 0)
    const totalAmountWon = totalAmount * 1000 // convert from 천원 to 원
    const amountBillions = (totalAmountWon / 100000000).toFixed(1) // 억원
    insights.push({ icon: 'fa-won-sign', title: '6년간 총 진료금액', value: amountBillions + '억원', desc: '2019-2024 누적' })
  }

  const latestYear = years[years.length - 1] as number
  const latestRegion = regionData.filter((r: any) => r.year === latestYear)
  const totalRegPat = latestRegion.reduce((a: number, b: any) => a + b.patients, 0)
  const seoulGyeonggi = latestRegion.filter((r: any) => r.region === '서울' || r.region === '경기').reduce((a: number, b: any) => a + b.patients, 0)
  if (totalRegPat > 0) insights.push({ icon: 'fa-city', title: '수도권 집중도', value: (seoulGyeonggi / totalRegPat * 100).toFixed(1) + '%', desc: latestYear + '년 서울+경기 환자 비율' })

  const latestInst = instData.filter((i: any) => i.year === latestYear)
  const totalInstPat = latestInst.reduce((a: number, b: any) => a + b.patients, 0)
  const topInst = latestInst[0] as any
  if (topInst && totalInstPat > 0) insights.push({ icon: 'fa-hospital', title: topInst.institution_type + ' 비율', value: (topInst.patients / totalInstPat * 100).toFixed(1) + '%', desc: latestYear + '년 기준 환자수 비율' })

  return c.json({
    data: {
      source: '건강보험심사평가원 보건의료빅데이터개방시스템',
      code: 'S5800 (인공와우이식술)',
      period: yearlyData.length ? yearlyData[0].year + '-' + yearlyData[yearlyData.length - 1].year : '-',
      years, yearly: yearlyData, age10: age10All.results, age5: age5All.results, region: regionData, institution: instData, insights,
      policyChanges: [
        { year: 2005, event: '인공와우 이식술 요양급여 대상 최초 지정' },
        { year: 2009, event: '2세 미만 소아 양측 인공와우 건강보험 급여 인정' },
        { year: 2015, event: '건강보험 인정 기준 대폭 확대 (보장성 강화)' },
        { year: 2017, event: '건강보험 적용 연령 15세 → 19세 미만 확대' },
        { year: 2018, event: '모든 어린이 건강보험 비용 전액 지원 시작' },
        { year: 2025, event: '급여 기준 지속 확대 논의 중' }
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
