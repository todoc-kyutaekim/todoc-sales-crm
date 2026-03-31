import { Hono } from 'hono'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
const ai = new Hono<{ Bindings: Bindings }>()

async function askAI(apiKey: string, baseUrl: string, prompt: string): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 10000
    })
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI API error ${res.status}: ${errText}`)
  }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content || ''
}

// ===== 1. Fetch CI-related ENT professors for a hospital =====
ai.post('/hospital-doctors', async (c) => {
  const { hospitalName, region } = await c.req.json()
  if (!hospitalName) return c.json({ error: 'hospitalName is required' }, 400)

  const prompt = `Please provide the list of ENT (이비인후과) professors/doctors at ${region ? region + ' ' : ''}${hospitalName} who are involved in cochlear implant (인공와우) surgery, hearing loss treatment (난청), otology (이과), or auditory rehabilitation (청각재활) from your training data. I understand it may be outdated - that is completely fine.

IMPORTANT: Only include doctors who are related to cochlear implant / hearing loss / otology. Do NOT include rhinology, head & neck surgery, laryngology-only doctors.

Rules:
- Include ONLY doctors you are reasonably confident are/were at this hospital
- Focus on: cochlear implant surgeons, otologists, hearing specialists, auditory rehabilitation
- For uncertain fields, use empty string ""
- department: "이비인후과"
- position: "교수", "부교수", "조교수", "임상교수" etc.
- specialty: be specific about CI-related specialty (e.g. "이과, 인공와우, 난청", "청각재활, 인공와우")
- influence_level: "high" (leading CI surgeon, society president), "medium" (experienced), "low" (junior)

Return ONLY a JSON array, absolutely no other text:
[{"name":"이름","department":"이비인후과","position":"직위","specialty":"세부전공","influence_level":"medium"}]

If you have no information, return empty array: []`

  try {
    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, prompt)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return c.json({ data: [], message: '해당 병원의 인공와우 관련 교수 정보를 찾을 수 없습니다.' })

    const doctors = JSON.parse(jsonMatch[0])
    const cleaned = doctors.map((d: any) => ({
      name: (d.name || '').trim(),
      department: d.department || '이비인후과',
      position: (d.position || '').trim(),
      specialty: (d.specialty || '').trim(),
      influence_level: ['high', 'medium', 'low'].includes(d.influence_level) ? d.influence_level : 'medium'
    })).filter((d: any) => d.name.length > 0)

    return c.json({ data: cleaned })
  } catch (e: any) {
    return c.json({ error: 'AI 조회 실패: ' + (e.message || ''), data: [] }, 500)
  }
})

// ===== 2. Fetch doctor profile (bio, education, career) =====
ai.post('/doctor-profile', async (c) => {
  const { doctorName, hospitalName, department } = await c.req.json()
  if (!doctorName || !hospitalName) return c.json({ error: 'doctorName and hospitalName required' }, 400)

  const dept = department || '이비인후과'
  const prompt = `Please provide the education, career and bio of Professor ${doctorName} from ${hospitalName} ${dept} from your training data. I understand it may be outdated.

This doctor is likely involved in cochlear implant / otology / hearing loss treatment. Focus on CI-related career details if available.

Rules:
- Only include information you are reasonably confident about
- For fields you are NOT confident about, return empty string ""
- Do NOT fabricate information
- bio: one-line introduction (Korean, focus on CI/hearing specialty)
- education: academic history separated by \\n (Korean)
- career: major career items separated by \\n (Korean). Include CI-related positions, society roles
- specialty: specific sub-specialty (cochlear implant, otology, hearing etc.)
- position: current academic position

Return ONLY JSON, no other text:
{"bio":"","education":"","career":"","specialty":"","position":""}`

  try {
    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, prompt)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return c.json({ data: { bio: '', education: '', career: '', specialty: '', position: '' } })

    const profile = JSON.parse(jsonMatch[0])
    const clean = (s: string) => (s || '').trim()
    return c.json({
      data: {
        bio: clean(profile.bio),
        education: clean(profile.education),
        career: clean(profile.career),
        specialty: clean(profile.specialty),
        position: clean(profile.position)
      }
    })
  } catch (e: any) {
    return c.json({ error: 'AI 조회 실패: ' + (e.message || ''), data: { bio: '', education: '', career: '', specialty: '', position: '' } }, 500)
  }
})

// ===== 3. Hospital name autocomplete suggestions =====
ai.post('/hospital-suggest', async (c) => {
  const { query } = await c.req.json()
  if (!query || query.trim().length < 2) return c.json({ data: [] })

  const prompt = `List Korean hospitals whose name contains or starts with "${query.trim()}". Focus on hospitals that have ENT departments performing cochlear implant surgery. Prioritize university hospitals and major general hospitals. Return at most 10 results.

Return ONLY a JSON array, no other text:
[{"name":"병원전체이름","region":"시도","address":"주소(if known, otherwise empty)"}]

Region: 서울, 경기, 부산, 대구, 광주, 대전, 인천, 울산, 세종, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주`

  try {
    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, prompt)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return c.json({ data: [] })

    const hospitals = JSON.parse(jsonMatch[0])
    const cleaned = hospitals.map((h: any) => ({
      name: (h.name || '').trim(),
      region: (h.region || '').trim(),
      address: (h.address || '').trim()
    })).filter((h: any) => h.name.length > 0).slice(0, 10)

    return c.json({ data: cleaned })
  } catch (e: any) {
    return c.json({ error: 'AI 조회 실패', data: [] }, 500)
  }
})

export default ai
