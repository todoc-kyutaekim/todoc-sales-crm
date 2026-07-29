-- ============================================================
-- 0038: 고객 그룹 (customer_groups) + 그룹 멤버쉽 (customer_group_members)
--   - 일반 그룹 (자유 명명)
--   - 다중 소속 (한 고객이 여러 그룹에 속할 수 있음)
--   - 필드: 이름/색상/설명/정렬순서
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#64748b',    -- Tailwind slate-500 (기본색)
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_groups_sort ON customer_groups(sort_order, name);

CREATE TABLE IF NOT EXISTS customer_group_members (
  group_id INTEGER NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_cgm_customer ON customer_group_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_cgm_group ON customer_group_members(group_id);
