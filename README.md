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

#### 출장 거리 정산 (유류비·통행료 증빙)
재무팀 제출용 **국세청 업무용승용차 운행기록부(별지 제65호)** 형식의 거리 증빙을 자동 생성합니다.

- **거리 자동 산출**: 방문 미팅(`meeting_type='방문'`) 기록을 (날짜, 담당자)로 묶어
  카카오모빌리티 길찾기 API의 **실제 도로 주행거리**를 계산 (직선거리 아님)
- **방문 순서 정렬**: `visit_time`(am/full/pm) → `start_time` 기준
- **출발지·복귀지 (날짜별 선택)**: 집·사무실 등 자주 쓰는 장소를 `travel_places`에 등록해두고,
  일자별 표의 `출발 → 복귀` 셀렉트에서 그 날 실제로 쓴 곳을 각각 고릅니다.
  출발지와 복귀지가 서로 다른 **비대칭 경로**(집 → 병원들 → 사무실)를 지원합니다.
  - 장소 종류: `home`(집) / `office`(사무실) / `other`(기타)
  - 담당자별로 **기본 출발지 / 기본 복귀지**를 1곳씩 지정 가능 (각각 1개만 유지)
  - 결정 우선순위: ① 그 날 명시값(`travel_logs.origin_place_id`/`return_place_id`,
    `0` = "없음" 명시 선택 / `NULL` = 미지정) → ② 담당자 본인 기본값 → ③ 전사 공용(`user_id IS NULL`) 기본값
    → ④ 전역 설정(`travel_origin_*`)
  - **좌표 자동 입력**: 주소나 건물/기관 이름을 넣고 `좌표 찾기`(또는 Enter) → 후보 목록에서 클릭.
    좌표를 비운 채 저장해도 주소로 한 번 자동 조회합니다 (`GET /api/travel/geocode`)
  - 좌표(위도·경도)가 없는 장소는 경로 계산에 쓸 수 없으며 셀렉트에서 제외됩니다
  - 출발/복귀를 바꾸면 그 날 경로와 주행거리가 **즉시 재계산**됩니다
  - 보고서에도 `출발지`·`복귀지` 열과 조합별 일수 요약이 들어갑니다
- **계기판 입력**: 국세청 서식상 계기판 누적거리만 수동 입력 필요 → 일자별 입력 모달
  (차종/등록번호/주행전·후 계기판/실제 통행료/주유금액/비고)
- **차량 형태별 정산 방식 자동 결정** (마이페이지에서 담당자별 설정):
  | 형태 | 정산 |
  |---|---|
  | 미설정 | 거리 증빙만 (경고 표시) |
  | 법인차량 | 거리 증빙만 |
  | 개인차량 + 자가운전보조금 | 거리 증빙만 (⚠️ 세무 경고) |
  | 개인차량 + 실비 정산 | km당 단가, 없으면 연비·유가 기준 금액 산출 |
- **⚠️ 세무 함정 방어**: 자가운전보조금(월 20만원 비과세) 수령자에게 유류비·통행료를
  실비로 병행 지급하면 20만원 전액이 **과세 전환**됩니다. 이 경우 금액을 산출하지 않고
  경고를 노출합니다 (`resolveSettlement()`).
- **보고서 다운로드**: CSV(BOM, 4섹션) / XLSX(4시트 — 요약/일자별 운행기록/구간별 이동상세/방문기관 좌표)
- **업무사용비율은 100% 상한**: 계기판 거리가 경로 산출 거리보다 짧으면 비율을 100%로 고정하고
  비고에 확인 안내를 넣습니다 (서식상 100% 초과는 불가능)
- **경로 캐시**: `travel_route_cache` (동일 구간 재조회 시 API 호출 절감, `?refresh=1`로 무효화)
- **좌표 미등록 기관 안내**: 좌표 없는 기관은 경로에서 제외되고 화면·보고서에 명시

**좌표 조회 (지오코딩)**
- `GET /api/travel/geocode?q=…` 가 후보 좌표를 돌려줍니다. 제공자 우선순위:
  1. **카카오 로컬** (주소검색 → 실패 시 키워드검색) — 국내 정확도 최상
  2. **Nominatim / OpenStreetMap** — 키 불필요 폴백
