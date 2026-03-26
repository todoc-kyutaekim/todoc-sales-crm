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
- **대시보드**: 병원/교수/미팅 통계, 이번 달 미팅 수, 지역별 분포 차트, 최근 미팅 타임라인, 후속 액션 추적
- **병원 관리**: 카드형 목록, S/A/B/C 등급 분류, 지역/등급 필터, 실시간 검색, 30일+ 미방문 경고
- **병원 상세**: 기본정보, 소속 교수 목록(영향력 표시), 미팅 기록 타임라인, 후속액션 추적
- **교수 관리**: 전체 교수 테이블, 소속병원/진료과/전문분야/영향력/미팅횟수 표시, 검색
- **교수 사진 업로드**: 프로필 사진 업로드(2MB 이하, 자동 200x200 리사이징, Base64 D1 저장)
- **미팅 기록**: 전체 미팅 타임라인, 유형별(방문/전화/학회/이메일/온라인) 분류
- **인공와우 통계 (NEW)**: S5800 인공와우이식술 5개년+ 통계 시각화
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
| hospitals | name, region, address, phone, grade(S/A/B/C), status, notes |
| doctors | name, department, position, specialty, influence_level(high/medium/low), photo |
| meetings | meeting_date, meeting_type, purpose, content, result, next_action, next_meeting_date |

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
| GET | `/api/hospitals` | 병원 목록 (?region, ?status, ?search, ?grade) |
| GET/POST/PUT/DELETE | `/api/hospitals/:id` | 병원 CRUD |
| GET | `/api/hospitals/:id/doctors` | 병원별 교수 목록 |
| GET/POST/PUT/DELETE | `/api/doctors/:id` | 교수 CRUD |
| POST/DELETE | `/api/doctors/:id/photo` | 교수 사진 업로드/삭제 |
| GET/POST/PUT/DELETE | `/api/meetings/:id` | 미팅 CRUD |
| GET | `/api/regions` | 지역 목록 |
| GET | `/api/ci-stats` | 인공와우 이식술 통계 (S5800 HIRA 빅데이터) |

## User Guide
1. **대시보드**에서 전체 현황 확인 (통계 카드 클릭 시 해당 페이지 이동)
2. **병원 관리** → 병원 추가 후, 카드 클릭하여 상세 페이지 이동
3. 병원 상세에서 **교수 추가** → 교수 프로필 사진 클릭하여 사진 업로드
4. **미팅 기록** 추가 시 결과, 후속 액션, 다음 미팅 예정일 입력
5. 대시보드의 **후속 액션** 패널에서 To-Do 추적
6. **인공와우 통계** 메뉴에서 시장 데이터 확인 (영업 PT 자료 활용 가능)

## Deployment
- **Platform**: Cloudflare Pages + D1 Database
- **Status**: ✅ Production Active
- **Last Updated**: 2026-03-26
