import { Hono } from 'hono'

type Bindings = { DB: D1Database; OPENAI_API_KEY: string; OPENAI_BASE_URL: string }
const ai = new Hono<{ Bindings: Bindings }>()

async function askAI(apiKey: string, baseUrl: string, prompt: string, systemPrompt?: string): Promise<string> {
  const messages: any[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: prompt })

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-5',
      messages,
      temperature: 0.1,
      max_tokens: 8000
    })
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI API error ${res.status}: ${errText}`)
  }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content || ''
}

// ===== Fetch with timeout helper =====
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

// ===== Web Search Helper =====
async function webSearch(query: string): Promise<{ title: string; link: string; snippet: string }[]> {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ko&num=10`
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      }
    }, 6000)
    const html = await res.text()
    const results: { title: string; link: string; snippet: string }[] = []
    const linkRegex = /href="\/url\?q=(https?:\/\/[^&"]+)/g
    let match
    while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
      const link = decodeURIComponent(match[1])
      if (!link.includes('google.com') && !link.includes('youtube.com') && !link.includes('webcache')) {
        results.push({ title: '', link, snippet: '' })
      }
    }
    return results
  } catch (e) {
    return []
  }
}

// ===== Web Page Crawler Helper =====
async function crawlPageRaw(url: string, timeoutMs = 5000): Promise<{ text: string; html: string }> {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    }, timeoutMs)
    if (!res.ok) return { text: '', html: '' }
    const html = await res.text()
    
    let cleaned = html
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '')
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '')
    cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    cleaned = cleaned.replace(/<head[\s\S]*?<\/head>/gi, '')
    cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, '')
    cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, '')
    // Preserve position info from HTML comments
    cleaned = cleaned.replace(/<!--(교수|부교수|조교수|임상교수|임상부교수|임상조교수|전임의|강사)-->/g, '[$1]')
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')
    
    // Also extract alt text from images (often contains doctor names)
    cleaned = cleaned.replace(/alt="([^"]{2,30})"/gi, ' $1 ')
    
    const text = cleaned
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|tr|li|h[1-6]|dt|dd)>/gi, '\n')
      .replace(/<(?:tr|li|dt)[^>]*>/gi, '\n')
      .replace(/<td[^>]*>/gi, ' | ')
      .replace(/<th[^>]*>/gi, ' | ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .substring(0, 15000)
    
    return { text, html }
  } catch (e) {
    return { text: '', html: '' }
  }
}

async function crawlPage(url: string): Promise<string> {
  const { text } = await crawlPageRaw(url)
  return text
}

// ===== Helper: check if crawled content has meaningful doctor data =====
// Some hospital pages return HTML but lack actual professor/specialty info
function hasMeaningfulDoctorData(text: string): boolean {
  // Count how many Korean names (2-4 syllable) appear near doctor-related keywords
  const koreanNamePattern = /[가-힣]{2,4}/g
  const names = text.match(koreanNamePattern) || []
  const doctorKeywords = ['교수', '전문의', '전공', '세부전공', '진료분야', '인공와우', '난청', '이과', '원장', '부원장', '대표원장', '보청기', '청각']
  const hasKeywords = doctorKeywords.some(kw => text.includes(kw))
  // Need at least some names AND relevant keywords
  return names.length >= 3 && hasKeywords
}

