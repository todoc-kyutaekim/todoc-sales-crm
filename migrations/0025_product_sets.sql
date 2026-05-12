-- 제품 세트 관리: 내부기 + 외부기 + 휴대보관함 등을 묶음으로 관리
-- 세트로 반출/회수 시 해당 세트의 모든 유닛에 동일 동작 적용

-- 세트 마스터
CREATE TABLE IF NOT EXISTS product_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                      -- 세트 이름 (예: "Sullivan 풀세트 #1")
  description TEXT,                        -- 세트 설명
  status TEXT DEFAULT 'in_stock',          -- 세트 전체 상태 (집계용): in_stock | with_user | at_hospital | out | mixed | retired
  current_hospital_id INTEGER,             -- 현재 위치 (반출 시)
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (current_hospital_id) REFERENCES hospitals(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_product_sets_status ON product_sets(status);
CREATE INDEX IF NOT EXISTS idx_product_sets_hospital ON product_sets(current_hospital_id);

-- 세트 구성: 어떤 유닛이 어느 세트에 속하는지 (한 유닛은 동시에 하나의 활성 세트에만 속함)
CREATE TABLE IF NOT EXISTS product_set_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  product_unit_id INTEGER NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME,                     -- NULL이면 현재 세트에 포함
  FOREIGN KEY (set_id) REFERENCES product_sets(id) ON DELETE CASCADE,
  FOREIGN KEY (product_unit_id) REFERENCES product_units(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_set_items_set ON product_set_items(set_id);
CREATE INDEX IF NOT EXISTS idx_product_set_items_unit ON product_set_items(product_unit_id);
CREATE INDEX IF NOT EXISTS idx_product_set_items_active ON product_set_items(removed_at);

-- 한 유닛이 동시에 여러 활성 세트에 속하지 못하도록 (removed_at IS NULL 인 row가 unit당 1개)
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_set_items_unique_active
  ON product_set_items(product_unit_id) WHERE removed_at IS NULL;