- 현재 카카오 로컬은 `OPEN_MAP_AND_LOCAL disabled` (403) 상태라 **실제로는 OSM 폴백이 동작**합니다.
  카카오 서비스가 복구되면 코드 수정 없이 자동으로 카카오가 우선 사용됩니다.
- 실측 오차(기존 카카오 좌표 대조): 도로명 주소 0~400m, 기관명 검색 0m.
  출발지·복귀지 용도로는 충분하며, 후보 선택 후 좌표를 직접 미세조정할 수 있습니다.
- ⚠️ Nominatim 이용약관상 초당 1건 제한 + 식별 User-Agent 필수 → 서버에서 대신 호출합니다
  (브라우저 직접 호출 금지).

**한계 / 주의**
- 통행료는 **카카오 추정치**입니다. 실제 증빙은 하이패스 이용내역이 기준이며,
  실제 금액은 계기판 입력 모달에서 직접 채워야 합니다.
- `KAKAO_REST_API_KEY` secret이 없으면 `/api/travel/daily`는 **503**을 반환합니다.
- 카카오 **로컬(주소검색) API는 403**(`OPEN_MAP_AND_LOCAL disabled`) 상태이므로
  기관 좌표는 **위도·경도 직접 입력**으로 등록합니다 (길찾기 API는 정상).

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
| GET/PUT | `/api/travel/settings` | 출장 정산 설정 (전역 출발지 좌표·복귀구간·전역 단가) + 장소 목록 동봉 |
| GET | `/api/travel/geocode` | 주소/장소명 → 좌표 후보 (?q=) · 카카오 로컬 → OSM 폴백 |
| GET | `/api/travel/places` | 출발지·복귀지 장소 목록 (본인 + 전사 공용) |
| POST | `/api/travel/places` | 장소 등록 (이름/종류/주소/좌표/기본 출발·복귀 플래그) |
| PUT | `/api/travel/places/:id` | 장소 수정 (전사 공용·타인 장소는 403) |
| DELETE | `/api/travel/places/:id` | 장소 삭제 (참조 운행기록은 기본값으로 되돌림) |
| GET | `/api/travel/daily` | 일자별 운행기록 산출 (?from=&to=&user_id=&refresh=1) |
| GET/PUT | `/api/travel/logs` | 계기판·실제 통행료·주유금액 + 그 날 출발지·복귀지(`origin_place_id`/`return_place_id`) 입력 (upsert) |
| POST | `/api/travel/route` | 임의 기관 목록의 경로 거리 계산 (hospital_ids[] 1~28) |
| GET | `/api/export/report/travel` | 출장 정산 보고서 (?from=&to=&user_id=&format=csv\|xlsx) |
| GET/PUT | `/api/mypage` | 내 프로필 + 차량 정보(형태·차종·번호·km단가·연비·유가) |

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
12. **CS → AS/수리 요청 → 새 수리 접수**: 1 접수일 및 시간·접수자 → 2 고객·연락처 →
    3 증상(필수) → 4 상태·우선순위·보증·담당자 → 5 제품정보 조회(시리얼/자산번호) →
    6 비용·일정 순서로 입력. 저장 후 상세 화면에서 7 진단·처리, 8 비고와 진행 이력을 관리
13. **고객관리**: 고객은 **전원 '수술 환자'** 로 통일되어 있습니다. 유형·상태 선택칸이 없으므로
    분류가 필요하면 왼쪽 **'그룹'** 패널에서 그룹을 만들고 고객을 체크해 묶으세요.
    상단 카드는 `전체 / 그룹 지정 / 병원 연결 / 문의 이력` 4개 지표를 보여줍니다.
14. **고객 등록/편집 폼** 입력 순서: 1 이름 → 2 성별 → 3 생년월일 → 4 병원 →
    5 연락처1 → 6 보호자 연락처1 → 7 이메일 → 8 주소 (이후 지역·수술 부위·내부기/외부기·그룹)
