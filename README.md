# TODOC CRM - 병원 영업 관리 시스템

## Project Overview
- **Name**: TODOC CRM
- **Company**: 토닥(TODOC) - 인공와우 전문기업
- **Goal**: 병원 영업팀이 영업 대상 병원, 교수, 미팅 기록을 체계적으로 관리하는 CRM 시스템
- **Tech Stack**: Hono + TypeScript + Cloudflare Pages + D1 Database + TailwindCSS(빌드타임) + Chart.js

## URLs
- **Production**: https://todoc-crm.pages.dev
- **D1 Database**: todoc-crm-production (f3fa9f6e-dab3-4fa0-b442-39f74c0c184a)

## 주요 기능

### 완성된 기능

#### 대시보드
- 병원/의원/교수/미팅 통계, 이번 달 미팅 수, 지역별 분포 차트
- **KPI 목표 설정 & 달성률 게이지** (월별 미팅 목표)
- **기간 선택 필터** (이번 달 / 이번 분기 / 올해)
- **파이프라인 보드 뷰** (접촉→미팅→데모→제안→계약→거래처)
- **리마인더 알림 배지** (하단 네비게이션 대시보드 아이콘)
- 월별 미팅 추이 차트 (Stacked Bar), 전월 대비 성장률
- 빠른 미팅 추가 버튼

#### 미팅 기록
- 전체 미팅 타임라인, 유형별 분류
- **미팅 캘린더 뷰** (월별/일별 미팅 시각화)
- **미팅 템플릿** (신규방문/데모/학회/팔로업/계약 등 5종 기본 제공)
- **미팅 통계 카드** (유형별 분포, 월별 히트맵, 평균 주기)
- 복수 교수 참석 지원 (다대다), 글로벌 미팅 추가

#### 기관 관리 (병원/의원)
- **파이프라인 단계 관리** (접촉→미팅→데모→제안→계약→거래처)
- **태그 시스템** (CI 관심, 보청기 전환 대상, 핵심 거래처 등 9종)
- **즐겨찾기** (별 표시, 즐겨찾기 필터)
- **중복 기관 체크** (퍼지 매칭)
- **Excel/CSV 내보내기** (XML Spreadsheet 형식 XLSX)
- S/A/B/C 등급, 우선순위, 토닥접점, 난청환자수, 보청기판매, CI의뢰

#### 의료진 관리
- **외래 시간 저장** (요일별 시간 + 비고, 방문 일정 참고용)
- **기관 간 이적** (이적 기록 자동 보관)
- **태그 관리** (기관과 동일한 태그 시스템)
- **미팅 통계** (미팅 빈도, 유형별 분포, 평균 주기)
- AI 프로필 자동 조회, PubMed 논문 검색
- 사진 업로드, 영향력 분류

#### AI 기능
- **AI 의료진 자동 조회** (병원 웹사이트 크롤링 + Google 검색 + AI 분석)
- **AI 프로필 자동 조회** (학력/경력/소개 자동 수집)
- **PubMed 논문 검색** (한글 이름 로마자 변환 + 다중 검색 전략)
- **병원 자동완성** (로컬 DB + AI 보충)
- GPT-5 reasoning model 호환 (max_tokens 16000, 에러 복구 강화)

#### 검색 & 필터
- **최근 검색 기록** (최근 5개 저장 및 표시)
- **즐겨찾기 필터** (기관/의료진 목록에서 즐겨찾기만 표시)
- 글로벌 검색 (기관, 의료진, 미팅, 논문)
- CSS 클래스 기반 반응형 필터

#### 모바일 UX (PWA)
- **Pull-to-Refresh** (터치 당기기로 새로고침)
- **오프라인 모드** (Service Worker API 응답 캐싱)
- **리마인더 알림 배지** (하단 네비게이션)
- 반응형 필터 레이아웃, 터치 최적화

#### 인공와우 통계
- S5800 인공와우이식술 5개년+ 통계 시각화
- 건강보험심사평가원 보건의료빅데이터 기반
- 연도별/성별/연령대별/지역별/기관종별 분석

