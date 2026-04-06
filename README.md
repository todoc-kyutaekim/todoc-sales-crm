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

## Deployment
- **Platform**: Cloudflare Pages + D1 Database
- **Status**: ✅ Production Active
- **Deployment URL**: https://todoc-crm.pages.dev
- **Last Updated**: 2026-04-06

### Migration 이력
| 번호 | 파일명 | 내용 |
|------|--------|------|
| 0001-0010 | initial ~ clinics | 초기 스키마, CI 통계, 인증, 논문, 의원 |
| 0011 | merge_clinics_into_hospitals | 의원→병원 통합 (필드추가, 데이터 이전) |
| 0012 | tags_favorites_templates_pipeline | 태그, 즐겨찾기, 템플릿, 파이프라인, KPI, 이적, 관계 |
| 0013 | doctor_clinic_hours | 의료진 외래 시간 컬럼 추가 (clinic_hours TEXT) |

### 권장 다음 개발 사항
- **프론트엔드 모듈화**: app.js를 Vite + TypeScript 기반 모듈로 분리 (pages/, components/, utils/)
- **테스트**: Vitest 단위 테스트, Playwright E2E 테스트
- **보안**: RBAC 역할 관리, 로그인 brute-force 보호, CSRF 방어
- **AI 확장**: 미팅 요약 자동 생성, 의료진 추천, 이상 감지
- **협업**: 팀 대시보드, 작업 할당, 코멘트, 푸시 알림
- **UX**: 다크 모드, 무한 스크롤, 기관 지도 뷰
- **보고서**: 주간/월간 자동 보고서 PDF/이메일 발송
