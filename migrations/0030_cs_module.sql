-- ============================================================
-- CS 모듈 (Phase 1): 고객관리 + 고객 문의
-- ============================================================
-- customers: 환자·가망고객·보호자 모두 포함
-- cs_inquiries: 문의 접수/처리 이력
-- cs_inquiry_responses: 문의별 응답/노트/상태변경 타임라인
-- ============================================================

-- 1) 고객 (환자·가망고객·보호자)
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  birth_date TEXT,                        -- 'YYYY-MM-DD'
  gender TEXT,                            -- 'M' | 'F' | ''
  customer_type TEXT DEFAULT 'prospect',  -- 'prospect' 가망고객 | 'guardian' 보호자 | 'patient' 시술받은 환자
  hospital_id INTEGER,                    -- 진료/시술 병원 (nullable)
  address TEXT,
  region TEXT,                            -- 지역 필터용
  implant_date TEXT,                      -- 시술일 (patient 유형)
  implant_side TEXT,                      -- 'L'|'R'|'BOTH' 시술 부위
  device_model TEXT,                      -- 사용 기기 모델 (자유입력)
  device_serial TEXT,                     -- 시리얼 (자유입력)
  guardian_of INTEGER,                    -- customers.id — 보호자인 경우 어느 환자의 보호자인지
  status TEXT DEFAULT 'active',           -- 'active' | 'inactive' | 'dormant'
  tags TEXT,                              -- 콤마 구분
  notes TEXT,
  created_by INTEGER,                     -- users.id 등록자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE SET NULL,
  FOREIGN KEY (guardian_of) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_hospital ON customers(hospital_id);
CREATE INDEX IF NOT EXISTS idx_customers_region ON customers(region);

-- 2) 고객 문의
CREATE TABLE IF NOT EXISTS cs_inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,                    -- nullable (익명·초회 문의)
  contact_name TEXT,                      -- customer_id 없을 때 폴백
  contact_phone TEXT,
  contact_email TEXT,
  subject TEXT NOT NULL,
  category TEXT DEFAULT 'general',        -- 'product' 제품 | 'usage' 사용법 | 'billing' 비용/보험 | 'appointment' 예약 | 'complaint' 불만 | 'general' 일반
  channel TEXT DEFAULT 'phone',           -- 'phone' | 'email' | 'kakao' | 'visit' | 'web' | 'referral'
  priority TEXT DEFAULT 'mid',            -- 'low' | 'mid' | 'high' | 'urgent'
  status TEXT DEFAULT 'open',             -- 'open' 접수 | 'in_progress' 처리 중 | 'resolved' 해결 | 'closed' 종료 | 'canceled' 취소
  assignee_id INTEGER,                    -- users.id 담당 CS
  first_message TEXT,                     -- 최초 문의 내용
  hospital_id INTEGER,                    -- 관련 병원 (nullable)
  created_by INTEGER,                     -- users.id 접수자
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cs_inq_customer ON cs_inquiries(customer_id);
CREATE INDEX IF NOT EXISTS idx_cs_inq_status ON cs_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_cs_inq_priority ON cs_inquiries(priority);
CREATE INDEX IF NOT EXISTS idx_cs_inq_assignee ON cs_inquiries(assignee_id);
CREATE INDEX IF NOT EXISTS idx_cs_inq_created ON cs_inquiries(created_at);

-- 3) 문의 응답/노트/상태변경 이력 (타임라인)
CREATE TABLE IF NOT EXISTS cs_inquiry_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL,
  user_id INTEGER,                        -- 작성자 (users.id)
  response_type TEXT DEFAULT 'reply',     -- 'reply' 응답 | 'note' 내부메모 | 'status_change' 상태변경 | 'assignee_change' 담당자변경
  channel TEXT,                           -- 이 응답의 채널 (phone/email/kakao/visit 등)
  content TEXT,
  meta TEXT,                              -- JSON: {"from":"open","to":"in_progress"} 등
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inquiry_id) REFERENCES cs_inquiries(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cs_inq_resp_inquiry ON cs_inquiry_responses(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_cs_inq_resp_created ON cs_inquiry_responses(created_at);
