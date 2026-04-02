# TODOC CRM - 병원 영업 관리 시스템

## Project Overview
- **Name**: TODOC CRM
- **Company**: 토닥(TODOC) - 인공와우 전문기업
- **Goal**: 병원 영업팀이 영업 대상 병원, 교수, 미팅 기록을 체계적으로 관리하는 CRM 시스템
- **Tech Stack**: Hono + TypeScript + Cloudflare Pages + D1 Database + TailwindCSS + Chart.js

## URLs
- **Production**: https://todoc-crm.pages.dev
- **D1 Database**: todoc-crm-production (f3fa9f6e-dab3-4fa0-b442-39f74c0c184a)

## 주요 기능

### 완성된 기능
- **대시보드**: 병원/의원/교수/미팅 통계, 이번 달 미팅 수, 지역별 분포 차트, 최근 미팅 타임라인, 후속 액션 추적, **월별 미팅 추이 차트 (Stacked Bar)**, **전월 대비 성장률 표시**, **빠른 미팅 추가 버튼**, 의원 관리 바로가기 배너
- **미팅 리마인더**: 향후 7일 이내 예정 미팅 배너 알림 (1일 미만 빨간색, 3일 미만 노란색 긴급도 표시)
- **병원/의원 통합 관리**: 카드형 목록, S/A/B/C 등급 분류(병원) + 우선순위 별점(의원), 유형/지역/등급 필터, 실시간 검색, 30일+ 미방문 경고
  - **의원 전용 필드**: 우선순위(1~5), 토닥접점(O/△/X), 난청환자수, 보청기판매, CI의뢰 실적
  - **병원/의원 자동완성**: 국내 주요 병원 40+ / 의원 10+ 로컬 데이터 + AI 보충 검색
- **병원 상세**: 기본정보, 소속 교수/관계자 목록(영향력 표시), 미팅/방문 기록 타임라인, 후속액션 추적, **요약 통계 카드**
- **교수 관리**: 전체 교수 테이블, 소속병원/진료과/전문분야/영향력/미팅횟수 표시, 검색, **진료과 필터 드롭다운**
- **교수 사진 업로드**: 프로필 사진 업로드(2MB 이하, 자동 200x200 리사이징, Base64 D1 저장)
- **미팅 기록**: 전체 미팅 타임라인, 유형별(방문/전화/학회/이메일/온라인) 분류, **글로벌 미팅 추가 버튼**, **병원/교수 필터 드롭다운**, **복수 교수 참석 지원 (다대다)**
- **모바일 UX**: 반응형 레이아웃, 검색 아이콘, 터치 최적화
- **인공와우 통계**: S5800 인공와우이식술 5개년+ 통계 시각화
  - 건강보험심사평가원 보건의료빅데이터 기반
  - 연도별 시술 건수/환자수 추이 (Bar + Line 복합 차트)
  - 성별 분포 추이 (Stacked Bar)
  - 연령대별 분포 (Doughnut)
  - 연령대별 연평균 성장률 (Horizontal Bar)
  - 지역별 시술 분포 (Bar)
  - 요양기관 종별 분포 (Doughnut)
  - 건강보험 급여 정책 변천 타임라인
  - 주요 인사이트 카드 6종

### 데이터 모델
| 테이블 | 주요 필드 |
|--------|----------|
| hospitals | name, region, address, phone, grade(S/A/B/C), status, notes, **type(hospital/clinic)**, **priority(1-5)**, **todoc_contact(O/△/X)**, **patient_count**, **hearing_aid_sales**, **ci_referrals** |
| doctors | name, department, position, specialty, influence_level(high/medium/low), photo |
| meetings | meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date |
| meeting_doctors | meeting_id, doctor_id (다대다 조인 테이블 - 한 미팅에 여러 교수 참석 가능) |
| activity_log | action, entity_type, entity_id, details, created_at |
| papers | doctor_id, title, journal, year, doi |

> **참고**: 의원(clinic) 데이터는 hospitals 테이블에 `type='clinic'`으로 통합 관리됩니다. 기존 clinics/clinic_contacts/clinic_visits 테이블의 데이터는 migration 0011에서 hospitals/doctors/meetings로 이전되었습니다.

