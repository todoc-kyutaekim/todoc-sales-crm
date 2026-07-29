-- Phase 3 롤백 + 통합: 응대 로그를 고객문의로 흡수
-- 개념: cs_inquiries가 "티켓"이자 "응대 이벤트"를 모두 표현
-- direction=outbound + 짧은 subject('부재중 전화' 등) + status=closed로 단발 접촉도 기록 가능

-- 1) cs_inquiries에 응대 로그 고유 필드 4개 추가
ALTER TABLE cs_inquiries ADD COLUMN direction TEXT NOT NULL DEFAULT 'inbound';
ALTER TABLE cs_inquiries ADD COLUMN duration_min INTEGER;
ALTER TABLE cs_inquiries ADD COLUMN followup_at DATETIME;
ALTER TABLE cs_inquiries ADD COLUMN related_repair_id INTEGER REFERENCES cs_repairs(id) ON DELETE SET NULL;

-- 2) 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_cs_inq_direction ON cs_inquiries(direction);
CREATE INDEX IF NOT EXISTS idx_cs_inq_followup_at ON cs_inquiries(followup_at);
CREATE INDEX IF NOT EXISTS idx_cs_inq_related_repair_id ON cs_inquiries(related_repair_id);

-- 3) cs_contact_logs 테이블 및 관련 인덱스 제거
DROP INDEX IF EXISTS idx_cs_ctl_customer_id;
DROP INDEX IF EXISTS idx_cs_ctl_hospital_id;
DROP INDEX IF EXISTS idx_cs_ctl_direction;
DROP INDEX IF EXISTS idx_cs_ctl_channel;
DROP INDEX IF EXISTS idx_cs_ctl_outcome;
DROP INDEX IF EXISTS idx_cs_ctl_user_id;
DROP INDEX IF EXISTS idx_cs_ctl_contacted_at;
DROP INDEX IF EXISTS idx_cs_ctl_followup_at;
DROP INDEX IF EXISTS idx_cs_ctl_related_inquiry_id;
DROP INDEX IF EXISTS idx_cs_ctl_related_repair_id;
DROP TABLE IF EXISTS cs_contact_logs;