15. **비밀번호 변경**: 두 곳 중 아무 곳에서나 가능합니다.
    (a) 헤더 우측 **사용자 이름 클릭 → 비밀번호 변경**
    (b) **마이페이지 → 활성 로그인 세션 카드 하단 '계정 보안' → 비밀번호 변경**
    현재 비밀번호를 입력해야 하며, 변경하면 **현재 기기를 제외한 모든 기기가 자동 로그아웃**됩니다.

## ⚠️ 계정 보안 — 비밀번호 변경 / 재설정 미지원

**비밀번호 변경**(`POST /api/auth/change-password`)은 지원합니다.
UI 진입점은 **헤더 사용자 드롭다운**과 **마이페이지 '계정 보안' 카드** 두 곳입니다
(같은 `showChangePassword()` 모달을 공유하므로 한쪽만 고치면 안 됩니다).

서버 검증: 세션 필수 → 현재 비밀번호 일치 → 새 비밀번호 6자 이상 →
`password_hash` 갱신 후 **`DELETE FROM sessions WHERE user_id=? AND id!=?`** 로
다른 기기 세션을 전부 무효화합니다.
그래서 프론트는 성공 후 `curPage === 'mypage'` 이면 `loadMypage()` 로 세션 목록을 다시 불러옵니다.
(안 하면 이미 죽은 세션이 화면에 남습니다.)

**비밀번호 재설정(찾기)은 의도적으로 미구현입니다.** 전제 조건이 없습니다:
- 이메일 발송 수단 없음 (`.dev.vars` 에 `SLACK_WEBHOOK_URL` 만 존재)
- 관리자 권한 없음 (`users` 테이블에 `role` 컬럼 자체가 없음)

→ 비밀번호를 완전히 잊은 경우 **운영자가 D1 의 `password_hash` 를 직접 교체**해야 합니다.
해시는 PBKDF2(Web Crypto)라 수동 생성이 불가능하며, 앱의 `hashPassword()` 를 거쳐야 합니다.

### ⚠️ 모달 폼의 제출 버튼을 직접 disabled 하지 마세요

`#modal-body` 안의 모든 `<form>` 은 **캡처 단계 전역 submit 래퍼**(`_setModalSubmitting`)가
가로채서 스피너·중복 제출 차단·버튼 `disabled` 를 **이미** 처리합니다.

그래서 핸들러 안에서 이런 코드를 쓰면 **모든 제출이 영구 차단됩니다**:
```js
if (btn.disabled) return;   // ❌ 래퍼가 먼저 disabled 를 걸어둠 → 항상 return
btn.disabled = true;        // ❌ 불필요 (래퍼가 함)
```
실제 사고: 비밀번호 변경 버튼이 첫 클릭 이후 영구 비활성화되어 변경 자체가 불가능했습니다.

검증 실패로 **조기 return** 할 때는 래퍼가 걸어둔 상태를 반드시 풀어주세요:
```js
const release = () => { try { fm._releaseSubmitting && fm._releaseSubmitting() } catch (_) {} };
if (!f.currentPassword) { toast('...', 'warn'); release(); return }
```

### ⚠️ `toggleUserDropdown()` 을 '닫기' 목적으로 쓰지 마세요

토글이라서 **이미 닫힌 상태에서 호출하면 반대로 열립니다.**
마이페이지 버튼처럼 드롭다운 밖에서 호출하는 경우 오작동합니다.
닫기 전용 `closeUserDropdown()` 을 쓰세요.

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

## ⚠️ AS/수리 요청 — 접수일시 저장 형식은 ISO (문의와 다름)

수리 요청 폼(`openCsRepairModal`)도 같은 UTC↔로컬 헬퍼 한 쌍을 씁니다.
다만 **DB 저장 형식이 고객문의와 다릅니다.**

| 테이블 | 컬럼 | 저장 형식 | 생성 주체 |
|--------|------|-----------|-----------|
| `cs_inquiries` | `created_at` | `'2026-05-20 05:35:00'` | SQLite `CURRENT_TIMESTAMP` |
| `cs_repairs` | `received_at` | `'2026-05-20T05:35:00.000Z'` | JS `new Date().toISOString()` |

