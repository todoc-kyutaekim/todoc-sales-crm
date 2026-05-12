-- ============================================================
-- 0022_products.sql
-- 제품(데모기) 재고 / 입출고 관리
--   - 내부기: 사내 시연/테스트용
--   - 외부기: Sullivan, Sound1 (영업이 외부 반출)
--   - 휴대보관함: 외부기용 충전 케이스 (Sullivan, Sound1)
-- 핵심 정책
--   - 개별 S/N 단위로 추적 (product_units)
--   - 영구 전달(deliver) vs 대여(checkout) 구분
--   - 한 유닛을 여러 영업담당이 공유 가능 (product_holders M:N)
--   - 미팅과 자동 연계 (meeting_id)
-- ============================================================

-- 제품 마스터 (카테고리 + 모델 정의)
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,             -- 'internal' | 'external' | 'carry_case'
  model TEXT NOT NULL,                -- 'default' | 'sullivan' | 'sound1'
  name TEXT NOT NULL,                 -- 표시명
  description TEXT,                   -- 카테고리/모델별 비고
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_model ON products(model);

-- 개별 제품 단위 (S/N)
CREATE TABLE IF NOT EXISTS product_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  serial_no TEXT,                          -- 일련번호
  asset_code TEXT,                         -- 사내 자산번호/관리번호
  status TEXT DEFAULT 'in_stock',          -- in_stock | out | with_user | at_hospital | delivered | lost | repair | retired
  current_hospital_id INTEGER,             -- 외부 반출 시 위치 기관
  acquired_at DATE,                        -- 입고일
  notes TEXT,                              -- 비고 (제품 단위)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (current_hospital_id) REFERENCES hospitals(id)
);
CREATE INDEX IF NOT EXISTS idx_product_units_product ON product_units(product_id);
CREATE INDEX IF NOT EXISTS idx_product_units_status ON product_units(status);
CREATE INDEX IF NOT EXISTS idx_product_units_hospital ON product_units(current_hospital_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_units_serial ON product_units(serial_no) WHERE serial_no IS NOT NULL AND serial_no != '';

-- 보유자 (공유 허용: 한 유닛을 여러 영업담당이 동시에 보유 가능)
CREATE TABLE IF NOT EXISTS product_holders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_unit_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  released_at DATETIME,                    -- NULL이면 현재 보유 중
  notes TEXT,
  FOREIGN KEY (product_unit_id) REFERENCES product_units(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_product_holders_unit ON product_holders(product_unit_id);
CREATE INDEX IF NOT EXISTS idx_product_holders_user ON product_holders(user_id);
CREATE INDEX IF NOT EXISTS idx_product_holders_active ON product_holders(released_at);

-- 입출고/이동 이력
CREATE TABLE IF NOT EXISTS product_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_unit_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,             -- 'inbound' 입고 | 'checkout' 대여반출 | 'demo' 시연후복귀 | 'deliver' 영구납품 | 'return' 회수 | 'transfer' 담당자이전 | 'assign' 보유자추가 | 'release' 보유자해제 | 'lost' 분실 | 'repair' 수리 | 'retire' 폐기
  from_user_id INTEGER,                    -- 이전 보유자 (이전/회수 시)
  to_user_id INTEGER,                      -- 새 보유자 (반출/이전 시)
  hospital_id INTEGER,                     -- 관련 기관
  doctor_id INTEGER,                       -- 관련 의료진 (선택)
  meeting_id INTEGER,                      -- 연관 미팅
  is_loan INTEGER DEFAULT 0,               -- 1=대여(반납예정), 0=일반/영구
  expected_return_date DATE,               -- 예상 회수일
  actual_return_date DATE,                 -- 실제 회수일
  quantity INTEGER DEFAULT 1,
  reason TEXT,                             -- 사유/비고
  performed_by INTEGER NOT NULL,           -- 처리자 (로그인 사용자)
  performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_unit_id) REFERENCES product_units(id) ON DELETE CASCADE,
  FOREIGN KEY (from_user_id) REFERENCES users(id),
  FOREIGN KEY (to_user_id) REFERENCES users(id),
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL,
  FOREIGN KEY (performed_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_movements_unit ON product_movements(product_unit_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_hospital ON product_movements(hospital_id);
CREATE INDEX IF NOT EXISTS idx_movements_meeting ON product_movements(meeting_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON product_movements(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_type ON product_movements(movement_type);

-- 미팅 ↔ 제품 동반 반출 매핑 (M:N, 미팅 시 가져간 제품들)
CREATE TABLE IF NOT EXISTS meeting_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL,
  product_unit_id INTEGER NOT NULL,
  action TEXT,                             -- 'demo' 시연 | 'deliver' 전달 | 'checkout' 반출/대여 | 'return' 회수
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  FOREIGN KEY (product_unit_id) REFERENCES product_units(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meeting_products_meeting ON meeting_products(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_products_unit ON meeting_products(product_unit_id);

-- ============================================================
-- 시드 데이터: 카테고리/모델 정의
-- ============================================================
INSERT OR IGNORE INTO products (category, model, name, description) VALUES
  ('internal',   'default',  '내부기',                  '사내 시연 및 테스트 용도'),
  ('external',   'sullivan', '외부기 (Sullivan)',       '영업 외부 반출용 데모기 - Sullivan'),
  ('external',   'sound1',   '외부기 (Sound1)',         '영업 외부 반출용 데모기 - Sound1'),
  ('carry_case', 'sullivan', '휴대보관함 (Sullivan)',   '외부기 Sullivan 충전 케이스'),
  ('carry_case', 'sound1',   '휴대보관함 (Sound1)',     '외부기 Sound1 충전 케이스');