// ===== 1. Fetch CI-related ENT doctors for a hospital/clinic (OPTIMIZED) =====
ai.post('/hospital-doctors', async (c) => {
  const { hospitalName, region, type } = await c.req.json()
  if (!hospitalName) return c.json({ error: 'hospitalName is required' }, 400)

  const isClinic = type === 'clinic' || hospitalName.includes('의원') || hospitalName.includes('보청기') || hospitalName.includes('이비인후과') || hospitalName.includes('클리닉') || hospitalName.includes('센터')
  const searchQuery = isClinic
    ? `${hospitalName} 원장 의료진 의사 이비인후과 난청 보청기`
    : `${hospitalName} 이비인후과 의료진 교수 인공와우 난청`
  let crawledContent = ''
  let sourceUrl = ''
  let rawSearchHtml = ''
  let searchResults: { title: string; link: string; snippet: string }[] = []

  // ===== PHASE 1: Parallel crawling — known URLs + Google search simultaneously =====
  try {
    const hospitalSearchUrls = getHospitalSearchUrls(hospitalName)
    const crawledParts: string[] = []

    // Launch known URL crawls AND Google search in parallel
    const knownCrawlPromises = hospitalSearchUrls.map(async (tryUrl) => {
      try {
        const { text, html } = await crawlPageRaw(tryUrl, 6000)
        if (text && text.length > 300 && hasMeaningfulDoctorData(text)) {
          return { url: tryUrl, text, html, ok: true as const }
        }
      } catch (e) { /* skip */ }
      return { url: tryUrl, text: '', html: '', ok: false as const }
    })

    const googleSearchPromise = webSearch(searchQuery)

    // Wait for all known crawls + Google search together
    const [knownResults, googleResults] = await Promise.all([
      Promise.all(knownCrawlPromises),
      googleSearchPromise
    ])

    // Process known URL results
    for (const r of knownResults) {
      if (r.ok) {
        crawledParts.push(`[출처: ${r.url}]\n${r.text}`)
        if (!sourceUrl) sourceUrl = r.url
        if (!rawSearchHtml && r.html) rawSearchHtml = r.html
      }
    }
    if (crawledParts.length > 0) {
      crawledContent = crawledParts.join('\n\n===== 추가 페이지 =====\n\n')
    }

    searchResults = googleResults

    // If known URLs didn't yield enough, use Google search results
    // Threshold: 3000 chars is enough for ~5-10 professor entries from hospital pages
    const needGoogleCrawl = !crawledContent || crawledContent.length < 3000
    if (needGoogleCrawl && searchResults.length > 0) {
      const snippetData = searchResults
        .filter(r => r.snippet && (r.snippet.includes('교수') || r.snippet.includes('인공와우') || r.snippet.includes('이비인후과') || r.snippet.includes('난청') || r.snippet.includes('원장') || r.snippet.includes('보청기') || r.snippet.includes('전문의') || r.snippet.includes('청각')))
        .map(r => `${r.title}: ${r.snippet} (${r.link})`)
        .join('\n')
      if (snippetData) {
        crawledContent = (crawledContent ? crawledContent + '\n\n===== Google 검색 보충 데이터 =====\n\n' : '') +
          `[Google 검색 결과 snippet]\n${snippetData}\n\n`
      }

      // Pick top relevant Google links and crawl them all in parallel
      const relevantLinks = searchResults.slice(0, 6).filter(r =>
        r.link.includes('doctor') || r.link.includes('medic') ||
        r.link.includes('search') || r.link.includes('staff') ||
        r.link.includes('professor') || r.link.includes('blog') ||
        r.link.includes('dept') || r.link.includes('department') ||
        r.link.includes('treatment') || r.link.includes('prof') ||
        r.link.includes('인공와우') || r.link.includes('ENT') ||
        r.link.includes('이비인후')
      ).slice(0, 2)

      const googleCrawls = await Promise.all(relevantLinks.map(async (result) => {
        try {
          const content = await crawlPage(result.link)
          if (content && content.length > 300 && (content.includes('이비인후과') || content.includes('교수') || content.includes('인공와우') || content.includes('원장') || content.includes('보청기') || content.includes('전문의'))) {
            return { link: result.link, content }
          }
        } catch (e) { /* skip */ }
        return null
      }))

      for (const gc of googleCrawls) {
        if (gc) {
          crawledContent += `\n[크롤링: ${gc.link}]\n${gc.content}\n`
          if (!sourceUrl) sourceUrl = gc.link
        }
      }
    }

    // If still no content, try broader Google search with parallel crawl
    if (!crawledContent || crawledContent.length < 500) {
      const broadQuery = isClinic
        ? `"${hospitalName}" 원장 의료진 전문의 의사`
        : `"${hospitalName}" "인공와우" OR "cochlear implant" 교수`
      const broadSearch = await webSearch(broadQuery)
      const broadCrawls = await Promise.all(broadSearch.slice(0, 2).map(async (result) => {
        try {
          const content = await crawlPage(result.link)
          if (content && content.length > 200) return { link: result.link, content }
        } catch (e) { /* skip */ }
        return null
      }))
      for (const bc of broadCrawls) {
        if (bc) {
          crawledContent += `\n[보충 크롤링: ${bc.link}]\n${bc.content}\n`
          if (!sourceUrl) sourceUrl = bc.link
        }
      }
    }
  } catch (e) {
    // Continue even if search/crawl fails
  }

  // ===== PHASE 2: Build context =====
  let contextInfo = ''
  if (crawledContent) {
    contextInfo = `다음은 ${hospitalName} 홈페이지 및 웹 검색에서 가져온 실제 의료진 정보입니다 (출처: ${sourceUrl}):\n\n${crawledContent.substring(0, 15000)}\n\n`
  } else if (searchResults.length > 0) {
    contextInfo = `웹 검색 결과 (검색어: "${searchQuery}"):\n` +
      searchResults.map((r, i) => `${i + 1}. ${r.title} - ${r.link}\n   ${r.snippet}`).join('\n') + '\n\n'
  }

  const hasCrawledData = !!(crawledContent && crawledContent.length > 100)
  const hasSearchData = searchResults.length > 0
  const hasAnyExternalData = hasCrawledData || hasSearchData

  // If NO external data at all, use AI knowledge as fallback
  if (!hasAnyExternalData) {
    const fallbackPrompt = isClinic
      ? `${region ? region + ' ' : ''}${hospitalName}에서 근무하는 의료진(원장, 부원장, 전문의 등)을 알려주세요.

중요 규칙:
1. 현재 재직 중인 의료진만 포함 (퇴직자 제외)
2. 이비인후과, 난청, 보청기, 청각 관련 의료진을 우선 포함
3. 확실하지 않은 의료진은 포함하지 마세요
4. 의원/클리닉의 경우 원장, 부원장, 전문의 등의 직위를 정확히 기재

각 의료진에 대해:
- name: 정확한 이름
- department: "이비인후과" 또는 해당 진료과
- position: "원장", "부원장", "전문의" 등
- specialty: 전문분야 (난청, 보청기, 인공와우, 이명 등)
- influence_level: "high" (원장/핵심), "medium" (부원장/전문의), "low" (일반)
- notes: 관련 활동 (없으면 "")
- source: "AI 학습 데이터 (확인 필요)"

JSON 배열만 반환:
[{"name":"","department":"","position":"","specialty":"","influence_level":"","notes":"","source":"AI 학습 데이터 (확인 필요)"}]

알 수 없으면 빈 배열 [] 반환.`
      : `${region ? region + ' ' : ''}${hospitalName} 이비인후과에서 인공와우(CI) 수술, 난청 치료, 이과학을 전문으로 하는 현재 재직 중인 교수를 알려주세요.

중요 규칙:
1. 현재 재직 중인 교수만 포함 (사망, 퇴직, 전출 교수 제외)
2. 인공와우, 난청, 이과학 관련 교수만 포함
3. 두경부외과, 비과(코), 음성질환 전문 교수는 제외
4. 확실하지 않은 교수는 포함하지 마세요
5. 소아이비인후과에서 인공와우/난청 관련 교수도 포함

각 교수에 대해:
- name: 정확한 이름
- department: "이비인후과" 또는 "소아이비인후과"
- position: "교수", "부교수" 등
- specialty: 전문분야
- influence_level: "high" (인공와우 전문), "medium" (난청/이과)
- notes: 관련 활동 (없으면 "")
- source: "AI 학습 데이터 (확인 필요)"

JSON 배열만 반환:
[{"name":"","department":"","position":"","specialty":"","influence_level":"","notes":"","source":"AI 학습 데이터 (확인 필요)"}]

알 수 없으면 빈 배열 [] 반환.`

    try {
      const systemPrompt = isClinic
        ? '한국 이비인후과 의원/클리닉에 대해 잘 아는 전문가입니다. 확실하게 알고 있는 정보만 제공하며, 불확실한 정보는 제외합니다.'
        : '한국 의료계에 대해 잘 아는 전문가입니다. 확실하게 알고 있는 정보만 제공하며, 불확실한 정보는 제외합니다.'
      const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, fallbackPrompt, systemPrompt)
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const doctors = JSON.parse(jsonMatch[0])
        const cleaned = doctors.map((d: any) => ({
          name: (d.name || '').trim(),
          department: d.department || '이비인후과',
          position: (d.position || (isClinic ? '원장' : '교수')).trim(),
          specialty: (d.specialty || '').trim(),
          influence_level: ['high', 'medium', 'low'].includes(d.influence_level) ? d.influence_level : 'medium',
          notes: (d.notes || '').trim(),
          source: 'AI 학습 데이터 (확인 필요)'
        })).filter((d: any) => d.name.length > 0)
        return c.json({ data: cleaned, source: 'AI 학습 데이터 (확인 필요)', crawled: false })
      }
    } catch (e) { /* ignore */ }
    return c.json({ data: [], message: '해당 병원의 정보를 찾을 수 없습니다.', source: '' })
  }

  // ===== PHASE 3: Single AI call — combined extraction (replaces 2-pass approach) =====
  let enrichedContext = contextInfo
  const hn = hospitalName.toLowerCase()

  // For SNUH: launch Bundang cross-reference crawl IN PARALLEL with AI call
  // Don't block — just include Bundang data if available alongside the AI response
  const bundangPromise = (hn.includes('서울대') && !hn.includes('분당'))
    ? crawlPageRaw('https://www.snubh.org/medical/drMedicalTeam.do?DP_TP=O&DP_CD=OL', 4000).catch(() => ({ text: '', html: '' }))
    : Promise.resolve({ text: '', html: '' })

  // Add Bundang hint to prompt (the AI should distinguish affiliations)
  if (hn.includes('서울대') && !hn.includes('분당')) {
    enrichedContext += '\n\n[참고: 분당서울대병원(snubh.org)은 별도 기관입니다. 분당 소속 교수를 서울대병원 소속으로 잘못 분류하지 마세요.]\n'
  }

  // SINGLE combined AI prompt (replaces firstPass + finalExtraction)
  const combinedPrompt = isClinic
    ? `${enrichedContext}\n\n위의 모든 데이터를 종합하여 ${region ? region + ' ' : ''}${hospitalName}의 의료진(원장, 부원장, 전문의 등)을 정리하세요.

중요 규칙:
1. 위 크롤링/검색 데이터에 실제로 나온 의료진만 포함 (없는 의료진 추측 금지)
2. 원장 = high, 부원장/파트장 = medium, 전문의/일반의 = low
3. 이비인후과, 난청, 보청기, 청각, 인공와우 관련 의료진을 우선 포함
4. 사망/퇴직한 의료진은 제외
5. position은 반드시 기재 — "원장", "부원장", "전문의", "대표원장" 등
6. specialty에는 웹사이트에서 확인된 진료분야를 모두 기재

각 의료진에 대해:
- name: 정확한 이름
- department: "이비인후과" 또는 해당 진료과
- position: "원장", "부원장", "전문의", "대표원장" 등 (반드시 기재)
- specialty: 진료분야 (난청, 보청기, 인공와우, 이명, 어지러움 등)
- influence_level: "high", "medium", "low" (위 기준 적용)
- notes: 관련 활동 요약 (없으면 빈 문자열)
- source: 출처 URL

JSON 배열만 반환:
[{"name":"","department":"","position":"","specialty":"","influence_level":"","notes":"","source":""}]`
    : `${enrichedContext}\n\n위의 모든 데이터를 종합하여 ${region ? region + ' ' : ''}${hospitalName} 이비인후과 교수 중 인공와우(CI)/난청/이과 관련 교수를 정리하세요.

중요 규칙:
1. 위 크롤링/검색 데이터에 실제로 나온 교수만 포함 (없는 교수 추측 금지)
2. 세부전공에 "인공와우", "와우이식"이 명시된 교수 = high
3. 세부전공에 "난청", "이과학"만 있지만 뉴스/검색에서 인공와우 관련 활동이 확인된 교수 = high
4. 세부전공에 "난청", "이과학", "중이염"이 있지만 인공와우 활동이 확인 안 된 교수 = medium
5. 사망/퇴직한 교수는 제외
6. 두경부외과, 비과(코), 음성질환, 갑상선, 로봇수술 전문 교수는 제외 (단, 인공와우 관련 활동이 확인되면 포함)
7. 소아이비인후과에서 인공와우/난청 관련 교수는 포함
8. 소속 병원을 정확히 구분 (예: "서울대병원" ≠ "분당서울대병원")
9. specialty에는 병원 홈페이지 세부전공 + 뉴스에서 확인된 추가 전문분야를 모두 기재
10. position은 반드시 기재 - 데이터에 없으면 "교수"로 기재

각 교수에 대해:
- name: 정확한 이름
- department: "이비인후과" 또는 "소아이비인후과"
- position: "교수", "부교수", "조교수" 등 (반드시 기재)
- specialty: 병원 홈페이지 세부전공 + 뉴스에서 확인된 전문분야 포함
- influence_level: "high", "medium", "low" (위 기준 적용)
- notes: 관련 뉴스/활동 요약 (없으면 빈 문자열)
- source: 출처 URL

JSON 배열만 반환:
[{"name":"","department":"","position":"","specialty":"","influence_level":"","notes":"","source":""}]`

  try {
    const systemPrompt = isClinic
      ? '당신은 한국 이비인후과 의원/클리닉 의료진 데이터를 정확히 추출하는 전문가입니다. 주어진 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다.'
      : '당신은 한국 병원 의료진 데이터를 정확히 추출하는 전문가입니다. 주어진 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다.'
    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, combinedPrompt, systemPrompt)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.error('[AI-DOCTORS] No JSON array in AI response. Raw (first 500):', raw.substring(0, 500))
      return c.json({ data: [], message: '해당 기관의 관련 의료진 정보를 찾을 수 없습니다.', source: sourceUrl })
    }

    const doctors = JSON.parse(jsonMatch[0])
    const cleaned = doctors.map((d: any) => ({
      name: (d.name || '').trim(),
      department: d.department || '이비인후과',
      position: (d.position || '').trim(),
      specialty: (d.specialty || '').trim(),
      influence_level: ['high', 'medium', 'low'].includes(d.influence_level) ? d.influence_level : 'medium',
      notes: (d.notes || '').trim(),
      source: d.source || sourceUrl || '웹 검색'
    })).filter((d: any) => d.name.length > 0)

    return c.json({ data: cleaned, source: sourceUrl || '웹 검색', crawled: !!crawledContent })
  } catch (e: any) {
    console.error('[AI-DOCTORS] Error:', e.message || e)
    return c.json({ error: 'AI 조회 실패: ' + (e.message || ''), data: [] }, 500)
  }
})