- `cs_repairs`의 다른 타임스탬프(`created_at`/`updated_at`/`completed_at` 등)가 모두 ISO라서
  `received_at`도 **ISO로 통일**해야 합니다. 한 컬럼에 두 형식이 섞이면
  `ORDER BY received_at DESC`(인덱스 `idx_cs_repairs_received`) 정렬이 어긋납니다 —
  문자열 비교에서 `'T'`(0x54) > `' '`(0x20)이므로 ISO 행이 항상 위로 올라옵니다.
- 그래서 백엔드에 **`normalizeReceivedAt()`** 을 두었습니다. 프런트가 보내는
  `'YYYY-MM-DD HH:MM:SS'`(UTC)와 ISO를 모두 받아 **항상 ISO로 되돌려 저장**하고,
  형식 오류·실존하지 않는 날짜(`2026-02-31`)는 `null`을 돌려줍니다.
- `null`일 때의 동작: POST는 **현재 시각**, PUT은 **`prev.received_at` 유지**.
  잘못된 값이 기존 접수일시를 덮어쓰는 일은 없습니다.
- `접수자`(`created_by`)는 폼에서 지정할 수 있습니다.
  - 필드가 **아예 없으면** → POST는 로그인 사용자, PUT은 `prev.created_by` 유지
  - 값이 **`''`(미지정)** 이면 → `null` 저장 (의도된 해제)
- `received_at_local`은 **화면 전용 필드**입니다. 전송 전에 반드시 `delete`하세요.
- 폼 섹션 번호는 `nx()`로 자동 증가합니다. `진단 · 처리` 섹션이 편집 모드에서만
  나타나므로 고정 숫자를 쓰면 신규 접수에서 번호가 건너뛰어 보입니다.
- 현재 `cs_repairs` SQL 개수: **POST 23/23/23, PUT SET 25 + WHERE 1 = 바인딩 26**

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

## ⚠️ 제거된 입력 필드 — `duration_min` / `followup_at`

`통화/응대 시간`(`duration_min`)과 `후속 예정`(`followup_at`)은 사용자 요청으로
**접수 폼에서 제거**했습니다. 단, **DB 컬럼과 표시 로직은 그대로 유지**됩니다.

- 컬럼 유지 이유: 과거에 입력된 값이 목록·상세의 배지(`37분`, `🔔 2026-09-01`)로
  계속 표시되어야 하므로 `migrations/0033`의 컬럼을 삭제하지 않았습니다.
- **백엔드 `UPDATE` 문에서도 두 필드를 제외**했습니다. 이게 핵심입니다 —
  폼이 값을 보내지 않는데 `duration_min=?, followup_at=?` 를 남겨두면 수정할 때마다
  `NULL`로 덮어써져 **기존 데이터가 조용히 지워집니다.**
- 다시 살릴 때는 **세 곳을 함께** 되살려야 합니다.
  1. `app.js` 6번 섹션의 입력칸 2개
  2. `cs_inquiries.ts` POST 의 `INSERT` 컬럼/플레이스홀더/바인딩
  3. `cs_inquiries.ts` PUT 의 `UPDATE` SET 절/바인딩
- 수정 후에는 **컬럼 수 = 플레이스홀더 수 = 바인딩 인자 수**가 일치하는지 꼭 확인하세요.
  어긋나면 값이 엉뚱한 컬럼에 저장되며 에러도 나지 않습니다.
  (현재: POST 16/16/16, PUT SET 16 + WHERE 1 = 바인딩 17)

## ⚠️ 고객관리 — `유형`(customer_type) / `상태`(status) 제거

사용자 요청으로 고객의 **유형·상태 구분을 폐기**했습니다.
고객은 **전원 `patient`(수술 환자) · `active`(활성)** 이며,
분류는 **'고객 그룹'(`customer_groups`) 기능**이 담당합니다.

