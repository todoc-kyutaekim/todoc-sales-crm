# TODOC CRM - 병원 영업 관리 시스템

## Project Overview
- **Name**: TODOC CRM
- **Goal**: 인공와우 전문기업 토닥(TODOC)의 병원 영업팀이 병원, 교수, 미팅 기록을 체계적으로 관리
- **Tech Stack**: Hono + TypeScript + Cloudflare Pages + D1 Database + TailwindCSS

## 주요 기능

### 완성된 기능
- **대시보드**: 관리 병원 수, 교수 수, 미팅 수 통계 / 최근 미팅 / 후속 액션 목록
- **병원 관리**: 병원 추가/수정/삭제, 등급(S/A/B/C) 분류, 지역별 필터, 검색
- **교수 관리**: 교수 추가/수정/삭제, 영향력 등급(핵심/주요/일반), 전문분야, 소속병원별 관리
- **미팅 기록**: 미팅 추가/수정/삭제, 유형(방문/전화/학회/이메일/온라인), 내용/결과/후속액션 기록
- **병원 상세 페이지**: 소속 교수 목록, 미팅 기록 타임라인, 한눈에 관리

## URLs
- **Development**: https://3000-iylehv8wdr8gpuk9sw65x-d0b9e1e2.sandbox.novita.ai

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | 대시보드 통계 |
| GET | `/api/hospitals` | 병원 목록 (`?region=&status=&search=`) |
| GET | `/api/hospitals/:id` | 병원 상세 |
| POST | `/api/hospitals` | 병원 추가 |
| PUT | `/api/hospitals/:id` | 병원 수정 |
| DELETE | `/api/hospitals/:id` | 병원 삭제 |
| GET | `/api/hospitals/:id/doctors` | 해당 병원 교수 목록 |
| GET | `/api/doctors` | 전체 교수 목록 (`?search=`) |
| POST | `/api/doctors` | 교수 추가 |
| PUT | `/api/doctors/:id` | 교수 수정 |
| DELETE | `/api/doctors/:id` | 교수 삭제 |
| GET | `/api/meetings` | 미팅 기록 (`?doctor_id=&hospital_id=&limit=`) |
| POST | `/api/meetings` | 미팅 추가 |
| PUT | `/api/meetings/:id` | 미팅 수정 |
| DELETE | `/api/meetings/:id` | 미팅 삭제 |
| GET | `/api/regions` | 지역 목록 |

## Data Architecture
- **D1 Database**: Cloudflare D1 (SQLite) - `todoc-crm-production`
- **Tables**: hospitals, doctors, meetings
- **Relationships**: hospitals → doctors (1:N), doctors → meetings (1:N), hospitals → meetings (1:N)

## User Guide
1. **대시보드**에서 전체 현황을 한눈에 확인
2. **병원 관리**에서 영업 대상 병원 목록을 관리하고, 등급/지역별 필터링
3. 병원 카드를 클릭하면 **병원 상세 페이지**로 이동
4. 상세 페이지에서 소속 **교수 추가/수정** 및 **미팅 기록 추가**
5. 미팅 기록에 결과와 후속 액션을 입력하면 대시보드에서 추적 가능

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: ✅ Development Active
- **Last Updated**: 2026-03-26
