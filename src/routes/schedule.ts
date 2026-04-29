import { Hono } from 'hono'

type Bindings = { DB: D1Database }
type Variables = { userId: number }
const schedule = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// 요일 키 매핑 (JS getUTCDay: 0=일, 1=월, ... 6=토)
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS: Record<string, string> = {
  sun: '일', mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토'
}

/**
 * 의사의 clinic_hours JSON에서 해당 요일의 진료 상태를 분석
 * 반환: { am: string, pm: string, hasClinic: boolean, visitSlot: string, visitTime: string }
 */
function analyzeClinicDay(clinicHoursStr: string, dayKey: string): {
  am: string, pm: string, hasClinic: boolean, 
  visitSlot: 'am_end' | 'pm_end' | 'am_start' | 'none',
  visitTime: string, visitLabel: string
} {
  let h: any = {}
  try { if (clinicHoursStr) h = JSON.parse(clinicHoursStr) } catch(e) {}
  
  const am = h[dayKey + '_am'] || ''
  const pm = h[dayKey + '_pm'] || ''
  
  const isClinicAM = am === '진료' || am === '순환진료'
  const isClinicPM = pm === '진료' || pm === '순환진료'
  const isSurgeryAM = am === '수술'
  const isSurgeryPM = pm === '수술'
  const isOffAM = am === '휴진' || am === ''
  const isOffPM = pm === '휴진' || pm === ''
  
  // 진료가 아예 없는 날
  if (!isClinicAM && !isClinicPM) {
    // 수술일이면 수술 후 잠깐 볼 수 있음
    if (isSurgeryAM && isOffPM) return { am, pm, hasClinic: false, visitSlot: 'pm_end', visitTime: '14:00', visitLabel: '오후 (수술 후)' }
    if (isSurgeryPM) return { am, pm, hasClinic: false, visitSlot: 'am_end', visitTime: '11:30', visitLabel: '오전' }
    return { am, pm, hasClinic: false, visitSlot: 'none', visitTime: '', visitLabel: '' }
  }
  
  // 핵심: 진료 끝나는 시간에 맞춰 방문
  // 오전 진료만 → 오전 진료 끝(12:00 전후)에 방문
  if (isClinicAM && !isClinicPM) {
    return { am, pm, hasClinic: true, visitSlot: 'am_end', visitTime: '11:30', visitLabel: '오전 외래 후 (11:30~)' }
  }
  
  // 오후 진료만 → 오후 진료 끝(17:00 전후)에 방문
  if (!isClinicAM && isClinicPM) {
    return { am, pm, hasClinic: true, visitSlot: 'pm_end', visitTime: '16:30', visitLabel: '오후 외래 후 (16:30~)' }
  }
  
  // 오전+오후 모두 진료 → 점심시간(12:00~13:00) 또는 오후 진료 끝
  if (isClinicAM && isClinicPM) {
    return { am, pm, hasClinic: true, visitSlot: 'pm_end', visitTime: '16:30', visitLabel: '오후 외래 후 (16:30~)' }
  }
  
  return { am, pm, hasClinic: false, visitSlot: 'none', visitTime: '', visitLabel: '' }
}

/**
 * GET /api/schedule/suggest
 */