- 화면에서 제거된 곳 (5군데 모두):
  1. **입력 폼** (`openCustomerModal`) — 유형·상태 select 2개 삭제, `이름`을 `col-span-full`로 확장
  2. **목록 테이블** (`renderCustomers`) — 그리드 9열 → 7열
     (`'34px 1fr 160px 90px 190px 80px 80px'` = 체크박스·이름/연락처·병원·지역·그룹·문의·액션)
  3. **필터** (`loadCustomers`) — `전체 유형`·`전체 상태` select 삭제, `지역` 필터만 유지
  4. **통계 카드** (`renderCustomerStats`) — 유형 기준 → `전체 / 그룹 지정 / 병원 연결 / 문의 이력`
  5. **문의 폼 고객 검색 드롭다운** — 유형 라벨 → `hospital_name`(식별에 실제로 도움이 되는 값)
- **DB 컬럼은 삭제하지 않습니다.** SQLite `DROP COLUMN` 제약도 있지만, 무엇보다
  과거 값(`guardian`/`dormant` 등)을 보존해 되살릴 여지를 남기기 위함입니다.
  `migrations/0040_customer_unify_type_patient.sql`은 값만 통일합니다.
- **백엔드 `PUT /api/customers/:id`의 `UPDATE`에서 두 컬럼을 완전히 제외**했습니다. **이게 핵심입니다** —
  폼이 값을 보내지 않는데 `customer_type=?`를 남겨두고 `b.customer_type || 'patient'`로
  바인딩하면 고객을 **수정할 때마다 기존 유형이 기본값으로 조용히 덮어써집니다.**
  (`duration_min`/`followup_at` 때와 동일한 함정입니다)
- `POST /api/customers`의 기본값은 `'prospect'` → **`'patient'`** 로 변경, 상태는 `'active'`.
- **살아 있는 것** (되살릴 때 그대로 재사용):
  - `GET /api/customers`의 `type=` / `status=` 쿼리 파라미터
  - `GET /api/customers/stats`의 `by_type` / `by_status` (현재 프런트에서 소비하지 않음)
  - `app.js`의 `CUST_TYPE_LABELS` / `CUST_TYPE_COLORS` / `CUST_STATUS_LABELS` 상수
- `filterCust()`는 `_custFilter.type`·`status`를 **항상 `''`로 고정**합니다.
  값이 남으면 화면에 해제 수단이 없는데 목록이 걸러져 버립니다.
- 목록은 **헤더 셀 개수 = 행 셀 개수(7/7)** 가 반드시 일치해야 합니다. 어긋나면 열이 밀립니다.
- 현재 `customers` SQL 개수: **POST 30/30/30, PUT SET 27 + WHERE 1 = 바인딩 28**

## ⚠️ 고객 편집 폼 — 필드 순서 고정 & `guardian_phone`

폼 필드 순서는 **사용자가 지정한 순서**입니다. 임의로 바꾸지 마세요.

| # | 라벨 | `name` |
|---|------|--------|
| 1 | 이름 * | `name` |
| 2 | 성별 | `gender` |
| 3 | 생년월일 | `birth_date` |
| 4 | 병원 | `hospital_id` |
| 5 | 연락처1 | `phone` |
| 6 | 보호자 연락처1 | `guardian_phone` |
| 7 | 이메일 | `email` |
| 8 | 주소 | `address` |

- `지역`(`region`)은 목록 필터·컬럼에서 쓰이므로 지정 순서 **뒤에** 그대로 둡니다.
- `app.js`의 해당 블록에는 `/* 1 */ ~ /* 8 */` 주석으로 순서를 표시해 두었습니다.
- **`guardian_phone`은 `guardian_of`와 전혀 다른 필드입니다.** 혼동하지 마세요.
  | 컬럼 | 의미 |
  |------|------|
  | `guardian_of` | 다른 **고객 레코드**를 보호자로 연결하는 참조(FK) — 기존 필드 |
  | `guardian_phone` | 보호자에게 직접 연락할 **전화번호**(자유 텍스트) — `migrations/0041` 신규 |
  보호자를 고객으로 따로 등록하지 않아도 연락처만 남길 수 있게 하기 위함입니다.