// ===== 2. Fetch doctor profile (bio, education, career) =====
ai.post('/doctor-profile', async (c) => {
  const { doctorName, hospitalName, department } = await c.req.json()
  if (!doctorName || !hospitalName) return c.json({ error: 'doctorName and hospitalName required' }, 400)

  const dept = department || '이비인후과'
  const isClinic = hospitalName.includes('의원') || hospitalName.includes('보청기') || hospitalName.includes('이비인후과') || hospitalName.includes('클리닉') || hospitalName.includes('센터')
  let crawledContent = ''
  let sourceUrl = ''

  try {
    const profileUrls = getProfileSearchUrls(hospitalName, doctorName)
    
    for (const tryUrl of profileUrls) {
      const { text, html: rawHtml } = await crawlPageRaw(tryUrl)
      if (text && text.length > 200 && (text.includes(doctorName) || text.includes('경력') || text.includes('학력') || text.includes('원장') || text.includes('진료'))) {
        crawledContent = text
        sourceUrl = tryUrl
        
        if (tryUrl.includes('search.snuh.org') && rawHtml) {
          const blogMatch = rawHtml.match(/snuh\.org\/blog\/(\d+)/)
          if (blogMatch) {
            const careerUrl = `https://www.snuh.org/blog/${blogMatch[1]}/career.do`
            const careerContent = await crawlPage(careerUrl)
            if (careerContent && careerContent.length > 300 && (careerContent.includes('학력') || careerContent.includes('경력'))) {
              crawledContent = careerContent
              sourceUrl = careerUrl
            }
          }
        }
        break
      }
    }

    if (!crawledContent) {
      const searchQuery = isClinic
        ? `${hospitalName} ${doctorName} 원장 의사 경력 학력 이비인후과`
        : `${hospitalName} ${doctorName} 교수 이비인후과 경력 학력`
      const searchResults = await webSearch(searchQuery)
      for (const result of searchResults.slice(0, 5)) {
        const content = await crawlPage(result.link)
        if (content && content.length > 200 && (content.includes(doctorName) || content.includes('경력'))) {
          crawledContent = content
          sourceUrl = result.link
          
          if (result.link.includes('snuh.org/blog/')) {
            const blogIdMatch = result.link.match(/blog\/(\d+)/)
            if (blogIdMatch) {
              const careerUrl = `https://www.snuh.org/blog/${blogIdMatch[1]}/career.do`
              const careerContent = await crawlPage(careerUrl)
              if (careerContent && careerContent.length > 300) {
                crawledContent += '\n\n===== 상세 학력/경력 =====\n' + careerContent
                sourceUrl = careerUrl
              }
            }
          }
          break
        }
      }
    }
  } catch (e) { /* Continue */ }

  let contextInfo = ''
  const titleLabel = isClinic ? '원장/의사' : '교수'
  if (crawledContent) {
    contextInfo = `다음은 ${hospitalName} ${doctorName} ${titleLabel}의 프로필 페이지에서 가져온 실제 정보입니다 (출처: ${sourceUrl}):\n\n${crawledContent.substring(0, 25000)}\n\n`
  }

  const prompt = `${contextInfo}위 데이터에서 ${hospitalName} ${dept} ${doctorName} ${titleLabel}의 프로필 정보를 추출하세요.

중요 규칙:
1. 위 크롤링 데이터에 실제로 있는 정보만 추출하세요
2. 데이터에 없는 정보는 빈 문자열 ""로 남기세요 - 추측하지 마세요
3. 확인할 수 없는 정보에는 "[업데이트 필요]"를 붙이지 마세요, 그냥 빈 문자열로 두세요
4. ${isClinic ? '난청/보청기/청각/이비인후과 관련 경력을 우선적으로 추출하세요' : '인공와우/이과/난청 관련 경력을 우선적으로 추출하세요'}

JSON 형식으로만 반환:
{"bio":"한줄 소개(한국어)","education":"학력(줄바꿈으로 구분)","career":"주요 경력(줄바꿈으로 구분)","specialty":"세부 전공","position":"현재 직위","source":"${sourceUrl || ''}"}`

  try {
    const systemPrompt = isClinic
      ? '한국 이비인후과 의원/클리닉 의료진 프로필 데이터를 정확히 추출하는 전문가입니다. 크롤링된 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다.'
      : '한국 병원 의료진 프로필 데이터를 정확히 추출하는 전문가입니다. 크롤링된 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다.'
    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, prompt, systemPrompt)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return c.json({ data: { bio: '', education: '', career: '', specialty: '', position: '' }, source: sourceUrl })

    const profile = JSON.parse(jsonMatch[0])
    const clean = (s: string) => (s || '').trim()
    return c.json({
      data: {
        bio: clean(profile.bio),
        education: clean(profile.education),
        career: clean(profile.career),
        specialty: clean(profile.specialty),
        position: clean(profile.position),
        source: sourceUrl || ''
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

// ===== Korean Name Romanization =====
// Comprehensive jamo-level romanization for PubMed author search
const INITIAL_CONSONANTS: Record<string, string> = {
  'ㄱ': 'G', 'ㄲ': 'Kk', 'ㄴ': 'N', 'ㄷ': 'D', 'ㄸ': 'Tt',
  'ㄹ': 'R', 'ㅁ': 'M', 'ㅂ': 'B', 'ㅃ': 'Pp', 'ㅅ': 'S',
  'ㅆ': 'Ss', 'ㅇ': '', 'ㅈ': 'J', 'ㅉ': 'Jj', 'ㅊ': 'Ch',
  'ㅋ': 'K', 'ㅌ': 'T', 'ㅍ': 'P', 'ㅎ': 'H'
}
const MEDIAL_VOWELS: Record<string, string> = {
  'ㅏ': 'a', 'ㅐ': 'ae', 'ㅑ': 'ya', 'ㅒ': 'yae', 'ㅓ': 'eo',
  'ㅔ': 'e', 'ㅕ': 'yeo', 'ㅖ': 'ye', 'ㅗ': 'o', 'ㅘ': 'wa',
  'ㅙ': 'wae', 'ㅚ': 'oe', 'ㅛ': 'yo', 'ㅜ': 'u', 'ㅝ': 'wo',
  'ㅞ': 'we', 'ㅟ': 'wi', 'ㅠ': 'yu', 'ㅡ': 'eu', 'ㅢ': 'ui',
  'ㅣ': 'i'
}
const FINAL_CONSONANTS: Record<string, string> = {
  '': '', 'ㄱ': 'k', 'ㄲ': 'k', 'ㄳ': 'k', 'ㄴ': 'n',
  'ㄵ': 'n', 'ㄶ': 'n', 'ㄷ': 't', 'ㄹ': 'l', 'ㄺ': 'l',
  'ㄻ': 'l', 'ㄼ': 'l', 'ㄽ': 'l', 'ㄾ': 'l', 'ㄿ': 'l',
  'ㅀ': 'l', 'ㅁ': 'm', 'ㅂ': 'p', 'ㅄ': 'p', 'ㅅ': 't',
  'ㅆ': 't', 'ㅇ': 'ng', 'ㅈ': 't', 'ㅊ': 't', 'ㅋ': 'k',
  'ㅌ': 't', 'ㅍ': 'p', 'ㅎ': 't'
}

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const MEDIALS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

function decomposeHangul(char: string): { initial: string; medial: string; final: string } | null {
  const code = char.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return null
  const offset = code - 0xAC00
  const initialIdx = Math.floor(offset / (21 * 28))
  const medialIdx = Math.floor((offset % (21 * 28)) / 28)
  const finalIdx = offset % 28
  return {
    initial: INITIALS[initialIdx],
    medial: MEDIALS[medialIdx],
    final: FINALS[finalIdx]
  }
}

function romanizeSyllable(char: string): string {
  const decomposed = decomposeHangul(char)
  if (!decomposed) return char
  const init = INITIAL_CONSONANTS[decomposed.initial] || ''
  const med = MEDIAL_VOWELS[decomposed.medial] || ''
  const fin = FINAL_CONSONANTS[decomposed.final] || ''
  return init + med + fin
}

// Known professor name romanizations (common in PubMed)
const KNOWN_ROMANIZATIONS: Record<string, string[]> = {
  '이준호': ['Lee JH', 'Lee Jun Ho', 'Lee Junho'],
  '서명환': ['Suh MW', 'Suh Myung-Whan', 'Seo Myung Whan'],
  '이상연': ['Lee SY', 'Lee Sang-Yeon', 'Lee Sang Yeon'],
  '송재진': ['Song JJ', 'Song Jae-Jin', 'Song Jaejin'],
  '구자원': ['Koo JW', 'Koo Ja-Won', 'Ku Ja Won'],
  '박무균': ['Park MK', 'Park Moo-Kyun'],
  '김동영': ['Kim DY', 'Kim Dong-Young'],
  '안순현': ['Ahn SH', 'An Soon-Hyun'],
  '김현직': ['Kim HJ', 'Kim Hyun-Jik'],
  '권성근': ['Kwon SK', 'Kwon Sung-Keun'],
  '최병윤': ['Choi BY', 'Choi Byung Yoon'],
  '정은재': ['Chung EJ', 'Jung Eun-Jae'],
  '정진세': ['Chung J', 'Chung Jin Se', 'Jung Jin Se'],
  '최재영': ['Choi JY', 'Choi Jae Young'],
  '문일준': ['Moon IJ', 'Moon Il Joon'],
  '이일우': ['Lee IW', 'Lee Il Woo'],
  '안용휘': ['Ahn YH', 'An Yong Hwi'],
  '홍승호': ['Hong SH', 'Hong Seung Ho'],
  '이종대': ['Lee JD', 'Lee Jong Dae'],
  '정연훈': ['Jung YH', 'Chung Yun Hoon', 'Chung YH'],
  '장정훈': ['Jang JH', 'Chang Jung Hoon'],
  '박홍주': ['Park HJ', 'Park Hong Ju'],
  '이상민': ['Lee SM', 'Lee Sang Min'],
  '이효정': ['Lee HJ', 'Lee Hyo-Jeong'],
  '조형호': ['Cho HH', 'Jo Hyung Ho'],
}

// Common Korean surname romanization variants
const SURNAME_VARIANTS: Record<string, string[]> = {
  '김': ['Kim'],
  '이': ['Lee', 'Yi', 'Li', 'Rhee'],
  '박': ['Park', 'Pak', 'Bark'],
  '최': ['Choi', 'Choe'],
  '정': ['Jung', 'Chung', 'Jeong'],
  '조': ['Cho', 'Jo'],
  '강': ['Kang', 'Gang'],
  '윤': ['Yoon', 'Yun'],
  '장': ['Jang', 'Chang'],
  '임': ['Lim', 'Im', 'Yim'],
  '한': ['Han'],
  '오': ['Oh', 'O'],
  '서': ['Seo', 'Suh', 'So'],
  '신': ['Shin', 'Sin'],
  '권': ['Kwon', 'Kweon'],
  '황': ['Hwang'],
  '안': ['Ahn', 'An'],
  '송': ['Song'],
  '류': ['Ryu', 'Lyu', 'Yoo'],
  '전': ['Jeon', 'Chun', 'Jun'],
  '홍': ['Hong'],
  '고': ['Ko', 'Go', 'Koh'],
  '문': ['Moon', 'Mun'],
  '양': ['Yang'],
  '손': ['Son', 'Sohn'],
  '배': ['Bae', 'Pae'],
  '백': ['Baek', 'Paik', 'Back'],
  '허': ['Heo', 'Hur', 'Huh'],
  '유': ['Yoo', 'Yu', 'You'],
  '남': ['Nam'],
  '심': ['Shim', 'Sim'],
  '노': ['Noh', 'Roh', 'No'],
  '하': ['Ha'],
  '구': ['Koo', 'Ku', 'Gu'],
  '곽': ['Kwak', 'Gwak'],
  '성': ['Sung', 'Seong'],
  '차': ['Cha'],
  '주': ['Joo', 'Ju'],
  '우': ['Woo', 'Wu'],
  '민': ['Min'],
  '탁': ['Tak'],
  '원': ['Won'],
  '채': ['Chae'],
  '천': ['Cheon', 'Chun'],
  '방': ['Bang'],
  '공': ['Kong', 'Gong'],
  '현': ['Hyun', 'Hyeon'],
  '변': ['Byun', 'Byeon'],
  '염': ['Yeom'],
  '여': ['Yeo'],
  '추': ['Chu', 'Choo'],
  '도': ['Do'],
  '소': ['So'],
  '석': ['Seok', 'Suk'],
  '선': ['Sun', 'Seon'],
  '설': ['Seol', 'Sul'],
  '마': ['Ma'],
  '길': ['Gil', 'Kil'],
  '연': ['Yeon'],
  '위': ['Wi'],
  '표': ['Pyo'],
  '명': ['Myung', 'Myeong'],
  '기': ['Ki', 'Gi'],
  '반': ['Ban'],
  '피': ['Pi'],
  '왕': ['Wang'],
  '금': ['Geum', 'Keum'],
  '봉': ['Bong'],
  '제': ['Je'],
  '탄': ['Tan'],
  '빈': ['Bin'],
  '팽': ['Paeng'],
  '당': ['Dang'],
  '목': ['Mok'],
}

function romanizeKoreanName(nameKR: string): string[] {
  // Check known romanizations first
  if (KNOWN_ROMANIZATIONS[nameKR]) {
    return KNOWN_ROMANIZATIONS[nameKR]
  }

  const chars = [...nameKR]
  if (chars.length < 2 || chars.length > 4) return []

  const surname = chars[0]
  const givenChars = chars.slice(1)

  const surnameVariants = SURNAME_VARIANTS[surname]
  if (!surnameVariants) {
    // Fallback: romanize algorithmically
    const sRoman = romanizeSyllable(surname)
    const gRoman = givenChars.map(c => romanizeSyllable(c)).join('')
    const gRomanHyphen = givenChars.map(c => romanizeSyllable(c)).join('-')
    return [
      `${sRoman} ${gRoman}`,
      `${sRoman} ${gRomanHyphen}`
    ]
  }

  const results: string[] = []
  const givenRomanParts = givenChars.map(c => romanizeSyllable(c))
  const givenJoined = givenRomanParts.join('')
  const givenHyphen = givenRomanParts.join('-')
  const givenSpace = givenRomanParts.join(' ')

  // Generate multiple romanization forms for PubMed search
  for (const sv of surnameVariants.slice(0, 2)) {
    // Most common PubMed format: "Lee JH" (surname + initials)
    const initials = givenRomanParts.map(p => p[0]?.toUpperCase() || '').join('')
    results.push(`${sv} ${initials}`)
    // Full: "Lee Jun Ho"
    results.push(`${sv} ${givenSpace}`)
    // Hyphenated: "Lee Jun-Ho"
    results.push(`${sv} ${givenHyphen}`)
    // Joined: "Lee Junho"
    results.push(`${sv} ${givenJoined}`)
  }

  // Deduplicate
  return [...new Set(results)]
}

// CI-related search terms for PubMed
const SEARCH_TERMS = [
  'cochlear implant',
  'hearing loss',
  'otology'
]

// ===== 4. Fetch doctor's research papers from PubMed =====
ai.post('/doctor-papers', async (c) => {
  const { doctorName, hospitalName, specialty } = await c.req.json()
  if (!doctorName) return c.json({ error: 'doctorName is required' }, 400)

  try {
    const nameKR = doctorName.trim()
    const hospitalEng = getHospitalEnglishName(hospitalName || '')
    
    // Step 1: Convert Korean name to romanized forms
    const romanizedNames = romanizeKoreanName(nameKR)
    if (!romanizedNames.length) {
      // Last resort: use AI to romanize
      try {
        const aiRaw = await askAI(
          c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL,
          `Convert the Korean name "${nameKR}" to its common English/romanized forms used in academic publications. Return a JSON array of possible romanizations like ["Lee Jun Ho", "Lee JH"]. Only JSON array, no other text.`
        )
        const match = aiRaw.match(/\[[\s\S]*\]/)
        if (match) {
          const aiNames = JSON.parse(match[0]).filter((n: string) => n.length > 2)
          if (aiNames.length) {
            return await searchPubMedWithNames(aiNames, hospitalEng, SEARCH_TERMS)
          }
        }
      } catch (e) { /* ignore */ }
      return c.json({ data: [], message: '이름 변환 실패' })
    }

    return await searchPubMedWithNames(romanizedNames, hospitalEng, SEARCH_TERMS)
  } catch (e: any) {
    return c.json({ error: 'PubMed 검색 실패: ' + (e.message || ''), data: [] }, 500)
  }

  async function searchPubMedWithNames(romanizedNames: string[], hospitalEng: string, searchTerms: string[]) {
    const allPapers: any[] = []
    const seenPmids = new Set<string>()

    // Search strategy 1: Name + Hospital + Topic
    for (const rName of romanizedNames.slice(0, 3)) {
      let query = `${rName}[Author]`
      if (hospitalEng) query += ` AND (${hospitalEng}[Affiliation] OR Korea[Affiliation])`
      const topicTerms = searchTerms.slice(0, 3).map(t => `${t}[Title/Abstract]`).join(' OR ')
      if (topicTerms) query += ` AND (${topicTerms})`

      await fetchPubMedArticles(query, allPapers, seenPmids)
    }

    // Search strategy 2: Name + ENT journal filter (broader)
    if (allPapers.length < 5 && romanizedNames.length > 0) {
      for (const rName of romanizedNames.slice(0, 2)) {
        let broadQuery = `${rName}[Author]`
        if (hospitalEng) broadQuery += ` AND (${hospitalEng}[Affiliation] OR Korea[Affiliation])`
        broadQuery += ' AND (otolaryngol*[Journal] OR otol*[Journal] OR audiol*[Journal] OR hear*[Title] OR cochlear[Title] OR implant[Title] OR vestibul*[Title])'

        await fetchPubMedArticles(broadQuery, allPapers, seenPmids)
      }
    }

    // Search strategy 3: Just name + hospital (no topic) if still few results
    if (allPapers.length < 3 && romanizedNames.length > 0 && hospitalEng) {
      const nameOnly = romanizedNames[0]
      const simpleQuery = `${nameOnly}[Author] AND ${hospitalEng}[Affiliation]`
      await fetchPubMedArticles(simpleQuery, allPapers, seenPmids, 10)
    }

    allPapers.sort((a, b) => (b.year || 0) - (a.year || 0))

    return c.json({
      data: allPapers.slice(0, 30),
      total: allPapers.length,
      searchedNames: romanizedNames,
      hospital: hospitalEng
    })
  }
})

// Helper: fetch PubMed articles and add to collection
async function fetchPubMedArticles(query: string, allPapers: any[], seenPmids: Set<string>, maxResults = 20): Promise<void> {
  try {
    // NCBI E-Utilities requires tool & email for API access
    const ncbiParams = '&tool=todoc-crm&email=todoc-crm@to-doc.com'
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=${maxResults}&sort=date&retmode=json${ncbiParams}`
    const searchRes = await fetchWithTimeout(searchUrl, {
      headers: { 'User-Agent': 'ToDoc-CRM/1.0 (medical-crm; mailto:todoc-crm@to-doc.com)' }
    }, 10000)
    if (!searchRes.ok) return
    const searchData = await searchRes.json() as any
    const pmids = (searchData?.esearchresult?.idlist || []).filter((id: string) => !seenPmids.has(id))
    if (!pmids.length) return

    pmids.forEach((id: string) => seenPmids.add(id))

    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json${ncbiParams}`
    const summaryRes = await fetchWithTimeout(summaryUrl, {
      headers: { 'User-Agent': 'ToDoc-CRM/1.0 (medical-crm; mailto:todoc-crm@to-doc.com)' }
    }, 10000)
    if (!summaryRes.ok) return
    const summaryData = await summaryRes.json() as any
    const results = summaryData?.result || {}

    for (const pmid of pmids) {
      const article = results[pmid]
      if (!article || !article.title) continue
      allPapers.push({
        title: article.title.replace(/<\/?[^>]+>/g, ''),
        journal: article.source || article.fulljournalname || '',
        year: article.pubdate ? parseInt(article.pubdate.split(' ')[0]) : null,
        authors: (article.authors || []).map((a: any) => a.name).join(', '),
        doi: (article.elocationid || '').replace('doi: ', ''),
        paper_type: 'journal',
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        pmid: pmid
      })
    }
  } catch (e) { /* continue */ }
}

// ===== Helper: Hospital Korean to English name mapping =====
function getHospitalEnglishName(hospitalName: string): string {
  const name = hospitalName.replace(/\s/g, '')
  if (name.includes('서울대') && !name.includes('분당')) return 'Seoul National University'
  if (name.includes('분당') && name.includes('서울대')) return 'Seoul National University Bundang'
  if (name.includes('삼성')) return 'Samsung Medical Center'
  if (name.includes('아산')) return 'Asan Medical Center'
  if (name.includes('세브란스') || name.includes('연세')) return 'Yonsei University'
  if (name.includes('가톨릭') || name.includes('성모')) return 'Catholic University'
  if (name.includes('고려대')) return 'Korea University'
  if (name.includes('아주')) return 'Ajou University'
  if (name.includes('경북대')) return 'Kyungpook National University'
  if (name.includes('부산대')) return 'Pusan National University'
  if (name.includes('전남대')) return 'Chonnam National University'
  if (name.includes('충남대')) return 'Chungnam National University'
  if (name.includes('충북대')) return 'Chungbuk National University'
  if (name.includes('인하')) return 'Inha University'
  if (name.includes('한양')) return 'Hanyang University'
  if (name.includes('중앙')) return 'Chung-Ang University'
  if (name.includes('순천향')) return 'Soon Chun Hyang University'
  if (name.includes('동아')) return 'Dong-A University'
  if (name.includes('전북대') || name.includes('전남대')) return 'Chonbuk National University'
  if (name.includes('원광')) return 'Wonkwang University'
  if (name.includes('건국')) return 'Konkuk University'
  if (name.includes('단국')) return 'Dankook University'
  return ''
}

// ===== Helper: Known hospital ENT search URLs =====
// STRATEGY: Provide known working URLs first, then ALWAYS supplement with Google search
// for hospitals with JS-rendered pages or incomplete data
function getHospitalSearchUrls(hospitalName: string): string[] {
  const urls: string[] = []
  const name = hospitalName.replace(/\s/g, '')
  const nameLower = name.toLowerCase()

  // Seoul National University Hospital (서울대학교병원) - NOT 분당
  if ((name.includes('서울대') || nameLower.includes('snuh')) && !name.includes('분당') && !nameLower.includes('snubh')) {
    urls.push('https://www.snuh.org/m/reservation/meddept/OL/mainDoctor.do')
    urls.push('http://search.snuh.org/search/search.jsp?wnquery=%EC%9D%B4%EB%B9%84%EC%9D%B8%ED%9B%84%EA%B3%BC&searchTarget=re_doctor&detailView=none')
  }

  // Samsung Medical Center (삼성서울병원)
  if (name.includes('삼성') && name.includes('병원')) {
    urls.push('http://www.samsunghospital.com/dept/doctor/doctorList.do?DP_CODE=CBT61&MENU_ID=001002')
  }

  // Asan Medical Center (서울아산병원)
  if (name.includes('아산') && name.includes('병원')) {
    urls.push('https://www.amc.seoul.kr/asan/mobile/staff/base/staffBaseInfoMoList.do?searchHpCd=D035')
    urls.push('https://www.amc.seoul.kr/asan/departments/deptDetail.do?hpCd=D367&type=K&moduleMenuId=4777')
  }

  // Severance Hospital (세브란스)
  if (name.includes('세브란스') || (name.includes('연세') && !name.includes('용인'))) {
    urls.push('https://sev.severance.healthcare/sev/news/press/report.do?mode=view&articleNo=126605')
    urls.push('https://sev.severance.healthcare/sev/story/doctor.do?mode=view&articleNo=127173')
    urls.push('https://sev.severance.healthcare/sev/news/press/report.do?mode=view&articleNo=127743')
  }

  // Bundang Seoul National University Hospital (분당서울대병원)
  if (name.includes('분당') && name.includes('서울대')) {
    urls.push('https://www.snubh.org/medical/drMedicalTeam.do?DP_TP=O&DP_CD=OL')
  }

  // Catholic University Seoul St. Mary's Hospital (가톨릭대 서울성모병원)
  // Note: their page requires JS rendering, so we'll rely more on Google fallback
  if (name.includes('가톨릭') || name.includes('성모')) {
    urls.push('https://www.cmcseoul.or.kr/page/department/A/139/2')
  }

  // Korea University Anam Hospital (고려대안암병원)
  if (name.includes('고려대')) {
    urls.push('https://anam.kumc.or.kr/dept/main/index.do?DP_CODE=OL&MENU_ID=004002')
  }

  // Ajou University Hospital (아주대병원)
  if (name.includes('아주')) {
    urls.push('https://hosp.ajoumc.or.kr/doctor/profDeptList.do?deptNo=17')
  }

  // Kyungpook National University Hospital (경북대학교병원)
  if (name.includes('경북대')) {
    urls.push('https://www.knuh.kr/content/01treatment/08_0102.asp?ct_idx=5')
  }

  // Chilgok Kyungpook National University Hospital (칠곡경북대학교병원)
  if (name.includes('칠곡') && name.includes('경북')) {
    urls.push('https://www.knuch.kr/content/02depart/01_0102.asp?ct_idx=3372')
  }

  // Pusan National University Hospital (부산대학교병원)
  // Note: department.do has limited content, Google search is primary
  if (name.includes('부산대')) {
    urls.push('https://www.pnuh.or.kr/pnuh/medical/department.do')
  }

  // Chonnam National University Hospital (전남대학교병원)
  if (name.includes('전남대')) {
    urls.push('http://www.cnuh.com/medical/info/dept.cs?act=view&mode=doctorList&deptCd=EN')
  }

  // Chungnam National University Hospital (충남대학교병원)
  if (name.includes('충남대')) {
    urls.push('https://www.cnuh.co.kr/prog/cnuhTreatment/refer/view.do?gwaCode=ENT&tabGubun=tab2')
  }

  // Sejong Chungnam National University Hospital (세종충남대학교병원)
  if (name.includes('세종') && name.includes('충남')) {
    urls.push('https://www.cnush.co.kr/prog/cnushTreatment/main/view.do?gwaCode=ENT&mno=sub01_0101&tabGubun=tab1')
  }

  // Inha University Hospital (인하대학교병원)
  if (name.includes('인하')) {
    urls.push('https://www.inha.com/page/department/doctor.do?deptCode=ENT')
  }

  // Hanyang University Hospital (한양대학교병원)
  if (name.includes('한양')) {
    urls.push('https://seoul.hyumc.com/department/doctor.do?deptCode=ENT')
  }

  // Chung-Ang University Hospital (중앙대학교병원)
  if (name.includes('중앙대')) {
    urls.push('https://ch.caumc.or.kr/dept/doctor.do?dept_cd=D002')
  }

  // Soon Chun Hyang University Hospital (순천향대학교병원)
  if (name.includes('순천향')) {
    urls.push('https://www.schmc.ac.kr/seoul/drIntroduce.do?DP_CD=OL')
  }

  // Dong-A University Hospital (동아대학교병원)
  if (name.includes('동아대')) {
    urls.push('https://www.damc.or.kr/dept/main/index.do?DP_CODE=ENT')
  }

  // Wonkwang University Hospital (원광대학교병원)
  if (name.includes('원광')) {
    urls.push('https://www.wkuh.org/department/doctor.do?deptCode=ENT')
  }

  // Dankook University Hospital (단국대학교병원)
  if (name.includes('단국')) {
    urls.push('https://www.dkuh.co.kr/main/department/doctor.do?deptCode=ENT')
  }

  // Konkuk University Hospital (건국대학교병원)
  if (name.includes('건국')) {
    urls.push('https://www.kuh.ac.kr/department/doctor.do?deptCode=ENT')
  }

  return urls
}

// ===== Helper: Known professor profile URLs =====
function getProfileSearchUrls(hospitalName: string, doctorName: string): string[] {
  const urls: string[] = []
  const name = hospitalName.toLowerCase()

  // SNUH
  if (name.includes('서울대') && (name.includes('병원') || name.includes('대학교')) && !name.includes('분당')) {
    urls.push(`http://search.snuh.org/search/search.jsp?wnquery=${encodeURIComponent(doctorName)}&searchTarget=re_doctor&detailView=none`)
  }

  // Bundang SNUH
  if (name.includes('분당') && name.includes('서울대')) {
    urls.push(`https://www.snubh.org/medical/drIntroduce.do?sDpCd=OL&sDpCdDtl=OL&sDrSid=&sDrStfNo=&sDpTp=`)
  }

  return urls
}

export default ai
