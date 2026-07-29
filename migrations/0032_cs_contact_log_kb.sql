-- ============================================================
-- CS 모듈 Phase 3: 응대 로그 + FAQ/지식베이스
-- ============================================================

-- ============================================================
-- 응대 로그 (Contact Log)
-- 전화·이메일·방문·SMS/카카오 등 모든 고객 응대 이력을 통합 기록
-- ============================================================
CREATE TABLE IF NOT EXISTS cs_contact_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 대상 (고객 또는 기관, 둘 다 nullable)
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,

  -- 비회원용 자유 입력 (고객 미연결 시)
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,

  -- 응대 성격
  direction TEXT NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound','outbound')),
  channel TEXT NOT NULL DEFAULT 'phone'
    CHECK (channel IN ('phone','email','visit','sms','kakao','other')),

  -- 내용
  subject TEXT NOT NULL,
  content TEXT,
  duration_min INTEGER, -- 통화/방문 시간(분)

  -- 결과
  outcome TEXT NOT NULL DEFAULT 'resolved'
    CHECK (outcome IN ('resolved','needs_followup','no_answer','transferred')),
  followup_at DATETIME, -- 후속 예정 (outcome=needs_followup)

  -- 관련 항목 크로스링크
  related_inquiry_id INTEGER REFERENCES cs_inquiries(id) ON DELETE SET NULL,
  related_repair_id INTEGER REFERENCES cs_repairs(id) ON DELETE SET NULL,

  -- 응대자 · 시각
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contacted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cs_ctl_customer_id ON cs_contact_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_hospital_id ON cs_contact_logs(hospital_id);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_direction ON cs_contact_logs(direction);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_channel ON cs_contact_logs(channel);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_outcome ON cs_contact_logs(outcome);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_user_id ON cs_contact_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_contacted_at ON cs_contact_logs(contacted_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_followup_at ON cs_contact_logs(followup_at);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_inquiry ON cs_contact_logs(related_inquiry_id);
CREATE INDEX IF NOT EXISTS idx_cs_ctl_repair ON cs_contact_logs(related_repair_id);

-- ============================================================
-- FAQ / 지식베이스 (Knowledge Base)
-- ============================================================
CREATE TABLE IF NOT EXISTS cs_kb_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('product','procedure','warranty','billing','other')),

  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '', -- Markdown

  tags TEXT, -- JSON array (e.g. ["보증","AS","2025"])

  visibility TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('public','internal')),

  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft','published','archived')),

  view_count INTEGER NOT NULL DEFAULT 0,

  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cs_kb_category ON cs_kb_articles(category);
CREATE INDEX IF NOT EXISTS idx_cs_kb_status ON cs_kb_articles(status);
CREATE INDEX IF NOT EXISTS idx_cs_kb_visibility ON cs_kb_articles(visibility);
CREATE INDEX IF NOT EXISTS idx_cs_kb_updated_at ON cs_kb_articles(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cs_kb_view_count ON cs_kb_articles(view_count DESC);