- **PUT 은 `guardian_phone=COALESCE(?, guardian_phone)`** 으로 방어합니다.
  - 폼이 값을 보내면 `''` 포함 **그대로 저장**(= 의도된 삭제)
  - 요청 본문에 **키 자체가 없으면** `null` 을 넘겨 **기존 값 유지**
  - 나중에 추가된 컬럼이라, 이 필드를 모르는 다른 호출 경로가 값을 조용히 날리는 것을 막습니다.
- 필드를 추가·이동할 때는 **컬럼 수 = 플레이스홀더 수 = 바인딩 인자 수**를 반드시 재확인하세요.
  어긋나면 값이 엉뚱한 컬럼에 저장되며 **에러도 나지 않습니다.**

### 등록일 표시 (`created_at`)

고객 편집 모달 **최상단**(이름 필드 위)에 `등록일` / `최근 수정` 배지를 읽기 전용으로 표시합니다.

- **신규 등록 모달에서는 표시하지 않습니다** (`id && cst.created_at` 조건). 아직 값이 없습니다.
- **반드시 `csFmtDateTime()` 을 통과시키세요.** `customers.created_at` 은 SQLite
  `CURRENT_TIMESTAMP` 형식(`'YYYY-MM-DD HH:MM:SS'`, **UTC**)입니다.
  `slice(0,10)` 이나 `replace` 로 직접 자르면 **한국시간과 9시간 어긋납니다.**
  `csFmtDateTime()` 은 타임존 표기가 없으면 `'Z'` 를 붙여 로컬(KST)로 변환합니다.
  - 검증: 프로덕션 `2026-07-29 05:52:48`(UTC) → 화면 `2026-07-29 14:52`(KST) ✅
- `updated_at` 이 `created_at` 과 같으면 `최근 수정`은 생략합니다(중복 노출 방지).
- 읽기는 `GET /api/customers/:id` 의 `SELECT c.*` 로 자동 전달되므로 라우트 수정이 필요 없습니다.

## ⚠️ 내부기 / 외부기 폼 — 제조사 제거 & 외부기 이니셜·보안키

사용자 요청으로 **내부기·외부기 등록 폼에서 `제조사`(manufacturer) 입력칸을 제거**했고,
**외부기에는 `이니셜`(`initial`)·`보안키`(`security_key`)** 를 추가했습니다(`migrations/0042`).

| 폼 | 현재 필드 순서 |
|----|----------------|
| 내부기 | 방향 · 모델명 · 시리얼 번호 · 이식일 · 메모 |
| 외부기 | 방향 · 상태 · 모델명 · 시리얼 번호 · **이니셜** · **보안키** · 지급/교체일 · 버전 · 메모 |

- **`manufacturer` 컬럼은 삭제하지 않았습니다.** DB·API 는 그대로 살아 있습니다.
  `app.js` 의 `CUST_MFR_OPTIONS` / `_custMfrOptions()` / `_custMfrLabel()` 도
  **호출되지 않지만 지우지 마세요.** 제조사를 되살릴 때 다시 참조합니다.
  각 폼 블록에 복원용 한 줄을 주석으로 남겨두었습니다.
- **🚨 데이터 손실 방어(반드시 유지):** 폼이 `manufacturer` 를 더 이상 전송하지 않으므로
  두 PUT 라우트를 **`manufacturer=COALESCE(?, manufacturer)`** 로 바꿨습니다.
  그냥 `manufacturer=?` 로 두면 **편집 저장마다 기존 제조사 값이 조용히 `NULL` 로 덮어써집니다.**
  (이 프로젝트에서 같은 패턴의 사고가 반복됐습니다 — `customer_type`·`status`·`guardian_phone` 참고)
  - 검증: 로컬에서 `cochlear`·`medel` 을 심어두고 `manufacturer` 없이 PUT → **보존 확인 ✅**
- `initial` / `security_key` 는 **`DEFAULT ''` 없이 NULL 허용**입니다.
  device 테이블의 다른 텍스트 컬럼(`model`/`serial`/`version`)이 모두 `b.x || null` 패턴이라
  일관성을 맞췄고, 표시 로직은 `dev.initial || '—'` 로 NULL/`''` 를 동일 취급합니다.
