-- ==============================================
-- Migration: Tags, Favorites, Meeting Templates, Pipeline Stages, KPI Targets
-- ==============================================

-- Tags table (for hospitals and doctors)
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#64748b',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Entity-Tag junction table
CREATE TABLE IF NOT EXISTS entity_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- 'hospital' or 'doctor'
  entity_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, tag_id),
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Favorites table
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- 'hospital' or 'doctor'
  entity_id INTEGER NOT NULL,
  user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_type, entity_id, user_id)
);

-- Meeting templates
CREATE TABLE IF NOT EXISTS meeting_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  meeting_type TEXT DEFAULT 'visit',
  purpose TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Pipeline stages for hospitals
ALTER TABLE hospitals ADD COLUMN pipeline_stage TEXT DEFAULT 'contact';
-- pipeline_stage: 'contact', 'meeting', 'demo', 'proposal', 'contract', 'active_customer'

-- KPI targets table (monthly)
CREATE TABLE IF NOT EXISTS kpi_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  target_meetings INTEGER DEFAULT 0,
  target_new_hospitals INTEGER DEFAULT 0,
  target_contracts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, month)
);

-- Doctor transfer history
CREATE TABLE IF NOT EXISTS doctor_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id INTEGER NOT NULL,
  from_hospital_id INTEGER NOT NULL,
  to_hospital_id INTEGER NOT NULL,
  transfer_date DATE DEFAULT (date('now')),
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (from_hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (to_hospital_id) REFERENCES hospitals(id)
);

-- Doctor relationships (mentor-mentee, lab, conference peers)
CREATE TABLE IF NOT EXISTS doctor_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id_1 INTEGER NOT NULL,
  doctor_id_2 INTEGER NOT NULL,
  relationship_type TEXT NOT NULL, -- 'mentor', 'mentee', 'lab', 'conference_peer', 'colleague'
  notes TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doctor_id_1) REFERENCES doctors(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id_2) REFERENCES doctors(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_entity_tags_entity ON entity_tags(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_favorites_entity ON favorites(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_kpi_targets_ym ON kpi_targets(year, month);
CREATE INDEX IF NOT EXISTS idx_doctor_transfers_doctor ON doctor_transfers(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_relationships ON doctor_relationships(doctor_id_1, doctor_id_2);
CREATE INDEX IF NOT EXISTS idx_hospitals_pipeline ON hospitals(pipeline_stage);

-- Insert default tags
INSERT OR IGNORE INTO tags (name, color) VALUES 
  ('CI 관심', '#7c3aed'),
  ('보청기 전환 대상', '#059669'),
  ('핵심 거래처', '#dc2626'),
  ('신규 발굴', '#3b82f6'),
  ('학회 활동', '#d97706'),
  ('연구 협력', '#0891b2'),
  ('난청 전문', '#8b5cf6'),
  ('소아 전문', '#ec4899'),
  ('재활 전문', '#14b8a6');

-- Insert default meeting templates
INSERT OR IGNORE INTO meeting_templates (name, meeting_type, purpose, content) VALUES
  ('신규 방문 인사', 'visit', '신규 기관 첫 방문 인사', '토닥 인공와우 솔루션 소개\n- 회사 소개\n- 제품 라인업 안내\n- 임상 데이터 공유'),
  ('제품 데모', 'visit', '인공와우 제품 시연', '제품 데모 진행\n- 실물 체험\n- 사용법 안내\n- Q&A'),
  ('학회 미팅', 'conference', '학회 참석 및 관계 구축', '학회 동향 파악\n- 최신 연구 동향 논의\n- 네트워킹'),
  ('정기 팔로업', 'phone', '정기 관계 유지 통화', '근황 확인 및 정보 공유\n- 시장 동향 전달\n- 향후 일정 조율'),
  ('계약 논의', 'visit', '공급 계약 조건 협의', '계약 조건 논의\n- 가격 협의\n- 납품 조건\n- 서비스 계약');