schedule.get('/suggest', async (c) => {
  const regionParam = c.req.query('region')
  const date = c.req.query('date')
  const max = parseInt(c.req.query('max') || '20', 10)
  const includeInactive = c.req.query('include_inactive') !== 'false'

  if (!regionParam || !date) {
    return c.json({ error: '지역(region)과 날짜(date)는 필수입니다.' }, 400)
  }

  // 복수 지역 지원 (쉼표 구분)
  const regions = regionParam.split(',').map(r => r.trim()).filter(r => r.length > 0)
  if (regions.length === 0) {
    return c.json({ error: '유효한 지역을 입력해주세요.' }, 400)
  }

  // 해당 날짜의 요일 구하기
  const targetDate = new Date(date + 'T00:00:00Z')
  const dayOfWeek = targetDate.getUTCDay()
  const dayKey = DAY_KEYS[dayOfWeek]
  const dayLabel = DAY_LABELS[dayKey]

  // 해당 지역들의 기관 목록 가져오기
  const regionPlaceholders = regions.map(() => '?').join(',')
  let hospQuery = `
    SELECT h.*,
      (SELECT COUNT(*) FROM doctors d WHERE d.hospital_id = h.id) as doctor_count,
      (SELECT COUNT(*) FROM meetings m WHERE m.hospital_id = h.id) as total_meetings,
      (SELECT MAX(m.meeting_date) FROM meetings m WHERE m.hospital_id = h.id) as last_meeting_date,
      (SELECT m.meeting_type FROM meetings m WHERE m.hospital_id = h.id ORDER BY m.meeting_date DESC LIMIT 1) as last_meeting_type,
      (SELECT m.purpose FROM meetings m WHERE m.hospital_id = h.id ORDER BY m.meeting_date DESC LIMIT 1) as last_meeting_purpose,
      (SELECT m.result FROM meetings m WHERE m.hospital_id = h.id ORDER BY m.meeting_date DESC LIMIT 1) as last_meeting_result,
      (SELECT m.next_action FROM meetings m WHERE m.hospital_id = h.id ORDER BY m.meeting_date DESC LIMIT 1) as pending_next_action,
      (SELECT m.next_meeting_date FROM meetings m WHERE m.hospital_id = h.id AND m.next_meeting_date IS NOT NULL AND m.next_meeting_date != '' ORDER BY m.meeting_date DESC LIMIT 1) as next_scheduled_date
    FROM hospitals h
    WHERE h.region IN (${regionPlaceholders})
  `
  const params: any[] = [...regions]
  if (!includeInactive) hospQuery += ' AND h.status = "active"'

  const hosps = await c.env.DB.prepare(hospQuery).bind(...params).all()
  const hospitals = hosps.results as any[]

  if (hospitals.length === 0) {
    return c.json({ data: [], regions, date, dayKey, dayLabel, message: '해당 지역에 등록된 기관이 없습니다.' })
  }

  // 모든 의사 정보를 한번에 가져오기 (clinic_hours 포함)
  const allHospIds = hospitals.map(h => h.id)
  const docPlaceholders = allHospIds.map(() => '?').join(',')
  const allDocsResult = await c.env.DB.prepare(
    `SELECT d.id, d.name, d.hospital_id, d.position, d.department, d.phone, d.specialty, d.influence_level, d.photo, d.clinic_hours
     FROM doctors d WHERE d.hospital_id IN (${docPlaceholders}) ORDER BY d.name`
  ).bind(...allHospIds).all()
  const allDocs = allDocsResult.results as any[]

  // 의료진을 기관별로 그룹핑
  const doctorsByHospital = new Map<number, any[]>()
  for (const doc of allDocs) {
    if (!doctorsByHospital.has(doc.hospital_id)) {
      doctorsByHospital.set(doc.hospital_id, [])
    }
    doctorsByHospital.get(doc.hospital_id)!.push(doc)
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // 점수 산출 + 외래 일정 분석
  const scored = hospitals.map(h => {
    let score = 0
    const reasons: string[] = []
    const docs = doctorsByHospital.get(h.id) || []

    // --- 외래 일정 분석 ---
    const clinicAnalysis: any[] = []
    let bestVisitTime = ''
    let bestVisitSlot = 'none'
    let bestVisitLabel = ''
    let hasClinicToday = false

    for (const doc of docs) {
      const analysis = analyzeClinicDay(doc.clinic_hours || '', dayKey)
      clinicAnalysis.push({
        doctor_id: doc.id,
        doctor_name: doc.name,
        position: doc.position,
        ...analysis
      })
      if (analysis.hasClinic) hasClinicToday = true
      // 가장 빠른 방문 가능 시간 선택
      if (analysis.visitTime) {
        if (!bestVisitTime || analysis.visitTime < bestVisitTime) {
          bestVisitTime = analysis.visitTime
          bestVisitSlot = analysis.visitSlot
          bestVisitLabel = analysis.visitLabel
        }
      }
    }

    // 외래 있는 의사가 있으면 가산점
    if (hasClinicToday) {
      score += 20
      const clinicDocs = clinicAnalysis.filter(a => a.hasClinic)
      reasons.push(`${dayLabel}요일 외래: ${clinicDocs.map(a => a.doctor_name).join(', ')}`)
    }

    // clinic_hours 데이터가 있지만 해당 요일 진료 없으면 감점
    const hasAnyScheduleData = docs.some(d => d.clinic_hours && d.clinic_hours !== '{}' && d.clinic_hours.length > 2)
    if (hasAnyScheduleData && !hasClinicToday) {
      score -= 10
      reasons.push(`${dayLabel}요일 외래 없음`)
    }

    // 1. 등급 점수
    const gradeScores: Record<string, number> = { S: 50, A: 40, B: 30, C: 20, D: 10 }
    const gradeScore = gradeScores[h.grade] || 20
    score += gradeScore
    if (h.grade === 'S') reasons.push('최고등급(S) 기관')

    // 2. 파이프라인 단계 가중치
    const pipelineScores: Record<string, number> = {
      contact: 10, meeting: 25, demo: 30, proposal: 35, contract: 40, active_customer: 15
    }
    const pipeScore = pipelineScores[h.pipeline_stage] || 10
    score += pipeScore
    if (['demo', 'proposal', 'contract'].includes(h.pipeline_stage)) {
      reasons.push(`영업 진행 중 (${stageLabel(h.pipeline_stage)})`)
    }

    // 3. 마지막 방문 이후 경과일
    if (h.last_meeting_date) {
      const lastVisit = new Date(h.last_meeting_date + 'T00:00:00Z')
      const daysSince = Math.floor((targetDate.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince > 90) { score += 30; reasons.push(`${daysSince}일 미방문 (3개월+)`) }
      else if (daysSince > 60) { score += 25; reasons.push(`${daysSince}일 미방문 (2개월+)`) }
      else if (daysSince > 30) { score += 20; reasons.push(`${daysSince}일 미방문 (1개월+)`) }
      else if (daysSince > 14) { score += 10; reasons.push(`${daysSince}일 전 방문`) }
      else if (daysSince < 0) { score -= 10 }
    } else {
      score += 35; reasons.push('미방문 기관 (첫 방문 필요)')
    }

    // 4. 다음 미팅 일정
    if (h.next_scheduled_date) {
      const nextDate = new Date(h.next_scheduled_date + 'T00:00:00Z')
      const daysDiff = Math.abs(Math.floor((targetDate.getTime() - nextDate.getTime()) / (1000 * 60 * 60 * 24)))
      if (daysDiff === 0) { score += 40; reasons.push('예정된 미팅 당일') }
      else if (daysDiff <= 3) { score += 20; reasons.push(`예정 미팅 ${daysDiff}일 차이`) }
    }

    // 5. pending_next_action
    if (h.pending_next_action && h.pending_next_action.trim()) {
      score += 15; reasons.push(`후속 과제: ${h.pending_next_action.substring(0, 30)}`)
    }

    // 6. 우선순위
    const priorityNum = parseInt(h.priority || '3', 10)
    if (priorityNum <= 2) { score += 15; reasons.push('높은 우선순위') }
    else if (priorityNum >= 4) score -= 5

    // 7. 의료진 수
    if (h.doctor_count >= 3) { score += 10; reasons.push(`의료진 ${h.doctor_count}명 관리`) }

    return {
      hospital_id: h.id,
      name: h.name,
      region: h.region,
      address: h.address || '',
      phone: h.phone || '',
      grade: h.grade,
      status: h.status,
      priority: h.priority,
      pipeline_stage: h.pipeline_stage,
      doctor_count: h.doctor_count,
      total_meetings: h.total_meetings,
      last_meeting_date: h.last_meeting_date,
      last_meeting_type: h.last_meeting_type,
      last_meeting_purpose: h.last_meeting_purpose,
      last_meeting_result: h.last_meeting_result,
      pending_next_action: h.pending_next_action,
      next_scheduled_date: h.next_scheduled_date,
      score,
      reasons,
      // 외래 일정 정보
      visit_time: bestVisitTime,
      visit_slot: bestVisitSlot,
      visit_label: bestVisitLabel,
      has_clinic_today: hasClinicToday,
      clinic_analysis: clinicAnalysis,
      doctors: docs.map(d => ({
        id: d.id,
        name: d.name,
        hospital_id: d.hospital_id,
        position: d.position,
        department: d.department,
        phone: d.phone,
        specialty: d.specialty,
        influence_level: d.influence_level,
        photo: d.photo,
        clinic_hours: d.clinic_hours
      }))
    }
  })

  // 점수순 정렬
  scored.sort((a, b) => b.score - a.score)
  const suggestions = scored.slice(0, max)

  // 시간순 정렬 버전도 제공 (지역 → visit_time 기준)
  const timeOrdered = [...suggestions].sort((a, b) => {
    // 지역별 → 시간순 정렬
    const regionComp = a.region.localeCompare(b.region)
    if (regionComp !== 0) return regionComp
    // 시간 있는 것 우선, 없으면 뒤로
    if (a.visit_time && !b.visit_time) return -1
    if (!a.visit_time && b.visit_time) return 1
    if (!a.visit_time && !b.visit_time) return b.score - a.score
    return a.visit_time.localeCompare(b.visit_time)
  })

  const stats = {
    total_in_region: hospitals.length,
    suggested: suggestions.length,
    never_visited: hospitals.filter(h => !h.last_meeting_date).length,
    active_pipeline: hospitals.filter(h => ['meeting', 'demo', 'proposal', 'contract'].includes(h.pipeline_stage)).length,
    avg_score: Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length),
    has_clinic_data: allDocs.some(d => d.clinic_hours && d.clinic_hours.length > 2),
    clinic_today_count: suggestions.filter(s => s.has_clinic_today).length
  }

  return c.json({ data: suggestions, time_ordered: timeOrdered, stats, regions, date, dayKey, dayLabel })
})

/**
 * GET /api/schedule/regions
 */
schedule.get('/regions', async (c) => {
  const r = await c.env.DB.prepare(`
    SELECT 
      h.region,
      COUNT(*) as total,
      SUM(CASE WHEN h.status = 'active' THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN (SELECT MAX(m.meeting_date) FROM meetings m WHERE m.hospital_id = h.id) IS NULL THEN 1 ELSE 0 END) as never_visited,
      SUM(CASE WHEN julianday('now') - julianday((SELECT MAX(m.meeting_date) FROM meetings m WHERE m.hospital_id = h.id)) > 30 THEN 1 ELSE 0 END) as needs_visit
    FROM hospitals h
    WHERE h.region != ''
    GROUP BY h.region
    ORDER BY h.region
  `).all()
  return c.json({ data: r.results })
})

/**
 * POST /api/schedule/plan
 */
schedule.post('/plan', async (c) => {
  const body = await c.req.json()
  const { date, visits, user_id, user_ids } = body
  
  // Support multiple user_ids for co-visits
  let resolvedUserIds: number[] = []
  if (Array.isArray(user_ids) && user_ids.length > 0) {
    resolvedUserIds = user_ids.map((id: any) => Number(id)).filter((id: number) => id > 0)
  } else if (user_id) {
    resolvedUserIds = [Number(user_id)].filter(id => id > 0)
  }
  if (resolvedUserIds.length === 0) {
    const sessionUserId = c.get('userId')
    if (sessionUserId) resolvedUserIds = [sessionUserId]
  }
  const primaryUserId = resolvedUserIds.length > 0 ? resolvedUserIds[0] : null
  
  if (!date || !Array.isArray(visits) || visits.length === 0) {
    return c.json({ error: '날짜와 방문 목록이 필요합니다.' }, 400)
  }

  const created: any[] = []
  
  for (const visit of visits) {
    const { hospital_id, doctor_ids, purpose, meeting_type, visit_time } = visit
    if (!hospital_id) continue

    let docIds = doctor_ids || []
    if (docIds.length === 0) {
      const firstDoc = await c.env.DB.prepare(
        'SELECT id FROM doctors WHERE hospital_id=? ORDER BY name LIMIT 1'
      ).bind(hospital_id).first() as any
      if (firstDoc) docIds = [firstDoc.id]
    }

    if (docIds.length === 0) continue

    // Validate visit_time (am/pm/full or empty)
    const validVisitTime = ['am', 'pm', 'full'].includes(visit_time) ? visit_time : ''

    const primaryDoctorId = docIds[0]
    const r = await c.env.DB.prepare(
      'INSERT INTO meetings (doctor_id, hospital_id, meeting_date, meeting_type, visit_time, purpose, content, result, next_action, next_meeting_date, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(primaryDoctorId, hospital_id, date, meeting_type || 'visit', validVisitTime, purpose || '일정 플래너 자동 생성', '', '', '', null, primaryUserId).run()

    const meetingId = r.meta.last_row_id as number
    // Sync meeting_doctors
    for (const did of docIds) {
      await c.env.DB.prepare('INSERT INTO meeting_doctors (meeting_id, doctor_id) VALUES (?, ?)').bind(meetingId, did).run()
    }
    // Sync meeting_users (multiple salespeople)
    for (const uid of resolvedUserIds) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO meeting_users (meeting_id, user_id) VALUES (?, ?)').bind(meetingId, uid).run()
    }
    created.push({ meeting_id: meetingId, hospital_id, doctor_ids: docIds, user_ids: resolvedUserIds })
  }

  return c.json({ data: { created, count: created.length, date } })
})

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    contact: '컨택', meeting: '미팅', demo: '데모',
    proposal: '제안', contract: '계약', active_customer: '기존고객'
  }
  return labels[stage] || stage
}

export default schedule