### 인공와우 통계 데이터 출처
- **건강보험심사평가원 보건의료빅데이터개방시스템** (공공누리 제1유형)
- **진료행위코드**: S5800 (인공와우이식술)
- **참고 논문**: Korean J Otorhinolaryngol-Head Neck Surg. 2025;68(3):94-104, 68(9):351-361
- **데이터 범위**: 2018-2024년 (2023-2024 추세 기반 추정치 포함)
- **포함 정보**: 연도별 시술건수/환자수, 성별분포, 연령대별 분포, 지역별 분포, 요양기관종별 비율

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | 대시보드 통계 (월별 미팅, 지역 분포 포함) |
| GET | `/api/hospitals` | 병원/의원 목록 (?region, ?status, ?search, ?grade, ?type) |
| GET/POST/PUT/DELETE | `/api/hospitals/:id` | 병원 CRUD |
| GET | `/api/hospitals/:id/doctors` | 병원별 교수 목록 |
| GET/POST/PUT/DELETE | `/api/doctors/:id` | 교수 CRUD |
| POST/DELETE | `/api/doctors/:id/photo` | 교수 사진 업로드/삭제 |
| GET/POST/PUT/DELETE | `/api/meetings/:id` | 미팅 CRUD |
| GET | `/api/regions` | 지역 목록 |
| GET | `/api/ci-stats` | 인공와우 이식술 통계 (S5800 HIRA 빅데이터) |
| GET | `/api/meetings/form-data` | 미팅 폼 데이터 (병원/교수 목록) |
| GET | `/api/doctors/departments` | 교수 진료과 목록 |
| GET | `/api/search?q=` | 글로벌 검색 (병원/교수/미팅) |
| GET | `/api/activity` | 활동 로그 |
| GET | `/api/export/:type` | CSV 데이터 내보내기 |
| POST/PUT/DELETE | `/api/doctors/:id/papers` | 교수 논문 관리 |
| POST | `/api/ai/hospital-doctors` | AI 교수 자동 조회 (병원별) |
| POST | `/api/ai/doctor-profile` | AI 교수 프로필 조회 (학력/경력) |
| POST | `/api/ai/doctor-papers` | PubMed 논문 검색 |
| POST | `/api/ai/hospital-suggest` | 병원명 자동완성 |

## User Guide
1. **대시보드**에서 전체 현황 확인 (통계 카드 클릭 시 해당 페이지 이동)
2. **병원 관리** → 병원 추가 후, 카드 클릭하여 상세 페이지 이동
3. 병원 상세에서 **교수 추가** → 교수 프로필 사진 클릭하여 사진 업로드
4. **미팅 기록** 추가 시 체크박스로 **복수 교수 선택 가능** (공동 미팅)
5. 미팅에서 결과, 후속 액션, 다음 미팅 예정일 입력
5. 대시보드의 **후속 액션** 패널에서 To-Do 추적
6. **인공와우 통계** 메뉴에서 시장 데이터 확인 (영업 PT 자료 활용 가능)

## Deployment
- **Platform**: Cloudflare Pages + D1 Database
- **Status**: ✅ Production Active
- **Deployment URL**: https://todoc-crm.pages.dev
- **Commit**: `merge clinics into hospitals`
- **Last Updated**: 2026-04-02

### AI 기능 (최신 업데이트)
- **AI 교수 자동 조회**: 병원명으로 인공와우/난청/이과 관련 교수를 자동 검색
  - 공식 의료진 목록 페이지 크롤링 (서울대, 삼성, 아산 등 20+ 병원)
  - Google 검색 보충 데이터 수집 (JS 렌더링 병원 대응)
  - AI 분석으로 교수명/직위/전문분야/영향력 추출
- **PubMed 논문 검색**: 교수별 연구 논문 자동 검색
  - 한글 이름 → 영문 로마자 변환 (60+ 성씨 매핑, 알려진 교수 직접 매핑)
  - PubMed E-utilities API 3단계 검색 전략
  - 병원 소속 필터, CI/난청 토픽 필터
- **교수 프로필 자동 조회**: 웹 크롤링으로 학력/경력/전문분야 추출

### 지원 병원 URL 목록
서울대, 삼성서울, 서울아산, 세브란스, 분당서울대, 가톨릭서울성모, 고려대안암, 아주대, 경북대, 칠곡경북대, 부산대, 전남대, 충남대, 세종충남대, 인하대, 한양대, 중앙대, 순천향, 동아대, 원광대, 단국대, 건국대

### 현재 데이터
- 병원/의원: 통합 관리 (type 필드로 병원/의원 구분)
- 교수/관계자: doctors 테이블 통합
- 미팅/방문: meetings 테이블 통합

### Migration 이력
| 번호 | 파일명 | 내용 |
|------|--------|------|
| 0001-0010 | initial ~ clinics | 초기 스키마, CI 통계, 인증, 논문, 의원 |
| 0011 | merge_clinics_into_hospitals | 의원→병원 통합 (필드추가, 데이터 이전) |
