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
      max_tokens: 12000
    })
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI API error ${res.status}: ${errText}`)
  }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content || ''
}

// ===== Web Search Helper =====
// Uses Google Custom Search-like approach by fetching Google search results
async function webSearch(query: string): Promise<{ title: string; link: string; snippet: string }[]> {
  try {
    // Use Google search via fetch with proper User-Agent
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=ko&num=10`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      }
    })
    const html = await res.text()
    // Extract search result links and snippets from Google HTML
    const results: { title: string; link: string; snippet: string }[] = []
    // Simple regex-based extraction of URLs from Google results
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
// Returns both cleaned text AND raw HTML (for URL extraction)
async function crawlPageRaw(url: string): Promise<{ text: string; html: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    })
    if (!res.ok) return { text: '', html: '' }
    const html = await res.text()
    
    // Clean HTML for text extraction
    let cleaned = html
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '')
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '')
    cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    cleaned = cleaned.replace(/<head[\s\S]*?<\/head>/gi, '')
    cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, '')
    cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, '')
    // Preserve position info from HTML comments like <!--교수--> <!--부교수-->
    cleaned = cleaned.replace(/<!--(교수|부교수|조교수|임상교수|임상부교수|임상조교수|전임의)-->/g, '[$1]')
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')
    
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
      .substring(0, 30000)
    
    return { text, html }
  } catch (e) {
    return { text: '', html: '' }
  }
}

async function crawlPage(url: string): Promise<string> {
  const { text } = await crawlPageRaw(url)
  return text
}

// ===== Deep-enrich helper: fetch additional info for each doctor from hospital pages =====
// Crawls individual profile/career pages to find CI-related experience
async function deepEnrichDoctor(doctorName: string, hospitalName: string, rawHtml: string, bundangCache?: { text: string; html: string }): Promise<string> {
  let extra = ''
  try {
    const name = hospitalName.toLowerCase()
    
    // Helper: extract career-relevant content (skip navigation/menu items)
    function extractCareerContent(text: string): string {
      const lines = text.split('\n')
      let inContent = false
      const contentLines: string[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.length < 3) continue
        // Skip navigation-like items
        if (trimmed.length < 15 && (trimmed.includes('진료과') || trimmed.includes('주요센터') || 
            trimmed.includes('주요부서') || trimmed.includes('패밀리사이트') || 
            trimmed.includes('채용사이트') || trimmed.includes('QRCODE') || trimmed.includes('MOBILE'))) continue
        if (trimmed.includes('학력') || trimmed.includes('경력') || trimmed.includes('활동')) {
          inContent = true
        }
        if (inContent) {
          contentLines.push(trimmed)
        }
      }
      return contentLines.join('\n')
    }
    
    // For SNUH (본원): check both SNUH career page AND Bundang SNUH page
    if ((name.includes('서울대') && !name.includes('분당')) && rawHtml) {
      const nameIdx = rawHtml.indexOf(doctorName)
      if (nameIdx > 0) {
        // Search in a wider range to find blog ID (both search.snuh.org and mainDoctor.do formats)
        const surrounding = rawHtml.substring(Math.max(0, nameIdx - 2000), nameIdx + 500)
        // Match blog/XXXXX from both formats: snuh.org/blog/XXXXX and /m/blog/XXXXX/philosophy.do
        const blogIdMatch = surrounding.match(/(?:snuh\.org)?\/(?:m\/)?blog\/(\d+)/)
        if (blogIdMatch) {
          const blogId = blogIdMatch[1]
          const careerUrl = `https://www.snuh.org/blog/${blogId}/career.do`
          const careerContent = await crawlPage(careerUrl)
          if (careerContent && careerContent.length > 200) {
            const careerText = extractCareerContent(careerContent)
            
            // Check for CI keywords in CAREER CONTENT ONLY (not navigation)
            const ciKeywords = ['인공와우이식', '인공와우 이식', '와우이식', '인공와우센터 연수', 'cochlear implant', 'Cochlear Implant Center']
            const hasCIExperience = ciKeywords.some(kw => careerText.toLowerCase().includes(kw.toLowerCase()))
            
            extra += `\n[${doctorName} 경력 상세 - ${careerUrl}]\n`
            if (hasCIExperience) {
              extra += `*** 인공와우 관련 경력이 확인됨! ***\n`
            }
            
            const relevantLines = careerText.split('\n').filter(l => {
              const ll = l.toLowerCase()
              return ll.includes('인공와우') || ll.includes('와우') || ll.includes('cochlear') ||
                     ll.includes('난청') || ll.includes('이과') || ll.includes('청각') ||
                     ll.includes('학력') || ll.includes('교수') || ll.includes('과장') ||
                     ll.includes('센터장') || ll.includes('학회') || ll.includes('분당') ||
                     ll.includes('멜번') || ll.includes('melbourne') || ll.includes('서울대')
            })
            extra += relevantLines.slice(0, 15).join('\n') + '\n'
          }
        }
      }
      
      // CRITICAL: Also check if this doctor is on Bundang SNUH with different/better specialty info
      if (bundangCache) {
        const { text: bText } = bundangCache
        if (bText && bText.includes(doctorName)) {
          const bIdx = bText.indexOf(doctorName)
          const bContext = bText.substring(bIdx, Math.min(bText.length, bIdx + 500))
          // Check if Bundang page shows CI-related specialty
          const hasBundangCI = ['와우이식', '인공와우', 'cochlear'].some(kw => bContext.includes(kw))
          extra += `\n[${doctorName} - 분당서울대병원 의료진 페이지에서도 발견!]\n`
          if (hasBundangCI) {
            extra += `*** 분당서울대병원에서 와우이식/인공와우 전문으로 등록되어 있음! 이 교수는 분당서울대병원 소속일 가능성이 높음 ***\n`
          }
          extra += bContext.substring(0, 400) + '\n'
        }
      }
    }
    
    // For Bundang SNUH
    if (name.includes('분당') && name.includes('서울대')) {
      if (bundangCache) {
        const { text } = bundangCache
        if (text && text.includes(doctorName)) {
          const nameIdx = text.indexOf(doctorName)
          const context = text.substring(nameIdx, Math.min(text.length, nameIdx + 500))
          extra += `\n[${doctorName} 분당서울대병원 정보]\n${context}\n`
        }
      }
    }
  } catch (e) { /* ignore */ }
  return extra
}

