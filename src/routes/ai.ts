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

// ===== 1. Fetch CI-related ENT professors for a hospital =====
// NEW: Uses web search + crawling for accurate, real-time data
ai.post('/hospital-doctors', async (c) => {
  const { hospitalName, region } = await c.req.json()
  if (!hospitalName) return c.json({ error: 'hospitalName is required' }, 400)

  const searchQuery = `${hospitalName} 이비인후과 의료진 교수 인공와우 난청`
  let crawledContent = ''
  let sourceUrl = ''
  let searchResults: { title: string; link: string; snippet: string }[] = []

  // Step 1: Try to find and crawl the hospital's ENT faculty page
  try {
    // Try common hospital search page URL patterns for major hospitals
    const hospitalSearchUrls = getHospitalSearchUrls(hospitalName)
    
    for (const tryUrl of hospitalSearchUrls) {
      const content = await crawlPage(tryUrl)
      if (content && content.length > 500 && (content.includes('이비인후과') || content.includes('교수'))) {
        crawledContent = content
        sourceUrl = tryUrl
        break
      }
    }

    // If no known URL worked, try Google search
    if (!crawledContent) {
      searchResults = await webSearch(searchQuery)
      // Try to crawl the first few results
      for (const result of searchResults.slice(0, 5)) {
        if (result.link.includes('doctor') || result.link.includes('medic') || 
            result.link.includes('search') || result.link.includes('staff') ||
            result.link.includes('professor') || result.link.includes('blog')) {
          const content = await crawlPage(result.link)
          if (content && content.length > 300 && (content.includes('이비인후과') || content.includes('교수'))) {
            crawledContent = content
            sourceUrl = result.link
            break
          }
        }
      }
    }
  } catch (e) {
    // Continue even if search/crawl fails
  }

  // Step 2: Build AI prompt with crawled data OR search results as context
  let contextInfo = ''
  if (crawledContent) {
    contextInfo = `다음은 ${hospitalName} 홈페이지에서 가져온 실제 의료진 정보입니다 (출처: ${sourceUrl}):\n\n${crawledContent.substring(0, 25000)}\n\n`
  } else if (searchResults.length > 0) {
    contextInfo = `웹 검색 결과 (검색어: "${searchQuery}"):\n` +
      searchResults.map((r, i) => `${i + 1}. ${r.title} - ${r.link}\n   ${r.snippet}`).join('\n') + '\n\n'
  }

  const prompt = `${contextInfo}위 데이터에서 ${region ? region + ' ' : ''}${hospitalName} 이비인후과 교수 중 인공와우(CI), 이과(otology), 난청(hearing loss), 청각재활과 관련된 교수만 추출하세요.

중요 규칙:
1. 위 크롤링/검색 데이터에 실제로 나온 교수만 포함하세요
2. 데이터에 없는 교수를 추측해서 만들지 마세요
3. 사망하거나 퇴직한 교수는 제외하세요 (현재 재직 중인 교수만)
4. 세부전공에 "인공와우", "난청", "이과", "청각", "중이염", "보청기" 등의 키워드가 있는 교수만 포함
5. 두경부외과, 비과(코), 음성질환 전문 교수는 제외
6. 소아이비인후과에서 인공와우/난청 관련 교수는 포함

각 교수에 대해:
- name: 정확한 이름
- department: "이비인후과" 또는 "소아이비인후과"
- position: "교수", "부교수", "조교수", "임상교수" 등 (모르면 빈 문자열)
- specialty: 세부전공을 그대로 기재 (크롤링 데이터에서 추출)
- influence_level: "high" (인공와우 전문의 or 주요 교수), "medium" (관련 분야), "low" (보조적)
- source: "${sourceUrl || '웹 검색'}"

데이터에서 인공와우/이과/난청 관련 교수를 찾을 수 없으면 빈 배열 []을 반환하세요.

JSON 배열만 반환하세요:
[{"name":"","department":"","position":"","specialty":"","influence_level":"","source":""}]`

  try {
    const systemPrompt = '당신은 한국 병원 의료진 데이터를 정확히 추출하는 전문가입니다. 주어진 웹페이지 데이터에서만 정보를 추출하고, 데이터에 없는 정보는 절대 생성하지 않습니다. 사망하거나 퇴직한 의료진은 반드시 제외합니다.'
    const raw = await askAI(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, prompt, systemPrompt)
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return c.json({ data: [], message: '해당 병원의 인공와우 관련 교수 정보를 찾을 수 없습니다.', source: sourceUrl })

    const doctors = JSON.parse(jsonMatch[0])
    const cleaned = doctors.map((d: any) => ({
      name: (d.name || '').trim(),
      department: d.department || '이비인후과',
      position: (d.position || '').trim(),
      specialty: (d.specialty || '').trim(),
      influence_level: ['high', 'medium', 'low'].includes(d.influence_level) ? d.influence_level : 'medium',
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
function getHospitalSearchUrls(hospitalName: string): string[] {
  const urls: string[] = []
  const name = hospitalName.toLowerCase()

  // Seoul National University Hospital (서울대학교병원 / 서울대병원)
  if (name.includes('서울대') && (name.includes('병원') || name.includes('대학교'))) {
    urls.push('http://search.snuh.org/search/search.jsp?wnquery=%EC%9D%B4%EB%B9%84%EC%9D%B8%ED%9B%84%EA%B3%BC&searchTarget=re_doctor&detailView=none')
  }

  // Samsung Medical Center (삼성서울병원)
  if (name.includes('삼성') && name.includes('병원')) {
    urls.push('https://www.samsunghospital.com/home/reservation/doctor/doctorList.do?deptCode=ENT')
    urls.push('https://www.samsunghospital.com/home/reservation/doctor/doctorList.do?cPage=1&DP_CODE=ENT')
  }

  // Severance Hospital (세브란스 / 연세대)
  if (name.includes('세브란스') || (name.includes('연세') && name.includes('대'))) {
    urls.push('https://sev.severance.healthcare/sev/doctor/department-doctor.do?deptCd=ENT')
  }

  // Asan Medical Center (서울아산병원)
  if (name.includes('아산') && name.includes('병원')) {
    urls.push('https://www.amc.seoul.kr/asan/depts/deptIntro/deptIntro.do?deptCode=ENT')
    urls.push('https://www.amc.seoul.kr/asan/healthinfo/department/departmentDetail.do?deptId=ENT')
  }

  // Catholic University (가톨릭대 / 서울성모)
  if (name.includes('가톨릭') || name.includes('성모') || name.includes('서울성모')) {
    urls.push('https://www.cmcseoul.or.kr/page/department/doctor?deptCode=OL&searchType=')
  }

  // Korea University (고려대)
  if (name.includes('고려대')) {
    urls.push('https://anam.kumc.or.kr/dept/main/index.do?DP_CODE=OL&MENU_ID=004002')
  }

  // Ajou University (아주대)
  if (name.includes('아주대') || name.includes('아주')) {
    urls.push('https://hosp.ajoumc.or.kr/re/department/doctor.do?pageCode=370')
  }

  // National Cancer Center and others
  // Bundang Seoul National University Hospital
  if (name.includes('분당') && name.includes('서울대')) {
    urls.push('https://www.snubh.org/medical/doctorsList.do?DP_CD=OL')
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

  return urls
}

// ===== Helper: Known professor profile URLs =====
function getProfileSearchUrls(hospitalName: string, doctorName: string): string[] {
  const urls: string[] = []
  const name = hospitalName.toLowerCase()

  // SNUH - professors have blog pages
  if (name.includes('서울대') && (name.includes('병원') || name.includes('대학교'))) {
    // SNUH uses blog format, but we need the specific blog ID
    // We'll search for it instead
    urls.push(`http://search.snuh.org/search/search.jsp?wnquery=${encodeURIComponent(doctorName)}&searchTarget=re_doctor&detailView=none`)
  }

  return urls
}

export default ai