- **외부기 카드 제목**은 기존 `제조사 라벨` → **`이니셜`** 로 바뀌었습니다
  (`dev.initial || '외부기'`). 이니셜이 현장 식별에 가장 유용하기 때문입니다.
- `보안키`는 민감정보지만 현장에서 눈으로 확인·전달해야 하는 값이라 **마스킹하지 않습니다.**
  대신 입력칸에 `autocomplete="off" spellcheck="false"` 를 걸어 브라우저 저장을 막습니다.
- 현재 SQL 개수(검증 완료):
  - 외부기 INSERT **컬럼 11 / 플레이스홀더 11**
  - 외부기 PUT **SET 10 + WHERE 2 = 바인딩 12**
  - 내부기 PUT **SET 6 + WHERE 2 = 바인딩 8**
- `initial`/`security_key` 는 `SELECT` 목록에 **명시적으로 나열**되어 있습니다
  (`GET /api/customers/:id` 내부 조회 + `GET /api/customers/:id/external-devices` 2곳).
  컬럼을 더 추가하면 **이 두 곳을 모두** 고쳐야 합니다. 빠뜨리면 화면에 값이 안 나옵니다.

## Deployment
- **Platform**: Cloudflare Pages + D1 Database
- **Status**: ✅ Production Active
- **Deployment URL**: https://todoc-crm.pages.dev
- **Last Updated**: 2026-08-18 (출장 거리 정산 + 날짜별 출발지·복귀지 + 좌표 자동 조회)

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

### ⚠️ `.input` 에는 Tailwind padding 유틸리티가 듣지 않습니다 (2026-08-06)

**증상**: 로그인 화면에서 이메일/비밀번호 입력칸의 아이콘이 글자와 겹쳐 보임
(`✉ame@to-doc.com`, `🔒밀번호`처럼 앞글자가 가려짐).

**원인**: `style.css`의 `.input { padding: 9px 13px }`는 **축약(shorthand) 속성**이고,
`style.css`는 `tailwind.css` **뒤에** 로드됩니다.
`.input`(명시도 0,1,0)과 `.pl-10`(0,1,0)은 명시도가 같으므로 **나중에 온 쪽이 이깁니다.**
→ `class="input pl-10"`을 써도 padding-left는 40px이 아니라 13px로 남습니다.

무효로 확인된 조합: `pl-10` `pl-9` `pr-7` `py-1` `py-1.5` `py-2` (전부 안 먹음)

**해결 방법 (둘 중 하나)**
- **(A) 권장** — `style.css`에 복합 선택자(0,2,0) 규칙을 추가:
  ```css
  .input.pl-10 { padding-left: 40px }
  .input.pl-9  { padding-left: 36px }
  .input.pr-7  { padding-right: 28px }
  ```
  명시도가 (0,2,0)이라 `@media (max-width:640px)` 안의 모바일용 `.input`(0,1,0)도 함께 이깁니다
  (**미디어쿼리는 명시도를 올려주지 않음**) → 데스크톱/모바일 한 번에 해결. 중복 작성 불필요.
- **(B)** 마크업에서 `!` 접두사로 `!important` 부여 (`!py-1.5`, `!pr-7`, `!w-auto`).
  코드베이스 곳곳에서 이미 이 방식을 쓰고 있어 **정상 동작합니다. 절대 "정리"하지 마세요.**

**영향 범위**: 로그인/회원가입/비밀번호변경 8곳 + 고객·문의·수리·지식베이스·병원·의료진·미팅 검색창 7곳
= 총 16개 입력칸이 동시에 영향받았습니다. CSS 3줄 수정으로 전부 해결.

장식용 아이콘 클릭이 입력칸에 전달되도록 다음 규칙도 함께 추가했습니다:
```css
.relative:has(> .input) > i { pointer-events: none }
```

**앞으로 `.input`에 새 padding 유틸리티를 쓰려면 `style.css`에 한 줄을 추가하세요.**

## ⚠️ D1 SQL 변수 개수 상한 — `IN (?,?,?...)` 을 직접 만들지 마세요 (2026-08-10)

### 실제 사고
미팅이 **101건**이 되는 순간 `GET /api/meetings` 가 500 으로 죽었습니다.

