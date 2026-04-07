import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const schedule = new Hono<{ Bindings: Bindings }>()

/**
 * GET /api/schedule/suggest
 * 
 * 지역과 날짜를 기반으로 방문할 기관 목록을 우선순위에 따라 추천
 * 
 * Query params:
 *   region: 지역명 (required)
 *   date: 방문 예정일 YYYY-MM-DD (required)
 *   max: 최대 추천 수 (default: 10)
 *   include_inactive: "true"이면 inactive 기관도 포함 (default: true)
 * 
 * 점수 산출 기준:
 *   1. 등급 (S=50, A=40, B=30, C=20, D=10)
 *   2. 파이프라인 단계별 가중치 (진행 중일수록 높은 점수)
 *   3. 마지막 방문 이후 경과일 (오래됐을수록 점수 높음)
 *   4. 다음 미팅이 잡혀있는 경우 (해당 날짜 전후면 보너스)
 *   5. 우선순위 (priority 높을수록 가산점)
 *   6. 미방문 기관 가산점
 */
schedule.get('/suggest', async (c) => {
  const region = c.req.query('region')
  const date = c.req.query('date')
  const max = parseInt(c.req.query('max') || '10', 10)
  const includeInactive = c.req.query('include_inactive') !== 'false'

  if (!region || !date) {
    return c.json({ error: '지역(region)과 날짜(date)는 필수입니다.' }, 400)
  }

  // 해당 지역의 기관 목록 가져오기
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
    WHERE h.region = ?
  `
  const params: any[] = [region]

  if (!includeInactive) {
    hospQuery += ' AND h.status = "active"'
  }

  const hosps = await c.env.DB.prepare(hospQuery).bind(...params).all()
  const hospitals = hosps.results as any[]

  if (hospitals.length === 0) {
    return c.json({ data: [], region, date, message: '해당 지역에 등록된 기관이 없습니다.' })
  }

  // 점수 산출
  const targetDate = new Date(date + 'T00:00:00Z')
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const scored = hospitals.map(h => {
    let score = 0
    const reasons: string[] = []

    // 1. 등급 점수
    const gradeScores: Record<string, number> = { S: 50, A: 40, B: 30, C: 20, D: 10 }
    const gradeScore = gradeScores[h.grade] || 20
    score += gradeScore
    if (h.grade === 'S') reasons.push('최고등급(S) 기관')

    // 2. 파이프라인 단계 가중치 (활발한 영업 진행 중일수록 높음)
    const pipelineScores: Record<string, number> = {
      contact: 10,
      meeting: 25,
      demo: 30,
      proposal: 35,
      contract: 40,
      active_customer: 15  // 기존 고객은 유지보수 방문
    }
    const pipeScore = pipelineScores[h.pipeline_stage] || 10
    score += pipeScore
    if (['demo', 'proposal', 'contract'].includes(h.pipeline_stage)) {
      reasons.push(`영업 진행 중 (${stageLabel(h.pipeline_stage)})`)
    }

    // 3. 마지막 방문 이후 경과일 (오래됐을수록 가산점)
    if (h.last_meeting_date) {
      const lastVisit = new Date(h.last_meeting_date + 'T00:00:00Z')
      const daysSince = Math.floor((targetDate.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince > 90) {
        score += 30
        reasons.push(`${daysSince}일 미방문 (3개월+)`)
      } else if (daysSince > 60) {
        score += 25
        reasons.push(`${daysSince}일 미방문 (2개월+)`)
      } else if (daysSince > 30) {
        score += 20
        reasons.push(`${daysSince}일 미방문 (1개월+)`)
      } else if (daysSince > 14) {
        score += 10
        reasons.push(`${daysSince}일 전 방문`)
      } else if (daysSince >= 0) {
        score += 0
        // 최근 방문 - 감점 없이 그대로
      } else {
        // 미래 날짜 미팅이 이미 잡혀있는 경우
        score -= 10
      }
    } else {
      // 한 번도 방문한 적 없는 기관 - 높은 가산점
      score += 35
      reasons.push('미방문 기관 (첫 방문 필요)')
    }

    // 4. 다음 미팅 일정이 있는 경우 (예정일 전후 3일이면 보너스)
    if (h.next_scheduled_date) {
      const nextDate = new Date(h.next_scheduled_date + 'T00:00:00Z')
      const daysDiff = Math.abs(Math.floor((targetDate.getTime() - nextDate.getTime()) / (1000 * 60 * 60 * 24)))
      if (daysDiff === 0) {
        score += 40
        reasons.push('⭐ 예정된 미팅 당일')
      } else if (daysDiff <= 3) {
        score += 20
        reasons.push(`예정 미팅 ${daysDiff}일 차이`)
      }
    }

    // 5. pending_next_action이 있으면 가산점
    if (h.pending_next_action && h.pending_next_action.trim()) {
      score += 15
      reasons.push(`후속 과제: ${h.pending_next_action.substring(0, 30)}`)
    }

    // 6. 우선순위 (1이 가장 높음, 5가 낮음)
    const priorityNum = parseInt(h.priority || '3', 10)
    if (priorityNum <= 2) {
      score += 15
      reasons.push('높은 우선순위')
    } else if (priorityNum >= 4) {
      score -= 5
    }

    // 7. 의료진 수가 많으면 가산점 (더 많은 관계 관리 필요)
    if (h.doctor_count >= 3) {
      score += 10
      reasons.push(`의료진 ${h.doctor_count}명 관리`)
    }

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
      score_breakdown: {
        grade: gradeScore,
        pipeline: pipeScore,
        recency: score - gradeScore - pipeScore // approx
      }
    }
  })

  // 점수순 정렬
  scored.sort((a, b) => b.score - a.score)

  // 상위 N개만
  const suggestions = scored.slice(0, max)

  // 해당 기관의 의료진 목록도 함께 반환
  const hospIds = suggestions.map(s => s.hospital_id)
  let doctors: any[] = []
  if (hospIds.length > 0) {
    const placeholders = hospIds.map(() => '?').join(',')
    const docResult = await c.env.DB.prepare(
      `SELECT d.id, d.name, d.hospital_id, d.position, d.department, d.phone, d.specialty, d.influence_level, d.photo
       FROM doctors d WHERE d.hospital_id IN (${placeholders}) ORDER BY d.name`
    ).bind(...hospIds).all()
    doctors = docResult.results as any[]
  }

  // 의료진을 기관별로 그룹핑
  const doctorsByHospital = new Map<number, any[]>()
  for (const doc of doctors) {
    if (!doctorsByHospital.has(doc.hospital_id)) {
      doctorsByHospital.set(doc.hospital_id, [])
    }
    doctorsByHospital.get(doc.hospital_id)!.push(doc)
  }

  // suggestions에 doctors 추가
  const enriched = suggestions.map(s => ({
    ...s,
    doctors: doctorsByHospital.get(s.hospital_id) || []
  }))

  // 지역 내 전체 통계
  const stats = {
    total_in_region: hospitals.length,
    suggested: enriched.length,
    never_visited: hospitals.filter(h => !h.last_meeting_date).length,
    active_pipeline: hospitals.filter(h => ['meeting', 'demo', 'proposal', 'contract'].includes(h.pipeline_stage)).length,
    avg_score: Math.round(scored.reduce((a, b) => a + b.score, 0) / scored.length)
  }

  return c.json({ data: enriched, stats, region, date })
})

/**
 * GET /api/schedule/regions
 * 
 * 지역별 기관 수 + 방문 필요 기관 수 요약
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
 * 
 * 선택한 기관들로 방문 계획 저장 (미팅 일괄 생성)
 */
schedule.post('/plan', async (c) => {
  const body = await c.req.json()
  const { date, visits } = body
  
  if (!date || !Array.isArray(visits) || visits.length === 0) {
    return c.json({ error: '날짜와 방문 목록이 필요합니다.' }, 400)
  }

  const created: any[] = []
  
  for (const visit of visits) {
    const { hospital_id, doctor_ids, purpose, meeting_type } = visit
    if (!hospital_id) continue

    // 기관의 첫 번째 의사 ID 가져오기 (doctor_ids가 없으면)
    let docIds = doctor_ids || []
    if (docIds.length === 0) {
      const firstDoc = await c.env.DB.prepare(
        'SELECT id FROM doctors WHERE hospital_id=? ORDER BY name LIMIT 1'
      ).bind(hospital_id).first() as any
      if (firstDoc) docIds = [firstDoc.id]
    }

    if (docIds.length === 0) continue // 의사가 없으면 스킵

    const primaryDoctorId = docIds[0]
    const r = await c.env.DB.prepare(
      'INSERT INTO meetings (doctor_id, hospital_id, meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date) VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind(
      primaryDoctorId,
      hospital_id,
      date,
      meeting_type || 'visit',
      purpose || '일정 플래너 자동 생성',
      '',
      '',
      '',
      null
    ).run()

    const meetingId = r.meta.last_row_id as number

    // Sync meeting_doctors
    for (const did of docIds) {
      await c.env.DB.prepare('INSERT INTO meeting_doctors (meeting_id, doctor_id) VALUES (?, ?)').bind(meetingId, did).run()
    }

    created.push({ meeting_id: meetingId, hospital_id, doctor_ids: docIds })
  }

  return c.json({ data: { created, count: created.length, date } })
})


function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    contact: '컨택',
    meeting: '미팅',
    demo: '데모',
    proposal: '제안',
    contract: '계약',
    active_customer: '기존고객'
  }
  return labels[stage] || stage
}

export default schedule