// ===== 1. Fetch CI-related ENT professors for a hospital =====
// Uses web search + crawling + deep enrichment for accurate, real-time data
ai.post('/hospital-doctors', async (c) => {
  const { hospitalName, region } = await c.req.json()
  if (!hospitalName) return c.json({ error: 'hospitalName is required' }, 400)

  const searchQuery = `${hospitalName} 이비인후과 의료진 교수 인공와우 난청`
  let crawledContent = ''
  let sourceUrl = ''
  let rawSearchHtml = '' // Preserve raw HTML for blog URL extraction
  let searchResults: { title: string; link: string; snippet: string }[] = []

  // Step 1: Try to find and crawl the hospital's ENT faculty page
  // Try ALL known URLs and combine content for maximum coverage
  try {
    const hospitalSearchUrls = getHospitalSearchUrls(hospitalName)
    const crawledParts: string[] = []
    
    for (const tryUrl of hospitalSearchUrls) {
      try {
        const { text, html } = await crawlPageRaw(tryUrl)
        if (text && text.length > 300 && (text.includes('이비인후과') || text.includes('교수') || text.includes('인공와우'))) {
          crawledParts.push(`[출처: ${tryUrl}]\n${text}`)
          if (!sourceUrl) sourceUrl = tryUrl
          if (!rawSearchHtml && html) rawSearchHtml = html
        }
      } catch (e) { /* skip failed URL */ }
    }
    
    if (crawledParts.length > 0) {
      crawledContent = crawledParts.join('\n\n===== 추가 페이지 =====\n\n')
    }

    // If no known URL worked, try Google search
    if (!crawledContent) {
      searchResults = await webSearch(searchQuery)
      
      // Collect Google search snippets as data source
      const snippetData = searchResults
        .filter(r => r.snippet && (r.snippet.includes('교수') || r.snippet.includes('인공와우') || r.snippet.includes('이비인후과') || r.snippet.includes('난청')))
        .map(r => `${r.title}: ${r.snippet} (${r.link})`)
        .join('\n')
      if (snippetData) {
        crawledContent = `[Google 검색 결과 snippet]\n${snippetData}\n\n`
      }
      
      for (const result of searchResults.slice(0, 5)) {
        if (result.link.includes('doctor') || result.link.includes('medic') || 
            result.link.includes('search') || result.link.includes('staff') ||
            result.link.includes('professor') || result.link.includes('blog') ||
            result.link.includes('dept') || result.link.includes('department') ||
            result.link.includes('인공와우')) {
          try {
            const content = await crawlPage(result.link)
            if (content && content.length > 300 && (content.includes('이비인후과') || content.includes('교수') || content.includes('인공와우'))) {
              crawledContent += `\n[크롤링: ${result.link}]\n${content}\n`
              if (!sourceUrl) sourceUrl = result.link
              break
            }
          } catch (e) { /* skip */ }
        }
      }
    }
  } catch (e) {
    // Continue even if search/crawl fails
  }

  // Step 2: Build AI prompt with crawled data
  let contextInfo = ''
  if (crawledContent) {
    contextInfo = `다음은 ${hospitalName} 홈페이지에서 가져온 실제 의료진 정보입니다 (출처: ${sourceUrl}):\n\n${crawledContent.substring(0, 25000)}\n\n`
  } else if (searchResults.length > 0) {
    contextInfo = `웹 검색 결과 (검색어: "${searchQuery}"):\n` +
      searchResults.map((r, i) => `${i + 1}. ${r.title} - ${r.link}\n   ${r.snippet}`).join('\n') + '\n\n'
  }

  // Step 2.5: Determine data availability and build appropriate prompts
  const hasCrawledData = !!(crawledContent && crawledContent.length > 100)
  const hasSearchData = searchResults.length > 0
  const hasAnyExternalData = hasCrawledData || hasSearchData

  // If NO external data at all, use AI knowledge as fallback
  if (!hasAnyExternalData) {
    // Fallback: Ask AI based on its training data (with clear disclaimer)
    const fallbackPrompt = `${region ? region + ' ' : ''}${hospitalName} 이비인후과에서 인공와우(CI) 수술, 난청 치료, 이과학을 전문으로 하는 현재 재직 중인 교수를 알려주세요.

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
      const systemPrompt = '한국 의료계에 대해 잘 아는 전문가입니다. 확실하게 알고 있는 정보만 제공하며, 불확실한 정보는 제외합니다.'
      const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, fallbackPrompt, systemPrompt)
      const jsonMatch = raw.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const doctors = JSON.parse(jsonMatch[0])
        const cleaned = doctors.map((d: any) => ({
          name: (d.name || '').trim(),
          department: d.department || '이비인후과',
          position: (d.position || '교수').trim(),
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

  // Step 3: First pass - get candidate doctors from AI (from crawled/searched data)
  const firstPassPrompt = `${contextInfo}위 데이터에서 ${region ? region + ' ' : ''}${hospitalName} 이비인후과 교수 중 인공와우(CI), 이과(otology), 난청(hearing loss), 청각재활, 와우이식, 보청기, 중이염과 관련된 교수의 이름만 추출하세요.

규칙:
1. 위 크롤링/검색 데이터에 실제로 나온 교수만 포함
2. 데이터에 없는 교수를 추측하지 마세요
3. 세부전공에 "인공와우", "와우이식", "난청", "이과", "이과학", "청각", "중이염", "보청기" 등의 키워드가 있는 교수만
4. 두경부외과, 비과(코), 음성질환 전문 교수는 제외

JSON 배열로 이름만 반환: ["이름1", "이름2"]`

  try {
    const systemPrompt = '당신은 한국 병원 의료진 데이터를 정확히 추출하는 전문가입니다. 주어진 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다.'
    const firstPassRaw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, firstPassPrompt, systemPrompt)
    const namesMatch = firstPassRaw.match(/\[[\s\S]*\]/)
    if (!namesMatch) return c.json({ data: [], message: '해당 병원의 인공와우 관련 교수 정보를 찾을 수 없습니다.', source: sourceUrl })

    const candidateNames: string[] = JSON.parse(namesMatch[0])
    if (candidateNames.length === 0) return c.json({ data: [], source: sourceUrl || '웹 검색', crawled: !!crawledContent })

    // Step 3: Deep-enrich each candidate by crawling their individual profile pages
    let enrichedContext = contextInfo
    // Pre-fetch Bundang SNUH ENT page for cross-referencing (서울대 본원 검색 시)
    let bundangCache: { text: string; html: string } | undefined
    const hn = hospitalName.toLowerCase()
    if (hn.includes('서울대') && !hn.includes('분당')) {
      try {
        bundangCache = await crawlPageRaw('https://www.snubh.org/medical/drMedicalTeam.do?DP_TP=O&DP_CD=OL')
      } catch (e) { /* ignore */ }
    }
    // Deep-enrich up to 8 candidates
    if (candidateNames.length <= 8) {
      const enrichPromises = candidateNames.map(name => deepEnrichDoctor(name, hospitalName, rawSearchHtml, bundangCache))
      const enrichResults = await Promise.all(enrichPromises)
      const enrichText = enrichResults.filter(r => r.length > 0).join('\n')
      if (enrichText) {
        enrichedContext += '\n\n===== 각 교수별 개별 프로필 페이지 크롤링 결과 =====\n' + enrichText
      }
    }

    // Step 4: Final extraction with enriched data
    const finalPrompt = `${enrichedContext}\n\n위의 모든 데이터를 종합하여 ${region ? region + ' ' : ''}${hospitalName} 이비인후과 교수 중 인공와우(CI)/난청/이과 관련 교수를 정리하세요.

중요 규칙:
1. 병원 홈페이지 데이터 + 뉴스/검색 결과를 종합적으로 판단하세요
2. 세부전공에 "인공와우", "와우이식"이 명시된 교수 = high
3. 세부전공에 "난청", "이과학"만 있지만 뉴스/검색에서 인공와우 관련 활동이 확인된 교수 = high
4. 세부전공에 "난청", "이과학", "중이염"이 있지만 인공와우 활동이 확인 안 된 교수 = medium
5. 사망/퇴직한 교수는 제외
6. 두경부외과, 비과(코), 음성질환, 갑상선, 로봇수술 전문 교수는 제외 (단, 인공와우 관련 활동이 확인되면 포함)
7. 소아이비인후과에서 인공와우/난청 관련 교수는 포함
8. 소속 병원을 정확히 구분하세요 (예: "서울대병원"과 "분당서울대병원"은 다른 병원)
   - 분당서울대병원(snubh.org) 소속 교수는 서울대병원(snuh.org) 검색 결과에 나오더라도 정확한 소속을 표기
9. specialty에는 병원 홈페이지 세부전공 + 뉴스에서 확인된 추가 전문분야를 모두 기재
10. position은 반드시 기재하세요 - "교수", "부교수", "조교수", "임상교수", "과장·주임교수" 등
    - 크롤링 데이터에서 찾을 수 없으면 뉴스/검색 결과에서 확인
    - 그래도 모르면 "교수"로 기재 (이비인후과 소속이면 최소 교수급)

각 교수에 대해:
- name: 정확한 이름
- department: "이비인후과" 또는 "소아이비인후과"
- position: "교수", "부교수", "조교수" 등 (반드시 기재)
- specialty: 병원 홈페이지 세부전공 + 뉴스에서 확인된 전문분야 포함
- influence_level: "high", "medium", "low" (위 기준 적용)
- notes: 관련 뉴스/활동 요약 (예: "인공와우 수술 2000례 달성(2025)", 없으면 빈 문자열)
- source: 출처 URL

JSON 배열만 반환:
[{"name":"","department":"","position":"","specialty":"","influence_level":"","notes":"","source":""}]`

    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, finalPrompt, systemPrompt)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return c.json({ data: [], message: '해당 병원의 인공와우 관련 교수 정보를 찾을 수 없습니다.', source: sourceUrl })

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
    return c.json({ error: 'AI 조회 실패: ' + (e.message || ''), data: [] }, 500)
  }
})

// ===== 2. Fetch doctor profile (bio, education, career) =====
// NEW: Uses web search + crawling for accurate data
ai.post('/doctor-profile', async (c) => {
  const { doctorName, hospitalName, department } = await c.req.json()
  if (!doctorName || !hospitalName) return c.json({ error: 'doctorName and hospitalName required' }, 400)

  const dept = department || '이비인후과'
  let crawledContent = ''
  let sourceUrl = ''

  // Step 1: Try to find the professor's profile page
  try {
    // Try known hospital blog/profile URL patterns
    const profileUrls = getProfileSearchUrls(hospitalName, doctorName)
    
    for (const tryUrl of profileUrls) {
      const { text, html: rawHtml } = await crawlPageRaw(tryUrl)
      if (text && text.length > 200 && (text.includes(doctorName) || text.includes('경력') || text.includes('학력'))) {
        crawledContent = text
        sourceUrl = tryUrl
        
        // For SNUH: extract blog URL from RAW HTML (not stripped text) and crawl career page
        if (tryUrl.includes('search.snuh.org') && rawHtml) {
          const blogMatch = rawHtml.match(/snuh\.org\/blog\/(\d+)/)
          if (blogMatch) {
            const careerUrl = `https://www.snuh.org/blog/${blogMatch[1]}/career.do`
            const careerContent = await crawlPage(careerUrl)
            if (careerContent && careerContent.length > 300 && (careerContent.includes('학력') || careerContent.includes('경력'))) {
              // Use career page as PRIMARY content (more detailed than search page)
              crawledContent = careerContent
              sourceUrl = careerUrl
            }
          }
        }
        break
      }
    }

    // If no known URL, try Google search
    if (!crawledContent) {
      const searchResults = await webSearch(`${hospitalName} ${doctorName} 교수 이비인후과 경력 학력`)
      for (const result of searchResults.slice(0, 5)) {
        const content = await crawlPage(result.link)
        if (content && content.length > 200 && (content.includes(doctorName) || content.includes('경력'))) {
          crawledContent = content
          sourceUrl = result.link
          
          // If this is a SNUH blog page, also try the career sub-page
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
  } catch (e) {
    // Continue
  }

  let contextInfo = ''
  if (crawledContent) {
    contextInfo = `다음은 ${hospitalName} ${doctorName} 교수의 프로필 페이지에서 가져온 실제 정보입니다 (출처: ${sourceUrl}):\n\n${crawledContent.substring(0, 25000)}\n\n`
  }

  const prompt = `${contextInfo}위 데이터에서 ${hospitalName} ${dept} ${doctorName} 교수의 프로필 정보를 추출하세요.

중요 규칙:
1. 위 크롤링 데이터에 실제로 있는 정보만 추출하세요
2. 데이터에 없는 정보는 빈 문자열 ""로 남기세요 - 추측하지 마세요
3. 확인할 수 없는 정보에는 "[업데이트 필요]"를 붙이지 마세요, 그냥 빈 문자열로 두세요
4. 인공와우/이과/난청 관련 경력을 우선적으로 추출하세요

JSON 형식으로만 반환:
{"bio":"한줄 소개(한국어)","education":"학력(줄바꿈으로 구분)","career":"주요 경력(줄바꿈으로 구분)","specialty":"세부 전공","position":"현재 직위","source":"${sourceUrl || ''}"}`

  try {
    const systemPrompt = '한국 병원 의료진 프로필 데이터를 정확히 추출하는 전문가입니다. 크롤링된 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다.'
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

// ===== Helper: Known hospital ENT search URLs =====
// Returns multiple URLs to try (in priority order) for finding ENT professors
function getHospitalSearchUrls(hospitalName: string): string[] {
  const urls: string[] = []
  const name = hospitalName.replace(/\s/g, '')
  const nameLower = name.toLowerCase()

  // Seoul National University Hospital (서울대학교병원 / 서울대병원) - NOT 분당
  if ((name.includes('서울대') || nameLower.includes('snuh')) && !name.includes('분당') && !nameLower.includes('snubh')) {
    // PRIORITY 1: Official ENT doctor list page (has ALL professors with specialties)
    urls.push('https://www.snuh.org/m/reservation/meddept/OL/mainDoctor.do')
    // PRIORITY 2: Integrated search page (backup - may only show a subset)
    urls.push('http://search.snuh.org/search/search.jsp?wnquery=%EC%9D%B4%EB%B9%84%EC%9D%B8%ED%9B%84%EA%B3%BC&searchTarget=re_doctor&detailView=none')
  }

  // Samsung Medical Center (삼성서울병원)
  if (name.includes('삼성') && name.includes('병원')) {
    // CI center page has doctor list with specialties
    urls.push('http://www.samsunghospital.com/dept/main/index.do?DP_CODE=CBT61&MENU_ID=001002')
  }

  // Asan Medical Center (서울아산병원 / 아산병원)
  if (name.includes('아산') && name.includes('병원')) {
    // Mobile staff list page - has ALL ENT doctors with specialties
    urls.push('https://www.amc.seoul.kr/asan/mobile/staff/base/staffBaseInfoMoList.do?searchHpCd=D035')
    // CI clinic page - has CI-specific doctors and news
    urls.push('https://www.amc.seoul.kr/asan/departments/deptDetail.do?hpCd=D367&type=K&moduleMenuId=4777')
  }

  // Severance Hospital (세브란스 / 연세대) - JS-rendered main page, use news pages instead
  if (name.includes('세브란스') || (name.includes('연세') && !name.includes('용인'))) {
    // CI surgery 3000 cases article - lists CI professors (최재영, 정진세 등)
    urls.push('https://sev.severance.healthcare/sev/news/press/report.do?mode=view&articleNo=126605')
    // 정진세 professor article - CI specialist
    urls.push('https://sev.severance.healthcare/sev/story/doctor.do?mode=view&articleNo=127173')
    // 난청 치료제 연구 - 최재영, 정진세 교수팀
    urls.push('https://sev.severance.healthcare/sev/news/press/report.do?mode=view&articleNo=127743')
  }

  // Bundang Seoul National University Hospital (분당서울대병원)
  if (name.includes('분당') && name.includes('서울대')) {
    urls.push('https://www.snubh.org/medical/doctorsList.do?DP_CD=OL')
  }

  // Catholic University (가톨릭대 / 서울성모)
  if (name.includes('가톨릭') || name.includes('성모')) {
    urls.push('https://www.cmcseoul.or.kr/page/department/doctor?deptCode=OL&searchType=')
  }

  // Korea University Anam Hospital (고려대안암병원)
  if (name.includes('고려대')) {
    urls.push('https://anam.kumc.or.kr/dept/main/index.do?DP_CODE=OL&MENU_ID=004002')
  }

  // Ajou University Hospital (아주대병원)
  if (name.includes('아주') && name.includes('병원')) {
    urls.push('https://hosp.ajoumc.or.kr/re/department/doctor.do?pageCode=370')
  }

  // Kyungpook National University Hospital (경북대)
  if (name.includes('경북대')) {
    urls.push('https://knuh.knu.ac.kr/contents/hospital/media_doctor.html?d_code=ENT')
  }

  // Pusan National University Hospital (부산대)
  if (name.includes('부산대')) {
    urls.push('https://www.pnuh.or.kr/pnuh/doctor/search.do?deptCode=ENT')
  }

  // Chonnam National University Hospital (전남대)
  if (name.includes('전남대')) {
    urls.push('https://www.cnuh.co.kr/cnuh/medical/department.cs?act=medicalstaffList&deptNm=ENT')
  }

  // Chungnam National University Hospital (충남대)
  if (name.includes('충남대')) {
    urls.push('https://www.cnuh.co.kr/page/department/doctor?deptCd=ENT')
  }

  // Chungbuk National University Hospital (충북대)
  if (name.includes('충북대')) {
    urls.push('https://www.cbnuh.or.kr/department/doctor.do?deptCode=ENT')
  }

  // Inha University Hospital (인하대)
  if (name.includes('인하대') || name.includes('인하')) {
    urls.push('https://www.inha.com/page/department/doctor.do?deptCode=ENT')
  }

  return urls
}

// ===== Helper: Known professor profile URLs =====
function getProfileSearchUrls(hospitalName: string, doctorName: string): string[] {
  const urls: string[] = []
  const name = hospitalName.toLowerCase()

  // SNUH - professors have blog pages
  if (name.includes('서울대') && (name.includes('병원') || name.includes('대학교')) && !name.includes('분당')) {
    urls.push(`http://search.snuh.org/search/search.jsp?wnquery=${encodeURIComponent(doctorName)}&searchTarget=re_doctor&detailView=none`)
  }

  // Bundang SNUH - different website
  if (name.includes('분당') && name.includes('서울대')) {
    urls.push(`https://www.snubh.org/medical/drIntroduce.do?sDpCd=OL&sDpCdDtl=OL&sDrSid=&sDrStfNo=&sDpTp=`)
    // Also try web search for the specific doctor at Bundang
  }

  return urls
}

export default ai