#### 제품 관리 (데모기 입출고)
- **카테고리별 관리**: 내부기 / 외부기 (Sullivan, Sound1) / 휴대보관함 (Sullivan/Sound1 충전 케이스)
- **개별 S/N 단위 추적**: 유닛별 시리얼/자산코드 관리
- **공유 보유자**: 한 유닛을 여러 영업담당자가 동시 보유 가능 (M:N)
- **입출고 이력 타임라인**: 입고/반출/회수/납품/이전/보유자 추가·해제/분실/수리/폐기
- **영구 납품 vs 대여**: is_loan 플래그로 구분, 반환 예정일 추적
- **회수 지연 알림**: 반환 예정일 경과 유닛 자동 강조
- **미팅 자동 연계**: 미팅 폼에서 동반 반출 제품 선택 → meeting_products 자동 매핑
- **카테고리별 비고**: 카탈로그 모달에서 카테고리/모델별 메모 관리
- **이력 CSV 내보내기**: 기간/유형/병원 필터로 movements 엑셀 호환 CSV 다운로드

### 데이터 모델
| 테이블 | 주요 필드 |
|--------|----------|
| hospitals | name, region, grade, type, priority, todoc_contact, patient_count, hearing_aid_sales, ci_referrals, pipeline_stage |
| doctors | name, department, position, specialty, influence_level, photo, bio, education, career, **clinic_hours** |
| meetings | meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date |
| meeting_doctors | meeting_id, doctor_id (다대다 조인) |
| tags | name, color (태그 정의) |
| entity_tags | entity_type, entity_id, tag_id (기관/의료진 태그 연결) |
| favorites | entity_type, entity_id, user_id (즐겨찾기) |
| meeting_templates | name, meeting_type, purpose, content (미팅 템플릿) |
| kpi_targets | year, month, target_meetings (KPI 목표) |
| doctor_transfers | doctor_id, from_hospital_id, to_hospital_id (이적 기록) |
| doctor_relationships | doctor_id_1, doctor_id_2, relationship_type (의료진 관계) |
| activity_log | action, entity_type, entity_id, details |
| doctor_papers | doctor_id, title, journal, year, doi, url |

### clinic_hours 형식
```json
{
  "mon": "09:00-12:00",
  "tue": "",
  "wed": "14:00-17:00",
  "thu": "09:00-12:00",
  "fri": "14:00-17:00",
  "sat": "",
  "notes": "격주 토요일 오전, 점심시간 12-13시 제외"
}
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | 대시보드 통계 (?period=month/quarter/year) |
| CRUD | `/api/hospitals/:id` | 기관 관리 |
| CRUD | `/api/doctors/:id` | 의료진 관리 |
| PATCH | `/api/doctors/:id/profile` | 의료진 프로필 부분 업데이트 (clinic_hours 포함) |
| CRUD | `/api/meetings/:id` | 미팅 관리 |
| GET | `/api/search?q=` | 글로벌 검색 |
| CRUD | `/api/tags` | 태그 관리 |
| GET/POST | `/api/tags/:entityType/:entityId` | 엔티티 태그 관리 |
| GET/POST | `/api/favorites` | 즐겨찾기 관리 |
| POST | `/api/favorites/toggle` | 즐겨찾기 토글 |
| CRUD | `/api/templates` | 미팅 템플릿 관리 |
| GET | `/api/pipeline` | 파이프라인 보드 |
| PUT | `/api/pipeline/:hospitalId` | 파이프라인 단계 변경 |
| GET/POST | `/api/pipeline/kpi-targets` | KPI 목표 관리 |
| POST | `/api/pipeline/transfer-doctor` | 의료진 이적 |
| GET | `/api/pipeline/meeting-stats` | 미팅 통계 (?doctor_id, ?hospital_id) |
| GET | `/api/pipeline/check-duplicate?name=` | 중복 기관 체크 |
| GET | `/api/export/:type` | CSV 내보내기 |
| GET | `/api/export/xlsx/:type` | Excel 내보내기 |
| POST | `/api/ai/hospital-doctors` | AI 의료진 자동 조회 |
| POST | `/api/ai/doctor-profile` | AI 프로필 조회 |
| POST | `/api/ai/doctor-papers` | PubMed 논문 검색 |
| GET | `/api/products` | 제품 카탈로그 (카테고리/모델별 비고 포함) |
| PUT | `/api/products/:id` | 카테고리 비고/이름 수정 |
| GET | `/api/products/dashboard` | 제품 대시보드 요약 |
| GET/POST | `/api/products/units` | 유닛 목록/입고 |
| GET/PUT/DELETE | `/api/products/units/:id` | 유닛 상세/수정/삭제 |
| POST | `/api/products/movements` | 입출고 이동 처리 (checkout/deliver/return/transfer/assign/release/lost/repair/retire) |
| GET | `/api/products/movements` | 이동 이력 (필터링) |
| GET | `/api/products/movements/export.csv` | 이동 이력 CSV 다운로드 |
| GET | `/api/products/by-user` | 영업담당자별 보유 현황 |
| GET | `/api/products/by-hospital/:id` | 기관 보유 데모기 |
| GET | `/api/products/by-meeting/:id` | 미팅 동반 반출 제품 |
| GET | `/api/products/available-for-meeting` | 미팅 폼용 가용 유닛 |
| POST | `/api/products/link-to-meeting` | 미팅-제품 일괄 연계 (자동 movement 생성) |
| DELETE | `/api/products/meeting-product/:id` | 미팅-제품 연계 해제 |

### API 에러 응답 형식 (표준화)
```json
{
  "error": "이메일 또는 비밀번호가 올바르지 않습니다.",
  "code": "UNAUTHORIZED"
}
```
지원 코드: `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `INTERNAL_ERROR`, `AI_ERROR`, `EXTERNAL_API_ERROR`

