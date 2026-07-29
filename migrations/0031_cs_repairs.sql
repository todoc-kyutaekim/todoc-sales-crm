-- ============================================================
-- 0031_cs_repairs.sql
-- CS 모듈 Phase 2 — AS/수리 요청 관리
--   - 제품 시리얼 연동: product_units 조회 (선택적)
--   - 자유 입력 지원: 미등록 제품/외부 제품도 접수 가능
--   - 수리 진행 단계 이력 자동 로깅
--   - 기존 cs_inquiries 에서 승격 가능 (inquiry_id)
-- ============================================================

-- 수리 요청 마스터
CREATE TABLE IF NOT EXISTS cs_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 요청자/고객 정보
  customer_id INTEGER,                     -- FK customers (선택)
  contact_name TEXT,                       -- 고객 미등록 시 폴백
  contact_phone TEXT,
  contact_email TEXT,
  hospital_id INTEGER,                     -- FK hospitals (관련 기관)

  -- 제품 정보 (2가지 방식 병존)
  product_unit_id INTEGER,                 -- FK product_units (시리얼 매칭 시)
  product_name TEXT,                       -- 자유 입력 (미등록/외부 제품)
  serial_no_text TEXT,                     -- 자유 입력 시리얼 (조회 편의)

  -- 문의 연결 (기존 문의에서 승격)
  inquiry_id INTEGER,                      -- FK cs_inquiries (선택)

  -- 상태/우선순위
  status TEXT DEFAULT 'received',          -- received | diagnosing | waiting_parts | repairing | completed | shipped | closed | rejected
  priority TEXT DEFAULT 'mid',             -- low | mid | high | urgent
  warranty_status TEXT DEFAULT 'unknown',  -- in_warranty | out_of_warranty | unknown

  -- 내용
  symptom TEXT NOT NULL,                   -- 증상 (필수)
  diagnosis TEXT,                          -- 진단 결과
  resolution TEXT,                         -- 처리 내용

  -- 담당/비용
  assignee_id INTEGER,                     -- FK users (담당 CS)
  cost REAL,                               -- 수리 비용

  -- 일정
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expected_completion_at DATETIME,
  completed_at DATETIME,
  shipped_at DATETIME,
  closed_at DATETIME,

  -- 메타
  notes TEXT,
  created_by INTEGER,                      -- FK users
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE SET NULL,
  FOREIGN KEY (product_unit_id) REFERENCES product_units(id) ON DELETE SET NULL,
  FOREIGN KEY (inquiry_id) REFERENCES cs_inquiries(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cs_repairs_customer ON cs_repairs(customer_id);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_hospital ON cs_repairs(hospital_id);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_product_unit ON cs_repairs(product_unit_id);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_inquiry ON cs_repairs(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_status ON cs_repairs(status);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_assignee ON cs_repairs(assignee_id);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_priority ON cs_repairs(priority);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_received ON cs_repairs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_repairs_serial_text ON cs_repairs(serial_no_text);

-- 수리 진행 단계 이력
CREATE TABLE IF NOT EXISTS cs_repair_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_id INTEGER NOT NULL,
  user_id INTEGER,                         -- FK users (수행자)

  step_type TEXT NOT NULL,                 -- status_change | assignee_change | note | diagnosis | part_order | cost_update | resolution
  from_value TEXT,                         -- 이전 값 (상태/담당자 등)
  to_value TEXT,                           -- 새 값
  content TEXT,                            -- 메모/설명
  meta TEXT,                               -- JSON 부가정보

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (repair_id) REFERENCES cs_repairs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cs_repair_steps_repair ON cs_repair_steps(repair_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_repair_steps_user ON cs_repair_steps(user_id);
CREATE INDEX IF NOT EXISTS idx_cs_repair_steps_type ON cs_repair_steps(step_type);