```
D1_ERROR: too many SQL variables at offset 425: SQLITE_ERROR
```

실측 임계값: **ID 100개까지 성공, 101개부터 실패.**
`limit=100 → 200 OK` / `limit=101 → 500`.

### 원인
행 수만큼 placeholder 를 만드는 코드입니다.

```ts
// ❌ 절대 금지 — 데이터가 늘면 반드시 터지는 시한폭탄
WHERE mu.meeting_id IN (${meetingIds.map(() => '?').join(',')})
```

개발 초기에는 데이터가 적어 정상 동작하므로 **테스트로 잡히지 않습니다.**
전수 조사 결과 동일 패턴이 **8개 파일 12곳**에 있었고, 데이터가 늘면 순차적으로
터지는 구조였습니다. 실제로 미팅 120건 / 고객 130건 상태에서 재현해 보니
`/api/meetings`, `/api/customers`, `/api/doctors/:id`,
`/api/export/report/sales` 가 **모두 500** 이었습니다.

### 규칙 — `src/helpers.ts` 의 헬퍼만 사용하세요

```ts
import { queryByIds, chunk, SQL_VARS_CHUNK } from '../helpers'

// ✅ ID 개수에 상관없이 안전 (90개씩 분할 → 병렬 질의 → 결과 병합)
const rows = await queryByIds<any>(
  db,
  ph => `SELECT mu.meeting_id, u.id as user_id, u.name as user_name
         FROM meeting_users mu LEFT JOIN users u ON mu.user_id = u.id
         WHERE mu.meeting_id IN (${ph})`,
  meetingIds
)

// IN 절 뒤에 추가 바인딩이 있으면 4번째 인자(extra)로 전달
const conflicts = await queryByIds<any>(
  db,
  ph => `SELECT product_unit_id FROM product_set_items
         WHERE product_unit_id IN (${ph}) AND removed_at IS NULL AND set_id != ?`,
  toAdd,
  [id]
)
```

- `SQL_VARS_CHUNK = 90` — 실측 상한 100 보다 낮게 잡은 안전값입니다.
  다른 바인딩 파라미터가 함께 있으면 그만큼 여유가 줄어들기 때문입니다.
- 청크 분할이 안전한 이유: 대상 쿼리들이 모두 `GROUP BY <id>` 집계이거나
  id 기준 join 조회여서 결과를 병합해도 값이 달라지지 않습니다.

### 청크 분할이 안전하지 않은 2가지 예외

| 상황 | 처리 방법 | 위치 |
|---|---|---|
| 전역 `ORDER BY` 가 필요 | 청크 병합 후 **JS 에서 재정렬** | `exports.ts` 참석자 확장 |
| `LIMIT n` 이 붙어 있음 | 청크마다 LIMIT 이 적용돼 의미가 달라지므로 **ID 자체를 90개로 사전 절단** | `hospitals.ts` 지오코딩 배치 |

`exports.ts` 는 `m.id as _mid` 를 임시로 SELECT 해서
`ORDER BY m.meeting_date DESC, m.id DESC, d.name ASC` 를 JS 로 재현한 뒤
`delete r._mid` 합니다. 수정 전/후 출력을 바이트 비교해 **생성 타임스탬프 1줄을
제외하고 완전히 동일**함을 검증했습니다.

### 의도적으로 raw 패턴을 남긴 곳
- `schedule.ts` 지역(region) placeholder — 사용자가 고르는 지역명이라 100개 초과가 비현실적
- `helpers.ts` 내부 — `queryByIds` 구현체 자체

### ⚠️ 스키마 드리프트 발견 (미해결 이슈)
프로덕션 `meetings` 테이블에는 `user_id INTEGER REFERENCES users(id)` 컬럼이
있으나 **대응하는 migration 파일이 없습니다.** 마이그레이션을 거치지 않고 원격에
직접 추가된 것으로 보이며, 그 결과 로컬 D1 을 마이그레이션만으로 재구성하면
`no such column: m.user_id` 로 실패합니다. 향후 정리가 필요합니다.

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