## 환경변수 관리

### 로컬 개발 (.dev.vars)
```
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 프로덕션 (Cloudflare Secrets)
```bash
npx wrangler pages secret put OPENAI_API_KEY --project-name todoc-crm
npx wrangler pages secret put OPENAI_BASE_URL --project-name todoc-crm
```

## User Guide
1. **대시보드**에서 전체 현황 확인, KPI 목표 설정, 파이프라인 보드 확인
2. **병원 관리** → 기관 추가, 파이프라인 단계 관리, 태그 부여
3. 기관 상세에서 **의료진 추가**, 사진 업로드, AI 프로필 조회
4. 의료진 수정 시 **외래 시간** 입력 → 요일별 시간과 비고 기록 → 방문 일정 참고
5. **미팅 기록** 추가 시 미팅 템플릿 선택, 복수 교수 선택 가능
6. **캘린더 뷰**에서 일정 확인, 미팅 통계에서 빈도/패턴 분석
7. ⭐ **즐겨찾기**로 자주 방문하는 기관/의료진 빠른 접근
8. 🏷 **태그**로 기관/의료진 분류 (CI 관심, 핵심 거래처 등)
9. **인공와우 통계** 메뉴에서 시장 데이터 확인
10. **Excel/CSV 내보내기**로 데이터 다운로드
11. **CS → 고객 문의 → 문의 접수**: 1 제목 → 2 접수일시/접수자 → 3 고객명 → 4 연락처 →
    5 문의 내용 → 6 유형·채널·우선순위·상태 순서로 입력. 저장 후 상세 화면에서
    7 응답/메모를 추가하고, 사람이 쓴 항목은 연필(수정)·휴지통(삭제) 버튼으로 관리

## ⚠️ CS 고객문의 폼 — 날짜/시간 처리 규칙 (필수 확인)

`접수일시`(`created_at`)와 `후속 예정`(`followup_at`)은 `<input type="datetime-local">`로
입력받습니다. 여기에 **시간대 함정**이 있으므로 아래 규칙을 반드시 지켜주세요.

- **DB의 모든 `DATETIME`은 UTC**입니다 (SQLite `CURRENT_TIMESTAMP`가 UTC).
- **`datetime-local`은 항상 "사용자 로컬 시각"** 을 다룹니다. 변환 없이 그대로 주고받으면
  한국(KST)에서는 접수일시가 **9시간씩 밀립니다.**
- 따라서 `app.js`의 전용 헬퍼 한 쌍을 **반드시** 통과시켜야 합니다.
  | 방향 | 함수 | 예시 (KST) |
  |------|------|-----------|
  | DB→화면 | `_csInqUtcToLocalInput(utc)` | `'2026-05-20 05:35:00'` → `'2026-05-20T14:35'` |
  | 화면→DB | `_csInqLocalInputToUtc(local)` | `'2026-05-20T14:35'` → `'2026-05-20 05:35:00'` |
- 두 함수는 형식이 어긋나면 `''`을 돌려줍니다. 저장 로직(`_csInqSaveFromPanel`)은 이때
  `created_at`을 **아예 보내지 않아** 서버가 기존 값(수정) 또는 현재 시각(신규)을 유지합니다.
- 백엔드도 `normalizeDateTime()`으로 형식·실존 날짜(예: `2026-02-30` 거부)를 재검증하고,
  `created_at=COALESCE(?, created_at)` 패턴으로 잘못된 값이 기존 데이터를 덮어쓰지 못하게 막습니다.
- `created_at_local`은 **화면 전용 필드**입니다. 전송 전에 반드시 `delete`하세요.

## ⚠️ 응답/메모 수정·삭제 — 시스템 이력 보호

`cs_inquiry_responses`에는 사람이 쓴 항목과 시스템이 자동 기록한 감사(audit) 이력이 섞여 있습니다.

- 수정·삭제 **가능**: `reply`(응답), `note`(내부 메모)
- 수정·삭제 **불가**: `status_change`(상태 변경), `assignee_change`(담당자 변경)
- 이 규칙은 **양쪽에서 이중으로** 강제됩니다.
  - 백엔드 `PUT/DELETE /api/cs/inquiries/:id/responses/:rid` → 해당 타입이면 **HTTP 400**
  - 프런트 타임라인 → `isSystem` 분기로 버튼 자체를 렌더하지 않음 (헛클릭 방지)
- 두 엔드포인트는 `WHERE id=? AND inquiry_id=?`로 **소유권도 검증**합니다.
  다른 문의의 응답 ID를 넣으면 404가 납니다. 이 조건을 절대 제거하지 마세요.
- 응답 타입 변경은 `reply ↔ note` 사이에서만 허용됩니다(시스템 타입으로 승격 불가).

## Deployment
- **Platform**: Cloudflare Pages + D1 Database
- **Status**: ✅ Production Active
- **Deployment URL**: https://todoc-crm.pages.dev
- **Last Updated**: 2026-08-06

## 프론트엔드 빌드 (⚠️ 필수 확인)

Tailwind는 **빌드 타임에 CSS를 생성**합니다 (구 `cdn.tailwindcss.com` 런타임 방식 제거).

```bash
npm run build        # build:css(Tailwind) → vite build 순서로 실행
npm run build:css    # Tailwind CSS만 재생성
npm run verify:css   # 클래스 누락 검증
```

**주의사항**
1. **클래스를 추가/변경하면 반드시 `npm run build`(또는 `build:css`)를 실행**해야 반영됩니다.
   CDN 시절처럼 "쓰면 바로 적용"되지 않습니다.
2. `app.js`에서 **문자열 결합으로 클래스를 만드는 경우**(`'bg-' + color + '-500'`)는
   정적 스캐너가 감지하지 못합니다. `tailwind.config.js`의 `safelist`에 추가하세요.
3. CSS 로드 순서는 `tailwind.css` → `style.css`를 유지해야 합니다(오버라이드 보존).
4. `<head>`의 axios/chart.js/marked/dompurify/leaflet과 `app.js`는 **모두 `defer`여야** 합니다.
   `app.js`가 최상단에서 `axios.create()`를 즉시 호출하므로, 하나라도 빠지면 실행 순서가 깨집니다.
5. `sw.js`의 자산 목록을 바꾸면 `CACHE_NAME` 버전을 올리세요.

## 백엔드 성능 규칙 (⚠️ 필수 확인)

### D1 왕복 횟수가 성능을 지배합니다

현재 D1 설정 (`npx wrangler d1 info todoc-crm-production`으로 확인):

| 항목 | 값 | 의미 |
|---|---|---|
| `running_in_region` | **ENAM** (미국 동부) | 모든 쿼리가 미국까지 왕복 |
| `read_replication.mode` | **disabled** | 읽기 복제본 없음 → 항상 primary로 |

Worker는 사용자 근처(서울) 엣지에서 실행되지만 **D1 쿼리는 매번 미국 동부까지 왕복**합니다.
왕복 1회당 약 **200ms**(한국 기준)이므로, 쿼리를 하나씩 `await`하면 그 수만큼 지연이 곱해집니다.

**규칙**: 서로 의존하지 않는 쿼리는 **반드시 `env.DB.batch([...])`로 묶으세요.**
- `batch()` = 요청 1건에 모든 statement → **왕복 1회 보장**
- `Promise.all()` = 동시 요청이지만 statement 수만큼 별도 호출
- 개별 `await env.DB.prepare(...)` 반복 = **최악** (왕복이 그대로 누적)

참고 구현: `src/routes/cs_dashboard.ts` (14개 쿼리를 batch 1회로 처리)
`batch()` 결과는 `D1Result[]`이므로 `.all()`/`.first()` 대신 헬퍼로 꺼냅니다.
```ts
const rowsOf  = (r: any): any[] => (r?.results || []) as any[]   // 기존 .all()  대체
const firstOf = (r: any): any   => (r?.results?.[0] ?? null)     // 기존 .first() 대체
```

> ⚠️ 인증 미들웨어(`src/index.tsx`)도 세션 조회로 왕복 1회를 씁니다.
> 즉 API 요청 1건의 최소 왕복은 **1회(인증) + 1회(batch) = 2회**입니다.

### 성능 최적화 이력 (2026-07-30) — CS 대시보드
| 항목 | 개선 전 | 개선 후 |
|---|---|---|
| D1 왕복 횟수 (요청 1건) | 12회 (인증1 + Promise.all1 + 개별10) | **2회** (인증1 + batch1) |
| 로컬 응답시간 (중앙값) | 38.0ms | **10.4ms** (-73%) |
| 한국 접속 예상 대기 | 약 2.4초 | **약 0.4초** |

- `src/routes/cs_dashboard.ts`의 순차 `await` 10개 + `Promise.all` 1개를 **`batch()` 1회**로 통합
- SQL은 한 줄도 변경하지 않음 → 응답 JSON은 기간 4종 × `mine` 2종 = **8개 조합 모두 완전 일치** 검증
- 미사용 죽은 코드 `todayStr` 제거

### 성능 최적화 이력 (2026-07-29) — 초기 로딩
| 항목 | 개선 전 | 개선 후 |
|---|---|---|
| domContentLoaded | 1680ms | **990ms** (-41%) |
| loadEvent | 1782ms | **1089ms** (-39%) |

- Tailwind CDN 런타임 JIT 컴파일(126KB JS) → 빌드 타임 CSS(87KB, gzip 13KB)
- Pretendard: Google Fonts에 없어 **HTTP 400 실패**하던 요청을 jsDelivr dynamic-subset으로 교체
- 외부 스크립트 `defer` 적용 + jsDelivr `preconnect`

### 남은 개선 여지 (미적용)
- `app.js` 877KB 단일 파일(13,334줄) → 미니파이 + 페이지별 코드 스플리팅
- 정적 자산 `Cache-Control: max-age=0` → 파일명 해시 + 장기 캐시
- chart.js/leaflet(113KB)을 사용 페이지에서만 동적 로드
- `loadMyKpi`의 `/dashboard/me` → `/dashboard/kpi-target` 순차 호출을 `Promise.all`로 병렬화

**백엔드 (D1 왕복 감축) — 위 "백엔드 성능 규칙" 참고**
- 다른 라우트의 순차 `await`도 `batch()`로 전환 (파일별 순차 await 개수: `products.ts` 93,
  `customers.ts` 20, `hospitals.ts`/`exports.ts`/`doctors.ts`/`cs_repairs.ts`/`cs_inquiries.ts` 각 18)
- `wrangler.jsonc`에 Smart Placement 추가 (`"placement": { "mode": "smart" }`)
  → Worker를 D1 근처로 이동, **전체 라우트가 함께 개선**. 단 HTML 셸 응답은 100~200ms 느려질 수 있음
- D1 읽기 복제(Sessions API) 활성화 → 대시보드는 전부 읽기 전용이라 적합

### Migration 이력
| 번호 | 파일명 | 내용 |
|------|--------|------|
| 0001-0010 | initial ~ clinics | 초기 스키마, CI 통계, 인증, 논문, 의원 |
| 0011 | merge_clinics_into_hospitals | 의원→병원 통합 (필드추가, 데이터 이전) |
| 0012 | tags_favorites_templates_pipeline | 태그, 즐겨찾기, 템플릿, 파이프라인, KPI, 이적, 관계 |
| 0013 | doctor_clinic_hours | 의료진 외래 시간 컬럼 추가 (clinic_hours TEXT) |
| 0014-0021 | (이전 기능 단계별 추가) | 사진/논문/대시보드/검색 등 점진적 확장 |
| 0022 | products | 제품 관리: products, product_units, product_holders, product_movements, meeting_products + 5종 시드 (내부기, 외부기 Sullivan/Sound1, 휴대보관함 Sullivan/Sound1) |

### 권장 다음 개발 사항
- **프론트엔드 모듈화**: app.js를 Vite + TypeScript 기반 모듈로 분리 (pages/, components/, utils/)
- **테스트**: Vitest 단위 테스트, Playwright E2E 테스트
- **보안**: RBAC 역할 관리, 로그인 brute-force 보호, CSRF 방어
- **AI 확장**: 미팅 요약 자동 생성, 의료진 추천, 이상 감지
- **협업**: 팀 대시보드, 작업 할당, 코멘트, 푸시 알림
- **UX**: 다크 모드, 무한 스크롤, 기관 지도 뷰
- **보고서**: 주간/월간 자동 보고서 PDF/이메일 발송
